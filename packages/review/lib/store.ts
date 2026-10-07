import { Redis } from "@upstash/redis";
import { get, put } from "@vercel/blob";
import type { ShareFrame } from "truecanvas/share";

/*
 * Shares live in Redis (small JSON records), files in a private Vercel Blob
 * store under shares/<slug>/:
 *   assets/<hash>.<ext>           shared by every version (content-addressed)
 *   <version>/frames/<name>.html  the frozen frames
 *   <version>/frames/<name>.png
 */

export interface Version {
  id: string;
  createdAt: number;
  frames: ShareFrame[];
}

export interface Share {
  slug: string;
  project: string;
  canvas: string;
  title: string;
  createdAt: number;
  versions: Version[];
  /** scrypt hash ("salt:hash") when the link needs a password */
  password?: string;
  revoked?: boolean;
}

let client: Redis | null = null;
/** Lazy: env vars may be missing at build time. */
export function redis() {
  client ??= Redis.fromEnv();
  return client;
}

const key = {
  share: (slug: string) => `tc:share:${slug}`,
  index: (project: string, canvas: string) => `tc:index:${project}/${canvas}`,
  assets: (slug: string) => `tc:assets:${slug}`,
};

export async function getShare(slug: string): Promise<Share | null> {
  if (!/^[a-z0-9-]{8,120}$/.test(slug)) return null;
  return (await redis().get<Share>(key.share(slug))) ?? null;
}

export async function saveShare(share: Share) {
  await redis().set(key.share(share.slug), share);
}

export async function findShare(project: string, canvas: string): Promise<Share | null> {
  const slug = await redis().get<string>(key.index(project, canvas));
  return slug ? getShare(slug) : null;
}

export async function createShare(project: string, canvas: string, title: string): Promise<Share> {
  const kebab = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "design";
  // unguessable: the link is the key
  const random = Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => "abcdefghijkmnpqrstuvwxyz23456789"[b % 32]).join("");
  const share: Share = { slug: `${kebab(project)}-${kebab(canvas)}-${random}`, project, canvas, title, createdAt: Date.now(), versions: [] };
  await saveShare(share);
  await redis().set(key.index(project, canvas), share.slug);
  return share;
}

/** Asset names already uploaded for a share (uploads skip them). */
export async function knownAssets(slug: string): Promise<Set<string>> {
  return new Set(await redis().smembers<string[]>(key.assets(slug)));
}

export async function rememberAsset(slug: string, name: string) {
  await redis().sadd(key.assets(slug), name);
}

/** Blob path of a file inside a share, or null for anything else. */
export function blobPath(slug: string, file: string): string | null {
  const asset = /^assets\/([a-f0-9]{8,64}\.[a-z0-9]{1,5})$/.exec(file);
  if (asset) return `shares/${slug}/assets/${asset[1]}`;
  const frame = /^(\d{8}-\d{6})\/frames\/([a-z0-9-]{1,80}\.(?:html|png))$/.exec(file);
  if (frame) return `shares/${slug}/${frame[1]}/frames/${frame[2]}`;
  return null;
}

export async function putFile(path: string, body: ArrayBuffer, contentType: string) {
  await put(path, body, { access: "private", contentType, allowOverwrite: true, addRandomSuffix: false });
}

export async function readFile(path: string) {
  const res = await get(path, { access: "private" });
  return res && res.statusCode === 200 ? res : null;
}
