<img src="https://raw.githubusercontent.com/Nathandona/truecanvas/main/docs/logo.svg" width="56" alt="Truecanvas logo" />

# Truecanvas

**A Figma-like canvas for your real React components. The code is the document.**

[truecanvas.dev](https://truecanvas.dev)

Truecanvas renders your actual `.tsx` components on an infinite canvas, lets you compose them visually, and writes every change back to plain TSX in your repo. There is no built-in AI: it is **agent-first through MCP**, so Claude Code, Cursor, Codex or any MCP client can read your design system, edit frames and take screenshots, while you watch and steer in the editor.

![Truecanvas editor](https://raw.githubusercontent.com/Nathandona/truecanvas/main/docs/screenshot.png)

- **Real components, not drawings.** Layers are instances of your components. The props panel is generated from their TypeScript types (`status: "working" | "idle"` becomes a dropdown).
- **Code is the document.** A canvas is `canvas/<name>.canvas.tsx`. Edits are minimal text patches that keep your formatting, so diffs are reviewable and your editor and the canvas stay in sync both ways.
- **Agent-first.** 44 MCP tools: read the tree, list components and design tokens, insert JSX, set props, wrap in auto layout, create variant grids, add shader backgrounds, screenshot frames, and see what the user has selected.
- **Shaders.** Install [`@paper-design/shaders-react`](https://github.com/paper-design/shaders) and its ~30 animated shaders show up in the Components panel, with color pickers, sliders from their documented ranges and one-click presets. Add one behind any frame with "Shader background". Pause all motion with `⇧P` to save battery.
- **Design on your real pages.** "Add a page from your app" (Pages +) adds any App Router page as a **linked frame**: its layers are the page's own JSX, and editing them edits `page.tsx` (and the layout, for things like the navbar) directly. Right-click → **Explore a copy** to try ideas without touching the page, then **Apply to page** to write the result back as a minimal diff.
- **Build with plain elements and components.** The Insert menu (＋ in the toolbar, `T` for text) and the Basics in Assets add text, headings, links, buttons, lists, stacks, rows, grids, sections, images and inputs as Tailwind-styled JSX. **New component** creates a component file; select layers and press `Ctrl/⌘+Alt+K` to turn them into a component (imports come along). Right-click any component → **Edit main component** opens it on the `components` page: its layers are the component's own JSX, edits go to its file, and every instance follows. `className={cn("…", className)}` stays merged: only the static classes change.
- **Pages, layers, assets.** Pages are canvas files you can add, rename, duplicate and delete (with undo). Layers have search, editor-only hide and lock, and custom names stored as `data-name` so your agent sees them too. Assets shows live thumbnails of your components, rendered by your app, plus every shader preset.
- **Icons and shadcn/ui.** Assets → Libraries (or ＋ → Icon…) installs an icon set (Lucide, Tabler, Phosphor, Heroicons, Radix) with your package manager, then search and insert icons with their import. The shadcn/ui tab runs the official shadcn CLI to copy components into your project (setting shadcn up first if needed); they show up in Assets with their typed variants like any component. Your agent can do the same through MCP.
- **Motion.** Play a frame (▶ on its label) to scroll inside it at screen height, so scroll reveals run like on the site, and replay entrance animations anytime. Paused frames and agent screenshots show every animation finished, never half faded. The Motion section adds a scroll reveal (fade up, blur in, scale in…) or a text animation (word by word, letter by letter, typewriter…) to any layer: Truecanvas adds `Reveal` and `TextAnimate` to your components once (plain React, no dependencies) and wraps the layer in them.
- **Mobile presets.** iPhone, Pixel, Galaxy, iPad and desktop frame sizes, with device chrome (status bar, Dynamic Island, home indicator) and touch emulation in agent screenshots.
- **Everything is undoable.** Edits from you, your agent and your code editor land in one activity feed with undo/redo.
- **Light, dark, system.** Per-frame theme (Inherit / Light / Dark) and a canvas-wide theme, applied live without reloading frames.
- **Lightweight.** No second dev server. Frames render through your existing dev server (`next dev` or `vite`), the editor is a static bundle, and headless Chromium only starts when an agent asks for a screenshot.

> Status: early. Next.js (App Router) and Vite + React, Tailwind first. Linux, macOS and Windows.

## Quick start

**In a Next.js app** (App Router, Next 15.3+) **or a Vite + React app** (Vite 5+):

```bash
npx truecanvas
```

That's it. The first time, it asks once, then adds the dev dependency, enables its plugin in `next.config` (or `vite.config`), adds a `canvas` script, links your homepage as the first canvas and offers to connect your agents. Then it starts your app (if it isn't running) and opens the editor. After that, anyone on the project starts it with `npm run canvas`.

**A new app:**

```bash
npm create truecanvas@latest my-app
cd my-app && npm run canvas
```

A Next.js app (TypeScript, Tailwind, App Router) with Truecanvas set up and committed. `pnpm create truecanvas`, `yarn create truecanvas` and `bun create truecanvas` work too.

**Vite apps.** The `truecanvas()` plugin (added to `vite.config` for you) stamps ids and serves frames at `/truecanvas/<canvas>`, with the stylesheets your entry module imports (`src/main.tsx` → `index.css`) and the `<link>` tags of your `index.html`. Set `"css": ["/src/styles.css"]` in `truecanvas.config.json` to choose them yourself. Main component frames, Assets, agents and screenshots work as in Next; linked page frames need Next's file-based routes. Production builds are untouched.

**Something off?** `npx truecanvas doctor` checks Node, Next, React, Tailwind, the config, agents, screenshots and git, with a one-line fix for each problem.

**Prefer an app to a terminal?** `npx truecanvas open` opens the Truecanvas window: your projects, one tab each, "Clone from GitHub" and "New project". `npx truecanvas desktop` adds it to your app launcher (Linux).

### Connect your agent

```bash
npx truecanvas connect
```

This writes the Truecanvas MCP server into the project's **`.mcp.json`** (and `.cursor/mcp.json` / `.vscode/mcp.json` when the project uses those editors). **Commit it**: everyone who clones the repo gets Truecanvas in Claude Code, Cursor or VS Code with no setup.

| Client | Config |
| --- | --- |
| Claude Code | `.mcp.json` from `truecanvas connect`, or for all your projects: `claude mcp add --scope user --transport http truecanvas http://localhost:4800/mcp` |
| Cursor | `.cursor/mcp.json` → `{ "mcpServers": { "truecanvas": { "url": "http://localhost:4800/mcp" } } }` |
| VS Code | `.vscode/mcp.json` → `{ "servers": { "truecanvas": { "type": "http", "url": "http://localhost:4800/mcp" } } }` |
| Codex | `~/.codex/config.toml` → `[mcp_servers.truecanvas]` `url = "http://localhost:4800/mcp"` |
| stdio-only clients | `{ "command": "npx", "args": ["truecanvas", "mcp"] }` (bridges to a running server, or starts one) |

Then select something on the canvas and ask: *"Make my selection denser"*, *"Create a dark copy of the Chat frame and check it with a screenshot"*, *"Show every status of SessionRow"*.

## The Truecanvas window

```bash
npx truecanvas desktop   # adds Truecanvas to your app launcher (GNOME, KDE…)
npx truecanvas hub       # or start it from a terminal
```

One window for all your projects, with tabs like a browser. The **Dashboard** lists your recent projects (with their favicons) and the Next.js and Vite apps it finds on your computer. You can open a folder, set up Truecanvas in an existing app, or create a new project. Each tab is a project's editor. Opening a tab starts that project's app on free ports, and closing it stops the app and frees the memory (the tab bar shows how much is in use).

The hub serves MCP at the same `http://localhost:4800/mcp`, and your agent works on the project in the active tab. It can also call `list_projects` and `open_project` to switch itself.

## Collaborate

Everything Truecanvas makes is a file in your repo: canvases, comments, linked pages, the motion components they use, and `.mcp.json`. So git is the collaboration layer, and a team works on design the way it works on code.

### The workflow

1. **Set up once, commit it.** `npx truecanvas` in the repo, then commit `package.json`, `canvas/`, `next.config` (or `vite.config`) and `.mcp.json`. Teammates run their usual install and `npm run canvas`; their agents are already connected.
2. **Design on real pages.** Linked frames are your production pages: editing them edits `page.tsx`. For bigger ideas, right-click → **Explore a copy**, iterate freely (you or your agent), then **Apply to page**. Delete explorations once applied.
3. **One branch per change.** On `main`, Truecanvas offers to start a branch and brings your edits along.
4. **Commit from the Git panel.** It lists what changed per frame in plain words and drafts the message.
5. **Open a pull request** from the panel: the description shows each changed frame, before and after.
6. **Review in Truecanvas too.** In the Truecanvas window, a project's menu → **Pull requests…** checks out any PR and shows it on the canvas, live, not just as pictures. Leave comments on frames; they're saved in the branch, and agents can read and resolve them.
7. **Merge.** There's no handoff: the design is already the code.

Designers who don't use a terminal can do all of it from the Truecanvas window: **Clone from GitHub** (clones, installs, sets up), open the project, branch, commit, open and review PRs.

### What's in the Git panel


- **Git panel** (the branch pill at the top left): what changed, frame by frame, in plain words ("Restyled h1 (+text-orange-600)", "Added a fade-up reveal to p"), with a commit message drafted from it. Changed frames get a dot on the canvas. Design commits include canvases, comments, linked pages and the motion components they use.
- **Review changes**: a full-screen before/after of each changed frame against the last commit (rendered by your app), plus the code diff.
- **Branch first**: on `main` with changes, Truecanvas offers to start a branch (named from the page and frames) and carries your edits over.
- **Pull requests** (GitHub, through the `gh` CLI): push and open a PR in one step. Its description lists the changes per frame, optionally with before/after images stored on a `truecanvas-previews` branch of the same repo. The branch pill then shows the PR's state: open, checks running or failing, approved, merged. No GitHub remote yet? "Publish" creates the repo (private by default).
- **Compare**: render this page as it was on another branch or commit, side by side or as an overlay with an opacity slider. Changed and new frames are flagged. This works because Truecanvas renders any version of the code.
- **Comments** (`C`): pin a comment on a frame or layer. Threads are saved in `canvas/<page>.comments.json`, so they travel with branches and show up in pull requests. Agents read them with `list_comments` (including the current source of the commented layer), fix things, and `resolve_comment` with a note.

### Good to know

- **Async, like code.** Collaboration happens through branches and pull requests. Live multiplayer on one canvas isn't supported; the live cursors you see are agents working on your machine.
- **Merges.** Canvas files are TSX with one block per frame and minimal edits, so two people changing different frames merge cleanly. When both change the same frame, resolve it like any code conflict and Truecanvas re-renders the result.
- **One agent config for everyone.** `.mcp.json` points at `http://localhost:4800/mcp`, which works whether each person runs `npm run canvas` or the Truecanvas window.

## Linked frames

A new project's first canvas links your homepage. Any page can be linked from Pages + or with the `import_page` tool:

```tsx
<Frame name="Home" x={0} y={0} width={1440} page="src/app/(marketing)/page.tsx">
  <MarketingLayout>
    <HomePage />
  </MarketingLayout>
</Frame>
```

- The frame renders the real page through its layouts. Its layers are the JSX of `page.tsx` and of the layouts around it, and every edit goes to the file that layer lives in, keeping that file's formatting. The frame label shows **Live · page.tsx**.
- Undo, the Git panel (linked pages count as design files) and Compare (the page is rendered as it was at that commit) all work on the page files.
- Only plain composition is editable: a page whose component fetches data or has logic before its `return` is shown as one layer, **View only**. Explore a copy to design on it.
- **Explore a copy** creates `<Frame from="src/app/…/page.tsx">` with the page's JSX inline, in the canvas file. **Apply to page** replaces the page's returned JSX with the exploration's, adds the imports it needs and removes the ones it no longer uses.
- Page and layout layers get ids like `src/app/page.tsx#12:8`, stamped only in `next dev`. Production builds are untouched.

## A canvas file

```tsx
"use client";
import { Canvas, Frame } from "truecanvas";
import { SessionRow } from "@/components/app/session-row";

export default function ChatCanvas() {
  return (
    <Canvas>
      <Frame name="Sessions" x={0} y={0} width={320}>
        <div className="flex flex-col gap-1 p-3">
          <SessionRow title="Review release readiness" status="working" elapsed="2m" active />
          <SessionRow title="Draft the Q4 changelog" status="review" source="slack" elapsed="3h" />
        </div>
      </Frame>
      <Frame name="Sessions dark" x={360} y={0} width={320} theme="dark">
        {/* … */}
      </Frame>
    </Canvas>
  );
}
```

- `<Frame>`: `name`, `x`, `y`, `width`, optional `height` (omit to hug content), optional `theme` (`"light" | "dark"`, omit to inherit), optional `device` (`"iphone-16"`, `"pixel-9"`, `"ipad-mini"`…), optional `page` (linked frame) or `from` (exploration of a page).
- Each frame renders in its own iframe at its own width, so media queries, portals and `position: fixed` behave like the real app.
- Keep props literal (`status="working"`) to make them editable. Expressions such as `{items.map(…)}` still render, but they are read-only in the inspector.

## MCP tools

| Read | Write | Look & show |
| --- | --- | --- |
| `list_canvases` | `set_props` · `set_text` · `set_class_name` | `screenshot_frame` |
| `get_canvas` (compact outline with ids) | `insert_jsx` · `replace_node` | `focus` (select + zoom in the user's editor) |
| `get_node` (exact TSX source) | `duplicate_nodes` · `delete_nodes` · `move_node` | `undo` · `redo` |
| `list_components` · `get_component` | `wrap_nodes` (auto layout) | |
| `get_design_tokens` (Tailwind `@theme`) | `create_frame` · `update_frame` (both take `device`) | |
| | `create_canvas` · `rename_canvas` · `delete_canvas` | |
| `get_selection` (what the user selected) | `create_variants_frame` · `add_background` · `apply_preset` | |
| `list_comments` | `reply_comment` · `resolve_comment` | |
| | `import_page` (linked by default) · `explore_copy` · `apply_to_page` | |
| | `add_animation` · `remove_animation` | `play_frame` (play, replay, stop) |
| | `create_component` · `open_component` | |
| `list_libraries` · `search_icons` | `install_library` · `insert_icon` · `add_shadcn_components` | |

Node ids are `line:col` of the JSX tag (`file#line:col` for layers of a linked page) and change after edits. Every write returns the fresh ids of the affected frame. Catalog components are imported automatically.

## How it works

```
  your browser                          truecanvas dev (Node, 127.0.0.1:4800)
 ┌───────────────────────────┐  REST/SSE ┌──────────────────────────────────┐
 │ editor UI (static bundle) │◀─────────▶│ Workspace: parse → patch → write │◀── MCP ── your agent
 │  ┌──────┐ ┌──────┐        │           │ (Babel + magic-string, undo log) │
 │  │iframe│ │iframe│ frames │           │ Catalog: TS checker → prop types │
 │  └──┬───┘ └──┬───┘        │           └───────────────┬──────────────────┘
 └─────┼────────┼────────────┘                           │ writes canvas/*.canvas.tsx
       │        └── postMessage: hit-test, rects, theme  ▼
       └──────────── /truecanvas/[canvas]?frame=… ── your `next dev` (HMR)
```

1. A Turbopack/webpack loader stamps each JSX element in `*.canvas.tsx` with `data-tc="line:col"` (dev only, same line, no layout impact).
2. In the iframe, a tiny runtime answers "what's under this point?" by walking React's fiber tree to the nearest stamped element. No wrapper elements, and it works with portals and components that don't forward props.
3. The editor turns your gestures into commands. The server patches the source text and writes it, and Next's HMR re-renders the frame.
4. Agents use the same commands over MCP, so whatever you can do, they can do.

## Configuration

Optional `truecanvas.config.json` at the project root:

```json
{
  "appUrl": "http://localhost:3000",
  "port": 4800,
  "canvasDir": "canvas",
  "components": ["components/**/*.tsx"],
  "darkMode": { "strategy": "class", "value": "dark" },
  "libraries": ["@paper-design/shaders-react"],
  "editor": "code"
}
```

`libraries` adds npm packages to the Components panel (Paper shaders are detected automatically when installed). `darkMode` tells frames how your app switches themes: a class on `<html>` (`strategy: "class"`), or an attribute (`{ "strategy": "attribute", "attribute": "data-theme", "value": "dark", "lightValue": "light" }`).

## Shortcuts

| | |
| --- | --- |
| Select / Frame / Hand / Interact | `V` `F` `H` `P` |
| Duplicate · Delete | `⌘D` · `⌫` |
| Wrap in auto layout | `⇧A` |
| Reorder in parent | `↑` `↓` or drag on the canvas |
| Parent / child | `⇧↵` / `↵` (or `Esc`) |
| Edit text | double-click or `↵` |
| Rename layer or page | double-click its name |
| Copy as JSX | `⌘C` |
| Pause / play animations | `⇧P` |
| Comment | `C` |
| Zoom to fit · selection · 100% | `⇧1` · `⇧2` · `⇧0` |
| Undo · Redo | `⌘Z` · `⇧⌘Z` |

On Linux, `⌘` is `Ctrl`. Pan with space-drag, middle mouse or two-finger scroll. Zoom with Ctrl+scroll or pinch.

## Requirements

- Node 22+ (24 LTS recommended), React 19, and Next.js 15.3+ (App Router) or Vite 5+. Tailwind is optional but the style controls write Tailwind classes.
- Linux, macOS and Windows (CI runs on all three; the desktop launcher entry is Linux-only).
- For screenshots and PR images: Chrome, Edge or Chromium, or a Playwright browser (`npx playwright install chromium-headless-shell`). Set `TRUECANVAS_CHROME` to point at one.
- For pull requests: the GitHub CLI (`gh auth login`).

`npx truecanvas doctor` checks all of this.

## Develop

```bash
pnpm install
pnpm build                      # library + editor bundle
pnpm --filter truecanvas test   # engine tests
pnpm dev                        # builds, then starts the playground app + editor
pnpm --filter truecanvas dev:editor   # editor with Vite HMR on :4801 (proxies the API)
pnpm pack:local                 # an installable build, plus the command to add it to a project
```

Running the CLI from this checkout (`node packages/truecanvas/dist/cli.js`) installs a tarball of your local build into projects instead of the npm release.

**Releasing:** `pnpm release 0.2.0` bumps `truecanvas` and `create-truecanvas`, commits and tags; `git push --follow-tags` runs the release workflow, which tests and publishes both to npm with provenance (needs an `NPM_TOKEN` secret in the GitHub repo).

## Roadmap

- Multi-frame drag and reparenting by dragging on the canvas
- Vite + React Router support, then CSS Modules
- Inline prop editing for `ReactNode` slots
- Desktop shell (AppImage / Flatpak) once the web version settles

## License

MIT
