import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/*
 * Installing Truecanvas into a project: which package manager, which package
 * (the npm release, or a fresh tarball when running from a source checkout),
 * and the agent config files.
 */

export type Pm = "npm" | "pnpm" | "yarn" | "bun";

/** The project's package manager: its lockfile, else the one running us (npx, pnpm dlx…), else npm. */
export function detectPm(dir: string): Pm {
  for (let d = dir; ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, "pnpm-lock.yaml")) || fs.existsSync(path.join(d, "pnpm-workspace.yaml"))) return "pnpm";
    if (fs.existsSync(path.join(d, "yarn.lock"))) return "yarn";
    if (fs.existsSync(path.join(d, "bun.lock")) || fs.existsSync(path.join(d, "bun.lockb"))) return "bun";
    if (fs.existsSync(path.join(d, "package-lock.json"))) return "npm";
    if (path.dirname(d) === d || fs.existsSync(path.join(d, ".git"))) break;
  }
  const agent = process.env.npm_config_user_agent ?? "";
  if (agent.startsWith("pnpm")) return "pnpm";
  if (agent.startsWith("yarn")) return "yarn";
  if (agent.startsWith("bun")) return "bun";
  return "npm";
}

export function addDevArgs(pm: Pm, spec: string): string[] {
  return pm === "npm" ? ["install", "-D", spec] : pm === "bun" ? ["add", "-d", spec] : ["add", "-D", spec];
}

/** `npm run canvas` in the project's own words. */
export function runScript(pm: Pm, script: string) {
  return pm === "npm" ? `npm run ${script}` : `${pm} ${script}`;
}

export type Exec = (cmd: string, args: string[], cwd: string) => Promise<void>;

/** Runs a command with its output passed through (CLI) . */
export const execInherit: Exec = (cmd, args, cwd) =>
  new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, stdio: "inherit", env: { ...process.env, PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? ""}` } });
    p.on("error", reject);
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(" ")} exited with ${code}`))));
  });

/** This package's folder (dist/.. of the running CLI). */
export function packageDir(cliFile: string) {
  return path.resolve(path.dirname(cliFile), "..");
}

export function packageVersion(pkgDir: string): string {
  try {
    return JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8")).version;
  } catch {
    return "0.0.0";
  }
}

/** Running from a git checkout of Truecanvas (not an installed package)? */
export function isSourceCheckout(pkgDir: string) {
  return !pkgDir.split(path.sep).includes("node_modules") && fs.existsSync(path.join(pkgDir, "src", "cli"));
}

/**
 * What to install: `truecanvas@<this version>` from npm, or, from a source
 * checkout, a tarball of this build named by its content (package managers
 * reuse what they installed from an unchanged path).
 */
export async function packageSpec(pkgDir: string, exec: Exec): Promise<string> {
  if (process.env.TRUECANVAS_PACKAGE) return process.env.TRUECANVAS_PACKAGE;
  const version = packageVersion(pkgDir);
  if (!isSourceCheckout(pkgDir)) return `truecanvas@${version}`;
  const cacheDir = path.join(os.homedir(), ".cache", "truecanvas");
  fs.mkdirSync(cacheDir, { recursive: true });
  const file = path.join(cacheDir, `truecanvas-${version}.tgz`);
  await exec("npm", ["pack", "--silent", "--pack-destination", cacheDir], pkgDir);
  const hash = createHash("sha256").update(fs.readFileSync(file)).digest("hex").slice(0, 10);
  const named = path.join(cacheDir, `truecanvas-${version}-${hash}.tgz`);
  fs.renameSync(file, named);
  return named;
}

/** Is Truecanvas a dependency of the project, and installed? */
export function installedIn(root: string): { declared: boolean; installed: boolean; version: string | null } {
  let declared = false;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    declared = "truecanvas" in { ...pkg.dependencies, ...pkg.devDependencies };
  } catch {
    /* no package.json */
  }
  const file = path.join(root, "node_modules", "truecanvas", "package.json");
  const installed = fs.existsSync(file);
  return { declared, installed, version: installed ? packageVersion(path.dirname(file)) : null };
}

export function readPackage(root: string): { name?: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string>; scripts?: Record<string, string> } | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  } catch {
    return null;
  }
}

export function depVersion(root: string, name: string): string | null {
  const file = path.join(root, "node_modules", name, "package.json");
  if (fs.existsSync(file)) return packageVersion(path.dirname(file));
  const pkg = readPackage(root);
  return pkg ? ({ ...pkg.dependencies, ...pkg.devDependencies }[name] ?? null) : null;
}

// ---------- agents ----------

export interface ConnectResult {
  written: string[];
  unchanged: string[];
}

function mergeJson(file: string, update: (data: Record<string, unknown>) => void): "written" | "unchanged" {
  let data: Record<string, unknown> = {};
  if (fs.existsSync(file)) {
    try {
      data = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      throw new Error(`${file} isn't valid JSON; fix it or remove it, then run connect again.`);
    }
  }
  const before = JSON.stringify(data);
  update(data);
  if (JSON.stringify(data) === before) return "unchanged";
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
  return "written";
}

/**
 * Registers the Truecanvas MCP server for agents, in project files that get
 * committed: everyone who clones the repo has it. `.mcp.json` (Claude Code and
 * others), plus Cursor and VS Code when the project uses them.
 */
export function connectAgents(root: string, port: number, opts: { cursor?: boolean; vscode?: boolean } = {}): ConnectResult {
  const url = `http://localhost:${port}/mcp`;
  const out: ConnectResult = { written: [], unchanged: [] };
  const add = (rel: string, update: (d: Record<string, unknown>) => void) => out[mergeJson(path.join(root, rel), update)].push(rel);
  const servers = (d: Record<string, unknown>, key: string) => ((d[key] ??= {}) as Record<string, unknown>);
  add(".mcp.json", (d) => void (servers(d, "mcpServers").truecanvas = { type: "http", url }));
  if (opts.cursor || fs.existsSync(path.join(root, ".cursor"))) add(".cursor/mcp.json", (d) => void (servers(d, "mcpServers").truecanvas = { url }));
  if (opts.vscode || fs.existsSync(path.join(root, ".vscode"))) add(".vscode/mcp.json", (d) => void (servers(d, "servers").truecanvas = { type: "http", url }));
  return out;
}

export function hasAgentConfig(root: string, port?: number): boolean {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(root, ".mcp.json"), "utf8"));
    const url: unknown = d?.mcpServers?.truecanvas?.url;
    return typeof url === "string" && (port === undefined || url.includes(`:${port}/`));
  } catch {
    return false;
  }
}
