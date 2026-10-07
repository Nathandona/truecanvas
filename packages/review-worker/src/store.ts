import type { ShareFrame } from "truecanvas/share";
import type { ReviewEnv } from "./env";

/*
 * Shares, versions and comments live in D1; files in R2 under shares/<slug>/:
 *   assets/<hash>.<ext>           shared by every version (content-addressed)
 *   <version>/frames/<name>.html  the frozen frames
 *   <version>/frames/<name>.png
 *   live/<version>/<path>         the version's live site, when it has one
 */

export type Live = { files: true } | { url: string };

/**
 * Who can open a link: "invited" (signed-in invitees and the studio),
 * "password" (the link's password), "public" (anyone with the link).
 */
export type Access = "invited" | "password" | "public";
export const ACCESS: readonly string[] = ["invited", "password", "public"];

export interface Version {
  id: string;
  createdAt: number;
  frames: ShareFrame[];
  live: Live | null;
}

export interface Share {
  slug: string;
  key: string;
  project: string;
  canvas: string;
  title: string;
  createdAt: number;
  versions: Version[];
  /** scrypt hash ("salt:hash") when the link needs a password */
  password: string | null;
  access: Access;
  revoked: boolean;
}

/** Versions kept per link: older ones are dropped when a new one arrives. */
const MAX_VERSIONS = 30;

interface ShareRow {
  slug: string;
  key: string;
  project: string;
  canvas: string;
  title: string;
  created_at: number;
  password: string | null;
  access: string;
  revoked: number;
}

interface VersionRow {
  id: string;
  created_at: number;
  frames: string;
  live: string | null;
}

const toVersion = (r: VersionRow): Version => ({ id: r.id, createdAt: r.created_at, frames: JSON.parse(r.frames) as ShareFrame[], live: r.live ? (JSON.parse(r.live) as Live) : null });

async function withVersions(env: ReviewEnv, row: ShareRow | null): Promise<Share | null> {
  if (!row) return null;
  const { results } = await env.DB.prepare("SELECT id, created_at, frames, live FROM versions WHERE slug = ? ORDER BY created_at").bind(row.slug).all<VersionRow>();
  return toShare(row, results.map(toVersion));
}

function toShare(row: ShareRow, versions: Version[]): Share {
  return {
    slug: row.slug,
    key: row.key,
    project: row.project,
    canvas: row.canvas,
    title: row.title,
    createdAt: row.created_at,
    password: row.password,
    // a password always protects its link, even if a write (an older migration
    // script, say) left the column at its default
    access: row.access === "invited" ? "invited" : row.password ? "password" : "public",
    revoked: !!row.revoked,
    versions,
  };
}

export async function getShare(env: ReviewEnv, slug: string): Promise<Share | null> {
  if (!/^[a-z0-9-]{8,120}$/.test(slug)) return null;
  return withVersions(env, await env.DB.prepare("SELECT * FROM shares WHERE slug = ?").bind(slug).first<ShareRow>());
}

/** The share whose live sites are named by `key` (the slug's random tail). */
export async function getShareByKey(env: ReviewEnv, key: string): Promise<Share | null> {
  return withVersions(env, await env.DB.prepare("SELECT * FROM shares WHERE key = ?").bind(key).first<ShareRow>());
}

/** Every link, newest first, without their versions: the studio's links page. */
export async function listShares(env: ReviewEnv): Promise<Omit<Share, "versions">[]> {
  const { results } = await env.DB.prepare("SELECT * FROM shares ORDER BY created_at DESC").all<ShareRow>();
  return results.map((row) => {
    const { versions: _, ...rest } = toShare(row, []);
    return rest;
  });
}

export async function findShare(env: ReviewEnv, project: string, canvas: string): Promise<Share | null> {
  const hit = await env.DB.prepare("SELECT slug FROM share_index WHERE project = ? AND canvas = ?").bind(project, canvas).first<{ slug: string }>();
  return hit ? getShare(env, hit.slug) : null;
}

const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";
const random = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => ALPHABET[b % 32]).join("");

/** The random tail of a slug, unique per link. */
export const keyOf = (slug: string) => slug.slice(-10);

/**
 * A new link. Older Truecanvas versions don't send an access mode: their
 * links stay open (or take a password later), as they always were.
 */
export async function createShare(env: ReviewEnv, project: string, canvas: string, title: string, access: Access = "public"): Promise<Share> {
  const kebab = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "design";
  // unguessable: the link is the key
  const slug = `${kebab(project)}-${kebab(canvas)}-${random(10)}`;
  const createdAt = Date.now();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO shares (slug, key, project, canvas, title, created_at, access) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(slug, keyOf(slug), project, canvas, title, createdAt, access),
    env.DB.prepare("INSERT OR REPLACE INTO share_index (project, canvas, slug) VALUES (?, ?, ?)").bind(project, canvas, slug),
  ]);
  return { slug, key: keyOf(slug), project, canvas, title, createdAt, versions: [], password: null, access, revoked: false };
}

export async function updateShare(env: ReviewEnv, slug: string, change: { password?: string | null; access?: Access; revoked?: boolean; title?: string }) {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (change.password !== undefined) (sets.push("password = ?"), values.push(change.password));
  if (change.revoked !== undefined) (sets.push("revoked = ?"), values.push(change.revoked ? 1 : 0));
  if (change.title !== undefined) (sets.push("title = ?"), values.push(change.title));
  if (change.access !== undefined) (sets.push("access = ?"), values.push(change.access));
  if (!sets.length) return;
  await env.DB.prepare(`UPDATE shares SET ${sets.join(", ")} WHERE slug = ?`).bind(...values, slug).run();
}

/** Publishes a version (replacing one with the same id), then keeps the latest MAX_VERSIONS. */
export async function putVersion(env: ReviewEnv, slug: string, version: Version): Promise<number> {
  await env.DB.prepare("INSERT OR REPLACE INTO versions (slug, id, created_at, frames, live) VALUES (?, ?, ?, ?, ?)")
    .bind(slug, version.id, version.createdAt, JSON.stringify(version.frames), version.live ? JSON.stringify(version.live) : null)
    .run();
  const { results } = await env.DB.prepare("SELECT id FROM versions WHERE slug = ? ORDER BY created_at DESC").bind(slug).all<{ id: string }>();
  const dropped = results.slice(MAX_VERSIONS).map((r) => r.id);
  for (const id of dropped) {
    await env.DB.prepare("DELETE FROM versions WHERE slug = ? AND id = ?").bind(slug, id).run();
    // a dropped version's live site goes with it; its frames stay, as on the original site
    await deletePrefix(env, `shares/${slug}/live/${id}/`);
  }
  return results.length - dropped.length;
}

/** Asset names already uploaded for a share (uploads skip them). */
export async function knownAssets(env: ReviewEnv, slug: string): Promise<string[]> {
  const { results } = await env.DB.prepare("SELECT name FROM assets WHERE slug = ?").bind(slug).all<{ name: string }>();
  return results.map((r) => r.name);
}

export async function rememberAsset(env: ReviewEnv, slug: string, name: string) {
  await env.DB.prepare("INSERT OR IGNORE INTO assets (slug, name) VALUES (?, ?)").bind(slug, name).run();
}

/** R2 key of a snapshot file inside a share, or null for anything else. */
export function filePath(slug: string, file: string): string | null {
  const asset = /^assets\/([a-f0-9]{8,64}\.[a-z0-9]{1,5})$/.exec(file);
  if (asset) return `shares/${slug}/assets/${asset[1]}`;
  const frame = /^(\d{8}-\d{6})\/frames\/([a-z0-9-]{1,80}\.(?:html|png))$/.exec(file);
  if (frame) return `shares/${slug}/${frame[1]}/frames/${frame[2]}`;
  return null;
}

/** R2 key of a live site's file, or null when the path could escape its folder. */
export function livePath(slug: string, version: string, file: string): string | null {
  if (!/^\d{8}-\d{6}$/.test(version)) return null;
  const clean = file.replace(/^\/+/, "");
  if (!clean || clean.length > 400 || /(^|\/)\.\.?(\/|$)/.test(clean) || /[\\\0]/.test(clean)) return null;
  return `shares/${slug}/live/${version}/${clean}`;
}

export async function deletePrefix(env: ReviewEnv, prefix: string) {
  let cursor: string | undefined;
  do {
    const page = await env.FILES.list({ prefix, cursor, limit: 1000 });
    if (page.objects.length) await env.FILES.delete(page.objects.map((o) => o.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

/** Removes a link entirely: its record, versions, comments and every file. */
export async function deleteShare(env: ReviewEnv, share: Share) {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM messages WHERE slug = ?").bind(share.slug),
    env.DB.prepare("DELETE FROM threads WHERE slug = ?").bind(share.slug),
    env.DB.prepare("DELETE FROM assets WHERE slug = ?").bind(share.slug),
    env.DB.prepare("DELETE FROM invites WHERE slug = ?").bind(share.slug),
    env.DB.prepare("DELETE FROM versions WHERE slug = ?").bind(share.slug),
    env.DB.prepare("DELETE FROM share_index WHERE project = ? AND canvas = ? AND slug = ?").bind(share.project, share.canvas, share.slug),
    env.DB.prepare("DELETE FROM shares WHERE slug = ?").bind(share.slug),
  ]);
  await deletePrefix(env, `shares/${share.slug}/`);
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

export const newId = () => random(8);

/** Threads per link, at most. */
const MAX_THREADS = 1000;

interface ThreadRow {
  id: string;
  frame: string;
  version: string;
  x: number;
  y: number;
  resolved: number;
  resolved_at: number | null;
  resolved_by: string | null;
  created_at: number;
  updated_at: number;
}

interface MessageRow {
  thread: string;
  id: string;
  author_name: string;
  author_kind: "client" | "studio";
  text: string;
  at: number;
}

export async function listThreads(env: ReviewEnv, slug: string): Promise<Thread[]> {
  const [threads, messages] = await env.DB.batch<ThreadRow | MessageRow>([
    env.DB.prepare("SELECT * FROM threads WHERE slug = ? ORDER BY created_at").bind(slug),
    env.DB.prepare("SELECT thread, id, author_name, author_kind, text, at FROM messages WHERE slug = ? ORDER BY at, rowid").bind(slug),
  ]);
  const byThread = new Map<string, CommentMessage[]>();
  for (const m of messages.results as MessageRow[]) {
    const list = byThread.get(m.thread) ?? [];
    list.push({ id: m.id, author: { name: m.author_name, kind: m.author_kind }, text: m.text, at: m.at });
    byThread.set(m.thread, list);
  }
  return (threads.results as ThreadRow[]).map((t) => ({
    id: t.id,
    frame: t.frame,
    version: t.version,
    x: t.x,
    y: t.y,
    resolved: !!t.resolved,
    ...(t.resolved_at != null ? { resolvedAt: t.resolved_at } : {}),
    ...(t.resolved && t.resolved_by ? { resolvedBy: JSON.parse(t.resolved_by) as CommentAuthor } : {}),
    messages: byThread.get(t.id) ?? [],
    createdAt: t.created_at,
    updatedAt: t.updated_at,
  }));
}

export async function commentsUpdated(env: ReviewEnv, slug: string): Promise<number> {
  const row = await env.DB.prepare("SELECT comments_updated FROM shares WHERE slug = ?").bind(slug).first<{ comments_updated: number }>();
  return row?.comments_updated ?? 0;
}

const insertMessage = (env: ReviewEnv, slug: string, thread: string, m: CommentMessage) =>
  env.DB.prepare("INSERT OR IGNORE INTO messages (slug, thread, id, author_name, author_kind, text, at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(slug, thread, m.id, m.author.name, m.author.kind, m.text, m.at);

export async function addThread(env: ReviewEnv, slug: string, thread: Thread) {
  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM threads WHERE slug = ?").bind(slug).first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_THREADS) throw new Error("This link has too many comments.");
  await env.DB.batch([
    env.DB.prepare("INSERT INTO threads (slug, id, frame, version, x, y, resolved, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)").bind(
      slug,
      thread.id,
      thread.frame,
      thread.version,
      thread.x,
      thread.y,
      thread.createdAt,
      thread.updatedAt,
    ),
    ...thread.messages.map((m) => insertMessage(env, slug, thread.id, m)),
    env.DB.prepare("UPDATE shares SET comments_updated = ? WHERE slug = ?").bind(thread.updatedAt, slug),
  ]);
}

/*
 * A reply or a resolution. Messages are rows of their own, inserted or
 * ignored by id (the studio's sync can retry safely), and a resolution is a
 * single UPDATE: a client and the studio writing at the same moment never
 * overwrite each other. One batch, so it lands as one transaction.
 */
export async function applyToThread(env: ReviewEnv, slug: string, threadId: string, op: { message?: CommentMessage; resolved?: boolean; by?: CommentAuthor; at: number }): Promise<boolean> {
  const exists = await env.DB.prepare("SELECT 1 AS ok FROM threads WHERE slug = ? AND id = ?").bind(slug, threadId).first();
  if (!exists) return false;
  const writes: D1PreparedStatement[] = [];
  if (op.message) writes.push(insertMessage(env, slug, threadId, op.message));
  if (op.resolved !== undefined)
    writes.push(
      env.DB.prepare("UPDATE threads SET resolved = ?, resolved_at = ?, resolved_by = ? WHERE slug = ? AND id = ?").bind(
        op.resolved ? 1 : 0,
        op.at,
        op.resolved && op.by ? JSON.stringify(op.by) : null,
        slug,
        threadId,
      ),
    );
  writes.push(env.DB.prepare("UPDATE threads SET updated_at = ? WHERE slug = ? AND id = ?").bind(op.at, slug, threadId));
  writes.push(env.DB.prepare("UPDATE shares SET comments_updated = ? WHERE slug = ?").bind(op.at, slug));
  await env.DB.batch(writes);
  return true;
}
