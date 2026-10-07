import { LIVE_COOKIE, checkLiveToken, hasLiveAccess, liveCookieValue, liveToken } from "./auth";
import type { ReviewEnv } from "./env";
import { notFound, page } from "./http";
import { getShareByKey, livePath, type Share, type Version } from "./store";

/*
 * Live sites: a version's static build, served on a host of its own,
 * <key>-<version digits><LIVE_HOST_SUFFIX>, so its scripts never share an
 * origin with the review site. When the link has a password, the viewer
 * hands out a short-lived token; the live host trades it for a cookie.
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
  if (!home || !share.password || !version.live || "url" in version.live) return home;
  const url = new URL(home);
  url.searchParams.set("tc_access", liveToken(env, share.slug, version.id));
  return url.href;
}

/** Is this request for a live site? */
export const isLiveHost = (env: ReviewEnv, url: URL) => !!env.LIVE_HOST_SUFFIX && url.hostname.endsWith(env.LIVE_HOST_SUFFIX.split(":")[0]);

export async function serveLive(req: Request, env: ReviewEnv): Promise<Response> {
  const url = new URL(req.url);
  const label = url.hostname.slice(0, -env.LIVE_HOST_SUFFIX!.split(":")[0].length);
  const m = /^([a-z0-9]{10})-(\d{8})(\d{6})$/.exec(label);
  if (!m || (req.method !== "GET" && req.method !== "HEAD")) return notFound();
  const share = await getShareByKey(env, m[1]);
  const versionId = `${m[2]}-${m[3]}`;
  const version = share?.versions.find((v) => v.id === versionId);
  if (!share || share.revoked || !version?.live || !("files" in version.live)) return gone(env);

  // the viewer's token: trade it for a cookie on this host, then drop it from the address
  const token = url.searchParams.get("tc_access");
  if (token !== null && share.password) {
    if (!checkLiveToken(env, share.slug, versionId, token)) return locked(env);
    url.searchParams.delete("tc_access");
    return new Response(null, {
      status: 302,
      headers: {
        location: url.pathname + url.search,
        "set-cookie": `${LIVE_COOKIE}=${liveCookieValue(env, share.slug, versionId, share.password)}; Path=/; Max-Age=${60 * 60 * 12}; HttpOnly; Secure; SameSite=None`,
        "cache-control": "no-store",
      },
    });
  }
  if (!hasLiveAccess(req, env, share.slug, versionId, share.password)) return locked(env);

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
    if (object) return file(object, candidate, 200, req.method === "HEAD");
  }
  const missing = livePath(share.slug, versionId, "404.html");
  const fallback = missing ? await env.FILES.get(missing) : null;
  return fallback ? file(fallback, "/404.html", 404, req.method === "HEAD") : notFound();
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
  page(env, "Open this preview from its review link", "This live preview is protected. Open it with the View live button on the review link the studio sent you.", 403);
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
