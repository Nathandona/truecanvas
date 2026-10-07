import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

/*
 * Two kinds of access:
 * - the studio (Truecanvas uploading, managing links): `Authorization: Bearer <REVIEW_TOKEN>`
 * - a client opening a password-protected link: a signed cookie per link
 */

const secret = () => {
  const token = process.env.REVIEW_TOKEN;
  if (!token || token.length < 24) throw new Error("Set REVIEW_TOKEN (24+ characters) in the project's environment variables.");
  return token;
};

const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export function isStudio(req: Request): boolean {
  const header = req.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") && same(header.slice(7), secret());
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 32).toString("hex")}`;
}

export function checkPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  return !!salt && !!hash && same(scryptSync(password, salt, 32).toString("hex"), hash);
}

const cookieName = (slug: string) => `tc_${slug.slice(-10)}`;
const sign = (slug: string, stored: string) => createHmac("sha256", secret()).update(`${slug}:${stored}`).digest("hex");

/** Changing the password invalidates every cookie issued for the old one. */
export async function hasAccess(slug: string, stored: string | undefined): Promise<boolean> {
  if (!stored) return true;
  const value = (await cookies()).get(cookieName(slug))?.value;
  return !!value && same(value, sign(slug, stored));
}

export async function grantAccess(slug: string, stored: string) {
  // SameSite=None: the frames are sandboxed (opaque origin), their requests still need the cookie
  (await cookies()).set(cookieName(slug), sign(slug, stored), { httpOnly: true, secure: true, sameSite: "none", path: `/s/${slug}`, maxAge: 60 * 60 * 24 * 30 });
}
