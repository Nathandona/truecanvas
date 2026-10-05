import fs from "node:fs";
import path from "node:path";
import { defaultReturn } from "./source.js";
import { importSpecifier } from "./catalog.js";
import type { TruecanvasConfig } from "./config.js";

export interface AppRoute {
  /** URL path, e.g. "/" or "/pricing" */
  route: string;
  /** page file, relative to the project root */
  file: string;
  /** has [params]: it can only render with sample values */
  dynamic: boolean;
}

const PAGE = /^page\.(tsx|jsx|ts|js)$/;
const LAYOUT = ["layout.tsx", "layout.jsx", "layout.js", "layout.ts"];

/** Every App Router page, except Truecanvas' own route and API handlers. */
export function listRoutes(config: TruecanvasConfig): AppRoute[] {
  const appDir = path.join(config.root, config.appDir);
  const out: AppRoute[] = [];
  const walkDir = (dir: string, segments: string[]) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isFile() && PAGE.test(e.name)) {
        const visible = segments.filter((s) => !/^\(.*\)$/.test(s) && !s.startsWith("@"));
        out.push({ route: `/${visible.join("/")}`, file: path.relative(config.root, path.join(dir, e.name)), dynamic: segments.some((s) => s.startsWith("[")) });
      }
      if (e.isDirectory() && !e.name.startsWith("_") && e.name !== "truecanvas" && e.name !== "api" && e.name !== "node_modules") walkDir(path.join(dir, e.name), [...segments, e.name]);
    }
  };
  walkDir(appDir, []);
  return out.sort((a, b) => a.route.localeCompare(b.route));
}

interface Piece {
  /** JSX of the component's return, with `{children}` still in it for layouts */
  jsx: string;
  imports: string[];
}

/** The JSX a page or layout returns, if it is plain composition (no data, no local state). */
function extract(file: string, canvasFile: string, config: TruecanvasConfig, layout: boolean): Piece | null {
  const source = fs.readFileSync(file, "utf8");
  const info = defaultReturn(source, layout);
  if (!info?.pure) return null;
  const imports: string[] = [];
  for (const stmt of info.ast.program.body) {
    if (stmt.type !== "ImportDeclaration" || stmt.importKind === "type") continue;
    const src = stmt.source.value;
    if (/\.(css|scss|sass|less)$/.test(src)) continue;
    // relative imports must be re-pointed from the canvas file
    const from = repoint(config, src, file, canvasFile);
    const text = source.slice(stmt.start!, stmt.end!);
    imports.push(from === src ? text : text.replace(JSON.stringify(src), JSON.stringify(from)).replace(`'${src}'`, `'${from}'`));
  }
  return { jsx: source.slice(info.node.start!, info.node.end!), imports };
}

/** An import specifier written in `fromFile`, re-pointed for `toFile` (absolute paths). Aliases and packages stay. */
export function repoint(config: TruecanvasConfig, spec: string, fromFile: string, toFile: string): string {
  if (!spec.startsWith(".")) return spec;
  return importSpecifier(config.root, path.relative(config.root, toFile), path.relative(config.root, path.resolve(path.dirname(fromFile), spec)));
}

/** Layouts that wrap a page, innermost first, without the root layout (the canvas route already uses it). */
export function layoutFiles(config: TruecanvasConfig, pageFile: string): string[] {
  const appDir = path.join(config.root, config.appDir);
  const out: string[] = [];
  for (let dir = path.dirname(path.resolve(config.root, pageFile)); dir.startsWith(appDir) && dir !== appDir; dir = path.dirname(dir)) {
    const file = LAYOUT.map((f) => path.join(dir, f)).find((f) => fs.existsSync(f));
    if (file) out.push(path.relative(config.root, file));
  }
  return out;
}

/** URL path of a page file. */
export function routeOf(config: TruecanvasConfig, pageFile: string): string {
  const rel = path.relative(path.join(config.root, config.appDir), path.dirname(path.resolve(config.root, pageFile)));
  const visible = rel.split(path.sep).filter((s) => s && !/^\(.*\)$/.test(s) && !s.startsWith("@"));
  return `/${visible.join("/")}`;
}

export interface RouteFrame {
  jsx: string;
  imports: string[];
  /** "inline": sections are layers; "component": the page renders as one component */
  mode: "inline" | "component";
}

/**
 * JSX for a frame that shows a page as the app renders it: its layouts
 * (except the root one, which the canvas route already uses) wrapped around it.
 */
export function routeFrame(config: TruecanvasConfig, pageFile: string, canvasFile: string): RouteFrame {
  const appDir = path.join(config.root, config.appDir);
  const pageAbs = path.resolve(config.root, pageFile);
  const canvasAbs = path.resolve(config.root, canvasFile);
  const imports: string[] = [];
  let mode: RouteFrame["mode"] = "inline";

  const page = extract(pageAbs, canvasAbs, config, false);
  let jsx: string;
  if (page) {
    jsx = page.jsx;
    imports.push(...page.imports);
  } else {
    mode = "component";
    imports.push(`import RoutePage from ${JSON.stringify(importSpecifier(config.root, canvasFile, pageFile))};`);
    jsx = "<RoutePage />";
  }

  // nested layouts, innermost first, up to (not including) the root layout
  let i = 0;
  for (let dir = path.dirname(pageAbs); dir.startsWith(appDir) && dir !== appDir; dir = path.dirname(dir)) {
    const file = LAYOUT.map((f) => path.join(dir, f)).find((f) => fs.existsSync(f));
    if (!file) continue;
    const layout = extract(file, canvasAbs, config, true);
    const holes = layout ? (layout.jsx.match(/\{\s*children\s*\}/g) ?? []).length : 0;
    if (layout && holes === 1) {
      jsx = layout.jsx.replace(/\{\s*children\s*\}/, jsx.startsWith("<>") ? jsx.slice(2, -3) : jsx);
      imports.push(...layout.imports);
    } else {
      const local = `RouteLayout${i++ || ""}`;
      imports.push(`import ${local} from ${JSON.stringify(importSpecifier(config.root, canvasFile, path.relative(config.root, file)))};`);
      jsx = `<${local}>${jsx}</${local}>`;
    }
  }
  // a frame holds one root element
  if (jsx.trimStart().startsWith("<>")) jsx = `<div>${jsx.trim().slice(2, -3)}</div>`;
  return { jsx, imports: [...new Set(imports)], mode };
}
