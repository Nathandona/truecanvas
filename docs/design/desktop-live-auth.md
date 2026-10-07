# Desktop app, sign-in and live sessions: technical design

Status: in progress (2026-10-07). First user: Altair studio, sharing work in progress with its clients.

## Goal

A studio installs Truecanvas like any app. It runs in the background, starts each project's dev server when needed, and with one click opens a **live session**: the studio's client follows the real components on the review site as the studio edits them, both see each other's cursors, and comments arrive instantly. Everyone signs in: studio members with their account, clients with a link sent by email.

Out of scope for now: two people editing at once (clients view and comment, the studio edits), hosted workspaces (the code runs in the cloud), billing.

## 1. Desktop app (`packages/desktop`)

Electron, because the canvas renders the user's real React components: the window must render exactly like Chromium on every OS, and Truecanvas needs Node anyway to run Next and Vite. A system web view (WebKitGTK on Linux) renders differently, which a design tool can't accept.

- **Main process** runs the hub in process (the same server as `truecanvas hub`), with a single-instance lock. The window loads the hub; closing it keeps Truecanvas running in the tray.
- **Tray**: open, recent projects, start or stop a live session, quit (which stops every dev server).
- **Dev servers** run with the user's own Node (found through their login shell's PATH, since apps started from a desktop don't inherit it), started when a project opens and stopped after a while unused, to keep memory low.
- **Start at login** (opt-in), **native notifications** (a client commented, a session started), **automatic updates** from GitHub releases.
- **Packaging**: Linux AppImage and deb first, built by CI on each release tag. macOS and Windows build unsigned until signing is set up (an Apple developer account, about $99 a year; a Windows signing service, about $10 a month).
- `truecanvas open` and the Chromium launcher stay for people who don't install the app.

## 2. Sign-in on the review site

[Better Auth](https://www.better-auth.com), on the review Worker with D1, rather than code of our own: sessions, CSRF, token handling and email links are easy to get subtly wrong.

- **Email links** (magic links) for everyone: no passwords to manage. Emails are sent with Cloudflare Email Service from the studio's domain (`STUDIO_EMAIL_FROM`); in local development the link is printed instead.
- **Studio members**: the emails in `STUDIO_EMAILS` (the owner adds more later from a members page). They see every link of the studio.
- **Clients**: invited per link (`truecanvas share --invite axel@client.fr`, `share_canvas`, or the Share dialog). The invitation email signs them in and opens the link. They see only the links they were invited to.
- **Link access**, per link: invited people only (new default), a password (as today, for existing links), or anyone with the link.
- Comments and cursors carry the signed-in person's name, so clients no longer type a name.
- The Truecanvas CLI and hub keep using the studio token (`REVIEW_TOKEN`) for uploads and sync.
- Live sites (`*-live` hosts) accept the same signed hand-off as today, now issued for signed-in viewers too.
- The `organization` plugin is left out for now; it becomes the studio boundary for a hosted service later.

## 3. Live sessions

One Durable Object per link (a **room**), on the review Worker. SQLite-backed Durable Objects and WebSocket hibernation are on the Workers free plan, so an idle room costs nothing.

- **Presence**: everyone in the room (the studio in the editor or desktop app, clients in the viewer) sends their cursor in canvas coordinates and their viewport; the room broadcasts it with their name and a color. The viewer and the editor draw the others' cursors and avatars.
- **Comments in real time**: new threads, replies and resolutions are pushed through the room, instead of the 20-second poll (the poll stays as a fallback).
- **Live frames**: when the studio starts a session, Truecanvas connects to the room as its **host** with the studio token. The room forwards viewers' requests for the app to the host over that WebSocket (a reverse tunnel); the host fetches them from the project's dev server and streams the answer back. HMR WebSockets are forwarded too, so viewers' frames update as the studio edits. In a session the viewer swaps frozen frames for live ones, served from the link's own live host, so the app never shares an origin with the review site.
- **Security**: the tunnel only reaches the project's app (never the Truecanvas editor or its API), only for signed-in members of the link, and only while the studio keeps the session open. Messages over 1 MB are chunked.
- **When the studio is offline**, the link shows the latest published version, as today.

## Milestones

1. Desktop app on Linux: tray, background hub, dev servers on demand, AppImage in releases.
2. Sign-in: Better Auth, email links, studio members, client invitations, per-link access.
3. Live sessions: rooms, presence and cursors, real-time comments, the reverse tunnel and live frames, the session button in the editor and the tray.
4. Later: macOS and Windows signing, simultaneous editing, a hosted service with a free tier.
