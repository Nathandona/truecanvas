import fs from "node:fs";
import path from "node:path";
import { globSync } from "tinyglobby";
import { posix } from "./paths.js";

const GROUPS: [prefix: string, title: string, usage: string][] = [
  ["--color-", "Colors", "bg-{name} text-{name} border-{name}"],
  ["--font-", "Fonts", "font-{name}"],
  ["--text-", "Text sizes", "text-{name}"],
  ["--radius-", "Radius", "rounded-{name}"],
  ["--shadow-", "Shadows", "shadow-{name}"],
  ["--spacing", "Spacing", "p-*, gap-*, m-* (multiples of the base)"],
  ["--breakpoint-", "Breakpoints", "{name}:"],
];

/**
 * Reads Tailwind v4 `@theme` blocks so agents use the project's real tokens
 * (bg-surface, text-text-muted…) instead of guessing class names.
 */
export function readDesignTokens(root: string): string {
  const files = globSync(["**/*.css"], { cwd: root, ignore: ["**/node_modules/**", "**/.next/**", "**/dist/**", "**/out/**"], absolute: true }).slice(0, 40);
  const found = new Map<string, Map<string, string>>();
  const sources: string[] = [];
  let darkVariant: string | null = null;
  for (const file of files) {
    const css = fs.readFileSync(file, "utf8");
    if (!css.includes("@theme") && !css.includes("@custom-variant")) continue;
    sources.push(posix(path.relative(root, file)));
    const dv = /@custom-variant\s+dark\s*\(([^;]+)\);/.exec(css);
    if (dv) darkVariant = dv[1].trim();
    for (const block of css.matchAll(/@theme[^{]*\{([\s\S]*?)\n\}/g)) {
      for (const decl of block[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
        const [, name, value] = decl;
        const group = GROUPS.find(([prefix]) => name.startsWith(prefix));
        if (!group) continue;
        const key = group[1];
        if (!found.has(key)) found.set(key, new Map());
        const short = group[0] === "--spacing" ? name : name.slice(group[0].length);
        if (short.includes("*")) continue;
        found.get(key)!.set(short, value.trim());
      }
    }
  }
  if (!found.size) return "No Tailwind @theme tokens found. Use Tailwind's default palette (e.g. bg-white, text-zinc-500).";
  const lines = [`Design tokens from ${sources.join(", ")}. Prefer these over Tailwind defaults.`];
  for (const [prefix, title, usage] of GROUPS) {
    const entries = found.get(title);
    if (!entries?.size) continue;
    lines.push("", `${title} (use as ${usage}):`);
    const names = [...entries.keys()];
    if (title === "Colors") lines.push(names.join(", "));
    else lines.push(names.map((n) => `${n} (${entries.get(n)})`).join(", "));
    void prefix;
  }
  if (darkVariant) lines.push("", `Dark mode: dark: variant → ${darkVariant}. Tokens already adapt; avoid hard-coded colors.`);
  return lines.join("\n");
}

export interface TokenData {
  /** color utilities usable as bg-{name}, text-{name}, border-{name}; values resolved for swatches */
  colors: { name: string; light: string; dark: string | null }[];
  radius: string[];
  shadows: string[];
  textSizes: string[];
  fonts: string[];
}

/** Structured tokens for the editor's pickers (Fill, Stroke, Text…). */
export function readTokenData(root: string): TokenData {
  const files = globSync(["**/*.css"], { cwd: root, ignore: ["**/node_modules/**", "**/.next/**", "**/dist/**", "**/out/**"], absolute: true }).slice(0, 40);
  const theme = new Map<string, string>();
  const lightVars = new Map<string, string>();
  const darkVars = new Map<string, string>();
  const decls = (body: string, into: Map<string, string>) => {
    for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) into.set(m[1], m[2].trim());
  };
  for (const file of files) {
    const css = fs.readFileSync(file, "utf8");
    for (const block of css.matchAll(/@theme[^{]*\{([\s\S]*?)\n\}/g)) decls(block[1], theme);
    for (const block of css.matchAll(/(?:^|\n)\s*:root\s*\{([\s\S]*?)\n\}/g)) decls(block[1], lightVars);
    for (const block of css.matchAll(/(?:^|\n)\s*(?:\.dark|\[data-theme=["']?dark["']?\]|:root\.dark)\s*\{([\s\S]*?)\n\}/g)) decls(block[1], darkVars);
  }
  const resolve = (value: string, vars: Map<string, string>, depth = 0): string => {
    const m = /^var\((--[\w-]+)(?:,\s*([^)]+))?\)$/.exec(value.trim());
    if (!m || depth > 5) return value;
    const next = vars.get(m[1]) ?? lightVars.get(m[1]) ?? m[2];
    return next ? resolve(next, vars, depth + 1) : value;
  };
  const pick = (prefix: string) => [...theme.keys()].filter((k) => k.startsWith(prefix) && !k.includes("*")).map((k) => k.slice(prefix.length));
  const colors = pick("--color-").map((name) => {
    const raw = theme.get(`--color-${name}`)!;
    const light = resolve(raw, lightVars);
    const dark = resolve(raw, darkVars);
    return { name, light, dark: dark !== light ? dark : null };
  });
  const custom = (prefix: string, defaults: string[]) => {
    const names = pick(prefix).filter((n) => !n.includes("--"));
    return names.length ? [...new Set([...defaults, ...names])] : defaults;
  };
  return {
    colors,
    radius: custom("--radius-", ["xs", "sm", "md", "lg", "xl", "2xl", "3xl", "4xl"]),
    shadows: custom("--shadow-", ["2xs", "xs", "sm", "md", "lg", "xl", "2xl"]),
    textSizes: custom("--text-", ["xs", "sm", "base", "lg", "xl", "2xl", "3xl", "4xl", "5xl", "6xl", "7xl"]),
    fonts: custom("--font-", ["sans", "serif", "mono"]),
  };
}
