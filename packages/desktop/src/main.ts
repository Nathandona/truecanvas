import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, ipcMain, Menu, nativeImage, Notification, shell, Tray, type MenuItemConstructorOptions } from "electron";
import type { HubNotice, startHub as StartHub, useNodeRuntime as UseNodeRuntime } from "truecanvas/hub";
import { setStartAtLogin, startsAtLogin } from "./autostart";
import { userRuntime } from "./shell-env";

/*
 * Truecanvas as a desktop app. The main process runs the projects window
 * (the hub) in process and shows it in a window; closing the window keeps it
 * running in the tray, with the projects' dev servers. Projects run on the
 * user's own Node, never on Electron's.
 *
 * TRUECANVAS_DESKTOP_TEST=1 (tests): no tray, no notifications, no updates,
 * the window stays hidden, and events are printed as JSON lines.
 * TRUECANVAS_DESKTOP_PORT forces the hub's port.
 */

type Hub = Awaited<ReturnType<typeof StartHub>>;

const TEST = process.env.TRUECANVAS_DESKTOP_TEST === "1";
const HUB_PORT = 4800;
const startHidden = process.argv.includes("--hidden");

const log = (event: string, data: Record<string, unknown> = {}) => {
  if (TEST) process.stdout.write(`${JSON.stringify({ event, ...data })}\n`);
};

/** The truecanvas package: bundled with the app, or the workspace's when developing. */
function truecanvasDir(): string {
  if (app.isPackaged) return path.join(process.resourcesPath, "runtime", "node_modules", "truecanvas");
  return path.resolve(__dirname, "..", "..", "truecanvas");
}

const assets = () => (app.isPackaged ? path.join(process.resourcesPath, "icons") : path.resolve(__dirname, "..", "build", "icons"));

function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.listen(port, "127.0.0.1", () => srv.close(() => resolve(true)));
  });
}

async function isHub(port: number): Promise<boolean> {
  return fetch(`http://localhost:${port}/api/hub/state`, { signal: AbortSignal.timeout(1500) })
    .then((r) => r.ok)
    .catch(() => false);
}

/**
 * The hub's port: 4800, where agents' MCP URL points. When another Truecanvas
 * hub already runs there (`truecanvas open`, the old launcher, an older
 * version), the app asks it to quit and takes over, so what you see is always
 * the version that ships with the app; its projects reopen on demand. If it
 * won't let go, the app shows it rather than starting a second one. When
 * something else holds 4800, the next free port; the hub writes it down so the
 * CLI finds it.
 */
async function pickPort(): Promise<{ port: number; attach: boolean }> {
  const forced = Number(process.env.TRUECANVAS_DESKTOP_PORT);
  if (forced) return { port: forced, attach: false };
  if (await isHub(HUB_PORT)) {
    await fetch(`http://localhost:${HUB_PORT}/api/hub/quit`, { method: "POST", signal: AbortSignal.timeout(5000) }).catch(() => {});
    for (let i = 0; i < 40 && !(await portFree(HUB_PORT)); i++) await new Promise((r) => setTimeout(r, 250));
    if (!(await portFree(HUB_PORT))) return { port: HUB_PORT, attach: true };
    log("took over from a running hub", { port: HUB_PORT });
  }
  if (await portFree(HUB_PORT)) return { port: HUB_PORT, attach: false };
  for (let p = 4801; p < 4900; p++) if (await portFree(p)) return { port: p, attach: false };
  throw new Error("No free port for Truecanvas");
}

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let hub: Hub | null = null;
let origin = "";
let quitting = false;
let hintedTray = false;

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 800,
    minHeight: 560,
    show: false,
    title: "Truecanvas",
    backgroundColor: "#151514",
    icon: path.join(assets(), "512x512.png"),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      additionalArguments: [`--truecanvas-version=${app.getVersion()}`],
    },
  });
  win.removeMenu();
  win.once("ready-to-show", () => {
    if (!TEST && !startHidden) win?.show();
  });
  win.webContents.on("did-finish-load", () => {
    log("window-loaded", { url: win?.webContents.getURL(), title: win?.getTitle() });
    // tests: a picture of the hidden window, once the projects list has rendered
    const shot = process.env.TRUECANVAS_DESKTOP_SHOT;
    if (TEST && shot)
      setTimeout(() => {
        void win?.webContents.capturePage().then((img) => {
          fs.writeFileSync(shot, img.toPNG());
          log("screenshot", { file: shot, ...img.getSize() });
        });
      }, 2500);
  });
  // links meant for a browser (docs, GitHub, a share link) open there
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.on("close", (e) => {
    if (quitting) return;
    // keep running: the tray brings the window back
    e.preventDefault();
    win?.hide();
    if (!hintedTray && tray && Notification.isSupported()) {
      hintedTray = true;
      new Notification({ title: "Truecanvas is still running", body: "Your projects keep running in the background. Open the window or quit from the tray icon.", silent: true }).show();
    }
  });
  void win.loadURL(origin);
}

async function recentProjects(): Promise<{ path: string; name: string; running: boolean }[]> {
  try {
    const state = hub ? await hub.state() : ((await (await fetch(`${origin}/api/hub/state`)).json()) as Awaited<ReturnType<Hub["state"]>>);
    return [...state.projects]
      .filter((p) => p.ready && p.exists)
      .sort((a, b) => b.lastOpened - a.lastOpened)
      .slice(0, 8)
      .map((p) => ({ path: p.path, name: p.name, running: !!p.running }));
  } catch {
    return [];
  }
}

async function openProject(dir: string) {
  showWindow();
  await fetch(`${origin}/api/hub/open`, { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify({ path: dir, focus: "1" }) }).catch(() => {});
}

/** The tray's live session entry: Start or Stop, for the active project's open canvas. */
async function liveSessionItem(): Promise<MenuItemConstructorOptions> {
  if (!hub) return { label: "Start live session", enabled: false };
  const state = await hub.state().catch(() => null);
  const active = state?.active ?? null;
  const ready = !!active && state?.projects.find((p) => p.path === active)?.running?.status === "ready";
  const live = active ? (state?.liveSession.sessions[active] ?? []) : [];
  const toggle = () =>
    void hub!.liveSession
      .toggle()
      .then((sessions) => {
        const s = sessions[0];
        if (s && Notification.isSupported()) new Notification({ title: `Live session on ${s.canvas}`, body: `People with access to ${s.url} now follow it live.`, silent: true }).show();
      })
      .catch((err: Error) => Notification.isSupported() && new Notification({ title: "Live session", body: err.message }).show())
      .finally(() => void buildTrayMenu());
  if (live.length) return { label: `Stop live session (${live.map((s) => s.canvas).join(", ")})`, click: toggle };
  return { label: "Start live session", enabled: ready, toolTip: ready ? "Clients follow the open canvas live on its share link" : "Open a project first", click: toggle };
}

async function buildTrayMenu() {
  if (!tray) return;
  const projects = await recentProjects();
  const session = await liveSessionItem();
  const items: MenuItemConstructorOptions[] = [
    { label: `Truecanvas ${app.getVersion()}`, enabled: false },
    updateItem(),
    { type: "separator" },
    { label: "Open Truecanvas", click: showWindow },
    { type: "separator" },
    ...(projects.length
      ? [{ label: "Recent projects", enabled: false } as MenuItemConstructorOptions, ...projects.map((p) => ({ label: `${p.running ? "● " : ""}${p.name}`, click: () => void openProject(p.path) }))]
      : [{ label: "No projects yet", enabled: false } as MenuItemConstructorOptions]),
    { type: "separator" },
    session,
    { type: "separator" },
    { label: "Start at login", type: "checkbox", checked: startsAtLogin(), click: (item) => setStartAtLogin(item.checked) },
    { type: "separator" },
    { label: "Quit Truecanvas", click: () => void quit() },
  ];
  tray.setContextMenu(Menu.buildFromTemplate(items));
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(assets(), process.platform === "darwin" ? "tray-template.png" : "tray.png"));
  if (process.platform === "darwin") icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip("Truecanvas");
  tray.on("click", showWindow);
  void buildTrayMenu();
  // recent projects and running state change from the window: refresh now and then
  setInterval(() => void buildTrayMenu(), 15_000).unref();
}

function notify(n: HubNotice) {
  log("notice", { ...n });
  if (TEST || !Notification.isSupported()) return;
  const note = new Notification({ title: `${n.name} commented on ${n.canvas}`, body: n.text, icon: path.join(assets(), "256x256.png") });
  note.on("click", () => {
    showWindow();
    hub?.focus(n.path, n.canvas);
  });
  note.show();
}

/** Stops every project the app started, then leaves. */
async function quit() {
  if (quitting) return;
  quitting = true;
  log("quitting");
  try {
    await hub?.shutdown();
  } finally {
    tray?.destroy();
    app.exit(0);
  }
}

// ---------- updates: from GitHub releases (AppImage, deb, macOS, Windows) ----------

type UpdateState =
  | { state: "idle" | "checking" | "latest" }
  | { state: "downloading"; version: string; percent: number }
  | { state: "ready"; version: string }
  | { state: "error"; message: string };
let update: UpdateState = { state: "idle" };
/** a check the person asked for (tray or window menu): say the outcome, even "up to date" */
let askedForUpdate = false;
type Updater = (typeof import("electron-updater"))["autoUpdater"];
let updater: Promise<Updater | null> | null = null;

const updatesOn = () => !TEST && app.isPackaged && process.env.TRUECANVAS_NO_UPDATE !== "1";

function getUpdater(): Promise<Updater | null> {
  updater ??= import("electron-updater")
    .then(({ autoUpdater }) => {
      autoUpdater.autoDownload = true;
      autoUpdater.autoInstallOnAppQuit = true;
      const set = (u: UpdateState) => {
        update = u;
        void buildTrayMenu();
        // the window shows it too (not every desktop shows tray icons)
        win?.webContents.send("truecanvas:update", update);
      };
      autoUpdater.on("checking-for-update", () => set({ state: "checking" }));
      autoUpdater.on("update-not-available", () => {
        set({ state: "latest" });
        if (askedForUpdate) say("Truecanvas is up to date", `You have the latest version, ${app.getVersion()}.`);
        askedForUpdate = false;
      });
      autoUpdater.on("update-available", (info) => set({ state: "downloading", version: info.version, percent: 0 }));
      autoUpdater.on("download-progress", (p) => {
        if (update.state === "downloading") set({ ...update, percent: Math.round(p.percent) });
      });
      autoUpdater.on("update-downloaded", (info) => {
        set({ state: "ready", version: info.version });
        say(`Truecanvas ${info.version} is ready`, "Click Restart to update in the Truecanvas window, or it installs when you quit.");
        askedForUpdate = false;
      });
      autoUpdater.on("error", (err) => {
        set({ state: "error", message: err.message });
        if (askedForUpdate) say("Couldn't check for updates", err.message);
        askedForUpdate = false;
      });
      return autoUpdater;
    })
    .catch(() => null);
  return updater;
}

function say(title: string, body: string) {
  log("update", { title, body });
  if (Notification.isSupported()) new Notification({ title, body, silent: true }).show();
}

function checkForUpdates(asked = false) {
  if (!updatesOn()) {
    if (asked) say("Updates", "This build doesn't update itself (development or a test run).");
    return;
  }
  if (update.state === "checking" || update.state === "downloading") return;
  if (update.state === "ready") {
    if (asked) say(`Truecanvas ${update.version} is ready`, "Click Restart to update in the Truecanvas window.");
    return;
  }
  askedForUpdate = asked;
  void getUpdater().then((u) => u?.checkForUpdates().catch(() => {}));
}

/** Stops the projects first (like Quit), then installs the downloaded version and reopens. */
async function restartToUpdate() {
  const u = await getUpdater();
  if (!u || update.state !== "ready") return;
  quitting = true;
  try {
    await hub?.shutdown();
  } finally {
    tray?.destroy();
    u.quitAndInstall(true, true);
  }
}

function updateItem(): MenuItemConstructorOptions {
  switch (update.state) {
    case "checking":
      return { label: "Checking for updates…", enabled: false };
    case "downloading":
      return { label: `Downloading ${update.version}… ${update.percent}%`, enabled: false };
    case "ready":
      return { label: `Restart to update to ${update.version}`, click: () => void restartToUpdate() };
    default:
      return { label: "Check for updates", click: () => checkForUpdates(true) };
  }
}

async function main() {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  app.on("second-instance", () => showWindow());
  app.on("before-quit", (e) => {
    if (quitting) return;
    e.preventDefault();
    void quit();
  });
  // the window closing never quits: the tray does
  app.on("window-all-closed", () => {});
  for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => void quit());

  await app.whenReady();
  const runtime = userRuntime();
  log("runtime", { node: runtime.node, fromShell: runtime.fromShell, problem: runtime.problem });

  const { port, attach } = await pickPort();
  origin = `http://localhost:${port}`;
  if (!attach) {
    const dir = truecanvasDir();
    const lib = (await import(pathToFileURL(path.join(dir, "dist", "hub.js")).href)) as { startHub: typeof StartHub; useNodeRuntime: typeof UseNodeRuntime };
    lib.useNodeRuntime(runtime.node, runtime.env);
    hub = await lib.startHub({
      port,
      cli: path.join(dir, "dist", "cli.js"),
      notice: runtime.problem,
      onNotice: notify,
      onQuit: () => void quit(),
      signals: false,
    });
  }
  log("ready", { origin, attach, port });

  ipcMain.handle("truecanvas:update-state", () => update);
  ipcMain.handle("truecanvas:restart-to-update", () => restartToUpdate());
  ipcMain.handle("truecanvas:check-updates", () => {
    checkForUpdates(true);
    return update.state;
  });
  ipcMain.handle("truecanvas:live-session", async () => {
    if (!hub) throw new Error("This window shows a Truecanvas started from the command line: live sessions start there.");
    const sessions = await hub.liveSession.toggle();
    void buildTrayMenu();
    return sessions;
  });

  createWindow();
  if (!TEST) createTray();
  // asked to start hidden, but there is no tray to come back from
  if (startHidden && !tray && !TEST) showWindow();
  checkForUpdates();
  // and every few hours while the app stays open
  setInterval(() => checkForUpdates(), 4 * 60 * 60 * 1000).unref();
}

void main().catch((err) => {
  log("error", { message: (err as Error).message });
  console.error(err);
  app.exit(1);
});

// an icon in the dock (macOS) brings the window back
app.on("activate", () => showWindow());

