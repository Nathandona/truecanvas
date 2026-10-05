import fs from "node:fs";
import path from "node:path";
import type { TruecanvasConfig } from "./config.js";

export interface InitReport {
  done: string[];
  todo: string[];
}

const CONFIG_FILES = ["next.config.ts", "next.config.mjs", "next.config.js", "next.config.mts"];

/** Is next.config already wrapped with withTruecanvas? */
export function nextConfigStatus(root: string): { file: string | null; wrapped: boolean } {
  for (const name of CONFIG_FILES) {
    const file = path.join(root, name);
    if (fs.existsSync(file)) return { file, wrapped: fs.readFileSync(file, "utf8").includes("withTruecanvas") };
  }
  return { file: null, wrapped: false };
}

/**
 * Sets up a Next.js project: wraps next.config, adds a `canvas` script and
 * ignores the generated route. Every step is idempotent and reported.
 */
export function initProject(config: TruecanvasConfig): InitReport {
  const { root } = config;
  const report: InitReport = { done: [], todo: [] };

  // 1. next.config
  const status = nextConfigStatus(root);
  if (!status.file) {
    const file = path.join(root, "next.config.ts");
    fs.writeFileSync(file, `import type { NextConfig } from "next";\nimport { withTruecanvas } from "truecanvas/next";\n\nconst nextConfig: NextConfig = {};\n\nexport default withTruecanvas(nextConfig);\n`);
    report.done.push("Created next.config.ts with withTruecanvas()");
  } else if (status.wrapped) {
    report.done.push(`${path.basename(status.file)} already uses withTruecanvas()`);
  } else {
    const src = fs.readFileSync(status.file, "utf8");
    const esm = /export\s+default\s+/.test(src);
    const cjs = /module\.exports\s*=\s*/.test(src);
    let next: string | null = null;
    if (esm) {
      next = src.replace(/export\s+default\s+([\s\S]+?);?\s*$/, (_m, expr: string) => `export default withTruecanvas(${expr.trim().replace(/;$/, "")});\n`);
      next = addImport(next, `import { withTruecanvas } from "truecanvas/next";`);
    } else if (cjs) {
      next = src.replace(/module\.exports\s*=\s*([\s\S]+?);?\s*$/, (_m, expr: string) => `module.exports = withTruecanvas(${expr.trim().replace(/;$/, "")});\n`);
      next = `const { withTruecanvas } = require("truecanvas/next");\n${next}`;
    }
    if (next && next !== src && next.includes("withTruecanvas(")) {
      fs.writeFileSync(status.file, next);
      report.done.push(`Wrapped ${path.basename(status.file)} with withTruecanvas()`);
    } else {
      report.todo.push(`Wrap your ${path.basename(status.file)} export with withTruecanvas() from "truecanvas/next"`);
    }
  }

  // 2. package.json script
  const pkgFile = path.join(root, "package.json");
  try {
    const raw = fs.readFileSync(pkgFile, "utf8");
    const pkg = JSON.parse(raw);
    pkg.scripts ??= {};
    if (!Object.values(pkg.scripts).some((v) => typeof v === "string" && v.includes("truecanvas"))) {
      pkg.scripts.canvas = "truecanvas dev";
      const indent = /\n(\s+)"/.exec(raw)?.[1] ?? "  ";
      fs.writeFileSync(pkgFile, `${JSON.stringify(pkg, null, indent)}\n`);
      report.done.push(`Added the "canvas" script (npm run canvas)`);
    }
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (!("tailwindcss" in deps)) report.todo.push("Tailwind CSS isn't installed: layout and style controls write Tailwind classes");
    if (!("next" in deps)) report.todo.push("Next.js isn't in package.json: Truecanvas currently needs a Next.js (App Router) app");
  } catch {
    report.todo.push("Couldn't read package.json");
  }

  // 3. .gitignore for the generated route
  const ignoreFile = path.join(root, ".gitignore");
  const entry = `/${config.appDir}/truecanvas/`;
  const ignore = fs.existsSync(ignoreFile) ? fs.readFileSync(ignoreFile, "utf8") : "";
  if (!ignore.split("\n").some((l) => l.trim() === entry || l.trim() === entry.slice(1))) {
    fs.writeFileSync(ignoreFile, `${ignore}${ignore && !ignore.endsWith("\n") ? "\n" : ""}\n# Truecanvas (generated dev-only route)\n${entry}\n`);
    report.done.push(`Ignored ${entry} in .gitignore`);
  }

  // 4. Tailwind v3 only generates classes for files listed in `content`
  for (const name of ["tailwind.config.ts", "tailwind.config.js", "tailwind.config.mjs", "tailwind.config.cjs"]) {
    const file = path.join(root, name);
    if (!fs.existsSync(file)) continue;
    const src = fs.readFileSync(file, "utf8");
    const glob = `./${config.canvasDir}/**/*.{ts,tsx}`;
    if (src.includes(config.canvasDir)) break;
    const m = /content\s*:\s*\[([ \t]*\n?)([ \t]*)/.exec(src);
    if (m) {
      const indent = m[2] || "    ";
      const at = m.index + m[0].length;
      const entry = m[1].includes("\n") ? `${JSON.stringify(glob)},\n${indent}` : `${JSON.stringify(glob)}, `;
      fs.writeFileSync(file, src.slice(0, at) + entry + src.slice(at));
      report.done.push(`Added ${config.canvasDir} to Tailwind's content in ${name}`);
    } else report.todo.push(`Add "${glob}" to the content list in ${name} so Tailwind styles your canvases`);
    break;
  }

  // 5. app router check
  if (!fs.existsSync(path.join(root, config.appDir))) report.todo.push(`No ${config.appDir}/ folder found: Truecanvas needs the Next.js App Router`);
  return report;
}

/** Inserts an import after the last existing import (or after a "use client" directive). */
function addImport(src: string, line: string): string {
  const lines = src.split("\n");
  let at = 0;
  lines.forEach((l, i) => {
    if (/^\s*import\s/.test(l) || /^\s*["']use (client|server)["']/.test(l)) at = i + 1;
  });
  // multi-line imports: move past the closing line
  while (at > 0 && at < lines.length && !/;\s*$|from\s+["'][^"']+["']\s*;?\s*$/.test(lines[at - 1])) at++;
  lines.splice(at, 0, line);
  return lines.join("\n");
}
