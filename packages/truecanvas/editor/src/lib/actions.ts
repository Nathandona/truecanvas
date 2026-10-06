import { api, findDevice, type CanvasFrame, type CanvasNode, type ComponentSpec, type Literal } from "./api";
import { refreshRects, send } from "./bridge";
import { fromServer, rawId } from "./scope";
import { persist, useStore, type Camera } from "./store";

// Editor-level actions shared by the canvas, panels, menus and shortcuts.

const mod = navigator.platform.includes("Mac") ? "⌘" : "Ctrl+";
export const kbd = {
  mod,
  dup: `${mod}D`,
  undo: `${mod}Z`,
  redo: navigator.platform.includes("Mac") ? "⇧⌘Z" : "Ctrl+Shift+Z",
  copy: `${mod}C`,
};

export let viewportSize = { width: 1200, height: 800 };
export function setViewportSize(w: number, h: number) {
  viewportSize = { width: w, height: h };
}

export function frameHeight(f: CanvasFrame) {
  const s = useStore.getState();
  if (s.playing === f.frameName) return playHeight(f);
  return f.height ?? s.frameHeights[f.frameName] ?? 360;
}

/** A playing frame is one screen tall: its fixed height, its device's, or a laptop screen. */
export function playHeight(f: CanvasFrame) {
  return f.height ?? findDevice(f.device)?.height ?? 900;
}

/** Play a frame: scroll inside it and watch scroll-triggered animations like on the site. */
export function playFrame(name: string | null) {
  const s = useStore.getState();
  // selection boxes inside a scrolling page would drift: leave them out while playing
  if (name) {
    const sel = s.selection.filter((id) => s.index.get(id)?.frame.frameName !== name);
    useStore.setState({ playing: name, selection: sel, hover: null });
  } else useStore.setState({ playing: null });
}

/** Run a frame's entrance animations again (remounts the page in the frame). */
export function replayFrame(name: string) {
  send(name, { type: "tc:replay" });
}

let cameraSave = 0;
export function setCamera(cam: Camera) {
  useStore.setState({ camera: cam });
  const canvas = useStore.getState().canvas;
  if (!canvas) return;
  // panning fires this on every wheel tick: save once the camera settles
  clearTimeout(cameraSave);
  cameraSave = window.setTimeout(() => persist(`tc:camera:${canvas}`, cam), 300);
}

export function fitBounds(b: { x: number; y: number; width: number; height: number }, maxZoom = 1, pad = 72) {
  const { width, height } = viewportSize;
  const zoom = Math.min(maxZoom, (width - pad * 2) / Math.max(1, b.width), (height - pad * 2 - 40) / Math.max(1, b.height));
  const z = Math.max(0.05, zoom);
  setCamera({ zoom: z, x: width / 2 - (b.x + b.width / 2) * z, y: (height - 40) / 2 - (b.y + b.height / 2) * z });
}

export function framesBounds(frames: CanvasFrame[]) {
  if (!frames.length) return { x: 0, y: 0, width: 800, height: 600 };
  const xs = frames.map((f) => f.x);
  const ys = frames.map((f) => f.y);
  const xe = frames.map((f) => f.x + f.width);
  const ye = frames.map((f) => f.y + frameHeight(f));
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xe) - x, height: Math.max(...ye) - y };
}

// ---------- opening a canvas: known sizes, and a camera that shows something ----------

const heightsKey = (canvas: string) => `tc:heights:${canvas}`;

/** Hug frames' last measured heights: frames open at their real size instead of growing from a stub. */
export function cachedHeights(canvas: string): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(heightsKey(canvas)) ?? "{}") as Record<string, number>;
  } catch {
    return {};
  }
}

let heightsSave = 0;
export function rememberHeights() {
  const { canvas, frameHeights } = useStore.getState();
  if (!canvas) return;
  clearTimeout(heightsSave);
  heightsSave = window.setTimeout(() => persist(heightsKey(canvas), frameHeights), 500);
}

/** Does this camera show any part of any frame? */
export function cameraShowsFrames(cam: Camera, frames: CanvasFrame[]): boolean {
  const { width, height } = viewportSize;
  return frames.some((f) => {
    const sx = cam.x + f.x * cam.zoom;
    const sy = cam.y + f.y * cam.zoom;
    return sx + f.width * cam.zoom > 0 && sx < width && sy + frameHeight(f) * cam.zoom > 0 && sy < height;
  });
}

/**
 * After an automatic fit on open, fit again as real heights arrive (a 360px
 * stub becoming an 8000px page), until the user moves the camera themselves.
 */
let autoFit = false;
export function startAutoFit() {
  autoFit = true;
  zoomToFit();
  // only the first seconds of a canvas: later layout changes never move the camera
  setTimeout(() => (autoFit = false), 6000);
}
export function stopAutoFit() {
  autoFit = false;
}
export function refitIfAuto() {
  if (autoFit) zoomToFit();
}

export function zoomToFit() {
  const doc = useStore.getState().doc;
  if (doc) fitBounds(framesBounds(doc.frames));
}

export function zoomToSelection() {
  const s = useStore.getState();
  const boxes: { x: number; y: number; width: number; height: number }[] = [];
  for (const id of s.selection) {
    const e = s.index.get(id);
    if (!e) continue;
    if (e.node.id === e.frame.id) boxes.push({ x: e.frame.x, y: e.frame.y, width: e.frame.width, height: frameHeight(e.frame) });
    else {
      const r = s.rects[id];
      if (r) boxes.push({ x: e.frame.x + r.x, y: e.frame.y + r.y, width: r.width, height: r.height });
    }
  }
  if (!boxes.length) return zoomToFit();
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  fitBounds({ x, y, width: Math.max(...boxes.map((b) => b.x + b.width)) - x, height: Math.max(...boxes.map((b) => b.y + b.height)) - y }, 2, 96);
}

export function zoomBy(factor: number, center?: { x: number; y: number }) {
  const { camera } = useStore.getState();
  const c = center ?? { x: viewportSize.width / 2, y: viewportSize.height / 2 };
  const zoom = Math.min(8, Math.max(0.05, camera.zoom * factor));
  const k = zoom / camera.zoom;
  setCamera({ zoom, x: c.x - (c.x - camera.x) * k, y: c.y - (c.y - camera.y) * k });
}

export function zoomTo(zoom: number) {
  zoomBy(zoom / useStore.getState().camera.zoom);
}

// ---------- editing ----------

const canvasName = () => useStore.getState().canvas!;

export function selectionNodes(): CanvasNode[] {
  const s = useStore.getState();
  return s.selection.map((id) => s.index.get(id)?.node).filter(Boolean) as CanvasNode[];
}

export const duplicateSelection = () => {
  const ids = useStore.getState().selection;
  if (ids.length) void useStore.getState().run({ op: "duplicate", canvas: canvasName(), ids });
};

export const deleteSelection = () => {
  const s = useStore.getState();
  if (!s.selection.length) return;
  const parents = s.selection.map((id) => s.index.get(id)?.parent?.id).filter(Boolean) as string[];
  void s.run({ op: "delete", canvas: canvasName(), ids: s.selection }, { select: false }).then((ok) => {
    if (ok) useStore.getState().select(parents.slice(0, 1).filter((id) => useStore.getState().index.has(id)));
  });
};

export const wrapSelection = () => {
  const s = useStore.getState();
  const ids = s.selection.filter((id) => s.index.get(id)?.parent);
  if (ids.length) void s.run({ op: "wrap", canvas: canvasName(), ids });
};

export const reorderSelection = (delta: number) => {
  const s = useStore.getState();
  if (s.selection.length !== 1) return;
  const e = s.index.get(s.selection[0]);
  if (!e?.parent) return;
  void s.run({ op: "reorder", canvas: canvasName(), id: e.node.id, delta });
};

export const selectParent = () => {
  const s = useStore.getState();
  const id = s.selection[0];
  if (!id) return;
  const parent = s.index.get(id)?.parent;
  s.select(parent ? [parent.id] : []);
};

export const selectChild = () => {
  const s = useStore.getState();
  const node = s.index.get(s.selection[0])?.node;
  const child = node?.children.find((c) => c.kind === "component" || c.kind === "element");
  if (child) s.select([child.id]);
};

export async function copySelectionCode() {
  const s = useStore.getState();
  if (!s.canvas || !s.selection.length) return;
  const parts = await Promise.all(s.selection.map((id) => api.source(s.canvas!, rawId(id)).then((r) => r.code)));
  await navigator.clipboard.writeText(parts.join("\n"));
  s.toast(`Copied JSX of ${parts.length === 1 ? "1 layer" : `${parts.length} layers`}`, "info");
}

export function openInEditor(id?: string) {
  const s = useStore.getState();
  if (s.canvas) api.open(s.canvas, id && rawId(id)).catch((e) => s.toast((e as Error).message));
}

/** Linked frame → a free copy next to it, in the canvas file. */
export async function exploreCopy(frameId: string) {
  const s = useStore.getState();
  if (!s.canvas) return;
  const ids = await s.run({ op: "explore_copy", canvas: s.canvas, frame: frameId });
  if (ids?.length) {
    s.toast("Exploration created. Edits here stay in the canvas until you apply them to the page.", "info");
    setTimeout(zoomToSelection, 400);
  }
}

/** Exploration → write it back to its page file. */
export async function applyToPage(frameId: string) {
  const s = useStore.getState();
  if (!s.canvas) return;
  const frame = s.doc?.frames.find((f) => f.id === frameId);
  const ids = await s.run({ op: "apply_to_page", canvas: s.canvas, frame: frameId });
  if (ids) s.toast(`Applied to ${frame?.from ?? "the page"}. Undo with ${kbd.undo} if it's not right.`, "info");
}

/** Where a new component should go given the current selection. */
export function insertionPoint(): { parent: string; index?: number } | null {
  const s = useStore.getState();
  const doc = s.doc;
  if (!doc) return null;
  const sel = s.index.get(s.selection[0]);
  if (sel) {
    const n = sel.node;
    if (n.id === sel.frame.id) return { parent: frameContainer(n) };
    if (acceptsChildren(n) && n.children.some((c) => c.kind === "component" || c.kind === "element")) return { parent: n.id };
    if (sel.parent) return { parent: sel.parent.id, index: sel.parent.children.findIndex((c) => c.id === n.id) + 1 };
  }
  const first = doc.frames[0];
  return first ? { parent: frameContainer(first) } : null;
}

/** Frames usually have one root layout <div>: content goes inside it. */
export function frameContainer(frame: CanvasNode): string {
  const kids = frame.children.filter((c) => c.kind !== "text");
  if (kids.length === 1 && kids[0].kind === "element" && acceptsChildren(kids[0])) return kids[0].id;
  return frame.id;
}

export function acceptsChildren(n: CanvasNode): boolean {
  if (n.kind === "element") return !/^(img|input|br|hr|textarea|select)$/.test(n.name);
  if (n.kind === "component") {
    if (n.name === "Frame") return true;
    const spec = useStore.getState().components.find((c) => c.name === n.name);
    return spec ? spec.acceptsChildren : !n.selfClosing;
  }
  return n.kind === "fragment";
}

export async function insertComponent(spec: ComponentSpec, at?: { parent: string; index?: number }, props?: Record<string, Literal>) {
  const s = useStore.getState();
  const point = at ?? insertionPoint();
  if (!point || !s.canvas) return s.toast("Create a frame first (F).", "info");
  await s.run({ op: "insert_component", canvas: s.canvas, component: spec.name, parent: point.parent, index: point.index, props });
}

export async function createFrameAt(x: number, y: number, width = 800, height: number | null = null) {
  const s = useStore.getState();
  if (!s.canvas) return;
  await s.run({ op: "create_frame", canvas: s.canvas, x: Math.round(x), y: Math.round(y), width: Math.round(width), height: height === null ? null : Math.round(height) });
}

export function applyUiTheme() {
  const pref = useStore.getState().uiTheme;
  const dark = pref === "dark" || (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.ui = dark ? "dark" : "light";
}

/**
 * Shows layers given by the server (raw ids) on a canvas: switches to it if
 * needed, waits until its doc has loaded (not a fixed delay), maps ids to the
 * editor's frame-scoped ones, selects them and zooms there.
 */
export function revealOnCanvas(canvas: string, ids: string[], opts: { zoom?: boolean } = {}) {
  const show = () => {
    const s = useStore.getState();
    const mapped = ids.map((id) => fromServer(s.index, id)).filter((id) => s.index.has(id));
    if (!mapped.length) return;
    s.select(mapped);
    if (opts.zoom !== false) void refreshRects().then(() => zoomToSelection());
  };
  const s = useStore.getState();
  if (s.canvas === canvas && s.doc?.name === canvas) return show();
  if (s.canvas !== canvas) useStore.setState({ canvas });
  const stop = useStore.subscribe((now) => {
    if (now.doc?.name !== canvas) return;
    stop();
    clearTimeout(giveUp);
    show();
  });
  const giveUp = setTimeout(stop, 10_000);
}
