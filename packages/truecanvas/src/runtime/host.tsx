import { Component, Suspense, useEffect, useState, type ComponentType, type ReactNode } from "react";
import { HostContext } from "./index.js";

export interface DarkModeConfig {
  strategy: "class" | "attribute";
  value: string;
  attribute?: string;
  lightValue?: string;
}

type Theme = "light" | "dark" | "system";

export interface HostProps {
  canvas: string;
  frame: string | null;
  theme: Theme;
  darkMode: DarkModeConfig;
  canvases: Record<string, ComponentType>;
  /** catalog components, for single-component previews (Assets thumbnails) */
  components?: Record<string, ComponentType<Record<string, unknown>>>;
}

const HIDE_CHROME = `
html, body { margin: 0 !important; }
html:not([data-tc-play]), html:not([data-tc-play]) body { overflow: hidden !important; }
html[data-tc-play] { overflow-y: auto !important; overflow-x: hidden !important; }
[data-tc-hidden] { display: none !important; }
nextjs-portal, [data-nextjs-toast], #__next-build-watcher { display: none !important; }
`;

/** Renders one frame of one canvas inside the editor's iframe. */
export function TruecanvasHost({ canvas, frame, theme: initialTheme, darkMode, canvases, components }: HostProps) {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  // bumped to remount the canvas, so entrance animations play again
  const [replay, setReplay] = useState(0);
  useEffect(() => applyTheme(theme, darkMode), [theme, darkMode]);
  useEffect(() => startBridge({ frame, setTheme, replay: () => setReplay((n) => n + 1) }), [frame]);
  useEffect(() => stillForScreenshots(), []);

  if (canvas === "__preview") return <Preview components={components ?? {}} />;

  const Canvas = canvases[canvas];
  return (
    <>
      <style>{HIDE_CHROME}</style>
      {!Canvas ? (
        <Notice title={`Canvas “${canvas}” not found`} body="It may still be compiling. Truecanvas regenerates the route when canvas files are added." />
      ) : (
        <HostContext.Provider value={{ frame }}>
          <Boundary onError={(m) => post({ type: "tc:error", message: m })}>
            <Suspense fallback={null}>
              <Canvas key={replay} />
            </Suspense>
          </Boundary>
        </HostContext.Provider>
      )}
    </>
  );
}

/** One component with given props, sized to its content (used for Assets thumbnails). */
function Preview({ components }: { components: Record<string, ComponentType<Record<string, unknown>>> }) {
  const [query, setQuery] = useState<{ name: string; props: Record<string, unknown> } | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    let props: Record<string, unknown> = {};
    try {
      props = JSON.parse(q.get("props") ?? "{}");
    } catch {
      props = {};
    }
    setQuery({ name: q.get("component") ?? "", props });
  }, []);
  if (!query) return null;
  const Comp = components[query.name];
  if (!Comp) return <Notice title={`Component “${query.name}” not found`} body="The component registry may still be generating." />;
  return (
    <>
      <style>{HIDE_CHROME}</style>
      <div data-tc-frame="preview" style={{ display: "inline-block", padding: 16, minWidth: 40 }}>
        <Boundary onError={() => {}}>
          <Suspense fallback={null}>
            <Comp {...query.props} />
          </Suspense>
        </Boundary>
      </div>
    </>
  );
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div data-tc-frame="" style={{ font: "13px/1.5 system-ui, sans-serif", padding: 24, color: "#b42318", background: "#fff5f5", minHeight: 120 }}>
      <strong style={{ display: "block", marginBottom: 4 }}>{title}</strong>
      <span style={{ whiteSpace: "pre-wrap", color: "#7a271a" }}>{body}</span>
    </div>
  );
}

class Boundary extends Component<{ children: ReactNode; onError: (m: string) => void }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    this.props.onError(error.message);
  }
  componentDidMount() {
    post({ type: "tc:error", message: null });
  }
  componentDidUpdate(_: unknown, prev: { error: Error | null }) {
    // Fast Refresh retries failed boundaries after the next edit
    if (prev.error && !this.state.error) post({ type: "tc:error", message: null });
  }
  render() {
    if (this.state.error) return <Notice title="This frame threw while rendering" body={this.state.error.message} />;
    return this.props.children;
  }
}

function applyTheme(theme: Theme, dm: DarkModeConfig) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const set = () => {
    const dark = theme === "dark" || (theme === "system" && media.matches);
    const el = document.documentElement;
    if (dm.strategy === "class") el.classList.toggle(dm.value, dark);
    else el.setAttribute(dm.attribute ?? "data-theme", dark ? dm.value : (dm.lightValue ?? "light"));
    el.style.colorScheme = dark ? "dark" : "light";
  };
  set();
  if (theme !== "system") return;
  media.addEventListener("change", set);
  return () => media.removeEventListener("change", set);
}

// ---------------------------------------------------------------------------
// Bridge: the editor (parent window) asks "what is under this point?" and
// "where is node X?". We answer from React's fiber tree, using the data-tc
// ids the loader stamped on every JSX element of the canvas file.
// ---------------------------------------------------------------------------

interface Fiber {
  tag: number;
  stateNode: unknown;
  memoizedProps: Record<string, unknown> | null;
  child: Fiber | null;
  sibling: Fiber | null;
  return: Fiber | null;
}
type Rect = { x: number; y: number; width: number; height: number };

/** Only talk to an editor on this machine (the editor passes its origin in the URL). */
const editorOrigin = (() => {
  if (typeof window === "undefined") return null;
  try {
    const raw = new URLSearchParams(window.location.search).get("editor");
    if (!raw) return null;
    const u = new URL(raw);
    return ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname) ? u.origin : null;
  } catch {
    return null;
  }
})();

function post(msg: Record<string, unknown>) {
  if (window.parent !== window && editorOrigin) window.parent.postMessage(msg, editorOrigin);
}

function frameRoot(): HTMLElement | null {
  return document.querySelector("[data-tc-frame]");
}

function tcId(f: Fiber): string | null {
  const id = f.memoizedProps?.["data-tc"];
  return typeof id === "string" ? id : null;
}

/** The *current* HostRoot fiber. DOM nodes may point at stale alternates; the root never lies. */
function currentRoot(): Fiber | null {
  for (const node of [document, document.documentElement, document.body, document.getElementById("__next")]) {
    if (!node) continue;
    for (const key in node) {
      if (key.startsWith("__reactContainer$")) {
        const f = (node as unknown as Record<string, Fiber & { stateNode: { current?: Fiber } }>)[key];
        return f.stateNode?.current ?? f;
      }
    }
  }
  return null;
}

interface TreeIndex {
  /** host node → ids of canvas nodes containing it, outermost first */
  byHost: Map<Node, string[]>;
  /** id → outermost fibers carrying it (several when rendered in a loop) */
  byId: Map<string, Fiber[]>;
}

/** Walks the current fiber tree inside the frame root. Rebuilt per request: it's cheap and never stale. */
function indexTree(): TreeIndex {
  const byHost = new Map<Node, string[]>();
  const byId = new Map<string, Fiber[]>();
  const root = currentRoot();
  const frameEl = frameRoot();
  if (!root || !frameEl) return { byHost, byId };
  const stack: { f: Fiber; chain: string[]; inside: boolean }[] = [{ f: root, chain: [], inside: false }];
  while (stack.length) {
    const { f, chain, inside: parentInside } = stack.pop()!;
    const inside = parentInside || f.stateNode === frameEl;
    let next = chain;
    if (inside) {
      const id = tcId(f);
      if (id && chain[chain.length - 1] !== id) {
        next = [...chain, id];
        const list = byId.get(id) ?? [];
        list.push(f);
        byId.set(id, list);
      }
      if ((f.tag === 5 || f.tag === 6) && next.length) byHost.set(f.stateNode as Node, next);
    }
    for (let c = f.child; c; c = c.sibling) stack.push({ f: c, chain: next, inside });
  }
  return { byHost, byId };
}

/** Ids of canvas nodes containing `el`, innermost first. */
function chainAt(el: Element | null, idx: TreeIndex): string[] {
  for (let n: Node | null = el; n; n = n.parentNode) {
    const chain = idx.byHost.get(n);
    if (chain) return [...chain].reverse();
  }
  return [];
}

function hostNodes(f: Fiber, out: Node[]) {
  if (f.tag === 5 || f.tag === 6) {
    out.push(f.stateNode as Node);
    return;
  }
  for (let c = f.child; c; c = c.sibling) hostNodes(c, out);
}

function rectOfNode(node: Node): Rect | null {
  if (node.nodeType === Node.TEXT_NODE) {
    const range = document.createRange();
    range.selectNodeContents(node);
    const r = range.getBoundingClientRect();
    return r.width || r.height ? r : null;
  }
  const el = node as Element;
  const r = el.getBoundingClientRect();
  if (r.width || r.height) return r;
  // display: contents and friends: measure children instead
  let acc: Rect | null = null;
  for (const child of Array.from(el.childNodes)) acc = union(acc, rectOfNode(child));
  return acc;
}

function union(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b && { x: b.x, y: b.y, width: b.width, height: b.height };
  if (!b) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
}

function rectOf(id: string, idx: TreeIndex): Rect | null {
  let acc: Rect | null = null;
  for (const f of idx.byId.get(id) ?? []) {
    const nodes: Node[] = [];
    hostNodes(f, nodes);
    for (const n of nodes) acc = union(acc, rectOfNode(n));
  }
  return acc && { x: Math.round(acc.x * 10) / 10, y: Math.round(acc.y * 10) / 10, width: Math.round(acc.width * 10) / 10, height: Math.round(acc.height * 10) / 10 };
}

// ---------------------------------------------------------------------------
// Motion pause: hold requestAnimationFrame callbacks and CSS animations, so
// shaders and animations freeze on their current frame and stop using the GPU.
// ---------------------------------------------------------------------------

/*
 * Final state: a paused frame shows every entrance animation finished, never
 * half way. JS-driven animations (framer-motion and friends) read
 * performance.now(), so while paused we move that clock far ahead and run a
 * few held frames; CSS and Web Animations with an end are finished. Looping
 * animations just stop where they are.
 */
let timeOffset = 0;
let clockPatched = false;
let settleTimers: ReturnType<typeof setTimeout>[] = [];

function patchClock() {
  if (clockPatched) return;
  clockPatched = true;
  const realNow = performance.now.bind(performance);
  performance.now = () => realNow() + timeOffset;
}

function settle() {
  patchClock();
  timeOffset += 60_000;
  for (let pass = 0; pass < 4; pass++) {
    const queue = [...held.values()];
    held = new Map();
    for (const cb of queue) {
      try {
        cb(performance.now());
      } catch {
        /* the page's own frame callback threw: not ours to report */
      }
    }
  }
  for (const a of document.getAnimations()) {
    try {
      const end = a.effect?.getComputedTiming().endTime;
      if (typeof end === "number" && Number.isFinite(end)) a.finish();
      else a.pause();
    } catch {
      a.pause();
    }
  }
}

/** Settles now and a few times after, for animations that start late (observers, lazy sections). */
function scheduleSettle(done?: () => void, quick = false) {
  for (const t of settleTimers) clearTimeout(t);
  settleTimers = (quick ? [0, 250, 700] : [0, 300, 1000, 2500]).map((ms, i, all) =>
    setTimeout(() => {
      settle();
      if (i === all.length - 1) done?.();
    }, ms),
  );
}

/** `?still=1` (agent screenshots): freeze on the final state, then flag it for the screenshotter. */
function stillForScreenshots() {
  if (new URLSearchParams(window.location.search).get("still") !== "1") return;
  const w = window as unknown as { __tcStill?: boolean };
  setTimeout(() => {
    setMotionPaused(true, () => (w.__tcStill = true), true);
  }, 400);
}

/*
 * Scroll animations (framer-motion's whileInView, IntersectionObserver
 * reveals) measure against the frame's own viewport, not the editor window:
 * a frame is a cross-origin iframe, so by default the browser also clips by
 * what's visible on the canvas, and sections you haven't panned to never
 * reveal. Full-height frames then show the whole page revealed; a playing
 * frame (one screen tall) reveals as you scroll, like the site.
 */
if (typeof window !== "undefined" && "IntersectionObserver" in window && !(window as unknown as { __tcIO?: boolean }).__tcIO) {
  (window as unknown as { __tcIO?: boolean }).__tcIO = true;
  const Native = window.IntersectionObserver;
  window.IntersectionObserver = class extends Native {
    constructor(callback: IntersectionObserverCallback, options: IntersectionObserverInit = {}) {
      super(callback, options.root == null ? { ...options, root: document } : options);
    }
  };
}

let remountWatch: MutationObserver | null = null;
let realRaf: typeof requestAnimationFrame | null = null;
let realCancel: typeof cancelAnimationFrame | null = null;
let held = new Map<number, FrameRequestCallback>();
let heldSeq = -1;
const PAUSE_STYLE_ID = "tc-pause-motion";

function raf(cb: FrameRequestCallback) {
  return (realRaf ?? requestAnimationFrame)(cb);
}

function setMotionPaused(paused: boolean, settled?: () => void, quick = false) {
  realRaf ??= window.requestAnimationFrame.bind(window);
  realCancel ??= window.cancelAnimationFrame.bind(window);
  if (paused) {
    window.requestAnimationFrame = (cb) => {
      const id = heldSeq--;
      held.set(id, cb);
      return id;
    };
    window.cancelAnimationFrame = (id) => (id < 0 ? void held.delete(id) : realCancel!(id));
    for (const a of document.getAnimations()) a.pause();
    if (!document.getElementById(PAUSE_STYLE_ID)) {
      const style = document.createElement("style");
      style.id = PAUSE_STYLE_ID;
      style.textContent = "*,*::before,*::after{animation-play-state:paused!important}";
      document.head.appendChild(style);
    }
    scheduleSettle(settled, quick);
    // content that mounts later (Fast Refresh after an edit, lazy sections) settles too
    remountWatch?.disconnect();
    let pending: ReturnType<typeof setTimeout> | null = null;
    remountWatch = new MutationObserver(() => {
      if (pending) clearTimeout(pending);
      pending = setTimeout(() => {
        pending = null;
        settle();
        setTimeout(settle, 300);
      }, 120);
    });
    remountWatch.observe(document.body, { childList: true, subtree: true });
  } else {
    remountWatch?.disconnect();
    remountWatch = null;
    for (const t of settleTimers) clearTimeout(t);
    settleTimers = [];
    window.requestAnimationFrame = realRaf;
    window.cancelAnimationFrame = realCancel;
    const queue = [...held.values()];
    held = new Map();
    for (const cb of queue) realRaf(cb);
    document.getElementById(PAUSE_STYLE_ID)?.remove();
    for (const a of document.getAnimations()) if (a.playState === "paused") a.play();
  }
}

/** Layers hidden in the editor: their DOM is marked and hidden, React is untouched. */
let hiddenIds = new Set<string>();
function applyHidden() {
  const wanted = new Set<Element>();
  if (hiddenIds.size) {
    const idx = indexTree();
    for (const id of hiddenIds) {
      for (const f of idx.byId.get(id) ?? []) {
        const nodes: Node[] = [];
        hostNodes(f, nodes);
        for (const n of nodes) if (n.nodeType === Node.ELEMENT_NODE) wanted.add(n as Element);
      }
    }
  }
  for (const el of Array.from(document.querySelectorAll("[data-tc-hidden]"))) if (!wanted.has(el)) el.removeAttribute("data-tc-hidden");
  for (const el of wanted) if (!el.hasAttribute("data-tc-hidden")) el.setAttribute("data-tc-hidden", "");
}

let playing = false;

function startBridge({ frame, setTheme, replay }: { frame: string | null; setTheme: (t: Theme) => void; replay: () => void }) {
  if (window.parent === window || !editorOrigin) return;

  const onMessage = (e: MessageEvent) => {
    if (e.source !== window.parent || e.origin !== editorOrigin) return;
    const msg = e.data as { type?: string; [k: string]: unknown };
    switch (msg?.type) {
      case "tc:hit": {
        const idx = indexTree();
        const chain = chainAt(document.elementFromPoint(msg.x as number, msg.y as number), idx);
        const rects: Record<string, Rect | null> = {};
        for (const id of chain) rects[id] = rectOf(id, idx);
        post({ type: "tc:hit:res", req: msg.req, chain, rects });
        break;
      }
      case "tc:rects": {
        const idx = indexTree();
        const rects: Record<string, Rect | null> = {};
        for (const id of msg.ids as string[]) rects[id] = rectOf(id, idx);
        post({ type: "tc:rects:res", req: msg.req, rects });
        break;
      }
      case "tc:theme":
        setTheme(msg.theme as Theme);
        break;
      case "tc:motion":
        setMotionPaused(!!msg.paused);
        break;
      case "tc:hidden":
        hiddenIds = new Set(msg.ids as string[]);
        applyHidden();
        break;
      case "tc:play":
        // play: the frame is one screen tall and scrolls, so scroll-triggered animations fire as on the site
        playing = !!msg.on;
        document.documentElement.toggleAttribute("data-tc-play", playing);
        document.documentElement.scrollTop = 0;
        if (playing) replay();
        break;
      case "tc:replay":
        document.documentElement.scrollTop = 0;
        replay();
        break;
    }
  };
  window.addEventListener("message", onMessage);

  // Size + layout notifications
  let rafId = 0;
  const notify = () => {
    if (rafId) return;
    rafId = raf(() => {
      rafId = 0;
      const root = frameRoot();
      post({ type: "tc:layout", frame, height: root ? Math.ceil(root.getBoundingClientRect().height) : 0, ready: !!root });
    });
  };
  const ro = new ResizeObserver(notify);
  const mo = new MutationObserver((records) => {
    const root = frameRoot();
    if (root) ro.observe(root);
    // our own attribute changes don't count as layout changes
    if (records.every((r) => r.type === "attributes" && r.attributeName === "data-tc-hidden")) return;
    if (hiddenIds.size) applyHidden();
    notify();
  });
  mo.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
  const root = frameRoot();
  if (root) ro.observe(root);
  document.fonts?.ready.then(notify);
  notify();

  // Interact mode: forward wheel (pan/zoom) and shortcuts to the editor.
  const onWheel = (e: WheelEvent) => {
    // playing: plain scroll stays in the page; pinch/ctrl zooms the canvas
    if (playing && !(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    post({ type: "tc:wheel", dx: e.deltaX, dy: e.deltaY, mode: e.deltaMode, ctrl: e.ctrlKey || e.metaKey, x: e.clientX, y: e.clientY });
  };
  const onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (e.key === "Escape" || e.metaKey || e.ctrlKey || /^[vhfp]$/i.test(e.key)) {
      post({ type: "tc:key", key: e.key, code: e.code, meta: e.metaKey, ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey });
    }
  };
  const onError = (e: ErrorEvent) => post({ type: "tc:error", message: e.message });
  window.addEventListener("wheel", onWheel, { passive: false });
  window.addEventListener("keydown", onKey);
  window.addEventListener("error", onError);
  post({ type: "tc:ready", frame });

  return () => {
    window.removeEventListener("message", onMessage);
    window.removeEventListener("wheel", onWheel);
    window.removeEventListener("keydown", onKey);
    window.removeEventListener("error", onError);
    ro.disconnect();
    mo.disconnect();
    (realCancel ?? cancelAnimationFrame)(rafId);
  };
}
