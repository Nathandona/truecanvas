// The npm package shows packages/truecanvas/README.md: a copy of the root
// README with image and file links made absolute (relative paths don't resolve on npm).
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const raw = "https://raw.githubusercontent.com/Nathandona/truecanvas/main/";
const text = fs
  .readFileSync(path.join(root, "README.md"), "utf8")
  .replace(/src="docs\//g, `src="${raw}docs/`)
  .replace(/\]\(docs\//g, `](${raw}docs/`)
  .replace(/\]\(LICENSE\)/g, "](https://github.com/Nathandona/truecanvas/blob/main/LICENSE)");
fs.writeFileSync(path.join(root, "packages/truecanvas/README.md"), text);
fs.copyFileSync(path.join(root, "LICENSE"), path.join(root, "packages/truecanvas/LICENSE"));
