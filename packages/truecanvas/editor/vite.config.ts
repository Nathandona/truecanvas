import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root,
  base: "/",
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL("../dist/editor", import.meta.url)),
    emptyOutDir: true,
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        hub: fileURLToPath(new URL("./hub.html", import.meta.url)),
      },
    },
  },
  server: {
    port: 4801,
    proxy: { "/api": "http://localhost:4800", "/mcp": "http://localhost:4800" },
  },
});
