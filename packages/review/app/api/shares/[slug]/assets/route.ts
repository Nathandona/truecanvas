import { isStudio } from "@/lib/auth";
import { json } from "@/lib/http";
import { knownAssets } from "@/lib/store";

/** Asset names this link already has: uploads skip them. Studio only. */
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  if (!isStudio(req)) return json({ error: "Unauthorized" }, 401);
  return json({ assets: [...(await knownAssets((await params).slug))] });
}
