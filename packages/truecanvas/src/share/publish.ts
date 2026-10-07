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

  // the live site's files, under the version they belong to
  if (opts.live && "dir" in opts.live) {
    const liveDir = opts.live.dir;
    const liveFiles = walk(liveDir);
    const pending = [...liveFiles];
    const liveWorker = async () => {
      for (let rel = pending.shift(); rel; rel = pending.shift()) {
        const body = fs.readFileSync(path.join(liveDir, rel));
        if (body.length > MAX_FILE) {
          skipped.push(`live/${rel}`);
          continue;
        }
        await request(site, "PUT", `${base}/live/files?version=${manifest.id}`, body, { "x-path": rel, "content-type": contentType(rel) });
        uploaded++;
      }
    };
    await Promise.all(Array.from({ length: 6 }, liveWorker));
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
  const done = (await request(site, "POST", `${base}/versions`, { id: manifest.id, createdAt: manifest.createdAt, frames: manifest.frames, live })) as { url: string; versions: number; live?: string | null };
  // invitations go out once there's something to open
  const invited = opts.invite?.length ? await inviteTo(site, share.slug, opts.invite) : [];
  return { url: done.url, version: manifest.id, versions: done.versions, uploaded, skipped, password, live: done.live ?? null, access, invited };
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
