/**
 * The share viewer: one static page that reads ./manifest.json and lays the
 * frozen frames out at their canvas positions, with pan and zoom (drag,
 * wheel, pinch, keys). Frames are sandboxed iframes without scripts, under a
 * transparent layer that takes every pointer event. Self-contained: no
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
  --ease-out: cubic-bezier(.23,1,.32,1);
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #151514; --dot: rgba(255,255,255,.06); --panel: rgba(30,30,28,.86); --line: rgba(255,255,255,.09);
    --text: #ecebe8; --muted: #9a9892; --frame-shadow: 0 1px 2px rgba(0,0,0,.4), 0 16px 48px -12px rgba(0,0,0,.6); color-scheme: dark; }
}
* { box-sizing: border-box; }
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
select { font: inherit; color: var(--muted); background: transparent; border: 0; padding: 4px 2px; cursor: pointer; max-width: 46vw; }
select:focus-visible { outline: 2px solid #3b82f6; border-radius: 6px; }
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
@media (max-width: 640px) { .meta, .sep, .made { display: none; } header { top: 8px; left: 8px; right: 8px; } }
@media (prefers-reduced-motion: reduce) { .frame-box iframe { transition: none; } }
</style>
</head>
<body>
<div id="stage" aria-label="Design canvas"><div id="world"></div></div>
<header>
  <div class="pill brand" id="brand"><span>Design review</span></div>
  <div class="pill"><span class="title" id="title"></span><span class="sep"></span><span class="meta" id="meta"></span></div>
</header>
<footer><div class="pill">
  <button id="out" aria-label="Zoom out" title="Zoom out (-)">−</button>
  <button id="zoom" aria-label="Zoom to fit" title="Zoom to fit (1)">100%</button>
  <button id="in" aria-label="Zoom in" title="Zoom in (+)">+</button>
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
  if (manifest.versions && manifest.versions.length > 1) {
    // versions: the latest by default, earlier ones a pick away
    const select = document.createElement("select");
    select.setAttribute("aria-label", "Version");
    manifest.versions.forEach((v, i) => {
      const o = document.createElement("option");
      o.value = v.id;
      o.textContent = (v.latest ? "Latest · " : "Version " + (manifest.versions.length - i) + " · ") + day(v.createdAt) + " " + time(v.createdAt);
      o.selected = v.id === manifest.id;
      select.appendChild(o);
    });
    select.onchange = () => { location.search = select.value === manifest.versions[0].id ? "" : "?v=" + select.value; };
    meta.replaceWith(select);
  } else meta.textContent = day(manifest.createdAt);
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
    el.innerHTML = '<div class="frame-label"><b>' + esc(f.name) + "</b>" + f.width + " × " + Math.round(f.height) + "</div>" +
      '<div class="frame-box" style="width:' + f.width + "px;height:" + f.height + 'px"><img alt="" src="' + esc(f.image) + '"><iframe sandbox title="' + esc(f.name) + '" scrolling="no" loading="lazy" src="' + esc(f.html) + '"></iframe></div>';
    const iframe = el.querySelector("iframe");
    iframe.addEventListener("load", () => iframe.classList.add("ready"));
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
    if (moved) return;
    const now = Date.now();
    if (now - lastTap < 320) { zoomToFrameAt(e.clientX, e.clientY); lastTap = 0; }
    else lastTap = now;
  });

  const center = () => [innerWidth / 2, innerHeight / 2];
  document.getElementById("in").onclick = () => zoomAt(z * 1.25, ...center());
  document.getElementById("out").onclick = () => zoomAt(z / 1.25, ...center());
  zoomLabel.onclick = () => (tall() ? fitWidth() : fit());
  addEventListener("keydown", (e) => {
    if (e.key === "+" || e.key === "=") zoomAt(z * 1.25, ...center());
    else if (e.key === "-") zoomAt(z / 1.25, ...center());
    else if (e.key === "0") zoomAt(1, ...center());
    else if (e.key === "1") fit();
    else if (e.key === "2") fitWidth();
  });
  addEventListener("resize", apply);
})();
</script>
</body>
</html>
`;
}
