import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Browser } from "playwright-core";

/** A Chromium for screenshots: TRUECANVAS_CHROME, Playwright's headless shell, or a system Chrome/Chromium. */
export function findChromium(): string | undefined {
  if (process.env.TRUECANVAS_CHROME) return process.env.TRUECANVAS_CHROME;
  // Playwright's browsers, where `npx playwright install` puts them on this OS
  const cache =
    process.env.PLAYWRIGHT_BROWSERS_PATH ||
    (process.platform === "win32"
      ? path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"), "ms-playwright")
      : process.platform === "darwin"
        ? path.join(os.homedir(), "Library", "Caches", "ms-playwright")
        : path.join(os.homedir(), ".cache", "ms-playwright"));
  if (fs.existsSync(cache)) {
    const shells = fs.readdirSync(cache).filter((d) => d.startsWith("chromium_headless_shell-")).sort().reverse();
    for (const d of shells) {
      for (const sub of [
        "chrome-headless-shell-linux64/chrome-headless-shell",
        "chrome-linux/headless_shell",
        "chrome-headless-shell-mac-arm64/chrome-headless-shell",
        "chrome-headless-shell-mac-x64/chrome-headless-shell",
        "chrome-headless-shell-win64/chrome-headless-shell.exe",
        "chrome-win/headless_shell.exe",
      ]) {
        const p = path.join(cache, d, sub);
        if (fs.existsSync(p)) return p;
      }
    }
  }
  const programFiles = [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA].filter(Boolean) as string[];
  for (const p of [
    ...programFiles.flatMap((dir) => [path.join(dir, "Google", "Chrome", "Application", "chrome.exe"), path.join(dir, "Microsoft", "Edge", "Application", "msedge.exe")]),
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ]) {
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

/**
 * Headless Chromium launched on demand for agent screenshots and closed after
 * a minute idle, so it costs no memory while nobody asks for pixels.
 */
export class Screenshotter {
  private browser: Promise<Browser> | null = null;
  private idle: NodeJS.Timeout | null = null;

  constructor(private appUrl: string) {}

  private executable(): string | undefined {
    return findChromium();
  }

  private async getBrowser() {
    if (!this.browser) {
      const { chromium } = await import("playwright-core");
      const executablePath = this.executable();
      if (!executablePath) throw new Error("No Chromium found for screenshots. Install Chrome/Chromium or set TRUECANVAS_CHROME.");
      const launching = chromium.launch({ executablePath, headless: true, args: ["--disable-gpu", "--disable-dev-shm-usage"] });
      this.browser = launching;
      launching.then(
        // a crashed browser is forgotten, so the next screenshot starts a fresh one
        (b) => b.on("disconnected", () => this.browser === launching && (this.browser = null)),
        () => this.browser === launching && (this.browser = null),
      );
    }
    return this.browser;
  }

  private busy = 0;
  private waiting: (() => void)[] = [];
  /**
   * Runs one screenshot in its own browser context. At most two run at once
   * (memory), and the browser only closes once nothing is in flight.
   */
  private async withContext<T>(options: Parameters<Browser["newContext"]>[0], fn: (ctx: Awaited<ReturnType<Browser["newContext"]>>) => Promise<T>): Promise<T> {
    if (this.busy >= 2) await new Promise<void>((r) => this.waiting.push(r));
    this.busy++;
    if (this.idle) clearTimeout(this.idle);
    try {
      const browser = await this.getBrowser();
      const ctx = await browser.newContext(options);
      try {
        return await fn(ctx);
      } finally {
        await ctx.close().catch(() => {});
      }
    } finally {
      this.busy--;
      this.waiting.shift()?.();
      if (this.busy === 0) this.idle = setTimeout(() => void this.close(), 60_000);
    }
  }

  async close() {
    const b = this.browser;
    this.browser = null;
    if (b) await (await b).close().catch(() => {});
  }

  /** Screenshot of the [data-tc-frame] element of a page (Assets thumbnails). */
  async element(url: string, viewport: { width: number; height: number }): Promise<Buffer> {
    return this.withContext({ viewport, deviceScaleFactor: 2, colorScheme: "light" }, async (ctx) => {
      const page = await ctx.newPage();
      await page.goto(`${url}${url.includes("?") ? "&" : "?"}still=1`, { waitUntil: "load", timeout: 30_000 });
      const el = await page.waitForSelector("[data-tc-frame]", { timeout: 20_000 });
      await page.evaluate(() => document.fonts.ready.then(() => new Promise((r) => setTimeout(r, 250))));
      await page.waitForFunction(() => (window as unknown as { __tcStill?: boolean }).__tcStill === true, undefined, { timeout: 6_000 }).catch(() => {});
      return await el.screenshot({ type: "png", omitBackground: true });
    });
  }

  async frame(opts: FrameShotOptions & {
    /** compact JPEG (review thumbnails, PR images) */
    jpeg?: boolean;
  }): Promise<Buffer> {
    return this.withContext(this.frameOptions(opts), async (ctx) => {
      const page = await this.openFrame(ctx, opts);
      const format = opts.jpeg ? ({ type: "jpeg", quality: 78 } as const) : ({ type: "png" } as const);
      return await page.screenshot(format);
    });
  }

  private frameOptions(opts: FrameShotOptions) {
    return {
      viewport: { width: opts.width, height: opts.height ?? 800 },
      deviceScaleFactor: opts.scale ?? 1,
      colorScheme: (opts.theme === "dark" ? "dark" : "light") as "dark" | "light",
      // device frames: touch input, (hover: none) and mobile viewport rules
      isMobile: !!opts.mobile,
      hasTouch: !!opts.mobile,
    };
  }

  /** Loads a frame, sizes hug frames to their content and waits until it has settled on its final state. */
  private async openFrame(ctx: Awaited<ReturnType<Browser["newContext"]>>, opts: FrameShotOptions) {
    const page = await ctx.newPage();
    const url = `${this.appUrl}/truecanvas/${encodeURIComponent(opts.canvas)}?frame=${encodeURIComponent(opts.frame)}&theme=${opts.theme}&still=1`;
    await page.goto(url, { waitUntil: "load", timeout: 30_000 });
    await page.waitForSelector("[data-tc-frame]", { timeout: 20_000 });
    // hug frames: the viewport becomes the page's height, so everything counts as in view (scroll reveals included)
    if (!opts.height) {
      const h = await page.evaluate(() => Math.ceil(document.querySelector("[data-tc-frame]")!.getBoundingClientRect().height));
      await page.setViewportSize({ width: opts.width, height: Math.min(Math.max(h, 100), opts.maxHeight ?? 16_000) });
    }
    // entrance animations settle on their final state (see the host's `still` mode)
    await page.waitForFunction(() => (window as unknown as { __tcStill?: boolean }).__tcStill === true, undefined, { timeout: 6_000 }).catch(() => {});
    // not requestAnimationFrame: a frozen frame holds its callbacks
    await page.evaluate(() => document.fonts.ready.then(() => new Promise((r) => setTimeout(r, 50))));
    await page.waitForTimeout(150);
    return page;
  }

  /**
   * A frame frozen into static HTML (share links): the rendered DOM without
   * scripts, every stylesheet's text, and pixels of the <canvas> elements
   * (shaders, charts), which only exist at runtime. Assets are left as URLs
   * for the caller to fetch.
   */
  async snapshot(opts: FrameShotOptions): Promise<RawSnapshot> {
    return this.withContext(this.frameOptions(opts), async (ctx) => {
      const requests = new Set<string>();
      ctx.on("request", (r) => {
        if (/^https?:/.test(r.url())) requests.add(r.url());
      });
      const page = await this.openFrame(ctx, opts);
      // lazy images below the fold have loaded now that the viewport covers the frame
      await page.evaluate(() => Promise.all([...document.images].map((img) => (img.complete ? null : new Promise((r) => ((img.onload = r), (img.onerror = r), setTimeout(r, 4000)))))));
      const raw = await page.evaluate(serializePage);
      const canvases: { index: number; png: Buffer }[] = [];
      for (const c of raw.canvases) {
        if (c.w < 1 || c.h < 1) continue;
        const png = await page.screenshot({ type: "png", clip: { x: c.x, y: c.y, width: c.w, height: c.h }, omitBackground: true }).catch(() => null);
        if (png) canvases.push({ index: c.index, png });
      }
      const png = await page.screenshot({ type: "png", fullPage: true });
      const viewport = page.viewportSize()!;
      return { url: raw.url, html: raw.html, css: raw.css, canvases, png, width: viewport.width, height: raw.height, requests: [...requests] };
    });
  }
}

export interface FrameShotOptions {
  canvas: string;
  frame: string;
  width: number;
  height: number | null;
  theme: "light" | "dark" | "system";
  scale?: number;
  mobile?: boolean;
  /** crop hug-height frames to this many px */
  maxHeight?: number;
}

export interface RawSnapshot {
  /** the frame's page URL, to resolve relative asset URLs */
  url: string;
  html: string;
  css: { base: string; text: string; media: string; href?: string }[];
  canvases: { index: number; png: Buffer }[];
  /** full-frame screenshot: thumbnail and fallback */
  png: Buffer;
  width: number;
  height: number;
  /** every URL the page requested while rendering (to flag calls to real APIs) */
  requests: string[];
}

/**
 * Runs in the frame's page: freezes what the browser computed into markup
 * (chosen image sources, form values), collects the text of every stylesheet,
 * and clones the document without scripts, event handlers or source ids.
 * <canvas> elements become <img src="tc-canvas:N"> for the caller to fill.
 */
function serializePage() {
  const abs = (u: string) => {
    try {
      return new URL(u, location.href).href;
    } catch {
      return u;
    }
  };
  for (const img of Array.from(document.images)) {
    if (img.currentSrc) img.setAttribute("src", img.currentSrc);
    for (const a of ["srcset", "sizes", "loading", "decoding"]) img.removeAttribute(a);
  }
  for (const input of Array.from(document.querySelectorAll("input"))) {
    if (input.type === "checkbox" || input.type === "radio") input.toggleAttribute("checked", input.checked);
    else if (input.type !== "password" && input.type !== "file") input.setAttribute("value", input.value);
  }
  for (const t of Array.from(document.querySelectorAll("textarea"))) t.textContent = t.value;
  for (const o of Array.from(document.querySelectorAll("option"))) o.toggleAttribute("selected", o.selected);
  const canvases = Array.from(document.querySelectorAll("canvas")).map((c, index) => {
    c.setAttribute("data-tc-canvas", String(index));
    const r = c.getBoundingClientRect();
    return { index, x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height };
  });

  const css: { base: string; text: string; media: string; href?: string }[] = [];
  const collect = (sheet: CSSStyleSheet, media = "") => {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      // cross-origin stylesheet (a font CDN): the caller fetches its text
      if (sheet.href) css.push({ base: sheet.href, text: "", media: sheet.media?.mediaText || media, href: sheet.href });
      return;
    }
    let text = "";
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSImportRule) {
        if (rule.styleSheet) collect(rule.styleSheet, rule.media?.mediaText || "");
        continue;
      }
      text += `${rule.cssText}\n`;
    }
    css.push({ base: sheet.href || location.href, text, media: sheet.media?.mediaText || media });
  };
  for (const sheet of Array.from(document.styleSheets)) if (!sheet.disabled) collect(sheet);
  for (const sheet of document.adoptedStyleSheets ?? []) collect(sheet);

  const root = document.documentElement.cloneNode(true) as HTMLElement;
  for (const el of Array.from(root.querySelectorAll("script, noscript, style, link, template, iframe, object, embed, nextjs-portal, [data-nextjs-toast]"))) {
    // keep icons and fonts' preconnects out too: the snapshot carries its own assets
    el.remove();
  }
  for (const c of Array.from(root.querySelectorAll("canvas[data-tc-canvas]"))) {
    const i = Number(c.getAttribute("data-tc-canvas"));
    const img = document.createElement("img");
    for (const a of Array.from(c.attributes)) if (a.name !== "width" && a.name !== "height") img.setAttribute(a.name, a.value);
    img.setAttribute("src", `tc-canvas:${i}`);
    img.setAttribute("alt", "");
    const r = canvases[i];
    img.style.width = `${r.w}px`;
    img.style.height = `${r.h}px`;
    c.replaceWith(img);
  }
  for (const el of [root, ...Array.from(root.querySelectorAll("*"))]) {
    for (const a of Array.from(el.attributes)) {
      const n = a.name;
      if (n.startsWith("on") || n === "data-tc" || n === "data-tc-canvas" || n === "data-tc-hidden") el.removeAttribute(n);
    }
    for (const n of ["src", "poster", "xlink:href"]) {
      const v = el.getAttribute(n);
      if (v && !/^(data:|#|tc-canvas:)/.test(v)) el.setAttribute(n, abs(v));
    }
    const href = el.getAttribute("href");
    // links can't navigate (the viewer shows a picture of the page), in-SVG references stay
    if (href !== null && el.tagName.toLowerCase() === "a") {
      el.setAttribute("data-href", href);
      el.removeAttribute("href");
      (el as HTMLElement).style.cursor = "pointer";
    } else if (href && !href.startsWith("#") && !href.startsWith("data:")) el.setAttribute("href", abs(href));
  }
  for (const f of Array.from(root.querySelectorAll("form"))) f.removeAttribute("action");
  const height = Math.ceil(document.querySelector("[data-tc-frame]")?.getBoundingClientRect().height ?? document.documentElement.scrollHeight);
  return { url: location.href, html: `<!doctype html>\n${root.outerHTML}`, css, canvases, height };
}
