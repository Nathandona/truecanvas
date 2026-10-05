import { useEffect, useRef, useState } from "react";
import { agentColor, useStore, type Camera, type Rect } from "../lib/store";
import { frameHeight } from "../lib/actions";
import type { CanvasFrame, Presence } from "../lib/api";
import { agentLabel } from "./RightPanel";

/** How long a cursor stays after the agent's last call. */
const LINGER = 12_000;
/** How long a frame keeps glowing after an edit. */
const GLOW = 2_800;

type FramePos = (f: CanvasFrame) => { x: number; y: number; width: number; height: number | null };

/** Where the cursor tip should rest, in canvas (world) coordinates. */
function targetPoint(p: Presence, framePos: FramePos): { x: number; y: number; frame: CanvasFrame | null } | null {
  const s = useStore.getState();
  const doc = s.doc;
  if (!doc || p.canvas !== s.canvas) return null;
  for (const id of p.ids) {
    const e = s.index.get(id);
    if (!e) continue;
    const fp = framePos(e.frame);
    if (e.node.id === e.frame.id) return { x: fp.x + 28, y: fp.y + 22, frame: e.frame };
    const r: Rect | null | undefined = s.rects[id];
    if (r) return { x: fp.x + r.x + Math.min(30, r.width * 0.3), y: fp.y + r.y + Math.min(20, r.height * 0.6), frame: e.frame };
    return { x: fp.x + 28, y: fp.y + 22, frame: e.frame };
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
    if (!Object.keys(presence).length) return;
    const t = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, [presence]);

  const now = Date.now();
  const live = Object.values(presence).filter((p) => now - p.at < LINGER);
  return (
    <>
      {live.map((p) => {
        const target = targetPoint(p, framePos);
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

function Cursor({ presence, target, camera, fading }: { presence: Presence; target: { x: number; y: number }; camera: Camera; fading: boolean }) {
  const color = agentColor(presence.name);
  // spring the cursor in canvas space, so panning/zooming stays instant
  const pos = useRef<{ x: number; y: number } | null>(null);
  const vel = useRef({ x: 0, y: 0 });
  const [, render] = useState(0);
  useEffect(() => {
    if (!pos.current) {
      // first appearance: come in from slightly up-left
      pos.current = { x: target.x - 60, y: target.y - 40 };
    }
    let raf = 0;
    const step = () => {
      const p = pos.current!;
      const dx = target.x - p.x;
      const dy = target.y - p.y;
      // critically damped-ish spring
      vel.current.x = vel.current.x * 0.72 + dx * 0.09;
      vel.current.y = vel.current.y * 0.72 + dy * 0.09;
      p.x += vel.current.x;
      p.y += vel.current.y;
      render((n) => n + 1);
      if (Math.abs(dx) + Math.abs(dy) > 0.3 || Math.abs(vel.current.x) + Math.abs(vel.current.y) > 0.3) raf = requestAnimationFrame(step);
      else {
        p.x = target.x;
        p.y = target.y;
      }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target.x, target.y]);

  const p = pos.current ?? target;
  const busy = presence.action === "editing" && Date.now() - presence.at < GLOW;
  return (
    <div
      className={`agent-cursor${fading ? " fading" : ""}`}
      style={{ transform: `translate(${camera.x + p.x * camera.zoom}px, ${camera.y + p.y * camera.zoom}px)`, ["--c" as string]: color }}
      aria-hidden
    >
      <svg width="22" height="22" viewBox="0 0 22 22" className="arrow">
        <path d="M3.6 2.3 18.4 12.6c.6.4.4 1.3-.3 1.4l-6.1 1-3.4 5.3c-.4.6-1.3.5-1.5-.2L2.4 3.4c-.2-.8.6-1.4 1.2-1.1Z" fill={color} stroke="#fff" strokeWidth="1.4" strokeLinejoin="round" />
      </svg>
      <div className="agent-pill">
        {busy && <span className="busy-dot" />}
        <span className="who">{agentLabel(presence.name)}</span>
        <span className="what">{presence.label}</span>
      </div>
    </div>
  );
}
