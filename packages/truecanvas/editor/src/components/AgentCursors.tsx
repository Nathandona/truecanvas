import { useEffect, useRef, useState } from "react";
import { agentColor, useStore, type Camera, type Rect, agentLabel } from "../lib/store";
import { frameHeight } from "../lib/actions";
import type { CanvasFrame, Presence } from "../lib/api";

/** How long a cursor stays after the agent's last call. */
const LINGER = 12_000;
/** How long a frame keeps glowing after an edit. */
const GLOW = 2_800;

type FramePos = (f: CanvasFrame) => { x: number; y: number; width: number; height: number | null };

/**
 * Where the cursor tip should rest, in canvas (world) coordinates. `pending`:
 * the layer isn't measured yet, so this is only the frame's corner: the cursor
 * waits a moment for the real spot instead of detouring through the corner.
 */
function targetPoint(p: Presence, framePos: FramePos): { x: number; y: number; frame: CanvasFrame | null; pending?: boolean } | null {
  const s = useStore.getState();
  const doc = s.doc;
  if (!doc || p.canvas !== s.canvas) return null;
  for (const id of p.ids) {
    const e = s.index.get(id);
    if (!e) continue;
    const fp = framePos(e.frame);
    if (e.node.id === e.frame.id) return { x: fp.x + 28, y: fp.y + 22, frame: e.frame };
    // text has no box of its own: point at the nearest measured element around it
    let r: Rect | null | undefined = s.rects[id];
    for (let up = e.parent; r === undefined && up && up.id !== e.frame.id; up = s.index.get(up.id)?.parent ?? null) r = s.rects[up.id];
    if (r) return { x: fp.x + r.x + Math.min(30, r.width * 0.3), y: fp.y + r.y + Math.min(20, r.height * 0.6), frame: e.frame };
    return { x: fp.x + 28, y: fp.y + 22, frame: e.frame, pending: r === undefined };
  }
  const f = p.frame ? doc.frames.find((x) => x.frameName === p.frame || x.id === p.frame) : null;
  if (f) {
    const fp = framePos(f);
    return { x: fp.x + fp.width * 0.5, y: fp.y + Math.min(60, (fp.height ?? frameHeight(f)) * 0.3), frame: f };
  }
  return null;
}

/** Multiplayer-style cursors for connected agents, gliding to whatever they read or edit. */
export function AgentCursors({ camera, framePos }: { camera: Camera; framePos: FramePos }) {
  const presence = useStore((s) => s.presence);
  useStore((s) => s.rects);
  useStore((s) => s.index);
  const [, tick] = useState(0);
  // re-render while cursors are fading out / frames glowing
  useEffect(() => {
    const lingering = () => Object.values(presence).some((p) => Date.now() - p.at < LINGER);
    if (!lingering()) return;
    // stops by itself once the last cursor has faded out
    const t = setInterval(() => {
      tick((n) => n + 1);
      if (!lingering()) clearInterval(t);
    }, 500);
    return () => clearInterval(t);
  }, [presence]);

  // the last place each cursor pointed: while the canvas reloads after an edit its
  // target can't be resolved for a moment, and the cursor must stay put, not restart
  const lastTarget = useRef(new Map<string, NonNullable<ReturnType<typeof targetPoint>>>());
  const now = Date.now();
  const live = Object.values(presence).filter((p) => now - p.at < LINGER);
  return (
    <>
      {live.map((p) => {
        const found = targetPoint(p, framePos);
        if (found) lastTarget.current.set(p.session, found);
        const target = found ?? (p.canvas === useStore.getState().canvas ? lastTarget.current.get(p.session) ?? null : null);
        const glowing = target?.frame && p.action === "editing" && now - p.at < GLOW;
        return (
          <div key={p.session}>
            {glowing && target.frame && <FrameGlow frame={target.frame} framePos={framePos} camera={camera} color={agentColor(p.name)} />}
            {target && <Cursor presence={p} target={target} camera={camera} fading={now - p.at > LINGER - 1500} />}
          </div>
        );
      })}
    </>
  );
}

function FrameGlow({ frame, framePos, camera, color }: { frame: CanvasFrame; framePos: FramePos; camera: Camera; color: string }) {
  const p = framePos(frame);
  const h = p.height ?? frameHeight(frame);
  return (
    <div
      className="frame-glow"
      style={{
        left: camera.x + p.x * camera.zoom,
        top: camera.y + p.y * camera.zoom,
        width: p.width * camera.zoom,
        height: h * camera.zoom,
        ["--c" as string]: color,
      }}
    />
  );
}

/** A critically damped spring (no overshoot), settling in about a quarter second. */
const OMEGA = 22;

function Cursor({ presence, target, camera, fading }: { presence: Presence; target: { x: number; y: number; pending?: boolean }; camera: Camera; fading: boolean }) {
  const color = agentColor(presence.name);
  const el = useRef<HTMLDivElement>(null);
  // all motion happens here, written straight to the DOM: no React render per frame
  const state = useRef<{ x: number; y: number; vx: number; vy: number; tx: number; ty: number; cam: Camera; raf: number; last: number } | null>(null);

  const place = () => {
    const st = state.current;
    if (!st || !el.current) return;
    el.current.style.transform = `translate3d(${st.cam.x + st.x * st.cam.zoom}px, ${st.cam.y + st.y * st.cam.zoom}px, 0)`;
  };
  const animate = () => {
    const st = state.current;
    if (!st || st.raf) return;
    st.last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(0.05, (now - st.last) / 1000);
      st.last = now;
      // x'' = -ω²(x - target) - 2ω x'
      const ax = -OMEGA * OMEGA * (st.x - st.tx) - 2 * OMEGA * st.vx;
      const ay = -OMEGA * OMEGA * (st.y - st.ty) - 2 * OMEGA * st.vy;
      st.vx += ax * dt;
      st.vy += ay * dt;
      st.x += st.vx * dt;
      st.y += st.vy * dt;
      const done = Math.hypot(st.x - st.tx, st.y - st.ty) < 0.25 && Math.hypot(st.vx, st.vy) < 2;
      if (done) {
        st.x = st.tx;
        st.y = st.ty;
        st.vx = st.vy = 0;
      }
      place();
      st.raf = done ? 0 : requestAnimationFrame(step);
    };
    st.raf = requestAnimationFrame(step);
  };

  // a new target: glide there (a not-yet-measured layer gets a moment to report its spot)
  useEffect(() => {
    const st = state.current;
    if (!st) {
      // first appearance: slide in from a little up-left of the target
      state.current = { x: target.x - 48, y: target.y - 32, vx: 0, vy: 0, tx: target.x, ty: target.y, cam: camera, raf: 0, last: 0 };
      place();
      animate();
      return;
    }
    const go = () => {
      st.tx = target.x;
      st.ty = target.y;
      animate();
    };
    if (!target.pending) return go();
    const t = setTimeout(go, 350);
    return () => clearTimeout(t);
  }, [target.x, target.y, target.pending]);

  // panning and zooming move the cursor instantly, in step with the canvas
  useEffect(() => {
    if (!state.current) return;
    state.current.cam = camera;
    place();
  }, [camera]);

  useEffect(() => () => cancelAnimationFrame(state.current?.raf ?? 0), []);

  const busy = presence.action === "editing" && Date.now() - presence.at < GLOW;
  return (
    <div ref={el} className={`agent-cursor${fading ? " fading" : ""}`} style={{ ["--c" as string]: color }} aria-hidden>
      <svg width="18" height="18" viewBox="0 0 18 18" className="arrow">
        <path d="M2.2 1.6 15.1 8.3c.7.4.6 1.4-.2 1.6l-5.3 1.3-2.6 4.8c-.4.7-1.4.6-1.6-.2L1.1 2.7c-.2-.8.5-1.4 1.1-1.1Z" fill={color} stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
      <div className={`agent-chip${busy ? " busy" : ""}`}>
        <span className="who">{agentLabel(presence.name)}</span>
        {presence.label && (
          <span className="what" key={presence.label}>
            {presence.label}
          </span>
        )}
      </div>
    </div>
  );
}
