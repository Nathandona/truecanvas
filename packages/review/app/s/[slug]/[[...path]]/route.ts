import { viewerHtml } from "truecanvas/share";
import { checkPassword, grantAccess, hasAccess } from "@/lib/auth";
import { brand, esc, json, notFound } from "@/lib/http";
import { addThread, applyToThread, blobPath, getShare, listThreads, newId, readFile, type Share, type Thread } from "@/lib/store";

type Params = { params: Promise<{ slug: string; path?: string[] }> };

/*
 * /s/<slug>/                         the viewer (or the password page)
 * /s/<slug>/manifest.json[?v=<id>]   frames of the latest (or a given) version
 * /s/<slug>/v/<id>/frames/<file>     a frozen frame
 * /s/<slug>/v/<id>/assets/<file>     its images and fonts (shared by versions)
 */
export async function GET(req: Request, { params }: Params) {
  const { slug, path = [] } = await params;
  const share = await getShare(slug);
  if (!share || share.revoked || !share.versions.length) return page("This link isn't available", "It may have been removed by the studio. Ask them for a new one.", 404);
  if (!(await hasAccess(slug, share.password))) return path.length ? notFound() : passwordPage(share);

  if (!path.length) {
    // the viewer loads everything relative to the link: a <base> keeps that true without a trailing slash
    const { logo } = brand();
    const head = `<base href="/s/${slug}/">${logo ? `<link rel="icon" href="${esc(logo)}">` : ""}`;
    const html = viewerHtml().replace("<head>", `<head>${head}`);
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-cache", "referrer-policy": "no-referrer" } });
  }
  if (path.length === 1 && path[0] === "manifest.json") return json(manifest(share, new URL(req.url).searchParams.get("v")));
  if (path.length === 1 && path[0] === "comments.json") return json({ threads: await listThreads(slug) });

  if (path[0] === "v" && path.length >= 4) {
    const [, version, kind, ...rest] = path;
    const file = kind === "assets" ? `assets/${rest.join("/")}` : `${version}/${kind}/${rest.join("/")}`;
    const blob = blobPath(slug, file);
    if (!blob) return notFound();
    const res = await readFile(blob);
    if (!res) return notFound();
    return new Response(res.stream, {
      headers: {
        "content-type": res.blob.contentType,
        // content-addressed assets never change; frames can be replaced
        "cache-control": kind === "assets" ? "private, max-age=31536000, immutable" : "private, no-cache",
        // frames are sandboxed (opaque origin): their fonts load cross-origin
        "access-control-allow-origin": "*",
        "x-content-type-options": "nosniff",
        // a frozen frame never runs scripts, even opened on its own
        ...(kind === "frames" ? { "content-security-policy": "script-src 'none'; object-src 'none'; base-uri 'none'" } : {}),
      },
    });
  }
  return notFound();
}

/** The password form, and clients' comments: a new thread (comments) or a reply (comments/<id>). */
export async function POST(req: Request, { params }: Params) {
  const { slug, path = [] } = await params;
  const share = await getShare(slug);
  if (!share || share.revoked) return notFound();
  if (path[0] === "comments" && path.length <= 2) {
    if (!(await hasAccess(slug, share.password))) return notFound();
    const body = (await req.json().catch(() => ({}))) as { text?: string; name?: string; frame?: string; version?: string; x?: number; y?: number };
    const text = String(body.text ?? "").trim().slice(0, 4000);
    const name = String(body.name ?? "").trim().slice(0, 60);
    if (!text || !name) return json({ error: "Write a comment and your name." }, 400);
    const now = Date.now();
    const message = { id: newId(), author: { name, kind: "client" as const }, text, at: now };
    if (path.length === 2) return (await applyToThread(slug, path[1], { message, at: now })) ? json({ ok: true, message }) : notFound();
    const version = share.versions.find((v) => v.id === body.version) ?? share.versions[share.versions.length - 1];
    const frame = version.frames.find((f) => f.name === body.frame);
    if (!frame || typeof body.x !== "number" || typeof body.y !== "number") return json({ error: "Pin the comment on a frame." }, 400);
    const thread: Thread = {
      id: newId(),
      frame: frame.name,
      version: version.id,
      x: Math.round(Math.min(Math.max(body.x, 0), frame.width)),
      y: Math.round(Math.min(Math.max(body.y, 0), frame.height)),
      resolved: false,
      messages: [message],
      createdAt: now,
      updatedAt: now,
    };
    try {
      await addThread(slug, thread);
    } catch (err) {
      return json({ error: (err as Error).message }, 429);
    }
    return json({ ok: true, thread });
  }
  if (!share.password || path.join("/") !== "unlock") return notFound();
  const form = await req.formData().catch(() => null);
  const password = String(form?.get("password") ?? "");
  if (!checkPassword(password, share.password)) return passwordPage(share, true);
  await grantAccess(slug, share.password);
  return Response.redirect(new URL(`/s/${slug}`, req.url), 303);
}

function manifest(share: Share, wanted: string | null) {
  const versions = [...share.versions].sort((a, b) => b.createdAt - a.createdAt);
  const current = versions.find((v) => v.id === wanted) ?? versions[0];
  return {
    format: 1,
    project: share.project,
    canvas: share.canvas,
    title: share.title,
    id: current.id,
    createdAt: current.createdAt,
    frames: current.frames.map((f) => ({ ...f, html: `v/${current.id}/${f.html}`, image: `v/${current.id}/${f.image}` })),
    versions: versions.map((v, i) => ({ id: v.id, createdAt: v.createdAt, latest: i === 0 })),
    brand: brand(),
    comments: true,
  };
}

function passwordPage(share: Share, wrong = false) {
  const b = brand();
  return page(
    esc(share.title),
    `<form method="post" action="/s/${share.slug}/unlock">
      <label for="pw">This design is protected. Enter the password the studio gave you.</label>
      <input id="pw" name="password" type="password" autocomplete="current-password" autofocus required ${wrong ? 'aria-invalid="true" aria-describedby="err"' : ""}>
      ${wrong ? '<p id="err" class="err">That password isn\'t right.</p>' : ""}
      <button type="submit">View the design</button>
    </form>`,
    wrong ? 401 : 200,
    b,
  );
}

function page(title: string, body: string, status = 200, b = brand()) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">${b.logo ? `<link rel="icon" href="${esc(b.logo)}">` : ""}<title>${title} · ${esc(b.name)}</title>
<style>
:root { --bg:#f3f2ef; --card:#fff; --text:#1c1b19; --muted:#77756f; --line:rgba(0,0,0,.1); color-scheme: light; }
@media (prefers-color-scheme: dark) { :root { --bg:#151514; --card:#1e1e1c; --text:#ecebe8; --muted:#9a9892; --line:rgba(255,255,255,.12); color-scheme: dark; } }
* { box-sizing: border-box; }
body { margin:0; min-height:100dvh; display:grid; place-items:center; padding:16px; background:var(--bg); color:var(--text); font:15px/1.5 Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
main { width:100%; max-width:380px; background:var(--card); border:1px solid var(--line); border-radius:16px; padding:28px; }
.brand { display:flex; align-items:center; gap:10px; font-weight:600; margin-bottom:20px; }
.brand img { height:24px; }
h1 { font-size:20px; margin:0 0 8px; letter-spacing:-.01em; }
p, label { color:var(--muted); margin:0; display:block; }
form { display:flex; flex-direction:column; gap:12px; }
input { font:inherit; padding:10px 12px; border-radius:10px; border:1px solid var(--line); background:transparent; color:inherit; }
input:focus-visible, button:focus-visible { outline:2px solid #3b82f6; outline-offset:1px; }
button { font:inherit; font-weight:550; padding:10px 12px; border-radius:10px; border:0; background:var(--text); color:var(--bg); cursor:pointer; transition:transform .12s cubic-bezier(.23,1,.32,1); }
button:active { transform:scale(.98); }
.err { color:#dc2626; }
</style></head><body><main>
<div class="brand">${b.logo ? `<img alt="" src="${esc(b.logo)}">` : ""}<span>${esc(b.name)}</span></div>
<h1>${title}</h1>${body.startsWith("<form") ? body : `<p>${body}</p>`}
</main></body></html>`;
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
