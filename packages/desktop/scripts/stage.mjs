// Stages the truecanvas package the app ships: packed from the workspace (built
// first with `pnpm build` at the root), then installed with its production
// dependencies into build/runtime. The app loads the hub from there, and runs
// its CLI with the user's Node for projects that don't have Truecanvas yet.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const here = path.resolve(import.meta.dirname, "..");
const pkgDir = path.resolve(here, "..", "truecanvas");
const out = path.join(here, "build", "runtime");
if (!fs.existsSync(path.join(pkgDir, "dist", "hub.js"))) {
  console.error("✗ Build truecanvas first: pnpm build (at the repository root).");
  process.exit(1);
}
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const run = (args, cwd) => execFileSync(npm, args, { cwd, stdio: ["ignore", "pipe", "inherit"], shell: process.platform === "win32" }).toString().trim();

const tarball = run(["pack", "--ignore-scripts", "--pack-destination", out, "--silent"], pkgDir).split("\n").pop();
fs.writeFileSync(path.join(out, "package.json"), JSON.stringify({ name: "truecanvas-runtime", private: true }, null, 2));
run(["install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund", "--no-package-lock", path.join(out, tarball)], out);
fs.rmSync(path.join(out, tarball));
const version = JSON.parse(fs.readFileSync(path.join(out, "node_modules", "truecanvas", "package.json"), "utf8")).version;
console.log(`✓ truecanvas ${version} staged in build/runtime`);
