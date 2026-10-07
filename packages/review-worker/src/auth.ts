import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookie } from "./http";
import type { ReviewEnv } from "./env";

/*
 * Three kinds of access:
 * - the studio (Truecanvas uploading, managing links): `Authorization: Bearer <REVIEW_TOKEN>`
 * - a client opening a password-protected link: a signed cookie per link
 * - the same client opening the link's live site, on its own host: a
 *   short-lived token handed out by the viewer, traded for a cookie there
 * Password hashes keep the original review site's scrypt "salt:hash" format,
 * so links moved from it keep their password.
 */

function secret(env: ReviewEnv) {
  const token = env.REVIEW_TOKEN;
  if (!token || token.length < 24) throw new Error("Set the REVIEW_TOKEN secret (24+ characters): wrangler secret put REVIEW_TOKEN");
  return token;
}

const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

const hmac = (env: ReviewEnv, data: string) => createHmac("sha256", secret(env)).update(data).digest("hex");

export function isStudio(req: Request, env: ReviewEnv): boolean {
  const header = req.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") && same(header.slice(7), secret(env));
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 32).toString("hex")}`;
}

export function checkPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  return !!salt && !!hash && same(scryptSync(password, salt, 32).toString("hex"), hash);
}

// ---------- the review link ----------

const linkCookie = (slug: string) => `tc_${slug.slice(-10)}`;

/** Changing the password invalidates every cookie issued for the old one. */
export function hasAccess(req: Request, env: ReviewEnv, slug: string, stored: string | null): boolean {
  if (!stored) return true;
  const value = cookie(req, linkCookie(slug));
  return !!value && same(value, hmac(env, `${slug}:${stored}`));
}

export function accessCookie(env: ReviewEnv, slug: string, stored: string): string {
  // SameSite=None: the frames are sandboxed (opaque origin), their requests still need the cookie
  return `${linkCookie(slug)}=${hmac(env, `${slug}:${stored}`)}; Path=/s/${slug}; Max-Age=${60 * 60 * 24 * 30}; HttpOnly; Secure; SameSite=None`;
}

// ---------- the link's live site ----------

const LIVE_TOKEN_TTL = 12 * 60 * 60 * 1000;
export const LIVE_COOKIE = "tc_live";

/** Put in the manifest for a viewer that has access: opens the live site once. */
export function liveToken(env: ReviewEnv, slug: string, version: string): string {
  const exp = Date.now() + LIVE_TOKEN_TTL;
  return `${exp}.${hmac(env, `live-token:${slug}:${version}:${exp}`)}`;
}

export function checkLiveToken(env: ReviewEnv, slug: string, version: string, token: string): boolean {
  const [exp, sig] = token.split(".");
  if (!exp || !sig || !(Number(exp) > Date.now())) return false;
  return same(sig, hmac(env, `live-token:${slug}:${version}:${exp}`));
}

/** The live host's cookie: tied to the password, so changing it locks old sessions out. */
export const liveCookieValue = (env: ReviewEnv, slug: string, version: string, stored: string) => hmac(env, `live:${slug}:${version}:${stored}`);

export function hasLiveAccess(req: Request, env: ReviewEnv, slug: string, version: string, stored: string | null): boolean {
  if (!stored) return true;
  const value = cookie(req, LIVE_COOKIE);
  return !!value && same(value, liveCookieValue(env, slug, version, stored));
}
