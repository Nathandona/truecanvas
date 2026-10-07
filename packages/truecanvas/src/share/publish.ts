import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ShareManifest } from "./snapshot.js";

/*
 * Publishing a snapshot to the studio's review site (packages/review,
 * deployed on the studio's own domain). The site's URL and token live in
 * ~/.config/truecanvas/share.json, never in the repo.
 */

export interface ReviewSite {
  url: string;
  token: string;
}

const configFile = () => path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"), "truecanvas", "share.json");

/** The review site: TRUECANVAS_REVIEW_URL + TRUECANVAS_REVIEW_TOKEN, else the saved config. */
export function reviewSite(): ReviewSite | null {
  const { TRUECANVAS_REVIEW_URL: url, TRUECANVAS_REVIEW_TOKEN: token } = process.env;
  if (url && token) return { url: url.replace(/\/+$/, ""), token };
  try {
    const saved = JSON.parse(fs.readFileSync(configFile(), "utf8")) as ReviewSite;
    return saved.url && saved.token ? saved : null;
  } catch {
    return null;
  }
}

/** Checks the URL and token against the site, then saves them (readable by this user only). */
export async function connectReviewSite(url: string, token: string): Promise<{ brand: { name: string } }> {
  const site = { url: url.trim().replace(/\/+$/, ""), token: token.trim() };
  if (!/^https?:\/\//.test(site.url)) throw new Error("The review site URL starts with https://");
  const res = await request(site, "GET", "/api/shares");
  const file = configFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(site, null, 2), { mode: 0o600 });
  return res as { brand: { name: string } };
}

export interface Published {
  url: string;
  version: string;
  versions: number;
  uploaded: number;
  /** files over the upload limit, left out */
  skipped: string[];
  password: boolean;
}

/** Vercel functions take request bodies up to 4.5 MB. */
const MAX_FILE = 4.4 * 1024 * 1024;

export async function publishSnapshot(site: ReviewSite, dir: string, manifest: ShareManifest, opts: { title?: string; password?: string | null } = {}): Promise<Published> {
  const share = (await request(site, "POST", "/api/shares", { project: manifest.project, canvas: manifest.canvas, title: opts.title ?? manifest.canvas })) as { slug: string; password: boolean };
  const base = `/api/shares/${share.slug}`;
  const known = new Set(((await request(site, "GET", `${base}/assets`)) as { assets: string[] }).assets);

  const files: { local: string; remote: string }[] = [];
  for (const name of fs.readdirSync(path.join(dir, "assets"))) if (!known.has(name)) files.push({ local: path.join(dir, "assets", name), remote: `assets/${name}` });
  for (const f of manifest.frames) for (const p of [f.html, f.image]) files.push({ local: path.join(dir, p), remote: `${manifest.id}/${p}` });

  const skipped: string[] = [];
  let uploaded = 0;
  const queue = [...files];
  const worker = async () => {
    for (let f = queue.shift(); f; f = queue.shift()) {
      const body = fs.readFileSync(f.local);
      if (body.length > MAX_FILE) {
        skipped.push(f.remote);
        continue;
      }
      await request(site, "PUT", `${base}/files`, body, { "x-path": f.remote, "content-type": contentType(f.local) });
      uploaded++;
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  if (skipped.some((s) => s.endsWith(".html"))) throw new Error(`A frame is too large to upload (over 4.4 MB): ${skipped.filter((s) => s.endsWith(".html")).join(", ")}`);

  const change = { ...(opts.password !== undefined ? { password: opts.password } : {}), ...(opts.title ? { title: opts.title } : {}) };
  if (Object.keys(change).length) await request(site, "PATCH", base, change);
  const done = (await request(site, "POST", `${base}/versions`, { id: manifest.id, createdAt: manifest.createdAt, frames: manifest.frames })) as { url: string; versions: number };
  return { url: done.url, version: manifest.id, versions: done.versions, uploaded, skipped, password: opts.password === undefined ? share.password : !!opts.password };
}

/** Revokes or restores a canvas's link, or changes its password. */
export async function updateShare(site: ReviewSite, project: string, canvas: string, change: { revoked?: boolean; password?: string | null }) {
  const share = (await request(site, "POST", "/api/shares", { project, canvas })) as { slug: string; url: string };
  await request(site, "PATCH", `/api/shares/${share.slug}`, change);
  return share.url;
}

async function request(site: ReviewSite, method: string, route: string, body?: unknown, headers: Record<string, string> = {}): Promise<unknown> {
  const raw = Buffer.isBuffer(body);
  let res: Response;
  try {
    res = await fetch(site.url + route, {
      method,
      headers: { authorization: `Bearer ${site.token}`, ...(body !== undefined && !raw ? { "content-type": "application/json" } : {}), ...headers },
      body: body === undefined ? undefined : raw ? new Uint8Array(body as Buffer) : JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (err) {
    throw new Error(`Couldn't reach the review site at ${site.url}: ${(err as Error).message}`);
  }
  if (res.status === 401) throw new Error("The review site refused the token. Run `truecanvas share setup` again with the REVIEW_TOKEN from the site's environment variables.");
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(`Review site: ${data.error ?? `${res.status} ${res.statusText}`}`);
  return data;
}

function contentType(file: string): string {
  const ext = path.extname(file).slice(1).toLowerCase();
  const types: Record<string, string> = {
    html: "text/html; charset=utf-8",
    png: "image/png",
    jpg: "image/jpeg",
    webp: "image/webp",
    avif: "image/avif",
    gif: "image/gif",
    svg: "image/svg+xml",
    ico: "image/x-icon",
    woff2: "font/woff2",
    woff: "font/woff",
    ttf: "font/ttf",
    otf: "font/otf",
    mp4: "video/mp4",
    webm: "video/webm",
  };
  return types[ext] ?? "application/octet-stream";
}
