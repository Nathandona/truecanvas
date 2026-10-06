# create-truecanvas

```bash
npm create truecanvas@latest my-app
```

Creates a Next.js app (App Router) or a Vite + React app, with TypeScript, Tailwind and [Truecanvas](https://github.com/Nathandona/truecanvas) set up: the dev dependency, its plugin in `next.config` or `vite.config`, a first canvas, and `.mcp.json` so Claude Code and Cursor connect. Then:

```bash
cd my-app
npm run canvas
```

Pick the framework when asked, or pass it: `npm create truecanvas@latest my-app -- --vite` (or `--next`).

Works with npm, pnpm (`pnpm create truecanvas`), yarn and bun.
