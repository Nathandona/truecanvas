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

export type Framework = "next" | "vite";

export interface TruecanvasConfig {
  root: string;
  /** The app's framework: Next.js (App Router) or Vite + React. Detected from package.json. */
  framework: Framework;
  /** Where your app's dev server runs. */
  appUrl: string;
  /** Port of the Truecanvas editor + MCP server. */
  port: number;
  /** Folder holding *.canvas.tsx files. */
  canvasDir: string;
  /** Next.js app directory ("app" or "src/app"); for Vite, the source folder. */
  appDir: string;
  /** Generated, dev-only render route (project-relative, gitignored). */
  routeDir: string;
  /** Vite: stylesheets every frame loads (default: the ones your entry module imports). */
  css?: string[];
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
  let deps: Record<string, string> = {};
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    deps = { ...pkg.dependencies, ...pkg.devDependencies };
  } catch {
    deps = {};
  }
  const framework = file.framework ?? detectFramework(deps);
  const vite = framework === "vite";
  const appDir = file.appDir ?? (vite ? (fs.existsSync(path.join(root, "src")) ? "src" : ".") : fs.existsSync(path.join(root, "src/app")) ? "src/app" : "app");
  const srcPrefix = appDir === "src" || appDir.startsWith("src/") ? "src/" : "";
  // component libraries we know how to present nicely, picked up when installed
  const knownLibraries = ["@paper-design/shaders-react"].filter((l) => l in deps);
  return {
    root,
    framework,
    appUrl: vite ? "http://localhost:5173" : "http://localhost:3000",
    port: 4800,
    canvasDir: `${srcPrefix}canvas`,
    appDir,
    routeDir: vite ? ".truecanvas" : `${appDir}/truecanvas`,
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

/** Next.js when it's a dependency, else Vite when it is (Vite + React apps). */
export function detectFramework(deps: Record<string, unknown>): Framework {
  return !("next" in deps) && "vite" in deps ? "vite" : "next";
}
