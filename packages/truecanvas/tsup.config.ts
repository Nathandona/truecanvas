import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: { cli: "src/cli/index.ts", "next/index": "src/next/index.ts", "vite/index": "src/vite/index.ts", "core/index": "src/core/index.ts", "catalog-worker": "src/core/catalog-worker.ts", "icons-worker": "src/core/icons-worker.ts" },
    format: ["esm"],
    platform: "node",
    target: "node22",
    dts: { entry: { "next/index": "src/next/index.ts", "vite/index": "src/vite/index.ts", "core/index": "src/core/index.ts" }, compilerOptions: { ignoreDeprecations: "6.0" } },
    external: ["next", "vite", "react", "typescript", "prettier", "playwright-core"],
  },
  {
    entry: { "next/loader": "src/next/loader.ts" },
    format: ["cjs"],
    platform: "node",
    target: "node22",
    outExtension: () => ({ js: ".cjs" }),
    // self-contained: bundlers load it with require()
    noExternal: [/.*/],
    footer: { js: "module.exports = module.exports.default;" },
  },
  {
    entry: { "runtime/index": "src/runtime/index.tsx", "runtime/host": "src/runtime/host.tsx" },
    format: ["esm"],
    platform: "browser",
    target: "es2022",
    dts: { compilerOptions: { ignoreDeprecations: "6.0" } },
    external: ["react", "react-dom", "react/jsx-runtime"],
    banner: { js: '"use client";' },
  },
]);
