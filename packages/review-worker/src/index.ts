import type { ShareFrame } from "truecanvas/share";
import { viewerHtml } from "truecanvas/share";
import { accessCookie, checkPassword, hashPassword, hasAccess, isStudio } from "./auth";
import type { ReviewEnv } from "./env";
import { brand, esc, home, json, notFound, page } from "./http";
import { isLiveHost, liveHome, liveUrl, serveLive, sessionUrl, typeOf } from "./live";
import { createInvite, isEmail, isInvited, listInvites, normalEmail, removeInvite } from "./people";
import { authHandler, signInOn, viewerOf, type Viewer } from "./session";
import { sendInvitation, signedIn, signInPage, signOutForm } from "./signin";
import { joinRoom, notifyRoom, roomState } from "./rooms";
import {
  ACCESS,
  addThread,
  applyToThread,
  commentsUpdated,
  createShare,
  deleteShare,
  filePath,
  findShare,
  getShare,
  getShareLite,
  blobKey,
  knownAssets,
  knownBlobs,
  listThreads,
  liveManifestKey,
  livePath,
  newId,
  putVersion,
  rememberAsset,
  rememberAssets,
  updateShare,
  type Access,
  type CommentMessage,
  type Live,
  type LiveManifest,
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
 *   /api/shares/<slug>/invites        studio: invite people to a link, list or remove them
 *   /api/shares/<slug>/room           studio: the link's room (WebSocket), as a live session's host
 *   /api/auth/...                     sign-in (Better Auth): email links, sessions
 *   /signin, /continue, /i/<token>    signing in, by email link or invitation (signin.ts)
 *   /members, /links                  the studio's members and links
 *   /s/<slug>/...                     clients: viewer, frames, password, comments, room
 *   <key>-<version><LIVE_HOST_SUFFIX> clients: a version's live site
 *   <key>-session<LIVE_HOST_SUFFIX>   clients: the studio's app, during a live session
 */

export { Room } from "./room";

/** What this site can do beyond the original API. Truecanvas checks it before using them. */
const features = (env: ReviewEnv) => ["live-url", "room", "batch", "thumbs", ...(env.LIVE_HOST_SUFFIX ? ["live-files", "live-blobs", "session"] : []), ...(signInOn(env) ? ["access", "invites"] : [])];

export default {
  async fetch(req: Request, env: ReviewEnv): Promise<Response> {
    const url = new URL(req.url);
    try {
      if (isLiveHost(env, url)) return await serveLive(req, env);
      const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
      if (parts[0] === "api" && parts[1] === "shares") return await api(req, env, parts.slice(2));
      if (parts[0] === "api" && parts[1] === "auth") return signInOn(env) ? await authHandler(req, env) : notFound();
      if (parts[0] === "s" && parts[1]) return await link(req, env, parts[1], parts.slice(2));
      const own = await signedIn(req, env, parts);
      if (own) return own;
      // with sign-in, the studio's home is its links (others are asked to sign in)
      if (!parts.length) return signInOn(env) ? Response.redirect(new URL("/links", req.url).href, 302) : home(env);
      if (url.pathname === "/favicon.ico" && env.BRAND_LOGO) return Response.redirect(new URL(env.BRAND_LOGO, url).href, 302);
      return notFound();
    } catch (err) {
      console.error(err);
      return json({ error: "Something went wrong on the review site." }, 500);
    }
  },
} satisfies ExportedHandler<ReviewEnv>;

// ---------- studio API ----------

const SIGN_IN_OFF = "Sign-in isn't set up on this review site: set its BETTER_AUTH_SECRET (wrangler secret put BETTER_AUTH_SECRET), STUDIO_EMAILS and STUDIO_EMAIL_FROM.";

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
      // `access` sets a new link's access mode; links created without it (older Truecanvas) stay open, as before
      const { project, canvas, title, access } = (await req.json().catch(() => ({}))) as { project?: string; canvas?: string; title?: string; access?: string };
      if (!project || !canvas) return json({ error: "project and canvas are required" }, 400);
      if (access !== undefined && !ACCESS.includes(access)) return json({ error: `access is ${ACCESS.join(", ")}` }, 400);
      if (access === "invited" && !signInOn(env)) return json({ error: SIGN_IN_OFF }, 400);
      const share = (await findShare(env, project, canvas)) ?? (await createShare(env, project, canvas, title || canvas, access === "invited" ? "invited" : "public"));
      return json({ slug: share.slug, url: new URL(`/s/${share.slug}`, req.url).href, versions: share.versions.length, password: !!share.password, access: share.access, revoked: share.revoked });
    }
    return notFound();
  }

  // uploads don't need the link's versions: one query instead of two
  const light = ["PUT files", "PUT live/files", "POST live/manifest", "PUT live/blobs", "POST files/batch", "GET assets"].includes(route);
  const share = light ? await getShareLite(env, parts[0]) : await getShare(env, parts[0]);
  if (!share) return notFound();
  // the link's room: Truecanvas joins it as the live session's host, or reads who's there
  if (parts[1] === "room" && parts.length === 2 && req.method === "GET") {
    if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") return json(await roomState(env, share.slug));
    const q = new URL(req.url).searchParams;
    const host = q.get("host") === "1";
    if (host && !env.LIVE_HOST_SUFFIX) return json({ error: "This review site doesn't host live sessions (LIVE_HOST_SUFFIX isn't set)." }, 400);
    return joinRoom(env, share.slug, { name: q.get("name") || brand(env).name || "Studio", kind: "studio", route: q.get("route") ?? undefined }, host);
  }
  // /invites/<email>: one invitation
  if (parts[1] === "invites" && parts.length === 3 && req.method === "DELETE") {
    return (await removeInvite(env, share.slug, parts[2])) ? json({ ok: true }) : notFound();
  }
  switch (route) {
    case "GET <slug>": {
      const { password, ...rest } = share;
      return json({ ...rest, password: !!password });
    }
    case "DELETE <slug>":
      await deleteShare(env, share);
      return json({ ok: true });
    case "PATCH <slug>": {
      const body = (await req.json().catch(() => ({}))) as { password?: string | null; access?: string; revoked?: boolean; title?: string };
      const change: { password?: string | null; access?: Access; revoked?: boolean; title?: string } = {};
      if (body.access !== undefined) {
        if (!ACCESS.includes(body.access)) return json({ error: `access is ${ACCESS.join(", ")}` }, 400);
        change.access = body.access as Access;
      }
      if (body.password === null || body.password === "") change.password = null;
      else if (typeof body.password === "string") {
        change.password = hashPassword(body.password);
        // a new password protects the link, unless another mode is asked for at the same time
        change.access ??= "password";
      }
      if (change.access === "public") change.password = null;
      if (change.access === "password" && !(change.password ?? share.password)) return json({ error: "Give the link a password to protect it with one." }, 400);
      if (change.access === "invited" && !signInOn(env)) return json({ error: SIGN_IN_OFF }, 400);
      if (typeof body.revoked === "boolean") change.revoked = body.revoked;
      if (typeof body.title === "string" && body.title.trim()) change.title = body.title.trim().slice(0, 120);
      await updateShare(env, share.slug, change);
      const now = (await getShare(env, share.slug))!;
      return json({ ok: true, password: !!now.password, access: now.access, revoked: now.revoked });
    }
    case "GET invites":
      return json({ invites: await listInvites(env, share.slug) });
    case "POST invites": {
      // invites people to the link and emails each their invitation
      if (!signInOn(env)) return json({ error: SIGN_IN_OFF }, 400);
      const { emails } = (await req.json().catch(() => ({}))) as { emails?: string[] };
      const list = [...new Set((Array.isArray(emails) ? emails : []).map((e) => normalEmail(String(e))))];
      const bad = list.filter((e) => !isEmail(e));
      if (!list.length || bad.length) return json({ error: bad.length ? `Not an email: ${bad.join(", ")}` : "emails is required" }, 400);
      if (list.length > 50) return json({ error: "Invite up to 50 people at a time." }, 400);
      const invited: { email: string; link?: string; error?: string }[] = [];
      for (const email of list) {
        const token = await createInvite(env, share.slug, email);
        try {
          const sent = await sendInvitation(req, env, email, token, share.title);
          invited.push({ email, ...(sent.link ? { link: sent.link } : {}) });
        } catch (err) {
          invited.push({ email, error: (err as Error).message });
        }
      }
      return json({ ok: true, invited, access: share.access });
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
    case "POST files/batch": {
      // many files in one request: [4-byte header length][JSON header][bodies, back to back]
      const buf = new Uint8Array(await req.arrayBuffer());
      if (buf.length < 4) return json({ error: "Empty batch" }, 400);
      const headLen = new DataView(buf.buffer).getUint32(0);
      let head: { files?: { path?: string; hash?: string; type?: string; size: number }[] };
      try {
        head = JSON.parse(new TextDecoder().decode(buf.subarray(4, 4 + headLen)));
      } catch {
        return json({ error: "Bad batch header" }, 400);
      }
      const items = Array.isArray(head.files) ? head.files : [];
      if (!items.length || items.length > 200) return json({ error: "A batch has 1 to 200 files" }, 400);
      let at = 4 + headLen;
      const puts: { key: string; body: Uint8Array; type?: string; asset?: string }[] = [];
      for (const item of items) {
        const body = buf.subarray(at, at + item.size);
        at += item.size;
        if (body.length !== item.size) return json({ error: "The batch is shorter than its header says" }, 400);
        if (item.hash) {
          if (!env.LIVE_HOST_SUFFIX || !/^[a-f0-9]{64}$/.test(item.hash)) return json({ error: "Unexpected live file" }, 400);
          const actual = [...new Uint8Array(await crypto.subtle.digest("SHA-256", body))].map((b) => b.toString(16).padStart(2, "0")).join("");
          if (actual !== item.hash) return json({ error: "A file doesn't match its hash." }, 400);
          puts.push({ key: blobKey(share.slug, item.hash), body });
        } else {
          const key = filePath(share.slug, item.path ?? "");
          if (!key) return json({ error: `Unexpected file ${item.path}` }, 400);
          puts.push({ key, body, type: item.type || "application/octet-stream", asset: item.path!.startsWith("assets/") ? item.path!.slice("assets/".length) : undefined });
        }
      }
      for (let i = 0; i < puts.length; i += 8)
        await Promise.all(puts.slice(i, i + 8).map((p) => env.FILES.put(p.key, p.body, p.type ? { httpMetadata: { contentType: p.type } } : undefined)));
      await rememberAssets(env, share.slug, puts.flatMap((p) => (p.asset ? [p.asset] : [])));
      return json({ ok: true, stored: puts.length });
    }
    case "POST live/manifest": {
      // a version's live site by content: answers which files still need uploading
      if (!env.LIVE_HOST_SUFFIX) return json({ error: "This review site doesn't host live sites (LIVE_HOST_SUFFIX isn't set)." }, 400);
      const version = new URL(req.url).searchParams.get("version") ?? "";
      const { files } = (await req.json().catch(() => ({}))) as { files?: Record<string, string> };
      if (!/^\d{8}-\d{6}$/.test(version) || !files || typeof files !== "object") return json({ error: "version and files are required" }, 400);
      const manifest: LiveManifest = {};
      for (const [file, hash] of Object.entries(files)) {
        if (!livePath(share.slug, version, file) || typeof hash !== "string" || !/^[a-f0-9]{64}$/.test(hash)) return json({ error: `Unexpected live file ${file}` }, 400);
        manifest[file.replace(/^\/+/, "")] = hash;
      }
      const known = await knownBlobs(env, share.slug);
      await env.FILES.put(liveManifestKey(share.slug, version), JSON.stringify(manifest), { httpMetadata: { contentType: "application/json" } });
      return json({ ok: true, missing: [...new Set(Object.values(manifest))].filter((h) => !known.has(h)) });
    }
    case "PUT live/blobs": {
      const hash = req.headers.get("x-hash") ?? "";
      if (!/^[a-f0-9]{64}$/.test(hash)) return json({ error: "x-hash is required" }, 400);
      const body = await req.arrayBuffer();
      const actual = [...new Uint8Array(await crypto.subtle.digest("SHA-256", body))].map((b) => b.toString(16).padStart(2, "0")).join("");
      if (actual !== hash) return json({ error: "The file doesn't match its hash." }, 400);
      // no stored type: the same bytes can serve several paths, each typed by its name
      await env.FILES.put(blobKey(share.slug, hash), body);
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
      if (ok) await notifyRoom(env, share.slug, { t: "comments", updated: at });
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
  const gate = await open(req, env, share);
  if (!gate.ok) return path.length ? notFound() : denied(req, env, share, gate.viewer);

  if (!path.length) {
    // the viewer loads everything relative to the link: a <base> keeps that true without a trailing slash
    const { logo } = brand(env);
    const head = `<base href="/s/${slug}/">${logo ? `<link rel="icon" href="${esc(logo)}">` : ""}`;
    const html = viewerHtml().replace("<head>", `<head>${head}`);
    return new Response(html, {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-cache", "referrer-policy": "no-referrer", "x-robots-tag": "noindex, nofollow" },
    });
  }
  if (path.length === 1 && path[0] === "manifest.json") return json(manifest(req, env, share, new URL(req.url).searchParams.get("v"), gate.viewer ?? (await viewerOf(req, env))));
  if (path.length === 1 && path[0] === "comments.json") return json({ threads: await listThreads(env, slug) });
  if (path.length === 1 && path[0] === "room") {
    if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") return notFound();
    // same site only: another site can't open someone's room with their cookies
    const from = req.headers.get("origin");
    if (from && from !== new URL(req.url).origin) return notFound();
    const viewer = gate.viewer ?? (await viewerOf(req, env));
    const typed = (new URL(req.url).searchParams.get("name") ?? "").trim().slice(0, 60);
    return joinRoom(env, slug, viewer ? { name: viewer.name, kind: viewer.member ? "studio" : "client" } : { name: typed || "Guest", kind: "client" }, false);
  }

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

/**
 * Can this request open the link? Public links: anyone. Password links: the
 * password's cookie. Then, for every mode, signed-in studio members and the
 * people invited to it. The signed-in viewer comes along when it was read.
 */
async function open(req: Request, env: ReviewEnv, share: Share): Promise<{ ok: boolean; viewer: Viewer | null }> {
  if (share.access === "public") return { ok: true, viewer: null };
  if (share.access === "password" && hasAccess(req, env, share.slug, share.password)) return { ok: true, viewer: null };
  const viewer = await viewerOf(req, env);
  return { ok: !!viewer && (viewer.member || (await isInvited(env, share.slug, viewer.email))), viewer };
}

/** What someone without access sees: the password form, or the sign-in form. */
function denied(req: Request, env: ReviewEnv, share: Share, viewer: Viewer | null): Response {
  if (share.access === "password") return passwordPage(env, share);
  if (viewer)
    return page(
      env,
      esc(share.title),
      `<div class="stack"><p>You're signed in as ${esc(viewer.email)}, who isn't invited to this design. Ask the studio to invite you, or sign in with another email.</p>${signOutForm(`/s/${share.slug}`)}</div>`,
      403,
    );
  return signInPage(env, req, { next: `/s/${share.slug}`, title: share.title, intro: "This design is shared with invited people. Enter your email and we'll send you a link to open it." });
}

/** The password form, and clients' comments: a new thread (comments) or a reply (comments/<id>). */
async function linkPost(req: Request, env: ReviewEnv, share: Share | null, path: string[]): Promise<Response> {
  if (!share || share.revoked) return notFound();
  const slug = share.slug;
  if (path[0] === "comments" && path.length <= 2) {
    const gate = await open(req, env, share);
    if (!gate.ok) return notFound();
    const body = (await req.json().catch(() => ({}))) as { text?: string; name?: string; frame?: string; version?: string; x?: number; y?: number };
    // signed in: the comment is theirs, under their account's name; otherwise the name they typed
    const viewer = gate.viewer ?? (await viewerOf(req, env));
    const text = String(body.text ?? "").trim().slice(0, 4000);
    const name = viewer ? viewer.name.slice(0, 60) : String(body.name ?? "").trim().slice(0, 60);
    if (!text || !name) return json({ error: "Write a comment and your name." }, 400);
    const now = Date.now();
    const message: CommentMessage = { id: newId(), author: { name, kind: viewer?.member ? "studio" : "client" }, text, at: now };
    if (path.length === 2) {
      if (!(await applyToThread(env, slug, path[1], { message, at: now }))) return notFound();
      await notifyRoom(env, slug, { t: "comments", updated: now });
      return json({ ok: true, message });
    }
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
    await notifyRoom(env, slug, { t: "comments", updated: now });
    return json({ ok: true, thread });
  }
  if (share.access !== "password" || !share.password || path.join("/") !== "unlock") return notFound();
  const form = await req.formData().catch(() => null);
  const password = String(form?.get("password") ?? "");
  if (!checkPassword(password, share.password)) return passwordPage(env, share, true);
  return new Response(null, { status: 303, headers: { location: new URL(`/s/${slug}`, req.url).href, "set-cookie": accessCookie(env, slug, share.password) } });
}

function manifest(req: Request, env: ReviewEnv, share: Share, wanted: string | null, viewer: Viewer | null) {
  const versions = [...share.versions].sort((a, b) => b.createdAt - a.createdAt);
  const current = versions.find((v) => v.id === wanted) ?? versions[0];
  const live = liveUrl(env, req, share, current);
  const session = sessionUrl(env, req, share);
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
    // the link's room (presence, real-time comments), and where a live session serves the studio's app
    room: true,
    ...(session ? { session: { url: session } } : {}),
    // who's looking: their comments carry this name. `signIn`: the site has sign-in (for a "Sign in" link)
    viewer: viewer ? { name: viewer.name, email: viewer.email, studio: viewer.member } : null,
    signIn: signInOn(env),
  };
}

function passwordPage(env: ReviewEnv, share: Share, wrong = false) {
  return page(
    env,
    esc(share.title),
    `<form method="post" action="/s/${share.slug}/unlock">
      <label for="pw">This design is protected. Enter the password the studio gave you.</label>
      <input id="pw" name="password" type="password" placeholder="Password" autocomplete="current-password" autocapitalize="none" autocorrect="off" spellcheck="false" autofocus required ${wrong ? 'aria-invalid="true" aria-describedby="err"' : ""}>
      ${wrong ? '<p id="err" class="err">That password isn\'t right.</p>' : ""}
      <button type="submit">View the design</button>
    </form>${signInOn(env) ? `<p class="alt">Invited, or from the studio? <a href="/signin?next=${encodeURIComponent(`/s/${share.slug}`)}">Sign in with your email</a></p>` : ""}`,
    wrong ? 401 : 200,
  );
}
