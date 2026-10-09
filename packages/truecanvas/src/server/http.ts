import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import launchEditor from "launch-editor";
import { Workspace, type Command, type WorkspaceEvent } from "../core/workspace.js";
import { EditError } from "../core/edit.js";
import { createMcpServer } from "./mcp.js";
import { readTokenData } from "../core/tokens.js";
import { layoutFiles, listRoutes } from "../core/routes.js";
import { Thumbnails } from "./thumbnails.js";
import { syncComponentRegistry } from "../core/scaffold.js";
import { clearCompare, frameChanges, writeCompare } from "../core/compare.js";
import { parseCanvas as parseSource } from "../core/parse.js";
import { Screenshotter } from "./screenshot.js";
import { appRun } from "./app-run.js";
import { componentsDir } from "../core/components.js";
import { prDesignSection, renderFrame, reviewAll, reviewPage, type PageReview, type PrImage } from "./review.js";
import type { PullRequest } from "../core/git.js";
import { readJson } from "./body.js";
import { addShadcnComponents, installIconLibrary, libraryState, shadcnRegistry } from "../core/libraries.js";
import { loadIcons, searchIcons } from "../core/icons.js";
import { shadcnStatus } from "../core/shadcn.js";
import { createSnapshot, sharesDir } from "../share/snapshot.js";
import { linkInfo, parseEmails, publishSnapshot, reviewSite, siteFeatures, type Access, type LiveSite } from "../share/publish.js";
import { canExport, exportSite } from "../share/export.js";
import { ShotService } from "./shot.js";
import { CommentSync } from "../share/sync.js";
import { Sessions } from "../share/session.js";
import { assertCanvasName } from "../core/scaffold.js";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".json": "application/json",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".ico": "image/x-icon",
};

export async function startServer(ws: Workspace) {
  /** What Share is doing right now, shown as the dialog's progress. */
  let shareStep: string | null = null;
  const { config } = ws;
  const editorDir = fileURLToPath(new URL("./editor/", import.meta.url));
  const shots = new Screenshotter(config.appUrl);
  let prCache: { key: string; at: number; pr: PullRequest | null } | null = null;
  const thumbs = new Thumbnails(ws, shots);
  // shots: frames staged for social posts (the editor's Shot dialog, the CLI, MCP)
  const shotService = new ShotService(ws, shots, () => origin);
  // client comments on share links, both ways
  // the Truecanvas window (hub) that started this project hears about them, to notify the studio
  const hub = process.env.TRUECANVAS_HUB_URL;
  // editors open on this project (server-sent events), filled in below
  const clients = new Set<http.ServerResponse>();
  const commentSync = new CommentSync(ws, (e) => {
    // the editor says it in place; the desktop app also shows a notification
    const data = `data: ${JSON.stringify({ type: "client-comment", ...e })}\n\n`;
    for (const res of clients) res.write(data);
    if (hub)
      void fetch(`${hub}/api/hub/notify`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: config.root, ...e }), signal: AbortSignal.timeout(5000) }).catch(() => {});
  });
  commentSync.start();
  // keep the preview registry in sync with the component catalog
  const syncRegistry = () =>
    ws.catalog
      .load()
      .then((list) => syncComponentRegistry(config, list))
      .catch(() => {});
  void syncRegistry();
  const origin = `http://localhost:${config.port}`;
  const allowedHosts = new Set([`localhost:${config.port}`, `127.0.0.1:${config.port}`]);
  const allowedOrigins = new Set([origin, `http://127.0.0.1:${config.port}`]);

  // ---------- live events (SSE) ----------
  const broadcast = (e: WorkspaceEvent) => {
    const data = `data: ${JSON.stringify(e)}\n\n`;
    for (const res of clients) res.write(data);
  };
  ws.on(broadcast);
  // live sessions on share links: the room's events go to the editor (cursors, who's here),
  // and a comment written on the link is pulled in right away instead of at the next poll
  const sendRaw = (e: unknown) => {
    const data = `data: ${JSON.stringify(e)}\n\n`;
    for (const res of clients) res.write(data);
  };
  const sessions = new Sessions(path.basename(config.root), config.appUrl, {
    onEvent: (canvas, e) => {
      if (e.t === "comments") void commentSync.syncAll();
      else sendRaw({ type: "room", canvas, event: e });
    },
    onState: (s) => sendRaw({ type: "session", session: s }),
  });
  setInterval(() => {
    for (const res of clients) res.write(": ping\n\n");
    ws.pruneAgents();
  }, 20_000).unref();

  // ---------- MCP sessions ----------
  const transports = new Map<string, StreamableHTTPServerTransport>();
  const lastUse = new Map<string, number>();
  // clients that vanish without DELETE: close their sessions after an hour idle
  setInterval(() => {
    for (const [id, at] of lastUse) {
      if (Date.now() - at < 60 * 60_000) continue;
      lastUse.delete(id);
      void transports.get(id)?.close();
    }
  }, 5 * 60_000).unref();

  async function handleMcp(req: http.IncomingMessage, res: http.ServerResponse) {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    const body = req.method === "POST" ? await readJson(req) : undefined;
    let transport = sessionId ? transports.get(sessionId) : undefined;
    if (req.method === "DELETE" && sessionId) ws.dropAgent(sessionId);
    if (sessionId && transport) lastUse.set(sessionId, Date.now());
    if (!transport) {
      if (req.method !== "POST" || !isInitializeRequest(body)) {
        return json(res, 400, { jsonrpc: "2.0", error: { code: -32000, message: "No valid MCP session. Re-initialize." }, id: null });
      }
      let sid = "";
      const t: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          sid = id;
          transports.set(id, t);
        },
      });
      t.onclose = () => {
        if (sid) {
          transports.delete(sid);
          lastUse.delete(sid);
          ws.dropAgent(sid);
        }
      };
      const server = createMcpServer(ws, shots, () => sid, sessions, shotService);
      await server.connect(t);
      transport = t;
    }
    await transport.handleRequest(req, res, body);
  }

  // ---------- REST for the editor ----------
  async function handleApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
    const route = `${req.method} ${url.pathname}`;
    const user = { kind: "user" } as const;
    switch (route) {
      case "GET /api/app":
        return json(res, 200, appRun);
      case "GET /api/state":
        return json(res, 200, {
          appUrl: config.appUrl,
          framework: config.framework,
          root: config.root,
          projectName: path.basename(config.root),
          canvases: ws.canvases(),
          darkMode: config.darkMode,
          agents: [...ws.agents.values()],
          feed: ws.publicFeed().slice(-100),
          mcpUrl: `${origin}/mcp`,
          componentsDir: componentsDir(config),
        });
      case "GET /api/canvas": {
        const name = url.searchParams.get("name")!;
        return json(res, 200, { doc: ws.doc(name), history: ws.historyState(name) });
      }
      case "GET /api/thumb": {
        const name = url.searchParams.get("component") ?? "";
        const preset = url.searchParams.get("preset") ?? undefined;
        const png = await thumbs.get(name, preset);
        res.writeHead(200, { "content-type": "image/png", "cache-control": "private, max-age=30" });
        return res.end(png);
      }
      // ---------- git ----------
      case "GET /api/git/status":
        return json(res, 200, { ...(await ws.git.status()), linked: ws.designFiles() });
      case "GET /api/git/branches":
        return json(res, 200, await ws.git.branches());
      case "GET /api/git/log": {
        const canvas = url.searchParams.get("canvas");
        return json(res, 200, { commits: await ws.git.log(canvas ? [ws.relFile(canvas), ws.comments.file(canvas)] : [config.canvasDir]) });
      }
      case "POST /api/git/fetch":
        await ws.git.fetch();
        return json(res, 200, { ...(await ws.git.status()), linked: ws.designFiles() });
      case "POST /api/git/commit": {
        const { message, scope } = (await readJson(req)) as { message: string; scope: "canvas" | "all" };
        const status = await ws.git.status();
        const linked = new Set(ws.designFiles());
        const files = status.files.map((f) => f.path).filter((f) => scope === "all" || f.startsWith(`${config.canvasDir}/`) || linked.has(f));
        const hash = await ws.git.commit(message, files);
        ws.emit({ type: "git" });
        return json(res, 200, { hash });
      }
      case "POST /api/git/push":
        await ws.git.push();
        ws.emit({ type: "git" });
        return json(res, 200, { ok: true });
      case "POST /api/git/pull":
        await ws.git.pull();
        ws.emit({ type: "git" });
        return json(res, 200, { ok: true });
      case "POST /api/git/switch": {
        const { branch, create } = (await readJson(req)) as { branch: string; create?: boolean };
        await ws.git.switch(branch, create);
        ws.emit({ type: "git" });
        return json(res, 200, { ok: true });
      }
      // ---------- review & pull requests ----------
      case "GET /api/git/changes":
        return json(res, 200, { pages: await reviewAll(ws) });
      case "GET /api/git/preview": {
        const canvas = url.searchParams.get("canvas") ?? "";
        const frame = url.searchParams.get("frame") ?? "";
        const side = url.searchParams.get("side") === "before" ? "before" : "after";
        const st = await ws.git.status();
        const img = await renderFrame(ws, shots, canvas, frame, side, st.unborn ? "__none__" : "HEAD");
        if (!img) return json(res, 404, { error: "No such frame in that version." });
        res.writeHead(200, { "content-type": "image/jpeg", "cache-control": "no-store" });
        return res.end(img);
      }
      case "GET /api/git/diff": {
        const canvas = url.searchParams.get("canvas") ?? "";
        const page = await reviewPage(ws, canvas, "HEAD", 0);
        return json(res, 200, { diff: page ? await ws.git.diff(page.files) : "" });
      }
      case "GET /api/git/pr": {
        const st = await ws.git.status();
        if (!st.remote || !st.branch) return json(res, 200, { pr: null, github: false });
        const key = `${st.branch}`;
        if (url.searchParams.get("fresh") || !prCache || prCache.key !== key || Date.now() - prCache.at > 20_000) {
          prCache = { key, at: Date.now(), pr: await ws.git.pullRequest().catch(() => null) };
        }
        return json(res, 200, { pr: prCache.pr, github: /github\.com/.test(st.remote) });
      }
      case "POST /api/git/pr": {
        const { title, body, screenshots, draft } = (await readJson(req)) as { title: string; body?: string; screenshots?: boolean; draft?: boolean };
        if (!title?.trim()) throw new EditError("Give the pull request a title.");
        const st = await ws.git.status();
        if (!st.remote) throw new EditError("This project has no GitHub remote yet. Publish it to GitHub first.");
        const base = st.defaultBranch ?? "main";
        if (!st.branch || st.branch === base) throw new EditError(`You're on ${base}. Start a branch for your changes first.`);
        await ws.git.push();
        if (!/github\.com/.test(st.remote)) throw new EditError(`Pushed ${st.branch}. Opening pull requests from Truecanvas needs a GitHub remote (origin is ${st.remote}); open it on your git host.`);
        // design changes between the base and this branch
        const fork = await ws.git.mergeBase(base);
        const pages: PageReview[] = [];
        if (fork) {
          const since = await ws.git.commitAt(fork);
          for (const canvas of ws.canvases()) {
            const page = await reviewPage(ws, canvas, fork, since).catch(() => null);
            if (page) pages.push(page);
          }
        }
        const images: PrImage[] = [];
        if (screenshots && fork && pages.length) {
          const repo = await ws.git.githubRepo();
          const files: { path: string; data: Buffer }[] = [];
          const targets = pages.flatMap((p) => p.frames.filter((f) => f.status !== "removed").map((f) => ({ canvas: p.canvas, frame: f.name, added: f.status === "added" }))).slice(0, 6);
          const stamp = Date.now().toString(36);
          const slug = (v: string) => v.replace(/[^\w.-]+/g, "-");
          for (const t of targets) {
            const img: PrImage = { canvas: t.canvas, frame: t.frame, before: null, after: null };
            for (const side of ["before", "after"] as const) {
              if (side === "before" && t.added) continue;
              const data = await renderFrame(ws, shots, t.canvas, t.frame, side, fork).catch(() => null);
              if (!data) continue;
              const file = `${slug(st.branch)}/${stamp}/${slug(t.canvas)}-${slug(t.frame)}-${side}.jpg`;
              files.push({ path: file, data });
              if (repo) img[side] = `https://github.com/${repo}/blob/truecanvas-previews/${file.split("/").map(encodeURIComponent).join("/")}?raw=true`;
            }
            images.push(img);
          }
          if (files.length && repo) await ws.git.commitToSideBranch("truecanvas-previews", files, `Previews for ${st.branch}`);
        }
        const fullBody = [body?.trim(), prDesignSection(pages, images)].filter(Boolean).join("\n\n");
        let prUrl: string;
        try {
          prUrl = await ws.git.createPullRequest({ title: title.trim(), body: fullBody, base, draft });
        } catch (err) {
          const existing = /https:\/\/github\.com\/\S+\/pull\/\d+/.exec((err as Error).message);
          if (!existing) throw err;
          prUrl = existing[0];
        }
        prCache = null;
        ws.emit({ type: "git" });
        return json(res, 200, { url: prUrl });
      }
      case "POST /api/git/publish": {
        const { name, private: isPrivate } = (await readJson(req)) as { name: string; private?: boolean };
        const remote = await ws.git.publish(name, isPrivate !== false);
        ws.emit({ type: "git" });
        return json(res, 200, { remote });
      }
      case "POST /api/compare": {
        const { canvas, ref } = (await readJson(req)) as { canvas: string; ref: string };
        const before = await ws.git.show(ref, ws.relFile(canvas));
        if (before === null) return json(res, 400, { error: `This page doesn't exist on ${ref}.` });
        // linked frames render their page: snapshot the page and layouts at that ref too
        const files: Record<string, string> = {};
        const touched = new Set<string>();
        for (const f of parseSource(canvas, ws.relFile(canvas), before).frames) {
          if (!f.page) continue;
          for (const file of [f.page, ...layoutFiles(config, f.page)]) {
            const old = await ws.git.show(ref, file);
            if (old === null) continue;
            const now = fs.existsSync(path.join(config.root, file)) ? fs.readFileSync(path.join(config.root, file), "utf8") : null;
            if (old !== now) {
              files[file] = old;
              touched.add(f.frameName);
            }
          }
        }
        const name = writeCompare(config, canvas, before, files);
        const changes = frameChanges(before, ws.read(canvas));
        for (const frame of touched) if (changes[frame] === "same") changes[frame] = "changed";
        return json(res, 200, { name, doc: parseSource(name, ws.relFile(canvas), before), changes });
      }
      case "POST /api/compare/clear": {
        const { canvas } = (await readJson(req)) as { canvas?: string };
        clearCompare(config, canvas);
        return json(res, 200, { ok: true });
      }
      // ---------- comments ----------
      case "GET /api/comments":
        return json(res, 200, { threads: ws.comments.list(url.searchParams.get("canvas") ?? "") });
      case "POST /api/comments": {
        const b = (await readJson(req)) as { canvas: string; frame: string; x: number; y: number; node?: { path: string; name: string } | null; text: string };
        if (!b.text?.trim()) return json(res, 400, { error: "Write a comment." });
        const thread = ws.comments.add(b.canvas, { ...b, author: await ws.userAuthor() });
        ws.commentsChanged(b.canvas);
        return json(res, 200, { thread });
      }
      case "POST /api/comments/reply": {
        const b = (await readJson(req)) as { canvas: string; id: string; text: string };
        if (!b.text?.trim()) return json(res, 400, { error: "Write a reply." });
        const thread = ws.comments.reply(b.canvas, b.id, b.text, await ws.userAuthor());
        ws.commentsChanged(b.canvas);
        return json(res, 200, { thread });
      }
      case "POST /api/comments/resolve": {
        const b = (await readJson(req)) as { canvas: string; id: string; resolved: boolean };
        const thread = ws.comments.resolve(b.canvas, b.id, b.resolved, await ws.userAuthor());
        ws.commentsChanged(b.canvas);
        return json(res, 200, { thread });
      }
      case "POST /api/comments/delete": {
        const b = (await readJson(req)) as { canvas: string; id: string };
        ws.comments.remove(b.canvas, b.id);
        ws.commentsChanged(b.canvas);
        return json(res, 200, { ok: true });
      }
      case "GET /api/routes":
        return json(res, 200, { routes: listRoutes(config) });
      case "GET /api/tokens":
        return json(res, 200, readTokenData(config.root));
      case "GET /api/components":
        return json(res, 200, { components: await ws.catalog.load() });
      // ---------- libraries: icon sets and shadcn/ui ----------
      case "GET /api/libraries":
        return json(res, 200, libraryState(config.root));
      case "GET /api/libraries/shadcn":
        return json(res, 200, { ...(await shadcnRegistry()), status: shadcnStatus(config.root) });
      case "GET /api/icons": {
        const icons = await loadIcons(config.root, url.searchParams.get("library") ?? "");
        const limit = Math.min(Number(url.searchParams.get("limit")) || 240, 1000);
        return json(res, 200, searchIcons(icons, url.searchParams.get("q") ?? "", limit));
      }
      case "POST /api/libraries/icons": {
        const { id } = (await readJson(req)) as { id: string };
        const out = await installIconLibrary(config.root, id);
        return json(res, 200, { ...out, out: out.out.slice(-4000), state: libraryState(config.root) });
      }
      case "POST /api/libraries/shadcn": {
        const { names } = (await readJson(req)) as { names: string[] };
        const out = await addShadcnComponents(config.root, Array.isArray(names) ? names.map(String) : []);
        // new files in components/ui: the catalog picks them up
        ws.catalog.invalidate();
        broadcast({ type: "catalog" });
        return json(res, 200, { ...out, out: out.out.slice(-4000), state: libraryState(config.root) });
      }
      case "GET /api/events": {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
        res.write(": connected\n\n");
        clients.add(res);
        req.on("close", () => clients.delete(res));
        return;
      }
      case "POST /api/command": {
        const cmd = (await readJson(req)) as Command;
        const out = await ws.run(cmd, user);
        return json(res, 200, { doc: out.doc, ids: out.ids, label: out.label });
      }
      case "POST /api/undo":
      case "POST /api/redo": {
        const { canvas } = (await readJson(req)) as { canvas: string };
        const out = route.endsWith("undo") ? await ws.undo(canvas, user) : await ws.redo(canvas, user);
        return json(res, 200, out);
      }
      case "POST /api/selection": {
        const sel = (await readJson(req)) as { canvas: string | null; ids: string[] };
        ws.selection = { canvas: sel.canvas, ids: sel.ids ?? [] };
        return json(res, 200, { ok: true });
      }
      case "GET /api/canvases":
        return json(res, 200, { canvases: ws.canvasInfos() });
      case "POST /api/canvases": {
        const { name } = (await readJson(req)) as { name: string };
        ws.createCanvas(name, user);
        return json(res, 200, { canvases: ws.canvases() });
      }
      case "POST /api/canvases/rename": {
        const { from, to } = (await readJson(req)) as { from: string; to: string };
        return json(res, 200, { name: ws.renameCanvas(from, to) });
      }
      case "POST /api/canvases/duplicate": {
        const { name } = (await readJson(req)) as { name: string };
        return json(res, 200, { name: ws.duplicateCanvas(name) });
      }
      case "POST /api/canvases/delete": {
        const { name } = (await readJson(req)) as { name: string };
        ws.deleteCanvas(name);
        return json(res, 200, { ok: true });
      }
      case "POST /api/canvases/restore": {
        const { name } = (await readJson(req)) as { name: string };
        return json(res, 200, { name: ws.restoreCanvas(name) });
      }
      case "POST /api/open": {
        const { canvas, id } = (await readJson(req)) as { canvas: string; id?: string; file?: string };
        const hit = id ? ws.nodeSource(canvas, id) : null;
        const target = `${hit?.abs ?? ws.file(canvas)}:${hit?.node.line ?? 1}:${(hit?.node.col ?? 0) + 1}`;
        launchEditor(target, config.editor);
        return json(res, 200, { ok: true });
      }
      case "POST /api/open-file": {
        const { file } = (await readJson(req)) as { file: string };
        const abs = path.resolve(config.root, file);
        const rel = path.relative(config.root, abs);
        if (rel.startsWith("..") || path.isAbsolute(rel)) return json(res, 400, { error: "Outside project." });
        launchEditor(abs, config.editor);
        return json(res, 200, { ok: true });
      }
      case "GET /api/share/status": {
        const site = reviewSite();
        // what the site can do (invitations need sign-in): offline or an older site, nothing extra
        const features = site ? await siteFeatures(site).catch(() => []) : [];
        return json(res, 200, { site: site ? site.url : null, features, realSite: canExport(config) && features.includes("live-files") });
      }
      case "GET /api/share/link": {
        // the canvas's link as it is now, for the Share dialog (null: never shared, or no review site)
        const canvas = url.searchParams.get("canvas") ?? "";
        assertCanvasName(canvas);
        const site = reviewSite();
        return json(res, 200, { link: site ? await linkInfo(site, path.basename(config.root), canvas).catch(() => null) : null });
      }
      // ---------- shots ----------
      case "GET /api/shots": {
        const canvas = url.searchParams.get("canvas") ?? "";
        assertCanvasName(canvas);
        return json(res, 200, { shots: ws.shots.list(canvas) });
      }
      case "POST /api/shots": {
        const { canvas, shot } = (await readJson(req)) as { canvas: string; shot: unknown };
        assertCanvasName(canvas);
        return json(res, 200, { shot: ws.shots.save(canvas, shot) });
      }
      case "POST /api/shots/delete": {
        const { canvas, id } = (await readJson(req)) as { canvas: string; id: string };
        assertCanvasName(canvas);
        return json(res, 200, { removed: ws.shots.remove(canvas, id) });
      }
      case "POST /api/shot/capture": {
        // the frame as the app renders it, for the editor's live preview (cached)
        const { canvas, shot, fresh } = (await readJson(req)) as { canvas: string; shot: unknown; fresh?: boolean };
        assertCanvasName(canvas);
        const { key, capture } = await shotService.capture(canvas, shot, !!fresh);
        return json(res, 200, { image: { src: `/api/shot/frame?key=${key}&t=${capture.at}`, width: capture.width, height: capture.height } });
      }
      case "GET /api/shot/frame": {
        const png = shotService.image(url.searchParams.get("key") ?? "");
        if (!png) return json(res, 404, { error: "Not captured" });
        res.writeHead(200, { "content-type": "image/png", "cache-control": "private, max-age=600" });
        return res.end(png);
      }
      case "GET /api/shot/job": {
        const job = shotService.job(url.searchParams.get("id") ?? "");
        return job ? json(res, 200, job) : json(res, 404, { error: "No such shot" });
      }
      case "POST /api/shot/export": {
        const { canvas, shot } = (await readJson(req)) as { canvas: string; shot: unknown };
        assertCanvasName(canvas);
        const out = await shotService.export(canvas, shot);
        res.writeHead(200, { "content-type": "image/png", "cache-control": "no-store", "x-shot-size": `${out.width}x${out.height}` });
        return res.end(out.png);
      }
      case "GET /api/share/progress":
        return json(res, 200, { step: shareStep });
      case "POST /api/share/snapshot": {
        // local: a preview only. Otherwise published to the studio's review site when one is set up.
        const { canvas, frames, local, title, password, live, access, invite, realSite } = (await readJson(req)) as {
          canvas: string;
          frames?: string[];
          local?: boolean;
          title?: string;
          password?: string | null;
          live?: LiveSite;
          access?: Access;
          invite?: string[];
          /** build the app as a static site so clients get the real pages (default: when the review site hosts them) */
          realSite?: boolean;
        };
        assertCanvasName(canvas);
        const site = local ? null : reviewSite();
        let built: Awaited<ReturnType<typeof exportSite>> | null = null;
        // why the real site isn't in this version, when it couldn't be built
        let realSiteError: string | null = null;
        try {
          shareStep = "Rendering every frame through your app";
          const { dir, manifest } = await createSnapshot(ws, shots, canvas, { frames });
          const preview = `${origin}/share/${encodeURIComponent(canvas)}/${manifest.id}/`;
          let liveSite = live;
          if (site && !live && realSite !== false && canExport(config) && (await siteFeatures(site).catch((): string[] => [])).includes("live-files")) {
            shareStep = "Building the real site";
            try {
              built = await exportSite(config);
              liveSite = { dir: built.dir };
            } catch (err) {
              realSiteError = (err as Error).message;
            }
          }
          if (site) shareStep = `Uploading to ${site.url.replace(/^https?:\/\//, "")}`;
          const published = site ? await publishSnapshot(site, dir, manifest, { title, password, live: liveSite, access, invite: invite?.length ? parseEmails(invite) : undefined }) : null;
          if (published) commentSync.forget(canvas);
          return json(res, 200, { manifest, preview, published, realSiteError });
        } finally {
          built?.cleanup();
          shareStep = null;
        }
      }
      // live sessions: clients follow the canvas live on its link (editor button, CLI, MCP, desktop tray)
      case "GET /api/session":
        return json(res, 200, { sessions: sessions.list() });
      case "POST /api/session/start": {
        // no canvas (the desktop tray): the one open in the editor
        const body = (await readJson(req)) as { canvas?: string; name?: string };
        const canvas = body.canvas ?? ws.selection.canvas ?? ws.canvases()[0];
        if (!canvas) return json(res, 400, { error: "No canvas to share live yet." });
        assertCanvasName(canvas);
        // no link yet: share it first (the site's default access), so Go live is one click
        const share = async () => {
          const site = reviewSite();
          if (!site) return;
          const { dir, manifest } = await createSnapshot(ws, shots, canvas, {});
          await publishSnapshot(site, dir, manifest, {});
          commentSync.forget(canvas);
        };
        return json(res, 200, { session: await sessions.start(canvas, { name: body.name, share }) });
      }
      case "POST /api/session/stop": {
        // no canvas: every session of the project
        const { canvas } = (await readJson(req)) as { canvas?: string };
        if (canvas) return json(res, 200, { stopped: sessions.stop(canvas) });
        const any = sessions.list().length > 0;
        sessions.stopAll();
        return json(res, 200, { stopped: any });
      }
      case "POST /api/session/cursor": {
        // the studio's cursor in the editor, in canvas coordinates (null: it left the canvas)
        const { canvas, x, y } = (await readJson(req)) as { canvas: string; x: number | null; y: number | null };
        const on = typeof x === "number" && typeof y === "number" && Number.isFinite(x) && Number.isFinite(y);
        sessions.get(canvas)?.cursor(on ? x : null, on ? y : null);
        return json(res, 200, { ok: true });
      }
      case "POST /api/source": {
        const { canvas, id } = (await readJson(req)) as { canvas: string; id: string };
        const hit = ws.nodeSource(canvas, id);
        if (!hit) return json(res, 404, { error: "Not found" });
        return json(res, 200, { code: dedent(hit.source.slice(hit.node.start, hit.node.end), hit.node.col), file: hit.rel, line: hit.node.line });
      }
    }
    return json(res, 404, { error: `No route ${route}` });
  }

  // ---------- static editor ----------
  function serveStatic(res: http.ServerResponse, pathname: string) {
    let file = path.join(editorDir, pathname === "/" ? "index.html" : pathname);
    if (!inside(editorDir, file) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(editorDir, "index.html");
    if (!fs.existsSync(file)) {
      res.writeHead(500, { "content-type": "text/plain" });
      return res.end("Editor bundle missing. Run `pnpm build` in packages/truecanvas.");
    }
    const ext = path.extname(file);
    const immutable = pathname.startsWith("/assets/");
    res.writeHead(200, { "content-type": MIME[ext] ?? "application/octet-stream", "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache" });
    fs.createReadStream(file).on("error", () => res.destroy()).pipe(res);
  }

  // ---------- share snapshots, previewed locally ----------
  function serveShare(res: http.ServerResponse, rest: string) {
    const root = sharesDir(config.root);
    let file = path.join(root, decodeURIComponent(rest));
    if (rest.endsWith("/")) file = path.join(file, "index.html");
    if (!inside(root, file) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return json(res, 404, { error: "Not found" });
    // snapshots are static and scriptless: the viewer page is the only script, and frames are sandboxed.
    // Sandboxed frames have an opaque origin, so their fonts load cross-origin: CORS allows it.
    res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream", "cache-control": "no-cache", "x-content-type-options": "nosniff", "access-control-allow-origin": "*" });
    fs.createReadStream(file).on("error", () => res.destroy()).pipe(res);
  }

  const server = http.createServer(async (req, res) => {
    try {
      // DNS-rebinding & cross-site protection: only localhost hosts, only our own origin.
      if (!allowedHosts.has(req.headers.host ?? "")) return json(res, 403, { error: "Forbidden host" });
      const url = new URL(req.url ?? "/", origin);
      // share snapshots: static and read-only, loaded by sandboxed frames (origin "null")
      if (req.method === "GET" && url.pathname.startsWith("/share/")) return serveShare(res, url.pathname.slice("/share/".length));
      const reqOrigin = req.headers.origin;
      if (reqOrigin && !allowedOrigins.has(reqOrigin)) return json(res, 403, { error: "Forbidden origin" });
      if (url.pathname === "/mcp") return await handleMcp(req, res);
      if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
      if (req.method === "GET") return serveStatic(res, url.pathname);
      json(res, 405, { error: "Method not allowed" });
    } catch (err) {
      const status = err instanceof EditError ? 400 : 500;
      if (status === 500) console.error(err);
      if (!res.headersSent) json(res, status, { error: (err as Error).message });
      else res.end();
    }
  });

  // ---------- watchers ----------
  const canvasDir = path.join(config.root, config.canvasDir);
  fs.mkdirSync(canvasDir, { recursive: true });
  const pending = new Map<string, NodeJS.Timeout>();
  const onCanvasFile = (filename: string | null) => {
    if (!filename) return;
    if (filename.endsWith(".comments.json")) {
      ws.commentsChanged(filename.slice(0, -".comments.json".length));
      return;
    }
    clearTimeout(pending.get(filename));
    pending.set(
      filename,
      setTimeout(() => {
        try {
          ws.externalChange(filename);
        } catch (err) {
          console.error(err);
        }
      }, 60),
    );
  };
  // The folder can disappear and come back (switching to a branch without it):
  // a watcher on the old folder goes silent, so re-watch whenever its inode changes.
  let canvasWatcher: fs.FSWatcher | null = null;
  let watchedIno: number | null = null;
  const watchCanvasDir = () => {
    let ino: number | null = null;
    try {
      ino = fs.statSync(canvasDir).ino;
    } catch {
      ino = null;
    }
    if (ino === watchedIno && canvasWatcher) return;
    canvasWatcher?.close();
    canvasWatcher = null;
    watchedIno = ino;
    if (ino === null) return;
    canvasWatcher = fs.watch(canvasDir, (_event, filename) => onCanvasFile(filename));
    canvasWatcher.on("error", () => {
      canvasWatcher?.close();
      canvasWatcher = null;
    });
    // pick up whatever the new folder holds
    for (const f of fs.readdirSync(canvasDir)) onCanvasFile(f);
  };
  watchCanvasDir();
  setInterval(watchCanvasDir, 2000).unref();
  // pages and layouts: linked frames follow edits made in a code editor (or by git)
  const appDirAbs = path.join(config.root, config.appDir);
  if (config.framework === "next" && fs.existsSync(appDirAbs)) {
    const appPending = new Map<string, NodeJS.Timeout>();
    const appWatcher = fs.watch(appDirAbs, { recursive: true }, (_event, filename) => {
      if (!filename || !/(^|[\\/])(page|layout)\.[jt]sx$/.test(filename) || /^truecanvas[\\/]/.test(filename)) return;
      const rel = path.join(config.appDir, filename).split(path.sep).join("/");
      clearTimeout(appPending.get(rel));
      appPending.set(
        rel,
        setTimeout(() => {
          try {
            ws.linkedFileChanged(rel);
          } catch (err) {
            console.error(err);
          }
        }, 60),
      );
    });
    appWatcher.on("error", (err) => console.error(`Stopped watching ${config.appDir}: ${err.message}`));
  }
  let catalogTimer: NodeJS.Timeout | undefined;
  for (const dir of componentRoots(config.components)) {
    const abs = path.join(config.root, dir);
    if (!fs.existsSync(abs)) continue;
    const componentWatcher = fs.watch(abs, { recursive: true }, () => {
      clearTimeout(catalogTimer);
      catalogTimer = setTimeout(() => {
        ws.catalog.invalidate();
        broadcast({ type: "catalog" });
        void syncRegistry();
      }, 250);
    });
    componentWatcher.on("error", (err) => console.error(`Stopped watching ${dir}: ${err.message}`));
  }

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, "127.0.0.1", resolve);
  });

  const shutdown = async () => {
    sessions.stopAll();
    commentSync.stop();
    await shots.close();
    for (const t of transports.values()) await t.close().catch(() => {});
    server.close();
  };
  return { server, origin, shutdown };
}

function componentRoots(globs: string[]) {
  return [...new Set(globs.map((g) => g.split("/").filter((p) => !/[*?{[]/.test(p)).join("/")).filter(Boolean))];
}

function json(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}


function dedent(code: string, col: number) {
  const pad = " ".repeat(col);
  return code
    .split("\n")
    .map((l, i) => (i > 0 && l.startsWith(pad) ? l.slice(col) : l))
    .join("\n");
}

/** `file` is within `dir` (works whether or not `dir` ends with a separator). */
function inside(dir: string, file: string): boolean {
  const rel = path.relative(dir, file);
  return !!rel && !rel.startsWith("..") && !path.isAbsolute(rel);
}
