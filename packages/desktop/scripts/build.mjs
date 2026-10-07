// Bundles the main process and the preload script into dist/. Electron and the
// truecanvas package stay outside: Electron is the runtime, and truecanvas is
// loaded at run time from the app's resources (see stage.mjs).
import { build } from "esbuild";
import fs from "node:fs";

fs.rmSync("dist", { recursive: true, force: true });
const common = { bundle: true, platform: "node", format: "cjs", target: "node22", external: ["electron"], outExtension: { ".js": ".cjs" }, logLevel: "warning" };
await build({ ...common, entryPoints: { main: "src/main.ts" }, outdir: "dist" });
await build({ ...common, entryPoints: { preload: "src/preload.ts" }, outdir: "dist" });
console.log("✓ dist/main.cjs, dist/preload.cjs");
