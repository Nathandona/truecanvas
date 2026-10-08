# Product and UX review

Date: 2026-10-08. Versions reviewed: 0.6.2 to 0.6.8, the desktop app, the editor, the hub, the Cloudflare review site at review.altair-studio.com.

Method: every surface used as its people use it, screenshot by screenshot (desktop 1440, laptop 1280, phone 390, light and dark), on real projects (Marianne's website, the Truecanvas site, the playground) and on the live review site, plus timings of each step of Share. Findings are rated by how much they cost the person: **blocker** (the flow fails or misleads), **friction** (it works, with effort or doubt), **polish** (it works, it could feel better).

## Who uses it

1. **The studio** (Altair studio today): designs real React pages with an agent, shares them with clients, reads their feedback, sometimes works with them live. Uses the desktop app all day.
2. **The client** (Axel on Marianne): opens a link from an email or a message, on a laptop or a phone, once or twice a week. Has never seen Truecanvas, has no account, wants to see the site and say what they think.
3. **Open-source developers**: try `npx create-truecanvas`, judge it in the first ten minutes. The audience the project grows from.

The product's promise is "real components, not pictures". Every finding below is measured against it.

## Journeys

### 1. Opening the app

| Step | Before | Rating | Now |
| --- | --- | --- | --- |
| Launch | The app was on 0.6.2 while 0.6.5 was out: the update had downloaded, and the only sign was a line in the tray menu | blocker | "Restart to update to X" in the window's tab bar, notifications point to it (0.6.6) |
| Projects | Cards with a name, page count and age; nothing said where clients were waiting | friction | Open client comments on each card |
| Starting a project | "Your app isn't running" while the dev server was still starting (fixed in 0.6.x) | blocker | "Starting your app…" with the server's log |

### 2. Editing

| Step | Before | Rating | Now |
| --- | --- | --- | --- |
| Frame labels | A phone frame read "Se… iPhone 16": the device name pushed out the frame's own name | polish | The name comes first, the device only when it fits, both in the tooltip |
| Top of the right panel | Two buttons, Live and Share, for two things most people can't tell apart | friction | One Share button; the live session lives in the Share dialog, a red Live pill shows only while one runs (0.6.7) |
| A client comments | A system notification in the desktop app, nothing in the editor | friction | A message in the editor with View, which opens the page's comments |

### 3. Sharing (the core flow)

| Step | Before | Rating | Now |
| --- | --- | --- | --- |
| What the client gets | Frozen pictures, unless someone built the app as a static site by hand and passed `--live`; Axel saw an old version until that was done | blocker: it broke the product's promise | Share builds the real site on its own, in a copy of the project (the dev server keeps running); failures keep frozen frames and say why |
| The dialog | A form first; the existing link only appeared after publishing again; "Keep the link's access" as a choice | friction | The link, its access and version count up front; "Real site" switch; "Publish version N" |
| Waiting | One spinner, no idea how long or what was happening | friction | Three steps with ticks and a timer: rendering, building the real site, uploading |
| After | The link in a field to copy | polish | Already on the clipboard, "Version N is live" |
| Speed | Every file re-uploaded on every share, one request each | friction | Files stored by content (only changes upload), several per request, the site runs next to its data |

Measured on the playground, from the studio's machine: render 11 s, build 5 s, upload 18 s. The upload is dominated by distance, not size: the machine's VPN exits in Osaka, so every request crosses to Japan and back to the data in Western Europe (about 0.4 s a round trip, about 1 s for a write). A second share of the same build changes 14 small files out of 30. Clients in France do not pay the VPN's distance.

### 4. The client's review

| Step | Before | Rating | Now |
| --- | --- | --- | --- |
| Password on a phone | The phone capitalized the first letter of the password | blocker on mobile | No capitalization, no autocorrect, a placeholder |
| First visit | Nothing said how to move, try the site or comment | friction | A short "How to review" card, once, adapted to touch |
| Frame labels | Labels ran into each other; "Full screen" on every frame, even where it showed nothing useful | friction | Labels stay within their frame; Full screen only on pages of the real site |
| Phone header | "Sign in" broke over two lines | polish | One line |
| Credit | "Made with Truecanvas" floated over the design | polish | A small pill that reads as part of the interface |

### 5. Live sessions

Before: a Live button next to Share, its popover explained the session. After: a section at the bottom of the Share dialog ("On a call with your client?"), Start, and the red pill with timer, people and End while it runs. The real thing to verify is a session with a client on a call: cursors, frames updating, comments arriving. Not yet done with a real client.

### 6. The studio's pages on the review site

Before: a bare list ("PasswordPassword" where two labels touched), no preview, no activity, no way to act. After: cards with a preview of the latest version on the canvas dots, open comments and access as badges, most recent first, search, copy, **Invite** from each card, a top bar with Links and Members. Sign-in, password and message pages share the look: the studio's logo over one card. Emails match.

## Principles behind the changes

- **Show the state before asking for a choice**: the Share dialog leads with the link as it is; the projects screen with where clients are waiting.
- **One primary action per place**: Share in the editor, the card in the links page; secondary actions (live session, copy, invite) sit inside.
- **Say what is happening while it happens**: steps and a timer for Share, a starting state for the app, a visible update.
- **The client learns nothing about the tool**: a three-line guide once, labels that never collide, a phone-friendly password field.
- **Keep the look of the canvas**: warm grey, Inter, the orange accent, the dot grid, on every surface the studio and its clients see.

## Safety nets added

- A test fails the build when the review page's script doesn't parse. A quoting mistake took every link down for about three minutes on 2026-10-08; it can't ship again unnoticed.
- New review-site abilities are announced as features (`batch`, `live-blobs`, `thumbs`); Truecanvas checks them before using them, so an older review site keeps working.

## What's next, in order

1. **A real session with a client** (journey 5): the only flow not verified end to end with a person on the other side.
2. **Mock data for apps with real data** (`canvas/setup.tsx`, planned): needed before Robia can be shared.
3. **macOS and Windows builds**: the audience beyond Linux; needs signing accounts.
4. **The first ten minutes for open-source users**: walk through `npx create-truecanvas` on a fresh machine with the same method as this review.
5. **Remove the temporary DNS records** on Vercel (`review`, `*`) once resolvers have caught up.
