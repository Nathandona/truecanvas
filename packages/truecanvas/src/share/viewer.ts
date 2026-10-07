/**
 * The share viewer: one static page that reads ./manifest.json and lays the
 * frozen frames out at their canvas positions, with pan and zoom (drag,
 * wheel, pinch, keys). Frames are sandboxed iframes without scripts, under a
 * transparent layer that takes every pointer event. When the version has a
 * live site, each frame gets a "View live" button: the real site in a
 * device-sized window, scripts and animations included, on its own origin.
 * Self-contained: no
 * build step, no dependencies, so the same file works locally and on a
 * review site.
 */
export function viewerHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>Design review</title>
<style>
:root {
  --bg: #f3f2ef; --dot: rgba(0,0,0,.07); --panel: rgba(255,255,255,.86); --line: rgba(0,0,0,.08);
  --text: #1c1b19; --muted: #77756f; --frame-shadow: 0 1px 2px rgba(0,0,0,.06), 0 12px 40px -12px rgba(0,0,0,.18);
  --ease-out: cubic-bezier(.23,1,.32,1); --panel-solid: #fff; --field: #f3f2ef; --accent: #ea6a3c; --accent-soft: rgba(234,106,60,.12);
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #151514; --dot: rgba(255,255,255,.06); --panel: rgba(30,30,28,.86); --line: rgba(255,255,255,.09);
    --text: #ecebe8; --muted: #9a9892; --frame-shadow: 0 1px 2px rgba(0,0,0,.4), 0 16px 48px -12px rgba(0,0,0,.6); color-scheme: dark;
    --panel-solid: #1e1e1c; --field: #2a2a28; --accent-soft: rgba(234,106,60,.2); }
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
html, body { margin: 0; height: 100%; overflow: hidden; background: var(--bg); color: var(--text);
  font: 13px/1.4 Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; -webkit-font-smoothing: antialiased; }
#stage { position: fixed; inset: 0; cursor: grab; touch-action: none;
  background-image: radial-gradient(var(--dot) 1px, transparent 1px); background-size: 22px 22px; }
#stage.panning { cursor: grabbing; }
#world { position: absolute; left: 0; top: 0; transform-origin: 0 0; will-change: transform; }
.frame { position: absolute; }
.frame-label { position: absolute; left: 0; bottom: 100%; padding-bottom: 6px; white-space: nowrap; color: var(--muted);
  font-size: 12px; transform-origin: 0 100%; }
.frame-label b { color: var(--text); font-weight: 550; margin-right: 6px; }
.frame-box { position: relative; overflow: hidden; border-radius: 2px; background: #fff; box-shadow: var(--frame-shadow); }
.frame-box img, .frame-box iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; display: block; }
.frame-box iframe { opacity: 0; transition: opacity .25s var(--ease-out); pointer-events: none; }
.frame-box iframe.ready { opacity: 1; }
header { position: fixed; top: 12px; left: 12px; right: 12px; display: flex; align-items: center; justify-content: space-between; gap: 12px; pointer-events: none; }
.pill { pointer-events: auto; display: flex; align-items: center; gap: 10px; height: 40px; padding: 0 14px; border-radius: 12px;
  background: var(--panel); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); border: 1px solid var(--line); box-shadow: 0 1px 2px rgba(0,0,0,.05); }
.brand img { height: 20px; width: auto; display: block; }
.brand span { font-weight: 600; letter-spacing: -.01em; }
.title { font-weight: 550; }
.meta { color: var(--muted); }
.vselect { gap: 4px; color: var(--muted); padding: 0 6px 0 8px; margin-right: -6px; max-width: 46vw; }
.vselect .vlabel { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vselect[aria-expanded="true"] { background: var(--line); color: var(--text); }
.vlist { position: fixed; z-index: 40; max-height: 320px; overflow: auto; padding: 4px; border-radius: 10px; background: var(--panel-solid);
  border: 1px solid var(--line); box-shadow: 0 12px 36px -10px rgba(0,0,0,.28); animation: pop-in .12s var(--ease-out); }
.vopt { display: flex; align-items: center; gap: 6px; height: 30px; padding: 0 12px 0 4px; border-radius: 6px; cursor: default; white-space: nowrap; }
.vopt.active { background: var(--accent); color: #fff; }
.vopt .vcheck { width: 18px; display: inline-grid; place-items: center; flex: none; }
.vopt .vname { flex: 1; font-weight: 500; }
.vopt .vhint { margin-left: 18px; color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; }
.vopt.active .vhint { color: rgba(255,255,255,.8); }
.sep { width: 1px; height: 16px; background: var(--line); }
footer { position: fixed; bottom: 14px; left: 50%; transform: translateX(-50%); }
footer .pill { padding: 0 6px; gap: 2px; }
button { all: unset; display: inline-flex; align-items: center; justify-content: center; min-width: 30px; height: 30px; padding: 0 8px;
  border-radius: 8px; cursor: pointer; color: var(--text); font-variant-numeric: tabular-nums; transition: background-color .15s ease, transform .12s var(--ease-out); }
button:hover { background: var(--line); }
button:active { transform: scale(.96); }
button:focus-visible { outline: 2px solid #3b82f6; outline-offset: 1px; }
#zoom { min-width: 56px; }
.made { position: fixed; right: 14px; bottom: 18px; color: var(--muted); font-size: 11.5px; text-decoration: none; }
.made:hover { color: var(--text); }
#empty { position: fixed; inset: 0; display: grid; place-items: center; color: var(--muted); }
/* comments */
#stage.commenting { cursor: crosshair; }
.pin { position: absolute; width: 0; height: 0; transform-origin: 0 0; z-index: 2; }
.pin button { position: absolute; left: 0; bottom: 0; min-width: 30px; height: 30px; padding: 0 9px; border-radius: 15px 15px 15px 3px;
  background: var(--accent); color: #fff; font-weight: 600; font-size: 12.5px; box-shadow: 0 0 0 2px #fff, 0 4px 14px -4px rgba(0,0,0,.4);
  transition: transform .15s var(--ease-out); }
.pin button:hover { background: var(--accent); transform: scale(1.06); }
.pin.done button { background: #8b8a85; }
.pin.on button { box-shadow: 0 0 0 2px #fff, 0 0 0 4px var(--accent), 0 6px 18px -4px rgba(0,0,0,.45); }
.pin.draft button { background: var(--text); }
#pop { position: fixed; z-index: 20; width: 320px; max-height: min(460px, calc(100dvh - 120px)); display: flex; flex-direction: column;
  background: var(--panel-solid); border: 1px solid var(--line); border-radius: 14px; box-shadow: 0 18px 50px -12px rgba(0,0,0,.35); overflow: hidden;
  animation: pop-in .16s var(--ease-out); }
@keyframes pop-in { from { opacity: 0; transform: translateY(4px) scale(.98); } }
#pop[hidden], #panel[hidden] { display: none; }
.pop-head { display: flex; align-items: center; gap: 8px; padding: 10px 10px 8px 14px; border-bottom: 1px solid var(--line); font-weight: 550; }
.pop-head span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pop-msgs { overflow-y: auto; padding: 4px 14px; }
.msg { padding: 10px 0; border-bottom: 1px solid var(--line); }
.msg:last-child { border-bottom: 0; }
.msg-who { display: flex; align-items: baseline; gap: 6px; margin-bottom: 3px; }
.msg-who b { font-weight: 600; }
.msg-who small { color: var(--muted); }
.badge { font-size: 10.5px; font-weight: 600; padding: 1px 6px; border-radius: 6px; background: var(--accent-soft); color: var(--accent); }
.msg p { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.resolved-note { color: var(--muted); font-size: 12px; padding: 8px 14px 0; }
.compose { display: flex; flex-direction: column; gap: 8px; padding: 10px 14px 12px; }
.compose input, .compose textarea { font: inherit; color: var(--text); background: var(--field); border: 1px solid transparent; border-radius: 9px; padding: 8px 10px; resize: none; width: 100%; }
.compose input:focus, .compose textarea:focus { outline: none; border-color: var(--accent); }
.compose-actions { display: flex; justify-content: flex-end; gap: 6px; align-items: center; }
.compose-actions .hint { margin-right: auto; color: var(--muted); font-size: 11.5px; }
.btn-primary { background: var(--accent); color: #fff; font-weight: 550; padding: 0 12px; }
.btn-primary:hover { background: var(--accent); filter: brightness(1.06); }
.btn-primary[disabled] { opacity: .5; pointer-events: none; }
#comment.on { background: var(--accent); color: #fff; }
#comment svg, #list svg { display: block; }
.count { margin-left: 5px; font-size: 11.5px; color: var(--muted); font-variant-numeric: tabular-nums; }
#panel { position: fixed; z-index: 15; top: 62px; right: 12px; bottom: 70px; width: 320px; display: flex; flex-direction: column;
  background: var(--panel-solid); border: 1px solid var(--line); border-radius: 14px; box-shadow: 0 18px 50px -16px rgba(0,0,0,.3); overflow: hidden; }
.panel-head { display: flex; align-items: center; padding: 10px 10px 10px 14px; border-bottom: 1px solid var(--line); font-weight: 600; }
.panel-head span { flex: 1; }
.panel-list { overflow-y: auto; flex: 1; }
.item { all: unset; box-sizing: border-box; display: flex; gap: 10px; width: 100%; padding: 12px 14px; border-bottom: 1px solid var(--line); cursor: pointer; }
.item:hover { background: var(--line); }
.item:focus-visible { outline: 2px solid #3b82f6; outline-offset: -2px; }
.item .num { flex: none; width: 22px; height: 22px; border-radius: 11px 11px 11px 3px; background: var(--accent); color: #fff; font-size: 11px; font-weight: 600; display: grid; place-items: center; }
.item.done .num { background: #8b8a85; }
.item div { min-width: 0; }
.item p { margin: 2px 0 0; color: var(--muted); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.item small { color: var(--muted); }
.empty-list { padding: 24px 16px; color: var(--muted); text-align: center; }
.toast { position: fixed; left: 50%; bottom: 74px; transform: translateX(-50%); z-index: 30; padding: 8px 14px; border-radius: 10px; background: var(--text); color: var(--bg); font-size: 12.5px; }
@media (max-width: 640px) {
  .meta, .sep, .made, .vdate { display: none; } header { top: 8px; left: 8px; right: 8px; gap: 8px; }
  .brand:has(img) span { display: none; }
  header .pill { min-width: 0; padding: 0 10px; }
  header .pill:last-child { flex: 1 1 auto; justify-content: flex-end; }
  .title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #pop { left: 8px !important; right: 8px; top: auto !important; bottom: 8px; width: auto; max-height: 60dvh; }
  #panel { left: 8px; right: 8px; top: 56px; bottom: 68px; width: auto; }
}
/* live site */
.live-btn { height: 22px; min-width: 0; margin-left: 8px; padding: 0 8px 0 6px; gap: 4px; border-radius: 6px; vertical-align: middle;
  background: var(--accent-soft); color: var(--accent); font-size: 11.5px; font-weight: 600; }
.live-btn:hover { background: var(--accent); color: #fff; }
#live { position: fixed; inset: 0; z-index: 50; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 16px;
  background: rgba(12,12,11,.6); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); animation: fade-in .16s var(--ease-out); }
@keyframes fade-in { from { opacity: 0; } }
.live-bar { display: flex; align-items: center; gap: 10px; max-width: 100%; height: 40px; padding: 0 6px 0 14px; border-radius: 12px;
  background: var(--panel-solid); border: 1px solid var(--line); box-shadow: 0 8px 28px -10px rgba(0,0,0,.35); }
.live-bar b { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.live-bar a { color: var(--text); white-space: nowrap; text-decoration: none; padding: 0 8px; height: 30px; display: inline-flex; align-items: center; border-radius: 8px; }
.live-bar a:hover { background: var(--line); }
.live-device { position: relative; overflow: hidden; border-radius: 10px; background: #fff; box-shadow: 0 30px 80px -20px rgba(0,0,0,.6); animation: pop-in .2s var(--ease-out); }
.live-device iframe { position: absolute; left: 0; top: 0; border: 0; transform-origin: 0 0; background: #fff; }
@media (max-width: 640px) { .live-bar .meta { display: none; } }
@media (prefers-reduced-motion: reduce) { .frame-box iframe { transition: none; } #live, .live-device { animation: none; } }
</style>
</head>
<body>
<div id="stage" aria-label="Design canvas"><div id="world"></div></div>
<header>
  <div class="pill brand" id="brand"><span>Design review</span></div>
  <div class="pill"><span class="title" id="title"></span><span class="sep"></span><span class="meta" id="meta"></span><button id="list" hidden aria-label="Comments" title="Comments"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16v11H9l-5 4z"/></svg><span class="count" id="count">0</span></button></div>
</header>
<aside id="panel" hidden aria-label="Comments"><div class="panel-head"><span>Comments</span><button id="panel-close" aria-label="Close">✕</button></div><div class="panel-list" id="panel-list"></div></aside>
<div id="pop" hidden role="dialog" aria-label="Comment"></div>
<div id="live" hidden role="dialog" aria-modal="true" aria-label="Live site">
  <div class="live-bar"><b id="live-name"></b><span class="meta" id="live-size"></span><a id="live-tab" target="_blank" rel="noopener">Open in a new tab</a><button id="live-close" aria-label="Close live site" title="Close (Esc)">✕</button></div>
  <div class="live-device" id="live-device"></div>
</div>
<footer><div class="pill">
  <button id="out" aria-label="Zoom out" title="Zoom out (-)">−</button>
  <button id="zoom" aria-label="Zoom to fit" title="Zoom to fit (1)">100%</button>
  <button id="in" aria-label="Zoom in" title="Zoom in (+)">+</button>
  <span class="sep" id="comment-sep" hidden></span>
  <button id="comment" hidden aria-pressed="false" title="Comment (C)"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16v11H9l-5 4z"/><path d="M12 8v5M9.5 10.5h5"/></svg><span style="margin-left:6px">Comment</span></button>
</div></footer>
<a class="made" href="https://truecanvas.dev" target="_blank" rel="noopener">Made with Truecanvas</a>
<script>
(async () => {
  const stage = document.getElementById("stage");
  const world = document.getElementById("world");
  const zoomLabel = document.getElementById("zoom");
  let manifest;
  try {
    manifest = await (await fetch("manifest.json" + location.search, { cache: "no-store" })).json();
  } catch {
    document.body.insertAdjacentHTML("beforeend", '<div id="empty">This review link has no designs yet.</div>');
    return;
  }
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  document.title = manifest.canvas + " · Design review";
  document.getElementById("title").textContent = manifest.title || manifest.canvas;
  const day = (t) => new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  const time = (t) => new Date(t).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const meta = document.getElementById("meta");
  if (manifest.versions && manifest.versions.length > 1) versionPicker(meta);
  else meta.textContent = day(manifest.createdAt);

  /** Versions: the latest by default, earlier ones a pick away. A listbox like the editor's selects. */
  function versionPicker(slot) {
    const vs = manifest.versions;
    const label = (v, i) => (v.latest ? "Latest" : "Version " + (vs.length - i));
    const currentIndex = Math.max(0, vs.findIndex((v) => v.id === manifest.id));
    const trigger = document.createElement("button");
    trigger.className = "vselect";
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-label", "Version");
    trigger.innerHTML = '<span class="vlabel"></span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
    trigger.querySelector(".vlabel").textContent = label(vs[currentIndex], currentIndex);
    const date = document.createElement("span");
    date.className = "vdate";
    date.textContent = " · " + day(vs[currentIndex].createdAt);
    trigger.querySelector(".vlabel").appendChild(date);
    slot.replaceWith(trigger);
    let list = null, active = currentIndex;
    const choose = (i) => {
      close();
      if (i === currentIndex) return;
      location.search = i === 0 ? "" : "?v=" + vs[i].id;
    };
    const paint = () => list && list.querySelectorAll(".vopt").forEach((o, i) => o.classList.toggle("active", i === active));
    const close = (focus) => {
      if (!list) return;
      list.remove();
      list = null;
      trigger.setAttribute("aria-expanded", "false");
      removeEventListener("pointerdown", outside, true);
      if (focus) trigger.focus();
    };
    const outside = (e) => { if (list && !list.contains(e.target) && !trigger.contains(e.target)) close(false); };
    const open = () => {
      list = document.createElement("div");
      list.className = "vlist";
      list.setAttribute("role", "listbox");
      list.setAttribute("aria-label", "Version");
      vs.forEach((v, i) => {
        const o = document.createElement("div");
        o.className = "vopt";
        o.setAttribute("role", "option");
        o.setAttribute("aria-selected", String(i === currentIndex));
        o.innerHTML = '<span class="vcheck">' + (i === currentIndex ? '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>' : "") + '</span><span class="vname"></span><span class="vhint"></span>';
        o.querySelector(".vname").textContent = label(v, i);
        o.querySelector(".vhint").textContent = day(v.createdAt) + ", " + time(v.createdAt);
        o.onpointerenter = () => { active = i; paint(); };
        o.onpointerdown = (e) => e.preventDefault();
        o.onclick = () => choose(i);
        list.appendChild(o);
      });
      document.body.appendChild(list);
      const r = trigger.getBoundingClientRect();
      const h = list.offsetHeight, w = Math.max(list.offsetWidth, r.width);
      const up = r.bottom + h + 8 > innerHeight && r.top > h;
      list.style.minWidth = w + "px";
      list.style.left = Math.max(8, Math.min(r.right - w, innerWidth - w - 8)) + "px";
      list.style.top = (up ? r.top - h - 4 : r.bottom + 4) + "px";
      active = currentIndex;
      paint();
      trigger.setAttribute("aria-expanded", "true");
      addEventListener("pointerdown", outside, true);
    };
    trigger.onclick = () => (list ? close(true) : open());
    trigger.onkeydown = (e) => {
      e.stopPropagation();
      if (!list) {
        if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) { e.preventDefault(); open(); }
        return;
      }
      if (e.key === "ArrowDown") { e.preventDefault(); active = Math.min(vs.length - 1, active + 1); paint(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); active = Math.max(0, active - 1); paint(); }
      else if (e.key === "Home") { e.preventDefault(); active = 0; paint(); }
      else if (e.key === "End") { e.preventDefault(); active = vs.length - 1; paint(); }
      else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(active); }
      else if (e.key === "Escape" || e.key === "Tab") close(e.key === "Escape");
    };
    addEventListener("resize", () => close(false));
  }
  if (manifest.brand) {
    document.getElementById("brand").innerHTML = (manifest.brand.logo ? '<img alt="" src="' + esc(manifest.brand.logo) + '">' : "") + (manifest.brand.name ? "<span>" + esc(manifest.brand.name) + "</span>" : "");
  }

  // layout: frames at their canvas positions
  const frames = manifest.frames;
  const minX = Math.min(...frames.map((f) => f.x)), minY = Math.min(...frames.map((f) => f.y));
  const maxX = Math.max(...frames.map((f) => f.x + f.width)), maxY = Math.max(...frames.map((f) => f.y + f.height));
  const labels = [];
  for (const f of frames) {
    const el = document.createElement("div");
    el.className = "frame";
    el.style.cssText = "left:" + (f.x - minX) + "px;top:" + (f.y - minY) + "px;width:" + f.width + "px;height:" + f.height + "px";
    el.innerHTML = '<div class="frame-label"><b>' + esc(f.name) + "</b>" + f.width + " × " + Math.round(f.height) + (manifest.live ? '<button class="live-btn" title="Open the live site at this width"><svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l13-7.5z"/></svg>View live</button>' : "") + "</div>" +
      '<div class="frame-box" style="width:' + f.width + "px;height:" + f.height + 'px"><img alt="" src="' + esc(f.image) + '"><iframe sandbox title="' + esc(f.name) + '" scrolling="no" loading="lazy" src="' + esc(f.html) + '"></iframe></div>';
    const iframe = el.querySelector("iframe");
    iframe.addEventListener("load", () => iframe.classList.add("ready"));
    const liveBtn = el.querySelector(".live-btn");
    if (liveBtn) liveBtn.onclick = (e) => { e.stopPropagation(); openLive(f); };
    el.dataset.name = f.name;
    world.appendChild(el);
    labels.push(el.querySelector(".frame-label"));
  }
  const bounds = { w: maxX - minX, h: maxY - minY };

  // camera
  let x = 0, y = 0, z = 1;
  const MIN = 0.02, MAX = 4;
  const apply = () => {
    world.style.transform = "translate(" + x + "px," + y + "px) scale(" + z + ")";
    zoomLabel.textContent = Math.round(z * 100) + "%";
    // labels keep a readable size at any zoom
    for (const l of labels) l.style.transform = "scale(" + 1 / z + ")";
    for (const p of world.querySelectorAll(".pin")) p.style.transform = "scale(" + 1 / z + ")";
    if (typeof placePop === "function") placePop();
  };
  const zoomAt = (nz, cx, cy) => {
    nz = Math.min(MAX, Math.max(MIN, nz));
    x = cx - ((cx - x) * nz) / z;
    y = cy - ((cy - y) * nz) / z;
    z = nz;
    apply();
  };
  const side = () => (innerWidth < 640 ? 12 : 72);
  const top = 88;
  // everything in view
  const fit = (box = { x: 0, y: 0, w: bounds.w, h: bounds.h }) => {
    const vw = innerWidth - side() * 2, vh = innerHeight - top - 72;
    z = Math.min(MAX, Math.max(MIN, Math.min(vw / box.w, vh / box.h, 1)));
    x = (innerWidth - box.w * z) / 2 - box.x * z;
    y = top + Math.max(0, (vh - box.h * z) / 2) - box.y * z;
    apply();
  };
  // readable: as wide as the screen allows, from the top (long pages scroll down)
  const fitWidth = (box = { x: 0, y: 0, w: bounds.w, h: bounds.h }) => {
    z = Math.min(1, Math.max(MIN, (innerWidth - side() * 2) / box.w));
    x = (innerWidth - box.w * z) / 2 - box.x * z;
    y = top - box.y * z;
    apply();
  };
  const tall = () => bounds.h * Math.min(1, (innerWidth - side() * 2) / bounds.w) > (innerHeight - top) * 1.5;
  if (tall()) fitWidth();
  else fit();

  // wheel: pinch or ctrl/cmd zooms, otherwise pans
  stage.addEventListener("wheel", (e) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) zoomAt(z * Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY);
    else { x -= e.deltaX; y -= e.deltaY; apply(); }
  }, { passive: false });

  // drag to pan, two fingers to pinch
  const pointers = new Map();
  let pinch = null;
  let moved = false, downAt = null;
  stage.addEventListener("pointerdown", (e) => {
    // pins and View live are buttons: they take their own clicks
    if (e.target.closest && e.target.closest(".pin, .live-btn")) return;
    stage.setPointerCapture(e.pointerId);
    moved = false;
    downAt = { x: e.clientX, y: e.clientY };
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    stage.classList.add("panning");
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z };
    }
  });
  stage.addEventListener("pointermove", (e) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const now = { x: e.clientX, y: e.clientY };
    pointers.set(e.pointerId, now);
    if (downAt && Math.hypot(now.x - downAt.x, now.y - downAt.y) > 4) moved = true;
    if (pointers.size === 2 && pinch) {
      const [a, b] = [...pointers.values()];
      zoomAt(pinch.z * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.d), (a.x + b.x) / 2, (a.y + b.y) / 2);
    } else if (pointers.size === 1) { x += now.x - prev.x; y += now.y - prev.y; apply(); }
  });
  const end = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (!pointers.size) stage.classList.remove("panning");
  };
  stage.addEventListener("pointerup", end);
  stage.addEventListener("pointercancel", end);

  // double click (or double tap) a frame: read it at full width; elsewhere: everything in view
  let lastTap = 0;
  const zoomToFrameAt = (cx, cy) => {
    const wx = (cx - x) / z, wy = (cy - y) / z;
    const f = frames.find((f) => wx >= f.x - minX && wx <= f.x - minX + f.width && wy >= f.y - minY && wy <= f.y - minY + f.height);
    if (!f) return fit();
    const box = { x: f.x - minX, y: f.y - minY, w: f.width, h: f.height };
    // keep the part that was double clicked in view
    const keepY = wy;
    fitWidth(box);
    y = cy - keepY * z;
    apply();
  };
  stage.addEventListener("pointerup", (e) => {
    if (moved || !downAt) return;
    downAt = null;
    // comment mode: a tap on a frame starts a comment there
    if (commenting) return startComment(e.clientX, e.clientY);
    const now = Date.now();
    if (now - lastTap < 320) { zoomToFrameAt(e.clientX, e.clientY); lastTap = 0; }
    else lastTap = now;
  });

  const center = () => [innerWidth / 2, innerHeight / 2];
  document.getElementById("in").onclick = () => zoomAt(z * 1.25, ...center());
  document.getElementById("out").onclick = () => zoomAt(z / 1.25, ...center());
  zoomLabel.onclick = () => (tall() ? fitWidth() : fit());
  addEventListener("keydown", (e) => {
    if (liveOpen()) { if (e.key === "Escape") closeLive(); return; }
    if (e.target.closest && e.target.closest("input, textarea, select")) return;
    if (e.key === "Escape") { closePop(); setCommenting(false); return; }
    if ((e.key === "c" || e.key === "C") && canComment && !e.metaKey && !e.ctrlKey) { setCommenting(!commenting); return; }
    if (e.key === "+" || e.key === "=") zoomAt(z * 1.25, ...center());
    else if (e.key === "-") zoomAt(z / 1.25, ...center());
    else if (e.key === "0") zoomAt(1, ...center());
    else if (e.key === "1") fit();
    else if (e.key === "2") fitWidth();
  });
  addEventListener("resize", apply);

  // ---------- live site: the real thing, at the frame's width ----------
  const liveBox = document.getElementById("live");
  const liveDevice = document.getElementById("live-device");
  let liveFrame = null, liveReturn = null;
  const liveOpen = () => !liveBox.hidden;
  // a realistic screen for the width: desktop, tablet or phone
  const viewportHeight = (w) => (w >= 1024 ? 900 : w > 500 ? 1024 : 844);
  function sizeLive() {
    if (!liveFrame) return;
    const w = liveFrame.width, h = viewportHeight(w);
    const s = Math.min(1, (innerWidth - 32) / w, (innerHeight - 32 - 50) / h);
    liveDevice.style.width = Math.round(w * s) + "px";
    liveDevice.style.height = Math.round(h * s) + "px";
    const iframe = liveDevice.querySelector("iframe");
    iframe.style.width = w + "px";
    iframe.style.height = h + "px";
    iframe.style.transform = s < 1 ? "scale(" + s + ")" : "";
    document.getElementById("live-size").textContent = w + " × " + h + (s < 1 ? " · " + Math.round(s * 100) + "%" : "");
  }
  function openLive(f) {
    liveFrame = f;
    liveReturn = document.activeElement;
    liveDevice.textContent = "";
    // its own origin: scripts run there, never on the review site
    const iframe = document.createElement("iframe");
    iframe.title = "Live site: " + f.name;
    iframe.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox");
    iframe.setAttribute("referrerpolicy", "no-referrer");
    iframe.src = manifest.live.url;
    liveDevice.appendChild(iframe);
    document.getElementById("live-name").textContent = f.name;
    document.getElementById("live-tab").href = manifest.live.url;
    liveBox.hidden = false;
    sizeLive();
    document.getElementById("live-close").focus();
  }
  function closeLive() {
    liveBox.hidden = true;
    liveDevice.textContent = "";
    liveFrame = null;
    if (liveReturn && liveReturn.focus) liveReturn.focus();
  }
  document.getElementById("live-close").onclick = closeLive;
  // a click on the backdrop closes it too
  liveBox.addEventListener("click", (e) => { if (e.target === liveBox) closeLive(); });
  addEventListener("resize", sizeLive);

  // ---------- comments (on a review site: the manifest says so) ----------
  var canComment = !!manifest.comments;
  var commenting = false;
  var threads = [];
  var openId = null;
  var draft = null;
  var popAnchor = null;
  var pop = document.getElementById("pop");
  const studioName = (manifest.brand && manifest.brand.name) || "Studio";
  const storedName = () => { try { return localStorage.getItem("tc-review-name") || ""; } catch { return ""; } };
  const saveName = (n) => { try { localStorage.setItem("tc-review-name", n); } catch {} };
  const ago = (t) => {
    const s = Math.round((Date.now() - t) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return Math.round(s / 60) + " min ago";
    if (s < 86400) return Math.round(s / 3600) + " h ago";
    return day(t);
  };
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const toast = (text) => { const t = el("div", "toast", text); t.setAttribute("role", "status"); document.body.appendChild(t); setTimeout(() => t.remove(), 2600); };
  const frameAt = (cx, cy) => {
    const wx = (cx - x) / z, wy = (cy - y) / z;
    const f = frames.find((f) => wx >= f.x - minX && wx <= f.x - minX + f.width && wy >= f.y - minY && wy <= f.y - minY + f.height);
    return f ? { f, fx: wx - (f.x - minX), fy: wy - (f.y - minY) } : null;
  };
  const frameOf = (name) => frames.find((f) => f.name === name);
  const numberOf = (t) => threads.indexOf(t) + 1;

  function setCommenting(on) {
    if (!canComment) return;
    commenting = on;
    stage.classList.toggle("commenting", on);
    const b = document.getElementById("comment");
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", String(on));
    if (on) toast("Click anywhere on the design to comment");
  }

  function renderPins() {
    for (const p of world.querySelectorAll(".pin")) p.remove();
    const list = draft ? threads.concat([draft]) : threads;
    for (const t of list) {
      const f = frameOf(t.frame);
      if (!f) continue;
      const pin = el("div", "pin" + (t.resolved ? " done" : "") + (t.id === openId ? " on" : "") + (t === draft ? " draft" : ""));
      pin.style.left = f.x - minX + t.x + "px";
      pin.style.top = f.y - minY + t.y + "px";
      pin.style.transform = "scale(" + 1 / z + ")";
      const b = el("button", null, t === draft ? "+" : String(numberOf(t)));
      b.setAttribute("aria-label", t === draft ? "New comment" : "Comment " + numberOf(t) + " by " + t.messages[0].author.name);
      if (t !== draft) b.onclick = (e) => { e.stopPropagation(); openThread(t.id); };
      pin.appendChild(b);
      world.appendChild(pin);
    }
    const open = threads.filter((t) => !t.resolved).length;
    document.getElementById("count").textContent = String(open);
    renderPanel();
  }

  function renderPanel() {
    const list = document.getElementById("panel-list");
    list.textContent = "";
    if (!threads.length) { list.appendChild(el("div", "empty-list", "No comments yet. Press Comment, then click on the design.")); return; }
    const sorted = threads.slice().sort((a, b) => Number(a.resolved) - Number(b.resolved) || b.updatedAt - a.updatedAt);
    for (const t of sorted) {
      const item = el("button", "item" + (t.resolved ? " done" : ""));
      item.appendChild(el("span", "num", String(numberOf(t))));
      const body = el("div");
      const first = t.messages[0];
      const who = el("div");
      who.appendChild(el("b", null, first.author.name));
      who.appendChild(el("small", null, "  " + ago(t.updatedAt) + (t.messages.length > 1 ? " · " + (t.messages.length - 1) + (t.messages.length === 2 ? " reply" : " replies") : "") + (t.resolved ? " · resolved" : "")));
      body.appendChild(who);
      body.appendChild(el("p", null, first.text));
      item.appendChild(body);
      item.onclick = () => { focusThread(t); if (innerWidth < 640) document.getElementById("panel").hidden = true; };
      list.appendChild(item);
    }
  }

  function focusThread(t) {
    const f = frameOf(t.frame);
    if (!f) return;
    if (z < 0.35) z = Math.min(1, (innerWidth - side() * 2) / f.width);
    const px = f.x - minX + t.x, py = f.y - minY + t.y;
    x = innerWidth / 2 - px * z - (innerWidth >= 640 && !document.getElementById("panel").hidden ? 160 : 0);
    // phones: the thread opens as a bottom sheet, so the pin goes in the top part
    y = (innerWidth < 640 ? innerHeight * 0.22 : innerHeight / 2) - py * z;
    apply();
    openThread(t.id);
  }

  function closePop() {
    pop.hidden = true;
    pop.textContent = "";
    openId = null;
    popAnchor = null;
    if (draft) draft = null;
    renderPins();
  }

  function placePop() {
    if (!pop || pop.hidden || !popAnchor) return;
    if (innerWidth < 640) return; // a bottom sheet on phones
    const f = frameOf(popAnchor.frame);
    if (!f) return;
    const sx = x + (f.x - minX + popAnchor.x) * z, sy = y + (f.y - minY + popAnchor.y) * z;
    const w = pop.offsetWidth, h = pop.offsetHeight;
    // beside the pin (which rises up and to the right of its point), never over it
    let left = sx + 56, topPx = sy - 40;
    if (left + w > innerWidth - 12) left = sx - w - 12;
    pop.style.left = Math.max(12, left) + "px";
    pop.style.top = Math.min(Math.max(64, topPx), innerHeight - h - 12) + "px";
  }

  function composer(placeholder, onPost) {
    const box = el("form", "compose");
    let nameInput = null;
    if (!storedName()) {
      nameInput = el("input");
      nameInput.placeholder = "Your name";
      nameInput.autocomplete = "name";
      nameInput.maxLength = 60;
      nameInput.setAttribute("aria-label", "Your name");
      box.appendChild(nameInput);
    }
    const text = el("textarea");
    text.rows = 3;
    text.placeholder = placeholder;
    text.maxLength = 4000;
    text.setAttribute("aria-label", placeholder);
    box.appendChild(text);
    const actions = el("div", "compose-actions");
    actions.appendChild(el("span", "hint", "⌘/Ctrl + Enter"));
    const post = el("button", "btn-primary", "Post");
    post.type = "submit";
    actions.appendChild(post);
    box.appendChild(actions);
    const valid = () => text.value.trim() && (!nameInput || nameInput.value.trim());
    const sync = () => { post.disabled = !valid(); };
    sync();
    box.oninput = sync;
    text.onkeydown = (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); box.requestSubmit(); } if (e.key === "Escape") closePop(); };
    box.onsubmit = async (e) => {
      e.preventDefault();
      if (!valid()) return;
      if (nameInput) saveName(nameInput.value.trim());
      post.disabled = true;
      post.textContent = "Posting…";
      try {
        await onPost(text.value.trim(), storedName());
      } catch (err) {
        toast(err.message || "Couldn't post. Try again.");
        post.textContent = "Post";
        sync();
      }
    };
    setTimeout(() => (nameInput || text).focus(), 30);
    return box;
  }

  async function send(path, body) {
    const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Couldn't post. Try again.");
    return data;
  }

  function startComment(cx, cy) {
    const hit = frameAt(cx, cy);
    if (!hit) return;
    openId = null;
    draft = { id: "draft", frame: hit.f.name, x: Math.round(hit.fx), y: Math.round(hit.fy), resolved: false, messages: [] };
    popAnchor = draft;
    pop.textContent = "";
    const head = el("div", "pop-head");
    head.appendChild(el("span", null, "New comment on " + hit.f.name));
    const close = el("button", null, "✕");
    close.setAttribute("aria-label", "Cancel");
    close.onclick = closePop;
    head.appendChild(close);
    pop.appendChild(head);
    pop.appendChild(composer("Leave a comment", async (text, name) => {
      const res = await send("comments", { text, name, frame: draft.frame, version: manifest.id, x: draft.x, y: draft.y });
      draft = null;
      threads.push(res.thread);
      setCommenting(false);
      openThread(res.thread.id);
    }));
    pop.hidden = false;
    renderPins();
    placePop();
  }

  function openThread(id) {
    const t = threads.find((t) => t.id === id);
    if (!t) return;
    draft = null;
    openId = id;
    popAnchor = t;
    pop.textContent = "";
    const head = el("div", "pop-head");
    head.appendChild(el("span", null, "#" + numberOf(t) + " · " + t.frame));
    const close = el("button", null, "✕");
    close.setAttribute("aria-label", "Close");
    close.onclick = closePop;
    head.appendChild(close);
    pop.appendChild(head);
    const msgs = el("div", "pop-msgs");
    for (const m of t.messages) {
      const row = el("div", "msg");
      const who = el("div", "msg-who");
      who.appendChild(el("b", null, m.author.name));
      if (m.author.kind === "studio") who.appendChild(el("span", "badge", studioName));
      who.appendChild(el("small", null, ago(m.at)));
      row.appendChild(who);
      row.appendChild(el("p", null, m.text));
      msgs.appendChild(row);
    }
    pop.appendChild(msgs);
    if (t.resolved) pop.appendChild(el("div", "resolved-note", "Resolved" + (t.resolvedBy ? " by " + t.resolvedBy.name : "") + ". You can still reply."));
    if (t.version && t.version !== manifest.id) pop.appendChild(el("div", "resolved-note", "Left on an earlier version."));
    pop.appendChild(composer("Reply", async (text, name) => {
      const res = await send("comments/" + t.id, { text, name });
      t.messages.push(res.message);
      t.updatedAt = res.message.at;
      openThread(t.id);
    }));
    pop.hidden = false;
    renderPins();
    placePop();
    msgs.scrollTop = msgs.scrollHeight;
  }

  async function refresh() {
    try {
      const res = await fetch("comments.json", { cache: "no-store" });
      if (!res.ok) return;
      const next = (await res.json()).threads || [];
      const changed = JSON.stringify(next) !== JSON.stringify(threads);
      threads = next;
      if (!changed) return;
      // keep a reply being typed: only redraw an open thread when its composer is empty
      const typing = pop.querySelector("textarea");
      if (openId && !(typing && typing.value)) openThread(openId);
      else renderPins();
    } catch {}
  }

  if (canComment) {
    for (const id of ["comment", "comment-sep", "list"]) document.getElementById(id).hidden = false;
    document.getElementById("comment").onclick = () => setCommenting(!commenting);
    document.getElementById("list").onclick = () => { const p = document.getElementById("panel"); p.hidden = !p.hidden; };
    document.getElementById("panel-close").onclick = () => (document.getElementById("panel").hidden = true);
    await refresh();
    setInterval(() => document.visibilityState === "visible" && refresh(), 15000);
    addEventListener("visibilitychange", () => document.visibilityState === "visible" && refresh());
  }
})();
</script>
</body>
</html>
`;
}
