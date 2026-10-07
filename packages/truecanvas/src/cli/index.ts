#!/usr/bin/env node
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { loadConfig } from "../core/config.js";
import { Workspace } from "../core/workspace.js";
import { startServer } from "../server/http.js";
import { runStdioBridge } from "../server/stdio.js";
import { configStatus, initProject } from "../core/init.js";
import type { Framework } from "../core/config.js";
import { createRequire } from "node:module";
import { startHub } from "../hub/server.js";
import { installDesktop, launcherPath, uninstallDesktop } from "../hub/desktop.js";
import { hubPort } from "../hub/locate.js";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { doctor } from "./doctor.js";
import { ACCESS_MODES, connectReviewSite, deleteShare, parseEmails, reviewSite, updateAccess, updateShare, type Access, type Invited, type LiveSite } from "../share/publish.js";
import { toolEnv } from "../core/pm.js";
import { addDevArgs, connectAgents, detectPm, execInherit, hasAgentConfig, installedIn, packageDir, packageSpec, packageVersion, readPackage, runScript } from "./setup.js";

const HELP = `truecanvas: design with your real React components

Usage
  truecanvas           In a Next.js or Vite app: set it up (asks once) and start the editor.
                       Elsewhere: open the Truecanvas window.
  truecanvas connect   Add Truecanvas to this project's .mcp.json (Claude Code, Cursor,
                       VS Code): commit it and every teammate's agent connects
  truecanvas doctor    Check this project and machine, with a fix for each problem
  truecanvas dev       Start the editor + MCP server for this project (no window)
  truecanvas setup     Install and set up Truecanvas in this project, without starting
  truecanvas init      Only write the config (next/vite config, script, canvas folder)
  truecanvas open      Open the Truecanvas window (projects dashboard + tabs)
  truecanvas quit      Quit the window and every app it started
  truecanvas desktop   Add Truecanvas to your app launcher (Linux); "desktop remove" undoes it
  truecanvas share [canvas]  Share a canvas as a link for clients (needs truecanvas running).
                       --password <p>, --no-password, --revoke, --restore, --delete, --title <t>, --local (preview only),
                       --live <url|dir>: a live version clients open with "View live" (where the app runs, or a static build)
                       --invite <emails>: invite people by email (they sign in with a link; new links are invited-only)
                       --access invited|password|public: who can open the link
                       --link-only: with --invite or --access, change the link without a new version
  truecanvas share setup     Connect your studio's review site (URL + REVIEW_TOKEN)
  truecanvas mcp       stdio MCP server for agents without HTTP support

Options
  -y, --yes            Don't ask: set up and connect agents
  --port <n>           Editor/MCP port (default 4800)
  --app <url>          Your app's dev URL (default http://localhost:3000, Vite :5173)
  --no-next            Don't start the app's dev server (by default it starts when the app isn't running)
  --no-open            Don't open the editor in your browser
  --cursor, --vscode   connect: also write .cursor/mcp.json / .vscode/mcp.json
  -v, --version        Print the version
`;

// plain text when piped, in CI logs or with NO_COLOR
const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (open: string, close: string) => (s: string) => (color ? `\x1b[${open}m${s}\x1b[${close}m` : s);
const c = {
  dim: paint("2", "22"),
  bold: paint("1", "22"),
  accent: paint("38;5;75", "39"),
  green: paint("32", "39"),
  yellow: paint("33", "39"),
  red: paint("31", "39"),
};

const accessLabel = (access: Access | null) => (access === "invited" ? "invited people only" : access === "password" ? "password protected" : access === "public" ? "anyone with the link" : "");

function printInvited(invited: Invited[]) {
  for (const i of invited) {
    if (i.error) console.log(`  ${c.yellow("!")} Couldn't email ${i.email}: ${i.error}`);
    else console.log(`  ${c.green("✓")} Invited ${i.email}${i.link ? c.dim(` (local review site: ${i.link})`) : ""}`);
  }
}

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      port: { type: "string" },
      app: { type: "string" },
      next: { type: "boolean", default: true },
      "no-next": { type: "boolean" },
      open: { type: "boolean", default: true },
      "no-open": { type: "boolean" },
      help: { type: "boolean", short: "h" },
      yes: { type: "boolean", short: "y" },
      cursor: { type: "boolean" },
      vscode: { type: "boolean" },
      version: { type: "boolean", short: "v" },
      local: { type: "boolean" },
      title: { type: "string" },
      password: { type: "string" },
      "no-password": { type: "boolean" },
      revoke: { type: "boolean" },
      restore: { type: "boolean" },
      delete: { type: "boolean" },
      token: { type: "string" },
      live: { type: "string" },
      invite: { type: "string", multiple: true },
      access: { type: "string" },
      "link-only": { type: "boolean" },
    },
  });
  const cli = fileURLToPath(import.meta.url);
  const pkgDir = packageDir(cli);
  const version = packageVersion(pkgDir);
  const command = positionals[0] ?? "start";
  if (values.version) return console.log(version);
  if (values.help || command === "help") {
    console.log(HELP);
    return;
  }
  const yes = !!values.yes;

  // ---------- the one command ----------
  if (command === "start") {
    const root = process.cwd();
    const deps = { ...readPackage(root)?.dependencies, ...readPackage(root)?.devDependencies };
    if (!("next" in deps) && !("vite" in deps && "react" in deps)) {
      // not in an app: the projects window
      return openWindow(cli, values.port ? Number(values.port) : hubPort());
    }
    if (!(await ensureSetup(root, pkgDir, version, yes))) return;
    // the window is open: show the project there
    if (await openInWindow(root, values.port ? Number(values.port) : hubPort())) return;
    // run the project's own Truecanvas, so editor and Next plugin are the same version
    const local = path.join(root, "node_modules", "truecanvas", "dist", "cli.js");
    if (fs.existsSync(local) && fs.realpathSync(local) !== fs.realpathSync(cli)) {
      const child = spawn(process.execPath, [local, "dev", ...process.argv.slice(2).filter((a) => a !== "start" && a !== "-y" && a !== "--yes")], { stdio: "inherit" });
      for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => child.kill(sig));
      child.on("exit", (code) => process.exit(code ?? 0));
      return;
    }
    // same build: carry on as `dev`
  }
  if (command === "setup") {
    const root = process.cwd();
    if (!(await ensureSetup(root, pkgDir, version, true, true))) process.exit(1);
    return;
  }
  if (command === "connect") {
    const root = process.cwd();
    if (!readPackage(root)) {
      console.error("Run truecanvas connect from your project root (no package.json here).");
      process.exit(1);
    }
    const config = loadConfig(root, { port: values.port ? Number(values.port) : undefined });
    printConnect(connectAgents(root, config.port, { cursor: values.cursor, vscode: values.vscode }), config.port);
    return;
  }
  if (command === "doctor") {
    const checks = await doctor(process.cwd(), version);
    console.log(`\n  ${c.accent("◆")} ${c.bold("Truecanvas doctor")} ${c.dim(`v${version}`)}\n`);
    for (const ch of checks) {
      const mark = ch.status === "ok" ? c.green("✓") : ch.status === "warn" ? c.yellow("!") : c.red("✗");
      console.log(`  ${mark} ${ch.label}${ch.detail ? c.dim(`  ${ch.detail}`) : ""}`);
      if (ch.fix && ch.status !== "ok") console.log(`      ${c.dim("→")} ${ch.fix}`);
    }
    const failed = checks.filter((ch) => ch.status === "fail").length;
    console.log(failed ? `\n  ${failed} problem${failed === 1 ? "" : "s"} to fix.\n` : `\n  ${c.green("All good.")}\n`);
    process.exit(failed ? 1 : 0);
  }
  if (command === "hub") {
    const port = values.port ? Number(values.port) : 4800;
    try {
      const { origin } = await startHub({ port, cli });
      console.log(`\n  ${c.accent("◆")} ${c.bold("Truecanvas")} hub on ${c.bold(origin)}\n  ${c.dim("MCP")} ${origin}/mcp ${c.dim("(follows the active tab)")}\n`);
      if (values.open && !values["no-open"]) openBrowser(origin);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EADDRINUSE") {
        console.error(`Port ${port} is busy. If a project is running there with \`truecanvas dev\`, stop it first: the hub uses ${port} so your MCP URL keeps working.`);
        process.exit(1);
      }
      throw err;
    }
    return;
  }
  if (command === "open") return openWindow(cli, values.port ? Number(values.port) : hubPort());
  if (command === "quit") {
    const url = `http://localhost:${values.port ?? hubPort()}`;
    const up = await fetch(`${url}/api/hub/state`, { signal: AbortSignal.timeout(1500) }).then((r) => r.ok).catch(() => false);
    if (!up) return console.log("Truecanvas isn't running.");
    await fetch(`${url}/api/hub/quit`, { method: "POST" }).catch(() => {});
    return console.log(`${c.green("✓")} Truecanvas quit. Project apps it started are stopped too.`);
  }
  if (command === "desktop") {
    if (process.platform !== "linux") return console.log(`The app launcher entry is Linux-only for now. Run ${c.accent("truecanvas open")} to open the window.`);
    if (positionals[1] === "remove") {
      const removed = uninstallDesktop();
      console.log(removed.length ? `${c.green("✓")} Removed the launcher.` : "Nothing to remove.");
      return;
    }
    const out = installDesktop(cli, 4800);
    console.log(`${c.green("✓")} Truecanvas is in your app launcher.\n  ${c.dim(out.desktop)}`);
    if (out.command) console.log(`${c.green("✓")} The ${c.accent("truecanvas")} command is installed: ${c.dim(out.command)}`);
    console.log(`  Open it from Activities, or run ${c.accent("truecanvas")}. Quit with ${c.accent("truecanvas quit")} or from the window's menu.`);
    return;
  }

  const root = process.cwd();
  if (!fs.existsSync(path.join(root, "package.json"))) {
    console.error("Run truecanvas from your app's root (no package.json here).");
    process.exit(1);
  }
  const config = loadConfig(root, { port: values.port ? Number(values.port) : undefined, appUrl: values.app });
  const ws = new Workspace(config);

  if (command === "init") {
    const report = initProject(config);
    ws.ensureRoute();
    console.log(`\n  ${c.accent("◆")} ${c.bold("Truecanvas")} is set up in ${c.bold(path.basename(root))}\n`);
    for (const line of report.done) console.log(`  ${c.green("✓")} ${line}`);
    console.log(`  ${c.green("✓")} Canvas folder ${c.bold(config.canvasDir)} and dev route ${c.bold(config.routeDir)}`);
    for (const line of report.todo) console.log(`  ${c.dim("!")} ${line}`);
    console.log(`\n  Next: ${c.accent("npm run canvas")} ${c.dim("(starts your app and the editor)")}\n`);
    return;
  }
  if (command === "share") {
    // setup: connect the studio's review site (URL + token from its environment variables)
    if (positionals[1] === "setup") {
      const url = positionals[2] ?? (await prompt("Review site URL (e.g. https://review.your-studio.com):"));
      const token = values.token ?? process.env.TRUECANVAS_REVIEW_TOKEN ?? (await prompt("Its REVIEW_TOKEN:"));
      try {
        const { brand } = await connectReviewSite(url, token);
        console.log(`  ${c.green("✓")} Connected to ${c.bold(brand.name)} (${url}). Share with ${c.accent("npx truecanvas share <canvas>")}.`);
      } catch (err) {
        console.error(`  ${c.red("✗")} ${(err as Error).message}`);
        process.exit(1);
      }
      return;
    }
    const base = `http://localhost:${config.port}`;
    const state = await fetch(`${base}/api/state`).then((r) => (r.ok ? (r.json() as Promise<{ canvases: string[] }>) : null)).catch(() => null);
    const canvas = positionals[1] ?? (state?.canvases.length === 1 ? state.canvases[0] : null);
    // revoke / restore / password: only the review site is involved
    if (values.delete) {
      const site = reviewSite();
      if (!site || !canvas) {
        console.error(site ? "Name the canvas: truecanvas share <canvas> --delete" : `No review site yet: ${c.accent("npx truecanvas share setup")}`);
        process.exit(1);
      }
      const done = await deleteShare(site, path.basename(root), canvas);
      console.log(done ? `  ${c.green("✓")} Deleted the link of ${canvas}, with its versions and comments.` : `  ${canvas} has no link.`);
      return;
    }
    // link changes only: never a new version
    if (values.revoke || values.restore || values["no-password"]) {
      const site = reviewSite();
      if (!site || !canvas) {
        console.error(site ? "Name the canvas: truecanvas share <canvas> --revoke" : `No review site yet: ${c.accent("npx truecanvas share setup")}`);
        process.exit(1);
      }
      const change = { ...(values.revoke ? { revoked: true } : values.restore ? { revoked: false } : {}), ...(values["no-password"] ? { password: null } : {}) };
      const url = await updateShare(site, path.basename(root), canvas, change);
      console.log(`  ${c.green("✓")} ${values.revoke ? "Link revoked" : values.restore ? "Link restored" : "Password removed"}: ${url}`);
      return;
    }
    // who can open the link, and who to invite
    let invite: string[] = [];
    try {
      invite = parseEmails(values.invite);
    } catch (err) {
      console.error(`  ${c.red("✗")} ${(err as Error).message}`);
      process.exit(1);
    }
    const access = values.access as Access | undefined;
    if (access && !ACCESS_MODES.includes(access)) {
      console.error(`  ${c.red("✗")} --access is ${ACCESS_MODES.join(", ")}`);
      process.exit(1);
    }
    if (values["link-only"]) {
      const site = reviewSite();
      if (!site || !canvas || (!access && !invite.length)) {
        console.error(!site ? `No review site yet: ${c.accent("npx truecanvas share setup")}` : !canvas ? "Name the canvas: truecanvas share <canvas> --invite name@client.com --link-only" : "--link-only goes with --invite or --access");
        process.exit(1);
      }
      try {
        const done = await updateAccess(site, path.basename(root), canvas, { access, password: values.password, invite });
        console.log(`  ${c.green("✓")} ${done.url} ${c.dim(`(${accessLabel(done.access)})`)}`);
        printInvited(done.invited);
      } catch (err) {
        console.error(`  ${c.red("✗")} ${(err as Error).message}`);
        process.exit(1);
      }
      return;
    }
    if (!state) {
      console.error(`Truecanvas isn't running for this project. Start it first: ${c.accent("npx truecanvas")}`);
      process.exit(1);
    }
    if (!canvas || !state.canvases.includes(canvas)) {
      console.error(`Which canvas? ${state.canvases.join(", ") || "(none)"}\n  truecanvas share <canvas>`);
      process.exit(1);
    }
    const publish = !values.local && !!reviewSite();
    console.log(`  ${c.dim(`Rendering ${canvas} through your app${publish ? " and publishing it" : ""}…`)}`);
    const password = values.password;
    // a URL where the app runs, or a static build folder (relative to here)
    const live: LiveSite | undefined = values.live ? (/^https?:\/\//.test(values.live) ? { url: values.live } : { dir: path.resolve(values.live) }) : undefined;
    if (live && "dir" in live && !fs.existsSync(path.join(live.dir, "index.html"))) {
      console.error(`  ${c.red("✗")} No index.html in ${live.dir}. Pass a static build folder (Next \`out/\`, Vite \`dist/\`) or the URL where the app runs.`);
      process.exit(1);
    }
    if ((live || access || invite.length) && !publish) {
      console.error(`  ${c.red("✗")} ${live ? "--live" : access ? "--access" : "--invite"} needs a review site: ${c.accent("npx truecanvas share setup")}`);
      process.exit(1);
    }
    const res = await fetch(`${base}/api/share/snapshot`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: base },
      body: JSON.stringify({ canvas, local: !publish, title: values.title, password, live, access, invite }),
    });
    const body = (await res.json()) as {
      error?: string;
      preview: string;
      manifest: { frames: unknown[]; missing: string[]; external: string[] };
      published: { url: string; versions: number; skipped: string[]; password: boolean; live: string | null; access: Access | null; invited: Invited[] } | null;
    };
    if (!res.ok) {
      console.error(`  ${c.red("✗")} ${body.error}`);
      process.exit(1);
    }
    const { manifest, published } = body;
    console.log(`  ${c.green("✓")} ${manifest.frames.length} frame${manifest.frames.length === 1 ? "" : "s"} frozen: no scripts, no API calls.`);
    if (manifest.external.length) console.log(`  ${c.yellow("!")} While rendering, the app called ${manifest.external.join(", ")}. Whatever it showed is in the snapshot: use sample data for client links.`);
    if (manifest.missing.length) console.log(`  ${c.yellow("!")} ${manifest.missing.length} asset${manifest.missing.length === 1 ? "" : "s"} couldn't be fetched.`);
    if (published?.skipped.length) console.log(`  ${c.yellow("!")} Left out (over 4.4 MB): ${published.skipped.join(", ")}`);
    if (published) {
      const who = published.access ? `, ${accessLabel(published.access)}` : published.password ? ", password protected" : "";
      console.log(`  ${c.green("✓")} Shared: ${c.bold(published.url)} ${c.dim(`(version ${published.versions}${who})`)}`);
      if (published.live) console.log(`  ${c.green("✓")} Live: ${published.live} ${c.dim(published.access !== "public" && (published.access || published.password) ? "(opens from the link's View live button)" : "")}`);
      printInvited(published.invited);
      if (published.access === "invited" && !published.invited.length) console.log(`  ${c.dim("Only invited people and your studio can open it. Invite someone:")} ${c.accent(`npx truecanvas share ${canvas} --invite name@client.com --link-only`)}`);
      console.log("");
      if (values.open && !values["no-open"]) openBrowser(published.url);
    } else {
      console.log(`  ${c.dim("Preview")} ${c.bold(body.preview)}`);
      if (!values.local) console.log(`  ${c.dim("To send links to clients, connect your review site:")} ${c.accent("npx truecanvas share setup")}`);
      console.log("");
      if (values.open && !values["no-open"]) openBrowser(body.preview);
    }
    return;
  }
  if (command === "mcp") {
    // stdout belongs to the MCP protocol: log to stderr only
    console.log = console.error;
    const mcpUrl = `http://localhost:${config.port}/mcp`;
    // a project server or the Truecanvas window (hub) already answering on this port
    const answers = (p: string) => fetch(`http://127.0.0.1:${config.port}${p}`).then((r) => r.ok).catch(() => false);
    const running = (await answers("/api/state")) || (await answers("/api/hub/state"));
    if (!running) {
      ws.ensureRoute();
      await startServer(ws);
      console.error(`Truecanvas editor: http://localhost:${config.port}`);
    }
    await runStdioBridge(mcpUrl);
    return;
  }
  if (command !== "dev" && command !== "start") {
    console.log(`Unknown command "${command}".\n`);
    console.log(HELP);
    process.exit(1);
  }

  // the Truecanvas window owns this port: open the project there instead of a second server
  if (command === "dev" && (await openInWindow(root, config.port))) return;

  // first run in a project: set it up automatically
  const status = configStatus(root, config.framework);
  if (!status.wrapped) {
    const report = initProject(config);
    for (const line of report.done) console.log(`  ${c.green("✓")} ${line}`);
    for (const line of report.todo) console.log(`  ${c.dim("!")} ${line}`);
  }
  ws.ensureRoute();

  let started;
  try {
    started = await startServer(ws);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EADDRINUSE") {
      console.error(`Port ${config.port} is busy. Is Truecanvas already running? Use --port to pick another.`);
      process.exit(1);
    }
    throw err;
  }
  const { origin, shutdown } = started;
  const mcp = `${origin}/mcp`;

  // One command: start the app too, unless it's already running.
  let next: ChildProcess | null = null;
  const appUp = await reachable(config.appUrl);
  const devCommand = config.framework === "vite" ? "vite" : "next dev";
  if (!appUp && values.next && !values["no-next"]) next = startApp(root, config.appUrl, config.framework);

  console.log(`
  ${c.accent("◆")} ${c.bold("Truecanvas")} ${c.dim(`v${version}`)}

  ${c.dim("Editor")}   ${c.bold(origin)}
  ${c.dim("MCP")}      ${mcp}
  ${c.dim("App")}      ${config.appUrl} ${c.dim(appUp ? "(already running)" : next ? `(starting ${devCommand}…)` : "(not running)")}
  ${c.dim("Canvases")} ${ws.canvases().join(", ") || "none"}

${hasAgentConfig(root, config.port) ? `  ${c.dim("Agents")}   connected through .mcp.json` : `  ${c.dim("Connect your agent:")} ${c.accent("npx truecanvas connect")} ${c.dim("(writes .mcp.json; commit it for your team)")}`}
`);

  if (next) {
    const exited = new Promise<"exited">((r) => next!.once("exit", () => r("exited")));
    const result = await Promise.race([waitFor(config.appUrl, 90_000), exited]);
    if (result === true) console.log(`  ${c.green("✓")} App ready at ${config.appUrl}\n`);
    else if (result === "exited") console.log(`  ${c.dim(`${devCommand} stopped (see above). Start your app, the editor connects as soon as it's up.`)}\n`);
    else console.log(`  ${c.dim(`${devCommand} is taking a while. The editor will connect when it's up.`)}\n`);
  }
  if (values.open && !values["no-open"]) openBrowser(origin);

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    // let the dev server finish (it cleans up its own workers), but not forever
    const nextGone = next && next.exitCode === null ? new Promise((r) => next!.once("exit", r)) : Promise.resolve();
    if (next) stopTree(next, "SIGINT");
    await Promise.all([shutdown(), Promise.race([nextGone, new Promise((r) => setTimeout(r, 4000))])]);
    if (next && next.exitCode === null) stopTree(next, "SIGKILL");
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  next?.on("exit", (code) => {
    if (!stopping) console.log(`  ${c.dim(`${devCommand} exited (${code ?? "signal"}).`)}`);
  });
}

/** Opens the projects window: the desktop launcher when installed, else the hub in a browser. */
async function openWindow(cli: string, port: number) {
  const url = `http://localhost:${port}`;
  const launcher = launcherPath();
  if (launcher) {
    spawn(launcher, [], { stdio: "ignore", detached: true }).unref();
    return console.log(`${c.accent("◆")} Opening Truecanvas…`);
  }
  const up = await fetch(`${url}/api/hub/state`, { signal: AbortSignal.timeout(1500) }).then((r) => r.ok).catch(() => false);
  if (!up) {
    spawn(process.execPath, [cli, "hub", "--port", String(port), "--no-open"], { stdio: "ignore", detached: true }).unref();
    for (let i = 0; i < 40 && !(await fetch(`${url}/api/hub/state`).then((r) => r.ok).catch(() => false)); i++) await new Promise((r) => setTimeout(r, 250));
  }
  openBrowser(url);
  console.log(`${c.accent("◆")} Truecanvas is at ${c.bold(url)}  ${c.dim("(tip: `truecanvas desktop` adds it to your app launcher)")}`);
}

/** When the Truecanvas window (hub) is running, open this project in a tab there. */
async function openInWindow(root: string, port: number): Promise<boolean> {
  const hub = `http://localhost:${port}`;
  const up = await fetch(`${hub}/api/hub/state`, { signal: AbortSignal.timeout(1000) }).then((r) => r.ok).catch(() => false);
  if (!up) return false;
  const post = (route: string, body: unknown) => fetch(`${hub}${route}`, { method: "POST", headers: { "content-type": "application/json", origin: hub }, body: JSON.stringify(body) }).catch(() => null);
  await post("/api/hub/add", { path: root });
  await post("/api/hub/open", { path: root, focus: "1" });
  console.log(`${c.accent("◆")} Opened ${c.bold(path.basename(root))} in the Truecanvas window ${c.dim(`(${hub})`)}.`);
  return true;
}

async function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(`  ${question} `)).trim();
  } finally {
    rl.close();
  }
}

async function ask(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`  ${question} ${c.dim("(Y/n)")} `)).trim().toLowerCase();
    return answer === "" || answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

/**
 * Makes sure the project is set up: the dev dependency installed, next.config
 * wrapped, a first canvas, and (offered once) agents connected.
 * Returns false when the user declined or setup failed.
 */
async function ensureSetup(root: string, pkgDir: string, version: string, yes: boolean, force = false): Promise<boolean> {
  const tc = installedIn(root);
  const wrapped = configStatus(root).wrapped;
  if (tc.declared && tc.installed && wrapped && !force) return true;
  const name = readPackage(root)?.name ?? path.basename(root);
  if (!yes) {
    if (!process.stdin.isTTY) {
      console.error(`Truecanvas isn't set up in ${name} yet. Run again with --yes to set it up.`);
      return false;
    }
    console.log(`\n  ${c.accent("◆")} ${c.bold("Truecanvas")} ${c.dim(`v${version}`)}\n`);
    console.log(`  This adds Truecanvas to ${c.bold(name)}: a dev dependency, a plugin in ${configStatus(root).framework === "vite" ? "vite.config" : "next.config"},`);
    console.log(`  a ${c.bold("canvas")} script and a canvas with your homepage. Nothing changes in production builds.\n`);
    if (!(await ask("Set it up?"))) return false;
  }
  const pm = detectPm(root);
  if (!tc.declared || !tc.installed) {
    try {
      const spec = await packageSpec(pkgDir, (cmd, args, cwd) => execInherit(cmd, args, cwd));
      console.log(`\n  ${c.dim(`Installing ${spec.includes("/") ? "this build of truecanvas" : spec} with ${pm}…`)}\n`);
      await execInherit(pm, addDevArgs(pm, spec), root).catch((err) => {
        // pnpm 10+ fails when *other* packages have unapproved build scripts, after installing fine
        if (!installedIn(root).installed) throw err;
      });
    } catch (err) {
      console.error(`\n  ${c.red("✗")} Couldn't install Truecanvas: ${(err as Error).message}`);
      return false;
    }
  }
  const config = loadConfig(root);
  const report = initProject(config);
  new Workspace(config).ensureRoute();
  console.log("");
  for (const line of report.done) console.log(`  ${c.green("✓")} ${line}`);
  console.log(`  ${c.green("✓")} Canvas folder ${c.bold(config.canvasDir)}`);
  for (const line of report.todo) console.log(`  ${c.yellow("!")} ${line}`);
  if (!hasAgentConfig(root) && (yes || (process.stdin.isTTY && (await ask("Connect agents (Claude Code, Cursor…) through this project's .mcp.json?"))))) {
    printConnect(connectAgents(root, config.port), config.port);
  }
  console.log(`\n  Next time, start it with ${c.accent(runScript(pm, "canvas"))} ${c.dim("(or npx truecanvas)")}\n`);
  return true;
}

function printConnect(res: ReturnType<typeof connectAgents>, port: number) {
  for (const f of res.written) console.log(`  ${c.green("✓")} Truecanvas added to ${c.bold(f)}`);
  for (const f of res.unchanged) console.log(`  ${c.green("✓")} ${c.bold(f)} already lists Truecanvas`);
  console.log(`    ${c.dim("Commit it: anyone who clones the repo gets Truecanvas in their agent.")}`);
  console.log(`    ${c.dim(`Or for all your projects (Claude Code): claude mcp add --scope user --transport http truecanvas http://localhost:${port}/mcp`)}`);
}

async function reachable(url: string) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(1500), redirect: "manual" });
    return true;
  } catch {
    return false;
  }
}

async function waitFor(url: string, ms: number) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await reachable(url)) return true;
    await new Promise((r) => setTimeout(r, 700));
  }
  return false;
}

/**
 * Runs the project's own dev server (`next dev` or `vite`), with its output
 * prefixed so both logs stay readable. Started through node and the package's
 * bin script: no shell, so it works the same on Windows and with spaces in paths.
 */
function startApp(root: string, appUrl: string, framework: Framework): ChildProcess {
  const port = new URL(appUrl).port || (framework === "vite" ? "5173" : "3000");
  // 127.0.0.1: the dev app (and its /truecanvas routes) stays off the local network
  const devArgs = framework === "vite" ? ["--port", port, "--strictPort", "--host", "127.0.0.1"] : ["dev", "-p", port, "-H", "127.0.0.1"];
  const pkg = framework === "vite" ? "vite" : "next";
  const bin = binScript(root, pkg);
  const [cmd, args] = bin ? [process.execPath, [bin, ...devArgs]] : [process.platform === "win32" ? "npx.cmd" : "npx", [pkg, ...devArgs]];
  const label = framework === "vite" ? "vite" : "next";
  const child = spawn(cmd, args, { cwd: root, env: toolEnv(process.env.NO_COLOR ? {} : { FORCE_COLOR: "1" }), stdio: ["ignore", "pipe", "pipe"], shell: !bin && process.platform === "win32" });
  child.on("error", (err) => console.error(`  ${c.dim(`${label} │`)} couldn't start ${pkg}: ${err.message}`));
  const prefix = c.dim(`${label} │ `);
  for (const stream of [child.stdout!, child.stderr!]) {
    let buf = "";
    stream.on("data", (chunk: Buffer) => {
      buf += chunk.toString();
      const lines = buf.split(/\r?\n/);
      buf = lines.pop()!;
      for (const line of lines) if (line.trim()) process.stdout.write(`  ${prefix}${line}\n`);
    });
  }
  return child;
}

/** The JS file behind a package's bin (e.g. next/dist/bin/next), resolved from the project. */
function binScript(root: string, pkg: string): string | null {
  try {
    const req = createRequire(path.join(root, "package.json"));
    const manifest = req.resolve(`${pkg}/package.json`);
    const { bin } = JSON.parse(fs.readFileSync(manifest, "utf8")) as { bin?: string | Record<string, string> };
    const rel = typeof bin === "string" ? bin : bin?.[pkg];
    return rel ? path.join(path.dirname(manifest), rel) : null;
  } catch {
    return null;
  }
}

/** Stops a dev server and its workers. Windows has no signals for child trees: taskkill does it. */
function stopTree(child: ChildProcess, signal: NodeJS.Signals) {
  if (process.platform === "win32" && child.pid) spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" }).on("error", () => {});
  else child.kill(signal);
}

function openBrowser(url: string) {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try {
    spawn(cmd, [url], { stdio: "ignore", detached: true, shell: process.platform === "win32" }).on("error", () => {}).unref();
  } catch {
    /* no browser available */
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
