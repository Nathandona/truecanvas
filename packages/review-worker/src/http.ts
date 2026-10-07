import type { ReviewEnv } from "./env";

/** Review links are private: never indexed, whatever the response. */
const NOINDEX = { "x-robots-tag": "noindex, nofollow" };

export const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "cache-control": "no-store", ...NOINDEX } });

export const notFound = () => new Response("Not found", { status: 404, headers: { "content-type": "text/plain", ...NOINDEX } });

export function brand(env: ReviewEnv) {
  return { name: env.BRAND_NAME || "Design review", logo: env.BRAND_LOGO || null };
}

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** A small branded page: errors, the password form, the live site's gate. */
export function page(env: ReviewEnv, title: string, body: string, status = 200, headers: Record<string, string> = {}) {
  const b = brand(env);
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
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", ...NOINDEX, ...headers } });
}

/** The studio's own home: nothing to browse, every design has its private link. */
export function home(env: ReviewEnv) {
  const b = brand(env);
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${esc(b.name)}</title>${b.logo ? `<link rel="icon" href="${esc(b.logo)}">` : ""}</head>
<body style="margin:0;min-height:100dvh;display:grid;place-items:center;padding:16px;background:#f3f2ef;color:#1c1b19;font-family:Inter,ui-sans-serif,system-ui,sans-serif"><div style="display:flex;align-items:center;gap:10px;font-weight:600">${b.logo ? `<img alt="" src="${esc(b.logo)}" style="height:24px">` : ""}<span>${esc(b.name)}</span></div></body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", ...NOINDEX } });
}

/** Cookies sent with the request. */
export function cookie(req: Request, name: string): string | null {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}
