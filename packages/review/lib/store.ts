import { Redis } from "@upstash/redis";
import { del, get, list, put } from "@vercel/blob";
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
  comments: (slug: string) => `tc:comments:${slug}`,
  updated: (slug: string) => `tc:comments-updated:${slug}`,
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

/** Removes a link entirely: its record, comments and every file. */
export async function deleteShare(share: Share) {
  const r = redis();
  await r.del(key.share(share.slug), key.assets(share.slug), key.comments(share.slug), key.updated(share.slug));
  if ((await r.get<string>(key.index(share.project, share.canvas))) === share.slug) await r.del(key.index(share.project, share.canvas));
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: `shares/${share.slug}/`, cursor, limit: 1000 });
    if (page.blobs.length) await del(page.blobs.map((b) => b.url));
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
}

// ---------- comments ----------

export interface CommentAuthor {
  name: string;
  /** client: someone with the link; studio: the studio (from Truecanvas) */
  kind: "client" | "studio";
}

export interface CommentMessage {
  id: string;
  author: CommentAuthor;
  text: string;
  at: number;
}

export interface Thread {
  id: string;
  frame: string;
  /** the version it was placed on */
  version: string;
  x: number;
  y: number;
  resolved: boolean;
  resolvedAt?: number;
  resolvedBy?: CommentAuthor;
  messages: CommentMessage[];
  createdAt: number;
  updatedAt: number;
}

export const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => "abcdefghijkmnpqrstuvwxyz23456789"[b % 32]).join("");

export async function listThreads(slug: string): Promise<Thread[]> {
  const all = (await redis().hgetall<Record<string, Thread>>(key.comments(slug))) ?? {};
  return Object.values(all).sort((a, b) => a.createdAt - b.createdAt);
}

export async function commentsUpdated(slug: string): Promise<number> {
  return Number((await redis().get<number>(key.updated(slug))) ?? 0);
}

export async function addThread(slug: string, thread: Thread) {
  if ((await redis().hlen(key.comments(slug))) >= 1000) throw new Error("This link has too many comments.");
  await redis().hset(key.comments(slug), { [thread.id]: thread });
  await redis().set(key.updated(slug), thread.updatedAt);
}

/*
 * Replies and resolutions are applied inside Redis, so a client and the
 * studio writing at the same moment never overwrite each other. A message
 * whose id is already there is skipped (the studio's sync can retry safely).
 */
const APPLY = `
local raw = redis.call('HGET', KEYS[1], ARGV[1])
if not raw then return 0 end
local t = cjson.decode(raw)
local op = cjson.decode(ARGV[2])
if op.message then
  local seen = false
  for _, m in ipairs(t.messages) do if m.id == op.message.id then seen = true end end
  if not seen then table.insert(t.messages, op.message) end
end
if op.resolved ~= nil then
  t.resolved = op.resolved
  t.resolvedAt = op.at
  if op.resolved then t.resolvedBy = op.by else t.resolvedBy = nil end
end
t.updatedAt = op.at
redis.call('HSET', KEYS[1], ARGV[1], cjson.encode(t))
redis.call('SET', KEYS[2], op.at)
return 1`;

export async function applyToThread(slug: string, threadId: string, op: { message?: CommentMessage; resolved?: boolean; by?: CommentAuthor; at: number }): Promise<boolean> {
  const done = await redis().eval(APPLY, [key.comments(slug), key.updated(slug)], [threadId, JSON.stringify(op)]);
  return done === 1;
}
