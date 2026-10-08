import { LIVE_COOKIE, checkLiveToken, hasLiveAccess, liveCookieValue, liveToken, lockOf } from "./auth";
import type { ReviewEnv } from "./env";
import { notFound, page } from "./http";
import { safePath } from "truecanvas/share";
import { tunnel } from "./rooms";
import { getShareByKey, livePath, type Share, type Version } from "./store";

/*
 * Live sites: a version's static build, served on a host of its own,
 * <key>-<version digits><LIVE_HOST_SUFFIX>, so its scripts never share an
 * origin with the review site. When the link isn't public (a password, or
 * invitees only), the viewer hands whoever has access a short-lived token;
 * the live host trades it for a cookie.
 */

/** The live site's address for a version, or null when it has none. */
export function liveHome(env: ReviewEnv, req: Request, share: Pick<Share, "key">, version: Pick<Version, "id" | "live">): string | null {
  if (!version.live) return null;
  if ("url" in version.live) return version.live.url;
  const suffix = env.LIVE_HOST_SUFFIX;
  if (!suffix) return null;
  const here = new URL(req.url);
  return `${here.protocol}//${share.key}-${version.id.replace("-", "")}${suffix}${here.port ? `:${here.port}` : ""}/`;
}

/** The same, for a viewer that has access: with a token that opens a protected link's live site. */
export function liveUrl(env: ReviewEnv, req: Request, share: Share, version: Version): string | null {
  const home = liveHome(env, req, share, version);
  if (!home || !lockOf(share) || !version.live || "url" in version.live) return home;
  const url = new URL(home);
  url.searchParams.set("tc_access", liveToken(env, share.slug, version.id));
  return url.href;
}

/** A version id for the session host: its access token and cookie are scoped to it. */
const SESSION = "session";

/**
 * Where the studio's app is served during a live session: the link's session
 * host, with a token that opens it for a viewer that has access. Null when the
 * site doesn't host live sites.
 */
export function sessionUrl(env: ReviewEnv, req: Request, share: Share): string | null {
  const suffix = env.LIVE_HOST_SUFFIX;
  if (!suffix) return null;
  const here = new URL(req.url);
  const url = new URL(`${here.protocol}//${share.key}-${SESSION}${suffix}${here.port ? `:${here.port}` : ""}/`);
  if (lockOf(share)) url.searchParams.set("tc_access", liveToken(env, share.slug, SESSION));
  return url.href;
}

/** Is this request for a live site? */
export const isLiveHost = (env: ReviewEnv, url: URL) => !!env.LIVE_HOST_SUFFIX && url.hostname.endsWith(env.LIVE_HOST_SUFFIX.split(":")[0]);

export async function serveLive(req: Request, env: ReviewEnv): Promise<Response> {
  const url = new URL(req.url);
  const label = url.hostname.slice(0, -env.LIVE_HOST_SUFFIX!.split(":")[0].length);
  const s = /^([a-z0-9]{10})-session$/.exec(label);
  if (s) return serveSession(req, env, s[1]);
  const m = /^([a-z0-9]{10})-(\d{8})(\d{6})$/.exec(label);
  if (!m || (req.method !== "GET" && req.method !== "HEAD")) return notFound();
  const share = await getShareByKey(env, m[1]);
  const versionId = `${m[2]}-${m[3]}`;
  const version = share?.versions.find((v) => v.id === versionId);
  if (!share || share.revoked || !version?.live || !("files" in version.live)) return gone(env);

  // the viewer's token: trade it for a cookie on this host, then drop it from the address
  const lock = lockOf(share);
  const token = url.searchParams.get("tc_access");
  if (token !== null && lock) {
    if (!checkLiveToken(env, share.slug, versionId, token)) return locked(env);
    url.searchParams.delete("tc_access");
    return new Response(null, {
      status: 302,
      headers: {
        location: url.pathname + url.search,
        "set-cookie": `${LIVE_COOKIE}=${liveCookieValue(env, share.slug, versionId, lock)}; Path=/; Max-Age=${60 * 60 * 12}; HttpOnly; Secure; SameSite=None`,
        "cache-control": "no-store",
      },
    });
  }
  if (!hasLiveAccess(req, env, share.slug, versionId, lock)) return locked(env);

  let path: string;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    return notFound();
  }
  // clean URLs: /about serves about.html or about/index.html, like a static host
  const candidates = path.endsWith("/") ? [`${path}index.html`] : [path, `${path}.html`, `${path}/index.html`];
  for (const candidate of candidates) {
    const key = livePath(share.slug, versionId, candidate);
    const object = key ? await env.FILES.get(key) : null;
    if (object) return withFrameBridge(file(object, candidate, 200, req.method === "HEAD"));
  }
  const missing = livePath(share.slug, versionId, "404.html");
  const fallback = missing ? await env.FILES.get(missing) : null;
  return fallback ? withFrameBridge(file(fallback, "/404.html", 404, req.method === "HEAD")) : notFound();
}

/**
 * The session host: the studio's app, tunneled from its Truecanvas while a
 * live session runs. Same gate as a version's live site: the viewer's token,
 * traded for a cookie on this host. The app's HMR WebSockets come through too.
 */
async function serveSession(req: Request, env: ReviewEnv, key: string): Promise<Response> {
  const url = new URL(req.url);
  const share = await getShareByKey(env, key);
  if (!share || share.revoked) return gone(env);
  const lock = lockOf(share);
  const token = url.searchParams.get("tc_access");
  if (token !== null && lock && req.headers.get("upgrade") === null) {
    if (!checkLiveToken(env, share.slug, SESSION, token)) return locked(env);
    url.searchParams.delete("tc_access");
    return new Response(null, {
      status: 302,
      headers: {
        location: url.pathname + url.search,
        "set-cookie": `${LIVE_COOKIE}=${liveCookieValue(env, share.slug, SESSION, lock)}; Path=/; Max-Age=${60 * 60 * 12}; HttpOnly; Secure; SameSite=None`,
        "cache-control": "no-store",
      },
    });
  }
  if (!hasLiveAccess(req, env, share.slug, SESSION, lock)) return locked(env);
  if (!["GET", "HEAD", "POST"].includes(req.method)) return new Response("Method not allowed", { status: 405 });
  const path = safePath(url.pathname + url.search);
  if (!path) return notFound();
  const res = await tunnel(env, share.slug, req, path);
  // HMR sockets pass through untouched
  return res.status === 101 || req.headers.get("upgrade") ? res : withFrameBridge(res);
}

/*
 * In a review link, a frame of the real site takes the mouse after a click.
 * Its wheel and Esc then land in this page, on another origin: forward them to
 * the review page so the canvas still scrolls and Esc still gives the mouse
 * back. Only when framed; nothing else is touched.
 */
const FRAME_BRIDGE = `<script>(function(){if(window.parent===window)return;var p=function(m){m.__tc=1;parent.postMessage(m,"*")};addEventListener("wheel",function(e){if(e.ctrlKey||e.metaKey)e.preventDefault();p({t:"wheel",dx:e.deltaX,dy:e.deltaY,dm:e.deltaMode,zoom:e.ctrlKey||e.metaKey,x:e.clientX,y:e.clientY})},{passive:false});addEventListener("keydown",function(e){if(e.key==="Escape")p({t:"escape"})})})();</script>`;

/** HTML pages of live sites and sessions get the frame bridge. */
export function withFrameBridge(res: Response): Response {
  if (!(res.headers.get("content-type") ?? "").includes("text/html") || !res.body) return res;
  const out = new HTMLRewriter()
    .on("head", { element: (el) => void el.prepend(FRAME_BRIDGE, { html: true }) })
    .transform(res);
  // the length changed
  const headers = new Headers(out.headers);
  headers.delete("content-length");
  return new Response(out.body, { status: out.status, statusText: out.statusText, headers });
}

function file(object: R2ObjectBody, path: string, status: number, head: boolean) {
  // hashed build files never change; pages can be replaced by a new upload
  const immutable = /^\/(_next\/static|assets)\//.test(path);
  return new Response(head ? null : object.body, {
    status,
    headers: {
      "content-type": object.httpMetadata?.contentType || typeOf(path),
      "cache-control": immutable ? "private, max-age=31536000, immutable" : "private, no-cache",
      etag: object.httpEtag,
      "x-robots-tag": "noindex, nofollow",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    },
  });
}

const locked = (env: ReviewEnv) =>
  page(env, "Open this preview from its review link", "This live preview is protected. Open it from the review link the studio sent you.", 403);
const gone = (env: ReviewEnv) => page(env, "This preview isn't available", "It may have been replaced by a newer version. Open the review link again.", 404);

const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  json: "application/json",
  map: "application/json",
  txt: "text/plain; charset=utf-8",
  xml: "application/xml",
  webmanifest: "application/manifest+json",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  avif: "image/avif",
  gif: "image/gif",
  ico: "image/x-icon",
  woff2: "font/woff2",
  woff: "font/woff",
  ttf: "font/ttf",
  otf: "font/otf",
  mp4: "video/mp4",
  webm: "video/webm",
  wasm: "application/wasm",
  pdf: "application/pdf",
};

export const typeOf = (path: string) => TYPES[path.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
