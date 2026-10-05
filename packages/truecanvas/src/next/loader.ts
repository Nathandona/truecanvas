import path from "node:path";
import { injectIds } from "../core/inject.js";

interface LoaderContext {
  cacheable?: (v: boolean) => void;
  resourcePath?: string;
  getOptions?: () => { root?: string; appDir?: string; components?: string[] };
}

/**
 * Webpack/Turbopack loader. Canvas files (*.canvas.tsx) get `line:col` ids;
 * App Router pages and layouts get `file#line:col` ids, so linked frames can
 * map what renders back to the page's own JSX. Dev only (see withTruecanvas).
 */
export default function truecanvasLoader(this: LoaderContext, source: string): string {
  this.cacheable?.(true);
  const file = this.resourcePath ?? "";
  if (file.endsWith(".canvas.tsx")) return injectIds(source);
  const { root, appDir, components = [] } = this.getOptions?.() ?? {};
  if (!root || !appDir) return source;
  const rel = path.relative(root, file).split(path.sep).join("/");
  if (rel.startsWith("..") || rel.includes("node_modules/") || rel.startsWith(`${appDir}/truecanvas/`) || !/\.[jt]sx$/.test(rel)) return source;
  // components: every JSX element, for main component frames
  if (components.some((dir) => rel.startsWith(`${dir}/`))) return injectIds(source, rel);
  // pages and layouts, for linked frames
  if (rel.startsWith(`${appDir}/`) && /^(page|layout)\.[jt]sx$/.test(path.basename(rel))) return injectIds(source, rel);
  return source;
}
