import { fileURLToPath } from "node:url";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import type { NextConfig } from "next";

/**
 * Enables Truecanvas in development: canvas files (`*.canvas.tsx`), pages and
 * layouts get their JSX stamped with source ids so the editor can map pixels
 * back to code.
 * In production builds the config is returned untouched.
 */
export function withTruecanvas(config: NextConfig = {}): NextConfig {
  if (process.env.NODE_ENV === "production") return config;
  const loader = fileURLToPath(new URL("./loader.cjs", import.meta.url));
  warnIfLinkedOutside(loader);
  const userWebpack = config.webpack;
  const root = process.cwd();
  const appDir = existsSync(join(root, "src/app")) ? "src/app" : "app";
  const components = componentRoots(root, appDir);
  const options = { root, appDir, components };
  const rule: Record<string, unknown> = {
    "*.canvas.tsx": { loaders: [loader], as: "*.tsx" },
    // pages and layouts, for linked frames (the loader skips anything outside this project's app dir)
    [`**/${appDir}/**/{page,layout}.{tsx,jsx}`]: { loaders: [{ loader, options }] },
  };
  // component files, for main component frames
  for (const dir of components) rule[`**/${dir}/**/*.{tsx,jsx}`] = { loaders: [{ loader, options }] };
  // Next 15.3+ reads `turbopack`; earlier 15.x reads `experimental.turbo`
  const legacy = nextVersion() < 15.3;
  const turbo = legacy
    ? { experimental: { ...config.experimental, turbo: { ...(config.experimental as { turbo?: { rules?: object } })?.turbo, rules: { ...(config.experimental as { turbo?: { rules?: object } })?.turbo?.rules, ...rule } } } }
    : { turbopack: { ...config.turbopack, rules: { ...config.turbopack?.rules, ...rule } } };
  return {
    ...config,
    ...(turbo as NextConfig),
    webpack(webpackConfig: { module: { rules: unknown[] } }, ctx: unknown) {
      webpackConfig.module.rules.push({ test: /\.canvas\.tsx$/, enforce: "pre", use: [loader] });
      webpackConfig.module.rules.push({ test: /[\\/](page|layout)\.[jt]sx$/, enforce: "pre", use: [{ loader, options }] });
      webpackConfig.module.rules.push({ test: /\.[jt]sx$/, include: components.map((d) => join(root, d)), enforce: "pre", use: [{ loader, options }] });
      return userWebpack ? userWebpack(webpackConfig, ctx as never) : webpackConfig;
    },
  };
}

export default withTruecanvas;

/** Turbopack can't load packages symlinked from outside the project (e.g. `pnpm link`). */
function warnIfLinkedOutside(file: string) {
  try {
    const real = realpathSync(file);
    const root = realpathSync(workspaceRoot(process.cwd()));
    const rel = relative(root, real);
    // fine: installed in node_modules, or part of the same monorepo (Turbopack's root is the workspace)
    const insideWorkspace = !rel.startsWith("..") || /node_modules/.test(real);
    if (!insideWorkspace) {
      console.warn(
        "\n[truecanvas] This project uses a linked copy of truecanvas from outside the project folder.\n" +
          "Turbopack can't load it. Install a packed build instead: run `pnpm pack:local` in the truecanvas repo,\n" +
          "then `pnpm add -D /path/to/truecanvas-<version>.tgz` here.\n",
      );
    }
  } catch {
    /* best effort */
  }
}

/** Folders of the project's components: truecanvas.config.json "components" globs, else (src/)components. */
function componentRoots(root: string, appDir: string): string[] {
  let globs: string[] = [`${appDir.startsWith("src/") ? "src/" : ""}components/**/*.tsx`];
  try {
    const file = JSON.parse(readFileSync(join(root, "truecanvas.config.json"), "utf8"));
    if (Array.isArray(file.components)) globs = file.components;
  } catch {
    /* defaults */
  }
  return [...new Set(globs.map((g: string) => g.split("/").filter((p) => !p.includes("*")).join("/")).filter(Boolean))];
}

function workspaceRoot(dir: string): string {
  for (let d = dir; ; ) {
    if (existsSync(join(d, "pnpm-workspace.yaml"))) return d;
    try {
      if (JSON.parse(readFileSync(join(d, "package.json"), "utf8")).workspaces) return d;
    } catch {
      /* no package.json here */
    }
    const up = dirname(d);
    if (up === d) return dir;
    d = up;
  }
}

/** major.minor of the project's Next.js, e.g. 15.1 (0 if unknown). */
function nextVersion(): number {
  try {
    const require = createRequire(join(process.cwd(), "package.json"));
    const v = (require("next/package.json") as { version: string }).version;
    const [major, minor] = v.split(".").map(Number);
    return major + minor / 10;
  } catch {
    return 99;
  }
}
