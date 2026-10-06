import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { injectIds } from "../core/inject.js";
import { loadConfig } from "../core/config.js";

/*
 * Truecanvas for Vite + React apps, in development only:
 * - canvas files (`*.canvas.tsx`) and component files get their JSX stamped
 *   with source ids, so the editor can map pixels back to code;
 * - `/truecanvas/<canvas>?frame=…` serves the page each frame's iframe loads,
 *   rendering the generated entry (.truecanvas/entry.tsx) with the app's
 *   global styles and the <head> links of its index.html (fonts, icons).
 * Production builds are untouched (the plugin only applies to `vite dev`).
 */

/** The bits of Vite's API this plugin uses, so Vite stays an optional peer. */
interface ViteDevServer {
  config: { root: string };
  middlewares: { use(fn: (req: IncomingMessage, res: ServerResponse, next: () => void) => void): void };
  transformIndexHtml(url: string, html: string): Promise<string>;
}

export interface TruecanvasVitePlugin {
  name: string;
  apply: "serve";
  enforce: "pre";
  config(): { optimizeDeps: { include: string[] } };
  configResolved(config: { root: string }): void;
  transform(code: string, id: string): { code: string; map: null } | null;
  configureServer(server: ViteDevServer): void;
}

export function truecanvas(): TruecanvasVitePlugin {
  let root = process.cwd();
  let components: string[] = [];
  let routeDir = ".truecanvas";
  return {
    name: "truecanvas",
    apply: "serve",
    enforce: "pre",
    config() {
      // the frame entry isn't reachable from index.html: list its deps up front so the
      // first frame doesn't make Vite re-optimize and reload every iframe
      return { optimizeDeps: { include: ["truecanvas", "truecanvas/host", "react-dom/client"] } };
    },
    configResolved(resolved) {
      root = resolved.root;
      const config = loadConfig(root);
      routeDir = config.routeDir;
      components = componentRoots(config.components);
    },
    transform(code, id) {
      // Vite ids use forward slashes on every OS
      const file = id.split("?")[0].replace(/\\/g, "/");
      if (!/\.[jt]sx$/.test(file) || file.includes("/node_modules/")) return null;
      if (file.endsWith(".canvas.tsx")) return { code: injectIds(code), map: null };
      const rel = path.relative(root, file).split(path.sep).join("/");
      if (rel.startsWith("..") || rel.startsWith(`${routeDir}/`)) return null;
      // components: every JSX element, for main component frames
      if (components.some((dir) => rel.startsWith(`${dir}/`))) return { code: injectIds(code, rel), map: null };
      return null;
    },
    configureServer(server) {
      // registered directly (not as a post hook): runs before Vite's SPA fallback
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? "";
        if (!/^\/truecanvas\/[^/?#]+\/?(?:[?#]|$)/.test(url)) return next();
        server
          .transformIndexHtml(url, frameHtml(server.config.root, routeDir))
          .then((html) => {
            res.statusCode = 200;
            res.setHeader("Content-Type", "text/html; charset=utf-8");
            res.setHeader("Cache-Control", "no-store");
            res.end(html);
          })
          .catch(() => next());
      });
    },
  };
}

export default truecanvas;

/**
 * The frame page: the app's own <head> links (fonts, icons, stylesheets) and
 * the generated entry. Mounted on #tc-root, not #root: a frame is a viewport,
 * and app layout rules on #root (the Vite template centers it) would box it in.
 */
function frameHtml(root: string, routeDir: string): string {
  let head = "";
  try {
    const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
    const inner = /<head[^>]*>([\s\S]*?)<\/head>/i.exec(html)?.[1] ?? "";
    head = [...inner.matchAll(/<link\b[^>]*>|<style\b[\s\S]*?<\/style>/gi)]
      .map((m) => m[0])
      .filter((tag) => !/rel=["']?modulepreload/i.test(tag))
      .join("\n    ");
  } catch {
    /* no index.html: just the entry */
  }
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Truecanvas frame</title>
    ${head}
  </head>
  <body>
    <div id="tc-root"></div>
    <script type="module" src="/${routeDir}/entry.tsx"></script>
  </body>
</html>
`;
}

/** Folders of the component globs ("src/components/**\/*.tsx" → "src/components"). */
function componentRoots(globs: string[]): string[] {
  return [...new Set(globs.map((g) => g.split("/").filter((p) => !p.includes("*")).join("/")).filter(Boolean))];
}
