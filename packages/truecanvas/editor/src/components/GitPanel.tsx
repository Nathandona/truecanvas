import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronRight,
  CircleDot,
  Code2,
  ExternalLink,
  GitBranch,
  GitCommitHorizontal,
  GitCompare,
  GitMerge,
  GitPullRequest,
  Image as ImageIcon,
  LoaderCircle,
  Plus,
  RefreshCw,
  UploadCloud,
  X,
} from "lucide-react";
import { useStore } from "../lib/store";
import { api, type GitCommit, type PageReview, type PullRequest } from "../lib/api";
import { Select, Tip } from "./controls";
import { loadGit, loadPr, markDesignChanged } from "../lib/sync";
import { fitBounds, frameHeight } from "../lib/actions";
import { draftMessage, frameLabels, suggestBranch, titleOf } from "../lib/review";
import { comparePlacement } from "./Compare";

function ago(t: number) {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

/** Start comparing the current page with a ref (branch, commit, HEAD). */
export async function startCompare(ref: string, label = ref) {
  const s = useStore.getState();
  if (!s.canvas) return;
  try {
    const res = await api.compare(s.canvas, ref);
    useStore.setState({ compare: { ref, label, name: res.name, doc: res.doc, changes: res.changes, mode: s.compare?.mode ?? "side", opacity: s.compare?.opacity ?? 0.5 }, selection: [] });
    // frame both versions
    requestAnimationFrame(() => {
      const now = useStore.getState().doc?.frames ?? [];
      const boxes = [...now.map((f) => ({ x: f.x, y: f.y, width: f.width, height: frameHeight(f) })), ...res.doc.frames.map((f) => comparePlacement(f))];
      if (!boxes.length) return;
      const x = Math.min(...boxes.map((b) => b.x));
      const y = Math.min(...boxes.map((b) => b.y));
      fitBounds({ x, y, width: Math.max(...boxes.map((b) => b.x + b.width)) - x, height: Math.max(...boxes.map((b) => b.y + b.height)) - y });
    });
  } catch (e) {
    s.toast((e as Error).message, "info");
  }
}

export async function stopCompare() {
  useStore.setState({ compare: null });
  await api.clearCompare().catch(() => {});
}

/** Canvas files, plus pages and layouts that linked frames edit. */
function isDesignFile(file: string, canvasDir: string, linked: string[] | undefined) {
  return file.startsWith(`${canvasDir}/`) || !!linked?.includes(file);
}

const frameCount = (pages: PageReview[]) => pages.reduce((n, p) => n + p.frames.length, 0);

// ---------- shared actions ----------

/** The commit message: what the user typed, else a draft from what changed. */
function useCommitMessage() {
  const review = useStore((s) => s.review);
  const message = useStore((s) => s.commitMessage);
  const touched = useStore((s) => s.commitTouched);
  const value = touched ? message : draftMessage(review);
  const set = (v: string) => useStore.setState({ commitMessage: v, commitTouched: true });
  return [value, set] as const;
}

async function commit(message: string, scope: "canvas" | "all") {
  const { hash } = await api.gitCommit(message, scope);
  useStore.setState({ commitMessage: "", commitTouched: false });
  markDesignChanged();
  loadGit(0);
  return hash;
}

async function run<T>(fn: () => Promise<T>, done?: string): Promise<T | null> {
  try {
    const out = await fn();
    if (done) useStore.getState().toast(done, "info");
    return out;
  } catch (e) {
    useStore.getState().toast((e as Error).message);
    return null;
  }
}

function prState(pr: PullRequest) {
  if (pr.state === "MERGED") return { text: "Merged", tone: "merged" };
  if (pr.state === "CLOSED") return { text: "Closed", tone: "closed" };
  if (pr.checks.failed) return { text: `${pr.checks.failed} check${pr.checks.failed === 1 ? "" : "s"} failing`, tone: "failing" };
  if (pr.review === "CHANGES_REQUESTED") return { text: "Changes requested", tone: "failing" };
  if (pr.checks.pending) return { text: "Checks running", tone: "pending" };
  if (pr.review === "APPROVED") return { text: "Approved", tone: "open" };
  return { text: pr.draft ? "Draft" : "Open", tone: pr.draft ? "pending" : "open" };
}

// ---------- branch pill ----------

export function BranchPill() {
  const git = useStore((s) => s.git);
  const pr = useStore((s) => s.pr?.pr ?? null);
  const canvasDir = useStore((s) => s.doc?.file.split("/").slice(0, -1).join("/") ?? "canvas");
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  if (!git) return null;
  const pageChanges = git.files.filter((f) => isDesignFile(f.path, canvasDir, git.linked)).length;
  return (
    <>
      <Tip label={git.repo ? `Branch ${git.branch ?? "(detached)"}${pageChanges ? `, ${pageChanges} changed design files` : ""}${pr ? `, PR #${pr.number}: ${prState(pr).text}` : ""}` : "Not a git repository"} side="bottom">
        <button ref={btn} className={`branch-pill${open ? " on" : ""}`} onClick={() => setOpen(!open)} aria-label="Git">
          <GitBranch size={12} />
          <span className="name">{git.repo ? (git.branch ?? "detached") : "no git"}</span>
          {pageChanges > 0 && <span className="dot-count">{pageChanges}</span>}
          {pr && <span className={`pr-dot ${prState(pr).tone}`} />}
          {git.behind > 0 && (
            <span className="ab">
              <ArrowDown size={10} />
              {git.behind}
            </span>
          )}
          {git.ahead > 0 && (
            <span className="ab">
              <ArrowUp size={10} />
              {git.ahead}
            </span>
          )}
        </button>
      </Tip>
      {open && <GitPopover anchor={btn.current!} onClose={() => setOpen(false)} />}
    </>
  );
}

// ---------- popover ----------

function GitPopover({ anchor, onClose }: { anchor: HTMLElement; onClose: () => void }) {
  const git = useStore((s) => s.git)!;
  const review = useStore((s) => s.review);
  const pr = useStore((s) => s.pr?.pr ?? null);
  const onGithub = useStore((s) => !!s.pr?.github);
  const canvas = useStore((s) => s.canvas);
  const canvasDir = useStore((s) => s.doc?.file.split("/").slice(0, -1).join("/") ?? "canvas");
  const ref = useRef<HTMLDivElement>(null);
  const [branches, setBranches] = useState<{ current: string | null; local: string[]; remote: string[] } | null>(null);
  const [log, setLog] = useState<GitCommit[]>([]);
  const [message, setMessage] = useCommitMessage();
  const [scope, setScope] = useState<"canvas" | "all">("canvas");
  const [busy, setBusy] = useState<string | null>(null);
  const [newBranch, setNewBranch] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [prDialog, setPrDialog] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const r = anchor.getBoundingClientRect();

  const reload = () => {
    void api.gitBranches().then(setBranches).catch(() => {});
    void api.gitLog().then(({ commits }) => setLog(commits)).catch(() => {});
    markDesignChanged();
    loadGit(0);
    loadPr(true);
  };
  useEffect(() => {
    reload();
    // remote counts are only as fresh as the last fetch
    void api.gitFetch().then((g) => useStore.setState({ git: g })).catch(() => {});
    const outside = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (!ref.current?.contains(t) && !anchor.contains(t) && !t.closest?.(".listbox, .modal-backdrop, .review-sheet")) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector(".modal-backdrop, .review-sheet")) {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("keydown", key, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvas]);

  const act = async (label: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(label);
    await run(fn, done);
    setBusy(null);
    reload();
  };

  const pageFiles = git.files.filter((f) => isDesignFile(f.path, canvasDir, git.linked));
  const otherFiles = git.files.length - pageFiles.length;
  const toCommit = scope === "canvas" ? pageFiles.length : git.files.length;
  const onDefault = !!git.branch && git.branch === git.defaultBranch;
  const canOpenPr = git.repo && onGithub && !!git.branch && !onDefault && !pr && !git.unborn;
  const openReview = (canvasName: string, frame: string | null) => useStore.setState({ reviewing: { canvas: canvasName, frame } });

  return createPortal(
    <div ref={ref} className="git-pop" style={{ left: r.left, top: r.bottom + 6 }} onKeyDown={(e) => e.stopPropagation()}>
      {!git.repo ? (
        <div className="empty" style={{ padding: 18 }}>
          This project isn’t a git repository yet.
          <br />
          Run <span className="mono">git init</span> in it to version your canvases.
        </div>
      ) : (
        <>
          <div className="git-row">
            <div style={{ flex: 1 }}>
              {newBranch === null ? (
                <Select
                  value={git.branch ?? ""}
                  placeholder="Detached HEAD"
                  options={[
                    ...(branches?.local ?? []).map((b) => ({ value: b, label: b, icon: <GitBranch size={13} />, hint: b === git.defaultBranch ? "default" : undefined })),
                    { value: "__new", label: "New branch…", icon: <Plus size={13} /> },
                  ]}
                  onChange={(b) => (b === "__new" ? setNewBranch(suggestBranch(review, canvas)) : void act("switch", () => api.gitSwitch(b), `Switched to ${b}`))}
                  ariaLabel="Branch"
                />
              ) : (
                <BranchInput
                  value={newBranch}
                  onChange={setNewBranch}
                  onCancel={() => setNewBranch(null)}
                  onSubmit={(b) => {
                    setNewBranch(null);
                    void act("switch", () => api.gitSwitch(b, true), `Created ${b}. Your changes came with you.`);
                  }}
                />
              )}
            </div>
            <Tip label={git.behind ? `Pull ${git.behind} commit${git.behind === 1 ? "" : "s"}` : "Pull"}>
              <button className="btn outline" disabled={!!busy || !git.remote} onClick={() => void act("pull", () => api.gitPull(), "Pulled")}>
                {busy === "pull" ? <LoaderCircle size={13} className="spin-working" /> : <ArrowDown size={13} />}
                {git.behind || ""}
              </button>
            </Tip>
            <Tip label={git.upstream ? `Push ${git.ahead} commit${git.ahead === 1 ? "" : "s"}` : "Push and track on origin"}>
              <button className="btn outline" disabled={!!busy || !git.remote || (!!git.upstream && !git.ahead)} onClick={() => void act("push", () => api.gitPush(), "Pushed")}>
                {busy === "push" ? <LoaderCircle size={13} className="spin-working" /> : <ArrowUp size={13} />}
                {git.ahead || ""}
              </button>
            </Tip>
          </div>

          {/* branch-first: design work goes on a branch so it can be reviewed */}
          {onDefault && review.length > 0 && newBranch === null && (
            <div className="git-banner">
              <GitBranch size={14} />
              <div className="text">
                <strong>You’re on {git.branch}.</strong> Start a branch so these changes can be reviewed in a pull request. Your edits come with you.
              </div>
              <button className="btn primary small" onClick={() => setNewBranch(suggestBranch(review, canvas))}>
                Start a branch
              </button>
            </div>
          )}
          {!git.remote && !git.unborn && (
            <div className="git-banner muted">
              <UploadCloud size={14} />
              <div className="text">
                <strong>Not on GitHub yet.</strong> Publish the project to push branches and open pull requests.
              </div>
              <button className="btn outline small" onClick={() => setPublishing(true)}>
                Publish
              </button>
            </div>
          )}

          {pr && <PrCard pr={pr} ahead={git.ahead} />}

          <div className="git-section-title">
            <span>Changes</span>
            <span className="actions">
              {review.length > 0 && (
                <button className="link" onClick={() => openReview(review.find((p) => p.canvas === canvas)?.canvas ?? review[0].canvas, null)}>
                  Review {frameCount(review)} frame{frameCount(review) === 1 ? "" : "s"}
                  <ChevronRight size={12} />
                </button>
              )}
              <button className="icon-btn sm" aria-label="Refresh" onClick={reload}>
                <RefreshCw size={12} />
              </button>
            </span>
          </div>
          {review.length === 0 && <div className="faint git-note">No design changes since the last commit{otherFiles ? `, ${otherFiles} other file${otherFiles === 1 ? "" : "s"} changed` : ""}.</div>}
          <div className="git-changes">
            {review.map((page) =>
              page.frames.map((f) => (
                <button key={`${page.canvas}/${f.name}`} className="git-change" onClick={() => openReview(page.canvas, f.name)}>
                  <span className={`change-mark ${f.status}`} />
                  <span className="what">
                    <span className="frame-name">
                      {f.name}
                      {review.length > 1 || page.canvas !== canvas ? <span className="faint"> · {page.canvas}</span> : null}
                    </span>
                    <span className="faint labels">{changeSummary(f)}</span>
                  </span>
                  <ChevronRight size={13} className="faint" />
                </button>
              )),
            )}
          </div>
          {otherFiles > 0 && review.length > 0 && <div className="faint git-note">+ {otherFiles} other changed file{otherFiles === 1 ? "" : "s"} in the project</div>}

          <CommitBox message={message} setMessage={setMessage} scope={scope} setScope={setScope} toCommit={toCommit} pageCount={pageFiles.length} allCount={git.files.length} busy={busy} setBusy={setBusy} after={reload} unborn={git.unborn} />

          {canOpenPr && (
            <button className="btn outline pr-btn" disabled={!!busy || pageFiles.length > 0} title={pageFiles.length ? "Commit your design changes first" : undefined} onClick={() => setPrDialog(true)}>
              <GitPullRequest size={13} /> Open pull request
            </button>
          )}

          <button className="git-section-title toggle" onClick={() => setHistoryOpen(!historyOpen)}>
            <span>
              <ChevronRight size={12} className={historyOpen ? "rot" : ""} /> History & compare
            </span>
          </button>
          {historyOpen && (
            <>
              <div className="git-row">
                <div style={{ flex: 1 }}>
                  <Select
                    value=""
                    placeholder="Compare this page with…"
                    options={[
                      ...(git.unborn ? [] : [{ value: "HEAD", label: "Last commit", hint: "HEAD", icon: <GitCommitHorizontal size={13} /> }]),
                      ...(branches?.local ?? []).filter((b) => b !== git.branch).map((b) => ({ value: b, label: b, icon: <GitBranch size={13} /> })),
                      ...(branches?.remote ?? []).map((b) => ({ value: b, label: b, icon: <GitBranch size={13} /> })),
                    ]}
                    onChange={(ref) => {
                      onClose();
                      void startCompare(ref, ref === "HEAD" ? "last commit" : ref);
                    }}
                    ariaLabel="Compare with"
                  />
                </div>
              </div>
              <div className="git-log">
                {log.length === 0 && <div className="faint git-note">No commits yet.</div>}
                {log.slice(0, 12).map((c) => (
                  <div key={c.hash} className="git-commit">
                    <GitCommitHorizontal size={13} className="faint" />
                    <div className="msg">
                      <div className="subject">{c.subject}</div>
                      <div className="faint">
                        {c.author} · {ago(c.at)} · <span className="mono">{c.short}</span>
                      </div>
                    </div>
                    <Tip label="Compare with this version">
                      <button
                        className="icon-btn sm"
                        aria-label={`Compare with ${c.short}`}
                        onClick={() => {
                          onClose();
                          void startCompare(c.hash, c.short);
                        }}
                      >
                        <GitCompare size={13} />
                      </button>
                    </Tip>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
      {prDialog && <PrDialog defaultTitle={log[0]?.subject ?? ""} onClose={() => setPrDialog(false)} />}
      {publishing && <PublishDialog onClose={() => setPublishing(false)} />}
    </div>,
    document.body,
  );
}

function changeSummary(f: PageReview["frames"][number]) {
  if (f.status === "added") return "New frame";
  if (f.status === "removed") return "Removed";
  const labels = frameLabels(f.changes);
  if (!labels.length) return "Edited";
  return labels.slice(0, 2).join(" · ") + (labels.length > 2 ? ` · +${labels.length - 2}` : "");
}

function BranchInput({ value, onChange, onSubmit, onCancel }: { value: string; onChange: (v: string) => void; onSubmit: (v: string) => void; onCancel: () => void }) {
  return (
    <div className="field">
      <span className="prefix">
        <GitBranch size={13} />
      </span>
      <input
        autoFocus
        value={value}
        placeholder="design/new-onboarding"
        onFocus={(e) => e.target.select()}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && value.trim()) onSubmit(value.trim());
          if (e.key === "Escape") {
            e.stopPropagation();
            onCancel();
          }
        }}
        onBlur={() => !value && onCancel()}
      />
    </div>
  );
}

function CommitBox(props: {
  message: string;
  setMessage: (v: string) => void;
  scope: "canvas" | "all";
  setScope: (v: "canvas" | "all") => void;
  toCommit: number;
  pageCount: number;
  allCount: number;
  busy: string | null;
  setBusy: (v: string | null) => void;
  after: () => void;
  unborn: boolean;
}) {
  const { message, setMessage, scope, setScope, toCommit, busy } = props;
  const doCommit = async () => {
    if (!message.trim() || !toCommit || busy) return;
    props.setBusy("commit");
    await run(() => commit(message, scope), "Committed");
    props.setBusy(null);
    props.after();
  };
  return (
    <div className="commit-box">
      <div className="field area">
        <textarea
          rows={Math.min(6, Math.max(2, message.split("\n").length))}
          value={message}
          placeholder={`Describe the change${props.unborn ? " (first commit)" : ""}`}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void doCommit();
          }}
        />
      </div>
      <div className="git-row" style={{ marginTop: 6 }}>
        <div style={{ flex: 1 }}>
          <Select
            value={scope}
            options={[
              { value: "canvas", label: "Design changes", hint: String(props.pageCount) },
              { value: "all", label: "All changes", hint: String(props.allCount) },
            ]}
            onChange={(v) => setScope(v as "canvas" | "all")}
            ariaLabel="What to commit"
          />
        </div>
        <Tip label="Commit" kbd="Ctrl+Enter">
          <button className="btn primary" disabled={!!busy || !message.trim() || !toCommit} onClick={() => void doCommit()}>
            {busy === "commit" ? <LoaderCircle size={13} className="spin-working" /> : <Check size={13} />} Commit
          </button>
        </Tip>
      </div>
    </div>
  );
}

function PrCard({ pr, ahead }: { pr: PullRequest; ahead: number }) {
  const st = prState(pr);
  return (
    <a className={`pr-card ${st.tone}`} href={pr.url} target="_blank" rel="noreferrer">
      {pr.state === "MERGED" ? <GitMerge size={15} /> : <GitPullRequest size={15} />}
      <span className="what">
        <span className="title">
          #{pr.number} {pr.title}
        </span>
        <span className="faint">
          {st.text}
          {pr.checks.passed && !pr.checks.failed && !pr.checks.pending ? ` · ${pr.checks.passed} checks passed` : ""}
          {ahead > 0 && pr.state === "OPEN" ? ` · ${ahead} new commit${ahead === 1 ? "" : "s"} to push` : ""}
        </span>
      </span>
      <ExternalLink size={13} className="faint" />
    </a>
  );
}

// ---------- pull request & publish dialogs ----------

function PrDialog({ defaultTitle, onClose }: { defaultTitle: string; onClose: () => void }) {
  const git = useStore((s) => s.git)!;
  const [title, setTitle] = useState(defaultTitle);
  const [body, setBody] = useState("");
  const [screenshots, setScreenshots] = useState(true);
  const [draft, setDraft] = useState(false);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const create = async () => {
    setBusy(true);
    const res = await run(() => api.gitCreatePr({ title, body, screenshots, draft }));
    setBusy(false);
    if (res) {
      setUrl(res.url);
      loadPr(true);
      loadGit(0);
    }
  };
  return createPortal(
    <div className="modal-backdrop" onPointerDown={() => !busy && onClose()}>
      <div className="modal" style={{ width: 460 }} onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => (e.stopPropagation(), e.key === "Escape" && !busy && onClose())}>
        {url ? (
          <>
            <div className="modal-title">Pull request opened</div>
            <p className="muted">Reviewers see the design changes frame by frame{screenshots ? ", with before and after images" : ""}.</p>
            <div className="modal-actions">
              <button className="btn outline" onClick={onClose}>
                Close
              </button>
              <a className="btn primary" href={url} target="_blank" rel="noreferrer" onClick={onClose}>
                <ExternalLink size={13} /> Open on GitHub
              </a>
            </div>
          </>
        ) : (
          <>
            <div className="modal-title">Open a pull request</div>
            <p className="muted">
              <span className="mono">{git.branch}</span> into <span className="mono">{git.defaultBranch ?? "main"}</span>. The description lists what changed in each frame.
            </p>
            <div className="field" style={{ marginBottom: 8 }}>
              <input autoFocus value={title} placeholder="Title" onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="field area" style={{ marginBottom: 10 }}>
              <textarea rows={4} value={body} placeholder="What's this for? (optional)" onChange={(e) => setBody(e.target.value)} />
            </div>
            <label className="check-row">
              <input type="checkbox" checked={screenshots} onChange={(e) => setScreenshots(e.target.checked)} />
              <ImageIcon size={13} /> Before / after images of changed frames
            </label>
            {screenshots && (
              <div className="faint git-note" style={{ margin: "2px 0 6px 22px" }}>
                Stored on a <span className="mono">truecanvas-previews</span> branch of the repo, so they stay as private as the repo.
              </div>
            )}
            <label className="check-row" style={{ marginBottom: 14 }}>
              <input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} />
              <CircleDot size={13} /> Draft
            </label>
            <div className="modal-actions">
              <button className="btn outline" disabled={busy} onClick={onClose}>
                Cancel
              </button>
              <button className="btn primary" disabled={busy || !title.trim()} onClick={() => void create()}>
                {busy ? <LoaderCircle size={13} className="spin-working" /> : <GitPullRequest size={13} />}
                {busy ? (screenshots ? "Pushing and rendering…" : "Pushing…") : "Open pull request"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

function PublishDialog({ onClose }: { onClose: () => void }) {
  const project = useStore((s) => s.projectName || "project");
  const [name, setName] = useState(project.replace(/[^\w.-]+/g, "-"));
  const [isPrivate, setPrivate] = useState(true);
  const [busy, setBusy] = useState(false);
  const publish = async () => {
    setBusy(true);
    const res = await run(() => api.gitPublish(name, isPrivate), "Published to GitHub");
    setBusy(false);
    if (res) {
      loadGit(0);
      loadPr(true);
      onClose();
    }
  };
  return createPortal(
    <div className="modal-backdrop" onPointerDown={() => !busy && onClose()}>
      <div className="modal" style={{ width: 400 }} onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => (e.stopPropagation(), e.key === "Escape" && !busy && onClose())}>
        <div className="modal-title">Publish to GitHub</div>
        <p className="muted">Creates a repository on your GitHub account (with the GitHub CLI) and pushes this project to it.</p>
        <div className="field" style={{ marginBottom: 10 }}>
          <span className="prefix">
            <GitBranch size={13} />
          </span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} aria-label="Repository name" />
        </div>
        <label className="check-row" style={{ marginBottom: 14 }}>
          <input type="checkbox" checked={isPrivate} onChange={(e) => setPrivate(e.target.checked)} /> Private repository
        </label>
        <div className="modal-actions">
          <button className="btn outline" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy || !/^[\w.-]+$/.test(name)} onClick={() => void publish()}>
            {busy ? <LoaderCircle size={13} className="spin-working" /> : <UploadCloud size={13} />} Publish
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ---------- review sheet ----------

/** Full-screen review of uncommitted changes: before/after per frame, what was done, and the code. */
export function ReviewSheet() {
  const reviewing = useStore((s) => s.reviewing);
  const review = useStore((s) => s.review);
  const git = useStore((s) => s.git);
  const canvasDir = useStore((s) => s.doc?.file.split("/").slice(0, -1).join("/") ?? "canvas");
  const [tab, setTab] = useState<"visual" | "code">("visual");
  const [message, setMessage] = useCommitMessage();
  const [busy, setBusy] = useState(false);
  const close = () => useStore.setState({ reviewing: null });
  useEffect(() => {
    if (!reviewing) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector(".modal-backdrop")) {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [reviewing]);
  if (!reviewing || !git) return null;
  const page = review.find((p) => p.canvas === reviewing.canvas) ?? review[0];
  const frame = page?.frames.find((f) => f.name === reviewing.frame) ?? page?.frames[0];
  const pick = (canvas: string, f: string) => useStore.setState({ reviewing: { canvas, frame: f } });
  const designFiles = git.files.filter((f) => isDesignFile(f.path, canvasDir, git.linked)).length;

  return createPortal(
    <div className="review-sheet" onKeyDown={(e) => e.stopPropagation()}>
      <div className="review-head">
        <div className="title">
          Review changes
          <span className="faint">
            {" "}
            · {frameCount(review)} frame{frameCount(review) === 1 ? "" : "s"} on <span className="mono">{git.branch}</span> since the last commit
          </span>
        </div>
        <div className="seg">
          <button className={tab === "visual" ? "on" : ""} onClick={() => setTab("visual")}>
            <ImageIcon size={13} /> Before / after
          </button>
          <button className={tab === "code" ? "on" : ""} onClick={() => setTab("code")}>
            <Code2 size={13} /> Code
          </button>
        </div>
        <button className="icon-btn" aria-label="Close" onClick={close}>
          <X size={15} />
        </button>
      </div>
      {!page || !frame ? (
        <div className="empty" style={{ padding: 40, flex: 1 }}>
          Nothing to review: no design changes since the last commit.
        </div>
      ) : (
        <div className="review-body">
          <div className="review-list">
            {review.map((p) => (
              <div key={p.canvas}>
                <div className="review-page">{p.canvas}</div>
                {p.frames.map((f) => (
                  <button key={f.name} className={`git-change${p.canvas === page.canvas && f.name === frame.name ? " on" : ""}`} onClick={() => pick(p.canvas, f.name)}>
                    <span className={`change-mark ${f.status}`} />
                    <span className="what">
                      <span className="frame-name">{f.name}</span>
                      <span className="faint labels">{changeSummary(f)}</span>
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </div>
          <div className="review-main">{tab === "visual" ? <VisualDiff page={page} frameName={frame.name} /> : <CodeDiff canvas={page.canvas} />}</div>
        </div>
      )}
      <div className="review-foot">
        <div className="field area" style={{ flex: 1 }}>
          <textarea rows={Math.min(4, Math.max(1, message.split("\n").length))} value={message} placeholder="Describe the change" onChange={(e) => setMessage(e.target.value)} />
        </div>
        <button
          className="btn primary"
          disabled={busy || !message.trim() || !designFiles}
          onClick={async () => {
            setBusy(true);
            const ok = await run(() => commit(message, "canvas"), `Committed: ${titleOf(message)}`);
            setBusy(false);
            if (ok) close();
          }}
        >
          {busy ? <LoaderCircle size={13} className="spin-working" /> : <Check size={13} />} Commit design changes
        </button>
      </div>
    </div>,
    document.body,
  );
}

function VisualDiff({ page, frameName }: { page: PageReview; frameName: string }) {
  const frame = page.frames.find((f) => f.name === frameName)!;
  const labels = frameLabels(frame.changes);
  const version = `${frame.changes.length}:${frame.changes.at(-1)?.at ?? 0}:${page.files.join(",")}`;
  const left = useRef<HTMLDivElement>(null);
  const right = useRef<HTMLDivElement>(null);
  const lock = useRef<HTMLDivElement | null>(null);
  // the two sides scroll together
  const follow = (from: HTMLDivElement | null, to: HTMLDivElement | null) => {
    if (!from || !to || (lock.current && lock.current !== from)) return;
    lock.current = from;
    const ratio = from.scrollTop / Math.max(1, from.scrollHeight - from.clientHeight);
    to.scrollTop = ratio * (to.scrollHeight - to.clientHeight);
    requestAnimationFrame(() => (lock.current = null));
  };
  return (
    <div className="visual-diff">
      <div className="change-chips">
        {frame.status === "added" && <span className="chip added">New frame</span>}
        {frame.status === "removed" && <span className="chip removed">Frame removed</span>}
        {labels.map((l) => (
          <span key={l} className="chip">
            {l}
          </span>
        ))}
        {frame.status === "changed" && !labels.length && <span className="chip faint">Edited outside this session (see Code)</span>}
      </div>
      <div className="sides">
        <Side title="Last commit" scrollRef={left} onScroll={() => follow(left.current, right.current)}>
          {frame.status === "added" ? <div className="side-empty">Not in the last commit</div> : <Shot src={api.previewUrl(page.canvas, frameName, "before", version)} />}
        </Side>
        <Side title="Now" scrollRef={right} onScroll={() => follow(right.current, left.current)}>
          {frame.status === "removed" ? <div className="side-empty">Removed</div> : <Shot src={api.previewUrl(page.canvas, frameName, "after", version)} />}
        </Side>
      </div>
    </div>
  );
}

function Side({ title, scrollRef, onScroll, children }: { title: string; scrollRef: React.RefObject<HTMLDivElement | null>; onScroll: () => void; children: ReactNode }) {
  return (
    <div className="side">
      <div className="side-title">{title}</div>
      <div className="side-scroll" ref={scrollRef} onScroll={onScroll}>
        {children}
      </div>
    </div>
  );
}

function Shot({ src }: { src: string }) {
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  useEffect(() => setState("loading"), [src]);
  return (
    <>
      {state === "loading" && (
        <div className="side-empty">
          <LoaderCircle size={16} className="spin-working" /> Rendering…
        </div>
      )}
      {state === "error" && <div className="side-empty">Couldn’t render this version.</div>}
      <img src={src} alt="" style={{ display: state === "ok" ? "block" : "none" }} onLoad={() => setState("ok")} onError={() => setState("error")} />
    </>
  );
}

function CodeDiff({ canvas }: { canvas: string }) {
  const [diff, setDiff] = useState<string | null>(null);
  const review = useStore((s) => s.review);
  useEffect(() => {
    setDiff(null);
    void api
      .gitDiff(canvas)
      .then((r) => setDiff(r.diff))
      .catch(() => setDiff(""));
  }, [canvas, review]);
  if (diff === null)
    return (
      <div className="side-empty">
        <LoaderCircle size={16} className="spin-working" />
      </div>
    );
  if (!diff.trim()) return <div className="side-empty">No code changes.</div>;
  return (
    <pre className="code-diff">
      {diff.split("\n").map((line, i) => {
        const cls = line.startsWith("diff --git")
          ? "file"
          : line.startsWith("@@")
            ? "hunk"
            : line.startsWith("+") && !line.startsWith("+++")
              ? "add"
              : line.startsWith("-") && !line.startsWith("---")
                ? "del"
                : /^(index|---|\+\+\+|new file|deleted file|similarity|rename)/.test(line)
                  ? "meta"
                  : "";
        if (cls === "meta") return null;
        return (
          <div key={i} className={cls}>
            {cls === "file" ? line.replace(/^diff --git a\/(\S+) b\/.*$/, "$1") : line || " "}
          </div>
        );
      })}
    </pre>
  );
}
