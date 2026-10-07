// pnpm release <version>: bumps the packages and the desktop app, commits and tags. Pushing the
// tag (git push --follow-tags) runs .github/workflows/release.yml.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version ?? "")) {
  console.error("Usage: pnpm release <version>   e.g. pnpm release 0.2.0");
  process.exit(1);
}
const root = path.resolve(import.meta.dirname, "..");
const git = (...args) => execFileSync("git", args, { cwd: root, stdio: "inherit" });
if (execFileSync("git", ["status", "--porcelain"], { cwd: root }).toString().trim()) {
  console.error("Commit or stash your changes first.");
  process.exit(1);
}
const files = ["packages/truecanvas/package.json", "packages/create-truecanvas/package.json", "packages/desktop/package.json"];
for (const f of files) {
  const file = path.join(root, f);
  const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
  pkg.version = version;
  fs.writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
}
git("add", ...files);
git("commit", "-m", `Release v${version}`);
// annotated: `git push --follow-tags` only pushes annotated tags
git("tag", "-a", `v${version}`, "-m", `Truecanvas ${version}`);
console.log(`\nTagged v${version}. Publish with: git push --follow-tags\n`);
