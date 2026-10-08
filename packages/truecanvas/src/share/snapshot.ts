import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { findDevice } from "../core/devices.js";
import { routeOf } from "../core/routes.js";
import type { Workspace } from "../core/workspace.js";
import type { RawSnapshot, Screenshotter } from "../server/screenshot.js";
import { viewerHtml } from "./viewer.js";

/*
 * Share snapshots: every frame of a canvas rendered by the app, then frozen
 * into static HTML and CSS with its assets alongside. No JavaScript survives,
 * so a snapshot can't call an API or leak a session, whatever the app does.
 *
 *   <id>/manifest.json   canvas, frames and their positions
 *   <id>/index.html      the viewer (pan, zoom)
 *   <id>/frames/<n>.html <id>/frames/<n>.png
 *   <id>/assets/<hash>.<ext>
 */

export interface ShareFrame {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  theme: "light" | "dark" | null;
  device: string | null;
  /** paths inside the snapshot */
  html: string;
  image: string;
  /** a small preview of the frame's top (links page, emails) */
  thumb?: string;
  /** a frame linked to a page: its URL in the app (e.g. "/pricing"), so the live site can show it */
  route?: string;
}

export interface ShareManifest {
  format: 1;
  project: string;
  canvas: string;
  id: string;
  createdAt: number;
  frames: ShareFrame[];
  /** assets that couldn't be fetched (shown as missing in the snapshot) */
  missing: string[];
  /** requests that left the dev server while rendering (a real API, analytics) */
  external: string[];
}

/** Max total size of a snapshot's assets: past it, remaining assets are skipped. */
const MAX_ASSETS_BYTES = 80 * 1024 * 1024;

export function sharesDir(root: string) {
  return path.join(root, "node_modules", ".cache", "truecanvas", "shares");
}

export async function createSnapshot(ws: Workspace, shots: Screenshotter, canvas: string, opts: { frames?: string[] } = {}): Promise<{ dir: string; manifest: ShareManifest }> {
  const doc = ws.doc(canvas);
  const frames = doc.frames.filter((f) => !opts.frames || opts.frames.includes(f.frameName));
  if (!frames.length) throw new Error(`Canvas "${canvas}" has no frames to share.`);
  const id = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "").replace(/^(\d{8})/, "$1-");
  const dir = path.join(sharesDir(ws.config.root), canvas, id);
  fs.mkdirSync(path.join(dir, "frames"), { recursive: true });
  fs.mkdirSync(path.join(dir, "assets"), { recursive: true });
  const assets = new Assets(path.join(dir, "assets"));
  const appOrigin = new URL(ws.config.appUrl).origin;
  const out: ShareFrame[] = [];
  const external = new Set<string>();
  const used = new Set<string>();
  for (const f of frames) {
    const device = findDevice(f.device);
    const raw = await shots.snapshot({ canvas, frame: f.frameName, width: f.width, height: f.height, theme: f.theme ?? "light", mobile: device ? device.kind !== "desktop" : false });
    for (const u of raw.requests) if (new URL(u).origin !== appOrigin) external.add(new URL(u).origin);
    let slug = f.frameName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "frame";
    while (used.has(slug)) slug += "-2";
    used.add(slug);
    fs.writeFileSync(path.join(dir, "frames", `${slug}.html`), await freeze(raw, assets));
    fs.writeFileSync(path.join(dir, "frames", `${slug}.png`), raw.png);
    if (raw.thumb) fs.writeFileSync(path.join(dir, "frames", `${slug}.thumb.jpg`), raw.thumb);
    // only Next.js pages have a URL we can work out from their file
    const route = f.page && ws.config.framework === "next" ? routeOf(ws.config, f.page) : undefined;
    out.push({ name: f.frameName, x: f.x, y: f.y, width: raw.width, height: f.height ?? raw.height, theme: f.theme, device: f.device, html: `frames/${slug}.html`, image: `frames/${slug}.png`, ...(raw.thumb ? { thumb: `frames/${slug}.thumb.jpg` } : {}), ...(route ? { route } : {}) });
  }
  const manifest: ShareManifest = {
    format: 1,
    project: path.basename(ws.config.root),
    canvas,
    id,
    createdAt: Date.now(),
    frames: out,
    missing: [...assets.missing],
    external: [...external].filter((o) => !/fonts\.(googleapis|gstatic)\.com$/.test(new URL(o).host)),
  };
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(dir, "index.html"), viewerHtml());
  return { dir, manifest };
}

/** The snapshot page of one frame: its markup, one stylesheet, and asset URLs pointing at ../assets. */
async function freeze(raw: RawSnapshot, assets: Assets): Promise<string> {
  // stylesheets: cross-origin ones (font CDNs) are fetched, url()s resolved against their sheet
  let css = "";
  for (const sheet of raw.css) {
    let text = sheet.text;
    if (sheet.href && !text) text = (await fetchText(sheet.href)) ?? "";
    text = await replaceAsync(text, /url\(\s*(['"]?)([^'")]+)\1\s*\)/g, async (m, _q, u: string) => {
      const local = await assets.local(u, sheet.base, "../assets/");
      return local ? `url("${local}")` : m;
    });
    css += sheet.media && sheet.media !== "all" ? `@media ${sheet.media} {\n${text}\n}\n` : `${text}\n`;
  }
  let html = raw.html;
  // attributes: images, posters, SVG references to files
  html = await replaceAsync(html, /\s(src|poster|href|xlink:href)="([^"]+)"/g, async (m, attr: string, u: string) => {
    if (u.startsWith("tc-canvas:")) return m;
    const local = await assets.local(decodeEntities(u), raw.url, "../assets/");
    return local ? ` ${attr}="${local}"` : m;
  });
  // inline styles: background images
  html = await replaceAsync(html, /url\((&quot;|['"]?)([^'")&]+)\1\)/g, async (m, q: string, u: string) => {
    const local = await assets.local(decodeEntities(u), raw.url, "../assets/");
    return local ? `url(${q}${local}${q})` : m;
  });
  // <canvas> pixels
  for (const c of raw.canvases) {
    const local = assets.store(c.png, "png");
    html = html.split(`src="tc-canvas:${c.index}"`).join(`src="../assets/${local}"`);
  }
  html = html.replace(/\ssrc="tc-canvas:\d+"/g, "");
  const head = `<meta name="robots" content="noindex"><style>${css.replace(/<\/style/gi, "<\\/style")}</style>`;
  return html.includes("</head>") ? html.replace("</head>", `${head}</head>`) : head + html;
}

/** Downloads assets once, stores them by content hash. */
class Assets {
  private byUrl = new Map<string, Promise<string | null>>();
  private bytes = 0;
  missing = new Set<string>();
  constructor(private dir: string) {}

  /** The local path (with `prefix`) for an asset URL, or null to leave it as is (data:, #fragment). */
  local(spec: string, base: string, prefix: string): Promise<string | null> {
    if (/^(data:|#|about:|blob:)/i.test(spec.trim())) return Promise.resolve(null);
    let url: string;
    try {
      url = new URL(spec.trim(), base).href;
    } catch {
      return Promise.resolve(null);
    }
    if (!/^https?:/.test(url)) return Promise.resolve(null);
    if (!this.byUrl.has(url)) this.byUrl.set(url, this.download(url));
    return this.byUrl.get(url)!.then((name) => (name ? prefix + name : null));
  }

  private async download(url: string): Promise<string | null> {
    if (this.bytes > MAX_ASSETS_BYTES) {
      this.missing.add(url);
      return null;
    }
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(String(res.status));
      const buf = Buffer.from(await res.arrayBuffer());
      this.bytes += buf.length;
      return this.store(buf, extension(url, res.headers.get("content-type")));
    } catch {
      this.missing.add(url);
      return null;
    }
  }

  store(buf: Buffer, ext: string): string {
    const name = `${crypto.createHash("sha256").update(buf).digest("hex").slice(0, 20)}.${ext}`;
    const file = path.join(this.dir, name);
    if (!fs.existsSync(file)) fs.writeFileSync(file, buf);
    return name;
  }
}

const TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "image/x-icon": "ico",
  "image/vnd.microsoft.icon": "ico",
  "font/woff2": "woff2",
  "font/woff": "woff",
  "font/ttf": "ttf",
  "font/otf": "otf",
  "application/font-woff2": "woff2",
  "video/mp4": "mp4",
  "video/webm": "webm",
};

function extension(url: string, type: string | null): string {
  const fromType = TYPES[(type ?? "").split(";")[0].trim()];
  if (fromType) return fromType;
  const ext = path.extname(new URL(url).pathname).slice(1).toLowerCase();
  return /^[a-z0-9]{1,5}$/.test(ext) ? ext : "bin";
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { "user-agent": "Mozilla/5.0 Chrome/130 Safari/537.36" } });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

const decodeEntities = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

async function replaceAsync(input: string, re: RegExp, fn: (...m: string[]) => Promise<string>): Promise<string> {
  const matches = [...input.matchAll(re)];
  const replaced = await Promise.all(matches.map((m) => fn(...(m as unknown as string[]))));
  let out = "";
  let last = 0;
  matches.forEach((m, i) => {
    out += input.slice(last, m.index) + replaced[i];
    last = m.index! + m[0].length;
  });
  return out + input.slice(last);
}
