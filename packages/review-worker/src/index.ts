import type { ShareFrame } from "truecanvas/share";
import { viewerHtml } from "truecanvas/share";
import { accessCookie, checkPassword, hashPassword, hasAccess, isStudio } from "./auth";
import type { ReviewEnv } from "./env";
import { brand, esc, home, json, notFound, page } from "./http";
import { isLiveHost, liveHome, liveUrl, serveLive, typeOf } from "./live";
import {
  addThread,
  applyToThread,
  commentsUpdated,
  createShare,
  deleteShare,
  filePath,
  findShare,
  getShare,
  knownAssets,
  listThreads,
  livePath,
  newId,
  putVersion,
  rememberAsset,
  updateShare,
  type CommentMessage,
  type Live,
  type Share,
  type Thread,
} from "./store";

/*
 * The review site, on Cloudflare Workers. Same HTTP API as the original
 * (packages/review), so Truecanvas talks to either:
 *
 *   /api/shares                       studio: check the token, find or create a link
 *   /api/shares/<slug>                studio: read, change (password, revoke, title), delete
 *   /api/shares/<slug>/assets         studio: assets already uploaded
 *   /api/shares/<slug>/files          studio: upload a snapshot file
 *   /api/shares/<slug>/live/files     studio: upload a file of a version's live site
 *   /api/shares/<slug>/versions       studio: publish a version
 *   /api/shares/<slug>/comments       studio: comments sync
 *   /s/<slug>/...                     clients: viewer, frames, password, comments
 *   <key>-<version><LIVE_HOST_SUFFIX> clients: a version's live site
 */

/** What this site can do beyond the original API. Truecanvas checks it before using them. */
const features = (env: ReviewEnv) => ["live-url", ...(env.LIVE_HOST_SUFFIX ? ["live-files"] : [])];

export default {
  async fetch(req: Request, env: ReviewEnv): Promise<Response> {
    const url = new URL(req.url);
    try {
      if (isLiveHost(env, url)) return await serveLive(req, env);
      const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
      if (parts[0] === "api" && parts[1] === "shares") return await api(req, env, parts.slice(2));
      if (parts[0] === "s" && parts[1]) return await link(req, env, parts[1], parts.slice(2));
      if (!parts.length) return home(env);
      if (url.pathname === "/favicon.ico" && env.BRAND_LOGO) return Response.redirect(new URL(env.BRAND_LOGO, url).href, 302);
      return notFound();
    } catch (err) {
      console.error(err);
      return json({ error: "Something went wrong on the review site." }, 500);
    }
  },
} satisfies ExportedHandler<ReviewEnv>;

// ---------- studio API ----------

async function api(req: Request, env: ReviewEnv, parts: string[]): Promise<Response> {
  if (!isStudio(req, env)) return json({ error: "Unauthorized" }, 401);
  const route = `${req.method} ${parts.length ? parts.slice(1).join("/") || "<slug>" : ""}`;

  if (!parts.length) {
    if (req.method === "GET") {
      // with project + canvas: a canvas's link, without creating one; otherwise a token check
      const q = new URL(req.url).searchParams;
      const project = q.get("project");
      const canvas = q.get("canvas");
      if (project && canvas) {
        const share = await findShare(env, project, canvas);
        return json({ slug: share && !share.revoked ? share.slug : null });
      }
      return json({ ok: true, brand: brand(env), features: features(env) });
    }
    if (req.method === "POST") {
      const { project, canvas, title } = (await req.json().catch(() => ({}))) as { project?: string; canvas?: string; title?: string };
      if (!project || !canvas) return json({ error: "project and canvas are required" }, 400);
      const share = (await findShare(env, project, canvas)) ?? (await createShare(env, project, canvas, title || canvas));
      return json({ slug: share.slug, url: new URL(`/s/${share.slug}`, req.url).href, versions: share.versions.length, password: !!share.password, revoked: share.revoked });
    }
    return notFound();
  }

  const share = await getShare(env, parts[0]);
  if (!share) return notFound();
  switch (route) {
    case "GET <slug>": {
      const { password, ...rest } = share;
      return json({ ...rest, password: !!password });
    }
    case "DELETE <slug>":
      await deleteShare(env, share);
      return json({ ok: true });
    case "PATCH <slug>": {
      const body = (await req.json().catch(() => ({}))) as { password?: string | null; revoked?: boolean; title?: string };
      const change: { password?: string | null; revoked?: boolean; title?: string } = {};
      if (body.password === null || body.password === "") change.password = null;
      else if (typeof body.password === "string") change.password = hashPassword(body.password);
      if (typeof body.revoked === "boolean") change.revoked = body.revoked;
      if (typeof body.title === "string" && body.title.trim()) change.title = body.title.trim().slice(0, 120);
      await updateShare(env, share.slug, change);
      const password = change.password !== undefined ? change.password : share.password;
      return json({ ok: true, password: !!password, revoked: change.revoked ?? share.revoked });
    }
    case "GET assets":
      return json({ assets: await knownAssets(env, share.slug) });
    case "PUT files": {
      const file = req.headers.get("x-path") ?? "";
      const key = filePath(share.slug, file);
      if (!key) return json({ error: `Unexpected file ${file}` }, 400);
      await env.FILES.put(key, await req.arrayBuffer(), { httpMetadata: { contentType: req.headers.get("content-type") || "application/octet-stream" } });
      if (file.startsWith("assets/")) await rememberAsset(env, share.slug, file.slice("assets/".length));
      return json({ ok: true });
    }
    case "PUT live/files": {
      if (!env.LIVE_HOST_SUFFIX) return json({ error: "This review site doesn't host live sites (LIVE_HOST_SUFFIX isn't set)." }, 400);
      const version = new URL(req.url).searchParams.get("version") ?? "";
      const file = req.headers.get("x-path") ?? "";
      const key = livePath(share.slug, version, file);
      if (!key) return json({ error: `Unexpected live file ${file}` }, 400);
      const type = req.headers.get("content-type");
      await env.FILES.put(key, await req.arrayBuffer(), { httpMetadata: { contentType: type && type !== "application/octet-stream" ? type : typeOf(file) } });
      return json({ ok: true });
    }
    case "POST versions": {
      const { id, createdAt, frames, live } = (await req.json().catch(() => ({}))) as { id?: string; createdAt?: number; frames?: ShareFrame[]; live?: { url?: string; files?: boolean } };
      if (!id || !/^\d{8}-\d{6}$/.test(id) || !Array.isArray(frames) || !frames.length) return json({ error: "id and frames are required" }, 400);
      let liveSite: Live | null = null;
      if (live?.url) {
        if (!/^https?:\/\//.test(live.url)) return json({ error: "The live URL starts with http:// or https://" }, 400);
        liveSite = { url: live.url };
      } else if (live?.files) {
        if (!env.LIVE_HOST_SUFFIX) return json({ error: "This review site doesn't host live sites (LIVE_HOST_SUFFIX isn't set)." }, 400);
        liveSite = { files: true };
      }
      const versions = await putVersion(env, share.slug, { id, createdAt: createdAt ?? Date.now(), frames, live: liveSite });
      return json({ ok: true, url: new URL(`/s/${share.slug}`, req.url).href, version: id, versions, live: liveHome(env, req, share, { id, live: liveSite }) });
    }
    case "GET comments": {
      const updated = await commentsUpdated(env, share.slug);
      const since = Number(new URL(req.url).searchParams.get("since") ?? 0);
      if (since && updated <= since) return json({ updated, threads: null });
      return json({ updated, threads: await listThreads(env, share.slug) });
    }
    case "POST comments": {
      // a studio reply (with the id Truecanvas gave it) or a resolution
      const body = (await req.json().catch(() => ({}))) as { thread?: string; message?: { id: string; name: string; text: string; at?: number }; resolved?: boolean; name?: string };
      if (!body.thread) return json({ error: "thread is required" }, 400);
      const at = Date.now();
      const message: CommentMessage | undefined =
        body.message?.id && body.message.text?.trim()
          ? { id: String(body.message.id).slice(0, 40), author: { name: String(body.message.name || "Studio").slice(0, 60), kind: "studio" }, text: body.message.text.trim().slice(0, 4000), at: body.message.at ?? at }
          : undefined;
      const ok = await applyToThread(env, share.slug, body.thread, {
        message,
        ...(typeof body.resolved === "boolean" ? { resolved: body.resolved, by: { name: String(body.name || "Studio").slice(0, 60), kind: "studio" as const } } : {}),
        at,
      });
      return ok ? json({ ok: true }) : notFound();
    }
  }
  return notFound();
}

// ---------- the client's link ----------

/*
 * /s/<slug>/                         the viewer (or the password page)
 * /s/<slug>/manifest.json[?v=<id>]   frames of the latest (or a given) version
 * /s/<slug>/comments.json            the link's comments
 * /s/<slug>/v/<id>/frames/<file>     a frozen frame
 * /s/<slug>/v/<id>/assets/<file>     its images and fonts (shared by versions)
 */
async function link(req: Request, env: ReviewEnv, slug: string, path: string[]): Promise<Response> {
  const share = await getShare(env, slug);
  if (req.method === "POST") return linkPost(req, env, share, path);
  if (req.method !== "GET" && req.method !== "HEAD") return notFound();
  if (!share || share.revoked || !share.versions.length) return page(env, "This link isn't available", "It may have been removed by the studio. Ask them for a new one.", 404);
  if (!hasAccess(req, env, slug, share.password)) return path.length ? notFound() : passwordPage(env, share);

  if (!path.length) {
    // the viewer loads everything relative to the link: a <base> keeps that true without a trailing slash
    const { logo } = brand(env);
    const head = `<base href="/s/${slug}/">${logo ? `<link rel="icon" href="${esc(logo)}">` : ""}`;
    const html = viewerHtml().replace("<head>", `<head>${head}`);
    return new Response(html, {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-cache", "referrer-policy": "no-referrer", "x-robots-tag": "noindex, nofollow" },
    });
  }
  if (path.length === 1 && path[0] === "manifest.json") return json(manifest(req, env, share, new URL(req.url).searchParams.get("v")));
  if (path.length === 1 && path[0] === "comments.json") return json({ threads: await listThreads(env, slug) });

  if (path[0] === "v" && path.length >= 4) {
    const [, version, kind, ...rest] = path;
    const file = kind === "assets" ? `assets/${rest.join("/")}` : `${version}/${kind}/${rest.join("/")}`;
    const key = filePath(slug, file);
    if (!key) return notFound();
    const object = await env.FILES.get(key);
    if (!object) return notFound();
    return new Response(object.body, {
      headers: {
        "content-type": object.httpMetadata?.contentType || "application/octet-stream",
        // content-addressed assets never change; frames can be replaced
        "cache-control": kind === "assets" ? "private, max-age=31536000, immutable" : "private, no-cache",
        // frames are sandboxed (opaque origin): their fonts load cross-origin
        "access-control-allow-origin": "*",
        "x-content-type-options": "nosniff",
        "x-robots-tag": "noindex, nofollow",
        // a frozen frame never runs scripts, even opened on its own
        ...(kind === "frames" ? { "content-security-policy": "script-src 'none'; object-src 'none'; base-uri 'none'" } : {}),
      },
    });
  }
  return notFound();
}

/** The password form, and clients' comments: a new thread (comments) or a reply (comments/<id>). */
async function linkPost(req: Request, env: ReviewEnv, share: Share | null, path: string[]): Promise<Response> {
  if (!share || share.revoked) return notFound();
  const slug = share.slug;
  if (path[0] === "comments" && path.length <= 2) {
    if (!hasAccess(req, env, slug, share.password)) return notFound();
    const body = (await req.json().catch(() => ({}))) as { text?: string; name?: string; frame?: string; version?: string; x?: number; y?: number };
    const text = String(body.text ?? "").trim().slice(0, 4000);
    const name = String(body.name ?? "").trim().slice(0, 60);
    if (!text || !name) return json({ error: "Write a comment and your name." }, 400);
    const now = Date.now();
    const message = { id: newId(), author: { name, kind: "client" as const }, text, at: now };
    if (path.length === 2) return (await applyToThread(env, slug, path[1], { message, at: now })) ? json({ ok: true, message }) : notFound();
    if (!share.versions.length) return notFound();
    const version = share.versions.find((v) => v.id === body.version) ?? share.versions[share.versions.length - 1];
    const frame = version.frames.find((f) => f.name === body.frame);
    if (!frame || typeof body.x !== "number" || typeof body.y !== "number") return json({ error: "Pin the comment on a frame." }, 400);
    const thread: Thread = {
      id: newId(),
      frame: frame.name,
      version: version.id,
      x: Math.round(Math.min(Math.max(body.x, 0), frame.width)),
      y: Math.round(Math.min(Math.max(body.y, 0), frame.height)),
      resolved: false,
      messages: [message],
      createdAt: now,
      updatedAt: now,
    };
    try {
      await addThread(env, slug, thread);
    } catch (err) {
      return json({ error: (err as Error).message }, 429);
    }
    return json({ ok: true, thread });
  }
  if (!share.password || path.join("/") !== "unlock") return notFound();
  const form = await req.formData().catch(() => null);
  const password = String(form?.get("password") ?? "");
  if (!checkPassword(password, share.password)) return passwordPage(env, share, true);
  return new Response(null, { status: 303, headers: { location: new URL(`/s/${slug}`, req.url).href, "set-cookie": accessCookie(env, slug, share.password) } });
}

function manifest(req: Request, env: ReviewEnv, share: Share, wanted: string | null) {
  const versions = [...share.versions].sort((a, b) => b.createdAt - a.createdAt);
  const current = versions.find((v) => v.id === wanted) ?? versions[0];
  const live = liveUrl(env, req, share, current);
  return {
    format: 1,
    project: share.project,
    canvas: share.canvas,
    title: share.title,
    id: current.id,
    createdAt: current.createdAt,
    frames: current.frames.map((f) => ({ ...f, html: `v/${current.id}/${f.html}`, image: `v/${current.id}/${f.image}` })),
    versions: versions.map((v, i) => ({ id: v.id, createdAt: v.createdAt, latest: i === 0, live: !!v.live })),
    brand: brand(env),
    comments: true,
    ...(live ? { live: { url: live } } : {}),
  };
}

function passwordPage(env: ReviewEnv, share: Share, wrong = false) {
  return page(
    env,
    esc(share.title),
    `<form method="post" action="/s/${share.slug}/unlock">
      <label for="pw">This design is protected. Enter the password the studio gave you.</label>
      <input id="pw" name="password" type="password" autocomplete="current-password" autofocus required ${wrong ? 'aria-invalid="true" aria-describedby="err"' : ""}>
      ${wrong ? '<p id="err" class="err">That password isn\'t right.</p>' : ""}
      <button type="submit">View the design</button>
    </form>`,
    wrong ? 401 : 200,
  );
}
