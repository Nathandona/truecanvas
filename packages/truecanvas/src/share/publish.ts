import { createHash } from "node:crypto";
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
  /** the version's live site, when it has one */
  live: string | null;
  /** who can open the link, on review sites with sign-in (null on older ones) */
  access: Access | null;
  /** people invited with this share, each emailed their invitation */
  invited: Invited[];
}

/**
 * Who can open a link: people invited by email (they sign in with a link),
 * anyone with the password, or anyone with the link. Review sites with
 * sign-in only; links made before keep a password or stay open.
 */
export type Access = "invited" | "password" | "public";
export const ACCESS_MODES: Access[] = ["invited", "password", "public"];

export interface Invited {
  email: string;
  /** the invitation's link, returned by review sites in local development only */
  link?: string;
  /** the email couldn't be sent */
  error?: string;
}

/** What the review site can do beyond the original API. */
export async function siteFeatures(site: ReviewSite): Promise<string[]> {
  const res = (await request(site, "GET", "/api/shares")) as { features?: string[] };
  return res.features ?? [];
}

const NO_SIGN_IN = "This review site doesn't have sign-in yet. Update it (packages/review-worker) and set BETTER_AUTH_SECRET, STUDIO_EMAILS and STUDIO_EMAIL_FROM to invite people by email.";

/**
 * A live version of the design, opened from the link's "View live" button:
 * the address where the app already runs, or a static build (Next `out/`,
 * Vite `dist/`) that the review site hosts on a host of its own.
 */
export type LiveSite = { url: string } | { dir: string };

/** Vercel functions take request bodies up to 4.5 MB. */
const MAX_FILE = 4.4 * 1024 * 1024;

export interface ShareOptions {
  title?: string;
  password?: string | null;
  live?: LiveSite;
  /** who can open the link; a new link defaults to invited people on sites with sign-in */
  access?: Access;
  /** emails to invite (each gets an email with their sign-in link) */
  invite?: string[];
}

export async function publishSnapshot(site: ReviewSite, dir: string, manifest: ShareManifest, opts: ShareOptions = {}): Promise<Published> {
  // before uploading anything: can this review site do what's asked?
  const can = await siteFeatures(site);
  const signIn = can.includes("access") && can.includes("invites");
  if ((opts.access || opts.invite?.length) && !signIn) throw new Error(NO_SIGN_IN);
  if (opts.access === "password" && !opts.password) throw new Error("Pass the password to protect the link with: --password <p>");
  if (opts.live) {
    const needed = "url" in opts.live ? "live-url" : "live-files";
    if (!can.includes(needed))
      throw new Error(
        "url" in opts.live
          ? "This review site doesn't support live sites yet. Update it (packages/review-worker) to share a live URL."
          : "This review site doesn't host live sites. Deploy packages/review-worker with LIVE_HOST_SUFFIX set, or pass the URL where the site runs instead.",
      );
    if ("dir" in opts.live && !fs.statSync(opts.live.dir, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`No build folder at ${opts.live.dir}`);
  }
  // a new link: invited people only, unless a password or another mode is asked for (existing links keep theirs)
  const firstAccess = signIn ? (opts.access ?? (opts.password ? "password" : "invited")) : undefined;
  const share = (await request(site, "POST", "/api/shares", {
    project: manifest.project,
    canvas: manifest.canvas,
    title: opts.title ?? manifest.canvas,
    ...(firstAccess ? { access: firstAccess === "invited" ? "invited" : "public" } : {}),
  })) as { slug: string; password: boolean; access?: Access };
  const base = `/api/shares/${share.slug}`;
  const known = new Set(((await request(site, "GET", `${base}/assets`)) as { assets: string[] }).assets);

  const files: { local: string; remote: string }[] = [];
  for (const name of fs.readdirSync(path.join(dir, "assets"))) if (!known.has(name)) files.push({ local: path.join(dir, "assets", name), remote: `assets/${name}` });
  for (const f of manifest.frames) for (const p of [f.html, f.image, ...(f.thumb && can.includes("thumbs") ? [f.thumb] : [])]) files.push({ local: path.join(dir, p), remote: `${manifest.id}/${p}` });

  const skipped: string[] = [];
  let uploaded = 0;
  const fitting = files.filter((f) => {
    if (fs.statSync(f.local).size <= MAX_FILE) return true;
    skipped.push(f.remote);
    return false;
  });
  if (can.includes("batch")) {
    // a few requests carrying many files: each request has a fixed cost, files are small
    uploaded += await sendBatches(site, base, fitting.map((f) => ({ local: f.local, path: f.remote, type: contentType(f.local) })));
  } else {
    const queue = [...fitting];
    const worker = async () => {
      for (let f = queue.shift(); f; f = queue.shift()) {
        await request(site, "PUT", `${base}/files`, fs.readFileSync(f.local), { "x-path": f.remote, "content-type": contentType(f.local) });
        uploaded++;
      }
    };
    await Promise.all(Array.from({ length: 4 }, worker));
  }
  if (skipped.some((s) => s.endsWith(".html"))) throw new Error(`A frame is too large to upload (over 4.4 MB): ${skipped.filter((s) => s.endsWith(".html")).join(", ")}`);

  // the live site's files, under the version they belong to
  if (opts.live && "dir" in opts.live) {
    const liveDir = opts.live.dir;
    const liveFiles = walk(liveDir).filter((rel) => {
      if (fs.statSync(path.join(liveDir, rel)).size <= MAX_FILE) return true;
      skipped.push(`live/${rel}`);
      return false;
    });
    if (can.includes("live-blobs")) {
      // by content: the site says which files it doesn't have yet (sharing again sends only what changed)
      const hashes = new Map<string, string>();
      for (const rel of liveFiles) hashes.set(rel, createHash("sha256").update(fs.readFileSync(path.join(liveDir, rel))).digest("hex"));
      const { missing } = (await request(site, "POST", `${base}/live/manifest?version=${manifest.id}`, { files: Object.fromEntries(hashes) })) as { missing: string[] };
      const byHash = new Map([...hashes].map(([rel, hash]) => [hash, rel]));
      const pending = missing.map((h) => byHash.get(h)!).filter(Boolean);
      if (can.includes("batch")) uploaded += await sendBatches(site, base, pending.map((rel) => ({ local: path.join(liveDir, rel), hash: hashes.get(rel)! })));
      else {
        const blobWorker = async () => {
          for (let rel = pending.shift(); rel; rel = pending.shift()) {
            await request(site, "PUT", `${base}/live/blobs`, fs.readFileSync(path.join(liveDir, rel)), { "x-hash": hashes.get(rel)!, "content-type": "application/octet-stream" });
            uploaded++;
          }
        };
        await Promise.all(Array.from({ length: 6 }, blobWorker));
      }
    } else {
      const pending = [...liveFiles];
      const liveWorker = async () => {
        for (let rel = pending.shift(); rel; rel = pending.shift()) {
          await request(site, "PUT", `${base}/live/files?version=${manifest.id}`, fs.readFileSync(path.join(liveDir, rel)), { "x-path": rel, "content-type": contentType(rel) });
          uploaded++;
        }
      };
      await Promise.all(Array.from({ length: 6 }, liveWorker));
    }
  }

  const change = {
    ...(opts.password !== undefined ? { password: opts.password } : {}),
    ...(opts.title ? { title: opts.title } : {}),
    ...(opts.access ? { access: opts.access } : {}),
  };
  let password = share.password;
  let access = share.access ?? null;
  if (Object.keys(change).length) {
    const after = (await request(site, "PATCH", base, change)) as { password: boolean; access?: Access };
    password = after.password;
    access = after.access ?? access;
  }
  const live = opts.live ? ("url" in opts.live ? { url: opts.live.url } : { files: true }) : undefined;
  const done = (await request(site, "POST", `${base}/versions`, { id: manifest.id, createdAt: manifest.createdAt, frames: can.includes("thumbs") ? manifest.frames : manifest.frames.map(({ thumb: _, ...f }) => f), live })) as { url: string; versions: number; live?: string | null };
  // invitations go out once there's something to open
  const invited = opts.invite?.length ? await inviteTo(site, share.slug, opts.invite) : [];
  return { url: done.url, version: manifest.id, versions: done.versions, uploaded, skipped, password, live: done.live ?? null, access, invited };
}

/**
 * Files sent several per request: [4-byte header length][JSON header][bodies].
 * Batches stay under a few MB, three in flight. Returns how many were sent.
 */
async function sendBatches(site: ReviewSite, base: string, items: { local: string; path?: string; hash?: string; type?: string }[]): Promise<number> {
  const LIMIT = 4 * 1024 * 1024;
  const batches: (typeof items)[] = [];
  let current: typeof items = [];
  let size = 0;
  for (const item of items) {
    const n = fs.statSync(item.local).size;
    if (current.length && (size + n > LIMIT || current.length >= 150)) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(item);
    size += n;
  }
  if (current.length) batches.push(current);
  const send = async (batch: typeof items) => {
    const bodies = batch.map((i) => fs.readFileSync(i.local));
    const head = Buffer.from(JSON.stringify({ files: batch.map((i, k) => ({ path: i.path, hash: i.hash, type: i.type, size: bodies[k].length })) }));
    const len = Buffer.alloc(4);
    len.writeUInt32BE(head.length);
    await request(site, "POST", `${base}/files/batch`, Buffer.concat([len, head, ...bodies]), { "content-type": "application/octet-stream" });
  };
  const queue = [...batches];
  await Promise.all(Array.from({ length: 3 }, async () => {
    for (let b = queue.shift(); b; b = queue.shift()) await send(b);
  }));
  return items.length;
}

async function inviteTo(site: ReviewSite, slug: string, emails: string[]): Promise<Invited[]> {
  const res = (await request(site, "POST", `/api/shares/${slug}/invites`, { emails })) as { invited: Invited[] };
  return res.invited;
}

/** Splits "a@x.com, b@y.com" (or repeated values) into clean emails. */
export function parseEmails(values: string | string[] | undefined): string[] {
  const all = (Array.isArray(values) ? values : values ? [values] : []).flatMap((v) => v.split(/[\s,;]+/));
  const emails = [...new Set(all.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  const bad = emails.filter((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  if (bad.length) throw new Error(`Not an email: ${bad.join(", ")}`);
  return emails;
}

/**
 * Changes a canvas's link without a new version: who can open it, and
 * invitations (each invitee is emailed).
 */
export async function updateAccess(site: ReviewSite, project: string, canvas: string, change: { access?: Access; password?: string; invite?: string[] }) {
  const can = await siteFeatures(site);
  if (!can.includes("access") || !can.includes("invites")) throw new Error(NO_SIGN_IN);
  const found = (await request(site, "GET", `/api/shares?project=${encodeURIComponent(project)}&canvas=${encodeURIComponent(canvas)}`)) as { slug: string | null };
  if (!found.slug) throw new Error(`${canvas} has no link yet. Share it first: npx truecanvas share ${canvas}`);
  let access: Access | null = null;
  if (change.access || change.password) {
    const after = (await request(site, "PATCH", `/api/shares/${found.slug}`, { ...(change.access ? { access: change.access } : {}), ...(change.password ? { password: change.password } : {}) })) as { access?: Access };
    access = after.access ?? null;
  }
  const invited = change.invite?.length ? await inviteTo(site, found.slug, change.invite) : [];
  const share = (await request(site, "GET", `/api/shares/${found.slug}`)) as { access?: Access };
  return { url: `${site.url}/s/${found.slug}`, access: access ?? share.access ?? null, invited };
}

/** A canvas's link as it is now, without publishing anything: null when it has none. */
export async function linkInfo(site: ReviewSite, project: string, canvas: string): Promise<LinkInfo | null> {
  const found = (await request(site, "GET", `/api/shares?project=${encodeURIComponent(project)}&canvas=${encodeURIComponent(canvas)}`)) as { slug: string | null };
  if (!found.slug) return null;
  const share = (await request(site, "GET", `/api/shares/${found.slug}`)) as {
    title?: string;
    access?: Access;
    password?: boolean;
    versions?: { id: string; createdAt: number; live?: unknown }[];
  };
  const last = share.versions?.at(-1);
  return {
    url: `${site.url}/s/${found.slug}`,
    title: share.title ?? canvas,
    access: share.access ?? null,
    password: !!share.password,
    versions: share.versions?.length ?? 0,
    updatedAt: last?.createdAt ?? null,
    live: !!last?.live,
  };
}

export interface LinkInfo {
  url: string;
  title: string;
  access: Access | null;
  password: boolean;
  versions: number;
  /** when the latest version was published */
  updatedAt: number | null;
  /** the latest version has the real site */
  live: boolean;
}

/** Deletes a canvas's link with its versions, files and comments. */
export async function deleteShare(site: ReviewSite, project: string, canvas: string): Promise<boolean> {
  const found = (await request(site, "GET", `/api/shares?project=${encodeURIComponent(project)}&canvas=${encodeURIComponent(canvas)}`)) as { slug: string | null };
  if (!found.slug) return false;
  await request(site, "DELETE", `/api/shares/${found.slug}`);
  return true;
}

/** Revokes or restores a canvas's link, or removes its password. */
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

/** Every file under a folder, as posix paths relative to it (dotfiles left out). */
function walk(root: string, rel = ""): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const child = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(root, child));
    else if (entry.isFile()) out.push(child);
  }
  return out;
}

function contentType(file: string): string {
  const ext = path.extname(file).slice(1).toLowerCase();
  const types: Record<string, string> = {
    html: "text/html; charset=utf-8",
    css: "text/css; charset=utf-8",
    js: "text/javascript; charset=utf-8",
    mjs: "text/javascript; charset=utf-8",
    json: "application/json",
    map: "application/json",
    txt: "text/plain; charset=utf-8",
    xml: "application/xml",
    webmanifest: "application/manifest+json",
    wasm: "application/wasm",
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
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
