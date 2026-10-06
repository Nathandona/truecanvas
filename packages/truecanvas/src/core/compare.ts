import fs from "node:fs";
import path from "node:path";
import type { TruecanvasConfig } from "./config.js";
import { parseCanvas } from "./parse.js";
import { assertCanvasName, routeDirOf, syncRoute } from "./scaffold.js";
import { importSpecifier } from "./catalog.js";
import { rewriteImportSource } from "./ast.js";
import { posix } from "./paths.js";

export const COMPARE_PREFIX = "__compare__";

/**
 * Writes an older version of a canvas next to the generated route so the app can
 * render it like any canvas ("__compare__<name>"). Relative imports are
 * rewritten for the new location; alias imports (@/…) work unchanged.
 */
export function writeCompare(config: TruecanvasConfig, canvas: string, source: string, files: Record<string, string> = {}, as = canvas): string {
  const routeDir = routeDirOf(config);
  const dir = path.join(routeDir, "compare");
  fs.mkdirSync(dir, { recursive: true });
  const canvasDir = path.join(config.root, config.canvasDir);
  const canvasRel = `${config.canvasDir}/${canvas}.canvas.tsx`;

  // older versions of linked pages/layouts, next to the snapshot (not named page.tsx, so they're not routes)
  const swapped = new Map<string, string>();
  for (const [rel, content] of Object.entries(files)) {
    const ext = path.extname(rel);
    const name = `${as}--${rel.slice(0, -ext.length).replace(/[^\w.-]+/g, "_")}${ext}`;
    const original = path.join(config.root, rel);
    fs.writeFileSync(path.join(dir, name), rewriteImports(content, (spec) => (spec.startsWith(".") ? relativeSpec(dir, path.resolve(path.dirname(original), spec)) : spec)));
    swapped.set(importSpecifier(config.root, canvasRel, rel), `./${name.slice(0, -ext.length)}`);
  }

  const out = rewriteImports(source, (spec) => swapped.get(spec) ?? (spec.startsWith(".") ? relativeSpec(dir, path.resolve(canvasDir, spec)) : spec));
  fs.writeFileSync(path.join(dir, `${as}.canvas.tsx`), out);
  syncRoute(config);
  return `${COMPARE_PREFIX}${as}`;
}

function relativeSpec(fromDir: string, target: string) {
  const next = posix(path.relative(fromDir, target));
  return next.startsWith(".") ? next : `./${next}`;
}

/** Rewrites import specifiers of a module (statements only; other code is untouched). */
function rewriteImports(source: string, map: (spec: string) => string): string {
  const doc = parseCanvas("", "", source);
  let out = source;
  for (const imp of [...doc.imports].sort((a, b) => b.start - a.start)) {
    const next = map(imp.source);
    if (next === imp.source) continue;
    const stmt = rewriteImportSource(out.slice(imp.start, imp.end), imp.source, next);
    out = out.slice(0, imp.start) + stmt + out.slice(imp.end);
  }
  return out;
}

export function clearCompare(config: TruecanvasConfig, canvas?: string) {
  if (canvas) assertCanvasName(canvas);
  const dir = path.join(routeDirOf(config), "compare");
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) if (!canvas || f === `${canvas}.canvas.tsx` || f.startsWith(`${canvas}--`)) fs.rmSync(path.join(dir, f));
  syncRoute(config);
}

/** Per frame: same, changed, added (only now) or removed (only before). */
export function frameChanges(before: string, after: string): Record<string, "changed" | "added" | "removed" | "same"> {
  const a = parseCanvas("", "", before);
  const b = parseCanvas("", "", after);
  const norm = (src: string, start: number, end: number) => src.slice(start, end).replace(/\s+/g, " ").replace(/\s?(x|y)=\{-?\d+\}/g, "");
  const out: Record<string, "changed" | "added" | "removed" | "same"> = {};
  for (const f of b.frames) {
    const old = a.frames.find((x) => x.frameName === f.frameName);
    out[f.frameName] = !old ? "added" : norm(before, old.start, old.end) === norm(after, f.start, f.end) ? "same" : "changed";
  }
  for (const f of a.frames) if (!(f.frameName in out)) out[f.frameName] = "removed";
  return out;
}
