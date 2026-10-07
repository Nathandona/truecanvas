import type { ShareFrame } from "truecanvas/share";
import { isStudio } from "@/lib/auth";
import { json, notFound } from "@/lib/http";
import { getShare, saveShare } from "@/lib/store";

/** Publishes a version once its files are uploaded: it becomes what the link shows. Studio only. */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  if (!isStudio(req)) return json({ error: "Unauthorized" }, 401);
  const share = await getShare((await params).slug);
  if (!share) return notFound();
  const { id, createdAt, frames } = (await req.json().catch(() => ({}))) as { id?: string; createdAt?: number; frames?: ShareFrame[] };
  if (!id || !/^\d{8}-\d{6}$/.test(id) || !Array.isArray(frames) || !frames.length) return json({ error: "id and frames are required" }, 400);
  share.versions = [...share.versions.filter((v) => v.id !== id), { id, createdAt: createdAt ?? Date.now(), frames }].slice(-30);
  await saveShare(share);
  return json({ ok: true, url: new URL(`/s/${share.slug}`, req.url).href, version: id, versions: share.versions.length });
}
