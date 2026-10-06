#!/usr/bin/env node
// npm create truecanvas [name]: a new Next.js (App Router) or Vite + React app,
// with TypeScript and Tailwind, Truecanvas set up, agents connected and
// everything committed.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";

// plain text when piped, in CI logs or with NO_COLOR
const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (open, close) => (s) => (color ? `\x1b[${open}m${s}\x1b[${close}m` : s);
const c = {
  dim: paint("2", "22"),
  bold: paint("1", "22"),
  accent: paint("38;5;209", "39"),
  green: paint("32", "39"),
  red: paint("31", "39"),
};

const argv = process.argv.slice(2);
if (argv.includes("-h") || argv.includes("--help")) {
  console.log(`Usage: npm create truecanvas [name] [-- --vite | --next] [--yes]

Creates an app with TypeScript, Tailwind and Truecanvas set up:
  --next   Next.js with the App Router (the default)
  --vite   Vite + React
Uses the package manager you ran it with (npm, pnpm, yarn or bun).`);
  process.exit(0);
}
const yes = argv.includes("--yes") || argv.includes("-y");
let name = argv.find((a) => !a.startsWith("-"));
let framework = argv.includes("--vite") ? "vite" : argv.includes("--next") ? "next" : null;

const agent = process.env.npm_config_user_agent ?? "";
const pm = agent.startsWith("pnpm") ? "pnpm" : agent.startsWith("yarn") ? "yarn" : agent.startsWith("bun") ? "bun" : "npm";
const run = pm === "npm" ? "npm run" : pm;
// TRUECANVAS_PACKAGE: install a specific build (a tarball path when testing an unreleased version)
const truecanvas = process.env.TRUECANVAS_PACKAGE ?? "truecanvas@latest";

// npx, npm and pnpm are .cmd scripts on Windows: they start through a shell there, with quoted arguments
const win = process.platform === "win32";
const quote = (a) => (win && /[\s"&|<>^()%!]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a);

function exec(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    const p = spawn(quote(cmd), args.map(quote), { cwd, stdio: "inherit", env: process.env, shell: win });
    p.on("error", reject);
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(" ")} exited with ${code}`))));
  });
}

async function main() {
  console.log(`\n  ${c.accent("◆")} ${c.bold("Truecanvas")} ${c.dim("· design with your real React components")}\n`);
  const interactive = !yes && process.stdin.isTTY;
  if (!name || !framework) {
    if (!interactive) {
      name ??= "my-app";
      framework ??= "next";
    } else {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      if (!name) name = (await rl.question(`  Project name ${c.dim("(my-app)")} `)).trim() || "my-app";
      if (!framework) {
        const answer = (await rl.question(`  Framework: ${c.bold("N")}ext.js or ${c.bold("V")}ite? ${c.dim("(Next.js)")} `)).trim().toLowerCase();
        framework = answer.startsWith("v") ? "vite" : "next";
      }
      rl.close();
    }
  }
  const safe = name.toLowerCase().replace(/[^a-z0-9-_.]+/g, "-").replace(/^-+|-+$/g, "");
  const dir = path.resolve(safe);
  if (!safe) throw new Error("Pick a project name.");
  if (fs.existsSync(dir) && fs.readdirSync(dir).length) throw new Error(`${dir} already exists and isn't empty.`);

  if (framework === "vite") await createVite(safe, dir);
  else {
    console.log(`  ${c.dim(`Creating ${safe} with create-next-app (${pm})…`)}\n`);
    await exec("npx", ["--yes", "create-next-app@latest", safe, "--ts", "--tailwind", "--app", "--eslint", "--no-src-dir", "--import-alias", "@/*", "--turbopack", `--use-${pm}`, "--yes"], process.cwd());
  }

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

/**
 * Vite's React + TypeScript template, made to match the Next.js starter:
 * Tailwind CSS (its Vite plugin), the `@/` import alias (what shadcn/ui
 * expects) and a git repository.
 */
async function createVite(safe, dir) {
  console.log(`  ${c.dim(`Creating ${safe} with create-vite (${pm})…`)}\n`);
  await exec("npx", ["--yes", "create-vite@latest", safe, "--template", "react-ts", "--no-interactive"], process.cwd());
  console.log(`\n  ${c.dim("Installing dependencies and Tailwind CSS…")}\n`);
  await exec(pm, ["install"], dir);
  await exec(pm, [pm === "npm" ? "install" : "add", pm === "bun" ? "-d" : "-D", "tailwindcss", "@tailwindcss/vite"], dir);

  const edit = (file, change) => {
    const abs = path.join(dir, file);
    if (!fs.existsSync(abs)) return;
    const before = fs.readFileSync(abs, "utf8");
    const after = change(before);
    if (after !== before) fs.writeFileSync(abs, after);
  };
  edit("vite.config.ts", (src) =>
    src
      .replace(/(import react from ['"]@vitejs\/plugin-react['"]\n)/, `$1import tailwindcss from '@tailwindcss/vite'\nimport path from 'node:path'\n`)
      .replace(/plugins:\s*\[react\(\)\],?/, `plugins: [react(), tailwindcss()],\n  resolve: {\n    alias: { '@': path.resolve(__dirname, './src') },\n  },`),
  );
  edit("src/index.css", (src) => `@import "tailwindcss";\n\n${src}`);
  // the @/ alias, for TypeScript in the editor and for tools reading the root tsconfig (shadcn, Truecanvas)
  edit("tsconfig.app.json", (src) => src.replace(/"compilerOptions":\s*\{/, `"compilerOptions": {\n    "paths": { "@/*": ["./src/*"] },`));
  edit("tsconfig.json", (src) => (src.includes('"compilerOptions"') ? src : src.replace(/^\{/, `{\n  "compilerOptions": {\n    "paths": { "@/*": ["./src/*"] }\n  },`)));

  if (!fs.existsSync(path.join(dir, ".git"))) {
    await exec("git", ["init", "-q"], dir).catch(() => {});
    await exec("git", ["add", "-A"], dir).catch(() => {});
    await exec("git", ["commit", "-q", "-m", "Create Vite app"], dir).catch(() => {});
  }
}

main().catch((err) => {
  console.error(`\n  ${c.red("✗")} ${err.message}\n`);
  process.exit(1);
});
