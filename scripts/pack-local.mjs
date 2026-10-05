// Packs the package and copies it to ~/.cache/truecanvas under a content-hashed
// name: package managers reuse what they installed from an unchanged path, so a
// new name is what makes `pnpm add` pick up the new build.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const pkgDir = path.join(root, "packages/truecanvas");
const { version } = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"));
execFileSync("pnpm", ["pack", "--pack-destination", root], { cwd: pkgDir, stdio: "ignore" });
const tgz = path.join(root, `truecanvas-${version}.tgz`);
const hash = createHash("sha256").update(fs.readFileSync(tgz)).digest("hex").slice(0, 10);
const dir = path.join(os.homedir(), ".cache", "truecanvas");
fs.mkdirSync(dir, { recursive: true });
const named = path.join(dir, `truecanvas-${version}-${hash}.tgz`);
fs.copyFileSync(tgz, named);
console.log(`\nPacked ${path.relative(root, tgz)}\nInstall this build in a project with:\n  pnpm add -D file:${named}\n`);
