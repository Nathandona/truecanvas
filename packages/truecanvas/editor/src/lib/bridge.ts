import { refitIfAuto, rememberHeights } from "./actions";
import { useStore, type Rect } from "./store";
import { inFrame, rawId } from "./scope";

// Messaging with the frame iframes (which run the app's own origin).

const frames = new Map<string, HTMLIFrameElement>();
const pending = new Map<number, (data: Record<string, unknown>) => void>();
let seq = 0;

type WheelHandler = (e: { dx: number; dy: number; ctrl: boolean; clientX: number; clientY: number; mode: number }) => void;
type KeyHandler = (e: { key: string; code: string; meta: boolean; ctrl: boolean; shift: boolean; alt: boolean }) => void;
let wheelHandler: WheelHandler | null = null;
let keyHandler: KeyHandler | null = null;

export function registerFrame(name: string, el: HTMLIFrameElement | null) {
  if (el) frames.set(name, el);
  else frames.delete(name);
}

/**
 * A frame's iframe went away (scrolled far off-screen): it must say "ready"
 * again when it comes back, so theme, motion and hidden layers are re-sent.
 */
export function forgetFrameReady(name: string) {
  const { frameReady } = useStore.getState();
  if (!frameReady[name]) return;
  const { [name]: _gone, ...rest } = frameReady;
  useStore.setState({ frameReady: rest });
}

export function onFrameWheel(fn: WheelHandler) {
  wheelHandler = fn;
}
export function onFrameKey(fn: KeyHandler) {
  keyHandler = fn;
}

function frameNameOf(source: MessageEventSource | null): string | null {
  for (const [name, el] of frames) if (el.contentWindow === source) return name;
  return null;
}

/** The app's origin (frames are pages of the user's app), or null before the state has loaded. */
function appOrigin(): string | null {
  try {
    return new URL(useStore.getState().appUrl).origin;
  } catch {
    return null;
  }
}

function target(name: string) {
  const el = frames.get(name);
  const origin = appOrigin();
  return el?.contentWindow && origin ? { win: el.contentWindow, origin, el } : null;
}

export function request<T extends Record<string, unknown>>(frame: string, msg: Record<string, unknown>, timeout = 1500): Promise<T | null> {
  const t = target(frame);
  if (!t) return Promise.resolve(null);
  const req = ++seq;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(req);
      resolve(null);
    }, timeout);
    pending.set(req, (data) => {
      clearTimeout(timer);
      resolve(data as T);
    });
    t.win.postMessage({ ...msg, req }, t.origin);
  });
}

export function send(frame: string, msg: Record<string, unknown>) {
  const t = target(frame);
  t?.win.postMessage(msg, t.origin);
}

/** The frame's id in the doc, for scoping raw ids from its DOM. */
const frameIdOf = (name: string) => useStore.getState().doc?.frames.find((f) => f.frameName === name)?.id;

export async function hitTest(frame: string, x: number, y: number) {
  const res = await request<{ chain: string[]; rects: Record<string, Rect | null> }>(frame, { type: "tc:hit", x, y });
  if (!res) return res;
  // the frame answers with file ids; the editor tells frames of the same page apart
  const index = useStore.getState().index;
  const fid = frameIdOf(frame);
  const rects: Record<string, Rect | null> = {};
  for (const [id, r] of Object.entries(res.rects)) rects[inFrame(index, fid, id)] = r;
  return { chain: res.chain.map((id) => inFrame(index, fid, id)), rects };
}

export async function measure(frame: string, ids: string[]) {
  if (!ids.length) return {};
  const res = await request<{ rects: Record<string, Rect | null> }>(frame, { type: "tc:rects", ids: [...new Set(ids.map(rawId))] });
  const out: Record<string, Rect | null> = {};
  for (const id of ids) out[id] = res?.rects?.[rawId(id)] ?? null;
  return out;
}

/** Re-measure every id we track in the given frames (or all). */
export async function refreshRects(onlyFrames?: Set<string>) {
  const s = useStore.getState();
  const ids = new Set<string>([...s.selection, ...(s.hover ? [s.hover] : []), ...s.flashes.map((f) => f.id), ...Object.values(s.presence).flatMap((p) => p.ids)]);
  const byFrame = new Map<string, string[]>();
  for (const id of ids) {
    const entry = s.index.get(id);
    if (!entry || entry.node.id === entry.frame.id) continue;
    const name = entry.frame.frameName;
    if (onlyFrames && !onlyFrames.has(name)) continue;
    byFrame.set(name, [...(byFrame.get(name) ?? []), id]);
  }
  const results = await Promise.all([...byFrame].map(([frame, list]) => measure(frame, list)));
  const merged = Object.assign({}, ...results);
  if (Object.keys(merged).length) useStore.setState({ rects: { ...useStore.getState().rects, ...merged } });
}

let installed = false;
export function installBridge() {
  if (installed) return;
  installed = true;
  let layoutFrames = new Set<string>();
  let layoutRaf = 0;
  window.addEventListener("message", (e) => {
    const msg = e.data as { type?: string; req?: number; [k: string]: unknown };
    if (!msg || typeof msg.type !== "string" || !msg.type.startsWith("tc:")) return;
    // only our app's pages: a frame navigated elsewhere (interact mode) can't drive the editor
    if (e.origin !== appOrigin()) return;
    const name = frameNameOf(e.source);
    if (!name) return;
    const store = useStore.getState();
    switch (msg.type) {
      case "tc:hit:res":
      case "tc:rects:res": {
        const cb = pending.get(msg.req as number);
        if (cb) {
          pending.delete(msg.req as number);
          cb(msg);
        }
        break;
      }
      case "tc:ready":
        useStore.setState({ frameReady: { ...store.frameReady, [name]: true }, frameErrors: { ...store.frameErrors, [name]: null } });
        break;
      case "tc:layout": {
        const height = msg.height as number;
        if (msg.ready && height && store.frameHeights[name] !== height) {
          useStore.setState({ frameHeights: { ...useStore.getState().frameHeights, [name]: height } });
          rememberHeights();
          refitIfAuto();
        }
        if (msg.ready && !store.frameReady[name]) useStore.setState({ frameReady: { ...useStore.getState().frameReady, [name]: true } });
        layoutFrames.add(name);
        if (!layoutRaf) {
          layoutRaf = requestAnimationFrame(() => {
            layoutRaf = 0;
            const set = layoutFrames;
            layoutFrames = new Set();
            void refreshRects(set);
            useStore.setState({ layoutTick: useStore.getState().layoutTick + 1 });
          });
        }
        break;
      }
      case "tc:error":
        if ((store.frameErrors[name] ?? null) !== (msg.message ?? null)) {
          useStore.setState({ frameErrors: { ...store.frameErrors, [name]: (msg.message as string | null) ?? null } });
        }
        break;
      case "tc:wheel": {
        const el = frames.get(name);
        if (!el || !wheelHandler) break;
        const r = el.getBoundingClientRect();
        const zoom = store.camera.zoom;
        wheelHandler({ dx: msg.dx as number, dy: msg.dy as number, ctrl: !!msg.ctrl, mode: msg.mode as number, clientX: r.left + (msg.x as number) * zoom, clientY: r.top + (msg.y as number) * zoom });
        break;
      }
      case "tc:key":
        keyHandler?.(msg as unknown as Parameters<KeyHandler>[0]);
        break;
    }
  });
}
