import { isStudio } from "@/lib/auth";
import { json, notFound } from "@/lib/http";
import { applyToThread, commentsUpdated, getShare, listThreads, type CommentMessage } from "@/lib/store";

type Params = { params: Promise<{ slug: string }> };

/** Every thread of the link, for Truecanvas's sync. `?since=` answers cheaply when nothing changed. Studio only. */
export async function GET(req: Request, { params }: Params) {
  if (!isStudio(req)) return json({ error: "Unauthorized" }, 401);
  const { slug } = await params;
  const updated = await commentsUpdated(slug);
  const since = Number(new URL(req.url).searchParams.get("since") ?? 0);
  if (since && updated <= since) return json({ updated, threads: null });
  return json({ updated, threads: await listThreads(slug) });
}

/** A studio reply (with the id Truecanvas gave it) or a resolution. Studio only. */
export async function POST(req: Request, { params }: Params) {
  if (!isStudio(req)) return json({ error: "Unauthorized" }, 401);
  const { slug } = await params;
  if (!(await getShare(slug))) return notFound();
  const body = (await req.json().catch(() => ({}))) as { thread?: string; message?: { id: string; name: string; text: string; at?: number }; resolved?: boolean; name?: string };
  if (!body.thread) return json({ error: "thread is required" }, 400);
  const at = Date.now();
  const message: CommentMessage | undefined = body.message?.id && body.message.text?.trim()
    ? { id: String(body.message.id).slice(0, 40), author: { name: String(body.message.name || "Studio").slice(0, 60), kind: "studio" }, text: body.message.text.trim().slice(0, 4000), at: body.message.at ?? at }
    : undefined;
  const ok = await applyToThread(slug, body.thread, {
    message,
    ...(typeof body.resolved === "boolean" ? { resolved: body.resolved, by: { name: String(body.name || "Studio").slice(0, 60), kind: "studio" as const } } : {}),
    at,
  });
  return ok ? json({ ok: true }) : notFound();
}
