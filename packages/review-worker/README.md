# Truecanvas review site (Cloudflare)

A studio's review site for Truecanvas share links, on Cloudflare Workers with D1 and R2. Clients open a link, look at the frozen frames, pin comments, and open the live site with **View live**. Same API as the Vercel version in `packages/review`: Truecanvas works with either.

Cloudflare's free plan covers it (Workers, D1, R2 up to 10 GB) and allows commercial use.

## What you need

- A Cloudflare account, with your domain's DNS on Cloudflare (custom domains and the live sites' hosts need it).
- From this folder: `pnpm install`, then `npx wrangler login`.

## Deploy

1. **Your settings.** Copy `wrangler.jsonc` to `wrangler.local.jsonc` (ignored by git) and set:
   - `BRAND_NAME`, and `BRAND_LOGO` (a logo URL) for your studio's branding.
   - `LIVE_HOST_SUFFIX`, e.g. `"-live.your-studio.com"`. Each live site gets its own host, like `ab12cd34ef-20261007153000-live.your-studio.com`, so its scripts never share an origin with the review site. Keep it one level under your domain: the free certificate only covers first-level subdomains.
   - `routes`:
     ```jsonc
     "routes": [
       { "pattern": "review.your-studio.com", "custom_domain": true },
       { "pattern": "*-live.your-studio.com/*", "zone_name": "your-studio.com" }
     ]
     ```
2. **Database and bucket.**
   ```sh
   npx wrangler d1 create truecanvas-review         # add the database_id it prints to wrangler.local.jsonc
   npx wrangler r2 bucket create truecanvas-review
   npx wrangler d1 migrations apply truecanvas-review --remote -c wrangler.local.jsonc
   ```
   On an existing site, run the same `migrations apply` before deploying a version that needs a new migration (sign-in adds `0002_sign_in.sql`).
3. **The studio token.** A long random string; Truecanvas sends it to upload and manage links.
   ```sh
   npx wrangler secret put REVIEW_TOKEN -c wrangler.local.jsonc
   ```
   **3b. Sign-in.**
   - In `wrangler.local.jsonc`, set `STUDIO_EMAILS` (the owners, comma separated) and `STUDIO_EMAIL_FROM` (e.g. `review@your-studio.com`), and keep the `send_email` binding.
   - Onboard your domain to Email Service, which adds its sending records (SPF and DKIM) to your DNS, then check them:
     ```sh
     npx wrangler email sending enable your-studio.com
     npx wrangler email sending dns get your-studio.com
     ```
     If your domain already has an SPF record for another mail provider, keep a single SPF record that includes both.
   - A secret of 32+ random characters that signs sessions:
     ```sh
     openssl rand -hex 32 | npx wrangler secret put BETTER_AUTH_SECRET -c wrangler.local.jsonc
     ```
   Without `BETTER_AUTH_SECRET` the site works as before: passwords and open links.
4. **DNS for the live sites.** Add a proxied wildcard record so `*-live` hosts reach Cloudflare: type `AAAA`, name `*`, content `100::`, proxied. (If `*` already points somewhere else, such as another host's wildcard, decide which one you keep: specific records like `www` are not affected.)
5. **Deploy.** The custom domain is created on the first deploy; remove any existing DNS record for that name first.
   ```sh
   npx wrangler deploy -c wrangler.local.jsonc
   ```
6. **Connect Truecanvas:** `npx truecanvas share setup https://review.your-studio.com`.

## Sign-in

Clients and your team sign in with a link sent by email: no passwords. A link can be open to **invited people** (new links, by default), **anyone with its password**, or **anyone with the link**. Your studio's members open every link.

```sh
npx truecanvas share home --invite axel@client.com           # share, and email Axel an invitation
npx truecanvas share home --invite marie@client.com --link-only   # invite without a new version
npx truecanvas share home --access public --link-only        # who can open it: invited, password, public
```

An invitation stays valid until you remove it or invite the same person again. Its email opens a page with a button that signs the person in and opens the design; the 15-minute sign-in link is only created when they click, so mail scanners that follow links can't use it up. Signed-in people comment under their own name. The studio manages its members at `/members` and sees every link at `/links`.

Links shared before sign-in keep what they had: their password, or open.

Turn it on (step 3b below): sign-in needs `BETTER_AUTH_SECRET`, the owners' emails, and a sender address on a domain onboarded to Cloudflare Email Service.

## Live sites

Share with `--live`:

```sh
npx truecanvas share home --live out/                    # a static build, hosted here
npx truecanvas share home --live https://preview.example.com   # where the app already runs
```

A static build is any folder with an `index.html`: Next.js with `output: "export"` (`out/`), Vite (`dist/`). It's uploaded with the version; older versions keep theirs. Clean URLs and `404.html` work as on any static host. When the link has a password, the live site does too: the viewer hands the client a short-lived token, which the live host trades for a cookie.

Agents pass the same thing to `share_canvas` as `live`.

## Moving from the Vercel version

Links, passwords, versions, comments and files all come along, so nothing changes for clients. Use the same `REVIEW_TOKEN` as the Vercel site and Truecanvas needs no new setup.

```sh
cd ../review && vercel env pull .env.migrate && cd ../review-worker
node --env-file=../review/.env.migrate scripts/migrate.mjs --dry-run   # read everything, change nothing
node --env-file=../review/.env.migrate scripts/migrate.mjs             # copy into D1 and R2
```

Then deploy (step 5), which points `review.your-studio.com` here, and run the migration once more to pick up comments left in between: it's safe to repeat. Delete `../review/.env.migrate` afterwards.

## Develop

```sh
printf 'REVIEW_TOKEN=%s\nBETTER_AUTH_SECRET=%s\nLIVE_HOST_SUFFIX=-live.localhost\nSTUDIO_EMAILS=you@your-studio.com\nDEV_SHOW_EMAIL_LINKS=1\n' "$(openssl rand -hex 24)" "$(openssl rand -hex 32)" > .dev.vars
pnpm db:migrate:local
pnpm dev     # http://localhost:8787, live sites on http://<id>-live.localhost:8787
```

Locally, `wrangler dev` simulates Email Service: emails are written to files, not sent. With `DEV_SHOW_EMAIL_LINKS=1`, sign-in links also show on the page and invitation links come back to the CLI, so you can follow them.

Point a Truecanvas server at it with `TRUECANVAS_REVIEW_URL=http://localhost:8787` and `TRUECANVAS_REVIEW_TOKEN=<the token>` in its environment.
