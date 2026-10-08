# Share links: technical design

Status: milestones 1 to 3 built (2026-10-07), live at review.altair-studio.com on the Cloudflare review site (`packages/review-worker`). First user: Altair studio, sharing designs with clients on the studio's own domain. The real site is built and included on Share since 2026-10-08.

## Goal

A studio shares a canvas with a client as a link. The client opens it in any browser, with nothing to install, looks at the frames and pins comments. The comments come back into the canvas, where the studio and its agent can answer and resolve them.

Out of scope for v1: live or clickable prototypes, client editing, accounts for clients.

## The flow

1. In Truecanvas, the studio clicks **Share** on a canvas, or asks its agent ("share the home page with the client").
2. Truecanvas renders every frame through the app, freezes each one into static HTML and CSS, and uploads the snapshot to the studio's review site.
3. The studio gets a link: `https://review.<studio-domain>/s/<project>-<canvas>-<random>`.
4. The client opens it, types their name once, then pans, zooms and pins comments on frames.
5. Truecanvas pulls new comments into `canvas/<page>.comments.json` as client threads. The studio replies from the canvas, or the agent resolves them through MCP, and replies show up on the link.
6. Sharing again creates a new version of the same link. The client can switch between versions.

## Pieces

### 1. Snapshot (in the truecanvas package)

For each frame, the existing screenshot browser loads `/truecanvas/<canvas>?frame=<name>&still=1` (animations already settle to their final state), then serializes the page:

- **Markup:** `document.documentElement.outerHTML` with every `<script>` removed, every inline event handler removed, and `data-tc` attributes stripped, so no source paths leak.
- **Styles:** the text of every stylesheet in `document.styleSheets` (Tailwind output, `next/font` faces, CSS-in-JS style tags), inlined.
- **Assets:** images, fonts and backgrounds referenced by the markup or the CSS are downloaded, stored by content hash and rewritten to `assets/<hash>.<ext>`, so the snapshot never calls the dev server.
- **Pixels that only exist at runtime:** `<canvas>` (WebGL shaders, charts) becomes an `<img>` of its current pixels; `<video>` keeps its poster.
- **A full-frame screenshot** for each frame, used as a thumbnail and as a fallback if the HTML snapshot fails.

Output, written locally first so it can be previewed before upload:

```
.truecanvas/shares/<canvas>/<version>/
  manifest.json   { canvas, version, createdAt, frames: [{ name, x, y, width, height, theme, html, image }] }
  frames/<name>.html
  frames/<name>.png
  assets/<hash>.<ext>
```

A snapshot has no JavaScript, so it can't call an API or leak a session token, whatever the app does. Data the page showed when it was rendered is in the snapshot, though, so projects with real data render with mocks first (see "Pages with API calls").

### 2. Review site (deployed by the studio)

A small Next.js app in this monorepo (`packages/review`), deployed by the studio to its own Vercel account and domain. Truecanvas doesn't run a server.

- **Storage:**
  - snapshots in Vercel Blob, served only through the site's routes
  - share records (and, next, comments) in Upstash for Redis from the Vercel Marketplace: free tier, and no compute hours burned while Truecanvas polls
- **Viewer:**
  - a pan and zoom canvas laying frames out at their canvas positions
  - each frame is an `<iframe sandbox srcdoc=…>`, with scripts disabled by the sandbox as a second guard
  - a version switcher
  - the studio's name and logo, and a small "Made with Truecanvas" mark
- **Comments:** a pin mode (`C`), threads per frame position, and the client's name remembered in their browser.
- **Access:**
  - links are unguessable (random suffix), `noindex`, and can have a password (hashed, then a cookie) and an expiry
  - the studio can revoke a link
- **API:**
  - `POST /api/shares` and `POST /api/shares/:id/versions` (upload)
  - `GET /api/shares/:id/comments?since=` and `POST /api/shares/:id/comments/:thread/replies`
  - all protected by a studio token (an environment variable on the site)

### 3. Truecanvas side

- **Setup:** `truecanvas share setup` asks for the review site URL and token once, and stores them in `~/.config/truecanvas/share.json` (never in the repo).
- **Share button:** shares the open canvas, then shows the link with copy, open, revoke and password options.
- **MCP tools:**
  - `share_canvas`: share a canvas and return the link
  - `list_shares`: links, versions and how many comments are open
- **Comment sync:**
  - while Truecanvas runs, it polls each live share for new comments
  - client threads are stored in the existing comments file, with an author kind of `client`
  - studio replies and resolutions are posted back to the link
  - `list_comments` and `resolve_comment` work on client threads unchanged, so an agent can act on client feedback

## Pages with API calls

Snapshots make sharing safe, but a page that fetches data needs data to render. Truecanvas supports three levels:

1. **Components with sample props (default):** frames compose real components with literal props. No API, no sign-in.
2. **`canvas/setup.tsx` (planned, piloted on Robia):** wraps every frame in the providers it needs (for example a test sign-in instead of Clerk), and answers API requests with sample data inside canvas frames only:
   ```tsx
   export const providers = ({ children }) => <TestAuthProvider user={demoUser}>{children}</TestAuthProvider>;
   export const mocks = { "GET /api/dossiers": dossiers, "GET /api/me": demoUser };
   ```
3. **The real API:** for local work only. Share warns when a frame made network requests to anything but the dev server while it was being snapshotted.

## The real site

Frozen frames can't show motion or interaction, so a version also carries the real site:

- **Built on Share, by default** (`share/export.ts`): Next.js projects are copied (without node_modules, the generated canvas route, the canvases, API routes and middleware) into `.truecanvas/live-export` inside the project, so its node_modules resolve and the dev server keeps running, then built with the project's own `next.config` wrapped to `output: "export"` and unoptimized images, types unchecked. Vite projects run `vite build` into `node_modules/.cache`. A build that fails leaves the version with frozen frames, and the Share dialog says why. `--frozen` (CLI) or `frozen` (MCP) leaves it out.
- **Stored by content**: the version gets a manifest of path to SHA-256, files go once per link under `blobs/<hash>`, so sharing again only uploads what changed (a Next build keeps its hashed chunks). Uploads travel several files per request (`POST files/batch`).
- **A static build** (`truecanvas share --live out/`): uploaded with the version and hosted by the review site on a host of its own, `<link key>-<version><LIVE_HOST_SUFFIX>` (e.g. `ab12cd34ef-20261007153000-live.example.com`). A separate origin keeps the site's scripts away from the review site's cookies and API. One level under the domain, because the free certificate only covers first-level subdomains.
- **A URL** (`--live https://...`): where the app already runs, for apps with a server.
- **Access:** when the link has a password, the manifest carries a short-lived signed token; the live host trades it for an HttpOnly cookie, so the live site is protected like the link.
- **Viewer:** page frames load their page from the real site (the frozen copy shows until it loads); a click lets the client interact with it, and **Full screen** opens it at a real screen height (900 desktop, 1024 tablet, 844 phone), scaled to fit, with "Open in a new tab".
- **Compatibility:** the review site lists `features` in its token check; Truecanvas checks them before uploading, so an older site fails with a clear message.

## Two review sites

Same API, either can be deployed: `packages/review` (Next.js on Vercel, Upstash Redis + Vercel Blob) and `packages/review-worker` (Cloudflare Workers, D1 + R2, live sites, free for commercial use). In D1 each comment message is its own row, inserted or ignored by id, and a resolution is one UPDATE, so concurrent writes from a client and the studio never overwrite each other. `scripts/migrate.mjs` moves a Vercel site's links, passwords, comments and files over.

## Milestones

1. **Snapshot** (2 to 3 days): serializer, assets, local preview (`truecanvas share --local` opens the snapshot in a browser). Tested on `marianne/website`.
2. **Review site and publish** (3 to 4 days): `packages/review`, upload API, viewer, password and revoke; deployed on the studio domain.
3. **Comments** (2 to 3 days): pins in the viewer, sync both ways, client threads in the editor, MCP tools.
4. **Polish:** versions UI, studio branding settings, a "Deploy your review site" button and guide in the README.

## Open questions

- The exact review domain (for example `review.altairstudio.com`) and which Vercel team hosts it.
- Studio branding for the viewer: logo file and name as it should appear.
- Should a client see resolved threads, or only open ones?
