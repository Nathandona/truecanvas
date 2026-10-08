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

/** The studio's pages (links, members): who's signed in and where they are. */
export interface AppNav {
  email: string;
  active: "links" | "members";
}

const ICON = {
  lock: '<path d="M7 11V7a5 5 0 0 1 10 0v4"/><rect x="4" y="11" width="16" height="10" rx="2"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  message: '<path d="M4 5h16v11H9l-5 4z"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
} as const;

/** A small inline icon (lucide shapes). */
export const icon = (name: keyof typeof ICON, size = 14) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name]}</svg>`;

const STYLE = `
:root { --bg:#f3f2ef; --dot:rgba(0,0,0,.075); --card:#fff; --raised:#fbfaf8; --text:#1c1b19; --muted:#77756f; --faint:#a3a19b; --line:rgba(0,0,0,.08); --line-strong:rgba(0,0,0,.14);
  --accent:#ea6a3c; --accent-soft:rgba(234,106,60,.12); --accent-text:#c2410c; --field:#f3f2ef;
  --shadow:0 1px 2px rgba(0,0,0,.05), 0 8px 24px -12px rgba(0,0,0,.12); --frame-shadow:0 1px 2px rgba(0,0,0,.08), 0 10px 28px -10px rgba(0,0,0,.25);
  --ease:cubic-bezier(.23,1,.32,1); color-scheme: light; }
@media (prefers-color-scheme: dark) { :root { --bg:#151514; --dot:rgba(255,255,255,.06); --card:#1e1e1c; --raised:#232321; --text:#ecebe8; --muted:#9a9892; --faint:#6f6d68; --line:rgba(255,255,255,.09); --line-strong:rgba(255,255,255,.16);
  --accent-soft:rgba(234,106,60,.2); --accent-text:#f59e72; --field:#2a2a28; --shadow:0 1px 2px rgba(0,0,0,.4), 0 10px 30px -12px rgba(0,0,0,.6); --frame-shadow:0 1px 2px rgba(0,0,0,.4), 0 12px 32px -10px rgba(0,0,0,.7); color-scheme: dark; } }
* { box-sizing: border-box; }
html { background:var(--bg); }
body { margin:0; min-height:100dvh; color:var(--text); font:14px/1.5 Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; -webkit-font-smoothing:antialiased;
  background:var(--bg) radial-gradient(var(--dot) 1px, transparent 1px) 0 0/22px 22px; }
a { color:inherit; }
input:focus-visible, button:focus-visible, a:focus-visible { outline:2px solid #3b82f6; outline-offset:2px; }
.brand { display:flex; align-items:center; gap:10px; font-weight:600; letter-spacing:-.01em; text-decoration:none; }
.brand img { height:24px; width:auto; display:block; }
.brand .mark { width:24px; height:24px; border-radius:7px; background:var(--text); color:var(--bg); display:grid; place-items:center; font-size:12px; font-weight:700; }
h1 { font-size:20px; line-height:1.25; margin:0 0 6px; letter-spacing:-.015em; font-weight:620; }
p, label { color:var(--muted); margin:0; display:block; }
form { display:flex; flex-direction:column; gap:12px; margin:0; }
input { font:inherit; font-size:15px; padding:10px 12px; border-radius:10px; border:1px solid var(--line-strong); background:var(--card); color:inherit; transition:border-color .15s ease, box-shadow .15s ease; }
input:focus { outline:none; border-color:var(--accent); box-shadow:0 0 0 3px var(--accent-soft); }
input::placeholder { color:var(--faint); }
button, .button { font:inherit; font-weight:560; padding:10px 14px; border-radius:10px; border:0; background:var(--text); color:var(--bg); cursor:pointer; text-decoration:none;
  display:inline-flex; align-items:center; justify-content:center; gap:7px; transition:transform .12s var(--ease), opacity .15s ease, background-color .15s ease; }
button:hover, .button:hover { opacity:.9; }
button:active, .button:active { transform:scale(.97); }
.err { color:#dc2626; font-size:13.5px; }
.stack { display:flex; flex-direction:column; gap:14px; }
.alt { margin-top:18px; font-size:13.5px; color:var(--muted); }
.alt form { display:inline; }
.link-btn { background:none; color:var(--muted); padding:0; font-weight:450; text-decoration:underline; text-underline-offset:2px; border-radius:4px; }
.link-btn:hover { color:var(--text); opacity:1; }
.dev { font-size:13px; word-break:break-all; padding:10px 12px; border-radius:10px; border:1px dashed var(--line-strong); }
.inline { flex-direction:row; }
.inline input { flex:1; min-width:0; }
.made { color:var(--faint); font-size:12px; text-decoration:none; }
.made:hover { color:var(--muted); }

/* a single card: sign-in, password, messages */
.solo { min-height:100dvh; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:22px; padding:24px 16px; }
.solo .brand { font-size:15px; }
.solo .brand img, .solo .brand .mark { height:30px; width:auto; min-width:30px; border-radius:8px; }
.solo main { width:100%; max-width:400px; background:var(--card); border:1px solid var(--line); border-radius:16px; padding:28px; box-shadow:var(--shadow); animation:rise .35s var(--ease) both; }
.solo main > p:first-of-type, .solo main > div > p:first-child, .solo main label:first-child { margin-bottom:4px; }
@keyframes rise { from { opacity:0; transform:translateY(6px); } }

/* the studio's pages */
.top { position:sticky; top:0; z-index:5; display:flex; align-items:center; gap:18px; height:56px; padding:0 max(16px, calc((100vw - 1128px) / 2));
  background:color-mix(in srgb, var(--bg) 82%, transparent); backdrop-filter:blur(14px); -webkit-backdrop-filter:blur(14px); border-bottom:1px solid var(--line); }
.tabs { display:flex; gap:2px; }
.tabs a { padding:6px 10px; border-radius:8px; text-decoration:none; color:var(--muted); font-weight:500; transition:background-color .15s ease, color .15s ease; }
.tabs a:hover { color:var(--text); background:var(--line); }
.tabs a[aria-current="page"] { color:var(--text); background:var(--card); box-shadow:0 0 0 1px var(--line), 0 1px 2px rgba(0,0,0,.04); }
.me { margin-left:auto; display:flex; align-items:center; gap:10px; color:var(--muted); font-size:13px; min-width:0; }
.me .who { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.avatar { flex:none; width:26px; height:26px; border-radius:50%; display:grid; place-items:center; background:var(--accent); color:#fff; font-size:11.5px; font-weight:650; }
.me form { display:inline; }
.wrap { max-width:1160px; margin:0 auto; padding:28px 16px 64px; }
.head { display:flex; align-items:flex-end; justify-content:space-between; gap:16px; flex-wrap:wrap; margin-bottom:20px; }
.head h1 { font-size:24px; margin:0; display:flex; align-items:baseline; gap:10px; }
.head h1 .n { font-size:14px; font-weight:500; color:var(--faint); font-variant-numeric:tabular-nums; }
.head p { margin-top:4px; max-width:560px; }
.search { position:relative; width:min(280px, 100%); }
.search svg { position:absolute; left:11px; top:50%; transform:translateY(-50%); color:var(--faint); }
.search input { width:100%; padding:8px 12px 8px 33px; font-size:14px; border-color:var(--line); }
.grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(260px, 1fr)); gap:16px; }
.card { position:relative; display:flex; flex-direction:column; background:var(--card); border:1px solid var(--line); border-radius:14px; overflow:hidden; text-decoration:none;
  transition:transform .2s var(--ease), box-shadow .2s var(--ease), border-color .2s ease; }
.card:hover { transform:translateY(-2px); box-shadow:var(--shadow); border-color:var(--line-strong); }
/* the whole card opens the link; buttons and the invite form sit above it */
.title::after { content:""; position:absolute; inset:0; border-radius:14px; }
.title { text-decoration:none; color:inherit; }
.card:hover .title { text-decoration:underline; text-underline-offset:3px; text-decoration-color:var(--line-strong); }
.copy, .invite { position:relative; z-index:1; }
.invite { margin-top:10px; }
.invite summary { list-style:none; display:inline-flex; align-items:center; gap:6px; height:28px; padding:0 10px; border-radius:8px; font-size:12.5px; font-weight:540; color:var(--text);
  box-shadow:inset 0 0 0 1px var(--line-strong); cursor:pointer; user-select:none; transition:background-color .15s ease; }
.invite summary::-webkit-details-marker { display:none; }
.invite summary:hover, .invite[open] summary { background:var(--field); }
.invite form { flex-direction:row; gap:6px; margin-top:8px; }
.invite input { flex:1; min-width:0; font-size:13.5px; padding:7px 10px; }
.invite button { padding:7px 12px; font-size:13px; }
.invite .hint { font-size:12px; margin-top:6px; }
.notice { display:flex; align-items:center; gap:8px; margin-bottom:18px; padding:10px 14px; border-radius:12px; background:var(--card); border:1px solid var(--line); box-shadow:var(--shadow); animation:rise .35s var(--ease) both; }
.notice svg { color:#16a34a; flex:none; }
.card.revoked { opacity:.6; }
.thumb { position:relative; aspect-ratio:16/10; overflow:hidden; border-bottom:1px solid var(--line);
  background:var(--raised) radial-gradient(var(--dot) 1px, transparent 1px) 0 0/14px 14px; }
.thumb img { position:absolute; left:50%; top:16%; width:72%; transform:translateX(-50%); border-radius:3px; box-shadow:var(--frame-shadow); background:#fff;
  transition:transform .35s var(--ease); }
.card:hover .thumb img { transform:translateX(-50%) translateY(-3%); }
.thumb .none { position:absolute; inset:0; display:grid; place-items:center; color:var(--faint); font-size:13px; }
.copy { position:absolute !important; top:10px; right:10px; padding:0; width:30px; height:30px; border-radius:8px; background:var(--card); color:var(--text); box-shadow:0 0 0 1px var(--line), 0 2px 6px rgba(0,0,0,.08);
  opacity:0; transform:translateY(-2px); transition:opacity .15s ease, transform .2s var(--ease); }
.card:hover .copy, .copy:focus-visible { opacity:1; transform:none; }
.copy.done { color:#16a34a; opacity:1; }
.body { padding:12px 14px 14px; display:flex; flex-direction:column; gap:3px; min-width:0; }
.title { font-weight:600; letter-spacing:-.005em; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.sub { color:var(--muted); font-size:12.5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.chips { display:flex; flex-wrap:wrap; gap:6px; margin-top:8px; }
.chip { display:inline-flex; align-items:center; gap:5px; height:22px; padding:0 8px; border-radius:999px; font-size:12px; color:var(--muted); background:var(--field); white-space:nowrap; max-width:100%; overflow:hidden; text-overflow:ellipsis; }
.chip.hot { background:var(--accent-soft); color:var(--accent-text); font-weight:560; }
.chip.off { background:transparent; box-shadow:inset 0 0 0 1px var(--line-strong); }
.empty { display:grid; place-items:center; text-align:center; gap:6px; padding:64px 16px; border:1px dashed var(--line-strong); border-radius:16px; background:color-mix(in srgb, var(--card) 60%, transparent); }
.empty b { color:var(--text); font-weight:600; }
.empty code, .head code { font:12.5px ui-monospace, SFMono-Regular, Menlo, monospace; background:var(--field); padding:2px 6px; border-radius:6px; color:var(--text); }
.panel { background:var(--card); border:1px solid var(--line); border-radius:14px; overflow:hidden; }
.panel-add { padding:14px; border-bottom:1px solid var(--line); background:var(--raised); }
.panel-add .inline button { flex:none; }
.rows { list-style:none; margin:0; padding:0; }
.rows li { display:flex; align-items:center; gap:12px; padding:12px 14px; border-bottom:1px solid var(--line); }
.rows li:last-child { border-bottom:0; }
.rows .grow { flex:1; min-width:0; display:flex; flex-direction:column; }
.rows .grow > span:first-child { font-weight:540; overflow:hidden; text-overflow:ellipsis; }
.ghost { background:transparent; color:var(--muted); padding:6px 10px; font-weight:500; }
.ghost:hover { background:var(--line); color:#dc2626; opacity:1; }
.hidden { display:none !important; }
@media (max-width: 640px) {
  .top { gap:10px; }
  .top .brand > span:last-child { display:none; }
  .me .who { display:none; }
  .head h1 { font-size:21px; }
  .search { width:100%; }
  .grid { grid-template-columns:1fr; }
  .copy { opacity:1; transform:none; }
}
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation:none !important; transition:none !important; } }
`;

const brandHtml = (env: ReviewEnv, href?: string) => {
  const b = brand(env);
  const inner = `${b.logo ? `<img alt="" src="${esc(b.logo)}">` : `<span class="mark">${esc(b.name.slice(0, 1).toUpperCase())}</span>`}<span>${esc(b.name)}</span>`;
  return href ? `<a class="brand" href="${href}">${inner}</a>` : `<div class="brand">${inner}</div>`;
};

/**
 * A branded page. On its own, a centered card (errors, the password and
 * sign-in forms, the live site's gate). With `app`, the studio's pages
 * (links, members): a top bar and a wide area. `body` is HTML when it starts
 * with a tag, plain text otherwise.
 */
export function page(env: ReviewEnv, title: string, body: string, status = 200, headers: HeadersInit = {}, opts: { app?: AppNav; head?: string } = {}) {
  const b = brand(env);
  const content = body.startsWith("<") ? body : `<p>${body}</p>`;
  const signOut = (next: string) =>
    `<form method="post" action="/signout"><input type="hidden" name="next" value="${esc(next)}"><button class="link-btn" type="submit">Sign out</button></form>`;
  const main = opts.app
    ? `<header class="top">${brandHtml(env, "/links")}<nav class="tabs"><a href="/links"${opts.app.active === "links" ? ' aria-current="page"' : ""}>Links</a><a href="/members"${opts.app.active === "members" ? ' aria-current="page"' : ""}>Members</a></nav>
<div class="me"><span class="avatar" aria-hidden="true">${esc(opts.app.email.slice(0, 1).toUpperCase())}</span><span class="who">${esc(opts.app.email)}</span>${signOut("/signin")}</div></header>
<div class="wrap">${content}</div>`
    : `<div class="solo">${brandHtml(env)}<main><h1>${title}</h1>${content}</main><a class="made" href="https://truecanvas.dev" target="_blank" rel="noopener">Made with Truecanvas</a></div>`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">${b.logo ? `<link rel="icon" href="${esc(b.logo)}">` : ""}<title>${title} · ${esc(b.name)}</title>
<style>${STYLE}</style>${opts.head ?? ""}</head><body>${main}</body></html>`;
  const h = new Headers(headers);
  h.set("content-type", "text/html; charset=utf-8");
  h.set("cache-control", "no-store");
  h.set("x-robots-tag", NOINDEX["x-robots-tag"]);
  return new Response(html, { status, headers: h });
}

/** State-changing forms only count when they come from this site. */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  return !!origin && origin === new URL(req.url).origin;
}

/** A path on this site to come back to after signing in (never another site). */
export function safeNext(next: string | null | undefined, fallback = "/links"): string {
  return next && /^\/(?![/\\])[^\s]*$/.test(next) ? next : fallback;
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
