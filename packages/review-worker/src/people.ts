import type { ReviewEnv } from "./env";

/*
 * Who's who on the review site:
 * - owners: the emails in STUDIO_EMAILS. Members of every link; they add or
 *   remove other members.
 * - members: the studio's team, added by an owner. They see every link.
 * - invitees: clients invited to one link at a time.
 * Emails are compared lowercased.
 */

export const normalEmail = (email: string) => email.trim().toLowerCase();
export const isEmail = (email: string) => /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/.test(email) && email.length <= 254;

export function owners(env: ReviewEnv): string[] {
  return (env.STUDIO_EMAILS ?? "")
    .split(",")
    .map(normalEmail)
    .filter(isEmail);
}

export async function isMember(env: ReviewEnv, email: string): Promise<boolean> {
  const e = normalEmail(email);
  if (owners(env).includes(e)) return true;
  return !!(await env.DB.prepare("SELECT 1 FROM members WHERE email = ?").bind(e).first());
}

export interface Member {
  email: string;
  owner: boolean;
  addedBy: string | null;
  createdAt: number | null;
}

export async function listMembers(env: ReviewEnv): Promise<Member[]> {
  const { results } = await env.DB.prepare("SELECT email, added_by, created_at FROM members ORDER BY created_at").all<{ email: string; added_by: string | null; created_at: number }>();
  const own = owners(env);
  return [
    ...own.map((email) => ({ email, owner: true, addedBy: null, createdAt: null })),
    ...results.filter((r) => !own.includes(r.email)).map((r) => ({ email: r.email, owner: false, addedBy: r.added_by, createdAt: r.created_at })),
  ];
}

export async function addMember(env: ReviewEnv, email: string, by: string) {
  await env.DB.prepare("INSERT OR IGNORE INTO members (email, added_by, created_at) VALUES (?, ?, ?)").bind(normalEmail(email), by, Date.now()).run();
}

export async function removeMember(env: ReviewEnv, email: string) {
  await env.DB.prepare("DELETE FROM members WHERE email = ?").bind(normalEmail(email)).run();
}

// ---------- invitations ----------

const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";
const randomToken = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => ALPHABET[b % 32]).join("");

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export interface Invite {
  email: string;
  createdAt: number;
}

/**
 * Invites someone to a link and returns the token of their invitation link
 * (/i/<token>). Inviting again issues a new token: the old email stops working.
 */
export async function createInvite(env: ReviewEnv, slug: string, email: string): Promise<string> {
  const token = randomToken();
  await env.DB.prepare("INSERT OR REPLACE INTO invites (slug, email, token_hash, created_at) VALUES (?, ?, ?, ?)")
    .bind(slug, normalEmail(email), await sha256(token), Date.now())
    .run();
  return token;
}

export async function listInvites(env: ReviewEnv, slug: string): Promise<Invite[]> {
  const { results } = await env.DB.prepare("SELECT email, created_at FROM invites WHERE slug = ? ORDER BY created_at").bind(slug).all<{ email: string; created_at: number }>();
  return results.map((r) => ({ email: r.email, createdAt: r.created_at }));
}

/** Removes an invitation: the person loses access to the link. */
export async function removeInvite(env: ReviewEnv, slug: string, email: string): Promise<boolean> {
  const res = await env.DB.prepare("DELETE FROM invites WHERE slug = ? AND email = ?").bind(slug, normalEmail(email)).run();
  return (res.meta.changes ?? 0) > 0;
}

/** The invitation behind an invitation link, while it hasn't been removed or replaced. */
export async function findInvite(env: ReviewEnv, token: string): Promise<{ slug: string; email: string } | null> {
  if (!/^[a-z0-9]{32}$/.test(token)) return null;
  return env.DB.prepare("SELECT slug, email FROM invites WHERE token_hash = ?").bind(await sha256(token)).first<{ slug: string; email: string }>();
}

export async function isInvited(env: ReviewEnv, slug: string, email: string): Promise<boolean> {
  return !!(await env.DB.prepare("SELECT 1 FROM invites WHERE slug = ? AND email = ?").bind(slug, normalEmail(email)).first());
}

/** Anyone allowed to ask for a sign-in link: the studio, and people invited somewhere. */
export async function maySignIn(env: ReviewEnv, email: string): Promise<boolean> {
  if (await isMember(env, email)) return true;
  return !!(await env.DB.prepare("SELECT 1 FROM invites WHERE email = ? LIMIT 1").bind(normalEmail(email)).first());
}
