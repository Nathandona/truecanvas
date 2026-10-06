import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/*
 * The project's package manager, and running commands in its own words:
 * `pnpm add lucide-react`, `bunx shadcn@latest add button`…
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

/** `npm install -D x` / `pnpm add x`… */
export function addArgs(pm: Pm, specs: string[], dev = false): string[] {
  if (pm === "npm") return ["install", ...(dev ? ["-D"] : []), ...specs];
  if (pm === "bun") return ["add", ...(dev ? ["-d"] : []), ...specs];
  return ["add", ...(dev ? ["-D"] : []), ...specs];
}

/** Runs a package's binary without installing it: npx, pnpm dlx, yarn dlx, bunx. */
export function dlx(pm: Pm, pkg: string, args: string[]): [string, string[]] {
  if (pm === "pnpm") return ["pnpm", ["dlx", pkg, ...args]];
  if (pm === "yarn") return ["yarn", ["dlx", pkg, ...args]];
  if (pm === "bun") return ["bunx", [pkg, ...args]];
  return ["npx", ["--yes", pkg, ...args]];
}

/** PATH with this Node first, so `npx` and friends match the running Node. */
export function toolEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { ...process.env, PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? ""}`, ...extra };
}

/**
 * Runs a command to completion and returns its combined output. Never waits on
 * a prompt: stdin is closed, CI=1 makes CLIs pick defaults, and it times out.
 */
export function run(cmd: string, args: string[], cwd: string, timeoutMs = 300_000): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    let out = "";
    let done = false;
    const finish = (ok: boolean, extra = "") => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ ok, out: (out + extra).slice(-20_000) });
    };
    const p = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"], env: toolEnv({ CI: "1", FORCE_COLOR: "0", NO_COLOR: "1" }), shell: process.platform === "win32" });
    const timer = setTimeout(() => {
      p.kill();
      finish(false, `\n${cmd} timed out after ${Math.round(timeoutMs / 1000)}s`);
    }, timeoutMs);
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("error", (err) => finish(false, `\n${err.message}`));
    p.on("close", (code) => finish(code === 0));
  });
}
