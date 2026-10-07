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
3. **The studio token.** A long random string; Truecanvas sends it to upload and manage links.
   ```sh
   npx wrangler secret put REVIEW_TOKEN -c wrangler.local.jsonc
   ```
4. **DNS for the live sites.** Add a proxied wildcard record so `*-live` hosts reach Cloudflare: type `AAAA`, name `*`, content `100::`, proxied. (If `*` already points somewhere else, such as another host's wildcard, decide which one you keep: specific records like `www` are not affected.)
5. **Deploy.** The custom domain is created on the first deploy; remove any existing DNS record for that name first.
   ```sh
   npx wrangler deploy -c wrangler.local.jsonc
   ```
6. **Connect Truecanvas:** `npx truecanvas share setup https://review.your-studio.com`.

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
printf 'REVIEW_TOKEN=%s\nLIVE_HOST_SUFFIX=-live.localhost\n' "$(openssl rand -hex 24)" > .dev.vars
pnpm db:migrate:local
pnpm dev     # http://localhost:8787, live sites on http://<id>-live.localhost:8787
```

Point a Truecanvas server at it with `TRUECANVAS_REVIEW_URL=http://localhost:8787` and `TRUECANVAS_REVIEW_TOKEN=<the token>` in its environment.
