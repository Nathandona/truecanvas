import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore, isLockedDeep, layerName, type Rect } from "../lib/store";
import { hitTest, installBridge, measure, onFrameWheel } from "../lib/bridge";
import { readLayout } from "../lib/classes";
import { acceptsChildren, frameContainer, createFrameAt, frameHeight, setCamera, setViewportSize, zoomBy, stopAutoFit } from "../lib/actions";
import { type CanvasFrame, type ComponentSpec, type Literal } from "../lib/api";
import { CompareFrames } from "./Compare";
import { commentTarget } from "./Comments";
import { FrameView } from "./FrameView";
import { useCanvasKeyboard } from "./useCanvasKeyboard";
import type { Drag, Override, Reorder } from "./canvasShared";
import { Overlay, textTarget } from "./CanvasOverlay";
import { CanvasMenu } from "./CanvasMenu";

export function CanvasView() {
  const doc = useStore((s) => s.doc);
  const camera = useStore((s) => s.camera);
  const tool = useStore((s) => s.tool);
  const vpRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const [overrides, setOverridesState] = useState<Record<string, Override>>({});
  // pointerup reads the latest values, not the ones from its render
  const overridesRef = useRef(overrides);
  const setOverrides = (fn: (o: Record<string, Override>) => Record<string, Override>) =>
    setOverridesState((prev) => {
      const next = fn(prev);
      overridesRef.current = next;
      return next;
    });
  // set on pointerdown, cleared on pointerup: async work after pointerdown checks it before starting a drag
  const pressed = useRef(false);
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
  const hoverRaf = useRef(0);
  const hoverAt = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => () => cancelAnimationFrame(hoverRaf.current), []);
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
      // only a different hover target or a rect that really moved updates the store
      const changed = res ? Object.entries(res.rects).filter(([k, r]) => !sameRect(s.rects[k], r)) : [];
      if (changed.length) useStore.setState({ hover: id, rects: { ...s.rects, ...Object.fromEntries(changed) } });
      else if (s.hover !== id) useStore.setState({ hover: id });
      return { id, frame: f, chain: (res?.chain ?? []).filter((c) => s.index.has(c)) };
    },
    [frameAt, framePos, toWorld],
  );

  // ---------- wheel: pan & zoom (also forwarded from frames in interact mode) ----------
  const onWheelLike = useCallback((e: { dx: number; dy: number; ctrl: boolean; clientX: number; clientY: number; mode: number }) => {
    stopAutoFit();
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
  useCanvasKeyboard(setSpace);

  // ---------- pointer ----------
  const beginDrag = (d: Drag) => {
    dragRef.current = d;
    setDrag(d);
  };

  const onPointerDown = async (e: React.PointerEvent) => {
    if (menu) return;
    stopAutoFit();
    pressed.current = true;
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
    // released while the hit test ran: it was a click, so select but don't start a drag
    const still = pressed.current;
    if (hit.id === f.id) {
      // empty frame area: select the frame and allow dragging it
      if (!e.shiftKey) s.select([f.id]);
      if (still) beginDrag({ kind: "frame-move", frame: f, startX: e.clientX, startY: e.clientY, moved: false });
      return;
    }
    if (still) beginDrag({ kind: "click", id: hit.id, startX: e.clientX, startY: e.clientY, additive: e.shiftKey });
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
      if ((t === "select" || t === "comment") && !space) {
        // one hit test per frame, with the latest pointer position
        hoverAt.current = { x: e.clientX, y: e.clientY };
        if (!hoverRaf.current)
          hoverRaf.current = requestAnimationFrame(() => {
            hoverRaf.current = 0;
            const p = hoverAt.current;
            if (p) void updateHover(p.x, p.y);
          });
      }
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
    pressed.current = false;
    const d = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (!d) return;
    const s = useStore.getState();
    if (d.kind === "frame-move" && d.moved) {
      const o = overridesRef.current[d.frame.frameName];
      if (o) await s.run({ op: "update_frame", canvas: s.canvas!, frame: d.frame.frameName, x: o.x, y: o.y });
      clearOverride(d.frame.frameName);
    } else if (d.kind === "frame-resize") {
      const o = overridesRef.current[d.frame.frameName];
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
    const measuredHeights = useStore.getState().frameHeights;
    for (const f of frames) {
      const p = framePos(f);
      // a page not measured yet is probably tall: load it when we're anywhere below its top,
      // not only when its first 360px are on screen
      const unknown = p.height === null && f.height === null && measuredHeights[f.frameName] === undefined;
      const h = unknown ? 20_000 : (p.height ?? frameHeight(f));
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
          // primitives, not a fresh object: FrameView's memo holds while the camera moves
          <FrameView key={f.frameName} frame={f} {...framePos(f)} mounted={mounted.current.has(f.frameName)} interactive={tool === "interact"} />
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
type Box = { x: number; y: number; width: number; height: number } | null | undefined;
/** Same measured rect (null: the layer isn't rendered). */
function sameRect(a: Box, b: Box) {
  if (!a || !b) return a === b;
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}
