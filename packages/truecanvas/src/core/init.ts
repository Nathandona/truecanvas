import fs from "node:fs";
import MagicString from "magic-string";
import { parseModule, walk } from "./ast.js";
import path from "node:path";
import { detectFramework, type Framework, type TruecanvasConfig } from "./config.js";

export interface InitReport {
  done: string[];
  todo: string[];
}

const CONFIG_FILES: Record<Framework, string[]> = {
  next: ["next.config.ts", "next.config.mjs", "next.config.js", "next.config.mts"],
  vite: ["vite.config.ts", "vite.config.mts", "vite.config.js", "vite.config.mjs"],
};

/** The app's framework from its package.json (Next.js unless only Vite is there). */
export function projectFramework(root: string): Framework {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    return detectFramework({ ...pkg.dependencies, ...pkg.devDependencies });
  } catch {
    return "next";
  }
}

/** Does the app's next.config / vite.config already enable Truecanvas? */
export function configStatus(root: string, framework = projectFramework(root)): { file: string | null; wrapped: boolean; framework: Framework } {
  const marker = framework === "vite" ? "truecanvas/vite" : "withTruecanvas";
  for (const name of CONFIG_FILES[framework]) {
    const file = path.join(root, name);
    if (fs.existsSync(file)) return { file, wrapped: fs.readFileSync(file, "utf8").includes(marker), framework };
  }
  return { file: null, wrapped: false, framework };
}

/**
 * Sets up a Next.js or Vite project: enables the plugin in its config, adds a
 * `canvas` script and ignores the generated route. Every step is idempotent
 * and reported.
 */
export function initProject(config: TruecanvasConfig): InitReport {
  const { root } = config;
  const report: InitReport = { done: [], todo: [] };
  const vite = config.framework === "vite";

  // 1. next.config / vite.config
  const status = configStatus(root, config.framework);
  if (vite) {
    const name = status.file ? path.basename(status.file) : "vite.config.ts";
    if (status.wrapped) report.done.push(`${name} already uses the truecanvas() plugin`);
    else {
      const src = status.file ? fs.readFileSync(status.file, "utf8") : null;
      const next = src && addVitePlugin(src);
      if (next) {
        fs.writeFileSync(status.file!, next);
        report.done.push(`Added the truecanvas() plugin to ${name}`);
      } else report.todo.push(`Add truecanvas() from "truecanvas/vite" to the plugins in ${name}`);
    }
  } else if (!status.file) {
    const file = path.join(root, "next.config.ts");
    fs.writeFileSync(file, `import type { NextConfig } from "next";\nimport { withTruecanvas } from "truecanvas/next";\n\nconst nextConfig: NextConfig = {};\n\nexport default withTruecanvas(nextConfig);\n`);
    report.done.push("Created next.config.ts with withTruecanvas()");
  } else if (status.wrapped) {
    report.done.push(`${path.basename(status.file)} already uses withTruecanvas()`);
  } else {
    const src = fs.readFileSync(status.file, "utf8");
    const next = wrapConfigExport(src);
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
    if (!("next" in deps) && !("vite" in deps)) report.todo.push("Neither Next.js nor Vite is in package.json: Truecanvas needs a Next.js (App Router) or Vite + React app");
  } catch {
    report.todo.push("Couldn't read package.json");
  }

  // 3. .gitignore for the generated route
  const ignoreFile = path.join(root, ".gitignore");
  const entry = `/${config.routeDir}/`;
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
  if (!vite && !fs.existsSync(path.join(root, config.appDir))) report.todo.push(`No ${config.appDir}/ folder found: Truecanvas needs the Next.js App Router`);
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

/**
 * Wraps a next.config's export in withTruecanvas(), touching only the exported
 * expression: comments and code after it stay as they are. Null when the
 * export can't be found (the user is told to wrap it by hand).
 */
export function wrapConfigExport(src: string): string | null {
  let ast;
  try {
    ast = parseModule(src);
  } catch {
    return null;
  }
  const s = new MagicString(src);
  for (const stmt of ast.program.body) {
    if (stmt.type === "ExportDefaultDeclaration") {
      const d = stmt.declaration;
      if (d.type === "FunctionDeclaration" && d.id) {
        // export default function config(phase) {…}: keep the function, export it wrapped
        s.remove(stmt.start!, d.start!);
        s.appendLeft(stmt.end!, `\n\nexport default withTruecanvas(${d.id.name});`);
      } else if (d.type === "FunctionDeclaration" || d.type === "ArrowFunctionExpression" || d.type.endsWith("Expression") || d.type === "Identifier") {
        s.appendLeft(d.start!, "withTruecanvas(");
        s.appendRight(d.end!, ")");
      } else return null;
      return addImport(s.toString(), `import { withTruecanvas } from "truecanvas/next";`);
    }
    if (stmt.type === "ExpressionStatement" && stmt.expression.type === "AssignmentExpression") {
      const { left, right } = stmt.expression;
      const isModuleExports = left.type === "MemberExpression" && left.object.type === "Identifier" && left.object.name === "module" && left.property.type === "Identifier" && left.property.name === "exports";
      if (!isModuleExports) continue;
      s.appendLeft(right.start!, "withTruecanvas(");
      s.appendRight(right.end!, ")");
      return `const { withTruecanvas } = require("truecanvas/next");\n${s.toString()}`;
    }
  }
  return null;
}

/**
 * Adds `truecanvas()` to a vite.config's plugins array, touching nothing
 * else. Null when there's no plugins array to add it to.
 */
export function addVitePlugin(src: string): string | null {
  let ast;
  try {
    ast = parseModule(src);
  } catch {
    return null;
  }
  let plugins: { start: number; end: number; elements: { start: number; end: number }[] } | null = null;
  walk(ast, (node) => {
    if (plugins) return false;
    if (node.type !== "ObjectProperty" || node.value.type !== "ArrayExpression") return;
    const key = node.key.type === "Identifier" ? node.key.name : node.key.type === "StringLiteral" ? node.key.value : null;
    if (key !== "plugins") return;
    plugins = { start: node.value.start!, end: node.value.end!, elements: node.value.elements.filter((e) => e !== null).map((e) => ({ start: e.start!, end: e.end! })) };
    return false;
  });
  if (!plugins) return null;
  const { start, end, elements } = plugins as { start: number; end: number; elements: { start: number; end: number }[] };
  const s = new MagicString(src);
  if (!elements.length) s.overwrite(start, end, "[truecanvas()]");
  else {
    const last = elements[elements.length - 1];
    const before = src.slice(start + 1, elements[0].start);
    // one plugin per line stays one per line
    s.appendLeft(last.end, before.includes("\n") ? `,${before.replace(/^[^\n]*/, "")}truecanvas()` : ", truecanvas()");
  }
  return addImport(s.toString(), `import { truecanvas } from "truecanvas/vite";`);
}
