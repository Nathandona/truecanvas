import { hashPassword, isStudio } from "@/lib/auth";
import { json, notFound } from "@/lib/http";
import { getShare, saveShare } from "@/lib/store";

type Params = { params: Promise<{ slug: string }> };

export async function GET(req: Request, { params }: Params) {
  if (!isStudio(req)) return json({ error: "Unauthorized" }, 401);
  const share = await getShare((await params).slug);
  if (!share) return notFound();
  const { password, ...rest } = share;
  return json({ ...rest, password: !!password });
}

/** Set or remove the password, revoke or restore the link, rename it. Studio only. */
export async function PATCH(req: Request, { params }: Params) {
  if (!isStudio(req)) return json({ error: "Unauthorized" }, 401);
  const share = await getShare((await params).slug);
  if (!share) return notFound();
  const body = (await req.json().catch(() => ({}))) as { password?: string | null; revoked?: boolean; title?: string };
  if (body.password === null || body.password === "") delete share.password;
  else if (typeof body.password === "string") share.password = hashPassword(body.password);
  if (typeof body.revoked === "boolean") share.revoked = body.revoked;
  if (typeof body.title === "string" && body.title.trim()) share.title = body.title.trim().slice(0, 120);
  await saveShare(share);
  return json({ ok: true, password: !!share.password, revoked: !!share.revoked });
}
