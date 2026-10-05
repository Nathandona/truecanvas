import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Component, ArrowUpFromLine, Play, RotateCcw, Square as StopIcon, Bot, Code2, Copy, CopyPlus, CornerLeftUp, Eye, ExternalLink, FileCode2, FlaskConical, LayoutList, Moon, Sun, Trash2 } from "lucide-react";
import { useStore, effectiveTheme, isLockedDeep, layerKey, layerName, type Rect } from "../lib/store";
import { hitTest, installBridge, measure, onFrameKey, onFrameWheel, refreshRects, registerFrame, send } from "../lib/bridge";
import { readLayout } from "../lib/classes";
import {
  acceptsChildren,
  applyToPage,
  exploreCopy,
  frameContainer,
  copySelectionCode,
  createFrameAt,
  deleteSelection,
  duplicateSelection,
  frameHeight,
  kbd,
  openInEditor,
  playFrame,
  playHeight,
  replayFrame,
  selectParent,
  setCamera,
  setViewportSize,
  wrapSelection,
  zoomBy,
} from "../lib/actions";
import { api, findDevice, type CanvasFrame, type ComponentSpec, type Device, type Literal } from "../lib/api";
import { Menu, type MenuItem } from "./Menu";
import { editComponent } from "../lib/elements";
import { rawId } from "../lib/scope";
import { openComponentDialog } from "./ComponentDialog";
import { AgentCursors } from "./AgentCursors";
import { CompareFrames, changeBadge, comparePlacement } from "./Compare";
import { CommentLayer, commentTarget } from "./Comments";
import { handleShortcut } from "./shortcuts";

type Drag =
  | { kind: "pan"; startX: number; startY: number; camX: number; camY: number }
  | { kind: "frame-move"; frame: CanvasFrame; startX: number; startY: number; moved: boolean }
  | { kind: "frame-resize"; frame: CanvasFrame; edge: "e" | "s" | "se" | "w"; startX: number; startY: number }
  | { kind: "draw"; startX: number; startY: number; x: number; y: number }
  | { kind: "marquee"; startX: number; startY: number; x: number; y: number; additive: boolean }
  | { kind: "click"; id: string; startX: number; startY: number; additive: boolean }
  | { kind: "node-drag"; id: string; frame: CanvasFrame; target: Reorder | null };

/** Where a dragged layer would land among its siblings. */
interface Reorder {
  parent: string;
  index: number;
  /** indicator line in frame coordinates */
  line: Rect;
}

interface Override {
  x: number;
  y: number;
  width: number;
  height: number | null;
}

export function CanvasView() {
  const doc = useStore((s) => s.doc);
  const camera = useStore((s) => s.camera);
  const tool = useStore((s) => s.tool);
  const vpRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const [overrides, setOverrides] = useState<Record<string, Override>>({});
  const [space, setSpace] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [drop, setDrop] = useState<{ frame: string; rect: Rect; parent: string; index?: number; label: string } | null>(null);
  const hoverSeq = useRef(0);
  // sharp rendering: let the browser re-rasterize frames once the camera settles
  const [moving, setMoving] = useState(false);
  const settle = useRef<number>(0);
  useEffect(() => {
    setMoving(true);
    clearTimeout(settle.current);
    settle.current = window.setTimeout(() => setMoving(false), 160);
  }, [camera]);
  const lastPointer = useRef({ x: 0, y: 0 });

  useEffect(() => installBridge(), []);

  // viewport size
  useEffect(() => {
    const el = vpRef.current!;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ width: r.width, height: r.height });
      setViewportSize(r.width, r.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const toWorld = useCallback(
    (clientX: number, clientY: number) => {
      const r = vpRef.current!.getBoundingClientRect();
      const cam = useStore.getState().camera;
      return { x: (clientX - r.left - cam.x) / cam.zoom, y: (clientY - r.top - cam.y) / cam.zoom, sx: clientX - r.left, sy: clientY - r.top };
    },
    [],
  );

  const framePos = useCallback(
    (f: CanvasFrame) => {
      const o = overrides[f.frameName];
      return o ?? { x: f.x, y: f.y, width: f.width, height: f.height };
    },
    [overrides],
  );

  const frameAt = useCallback(
    (wx: number, wy: number): CanvasFrame | null => {
      const frames = useStore.getState().doc?.frames ?? [];
      for (let i = frames.length - 1; i >= 0; i--) {
        const f = frames[i];
        const p = framePos(f);
        const h = p.height ?? frameHeight(f);
        if (wx >= p.x && wx <= p.x + p.width && wy >= p.y && wy <= p.y + h) return f;
      }
      return null;
    },
    [framePos],
  );

  /** Async hover: ask the frame under the pointer what is there. */
  const updateHover = useCallback(
    async (clientX: number, clientY: number) => {
      const { x, y } = toWorld(clientX, clientY);
      const f = frameAt(x, y);
      const seq = ++hoverSeq.current;
      if (!f) {
        if (useStore.getState().hover !== null) useStore.setState({ hover: null });
        return null;
      }
      const p = framePos(f);
      const res = await hitTest(f.frameName, x - p.x, y - p.y);
      if (seq !== hoverSeq.current) return null;
      const s = useStore.getState();
      // locked layers (and everything inside them) can't be picked on the canvas
      const known = (res?.chain ?? []).filter((c) => s.index.has(c));
      const id = known.find((c) => !isLockedDeep(c)) ?? f.id;
      const rects = res ? { ...s.rects, ...res.rects } : s.rects;
      if (s.hover !== id || res) useStore.setState({ hover: id, rects });
      return { id, frame: f, chain: (res?.chain ?? []).filter((c) => s.index.has(c)) };
    },
    [frameAt, framePos, toWorld],
  );

  // ---------- wheel: pan & zoom (also forwarded from frames in interact mode) ----------
  const onWheelLike = useCallback((e: { dx: number; dy: number; ctrl: boolean; clientX: number; clientY: number; mode: number }) => {
    const r = vpRef.current!.getBoundingClientRect();
    const unit = e.mode === 1 ? 16 : 1;
    if (e.ctrl) {
      // mouse wheels send ±100 per notch, trackpad pinch sends small deltas: clamp to ~1.3× per event
      const d = Math.max(-30, Math.min(30, e.dy * unit));
      zoomBy(Math.exp(-d * 0.0085), { x: e.clientX - r.left, y: e.clientY - r.top });
    } else {
      const cam = useStore.getState().camera;
      setCamera({ ...cam, x: cam.x - e.dx * unit, y: cam.y - e.dy * unit });
    }
  }, []);

  useEffect(() => {
    const el = vpRef.current!;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      onWheelLike({ dx: e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX, dy: e.shiftKey && !e.deltaX ? 0 : e.deltaY, ctrl: e.ctrlKey || e.metaKey, clientX: e.clientX, clientY: e.clientY, mode: e.deltaMode });
    };
    el.addEventListener("wheel", wheel, { passive: false });
    onFrameWheel(onWheelLike);
    return () => el.removeEventListener("wheel", wheel);
  }, [onWheelLike]);

  // ---------- keyboard ----------
  useEffect(() => {
    const isTyping = () => {
      const a = document.activeElement as HTMLElement | null;
      return !!a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName));
    };
    const down = (e: KeyboardEvent) => {
      if (isTyping()) return;
      if (e.code === "Space" && !e.repeat) {
        setSpace(true);
        e.preventDefault();
        return;
      }
      if (handleShortcut({ key: e.key, code: e.code, meta: e.metaKey, ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey })) e.preventDefault();
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpace(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    onFrameKey((k) => handleShortcut(k));
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  // ---------- pointer ----------
  const beginDrag = (d: Drag) => {
    dragRef.current = d;
    setDrag(d);
  };

  const onPointerDown = async (e: React.PointerEvent) => {
    if (menu) return;
    vpRef.current!.focus({ preventScroll: true });
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    const s = useStore.getState();
    const cam = s.camera;
    const panning = e.button === 1 || space || s.tool === "hand";
    if (panning) return beginDrag({ kind: "pan", startX: e.clientX, startY: e.clientY, camX: cam.x, camY: cam.y });
    if (e.button !== 0) return;
    const { x, y } = toWorld(e.clientX, e.clientY);
    if (s.tool === "frame") return beginDrag({ kind: "draw", startX: x, startY: y, x, y });
    if (s.tool === "comment") {
      const target = commentTarget(s.doc?.frames ?? [], framePos, x, y);
      if (!target) return useStore.setState({ draftComment: null, openThread: null });
      // remember the layer under the pin (path + name survive line shifts)
      const hit = await updateHover(e.clientX, e.clientY);
      const entry = hit && hit.id !== target.frame.id ? useStore.getState().index.get(hit.id) : null;
      useStore.setState({
        draftComment: { frame: target.frame.frameName, x: target.x, y: target.y, node: entry ? { path: entry.node.path.join("."), name: layerName(entry.node) } : null },
        openThread: null,
      });
      return;
    }
    if (s.tool === "interact") return;
    const f = frameAt(x, y);
    if (!f) {
      if (!e.shiftKey) s.select([]);
      return beginDrag({ kind: "marquee", startX: x, startY: y, x, y, additive: e.shiftKey });
    }
    const hit = (await updateHover(e.clientX, e.clientY)) ?? { id: f.id, frame: f };
    if (hit.id === f.id) {
      // empty frame area: select the frame and allow dragging it
      if (!e.shiftKey) s.select([f.id]);
      return beginDrag({ kind: "frame-move", frame: f, startX: e.clientX, startY: e.clientY, moved: false });
    }
    beginDrag({ kind: "click", id: hit.id, startX: e.clientX, startY: e.clientY, additive: e.shiftKey });
    if (e.shiftKey) {
      const sel = s.selection.includes(hit.id) ? s.selection.filter((i) => i !== hit.id) : [...s.selection, hit.id];
      s.select(sel);
    } else if (!s.selection.includes(hit.id)) s.select([hit.id]);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    lastPointer.current = { x: e.clientX, y: e.clientY };
    const d = dragRef.current;
    const cam = useStore.getState().camera;
    if (!d) {
      const t = useStore.getState().tool;
      if ((t === "select" || t === "comment") && !space) void updateHover(e.clientX, e.clientY);
      return;
    }
    switch (d.kind) {
      case "pan":
        setCamera({ ...cam, x: d.camX + e.clientX - d.startX, y: d.camY + e.clientY - d.startY });
        break;
      case "frame-move": {
        const dx = (e.clientX - d.startX) / cam.zoom;
        const dy = (e.clientY - d.startY) / cam.zoom;
        if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 3) break;
        d.moved = true;
        setOverrides((o) => ({ ...o, [d.frame.frameName]: { x: Math.round(d.frame.x + dx), y: Math.round(d.frame.y + dy), width: d.frame.width, height: d.frame.height } }));
        break;
      }
      case "frame-resize": {
        const dx = (e.clientX - d.startX) / cam.zoom;
        const dy = (e.clientY - d.startY) / cam.zoom;
        const f = d.frame;
        const h0 = f.height ?? frameHeight(f);
        const o: Override = { x: f.x, y: f.y, width: f.width, height: f.height };
        if (d.edge === "e" || d.edge === "se") o.width = Math.max(120, Math.round(f.width + dx));
        if (d.edge === "w") {
          o.width = Math.max(120, Math.round(f.width - dx));
          o.x = Math.round(f.x + f.width - o.width);
        }
        if (d.edge === "s" || d.edge === "se") o.height = Math.max(80, Math.round(h0 + dy));
        setOverrides((prev) => ({ ...prev, [f.frameName]: o }));
        break;
      }
      case "draw":
      case "marquee": {
        const { x, y } = toWorld(e.clientX, e.clientY);
        const next = { ...d, x, y };
        dragRef.current = next;
        setDrag(next);
        break;
      }
      case "click": {
        if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 5) break;
        const entry = useStore.getState().index.get(d.id);
        if (!entry?.parent || useStore.getState().selection.length !== 1) break;
        const next: Drag = { kind: "node-drag", id: d.id, frame: entry.frame, target: null };
        dragRef.current = next;
        setDrag(next);
        break;
      }
      case "node-drag": {
        void reorderTarget(d, e.clientX, e.clientY).then((target) => {
          const cur = dragRef.current;
          if (cur?.kind !== "node-drag" || cur.id !== d.id) return;
          const next = { ...cur, target };
          dragRef.current = next;
          setDrag(next);
        });
        break;
      }
    }
  };

  /** Siblings of the dragged node: find the gap closest to the pointer along the parent's axis. */
  const reorderTarget = async (d: Extract<Drag, { kind: "node-drag" }>, clientX: number, clientY: number): Promise<Reorder | null> => {
    const s = useStore.getState();
    const entry = s.index.get(d.id);
    if (!entry?.parent) return null;
    const parent = entry.parent;
    const siblings = parent.children.filter((c) => c.kind === "component" || c.kind === "element");
    const rects = await measure(d.frame.frameName, siblings.map((c) => c.id));
    const { x, y } = toWorld(clientX, clientY);
    const p = framePos(d.frame);
    const lx = x - p.x;
    const ly = y - p.y;
    const cls = parent.props.className?.kind === "string" ? parent.props.className.value : "";
    const layout = readLayout(cls);
    const horizontal = (layout.display === "flex" || layout.display === "inline-flex") && layout.direction === "row";
    let best: Reorder | null = null;
    let bestDist = Infinity;
    siblings.forEach((c, i) => {
      const r = rects[c.id];
      if (!r) return;
      const gaps = horizontal
        ? [{ at: r.x, index: i, line: { x: r.x - 1, y: r.y, width: 2, height: r.height } }, { at: r.x + r.width, index: i + 1, line: { x: r.x + r.width - 1, y: r.y, width: 2, height: r.height } }]
        : [{ at: r.y, index: i, line: { x: r.x, y: r.y - 1, width: r.width, height: 2 } }, { at: r.y + r.height, index: i + 1, line: { x: r.x, y: r.y + r.height - 1, width: r.width, height: 2 } }];
      for (const g of gaps) {
        const dist = Math.abs((horizontal ? lx : ly) - g.at);
        if (dist < bestDist) {
          bestDist = dist;
          // map the index among element siblings to the index in parent.children
          const anchor = siblings[g.index];
          best = { parent: parent.id, index: anchor ? parent.children.indexOf(anchor) : parent.children.length, line: g.line };
        }
      }
    });
    return best;
  };

  const onPointerUp = async (e: React.PointerEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (!d) return;
    const s = useStore.getState();
    if (d.kind === "frame-move" && d.moved) {
      const o = overrides[d.frame.frameName];
      if (o) await s.run({ op: "update_frame", canvas: s.canvas!, frame: d.frame.frameName, x: o.x, y: o.y });
      clearOverride(d.frame.frameName);
    } else if (d.kind === "frame-resize") {
      const o = overrides[d.frame.frameName];
      if (o) {
        const patch: { width?: number; height?: number | null; x?: number } = {};
        if (o.width !== d.frame.width) patch.width = o.width;
        if (o.x !== d.frame.x) patch.x = o.x;
        if (o.height !== d.frame.height && (d.edge === "s" || d.edge === "se")) patch.height = o.height;
        if (Object.keys(patch).length) await s.run({ op: "update_frame", canvas: s.canvas!, frame: d.frame.frameName, ...patch });
      }
      clearOverride(d.frame.frameName);
    } else if (d.kind === "draw") {
      const x = Math.min(d.startX, d.x);
      const y = Math.min(d.startY, d.y);
      const w = Math.abs(d.x - d.startX);
      const h = Math.abs(d.y - d.startY);
      if (w < 16 || h < 16) await createFrameAt(d.startX, d.startY, 1024, 720);
      else await createFrameAt(x, y, w, h);
      useStore.setState({ tool: "select" });
    } else if (d.kind === "marquee") {
      const x0 = Math.min(d.startX, d.x);
      const x1 = Math.max(d.startX, d.x);
      const y0 = Math.min(d.startY, d.y);
      const y1 = Math.max(d.startY, d.y);
      if (x1 - x0 > 4 || y1 - y0 > 4) {
        const hits = (s.doc?.frames ?? []).filter((f) => f.x < x1 && f.x + f.width > x0 && f.y < y1 && f.y + frameHeight(f) > y0).map((f) => f.id);
        s.select(d.additive ? [...new Set([...s.selection, ...hits])] : hits);
      }
    } else if (d.kind === "node-drag" && d.target) {
      const entry = s.index.get(d.id);
      if (entry?.parent) {
        const from = entry.parent.children.indexOf(entry.node);
        // index among siblings once the node itself is taken out
        const to = d.target.index > from ? d.target.index - 1 : d.target.index;
        if (to !== from) await s.run({ op: "move", canvas: s.canvas!, id: d.id, parent: d.target.parent, index: to });
      }
    } else if (d.kind === "click") {
      const moved = Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 3;
      if (!moved && !d.additive && s.selection.length > 1) s.select([d.id]);
    }
  };

  const clearOverride = (name: string) => setOverrides(({ [name]: _gone, ...rest }) => rest);

  const onDoubleClick = async (e: React.MouseEvent) => {
    const s = useStore.getState();
    if (s.tool !== "select") return;
    const hit = await updateHover(e.clientX, e.clientY);
    if (!hit) return;
    const node = s.index.get(hit.id)?.node;
    if (!node || node.id === hit.frame.id) return;
    s.select([hit.id]);
    if (textTarget(node)) useStore.setState({ editingText: hit.id });
  };

  const onContextMenu = async (e: React.MouseEvent) => {
    e.preventDefault();
    const s = useStore.getState();
    const hit = await updateHover(e.clientX, e.clientY);
    if (hit && !s.selection.includes(hit.id)) s.select([hit.id]);
    if (useStore.getState().selection.length) setMenu({ x: e.clientX, y: e.clientY });
  };

  // ---------- component drag & drop from the Components panel ----------
  const dragActive = useRef(false);
  type DropTarget = { frame: string; rect: Rect; parent: string; index?: number; label: string };

  const computeDrop = async (clientX: number, clientY: number): Promise<DropTarget | null | "stale"> => {
    const { x, y } = toWorld(clientX, clientY);
    const f = frameAt(x, y);
    if (!f) return null;
    const hit = await updateHover(clientX, clientY);
    if (!hit) return "stale";
    const s = useStore.getState();
    const entry = s.index.get(hit.id);
    const p = framePos(hit.frame);
    if (!entry || entry.node.id === hit.frame.id) {
      return { frame: hit.frame.frameName, rect: { x: 0, y: 0, width: p.width, height: p.height ?? frameHeight(hit.frame) }, parent: frameContainer(hit.frame), label: hit.frame.frameName };
    }
    const rect = s.rects[hit.id];
    if (!rect) return null;
    // drop into containers, otherwise after the hovered node
    if ((acceptsChildren(entry.node) && entry.node.kind === "element") || !entry.parent) {
      return { frame: hit.frame.frameName, rect, parent: hit.id, label: entry.node.name };
    }
    const index = entry.parent.children.findIndex((c) => c.id === hit.id) + 1;
    return { frame: hit.frame.frameName, rect: { x: rect.x, y: rect.y + rect.height - 1, width: rect.width, height: 2 }, parent: entry.parent.id, index, label: `after ${entry.node.name}` };
  };

  const onDragOver = async (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("application/x-truecanvas-component")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    dragActive.current = true;
    const target = await computeDrop(e.clientX, e.clientY);
    if (target === "stale" || !dragActive.current) return;
    setDrop(target);
  };

  const onDrop = async (e: React.DragEvent) => {
    const raw = e.dataTransfer.getData("application/x-truecanvas-component");
    if (!raw) return;
    e.preventDefault();
    dragActive.current = false;
    setDrop(null);
    let target = await computeDrop(e.clientX, e.clientY);
    if (target === "stale") target = await computeDrop(e.clientX, e.clientY);
    if (!target || target === "stale") return;
    const spec = JSON.parse(raw) as ComponentSpec & { insertProps?: Record<string, Literal> };
    const s = useStore.getState();
    await s.run({ op: "insert_component", canvas: s.canvas!, component: spec.name, parent: target.parent, index: target.index, props: spec.insertProps });
  };

  // ---------- visible frames (lazy iframes) ----------
  const frames = doc?.frames ?? [];
  const visible = useMemo(() => {
    const out = new Set<string>();
    const margin = 400;
    for (const f of frames) {
      const p = framePos(f);
      const h = p.height ?? frameHeight(f);
      const sx = camera.x + p.x * camera.zoom;
      const sy = camera.y + p.y * camera.zoom;
      if (sx + p.width * camera.zoom > -margin && sx < size.width + margin && sy + h * camera.zoom > -margin && sy < size.height + margin) out.add(f.frameName);
    }
    return out;
  }, [frames, camera, size, framePos]);
  const mounted = useRef(new Set<string>());
  for (const name of visible) mounted.current.add(name);
  // unmount frames that drifted far off-screen when there are many
  if (mounted.current.size > 12) for (const name of [...mounted.current]) if (!visible.has(name)) mounted.current.delete(name);

  const cursor = drag?.kind === "pan" ? "grabbing" : space || tool === "hand" ? "grab" : undefined;

  return (
    <div
      ref={vpRef}
      className={`viewport tool-${tool}${space ? " panning" : ""}`}
      tabIndex={-1}
      style={{ cursor, backgroundSize: `${Math.max(8, 20 * camera.zoom)}px ${Math.max(8, 20 * camera.zoom)}px`, backgroundPosition: `${camera.x}px ${camera.y}px` }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => !dragRef.current && useStore.getState().hover && useStore.setState({ hover: null })}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onDragOver={onDragOver}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        dragActive.current = false;
        setDrop(null);
      }}
      onDrop={onDrop}
    >
      <div className={`world${moving ? " moving" : ""}`} style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})` }}>
        {frames.map((f) => (
          <FrameView key={f.frameName} frame={f} pos={framePos(f)} mounted={mounted.current.has(f.frameName)} interactive={tool === "interact"} />
        ))}
        <CompareFrames />
      </div>
      <Overlay framePos={framePos} drag={drag} drop={drop} onResizeStart={(frame, edge, e) => beginDrag({ kind: "frame-resize", frame, edge, startX: e.clientX, startY: e.clientY })} onLabelDown={(frame, e) => {
        e.stopPropagation();
        if (e.button !== 0) return;
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        const s = useStore.getState();
        if (e.shiftKey) s.select(s.selection.includes(frame.id) ? s.selection.filter((i) => i !== frame.id) : [...s.selection, frame.id]);
        else s.select([frame.id]);
        beginDrag({ kind: "frame-move", frame, startX: e.clientX, startY: e.clientY, moved: false });
      }} />
      {doc && !doc.error && doc.frames.length === 0 && (
        <div className="empty-canvas">
          <div style={{ fontWeight: 600, color: "var(--text)" }}>An empty canvas</div>
          <div>
            Press <span className="kbd-chip">F</span> and drag to draw a frame, or ask your agent to build a screen.
          </div>
        </div>
      )}
      {menu && <CanvasMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} />}
    </div>
  );
}

/** Which text a double-click edits: text children, or a title-like string prop. */
export function textTarget(node: import("../lib/api").CanvasNode): { kind: "text"; value: string } | { kind: "prop"; prop: string; value: string } | null {
  if (node.kind === "text") return { kind: "text", value: node.text ?? "" };
  if (node.kind !== "component" && node.kind !== "element") return null;
  if (node.children.length && node.children.every((c) => c.kind === "text")) return { kind: "text", value: node.children.map((c) => c.text).join(" ") };
  for (const prop of ["title", "label", "text", "name", "placeholder"]) {
    const v = node.props[prop];
    if (v?.kind === "string") return { kind: "prop", prop, value: v.value };
  }
  return null;
}

// ---------- a single frame ----------

const FrameView = memo(function FrameView({ frame, pos, mounted, interactive }: { frame: CanvasFrame; pos: Override; mounted: boolean; interactive: boolean }) {
  const appUrl = useStore((s) => s.appUrl);
  const canvas = useStore((s) => s.canvas);
  const canvasTheme = useStore((s) => s.canvasTheme);
  const measured = useStore((s) => s.frameHeights[frame.frameName]);
  const ready = useStore((s) => s.frameReady[frame.frameName]);
  const error = useStore((s) => s.frameErrors[frame.frameName]);
  const appStatus = useStore((s) => s.appStatus);
  const theme = effectiveTheme(frame, canvasTheme);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  // the theme in the URL only matters for the first paint; later changes are sent as messages
  const initialTheme = useRef(theme);
  const src = useMemo(
    () =>
      `${appUrl}/truecanvas/${encodeURIComponent(canvas ?? "")}?frame=${encodeURIComponent(frame.frameName)}&theme=${initialTheme.current}&editor=${encodeURIComponent(location.origin)}`,
    [appUrl, canvas, frame.frameName],
  );
  const motionPaused = useStore((s) => s.motionPaused);
  const deviceChrome = useStore((s) => s.deviceChrome);
  const playing = useStore((s) => s.playing === frame.frameName);
  const wasPlaying = useRef(false);
  useEffect(() => {
    if (!ready || wasPlaying.current === playing) return;
    wasPlaying.current = playing;
    send(frame.frameName, { type: "tc:play", on: playing });
  }, [playing, ready, frame.frameName]);
  useEffect(() => {
    if (ready) send(frame.frameName, { type: "tc:theme", theme });
  }, [theme, ready, frame.frameName]);
  useEffect(() => {
    if (ready) send(frame.frameName, { type: "tc:motion", paused: motionPaused });
  }, [motionPaused, ready, frame.frameName]);
  const hiddenKeys = useStore((s) => s.hidden);
  const index = useStore((s) => s.index);
  const hiddenIds = useMemo(() => {
    const ids: string[] = [];
    for (const [id, e] of index) if (e.frame.frameName === frame.frameName && id !== e.frame.id && hiddenKeys.has(layerKey(e.node))) ids.push(id);
    return ids.sort().join(",");
  }, [hiddenKeys, index, frame.frameName]);
  useEffect(() => {
    if (ready) send(frame.frameName, { type: "tc:hidden", ids: hiddenIds ? hiddenIds.split(",").map(rawId) : [] });
  }, [hiddenIds, ready, frame.frameName]);
  const device = findDevice(frame.device);
  const chrome = deviceChrome && device && device.kind !== "desktop" ? device : null;

  const height = pos.height ?? (playing ? playHeight(frame) : (measured ?? 360));
  const dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  return (
    <div
      className={`frame-box${dark ? " dark" : ""}${chrome ? " device" : ""}${playing ? " playing" : ""}`}
      style={{ left: pos.x, top: pos.y, width: pos.width, height, borderRadius: chrome ? chrome.radius : undefined }}
    >
      {mounted && appStatus !== "down" && (
        <iframe
          ref={(el) => {
            iframeRef.current = el;
            registerFrame(frame.frameName, el);
          }}
          title={frame.frameName}
          src={src}
          style={{ pointerEvents: interactive || playing ? "auto" : "none" }}
          onLoad={() => setTimeout(() => void refreshRects(new Set([frame.frameName])), 50)}
        />
      )}
      {chrome && <DeviceChrome device={chrome} dark={dark} />}
      {(!ready || !mounted) && <div className="placeholder">{appStatus === "down" ? "Waiting for the app…" : ""}</div>}
      {error && (
        <div className="frame-error">
          <strong>Render error · </strong>
          {error}
        </div>
      )}
    </div>
  );
});

/** Status bar, dynamic island and home indicator, drawn over the frame (not part of your app). */
function DeviceChrome({ device, dark }: { device: Device; dark: boolean }) {
  const ink = dark ? "#fff" : "#000";
  return (
    <div className="device-chrome" aria-hidden>
      {device.statusBar > 0 && (
        <div className="status-bar" style={{ height: device.statusBar, color: ink, padding: device.island ? "0 32px 0 46px" : "0 20px" }}>
          <span className="time">9:41</span>
          {device.island && <span className="island" />}
          <span className="icons">
            <svg width="18" height="11" viewBox="0 0 18 11" fill={ink}>
              <rect x="0" y="7" width="3" height="4" rx="1" />
              <rect x="5" y="5" width="3" height="6" rx="1" />
              <rect x="10" y="2.5" width="3" height="8.5" rx="1" />
              <rect x="15" y="0" width="3" height="11" rx="1" />
            </svg>
            <svg width="16" height="11" viewBox="0 0 16 11" fill={ink}>
              <path d="M8 2.2c2.3 0 4.4.9 6 2.4l1.1-1.2A10.2 10.2 0 0 0 8 .5C5.3.5 2.8 1.5.9 3.4L2 4.6a8.6 8.6 0 0 1 6-2.4zm0 3.3c1.4 0 2.6.5 3.6 1.4l1.1-1.2A7 7 0 0 0 8 3.8a7 7 0 0 0-4.7 1.9l1.1 1.2c1-.9 2.2-1.4 3.6-1.4zm0 3.3c.5 0 1 .2 1.3.5L8 10.8 6.7 9.3c.3-.3.8-.5 1.3-.5z" />
            </svg>
            <svg width="26" height="12" viewBox="0 0 26 12" fill="none">
              <rect x=".5" y=".5" width="22" height="11" rx="3.5" stroke={ink} strokeOpacity=".4" />
              <rect x="2" y="2" width="19" height="8" rx="2" fill={ink} />
              <path d="M24 4v4c.8-.3 1.3-1.1 1.3-2S24.8 4.3 24 4z" fill={ink} fillOpacity=".5" />
            </svg>
          </span>
        </div>
      )}
      {device.homeIndicator > 0 && (
        <div className="home-indicator" style={{ height: device.homeIndicator }}>
          <span style={{ background: ink, width: device.kind === "tablet" ? 300 : 134 }} />
        </div>
      )}
    </div>
  );
}

// ---------- overlay: labels, hover/selection boxes, handles ----------

function Overlay({
  framePos,
  drag,
  drop,
  onResizeStart,
  onLabelDown,
}: {
  framePos: (f: CanvasFrame) => Override;
  drag: Drag | null;
  drop: { frame: string; rect: Rect; label: string } | null;
  onResizeStart: (f: CanvasFrame, edge: "e" | "s" | "se" | "w", e: React.PointerEvent) => void;
  onLabelDown: (f: CanvasFrame, e: React.PointerEvent) => void;
}) {
  const doc = useStore((s) => s.doc);
  const camera = useStore((s) => s.camera);
  const selection = useStore((s) => s.selection);
  const hover = useStore((s) => s.hover);
  const rects = useStore((s) => s.rects);
  const index = useStore((s) => s.index);
  const tool = useStore((s) => s.tool);
  const review = useStore((s) => s.review);
  const flashes = useStore((s) => s.flashes);
  const editingText = useStore((s) => s.editingText);
  const compare = useStore((s) => s.compare);
  useStore((s) => s.frameHeights);
  const z = camera.zoom;

  const toScreen = (f: CanvasFrame, r: Rect) => {
    const p = framePos(f);
    return { left: camera.x + (p.x + r.x) * z, top: camera.y + (p.y + r.y) * z, width: r.width * z, height: r.height * z };
  };
  const frameScreen = (f: CanvasFrame) => {
    const p = framePos(f);
    const h = p.height ?? frameHeight(f);
    return { left: camera.x + p.x * z, top: camera.y + p.y * z, width: p.width * z, height: h * z };
  };

  if (!doc) return null;
  const showBoxes = tool !== "interact";
  const dirty = new Set(review.find((p) => p.canvas === doc.name)?.frames.filter((fr) => fr.status !== "removed").map((fr) => fr.name) ?? []);
  const hoverEntry = hover ? index.get(hover) : null;

  return (
    <div className="overlay">
      {doc.frames.map((f) => {
        const b = frameScreen(f);
        const selected = selection.includes(f.id);
        return (
          <div key={f.id} className={`frame-label${selected ? " selected" : ""}`} style={{ left: b.left, top: b.top - 20, maxWidth: Math.max(40, b.width) }} onPointerDown={(e) => onLabelDown(f, e)}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{f.frameName}</span>
            {f.theme && <span className="theme-tag">{f.theme === "dark" ? <Moon size={11} /> : <Sun size={11} />}</span>}
            {f.device && <span className="theme-tag">{findDevice(f.device)?.name}</span>}
            {dirty.has(f.frameName) && <span className="change-dot" title="Changed since the last commit" />}
            <LinkTag frame={f} compact={b.width < 220} />
            <PlayControls frame={f} compact={b.width < 260} />
            {(() => {
              const b = changeBadge(f.frameName);
              return b && <span className={`change-badge ${b.tone}`}>{b.text}</span>;
            })()}
          </div>
        );
      })}
      {compare &&
        compare.doc.frames
          .filter(() => compare.mode === "side")
          .map((f) => {
            const p = comparePlacement(f);
            return (
              <div key={`cmp-${f.frameName}`} className="frame-label compare-label" style={{ left: camera.x + p.x * z, top: camera.y + p.y * z - 20, maxWidth: Math.max(40, p.width * z) }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{f.frameName}</span>
                <span className={`change-badge ${compare.changes[f.frameName] === "removed" ? "removed" : "before"}`}>{compare.changes[f.frameName] === "removed" ? `Removed · ${compare.label}` : compare.changes[f.frameName] === "same" ? `${compare.label} · same` : compare.label}</span>
              </div>
            );
          })}

      {showBoxes && hoverEntry && !selection.includes(hoverEntry.node.id) && (() => {
        if (hoverEntry.node.id === hoverEntry.frame.id) {
          const b = frameScreen(hoverEntry.frame);
          return <div className="box hover" style={b} />;
        }
        const r = rects[hoverEntry.node.id];
        if (!r) return null;
        return <div className={`box hover`} style={toScreen(hoverEntry.frame, r)} />;
      })()}

      {showBoxes &&
        selection.map((id) => {
          const e = index.get(id);
          if (!e) return null;
          if (e.node.id === e.frame.id) {
            const b = frameScreen(e.frame);
            const p = framePos(e.frame);
            return (
              <div key={id} className="box frame-select" style={b}>
                {selection.length === 1 && (
                  <>
                    <div className="edge" style={{ right: -4, top: 0, bottom: 0, width: 8, cursor: "ew-resize" }} onPointerDown={(ev) => resizeDown(ev, e.frame, "e")} />
                    <div className="edge" style={{ left: -4, top: 0, bottom: 0, width: 8, cursor: "ew-resize" }} onPointerDown={(ev) => resizeDown(ev, e.frame, "w")} />
                    <div className="edge" style={{ bottom: -4, left: 0, right: 0, height: 8, cursor: "ns-resize" }} onPointerDown={(ev) => resizeDown(ev, e.frame, "s")} />
                    <div className="handle" style={{ right: -5, bottom: -5, cursor: "nwse-resize" }} onPointerDown={(ev) => resizeDown(ev, e.frame, "se")} />
                    <div className="handle" style={{ right: -5, top: -5 }} />
                    <div className="handle" style={{ left: -5, bottom: -5 }} />
                    <div className="handle" style={{ left: -5, top: -5 }} />
                    <div className="size-badge" style={{ left: "50%", top: b.height + 8 }}>
                      {Math.round(p.width)} × {Math.round(p.height ?? frameHeight(e.frame))}
                      {p.height === null ? " Hug" : ""}
                    </div>
                  </>
                )}
              </div>
            );
          }
          const r = rects[id];
          if (!r) return null;
          const b = toScreen(e.frame, r);
          const comp = e.node.kind === "component";
          return (
            <div key={id} className={`box select${comp ? " component" : ""}`} style={b}>
              {selection.length === 1 && editingText !== id && (
                <>
                  <div className={`name-tag${comp ? " component" : ""}`} style={{ left: -0.75, top: -1 }}>
                    {layerName(e.node)}
                  </div>
                  <div className={`size-badge${comp ? " component" : ""}`} style={{ left: "50%", top: b.height + 6 }}>
                    {Math.round(r.width)} × {Math.round(r.height)}
                  </div>
                </>
              )}
            </div>
          );
        })}

      {flashes.map((fl) => {
        const e = index.get(fl.id);
        const r = e && (e.node.id === e.frame.id ? { x: 0, y: 0, width: e.frame.width, height: frameHeight(e.frame) } : rects[fl.id]);
        if (!e || !r) return null;
        const b = toScreen(e.frame, r);
        return <div key={fl.key} className="box flash" style={{ ...b, ["--c" as string]: fl.color }} />;
      })}

      {drop && (() => {
        const f = doc.frames.find((x) => x.frameName === drop.frame);
        if (!f) return null;
        return <div className="drop-target" style={toScreen(f, drop.rect)} />;
      })()}

      {drag?.kind === "node-drag" && drag.target && <div className="drop-line" style={toScreen(drag.frame, drag.target.line)} />}

      {(drag?.kind === "draw" || drag?.kind === "marquee") && (
        <div
          className="marquee"
          style={{
            left: camera.x + Math.min(drag.startX, drag.x) * z,
            top: camera.y + Math.min(drag.startY, drag.y) * z,
            width: Math.abs(drag.x - drag.startX) * z,
            height: Math.abs(drag.y - drag.startY) * z,
          }}
        />
      )}

      {editingText && <InlineText id={editingText} toScreen={toScreen} />}

      <CommentLayer camera={camera} framePos={framePos} />
      <AgentCursors camera={camera} framePos={framePos} />
    </div>
  );

  function resizeDown(e: React.PointerEvent, f: CanvasFrame, edge: "e" | "s" | "se" | "w") {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    onResizeStart(f, edge, e);
  }
}

function InlineText({ id, toScreen }: { id: string; toScreen: (f: CanvasFrame, r: Rect) => { left: number; top: number; width: number; height: number } }) {
  const entry = useStore((s) => s.index.get(id));
  const rect = useStore((s) => s.rects[id]);
  const target = entry ? textTarget(entry.node) : null;
  const [value, setValue] = useState(target?.value ?? "");
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  if (!entry || !rect || !target) return null;
  const b = toScreen(entry.frame, rect);
  const close = () => useStore.setState({ editingText: null });
  const commit = async () => {
    close();
    if (value === target.value) return;
    const s = useStore.getState();
    if (target.kind === "text") await s.run({ op: "set_text", canvas: s.canvas!, id, text: value });
    else await s.run({ op: "set_props", canvas: s.canvas!, id, props: { [target.prop]: value } });
  };
  return (
    <div className="inline-edit" style={{ left: b.left - 4, top: b.top - 4, width: Math.max(220, b.width + 8) }} onPointerDown={(e) => e.stopPropagation()}>
      <textarea
        ref={ref}
        value={value}
        rows={Math.min(5, Math.max(1, Math.ceil(value.length / 40)))}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void commit();
          }
          if (e.key === "Escape") close();
        }}
      />
    </div>
  );
}

const fileName = (p: string) => p.split("/").pop() ?? p;

/** ▶ on a frame's label; while playing: Replay and Stop. */
function PlayControls({ frame: f, compact }: { frame: CanvasFrame; compact: boolean }) {
  const playing = useStore((s) => s.playing === f.frameName);
  const stop = (e: React.PointerEvent) => e.stopPropagation();
  if (!playing)
    return (
      <button className="label-btn play-btn" title="Play: scroll inside the frame to run scroll animations" aria-label={`Play ${f.frameName}`} onPointerDown={stop} onClick={() => playFrame(f.frameName)}>
        <Play size={10} />
      </button>
    );
  return (
    <span className="play-controls" onPointerDown={stop}>
      <span className="playing-tag">
        <span className="live-dot" />
        {compact ? "" : "Playing · scroll inside"}
      </span>
      <button className="label-btn" title="Replay entrance animations" aria-label="Replay" onClick={() => replayFrame(f.frameName)}>
        <RotateCcw size={10} />
      </button>
      <button className="label-btn" title="Stop (Esc)" aria-label="Stop playing" onClick={() => playFrame(null)}>
        <StopIcon size={9} fill="currentColor" />
      </button>
    </span>
  );
}

/** "Live · page.tsx" on linked frames, "Exploration" on copies of a page. */
function LinkTag({ frame: f, compact }: { frame: CanvasFrame; compact: boolean }) {
  if (f.link?.kind === "component") {
    return (
      <span className={`link-tag component${f.link.editable ? "" : " view"}`} title={f.link.editable ? `Main component ${f.link.route} in ${f.link.page}. Edits change every instance.` : (f.link.reason ?? "")}>
        <Component size={10} />
        {!compact && `Main component · ${fileName(f.link.page)}`}
      </span>
    );
  }
  if (f.link) {
    const tip = f.link.editable ? `Linked to ${f.link.files.join(" and ")}. Editing its layers edits the code.` : `View only: ${f.link.reason ?? ""}`;
    return (
      <span className={`link-tag${f.link.editable ? "" : " view"}${compact ? " compact" : ""}`} title={tip}>
        {f.link.editable ? <span className="live-dot" /> : <Eye size={10} />}
        {!compact && `${f.link.editable ? "Live" : "View only"} · ${fileName(f.link.page)}`}
      </span>
    );
  }
  if (f.from)
    return (
      <span className={`link-tag draft${compact ? " compact" : ""}`} title={`Copy of ${f.from}. Right-click → Apply to page to write it back.`}>
        <FlaskConical size={10} />
        {!compact && "Exploration"}
      </span>
    );
  return null;
}

/** The right-click menu for the selection: on the canvas and in the Layers panel (which adds `extra` on top). */
export function CanvasMenu({ x, y, onClose, extra = [] }: { x: number; y: number; onClose: () => void; extra?: (MenuItem | "sep")[] }) {
  const s = useStore.getState();
  const single = s.selection.length === 1 ? s.index.get(s.selection[0]) : null;
  const isFrame = single && single.node.id === single.frame.id;
  const frame = single?.frame;
  const items: (MenuItem | "sep")[] = [
    ...(frame?.link
      ? [
          { label: "Explore a copy", icon: <FlaskConical size={14} />, onSelect: () => void exploreCopy(frame.id) },
          { label: `Open ${fileName(frame.link.page)}`, icon: <FileCode2 size={14} />, onSelect: () => void api.openFile(frame.link!.page).catch((e) => s.toast((e as Error).message)) },
          "sep" as const,
        ]
      : []),
    ...(frame
      ? [
          { label: `Play ${frame.frameName}`, icon: <Play size={14} />, onSelect: () => playFrame(frame.frameName) },
          { label: "Replay animations", icon: <RotateCcw size={14} />, onSelect: () => replayFrame(frame.frameName) },
          "sep" as const,
        ]
      : []),
    ...(frame?.from && isFrame ? [{ label: `Apply to ${fileName(frame.from)}`, icon: <ArrowUpFromLine size={14} />, onSelect: () => void applyToPage(frame.id) }, "sep" as const] : []),
    { label: "Duplicate", icon: <CopyPlus size={14} />, kbd: kbd.dup, onSelect: duplicateSelection },
    ...(!isFrame ? [{ label: "Wrap in auto layout", icon: <LayoutList size={14} />, kbd: "⇧A", onSelect: wrapSelection }] : []),
    ...(single?.parent ? [{ label: "Select parent", icon: <CornerLeftUp size={14} />, kbd: "⇧Enter", onSelect: selectParent }] : []),
    "sep",
    { label: "Copy as JSX", icon: <Copy size={14} />, kbd: kbd.copy, onSelect: () => void copySelectionCode() },
    { label: "Show this layer in code", icon: <ExternalLink size={14} />, onSelect: () => openInEditor(single?.node.id) },
    ...(single && single.node.kind === "component" && s.components.some((c) => c.name === single.node.name && !c.library)
      ? [
          { label: `Edit ${single.node.name} (main component)`, icon: <Component size={14} />, onSelect: () => void editComponent(single.node.name) },
          { label: `Open ${single.node.name} in code editor`, icon: <Code2 size={14} />, onSelect: () => goToComponent(single.node.name) },
        ]
      : []),
    ...(single && !isFrame && (single.node.kind === "element" || single.node.kind === "component" || single.node.kind === "fragment")
      ? [{ label: "Create component", icon: <Component size={14} />, kbd: `${kbd.mod}⌥K`, onSelect: () => openComponentDialog(true) }]
      : []),
    "sep",
    { label: "Delete", icon: <Trash2 size={14} />, kbd: "Del", danger: true, onSelect: deleteSelection },
  ];
  return <Menu x={x} y={y} items={extra.length ? [...extra, "sep", ...items] : items} onClose={onClose} />;
}

export function goToComponent(name: string) {
  const s = useStore.getState();
  const spec = s.components.find((c) => c.name === name);
  if (spec) void api.openFile(spec.file).catch((e) => s.toast((e as Error).message));
}

export function FrameErrorBadge() {
  return <AlertTriangle size={12} />;
}
