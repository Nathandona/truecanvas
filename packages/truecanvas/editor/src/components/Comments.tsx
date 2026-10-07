import { useEffect, useRef, useState } from "react";
import { Bot, Check, CheckCircle2, CornerDownLeft, MessageCircle, Trash2, Undo2 } from "lucide-react";
import { agentColor, useStore, type Camera, agentLabel } from "../lib/store";
import { api, type CommentAuthor, type CommentThread, type CanvasFrame } from "../lib/api";
import { fitBounds, frameHeight } from "../lib/actions";
import { loadComments } from "../lib/sync";
import { Tip } from "./controls";
import { ago } from "../lib/time";

export function Avatar({ author, size = 22 }: { author: CommentAuthor; size?: number }) {
  const agent = author.kind === "agent";
  return (
    <span className={`c-avatar${agent ? " agent" : ""}${author.kind === "client" ? " client" : ""}`} style={{ width: size, height: size, background: agent ? agentColor(author.name) : undefined, fontSize: size * 0.45 }}>
      {agent ? <Bot size={size * 0.55} /> : author.name.slice(0, 1).toUpperCase()}
    </span>
  );
}

const who = (a: CommentAuthor) => (a.kind === "agent" ? agentLabel(a.name) : a.name);

/** Marks a client's message (from a share link). */
const ClientTag = ({ author }: { author: CommentAuthor }) => (author.kind === "client" ? <span className="c-client">Client</span> : null);

type FramePos = (f: CanvasFrame) => { x: number; y: number; width: number; height: number | null };

/** Pins for comment threads, the open thread, and the draft composer. */
export function CommentLayer({ camera, framePos }: { camera: Camera; framePos: FramePos }) {
  const threads = useStore((s) => s.threads);
  const doc = useStore((s) => s.doc);
  const openId = useStore((s) => s.openThread);
  const draft = useStore((s) => s.draftComment);
  const showResolved = useStore((s) => s.showResolved);
  const tool = useStore((s) => s.tool);
  if (!doc) return null;
  const at = (frameName: string, x: number, y: number) => {
    const f = doc.frames.find((fr) => fr.frameName === frameName);
    if (!f) return null;
    const p = framePos(f);
    return { left: camera.x + (p.x + x) * camera.zoom, top: camera.y + (p.y + y) * camera.zoom };
  };
  const visible = threads.filter((t) => !t.resolved || showResolved || t.id === openId);
  return (
    <>
      {visible.map((t) => {
        const pos = at(t.frame, t.x, t.y);
        if (!pos) return null;
        const first = t.messages[0];
        return (
          <div key={t.id} className="c-pin-wrap" style={pos}>
            <button
              className={`c-pin${t.id === openId ? " open" : ""}${t.resolved ? " resolved" : ""}${tool === "comment" ? "" : " quiet"}`}
              aria-label={`Comment by ${who(first.author)}`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => useStore.setState({ openThread: t.id === openId ? null : t.id, draftComment: null })}
            >
              <Avatar author={first.author} size={22} />
              {t.messages.length > 1 && <span className="c-count">{t.messages.length}</span>}
            </button>
            {t.id === openId && <ThreadCard thread={t} />}
          </div>
        );
      })}
      {draft &&
        (() => {
          const pos = at(draft.frame, draft.x, draft.y);
          return pos ? (
            <div className="c-pin-wrap" style={pos}>
              <span className="c-pin open draft">
                <MessageCircle size={13} />
              </span>
              <DraftCard />
            </div>
          ) : null;
        })()}
    </>
  );
}

function Composer({ placeholder, onSubmit, autoFocus = true }: { placeholder: string; onSubmit: (text: string) => Promise<unknown>; autoFocus?: boolean }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);
  const send = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      await onSubmit(text.trim());
      setText("");
    } catch (e) {
      useStore.getState().toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="c-composer">
      <textarea
        ref={ref}
        rows={Math.min(5, Math.max(1, text.split("\n").length))}
        value={text}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void send();
          }
          if (e.key === "Escape") useStore.setState({ draftComment: null, openThread: null });
        }}
      />
      <button className="icon-btn sm send" disabled={!text.trim() || busy} aria-label="Send" onClick={() => void send()}>
        <CornerDownLeft size={13} />
      </button>
    </div>
  );
}

function DraftCard() {
  const draft = useStore((s) => s.draftComment)!;
  const canvas = useStore((s) => s.canvas)!;
  return (
    <div className="c-card" onPointerDown={(e) => e.stopPropagation()}>
      <Composer
        placeholder={draft.node ? `Comment on ${draft.node.name}…` : "Add a comment…"}
        onSubmit={async (text) => {
          const { thread } = await api.addComment({ canvas, ...draft, text });
          useStore.setState({ draftComment: null, openThread: thread.id });
          loadComments();
        }}
      />
      <div className="c-hint faint">Enter to post · your agent can read it with list_comments</div>
    </div>
  );
}

function ThreadCard({ thread }: { thread: CommentThread }) {
  const canvas = useStore((s) => s.canvas)!;
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [thread.messages.length]);
  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      loadComments();
    } catch (e) {
      useStore.getState().toast((e as Error).message);
    }
  };
  return (
    <div className="c-card" onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <div className="c-card-head">
        <span className="faint">
          {thread.frame}
          {thread.node ? ` · ${thread.node.name}` : ""}
        </span>
        <span className="actions">
          <Tip label={thread.resolved ? "Reopen" : "Resolve"}>
            <button className={`icon-btn sm${thread.resolved ? "" : " resolve"}`} aria-label={thread.resolved ? "Reopen" : "Resolve"} onClick={() => void act(() => api.resolveComment(canvas, thread.id, !thread.resolved))}>
              {thread.resolved ? <Undo2 size={13} /> : <Check size={14} />}
            </button>
          </Tip>
          <Tip label="Delete thread">
            <button
              className="icon-btn sm"
              aria-label="Delete thread"
              onClick={() =>
                void act(async () => {
                  await api.deleteComment(canvas, thread.id);
                  useStore.setState({ openThread: null });
                })
              }
            >
              <Trash2 size={13} />
            </button>
          </Tip>
        </span>
      </div>
      <div className="c-messages" ref={listRef}>
        {thread.messages.map((m) => (
          <div key={m.id} className="c-msg">
            <Avatar author={m.author} size={20} />
            <div className="c-body">
              <div className="c-meta">
                <strong>{who(m.author)}</strong> <ClientTag author={m.author} /> <span className="faint">{ago(m.at)}</span>
              </div>
              <div className="c-text">{m.text}</div>
            </div>
          </div>
        ))}
        {thread.resolved && (
          <div className="c-resolved faint">
            <CheckCircle2 size={13} /> Resolved{thread.resolvedBy ? ` by ${who(thread.resolvedBy)}` : ""}
          </div>
        )}
      </div>
      {thread.share && <div className="c-shared faint">On the share link: your reply goes to the client.</div>}
      <Composer placeholder={thread.share ? "Reply to the client…" : "Reply…"} autoFocus={false} onSubmit={(text) => api.replyComment(canvas, thread.id, text).then(loadComments)} />
    </div>
  );
}

/** Right-panel list of every thread on this page. */
export function CommentsTab() {
  const threads = useStore((s) => s.threads);
  const showResolved = useStore((s) => s.showResolved);
  const openId = useStore((s) => s.openThread);
  const list = threads.filter((t) => showResolved || !t.resolved).sort((a, b) => (b.messages.at(-1)?.at ?? 0) - (a.messages.at(-1)?.at ?? 0));
  const resolvedCount = threads.filter((t) => t.resolved).length;
  const focus = (t: CommentThread) => {
    const s = useStore.getState();
    const f = s.doc?.frames.find((x) => x.frameName === t.frame);
    useStore.setState({ openThread: t.id, draftComment: null });
    if (f) fitBounds({ x: f.x + t.x - 260, y: f.y + t.y - 160, width: 520, height: 320 }, 1.2);
  };
  return (
    <div>
      <div className="section" style={{ paddingBottom: 10 }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span className="muted">
            Press <span className="kbd-chip">C</span> and click a frame to comment.
          </span>
        </div>
        <label className="check-row" style={{ marginTop: 8 }}>
          <input type="checkbox" checked={showResolved} onChange={(e) => useStore.setState({ showResolved: e.target.checked })} />
          Show resolved ({resolvedCount})
        </label>
      </div>
      {!list.length && (
        <div className="empty">
          <MessageCircle size={20} />
          <br />
          No {showResolved ? "" : "open "}comments on this page.
          <br />
          Comments are saved in the repo next to the page, so teammates and agents see them.
        </div>
      )}
      <div className="c-list">
        {list.map((t) => {
          const first = t.messages[0];
          const last = t.messages[t.messages.length - 1];
          return (
            <button key={t.id} className={`c-item${t.id === openId ? " on" : ""}${t.resolved ? " resolved" : ""}`} onClick={() => focus(t)}>
              <Avatar author={first.author} size={22} />
              <div className="c-body">
                <div className="c-meta">
                  <strong>{who(first.author)}</strong>
                  <ClientTag author={first.author} />
                  <span className="faint">
                    {t.frame} · {ago(last.at)}
                  </span>
                </div>
                <div className="c-text clamp">{first.text}</div>
                {t.messages.length > 1 && (
                  <div className="faint" style={{ fontSize: 11, marginTop: 2 }}>
                    {t.messages.length - 1} {t.messages.length === 2 ? "reply" : "replies"}
                    {last.author.kind === "agent" ? ` · last from ${who(last.author)}` : ""}
                  </div>
                )}
              </div>
              {t.resolved && <CheckCircle2 size={14} className="faint" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Frame + frame-local point under a screen position, for placing a new comment. */
export function commentTarget(frames: CanvasFrame[], framePos: FramePos, wx: number, wy: number) {
  for (let i = frames.length - 1; i >= 0; i--) {
    const f = frames[i];
    const p = framePos(f);
    const h = p.height ?? frameHeight(f);
    if (wx >= p.x && wx <= p.x + p.width && wy >= p.y && wy <= p.y + h) return { frame: f, x: wx - p.x, y: wy - p.y };
  }
  return null;
}
