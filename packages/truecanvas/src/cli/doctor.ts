import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../core/config.js";
import { nextConfigStatus } from "../core/init.js";
import { findChromium } from "../server/screenshot.js";
import { depVersion, detectPm, hasAgentConfig, installedIn, readPackage, runScript } from "./setup.js";

export interface Check {
  label: string;
  status: "ok" | "warn" | "fail";
  detail?: string;
  /** what to run or do about it */
  fix?: string;
}

const major = (v: string | null) => (v ? Number(/(\d+)(?:\.(\d+))?/.exec(v)?.[1] ?? 0) : 0);

function has(cmd: string, args: string[], cwd: string): Promise<string | null> {
  return new Promise((resolve) => execFile(cmd, args, { cwd, timeout: 8000 }, (err, stdout, stderr) => resolve(err ? null : `${stdout}${stderr}`)));
}

/** Everything Truecanvas needs in this project and on this machine, with a fix for each problem. */
export async function doctor(root: string, cliVersion: string): Promise<Check[]> {
  const checks: Check[] = [];
  const add = (c: Check) => checks.push(c);

  const node = process.versions.node;
  add(major(node) >= 20 ? { label: "Node.js", status: "ok", detail: node } : { label: "Node.js", status: "fail", detail: node, fix: "Install Node.js 20 or newer (https://nodejs.org)" });

  const pkg = readPackage(root);
  if (!pkg) {
    add({ label: "Project", status: "fail", detail: "no package.json here", fix: "Run truecanvas from the root of your Next.js app, or create one: npm create truecanvas" });
    return checks;
  }
  const pm = detectPm(root);
  const next = depVersion(root, "next");
  if (!next) add({ label: "Next.js", status: "fail", detail: "not a dependency", fix: "Truecanvas works with Next.js (App Router) apps for now. Create one: npm create truecanvas" });
  else if (major(next) < 15) add({ label: "Next.js", status: "fail", detail: next, fix: `Upgrade to Next.js 15 or newer: ${pm} ${pm === "npm" ? "install" : "add"} next@latest` });
  else add({ label: "Next.js", status: "ok", detail: next });

  const react = depVersion(root, "react");
  add(react && major(react) >= 19 ? { label: "React", status: "ok", detail: react } : { label: "React", status: "fail", detail: react ?? "missing", fix: "Truecanvas needs React 19 (comes with Next.js 15+)" });

  const tw = depVersion(root, "tailwindcss");
  add(tw ? { label: "Tailwind CSS", status: "ok", detail: tw } : { label: "Tailwind CSS", status: "warn", detail: "not installed", fix: "Optional, but the layout and style controls write Tailwind classes" });

  const config = loadConfig(root);
  add(fs.existsSync(path.join(root, config.appDir)) ? { label: "App Router", status: "ok", detail: config.appDir } : { label: "App Router", status: "fail", detail: `no ${config.appDir}/`, fix: "Truecanvas renders through the App Router (app/ or src/app/)" });

  const tc = installedIn(root);
  if (!tc.declared) add({ label: "Truecanvas in the project", status: "fail", detail: "not a dependency", fix: "npx truecanvas  (sets it up)" });
  else if (!tc.installed) add({ label: "Truecanvas in the project", status: "fail", detail: "declared but not installed", fix: `${pm} install` });
  else if (tc.version !== cliVersion) add({ label: "Truecanvas in the project", status: "warn", detail: `${tc.version} (this CLI is ${cliVersion})`, fix: `Use the project's version: ${runScript(pm, "canvas")}, or update: ${pm} ${pm === "npm" ? "install -D" : "add -D"} truecanvas@latest` });
  else add({ label: "Truecanvas in the project", status: "ok", detail: tc.version ?? "" });

  const wrapped = nextConfigStatus(root);
  add(wrapped.wrapped ? { label: "next.config", status: "ok", detail: `${path.basename(wrapped.file!)} uses withTruecanvas()` } : { label: "next.config", status: "fail", detail: wrapped.file ? "not wrapped" : "missing", fix: "npx truecanvas init" });

  const scripts = pkg.scripts ?? {};
  const script = Object.entries(scripts).find(([, v]) => v.includes("truecanvas"));
  add(script ? { label: "Start script", status: "ok", detail: runScript(pm, script[0]) } : { label: "Start script", status: "warn", detail: "none", fix: "npx truecanvas init  (adds \"canvas\": \"truecanvas dev\")" });

  const ignore = fs.existsSync(path.join(root, ".gitignore")) ? fs.readFileSync(path.join(root, ".gitignore"), "utf8") : "";
  add(ignore.includes(`${config.appDir}/truecanvas`) ? { label: "Generated route ignored", status: "ok" } : { label: "Generated route ignored", status: "warn", detail: `${config.appDir}/truecanvas/ isn't in .gitignore`, fix: "npx truecanvas init" });

  add(hasAgentConfig(root) ? { label: "Agents", status: "ok", detail: ".mcp.json lists Truecanvas" } : { label: "Agents", status: "warn", detail: "not connected for this project", fix: "npx truecanvas connect  (then commit .mcp.json)" });

  const chrome = findChromium();
  add(chrome ? { label: "Screenshots", status: "ok", detail: path.basename(chrome) } : { label: "Screenshots", status: "warn", detail: "no Chromium found", fix: "npx playwright install chromium-headless-shell  (or install Chrome)" });

  const git = await has("git", ["rev-parse", "--is-inside-work-tree"], root);
  add(git ? { label: "Git", status: "ok" } : { label: "Git", status: "warn", detail: "not a repository", fix: "git init  (branches, history, comments and compare use git)" });
  const gh = await has("gh", ["auth", "status"], root);
  add(gh !== null ? { label: "GitHub CLI", status: "ok", detail: "signed in" } : { label: "GitHub CLI", status: "warn", detail: "missing or signed out", fix: "Install gh (https://cli.github.com) and run gh auth login  (for pull requests)" });

  const app = await fetch(config.appUrl, { signal: AbortSignal.timeout(1500), redirect: "manual" }).then(() => true).catch(() => false);
  add({ label: "App", status: "ok", detail: app ? `running at ${config.appUrl}` : `not running (truecanvas starts it at ${config.appUrl})` });
  return checks;
}
