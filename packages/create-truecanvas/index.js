#!/usr/bin/env node
// npm create truecanvas [name]: a new Next.js app (TypeScript, Tailwind, App
// Router) with Truecanvas set up, agents connected and everything committed.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[22m`,
  bold: (s) => `\x1b[1m${s}\x1b[22m`,
  accent: (s) => `\x1b[38;5;209m${s}\x1b[39m`,
  green: (s) => `\x1b[32m${s}\x1b[39m`,
  red: (s) => `\x1b[31m${s}\x1b[39m`,
};

const argv = process.argv.slice(2);
if (argv.includes("-h") || argv.includes("--help")) {
  console.log(`Usage: npm create truecanvas [name] [-- --yes]

Creates a Next.js app (TypeScript, Tailwind, App Router) with Truecanvas set up.
Uses the package manager you ran it with (npm, pnpm, yarn or bun).`);
  process.exit(0);
}
const yes = argv.includes("--yes") || argv.includes("-y");
let name = argv.find((a) => !a.startsWith("-"));

const agent = process.env.npm_config_user_agent ?? "";
const pm = agent.startsWith("pnpm") ? "pnpm" : agent.startsWith("yarn") ? "yarn" : agent.startsWith("bun") ? "bun" : "npm";
const run = pm === "npm" ? "npm run" : pm;
// TRUECANVAS_PACKAGE: install a specific build (a tarball path when testing an unreleased version)
const truecanvas = process.env.TRUECANVAS_PACKAGE ?? "truecanvas@latest";

function exec(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, stdio: "inherit", env: process.env });
    p.on("error", reject);
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(" ")} exited with ${code}`))));
  });
}

async function main() {
  console.log(`\n  ${c.accent("◆")} ${c.bold("Truecanvas")} ${c.dim("· design with your real React components")}\n`);
  if (!name) {
    if (yes || !process.stdin.isTTY) name = "my-app";
    else {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      name = (await rl.question(`  Project name ${c.dim("(my-app)")} `)).trim() || "my-app";
      rl.close();
    }
  }
  const safe = name.toLowerCase().replace(/[^a-z0-9-_.]+/g, "-").replace(/^-+|-+$/g, "");
  const dir = path.resolve(safe);
  if (!safe) throw new Error("Pick a project name.");
  if (fs.existsSync(dir) && fs.readdirSync(dir).length) throw new Error(`${dir} already exists and isn't empty.`);

  console.log(`  ${c.dim(`Creating ${safe} with create-next-app (${pm})…`)}\n`);
  await exec("npx", ["--yes", "create-next-app@latest", safe, "--ts", "--tailwind", "--app", "--eslint", "--no-src-dir", "--import-alias", "@/*", "--turbopack", `--use-${pm}`, "--yes"], process.cwd());

  console.log(`\n  ${c.dim("Adding Truecanvas…")}\n`);
  await exec("npx", ["--yes", `--package=${truecanvas}`, "truecanvas", "setup", "--yes"], dir);

  // a clean starting point: everything committed, so the Git panel starts empty
  if (fs.existsSync(path.join(dir, ".git"))) {
    await exec("git", ["add", "-A"], dir).catch(() => {});
    await exec("git", ["commit", "-q", "-m", "Add Truecanvas"], dir).catch(() => {});
  }

  console.log(`
  ${c.green("✓")} ${c.bold(safe)} is ready.

    ${c.accent(`cd ${safe}`)}
    ${c.accent(`${run} canvas`)}     ${c.dim("starts your app and the editor")}

  ${c.dim("Your agent (Claude Code, Cursor) connects through the project's .mcp.json.")}
  ${c.dim("Push it to GitHub and teammates get the same setup with")} ${c.accent(`${pm} install`)}${c.dim(".")}
`);
}

main().catch((err) => {
  console.error(`\n  ${c.red("✗")} ${err.message}\n`);
  process.exit(1);
});
