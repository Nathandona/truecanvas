// electron-builder leaves node_modules out of extra resources, whatever the
// filter: copy the staged truecanvas runtime (build/runtime, see stage.mjs)
// into the packed app before it becomes an AppImage, deb, dmg or installer.
const fs = require("node:fs");
const path = require("node:path");

exports.default = async function afterPack(context) {
  const from = path.join(context.packager.projectDir, "build", "runtime");
  if (!fs.existsSync(path.join(from, "node_modules", "truecanvas", "dist", "hub.js"))) throw new Error("Stage the truecanvas runtime first: pnpm stage");
  const resources = context.electronPlatformName === "darwin" ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, "Contents", "Resources") : path.join(context.appOutDir, "resources");
  fs.cpSync(from, path.join(resources, "runtime"), { recursive: true });
};
