import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema, isInitializeRequest, type Tool } from "@modelcontextprotocol/sdk/types.js";
import { ProjectStore, discover, listDirs } from "./projects.js";
import { Runner, capture, cloneJob, createJob, getJob, setupJob } from "./runner.js";
import { readJson } from "../server/body.js";
import { EditError } from "../core/edit.js";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".png": "image/png",
};

const HUB_INSTRUCTIONS = `Truecanvas hub: several projects, each a Next.js app with canvases of real React components.
Your tools act on the current project (the active tab in the Truecanvas window, unless you pick one with open_project).
Use list_projects to see them. All other tools are the regular Truecanvas canvas tools for that project.`;

export async function startHub(opts: { port: number; cli: string }) {
  const store = new ProjectStore();
  const editorDir = fileURLToPath(new URL("./editor/", import.meta.url));
  const pkgDir = path.resolve(path.dirname(opts.cli), "..");
  const origin = `http://localhost:${opts.port}`;
  const allowedHosts = new Set([`localhost:${opts.port}`, `127.0.0.1:${opts.port}`]);

  // ---------- live state for the window ----------
  const clients = new Set<http.ServerResponse>();
  let active: string | null = null;
  const broadcast = () => {
    for (const res of clients) res.write(`data: {"type":"state"}\n\n`);
    for (const fn of toolListeners) fn();
  };
  const runner = new Runner(opts.cli, broadcast);
  setInterval(() => {
    for (const res of clients) res.write(": ping\n\n");
  }, 20_000).unref();

  /** a request (from the CLI) to show a project's tab in the window */
  let focus: { path: string; at: number } | null = null;

  async function state() {
    const memory = await runner.memory();
    return {
      origin,
      active,
      focus,
      projects: store.all().map((p) => {
        const r = runner.running.get(p.path);
        return { ...p, running: r ? { status: r.status, editor: `http://localhost:${r.editorPort}`, app: `http://localhost:${r.appPort}`, error: r.error, memory: memory[p.path] ?? null } : null };
      }),
    };
  }

  // ---------- MCP: proxy to the current project ----------
  const toolListeners = new Set<() => void>();
  const transports = new Map<string, StreamableHTTPServerTransport>();
  const lastUse = new Map<string, number>();
  // agents that vanish without DELETE: close their sessions (and upstream connections) after an hour idle
  setInterval(() => {
    for (const [id, at] of lastUse) {
      if (Date.now() - at < 60 * 60_000) continue;
      lastUse.delete(id);
      void transports.get(id)?.close();
    }
  }, 5 * 60_000).unref();

  function createProxy() {
    const server = new Server({ name: "truecanvas", version: "0.1.0" }, { capabilities: { tools: { listChanged: true } }, instructions: HUB_INSTRUCTIONS });
    let current: string | null = null; // project chosen by the agent, else the active tab
    // one connection per running project process: a restarted project gets a fresh one
    const upstreams = new Map<string, { pid: number | undefined; client: Promise<Client> }>();
    const target = () => current ?? active;
    const drop = (dir: string) => {
      const hit = upstreams.get(dir);
      upstreams.delete(dir);
      void hit?.client.then((c) => c.close()).catch(() => {});
    };
    const upstream = (dir: string) => {
      const run = runner.running.get(dir);
      if (!run || run.status !== "ready") return null;
      const hit = upstreams.get(dir);
      if (hit && hit.pid === run.proc.pid) return hit.client;
      if (hit) drop(dir);
      const info = server.getClientVersion();
      const client = new Client({ name: info?.name ?? "agent", version: info?.version ?? "0.0.0" });
      const c = client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${run.editorPort}/mcp`))).then(() => client);
      c.catch(() => upstreams.delete(dir));
      upstreams.set(dir, { pid: run.proc.pid, client: c });
      return c;
    };
    /** Runs a call on the project, reconnecting once if its session went away. */
    const withUpstream = async <T,>(dir: string, fn: (c: Client) => Promise<T>): Promise<T | null> => {
      for (let attempt = 0; attempt < 2; attempt++) {
        const up = upstream(dir);
        if (!up) return null;
        try {
          return await fn(await up);
        } catch (err) {
          drop(dir);
          // only a lost session is retried: a timeout may have applied an edit already
          const lost = /session|not connected|ECONNREFUSED|ECONNRESET|fetch failed|404/i.test((err as Error).message ?? "");
          if (attempt === 1 || !lost) throw err;
        }
      }
      return null;
    };
    const notify = () => void server.sendToolListChanged().catch(() => {});
    toolListeners.add(notify);
    server.onclose = () => {
      toolListeners.delete(notify);
      for (const dir of [...upstreams.keys()]) drop(dir);
    };

    const hubTools: Tool[] = [
      { name: "list_projects", description: "Projects known to the Truecanvas hub, which are open, and which one your tools act on.", inputSchema: { type: "object", properties: {} } },
      {
        name: "open_project",
        description: "Open a project (starts its app if needed) and make it the target of your tools.",
        inputSchema: { type: "object", properties: { project: { type: "string", description: "Project name or path." } }, required: ["project"] },
      },
    ];

    server.setRequestHandler(ListToolsRequestSchema, async () => {
      const dir = target();
      // the hub's own tools stay available even when the project can't answer
      const projectTools = dir ? ((await withUpstream(dir, (c) => c.listTools()).catch(() => null))?.tools ?? []) : [];
      return { tools: [...hubTools, ...projectTools] };
    });

    server.setRequestHandler(CallToolRequestSchema, async (req) => {
      const text = (t: string, isError = false) => ({ content: [{ type: "text" as const, text: t }], isError });
      if (req.params.name === "list_projects") {
        const s = await state();
        const lines = s.projects.map((p) => `${p.path === target() ? "→ " : "  "}${p.name} (${p.path})${p.running ? ` [${p.running.status}]` : ""}${p.ready ? "" : " (Truecanvas not set up)"}`);
        return text(lines.join("\n") || "No projects yet. The user can add some from the Dashboard.");
      }
      if (req.params.name === "open_project") {
        const q = String((req.params.arguments as { project?: string })?.project ?? "").toLowerCase();
        const p = store.all().find((x) => x.name.toLowerCase() === q || x.path.toLowerCase() === q || path.basename(x.path).toLowerCase() === q);
        if (!p) return text(`No project "${q}". Use list_projects.`, true);
        if (!p.ready) return text(`${p.name} isn't set up for Truecanvas yet. Ask the user to click "Set up" on the Dashboard.`, true);
        store.touch(p.path);
        const run = await runner.open(p.path);
        if (run.status !== "ready") return text(`Couldn't start ${p.name}: ${run.error}`, true);
        current = p.path;
        notify();
        return text(`✓ ${p.name} is open. Your tools now act on it.`);
      }
      const dir = target();
      // screenshots can take a while when Next is still compiling
      const out = dir ? await withUpstream(dir, (c) => c.callTool(req.params, undefined, { timeout: 180_000 })) : null;
      if (!out) return text("No project is open. Use list_projects and open_project, or open one in the Truecanvas window.", true);
      return out as never;
    });
    return server;
  }

  async function handleMcp(req: http.IncomingMessage, res: http.ServerResponse) {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    const body = req.method === "POST" ? await readJson(req) : undefined;
    let transport = sessionId ? transports.get(sessionId) : undefined;
    if (sessionId && transport) lastUse.set(sessionId, Date.now());
    if (!transport) {
      if (req.method !== "POST" || !isInitializeRequest(body)) return json(res, 400, { jsonrpc: "2.0", error: { code: -32000, message: "No valid MCP session." }, id: null });
      const t: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          transports.set(id, t);
          lastUse.set(id, Date.now());
        },
      });
      t.onclose = () => {
        if (t.sessionId) {
          transports.delete(t.sessionId);
          lastUse.delete(t.sessionId);
        }
      };
      await createProxy().connect(t);
      transport = t;
    }
    await transport.handleRequest(req, res, body);
  }

  // ---------- REST ----------
  async function api(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
    const route = `${req.method} ${url.pathname}`;
    const body = req.method === "POST" ? ((await readJson(req)) as Record<string, string>) : {};
    switch (route) {
      case "GET /api/hub/state":
        return json(res, 200, await state());
      case "GET /api/hub/discover": {
        const known = new Set(store.all().map((p) => p.path));
        return json(res, 200, { found: discover().filter((f) => !known.has(f.path)) });
      }
      case "GET /api/hub/icon": {
        const icon = findIcon(url.searchParams.get("path") ?? "");
        if (!icon) return json(res, 404, { error: "No icon" });
        res.writeHead(200, { "content-type": ICON_MIME[path.extname(icon)] ?? "application/octet-stream", "cache-control": "private, max-age=300" });
        return fs.createReadStream(icon).on("error", () => res.destroy()).pipe(res);
      }
      case "GET /api/hub/ls":
        return json(res, 200, listDirs(url.searchParams.get("path") || "~"));
      case "GET /api/hub/events":
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
        res.write(": connected\n\n");
        clients.add(res);
        req.on("close", () => clients.delete(res));
        return;
      case "POST /api/hub/add": {
        const dir = path.resolve(body.path.replace(/^~(?=$|\/)/, process.env.HOME ?? "~"));
        if (!fs.existsSync(path.join(dir, "package.json"))) return json(res, 400, { error: "No package.json in that folder. Pick the root of a Next.js app." });
        store.touch(dir);
        broadcast();
        // set up already: the window opens its tab right away
        return json(res, 200, { path: dir, ready: store.all().find((p) => p.path === dir)?.ready ?? false });
      }
      case "POST /api/hub/open": {
        store.touch(body.path);
        active = body.path;
        if (body.focus) focus = { path: body.path, at: Date.now() };
        let run;
        try {
          run = await runner.open(body.path);
        } catch (err) {
          broadcast();
          return json(res, 400, { error: (err as Error).message });
        }
        broadcast();
        return json(res, 200, { status: run.status, editor: `http://localhost:${run.editorPort}`, error: run.error });
      }
      case "POST /api/hub/close":
        runner.close(body.path);
        if (active === body.path) active = null;
        broadcast();
        return json(res, 200, { ok: true });
      case "POST /api/hub/active":
        active = body.path || null;
        broadcast();
        return json(res, 200, { ok: true });
      case "POST /api/hub/forget":
        runner.close(body.path);
        store.forget(body.path);
        broadcast();
        return json(res, 200, { ok: true });
      case "POST /api/hub/setup":
        return json(res, 200, setupJob(body.path, pkgDir, opts.cli));
      case "POST /api/hub/create":
        return json(res, 200, createJob(body.name, body.parent, pkgDir, opts.cli));
      // ---------- GitHub ----------
      case "GET /api/hub/github/repos": {
        const r = await capture("gh", ["repo", "list", "--limit", "100", "--json", "nameWithOwner,description,updatedAt,isPrivate"], os.homedir());
        if (!r.ok) return json(res, 200, { gh: false, error: r.out.split("\n")[0], repos: [] });
        const repos = (JSON.parse(r.out) as { updatedAt: string }[]).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        return json(res, 200, { gh: true, repos });
      }
      case "POST /api/hub/clone":
        return json(res, 200, cloneJob(body.repo, body.parent || "~", pkgDir, opts.cli));
      case "GET /api/hub/prs": {
        const dir = url.searchParams.get("path") ?? "";
        const r = await capture("gh", ["pr", "list", "--limit", "30", "--json", "number,title,headRefName,author,updatedAt,isDraft,url"], dir);
        if (!r.ok) {
          const msg = /no git remotes|not a git repository|none of the git remotes/i.test(r.out) ? "This project isn't on GitHub yet. Publish it from the Git panel (branch pill) first." : /gh auth login|not logged/i.test(r.out) ? "Sign in to GitHub first: run gh auth login in a terminal." : r.out.split("\n")[0];
          return json(res, 200, { error: msg, prs: [] });
        }
        return json(res, 200, { prs: JSON.parse(r.out) });
      }
      case "POST /api/hub/pr-checkout": {
        const r = await capture("gh", ["pr", "checkout", String(Number(body.number))], body.path);
        if (!r.ok) {
          const dirty = /local changes|would be overwritten|uncommitted/i.test(r.out);
          return json(res, 400, { error: dirty ? "This project has uncommitted changes. Commit them (Git panel) before opening another pull request." : r.out.split("\n").slice(-2).join(" ") });
        }
        store.touch(body.path);
        active = body.path;
        await runner.open(body.path);
        broadcast();
        return json(res, 200, { ok: true });
      }
      case "POST /api/hub/quit":
        json(res, 200, { ok: true });
        // wait for every project (and its next dev) to exit before leaving
        void runner.closeAll().finally(() => process.exit(0));
        return;
    }
    const job = /^GET \/api\/hub\/jobs\/(\d+)$/.exec(route);
    if (job) {
      const j = getJob(job[1]);
      if (j?.status === "done" && j.result) {
        store.touch(j.result);
        broadcast();
      }
      return j ? json(res, 200, j) : json(res, 404, { error: "No such job" });
    }
    return json(res, 404, { error: `No route ${route}` });
  }

  function serveStatic(res: http.ServerResponse, pathname: string) {
    let file = path.join(editorDir, pathname === "/" ? "hub.html" : pathname);
    if (!inside(editorDir, file) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(editorDir, "hub.html");
    if (!fs.existsSync(file)) {
      res.writeHead(500, { "content-type": "text/plain" });
      return res.end("Hub bundle missing. Run `pnpm build`.");
    }
    res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream", "cache-control": pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache" });
    fs.createReadStream(file).on("error", () => res.destroy()).pipe(res);
  }

  const server = http.createServer(async (req, res) => {
    try {
      if (!allowedHosts.has(req.headers.host ?? "")) return json(res, 403, { error: "Forbidden host" });
      const reqOrigin = req.headers.origin;
      if (reqOrigin && reqOrigin !== origin && reqOrigin !== `http://127.0.0.1:${opts.port}`) return json(res, 403, { error: "Forbidden origin" });
      const url = new URL(req.url ?? "/", origin);
      if (url.pathname === "/mcp") return await handleMcp(req, res);
      if (url.pathname.startsWith("/api/")) return await api(req, res, url);
      if (req.method === "GET") return serveStatic(res, url.pathname);
      json(res, 405, { error: "Method not allowed" });
    } catch (err) {
      if (!res.headersSent) json(res, err instanceof EditError ? 400 : 500, { error: (err as Error).message });
      else res.end();
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, "127.0.0.1", resolve);
  });
  const shutdown = () => {
    server.close();
    return runner.closeAll();
  };
  const exit = () => void shutdown().finally(() => process.exit(0));
  process.once("SIGINT", exit);
  process.once("SIGTERM", exit);
  return { origin, shutdown };
}

const ICON_MIME: Record<string, string> = { ".ico": "image/x-icon", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };

/** Next.js icon conventions first (app/icon.*, app/favicon.ico), then public/. */
function findIcon(dir: string): string | null {
  if (!dir || !fs.existsSync(path.join(dir, "package.json"))) return null;
  const names = ["icon.svg", "icon.png", "favicon.svg", "favicon.ico", "icon.ico", "apple-icon.png", "favicon.png", "logo.svg", "icon.jpg"];
  const roots = ["app", "src/app", "public", "static", "assets"];
  for (const root of roots) {
    for (const name of names) {
      const file = path.join(dir, root, name);
      if (fs.existsSync(file) && fs.statSync(file).size < 2_000_000) return file;
    }
  }
  // app/[lang]/icon.* style route groups, one level deep
  for (const root of ["app", "src/app"]) {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(path.join(dir, root), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      for (const name of names.slice(0, 4)) {
        const file = path.join(dir, root, e.name, name);
        if (fs.existsSync(file)) return file;
      }
    }
  }
  return null;
}

function json(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

/** `file` is within `dir` (works whether or not `dir` ends with a separator). */
function inside(dir: string, file: string): boolean {
  const rel = path.relative(dir, file);
  return !!rel && !rel.startsWith("..") && !path.isAbsolute(rel);
}
