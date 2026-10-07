import { isStudio } from "@/lib/auth";
import { brand, json } from "@/lib/http";
import { createShare, findShare } from "@/lib/store";

/** Checks the studio token (Truecanvas runs this when connecting), or finds a canvas's link without creating one. */
export async function GET(req: Request) {
  if (!isStudio(req)) return json({ error: "Unauthorized" }, 401);
  const q = new URL(req.url).searchParams;
  const project = q.get("project");
  const canvas = q.get("canvas");
  if (project && canvas) {
    const share = await findShare(project, canvas);
    return json({ slug: share && !share.revoked ? share.slug : null });
  }
  return json({ ok: true, brand: brand() });
}

/** The link for a project's canvas: the existing one, or a new one. Studio only. */
export async function POST(req: Request) {
  if (!isStudio(req)) return json({ error: "Unauthorized" }, 401);
  const { project, canvas, title } = (await req.json().catch(() => ({}))) as { project?: string; canvas?: string; title?: string };
  if (!project || !canvas) return json({ error: "project and canvas are required" }, 400);
  const share = (await findShare(project, canvas)) ?? (await createShare(project, canvas, title || canvas));
  return json({ slug: share.slug, url: new URL(`/s/${share.slug}`, req.url).href, versions: share.versions.length, password: !!share.password, revoked: !!share.revoked });
}
