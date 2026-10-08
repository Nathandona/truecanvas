import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Copy } from "lucide-react";
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

/* when each canvas's session started, for the timer (kept across re-renders and panel toggles) */
const startedAt: Record<string, number> = {};

function elapsed(since: number) {
  const s = Math.max(0, Math.floor((Date.now() - since) / 1000));
  const m = Math.floor(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}` : `${m}:${String(s % 60).padStart(2, "0")}`;
}

/** Starts a live session on a canvas (from the Share dialog); throws with a message to show. */
export async function startLiveSession(canvas: string) {
  const { session } = await api.startSession(canvas);
  useStore.setState((st) => ({ sessions: { ...st.sessions, [canvas]: session } }));
  useStore.getState().toast("You're live: people with access to the link follow this canvas as you edit it.", "info");
}

/*
 * A session starts from the Share dialog. While one runs, a red pill next to
 * Share shows it with a timer and who's here; it opens the link, Copy link
 * and End session. Nothing when no session runs: one Share button, the
 * running state impossible to miss.
 */
export function SessionButton() {
  const canvas = useStore((s) => s.canvas);
  const session = useStore((s) => (s.canvas ? s.sessions[s.canvas] : undefined));
  const roomPeople = useStore((s) => s.roomPeople);
  const people = Object.values(roomPeople).filter((p) => p.canvas === canvas);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [, tick] = useState(0);
  const btn = useRef<HTMLButtonElement>(null);
  const on = !!session && session.status !== "stopped";
  if (canvas && on && !startedAt[canvas]) startedAt[canvas] = Date.now();
  if (canvas && !on) delete startedAt[canvas];
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [on]);
  if (!canvas || !on) return null;

  const stop = async () => {
    setBusy(true);
    try {
      await api.stopSession(canvas);
      setOpen(false);
    } catch (e) {
      useStore.getState().toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const waiting = on && session.status !== "live";
  return (
    <div className="session">
      {people.length > 0 && (
        <div className="session-faces" aria-label={`${people.map((p) => p.name).join(", ")} here`}>
          {people.slice(0, 3).map((p) => (
            <span key={p.id} className="session-face" style={{ background: p.color }} title={p.name}>
              {initials(p.name)}
            </span>
          ))}
          {people.length > 3 && <span className="session-face more">+{people.length - 3}</span>}
        </div>
      )}
      <button
        ref={btn}
        className={`btn session-btn on${waiting ? " waiting" : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Live session"
      >
        <span className="session-dot" aria-hidden />
        {waiting ? "Connecting" : "Live"}
        {!waiting && <span className="session-time">{elapsed(startedAt[canvas]!)}</span>}
      </button>
      {open && btn.current && (
        <SessionPopover anchor={btn.current} onClose={() => setOpen(false)}>
          <>
              <div className="session-pop-title live">
                <span className="session-dot" aria-hidden /> {waiting ? "Connecting…" : "Live"}
                {!waiting && <span className="session-time">{elapsed(startedAt[canvas]!)}</span>}
              </div>
              <div className="session-pop-link">
                <span className="mono" title={session.url}>
                  {session.url.replace(/^https?:\/\//, "")}
                </span>
                <button
                  className="btn small"
                  onClick={() => {
                    void navigator.clipboard.writeText(session.url);
                    useStore.getState().toast("Link copied", "info");
                  }}
                >
                  <Copy size={12} /> Copy
                </button>
              </div>
              <div className="session-pop-people">
                {people.length ? (
                  people.map((p) => (
                    <div key={p.id} className="session-pop-person">
                      <span className="session-face" style={{ background: p.color }}>
                        {initials(p.name)}
                      </span>
                      {p.name}
                    </div>
                  ))
                ) : (
                  <span className="muted">Nobody else here yet. Send them the link.</span>
                )}
              </div>
              <div className="session-pop-actions">
                <button className="btn danger" onClick={() => void stop()} disabled={busy}>
                  End session
                </button>
              </div>
          </>
        </SessionPopover>
      )}
    </div>
  );
}

function SessionPopover({ anchor, onClose, children }: { anchor: HTMLElement; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const r = anchor.getBoundingClientRect();
  useEffect(() => {
    const outside = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !anchor.contains(t)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("keydown", key, true);
    };
  }, [anchor, onClose]);
  return createPortal(
    <div ref={ref} role="dialog" aria-label="Live session" className="session-pop" style={{ left: Math.max(8, r.right - 300), top: r.bottom + 6 }} onKeyDown={(e) => e.stopPropagation()}>
      {children}
    </div>,
    document.body,
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
