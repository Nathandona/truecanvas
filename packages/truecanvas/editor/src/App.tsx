import { useEffect } from "react";
import { AlertCircle, LoaderCircle, RefreshCw } from "lucide-react";
import { api, subscribe, type RoomEvent, type ServerEvent } from "./lib/api";
import { useStore, agentLabel, type Camera } from "./lib/store";
import { refreshRects } from "./lib/bridge";
import { applyUiTheme, cachedHeights, cameraShowsFrames, revealOnCanvas, setCamera, startAutoFit } from "./lib/actions";
import { CanvasView } from "./components/Canvas";
import { LeftPanel } from "./components/LeftPanel";
import { RightPanel } from "./components/RightPanel";
import { agentColor, loadLayerFlags } from "./lib/store";
import { loadComments, loadGit, loadPr, markDesignChanged } from "./lib/sync";
import { Toolbar } from "./components/Toolbar";
import { CompareBar } from "./components/Compare";
import { ReviewSheet } from "./components/GitPanel";
import { ComponentDialog } from "./components/ComponentDialog";
import { LibrariesDialog } from "./components/LibrariesDialog";
import { ShareDialog } from "./components/ShareDialog";
import { fromServer } from "./lib/scope";

let flashSeq = 0;

export function App() {
  const ready = useStore((s) => s.ready);
  const canvas = useStore((s) => s.canvas);
  const toasts = useStore((s) => s.toasts);
  const appStatus = useStore((s) => s.appStatus);
  const appLog = useStore((s) => s.appLog);
  const appUrl = useStore((s) => s.appUrl);
  const framework = useStore((s) => s.framework);
  const connected = useStore((s) => s.connected);
  const docError = useStore((s) => s.docError);

  // boot
  useEffect(() => {
    applyUiTheme();
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", applyUiTheme);
    void (async () => {
      const state = await api.state();
      const saved = new URLSearchParams(location.search).get("canvas") ?? localStorage.getItem("tc:canvas");
      const canvas = state.canvases.includes(saved ?? "") ? saved : (state.canvases[0] ?? null);
      useStore.setState({
        ready: true,
        appUrl: state.appUrl,
        framework: state.framework ?? "next",
        projectName: state.projectName,
        componentsDir: state.componentsDir ?? "components",
        mcpUrl: state.mcpUrl,
        darkMode: state.darkMode,
        canvases: state.canvases,
        agents: state.agents,
        feed: state.feed,
        canvas,
      });
      loadComponents();
      loadPages();
      loadGit(0);
      loadPr();
    })();
    const gitPoll = setInterval(() => loadGit(0), 15000);
    const prPoll = setInterval(() => loadPr(), 60000);
    const onFocus = () => loadGit(0);
    window.addEventListener("focus", onFocus);
    loadSessions();
    const off = subscribe(
      onEvent,
      (c) => useStore.setState({ connected: c }),
      // the server restarted or the connection dropped: catch up on what was missed
      () => void resync(),
    );
    return () => {
      off();
      media.removeEventListener("change", applyUiTheme);
      clearInterval(gitPoll);
      clearInterval(prPoll);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  // open canvas
  useEffect(() => {
    if (!canvas) return;
    localStorage.setItem("tc:canvas", canvas);
    document.title = `${canvas} · Truecanvas`;
    const url = new URL(location.href);
    url.searchParams.set("canvas", canvas);
    history.replaceState(null, "", url);
    const prevCompare = useStore.getState().compare;
    if (prevCompare) void api.clearCompare().catch(() => {});
    useStore.setState({ selection: [], hover: null, rects: {}, frameReady: {}, frameErrors: {}, frameHeights: cachedHeights(canvas), layerQuery: "", compare: null, threads: [], openThread: null, draftComment: null });
    loadLayerFlags(canvas);
    loadComments();
    // switching again before this answers: the old canvas must not land on the new one
    let stale = false;
    api
      .canvas(canvas)
      .then(({ doc, history }) => {
        if (stale) return;
        useStore.getState().setDoc(doc);
        useStore.setState({ history, expanded: new Set(doc.frames.map((f) => f.id)) });
        // the saved camera, unless it would open on empty space: then show the whole canvas
        let cam: Camera | null = null;
        try {
          cam = JSON.parse(localStorage.getItem(`tc:camera:${canvas}`) ?? "null") as Camera | null;
        } catch {
          cam = null;
        }
        if (cam && cameraShowsFrames(cam, doc.frames)) setCamera(cam);
        else requestAnimationFrame(startAutoFit);
      })
      .catch((err) => !stale && useStore.getState().toast((err as Error).message));
    return () => {
      stale = true;
    };
  }, [canvas]);

  // is the Next.js app reachable?
  useEffect(() => {
    if (!appUrl) return;
    let stop = false;
    const check = async () => {
      try {
        await fetch(appUrl, { mode: "no-cors", cache: "no-store" });
        if (useStore.getState().appStatus !== "up") useStore.setState({ appStatus: "up" });
      } catch {
        // not answering: still compiling after Truecanvas started it, or really down?
        const run = (await fetch("/api/app", { cache: "no-store" })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null)) as { state: string; log: string[] } | null;
        useStore.setState(run?.state === "starting" ? { appStatus: "starting" } : { appStatus: "down", appLog: run?.state === "failed" ? run.log.slice(-6) : [] });
      }
      if (!stop) setTimeout(check, useStore.getState().appStatus === "up" ? 15000 : 2500);
    };
    void check();
    return () => {
      stop = true;
    };
  }, [appUrl]);

  // share selection with agents
  useEffect(
    () =>
      useStore.subscribe((s, prev) => {
        if (s.selection !== prev.selection || s.canvas !== prev.canvas) {
          void api.selection(s.canvas, s.selection).catch(() => {});
          void refreshRects();
        } else if (s.hover !== prev.hover && s.hover && !(s.hover in s.rects)) {
          // hovering a layer in the tree: measure it so the canvas can outline it
          void refreshRects();
        }
      }),
    [],
  );

  if (!ready)
    return (
      <div style={{ display: "grid", placeItems: "center", height: "100%" }} className="faint">
        <LoaderCircle size={18} className="spin-working" />
      </div>
    );

  return (
    <div className="app">
      <LeftPanel />
      <main style={{ position: "relative", minWidth: 0, display: "grid" }}>
        <CanvasView />
        <CompareBar />
        <ReviewSheet />
        <ComponentDialog />
        <LibrariesDialog />
        <ShareDialog />
        <Toolbar />
        {appStatus === "starting" && (
          <div className="banner" role="status">
            <LoaderCircle size={14} className="spin-working" />
            <div>
              <div style={{ fontWeight: 600 }}>Starting your app…</div>
              <div className="muted">
                <span className="mono">{framework === "vite" ? "vite" : "next dev"}</span> is compiling. Frames appear as soon as it answers.
              </div>
            </div>
          </div>
        )}
        {appStatus === "down" && (
          <div className="banner" role="status">
            <span className="dot" />
            <div>
              <div style={{ fontWeight: 600 }}>Your app isn’t running</div>
              <div className="muted">
                Start <span className="mono">{framework === "vite" ? "vite" : "next dev"}</span>. Frames render from <span className="mono">{appUrl}</span>
              </div>
              {appLog.length > 0 && <pre className="mono app-log">{appLog.join("\n")}</pre>}
            </div>
            <button className="btn outline" onClick={() => useStore.setState({ appStatus: "checking" })}>
              <RefreshCw size={13} /> Retry
            </button>
          </div>
        )}
        {docError && (
          <div className="banner" style={{ top: appStatus === "down" || appStatus === "starting" ? 76 : 12 }} role="alert">
            <span className="dot" />
            <div>
              <div style={{ fontWeight: 600 }}>The canvas file has a syntax error</div>
              <div className="muted mono" style={{ maxWidth: 520, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{docError}</div>
            </div>
          </div>
        )}
        {!connected && (
          <div className="banner" style={{ top: appStatus === "down" || appStatus === "starting" ? 76 : 12 }} role="status">
            <LoaderCircle size={14} className="spin-working" />
            <div className="muted">Lost connection to Truecanvas. Reconnecting…</div>
          </div>
        )}
        <div className="toasts">
          {toasts.map((t) => (
            <div key={t.id} className={`toast ${t.tone}`}>
              {t.tone === "error" && <AlertCircle size={14} />}
              <span>{t.text}</span>
              {t.action && (
                <button
                  className="toast-action"
                  onClick={() => {
                    t.action!.run();
                    useStore.setState({ toasts: useStore.getState().toasts.filter((x) => x.id !== t.id) });
                  }}
                >
                  {t.action.label}
                </button>
              )}
            </div>
          ))}
        </div>
      </main>
      <RightPanel />
    </div>
  );
}

function loadPages() {
  api
    .pages()
    .then(({ canvases }) => useStore.setState({ pages: canvases }))
    .catch(() => {});
}

function loadComponents() {
  api
    .components()
    .then(({ components }) => useStore.setState({ components }))
    .catch(() => {});
  api
    .tokens()
    .then((tokens) => useStore.setState({ tokens }))
    .catch(() => {});
}

/** Reloads everything server-side after a reconnect: events sent meanwhile are lost. */
async function resync() {
  const s = useStore.getState();
  try {
    const state = await api.state();
    useStore.setState({ canvases: state.canvases, agents: state.agents, feed: state.feed });
    if (s.canvas && state.canvases.includes(s.canvas)) {
      const { doc, history } = await api.canvas(s.canvas);
      useStore.getState().setDoc(doc);
      useStore.setState({ history });
    }
  } catch {
    return;
  }
  loadComponents();
  loadPages();
  loadComments();
  loadGit(0);
  loadSessions();
}

/** Live sessions running when the editor opens (or reconnects). */
export function loadSessions() {
  void api
    .sessions()
    .then(({ sessions }) => useStore.setState({ sessions: Object.fromEntries(sessions.filter((x) => x.status !== "stopped").map((x) => [x.canvas, x])) }))
    .catch(() => {});
}

/** A live session's room: who's in it, and where their cursors are. */
function onRoom(canvas: string, e: RoomEvent) {
  const people = { ...useStore.getState().roomPeople };
  const me = useStore.getState().sessions[canvas]?.you;
  if (e.t === "hello") {
    for (const [id, p] of Object.entries(people)) if (p.canvas === canvas) delete people[id];
    for (const p of e.people) if (p.id !== e.you.id) people[p.id] = { ...p, canvas, x: null, y: null };
  } else if (e.t === "join") {
    if (e.person.id !== me) people[e.person.id] = { ...e.person, canvas, x: null, y: null };
  } else if (e.t === "leave") delete people[e.id];
  else if (e.t === "cursor") {
    const p = people[e.id];
    if (!p) return;
    people[e.id] = { ...p, x: e.x, y: e.y };
  } else return;
  useStore.setState({ roomPeople: people });
}

function onEvent(e: ServerEvent) {
  const s = useStore.getState();
  switch (e.type) {
    case "session": {
      const sessions = { ...s.sessions };
      if (e.session.status === "stopped") {
        delete sessions[e.session.canvas];
        const people = Object.fromEntries(Object.entries(s.roomPeople).filter(([, p]) => p.canvas !== e.session.canvas));
        useStore.setState({ sessions, roomPeople: people });
        if (e.session.error) s.toast(e.session.error);
      } else useStore.setState({ sessions: { ...sessions, [e.session.canvas]: e.session } });
      break;
    }
    case "room":
      onRoom(e.canvas, e.event);
      break;
    case "comments":
      if (e.canvas === s.canvas) loadComments();
      break;
    case "git":
      markDesignChanged();
      loadGit(0);
      loadPr(true);
      loadPages();
      break;
    case "doc":
      markDesignChanged();
      loadGit(1500);
      if (e.canvas === s.canvas) s.setDoc(e.doc);
      if (s.pages.some((p) => p.name === e.canvas && p.frames !== e.doc.frames.length)) {
        useStore.setState({ pages: s.pages.map((p) => (p.name === e.canvas ? { ...p, frames: e.doc.frames.length } : p)) });
      }
      break;
    case "canvases":
      useStore.setState({ canvases: e.canvases, canvas: s.canvas && e.canvases.includes(s.canvas) ? s.canvas : (e.canvases[0] ?? null) });
      loadPages();
      break;
    case "canvas-renamed": {
      if (s.canvas === e.from) {
        // carry the camera and editor-only layer state over to the new name
        for (const k of ["camera", "hidden", "locked"]) {
          const v = localStorage.getItem(`tc:${k}:${e.from}`);
          if (v) localStorage.setItem(`tc:${k}:${e.to}`, v);
        }
        useStore.setState({ canvas: e.to });
      }
      loadPages();
      break;
    }
    case "catalog":
      loadComponents();
      break;
    case "history":
      if (e.canvas === s.canvas) useStore.setState({ history: { undo: e.undo, redo: e.redo } });
      break;
    case "agents": {
      const live = new Set(e.agents.map((a) => a.session));
      const presence = Object.fromEntries(Object.entries(s.presence).filter(([k]) => live.has(k)));
      useStore.setState({ agents: e.agents, presence });
      break;
    }
    case "presence": {
      // text has no box of its own: point at (and measure) the element around it
      const toElement = (id: string) => {
        const entry = s.index.get(id);
        return entry && entry.node.kind === "text" && entry.parent ? entry.parent.id : id;
      };
      useStore.setState({ presence: { ...s.presence, [e.presence.session]: { ...e.presence, ids: e.presence.ids.map((id) => toElement(fromServer(s.index, id))) } } });
      // edits re-render the frame through HMR first; measure the targets after
      void refreshRects();
      setTimeout(() => void refreshRects(), 400);
      break;
    }
    case "change": {
      useStore.setState({ feed: [...s.feed, e.entry].slice(-300) });
      if (e.entry.actor.kind === "agent" && e.entry.canvas === s.canvas && e.ids.length) {
        const actor = agentLabel(e.entry.actor.name);
        const now = Date.now();
        const color = agentColor(e.entry.actor.name);
        const added = e.ids.map((id) => ({ key: ++flashSeq, id: fromServer(s.index, id), frame: "", actor, color, at: now }));
        useStore.setState({ flashes: [...useStore.getState().flashes, ...added] });
        // the frame re-renders via HMR shortly after; measure then
        setTimeout(() => void refreshRects(), 350);
        setTimeout(() => void refreshRects(), 900);
        setTimeout(() => useStore.setState({ flashes: useStore.getState().flashes.filter((f) => !added.includes(f)) }), 2800);
      }
      break;
    }
    case "motion": {
      if (e.canvas !== s.canvas) break;
      void import("./lib/actions").then((a) => (e.action === "replay" ? a.replayFrame(e.frame) : a.playFrame(e.action === "play" ? e.frame : null)));
      break;
    }
    case "focus":
      revealOnCanvas(e.canvas, e.ids);
      break;
  }
}
