import { isStudio } from "@/lib/auth";
import { json, notFound } from "@/lib/http";
import { blobPath, getShare, putFile, rememberAsset } from "@/lib/store";

/** Uploads one snapshot file (raw body, path in `x-path`). Studio only. */
export async function PUT(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  if (!isStudio(req)) return json({ error: "Unauthorized" }, 401);
  const { slug } = await params;
  if (!(await getShare(slug))) return notFound();
  const file = req.headers.get("x-path") ?? "";
  const path = blobPath(slug, file);
  if (!path) return json({ error: `Unexpected file ${file}` }, 400);
  const body = await req.arrayBuffer();
  await putFile(path, body, req.headers.get("content-type") || "application/octet-stream");
  if (file.startsWith("assets/")) await rememberAsset(slug, file.slice("assets/".length));
  return json({ ok: true });
}
