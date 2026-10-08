import { Dialog } from "../components/Dialog";
import { ago } from "../lib/time";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ChevronRight,
  Cpu,
  Folder,
  FolderOpen,
  FolderPlus,
  CloudDownload,
  GitPullRequest,
  Lock,
  LayoutGrid,
  LoaderCircle,
  MoreHorizontal,
  Plus,
  Power,
  RefreshCw,
  Search,
  Wand2,
  X,
  Download,
  Info,
} from "lucide-react";
import { Menu } from "../components/Menu";
import { Tip } from "../components/controls";

interface Project {
  path: string;
  name: string;
  lastOpened: number;
  next: boolean;
  ready: boolean;
  canvases: number;
  exists: boolean;
  running: { status: "starting" | "ready" | "failed"; editor: string; app: string; error?: string; memory: number | null } | null;
}
interface HubState {
  origin: string;
  /** the running Truecanvas's version */
  version?: string;
  active: string | null;
  /** the CLI asked to show this project (`truecanvas` run inside it), or a notification, with one of its canvases */
  focus: { path: string; at: number; canvas?: string } | null;
  /** a problem to show at the top (the desktop app: Node isn't installed) */
  notice?: string | null;
  projects: Project[];
}
interface Job {
  id: string;
  title: string;
  status: "running" | "done" | "failed";
  log: string[];
  result?: string;
}

async function call<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, body === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

const home = (p: string) => p.replace(/^\/home\/[^/]+/, "~");

function applyTheme() {
  const pref = (() => {
    try {
      return JSON.parse(localStorage.getItem("tc:uiTheme") ?? '"system"');
    } catch {
      return "system";
    }
  })();
  const dark = pref === "dark" || (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.ui = dark ? "dark" : "light";
}

export function HubApp() {
  const [state, setState] = useState<HubState | null>(null);
  const [tab, setTab] = useState<string>(() => localStorage.getItem("tc:hubTab") ?? "dashboard");
  const [error, setError] = useState<string | null>(null);

  const [connected, setConnected] = useState(true);
  // background refreshes fail quietly; a dropped event stream means the hub is gone
  // polling and server events overlap: only the newest request may set the state
  const latestRefresh = useRef(0);
  const refresh = useCallback(() => {
    const seq = ++latestRefresh.current;
    call<HubState>("/api/hub/state")
      .then((s) => seq === latestRefresh.current && setState(s))
      .catch(() => {});
  }, []);

  useEffect(() => {
    applyTheme();
    const scheme = window.matchMedia("(prefers-color-scheme: dark)");
    scheme.addEventListener("change", applyTheme);
    refresh();
    const es = new EventSource("/api/hub/events");
    es.onmessage = () => refresh();
    es.onopen = () => {
      setConnected(true);
      refresh();
    };
    es.onerror = () => setConnected(false);
    const poll = setInterval(refresh, 5000); // memory figures
    return () => {
      scheme.removeEventListener("change", applyTheme);
      es.close();
      clearInterval(poll);
    };
  }, [refresh]);

  const open = useMemo(() => (state?.projects ?? []).filter((p) => p.running), [state]);

  // a project being opened has its tab selected before it shows up as running
  const opening = useRef<string | null>(null);
  // keep the selected tab valid, and tell the hub which project the agent should use
  useEffect(() => {
    if (!state) return;
    if (open.some((p) => p.path === opening.current)) opening.current = null;
    if (tab !== "dashboard" && tab !== opening.current && !open.some((p) => p.path === tab)) setTab("dashboard");
  }, [state, open, tab]);
  // tell the hub which project agents should act on, only when the tab actually changes
  useEffect(() => {
    localStorage.setItem("tc:hubTab", tab);
    void call("/api/hub/active", { path: tab === "dashboard" ? "" : tab }).catch(() => {});
  }, [tab]);
  // `truecanvas` run in a project folder while the window is open: switch to its tab
  // (requests from before this window opened aren't news)
  const seenFocus = useRef(Date.now());
  // a canvas to show in a project's tab: its editor reloads on it
  const [canvasFor, setCanvasFor] = useState<Record<string, { canvas: string; at: number }>>({});
  useEffect(() => {
    const f = state?.focus;
    if (!f || f.at <= seenFocus.current || !open.some((p) => p.path === f.path)) return;
    seenFocus.current = f.at;
    setTab(f.path);
    const canvas = f.canvas;
    if (canvas) setCanvasFor((m) => ({ ...m, [f.path]: { canvas, at: f.at } }));
  }, [state, open]);
  const activeName = open.find((x) => x.path === tab)?.name;
  useEffect(() => {
    document.title = activeName ? `${activeName} · Truecanvas` : "Truecanvas";
  }, [activeName]);

  const openProject = async (p: { path: string }) => {
    opening.current = p.path;
    setTab(p.path);
    try {
      await call("/api/hub/open", { path: p.path });
    } catch (e) {
      opening.current = null;
      setError((e as Error).message);
    }
    refresh();
  };
  const closeProject = async (p: Project) => {
    const i = open.findIndex((x) => x.path === p.path);
    if (tab === p.path) setTab(open[i + 1]?.path ?? open[i - 1]?.path ?? "dashboard");
    try {
      await call("/api/hub/close", { path: p.path });
    } catch (err) {
      setError((err as Error).message);
    }
    refresh();
  };

  // Ctrl+Tab / Ctrl+Shift+Tab cycle tabs, Ctrl+W closes (when focus is in the hub chrome)
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!e.ctrlKey) return;
      const tabs = ["dashboard", ...open.map((p) => p.path)];
      if (e.key === "Tab") {
        e.preventDefault();
        const i = tabs.indexOf(tab);
        setTab(tabs[(i + (e.shiftKey ? -1 : 1) + tabs.length) % tabs.length]);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [open, tab]);

  const memory = open.reduce((s, p) => s + (p.running?.memory ?? 0), 0);
  const [quit, setQuit] = useState(false);
  const [quitted, setQuitted] = useState(false);
  const doQuit = async () => {
    setQuit(false);
    await fetch("/api/hub/quit", { method: "POST" }).catch(() => {});
    setQuitted(true);
    // works for windows opened by the launcher; otherwise the "closed" screen stays
    setTimeout(() => window.close(), 300);
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.ctrlKey && (e.key === "q" || e.key === "Q")) {
        e.preventDefault();
        if (open.length) setQuit(true);
        else void doQuit();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  if (quitted)
    return (
      <div className="hub-center" style={{ height: "100%" }}>
        <img src="/favicon.svg" width={44} height={44} alt="" />
        <div style={{ fontWeight: 600, marginTop: 6 }}>Truecanvas has quit</div>
        <div className="muted">You can close this window. Open it again from your app launcher or with `truecanvas`.</div>
      </div>
    );

  return (
    <div className="hub">
      <header className="tabbar" role="tablist">
        <button role="tab" aria-selected={tab === "dashboard"} className={`hub-tab home-tab${tab === "dashboard" ? " on" : ""}`} onClick={() => setTab("dashboard")}>
          <LayoutGrid size={14} />
          <span>Dashboard</span>
        </button>
        <span className="tab-sep" />
        <div className="tab-strip">
          {open.map((p) => (
            <div
              key={p.path}
              role="tab"
              tabIndex={0}
              aria-selected={tab === p.path}
              className={`hub-tab${tab === p.path ? " on" : ""}`}
              onClick={() => setTab(p.path)}
              onAuxClick={(e) => e.button === 1 && void closeProject(p)}
              title={home(p.path)}
            >
              {p.running?.status === "starting" ? <LoaderCircle size={14} className="spin-working" /> : p.running?.status === "failed" ? <AlertTriangle size={14} className="warn" /> : <ProjectIcon path={p.path} />}
              <span className="label">{p.name}</span>
              <button
                className="tab-close"
                aria-label={`Close ${p.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  void closeProject(p);
                }}
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
        <div className="tabbar-right">
          {memory > 0 && (
            <Tip label="Memory used by open projects (app + Truecanvas)" side="bottom">
              <span className="mem-chip">
                <Cpu size={12} /> {memory >= 1024 ? `${(memory / 1024).toFixed(1)} GB` : `${memory} MB`}
              </span>
            </Tip>
          )}
          <AppMenu version={state?.version} onQuit={() => setQuit(true)} />
        </div>
      </header>

      {quit && (
        <QuitDialog
          running={open.map((p) => p.name)}
          onCancel={() => setQuit(false)}
          onQuit={() => void doQuit()}
        />
      )}
      <main className="hub-body">
        {tab === "dashboard" && state && <Dashboard state={state} onOpen={openProject} refresh={refresh} />}
        {open.map((p) => (
          <ProjectView key={p.path} project={p} visible={tab === p.path} canvas={canvasFor[p.path]} onRetry={() => void openProject(p)} />
        ))}
        {!connected && (
          <div className="banner" role="status" style={{ top: 12 }}>
            <LoaderCircle size={14} className="spin-working" />
            <div className="muted">Lost connection to Truecanvas. Reconnecting…</div>
          </div>
        )}
        {state?.notice && !error && (
          <div className="banner" role="alert" style={{ top: 12 }}>
            <AlertTriangle size={14} className="warn" />
            <div>{state.notice}</div>
          </div>
        )}
        {error && (
          <div className="banner" role="alert" style={{ top: 12 }}>
            <span className="dot" />
            <div>{error}</div>
            <button className="icon-btn" aria-label="Dismiss" onClick={() => setError(null)}>
              <X size={14} />
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

/** The project's own favicon (app/icon, favicon.ico…), or a folder icon. */
function ProjectIcon({ path: dir, size = 14 }: { path: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <Folder size={size} className="folder-icon" />;
  return <img className="project-favicon" src={`/api/hub/icon?path=${encodeURIComponent(dir)}`} width={size} height={size} alt="" onError={() => setFailed(true)} />;
}

/* the desktop app's bridge (preload.ts): absent in a browser */
type DesktopBridge = { version: string; checkForUpdates?: () => Promise<string> };
const desktop = (window as unknown as { truecanvasDesktop?: DesktopBridge }).truecanvasDesktop;

function AppMenu({ version, onQuit }: { version?: string; onQuit: () => void }) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const shown = desktop?.version || version || "";
  return (
    <>
      <Tip label={shown ? `Truecanvas ${shown}` : "Truecanvas"} side="bottom">
        <button
          className="icon-btn app-menu-btn"
          aria-label="Truecanvas menu"
          onClick={(e) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            setMenu({ x: r.right - 220, y: r.bottom + 6 });
          }}
        >
          <MoreHorizontal size={16} />
        </button>
      </Tip>
      {menu && (
        <Menu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            ...(shown
              ? [{ label: `Truecanvas ${shown}: what's new`, icon: <Info size={14} />, onSelect: () => window.open(`https://github.com/Nathandona/truecanvas/releases/tag/v${shown}`, "_blank") }]
              : []),
            ...(desktop?.checkForUpdates
              ? [{ label: "Check for updates", icon: <Download size={14} />, onSelect: () => void desktop.checkForUpdates!() }]
              : []),
            ...(shown || desktop?.checkForUpdates ? ["sep" as const] : []),
            { label: "Reload window", icon: <RefreshCw size={14} />, kbd: "Ctrl+R", onSelect: () => location.reload() },
            "sep",
            { label: "Quit Truecanvas", icon: <Power size={14} />, kbd: "Ctrl+Q", danger: true, onSelect: onQuit },
          ]}
        />
      )}
    </>
  );
}

function QuitDialog({ running, onCancel, onQuit }: { running: string[]; onCancel: () => void; onQuit: () => void }) {
  return (
    <Dialog title="Quit Truecanvas?" role="alertdialog" width={380} onClose={onCancel}>
        <p className="muted">
          {running.length
            ? `This also stops ${running.length === 1 ? "the app" : "the apps"} it started: ${running.join(", ")}. Your files are saved as you edit.`
            : "Your files are saved as you edit."}
        </p>
        <div className="modal-actions">
          <button className="btn outline" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn danger-solid" autoFocus onClick={onQuit}>
            Quit
          </button>
        </div>
    </Dialog>
  );
}

function ProjectView({ project, visible, canvas, onRetry }: { project: Project; visible: boolean; canvas?: { canvas: string; at: number }; onRetry: () => void }) {
  const run = project.running!;
  const src = canvas ? `${run.editor}/?canvas=${encodeURIComponent(canvas.canvas)}` : `${run.editor}/`;
  return (
    <div className="project-view" style={{ display: visible ? "block" : "none" }}>
      {run.status === "ready" && <iframe key={canvas?.at} title={project.name} src={src} allow="clipboard-read; clipboard-write" />}
      {run.status === "starting" && (
        <div className="hub-center">
          <LoaderCircle size={22} className="spin-working" />
          <div className="muted">Starting {project.name}…</div>
          <div className="faint">Your app and its Truecanvas editor are booting.</div>
        </div>
      )}
      {run.status === "failed" && (
        <div className="hub-center">
          <AlertTriangle size={22} className="warn" />
          <div style={{ fontWeight: 600 }}>{project.name} didn’t start</div>
          <pre className="job-log" style={{ maxWidth: 640 }}>
            {run.error}
          </pre>
          <button className="btn primary" onClick={onRetry}>
            <RefreshCw size={13} /> Try again
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

function Dashboard({ state, onOpen, refresh }: { state: HubState; onOpen: (p: { path: string }) => void; refresh: () => void }) {
  const [found, setFound] = useState<{ path: string; name: string; ready: boolean }[] | null>(null);
  const [modal, setModal] = useState<"open" | "new" | "clone" | null>(null);
  const [prsFor, setPrsFor] = useState<Project | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [q, setQ] = useState("");
  const [menu, setMenu] = useState<{ x: number; y: number; p: Project } | null>(null);

  useEffect(() => {
    call<{ found: typeof found }>("/api/hub/discover")
      .then((r) => setFound(r.found))
      .catch(() => setFound([]));
  }, [state.projects.length]);

  const startJob = async (url: string, body: unknown) => {
    const j = await call<Job>(url, body);
    setJob(j);
  };

  const projects = state.projects.filter((p) => !q || `${p.name} ${p.path}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="dashboard scroll">
      <div className="dash-inner">
        <div className="dash-head">
          <div>
            <h1>Projects</h1>
            <p className="muted">Each project is a Next.js or Vite app. Its canvases are .tsx files in the repo.</p>
          </div>
          <div className="dash-actions">
            <div className="field" style={{ width: 200 }}>
              <span className="prefix">
                <Search size={13} />
              </span>
              <input value={q} placeholder="Search projects" onChange={(e) => setQ(e.target.value)} />
            </div>
            <button className="btn outline" onClick={() => setModal("open")}>
              <FolderOpen size={14} /> Open folder
            </button>
            <button className="btn outline" onClick={() => setModal("clone")}>
              <CloudDownload size={14} /> Clone from GitHub
            </button>
            <button className="btn primary" onClick={() => setModal("new")}>
              <Plus size={14} /> New project
            </button>
          </div>
        </div>

        {projects.length === 0 && !q && (
          <div className="dash-empty">
            <FolderPlus size={28} />
            <div style={{ fontWeight: 600, marginTop: 10 }}>No projects yet</div>
            <div className="muted">Open a Next.js or Vite app from your computer, clone one from GitHub, or create a new one.</div>
          </div>
        )}

        <div className="project-grid">
          {projects.map((p) => (
            <div
              key={p.path}
              className={`project-card${p.running ? " live" : ""}${!p.exists ? " missing" : ""}`}
              role="button"
              tabIndex={0}
              onClick={() => p.ready && p.exists && onOpen(p)}
              onKeyDown={(e) => e.key === "Enter" && p.ready && onOpen(p)}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ x: e.clientX, y: e.clientY, p });
              }}
            >
              <div className="card-top">
                <span className="card-icon">
                  <ProjectIcon path={p.path} size={22} />
                </span>
                <button
                  className="icon-btn sm"
                  aria-label={`Options for ${p.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    setMenu({ x: r.left, y: r.bottom + 4, p });
                  }}
                >
                  <MoreHorizontal size={14} />
                </button>
              </div>
              <div className="card-name">{p.name}</div>
              <div className="card-path faint">{home(p.path)}</div>
              <div className="card-meta">
                {!p.exists ? (
                  <span className="chip">Folder missing</span>
                ) : !p.ready ? (
                  <button
                    className="btn primary sm-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      void startJob("/api/hub/setup", { path: p.path });
                    }}
                  >
                    <Wand2 size={13} /> Set up Truecanvas
                  </button>
                ) : (
                  <>
                    <span className="faint">
                      {p.canvases} {p.canvases === 1 ? "page" : "pages"} · {ago(p.lastOpened, "long")}
                    </span>
                    {p.running && (
                      <span className="live-tag">
                        <span className="live-dot" /> {p.running.memory ? `${p.running.memory} MB` : "open"}
                      </span>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>

        {found && found.length > 0 && (
          <>
            <h2>Found on this computer</h2>
            <div className="found-list">
              {found.map((f) => (
                <div key={f.path} className="found-row">
                  <ProjectIcon path={f.path} size={16} />
                  <span className="name">{f.name}</span>
                  <span className="faint path">{home(f.path)}</span>
                  <button
                    className="btn outline"
                    onClick={async () => {
                      await call("/api/hub/add", { path: f.path });
                      refresh();
                    }}
                  >
                    Add
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {menu && (
        <Menu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            ...(menu.p.ready ? [{ label: "Open", icon: <ChevronRight size={14} />, onSelect: () => onOpen(menu.p) }] : []),
            ...(!menu.p.ready ? [{ label: "Set up Truecanvas", icon: <Wand2 size={14} />, onSelect: () => void startJob("/api/hub/setup", { path: menu.p.path }) }] : []),
            ...(menu.p.ready ? [{ label: "Pull requests…", icon: <GitPullRequest size={14} />, onSelect: () => setPrsFor(menu.p) }] : []),
            ...(menu.p.running ? [{ label: "Stop app", icon: <Power size={14} />, onSelect: () => void call("/api/hub/close", { path: menu.p.path }).then(refresh) }] : []),
            "sep" as const,
            { label: "Remove from list", icon: <X size={14} />, danger: true, onSelect: () => void call("/api/hub/forget", { path: menu.p.path }).then(refresh) },
          ]}
        />
      )}
      {modal === "open" && (
        <OpenFolder
          onClose={() => setModal(null)}
          onPick={async (dir) => {
            // errors (no package.json…) stay in the picker, which shows them
            const added = await call<{ path: string; ready: boolean }>("/api/hub/add", { path: dir });
            setModal(null);
            refresh();
            // ready to go: open its tab straight away (otherwise the Dashboard offers "Set up")
            if (added.ready) onOpen({ path: added.path });
          }}
        />
      )}
      {modal === "clone" && (
        <CloneRepo
          onClose={() => setModal(null)}
          onClone={async (repo, parent) => {
            setModal(null);
            await startJob("/api/hub/clone", { repo, parent });
          }}
        />
      )}
      {prsFor && (
        <PullRequests
          project={prsFor}
          onClose={() => setPrsFor(null)}
          onOpened={() => {
            const p = prsFor;
            setPrsFor(null);
            onOpen(p);
          }}
        />
      )}
      {modal === "new" && (
        <NewProject
          onClose={() => setModal(null)}
          onCreate={async (name, parent) => {
            setModal(null);
            await startJob("/api/hub/create", { name, parent });
          }}
        />
      )}
      {job && (
        <JobDialog
          job={job}
          onClose={(result) => {
            setJob(null);
            refresh();
            if (result) onOpen({ path: result });
          }}
        />
      )}
    </div>
  );
}

function Modal({ title, children, onClose, width = 460 }: { title: string; children: React.ReactNode; onClose: () => void; width?: number }) {
  return (
    <Dialog title={title} width={width} onClose={onClose}>
      {children}
    </Dialog>
  );
}

function OpenFolder({ onClose, onPick: pickDir }: { onClose: () => void; onPick: (dir: string) => Promise<void> }) {
  const [dir, setDir] = useState("~/Github");
  const [list, setList] = useState<{ path: string; dirs: { name: string; next: boolean }[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const onPick = (dir: string) => void pickDir(dir).catch((e) => setErr((e as Error).message));
  // which typed path the listing belongs to: Enter must not open a previous folder
  const [listFor, setListFor] = useState<string | null>(null);
  useEffect(() => {
    let stale = false;
    const t = setTimeout(() => {
      call<NonNullable<typeof list>>(`/api/hub/ls?path=${encodeURIComponent(dir)}`)
        .then((l) => {
          if (stale) return;
          setList(l);
          setListFor(dir);
          setErr(null);
        })
        .catch((e) => !stale && setErr((e as Error).message));
    }, 150);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [dir]);
  return (
    <Modal title="Open a project folder" onClose={onClose} width={520}>
      <p className="muted">Pick the root of a Next.js or Vite app (the folder with its package.json).</p>
      <div className="field">
        <span className="prefix">
          <Folder size={13} />
        </span>
        <input autoFocus value={dir} onChange={(e) => setDir(e.target.value)} onKeyDown={(e) => e.key === "Enter" && onPick(list && listFor === dir ? list.path : dir)} spellCheck={false} />
      </div>
      <div className="dir-list">
        {list && (
          <button className="dir-row" onClick={() => setDir(`${list.path}/..`)}>
            <Folder size={14} className="faint" /> ..
          </button>
        )}
        {list?.dirs.map((d) => (
          <button key={d.name} className="dir-row" onClick={() => setDir(`${list.path}/${d.name}`)} onDoubleClick={() => d.next && onPick(`${list.path}/${d.name}`)}>
            <Folder size={14} className={d.next ? "" : "faint"} />
            <span>{d.name}</span>
            {d.next && <span className="chip accent">App</span>}
          </button>
        ))}
        {err && <div className="faint" style={{ padding: 8 }}>{err}</div>}
      </div>
      <div className="modal-actions">
        <button className="btn outline" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" onClick={() => onPick(list?.path ?? dir)}>
          Open {list ? home(list.path).split("/").pop() : ""}
        </button>
      </div>
    </Modal>
  );
}

function CloneRepo({ onClose, onClone }: { onClose: () => void; onClone: (repo: string, parent: string) => void }) {
  const [data, setData] = useState<{ gh: boolean; error?: string; repos: { nameWithOwner: string; description: string; updatedAt: string; isPrivate: boolean }[] } | null>(null);
  const [q, setQ] = useState("");
  const [parent, setParent] = useState("~/Github");
  useEffect(() => {
    call<NonNullable<typeof data>>("/api/hub/github/repos")
      .then(setData)
      .catch((e) => setData({ gh: false, error: (e as Error).message, repos: [] }));
  }, []);
  const isUrl = /^(https?:|git@|ssh:|file:)/.test(q.trim()) || /^[\w.-]+\/[\w.-]+$/.test(q.trim());
  const repos = (data?.repos ?? []).filter((r) => !q || `${r.nameWithOwner} ${r.description ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <Modal title="Clone from GitHub" onClose={onClose} width={560}>
      <p className="muted">Clones the repo, installs its dependencies and sets up Truecanvas if it isn't there yet. Then it's one click to open.</p>
      <div className="field">
        <span className="prefix">
          <Search size={13} />
        </span>
        <input autoFocus value={q} placeholder="Search your repositories, or paste owner/name or a git URL" onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && isUrl && onClone(q.trim(), parent)} spellCheck={false} />
      </div>
      <div className="dir-list" style={{ height: 260 }}>
        {data === null && <div className="faint" style={{ padding: 10 }}>Loading your repositories…</div>}
        {data && !data.gh && (
          <div className="faint" style={{ padding: 10, lineHeight: 1.5 }}>
            The GitHub CLI isn't signed in, so your repositories can't be listed. Paste a git URL above, or run <span className="mono">gh auth login</span> in a terminal.
          </div>
        )}
        {isUrl && !repos.some((r) => r.nameWithOwner === q.trim()) && (
          <button className="dir-row" onClick={() => onClone(q.trim(), parent)}>
            <CloudDownload size={14} />
            <span>
              Clone <strong>{q.trim()}</strong>
            </span>
          </button>
        )}
        {repos.map((r) => (
          <button key={r.nameWithOwner} className="dir-row repo-row" onClick={() => onClone(r.nameWithOwner, parent)} title={r.description ?? ""}>
            {r.isPrivate ? <Lock size={13} className="faint" /> : <CloudDownload size={13} className="faint" />}
            <span style={{ fontWeight: 500 }}>{r.nameWithOwner}</span>
            <span className="faint" style={{ marginLeft: "auto", whiteSpace: "nowrap" }}>
              {ago(Date.parse(r.updatedAt), "long")}
            </span>
          </button>
        ))}
      </div>
      <div className="field" style={{ marginTop: 10 }}>
        <span className="prefix">
          <Folder size={13} />
        </span>
        <input value={parent} onChange={(e) => setParent(e.target.value)} aria-label="Clone into" spellCheck={false} />
      </div>
      <div className="modal-actions" style={{ marginTop: 12 }}>
        <button className="btn outline" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

function PullRequests({ project, onClose, onOpened }: { project: Project; onClose: () => void; onOpened: () => void }) {
  const [data, setData] = useState<{ error?: string; prs: { number: number; title: string; headRefName: string; author: { login: string }; updatedAt: string; isDraft: boolean }[] } | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    call<NonNullable<typeof data>>(`/api/hub/prs?path=${encodeURIComponent(project.path)}`)
      .then(setData)
      .catch((e) => setData({ error: (e as Error).message, prs: [] }));
  }, [project.path]);
  const checkout = async (n: number) => {
    setBusy(n);
    setError(null);
    try {
      await call("/api/hub/pr-checkout", { path: project.path, number: String(n) });
      onOpened();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <Modal title={`Pull requests · ${project.name}`} onClose={onClose} width={560}>
      <p className="muted">Open a pull request to see its design in Truecanvas: its branch is checked out and the canvases show that version.</p>
      <div className="dir-list" style={{ height: 280 }}>
        {data === null && <div className="faint" style={{ padding: 10 }}>Loading…</div>}
        {data?.error && <div className="faint" style={{ padding: 10 }}>{data.error}</div>}
        {data && !data.error && data.prs.length === 0 && <div className="faint" style={{ padding: 10 }}>No open pull requests.</div>}
        {data?.prs.map((pr) => (
          <button key={pr.number} className="dir-row repo-row" disabled={busy !== null} onClick={() => void checkout(pr.number)}>
            {busy === pr.number ? <LoaderCircle size={14} className="spin-working" /> : <GitPullRequest size={14} className={pr.isDraft ? "faint" : "pr-open"} />}
            <span style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              #{pr.number} {pr.title}
            </span>
            <span className="faint" style={{ marginLeft: "auto", whiteSpace: "nowrap" }}>
              {pr.author?.login} · {ago(Date.parse(pr.updatedAt), "long")}
            </span>
          </button>
        ))}
      </div>
      {error && <div className="hub-error">{error}</div>}
      <div className="modal-actions" style={{ marginTop: 12 }}>
        <button className="btn outline" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}

function NewProject({ onClose, onCreate }: { onClose: () => void; onCreate: (name: string, parent: string) => void }) {
  const [name, setName] = useState("");
  const [parent, setParent] = useState("~/Github");
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return (
    <Modal title="New project" onClose={onClose}>
      <p className="muted">Creates a Next.js app with TypeScript and Tailwind, then sets up Truecanvas in it.</p>
      <div style={{ display: "grid", gap: 8 }}>
        <div className="field">
          <span className="prefix">Name</span>
          <input autoFocus value={name} placeholder="my-app" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && slug && onCreate(slug, parent)} />
        </div>
        <div className="field">
          <span className="prefix">In</span>
          <input value={parent} onChange={(e) => setParent(e.target.value)} spellCheck={false} />
        </div>
        {slug && <div className="faint mono">{`${parent.replace(/\/$/, "")}/${slug}`}</div>}
      </div>
      <div className="modal-actions" style={{ marginTop: 16 }}>
        <button className="btn outline" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" disabled={!slug} onClick={() => onCreate(slug, parent)}>
          Create project
        </button>
      </div>
    </Modal>
  );
}

function JobDialog({ job: initial, onClose }: { job: Job; onClose: (result?: string) => void }) {
  const [job, setJob] = useState(initial);
  const logRef = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (job.status !== "running") return;
    const t = setInterval(() => void call<Job>(`/api/hub/jobs/${job.id}`).then(setJob), 700);
    return () => clearInterval(t);
  }, [job.id, job.status]);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [job.log.length]);
  // created or cloned: open its tab on its own (a beat later, so "Done." is seen)
  useEffect(() => {
    if (job.status !== "done" || !job.result) return;
    const t = setTimeout(() => onClose(job.result), 700);
    return () => clearTimeout(t);
    // onClose is a fresh function each render; the job is what matters
  }, [job.status, job.result]);
  return (
    <Modal title={job.title} onClose={() => job.status !== "running" && onClose()} width={600}>
      <div className="job-status">
        {job.status === "running" ? <LoaderCircle size={16} className="spin-working" /> : job.status === "done" ? <span className="live-dot" /> : <AlertTriangle size={16} className="warn" />}
        <span>{job.status === "running" ? "Working… this can take a minute." : job.status === "done" ? "Done." : "Something went wrong."}</span>
      </div>
      <pre className="job-log" ref={logRef}>
        {job.log.slice(-120).join("\n")}
      </pre>
      <div className="modal-actions">
        {job.status === "done" && job.result ? (
          <button className="btn primary" onClick={() => onClose(job.result)}>
            Opening…
          </button>
        ) : (
          <button className="btn outline" disabled={job.status === "running"} onClick={() => onClose()}>
            Close
          </button>
        )}
      </div>
    </Modal>
  );
}
