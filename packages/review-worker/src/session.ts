import { betterAuth } from "better-auth";
import { magicLink } from "better-auth/plugins";
import type { ReviewEnv } from "./env";
import { brand, esc } from "./http";
import { isMember, normalEmail, owners } from "./people";

/*
 * Sign-in, with Better Auth on D1: email links (magic links), no passwords.
 *
 * Better Auth creates the one-time token; this site writes the emails itself,
 * so a link always opens a page with a button first. Mail scanners that
 * follow links can't use up a sign-in that way, and an invitation (which
 * stays valid until it's removed) only creates its 15-minute link when the
 * person clicks.
 */

/** Sign-in needs its secret; without it the site works as before (passwords and open links). */
export const signInOn = (env: ReviewEnv) => (env.BETTER_AUTH_SECRET?.length ?? 0) >= 32;

const LINK_MINUTES = 15;

interface Pending {
  email: string;
  token: string;
}

function makeAuth(env: ReviewEnv, req: Request, pending: Pending[] = []) {
  const origin = new URL(req.url).origin;
  return betterAuth({
    database: env.DB,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: origin,
    basePath: "/api/auth",
    trustedOrigins: [origin],
    telemetry: { enabled: false },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      // frames and assets are many requests: don't read the session from D1 for each
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    advanced: {
      useSecureCookies: true,
      // the frozen frames are sandboxed (an opaque origin): their requests are cross-site and still need the session
      defaultCookieAttributes: { sameSite: "none", secure: true },
    },
    plugins: [
      magicLink({
        expiresIn: LINK_MINUTES * 60,
        storeToken: "hashed",
        sendMagicLink: async ({ email, token }) => {
          pending.push({ email, token });
        },
      }),
    ],
  });
}

/** Better Auth's own endpoints (/api/auth/*): magic link verification, sign-out, session. */
export const authHandler = (req: Request, env: ReviewEnv) => makeAuth(env, req).handler(req);

export interface Viewer {
  name: string;
  email: string;
  /** a studio member: sees every link */
  member: boolean;
  /** an owner (STUDIO_EMAILS): manages the members */
  owner: boolean;
}

/** The signed-in person, or null. */
export async function viewerOf(req: Request, env: ReviewEnv): Promise<Viewer | null> {
  if (!signInOn(env)) return null;
  const session = await makeAuth(env, req)
    .api.getSession({ headers: req.headers })
    .catch(() => null);
  if (!session) return null;
  const email = normalEmail(session.user.email);
  const owner = owners(env).includes(email);
  return { name: session.user.name?.trim() || nameFromEmail(email), email, member: owner || (await isMember(env, email)), owner };
}

/** "jean.dupont@x.fr" → "Jean Dupont": until someone gives their name. */
export const nameFromEmail = (email: string) => {
  const local = email.split("@")[0].replace(/[._+-]+/g, " ").trim();
  return local ? local.replace(/\b\w/g, (c) => c.toUpperCase()) : email;
};

/** The verification address for a token: where the confirmation page's button goes. */
export function verifyUrl(req: Request, token: string, next: string, errorNext: string): string {
  const url = new URL("/api/auth/magic-link/verify", req.url);
  url.searchParams.set("token", token);
  url.searchParams.set("callbackURL", next);
  url.searchParams.set("errorCallbackURL", errorNext);
  return url.href;
}

/** A one-time sign-in token for an email (no email sent). */
export async function createSignIn(req: Request, env: ReviewEnv, email: string, name?: string): Promise<string | null> {
  const pending: Pending[] = [];
  await makeAuth(env, req, pending).api.signInMagicLink({ body: { email: normalEmail(email), ...(name ? { name } : {}) }, headers: req.headers });
  return pending[0]?.token ?? null;
}

/** Signs out: the Set-Cookie headers that clear the session. */
export async function signOutHeaders(req: Request, env: ReviewEnv): Promise<Headers> {
  const res = await makeAuth(env, req)
    .api.signOut({ headers: req.headers, asResponse: true })
    .catch(() => null);
  const out = new Headers();
  for (const c of res?.headers.getSetCookie() ?? []) out.append("set-cookie", c);
  return out;
}

// ---------- emails ----------

export interface Sent {
  to: string;
  /** the link in the email, shown back only in local development (DEV_SHOW_EMAIL_LINKS) */
  link?: string;
}

export const devLinks = (env: ReviewEnv) => env.DEV_SHOW_EMAIL_LINKS === "1" || env.DEV_SHOW_EMAIL_LINKS === "true";

/** Sends a short branded email with one button. In local development the link is logged too. */
export async function sendLinkEmail(env: ReviewEnv, to: string, subject: string, intro: string, action: string, link: string): Promise<Sent> {
  const b = brand(env);
  const text = `${intro}\n\n${action}: ${link}\n\n${b.name}`;
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f3f2ef;font-family:Inter,ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;color:#1c1b19">
<div style="max-width:440px;margin:0 auto;background:#fff;border:1px solid rgba(0,0,0,.1);border-radius:16px;padding:28px">
<p style="margin:0 0 20px;font-weight:600">${esc(b.name)}</p>
<p style="margin:0 0 20px;line-height:1.5">${esc(intro)}</p>
<p style="margin:0 0 20px"><a href="${esc(link)}" style="display:inline-block;background:#1c1b19;color:#fff;text-decoration:none;font-weight:600;padding:10px 16px;border-radius:10px">${esc(action)}</a></p>
<p style="margin:0;color:#77756f;font-size:13px;line-height:1.5">If the button doesn't work, open this address: ${esc(link)}</p>
</div></body></html>`;
  if (devLinks(env)) console.log(`[review email] to ${to}: ${subject}\n  ${link}`);
  if (env.EMAIL && env.STUDIO_EMAIL_FROM) {
    await env.EMAIL.send({ to, from: { email: env.STUDIO_EMAIL_FROM, name: b.name }, subject, text, html });
  } else if (!devLinks(env)) {
    throw new Error("Emails can't be sent: set STUDIO_EMAIL_FROM and the EMAIL binding (Email Service).");
  }
  return { to, ...(devLinks(env) ? { link } : {}) };
}
