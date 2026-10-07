import { useState } from "react";
import { api } from "../lib/api";
import { useStore, type Camera } from "../lib/store";

/*
 * Live sessions in the editor: the button that starts or stops one for the
 * open canvas (next to Share), who's in it, and their cursors on the canvas.
 * The editor never talks to the review site itself: the local Truecanvas
 * holds the token and relays the room's events.
 */

const initials = (name: string) =>
  name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";

export function SessionButton() {
  const canvas = useStore((s) => s.canvas);
  const session = useStore((s) => (s.canvas ? s.sessions[s.canvas] : undefined));
  const roomPeople = useStore((s) => s.roomPeople);
  const people = Object.values(roomPeople).filter((p) => p.canvas === canvas);
  const [busy, setBusy] = useState(false);
  if (!canvas) return null;
  const on = !!session && session.status !== "stopped";

  const toggle = async () => {
    setBusy(true);
    try {
      if (on) await api.stopSession(canvas);
      else {
        const { session: s } = await api.startSession(canvas);
        useStore.setState((st) => ({ sessions: { ...st.sessions, [canvas]: s } }));
        useStore.getState().toast("Live: people with access to the link follow this canvas as you edit it.", "info");
      }
    } catch (e) {
      useStore.getState().toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const label = !on ? "Go live" : session.status === "live" ? "Live" : session.status === "connecting" ? "Connecting" : "Reconnecting";
  return (
    <div className="session">
      {on && people.length > 0 && (
        <div className="session-faces" aria-label={`${people.map((p) => p.name).join(", ")} here`}>
          {people.slice(0, 4).map((p) => (
            <span key={p.id} className="session-face" style={{ background: p.color }} title={p.name}>
              {initials(p.name)}
            </span>
          ))}
          {people.length > 4 && <span className="session-face more">+{people.length - 4}</span>}
        </div>
      )}
      <button
        className={`btn session-btn${on ? " on" : ""}${on && session.status !== "live" ? " waiting" : ""}`}
        onClick={() => void toggle()}
        disabled={busy}
        aria-pressed={on}
        title={on ? `Stop the live session (${session.url})` : "Let people with access to the share link follow this canvas live"}
      >
        <span className="session-dot" aria-hidden />
        {label}
      </button>
    </div>
  );
}

/** Cursors of people in the open canvas's live session (canvas coordinates, from the room). */
export function RoomCursors({ camera }: { camera: Camera }) {
  const canvas = useStore((s) => s.canvas);
  const roomPeople = useStore((s) => s.roomPeople);
  const people = Object.values(roomPeople).filter((p) => p.canvas === canvas && p.x !== null && p.y !== null);
  return (
    <>
      {people.map((p) => (
        <div
          key={p.id}
          className="agent-cursor room-cursor"
          style={{ ["--c" as string]: p.color, transform: `translate3d(${camera.x + p.x! * camera.zoom}px, ${camera.y + p.y! * camera.zoom}px, 0)` }}
          aria-hidden
        >
          <svg width="18" height="18" viewBox="0 0 18 18" className="arrow">
            <path d="M2.2 1.6 15.1 8.3c.7.4.6 1.4-.2 1.6l-5.3 1.3-2.6 4.8c-.4.7-1.4.6-1.6-.2L1.1 2.7c-.2-.8.5-1.4 1.1-1.1Z" fill={p.color} stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" />
          </svg>
          <div className="agent-chip">
            <span className="who">{p.name}</span>
          </div>
        </div>
      ))}
    </>
  );
}

/** The studio's own cursor, sent to the room while the open canvas is live: at most 20 times a second. */
let pending: { canvas: string; x: number | null; y: number | null } | null = null;
let timer = 0;
let last = 0;
export function sendSessionCursor(x: number | null, y: number | null) {
  const s = useStore.getState();
  const canvas = s.canvas;
  if (!canvas || s.sessions[canvas]?.status !== "live") return;
  pending = { canvas, x, y };
  if (timer) return;
  timer = window.setTimeout(() => {
    timer = 0;
    last = Date.now();
    const p = pending;
    pending = null;
    if (p) void api.sessionCursor(p.canvas, p.x, p.y).catch(() => {});
  }, Math.max(0, 50 - (Date.now() - last)));
}
