import fs from "node:fs";
import path from "node:path";

export interface DarkMode {
  /** "class": toggles a class on <html>. "attribute": sets an attribute on <html>. */
  strategy: "class" | "attribute";
  /** Class name (class strategy) or attribute value (attribute strategy). */
  value: string;
  /** Attribute name for the attribute strategy, e.g. "data-theme". */
  attribute?: string;
  /** Value written for light mode with the attribute strategy. */
  lightValue?: string;
}

export interface TruecanvasConfig {
  root: string;
  /** Where your Next.js dev server runs. */
  appUrl: string;
  /** Port of the Truecanvas editor + MCP server. */
  port: number;
  /** Folder holding *.canvas.tsx files. */
  canvasDir: string;
  /** Next.js app directory ("app" or "src/app"). */
  appDir: string;
  /** Globs of component files shown in the Components panel. */
  components: string[];
  darkMode: DarkMode;
  /** npm packages whose components appear in the Components panel (auto-detects known ones). */
  libraries: string[];
  /** Editor used for "Open in editor" (code, zed, cursor, webstorm…). Defaults to auto-detect. */
  editor?: string;
}

export function loadConfig(root: string, overrides: Partial<TruecanvasConfig> = {}): TruecanvasConfig {
  let file: Partial<TruecanvasConfig> = {};
  const configPath = path.join(root, "truecanvas.config.json");
  if (fs.existsSync(configPath)) file = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const appDir = file.appDir ?? (fs.existsSync(path.join(root, "src/app")) ? "src/app" : "app");
  const srcPrefix = appDir.startsWith("src/") ? "src/" : "";
  // component libraries we know how to present nicely, picked up when installed
  let deps: Record<string, string> = {};
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    deps = { ...pkg.dependencies, ...pkg.devDependencies };
  } catch {
    deps = {};
  }
  const knownLibraries = ["@paper-design/shaders-react"].filter((l) => l in deps);
  return {
    root,
    appUrl: "http://localhost:3000",
    port: 4800,
    canvasDir: `${srcPrefix}canvas`,
    appDir,
    components: [`${srcPrefix}components/**/*.tsx`],
    darkMode: { strategy: "class", value: "dark" },
    ...file,
    libraries: [...new Set([...knownLibraries, ...(file.libraries ?? [])])],
    ...stripUndefined(overrides),
  };
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
