import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Browser } from "playwright-core";

/** A Chromium for screenshots: TRUECANVAS_CHROME, Playwright's headless shell, or a system Chrome/Chromium. */
export function findChromium(): string | undefined {
  if (process.env.TRUECANVAS_CHROME) return process.env.TRUECANVAS_CHROME;
  const cache = path.join(os.homedir(), ".cache", "ms-playwright");
  if (fs.existsSync(cache)) {
    const shells = fs.readdirSync(cache).filter((d) => d.startsWith("chromium_headless_shell-")).sort().reverse();
    for (const d of shells) {
      for (const sub of ["chrome-headless-shell-linux64/chrome-headless-shell", "chrome-linux/headless_shell", "chrome-headless-shell-mac-arm64/chrome-headless-shell", "chrome-headless-shell-mac-x64/chrome-headless-shell"]) {
        const p = path.join(cache, d, sub);
        if (fs.existsSync(p)) return p;
      }
    }
  }
  for (const p of [
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

  async frame(opts: {
    canvas: string;
    frame: string;
    width: number;
    height: number | null;
    theme: "light" | "dark" | "system";
    scale?: number;
    mobile?: boolean;
    /** compact JPEG (review thumbnails, PR images) */
    jpeg?: boolean;
    /** crop hug-height frames to this many px */
    maxHeight?: number;
  }): Promise<Buffer> {
    const options = {
      viewport: { width: opts.width, height: opts.height ?? 800 },
      deviceScaleFactor: opts.scale ?? 1,
      colorScheme: (opts.theme === "dark" ? "dark" : "light") as "dark" | "light",
      // device frames: touch input, (hover: none) and mobile viewport rules
      isMobile: !!opts.mobile,
      hasTouch: !!opts.mobile,
    };
    return this.withContext(options, async (ctx) => {
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
      const format = opts.jpeg ? ({ type: "jpeg", quality: 78 } as const) : ({ type: "png" } as const);
      return await page.screenshot(format);
    });
  }
}
