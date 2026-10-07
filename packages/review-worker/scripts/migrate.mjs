#!/usr/bin/env node
/*
 * Moves a review site from the Vercel version (packages/review: Upstash
 * Redis + private Vercel Blob) to this one (D1 + R2). Every share, version,
 * password, asset list, comment and file comes along, so existing links,
 * passwords and comments keep working once the domain points here.
 *
 *   node scripts/migrate.mjs --dry-run          read everything, write the SQL, change nothing
 *   node scripts/migrate.mjs                    copy into the deployed D1 database and R2 bucket
 *   node scripts/migrate.mjs --local            copy into wrangler dev's local D1 and R2 (a rehearsal)
 *
 * Options: -c <wrangler config> (default wrangler.local.jsonc, else wrangler.jsonc),
 *          --no-files (records only), --database <name>, --bucket <name>.
 * Reads (never prints) from the environment, e.g. `vercel env pull`:
 *   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN (or KV_REST_API_URL / KV_REST_API_TOKEN)
 *   BLOB_READ_WRITE_TOKEN
 * Writes go through wrangler (already signed in). Safe to run again: records
 * are upserted, files already copied are remembered in .migrate-done.txt.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { parseArgs } from "node:util";

const here = path.dirname(new URL(import.meta.url).pathname);
const pkg = path.resolve(here, "..");
const { values } = parseArgs({
  options: {
    "dry-run": { type: "boolean" },
    local: { type: "boolean" },
    "no-files": { type: "boolean" },
    config: { type: "string", short: "c" },
    database: { type: "string", default: "truecanvas-review" },
    bucket: { type: "string", default: "truecanvas-review" },
  },
});
const dry = !!values["dry-run"];
const config = values.config ?? (fs.existsSync(path.join(pkg, "wrangler.local.jsonc")) ? "wrangler.local.jsonc" : "wrangler.jsonc");
const where = values.local ? "--local" : "--remote";

const redisUrl = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
if (!redisUrl || !redisToken) fail("Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN (vercel env pull, in packages/review).");
if (!values["no-files"] && !process.env.BLOB_READ_WRITE_TOKEN) fail("Set BLOB_READ_WRITE_TOKEN, or pass --no-files.");

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

async function redis(...command) {
  const res = await fetch(redisUrl, { method: "POST", headers: { authorization: `Bearer ${redisToken}` }, body: JSON.stringify(command) });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(`Redis ${command[0]}: ${data.error ?? res.status}`);
  return data.result;
}

async function scan(match) {
  const keys = [];
  let cursor = "0";
  do {
    const [next, batch] = await redis("SCAN", cursor, "MATCH", match, "COUNT", 500);
    keys.push(...batch);
    cursor = String(next);
  } while (cursor !== "0");
  return keys;
}

// @upstash/redis writes objects as JSON but plain strings as-is
const parse = (v) => {
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
};
const q = (v) => (v === null || v === undefined ? "NULL" : typeof v === "number" ? String(Math.round(v)) : `'${String(v).replace(/'/g, "''")}'`);

// ---------- 1. records ----------

const sql = [];
let threads = 0;
let messages = 0;
const slugs = [];
for (const key of await scan("tc:share:*")) {
  const share = parse(await redis("GET", key));
  if (!share?.slug) continue;
  slugs.push(share.slug);
  sql.push(
    `INSERT OR REPLACE INTO shares (slug, key, project, canvas, title, created_at, password, revoked, comments_updated) VALUES (${[
      share.slug,
      share.slug.slice(-10),
      share.project,
      share.canvas,
      share.title,
      share.createdAt,
      share.password ?? null,
      share.revoked ? 1 : 0,
      Number(parse(await redis("GET", `tc:comments-updated:${share.slug}`)) ?? 0),
    ]
      .map(q)
      .join(", ")});`,
  );
  for (const v of share.versions ?? [])
    sql.push(`INSERT OR REPLACE INTO versions (slug, id, created_at, frames, live) VALUES (${[share.slug, v.id, v.createdAt, JSON.stringify(v.frames), null].map(q).join(", ")});`);
  for (const name of (await redis("SMEMBERS", `tc:assets:${share.slug}`)) ?? []) sql.push(`INSERT OR IGNORE INTO assets (slug, name) VALUES (${q(share.slug)}, ${q(name)});`);
  const hash = (await redis("HGETALL", `tc:comments:${share.slug}`)) ?? [];
  // HGETALL over REST: [field, value, field, value, ...]
  for (let i = 1; i < hash.length; i += 2) {
    const t = parse(hash[i]);
    threads++;
    sql.push(
      `INSERT OR REPLACE INTO threads (slug, id, frame, version, x, y, resolved, resolved_at, resolved_by, created_at, updated_at) VALUES (${[
        share.slug,
        t.id,
        t.frame,
        t.version,
        t.x,
        t.y,
        t.resolved ? 1 : 0,
        t.resolvedAt ?? null,
        t.resolved && t.resolvedBy ? JSON.stringify(t.resolvedBy) : null,
        t.createdAt,
        t.updatedAt,
      ]
        .map(q)
        .join(", ")});`,
    );
    for (const m of t.messages ?? []) {
      messages++;
      sql.push(`INSERT OR IGNORE INTO messages (slug, thread, id, author_name, author_kind, text, at) VALUES (${[share.slug, t.id, m.id, m.author.name, m.author.kind, m.text, m.at].map(q).join(", ")});`);
    }
  }
}
for (const key of await scan("tc:index:*")) {
  const slug = parse(await redis("GET", key));
  const target = key.slice("tc:index:".length);
  const cut = target.indexOf("/");
  if (slug && cut > 0 && slugs.includes(slug)) sql.push(`INSERT OR REPLACE INTO share_index (project, canvas, slug) VALUES (${[target.slice(0, cut), target.slice(cut + 1), slug].map(q).join(", ")});`);
}

const sqlFile = path.join(pkg, ".migrate.sql");
fs.writeFileSync(sqlFile, sql.join("\n") + "\n");
console.log(`${slugs.length} links, ${threads} comment threads, ${messages} messages → ${path.relative(process.cwd(), sqlFile)}`);

// ---------- 2. files ----------

let files = [];
if (!values["no-files"]) {
  // the original review site's own client for the private store
  const require = createRequire(path.resolve(pkg, "../review/package.json"));
  const { list, get } = await import(require.resolve("@vercel/blob"));
  let cursor;
  do {
    const page = await list({ prefix: "shares/", cursor, limit: 1000 });
    files.push(...page.blobs.map((b) => ({ pathname: b.pathname, size: b.size })));
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  const bytes = files.reduce((n, f) => n + f.size, 0);
  console.log(`${files.length} files, ${(bytes / 1024 / 1024).toFixed(1)} MB in Vercel Blob`);

  if (!dry) {
    const wrangler = (...args) => execFileSync(path.join(pkg, "node_modules/.bin/wrangler"), [...args, "-c", config], { cwd: pkg, stdio: ["ignore", "ignore", "inherit"] });
    console.log(`Records → D1 ${values.database} (${where.slice(2)})`);
    wrangler("d1", "execute", values.database, where, "--file", sqlFile, "--yes");

    const doneFile = path.join(pkg, `.migrate-done${values.local ? "-local" : ""}.txt`);
    const done = new Set(fs.existsSync(doneFile) ? fs.readFileSync(doneFile, "utf8").split("\n").filter(Boolean) : []);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tc-migrate-"));
    let copied = 0;
    for (const f of files) {
      if (done.has(f.pathname)) continue;
      const res = await get(f.pathname, { access: "private" });
      if (!res || res.statusCode !== 200) {
        console.warn(`  ! couldn't read ${f.pathname}`);
        continue;
      }
      const local = path.join(tmp, "file");
      fs.writeFileSync(local, Buffer.from(await new Response(res.stream).arrayBuffer()));
      wrangler("r2", "object", "put", `${values.bucket}/${f.pathname}`, where, "--file", local, "--content-type", res.blob.contentType || "application/octet-stream");
      fs.appendFileSync(doneFile, f.pathname + "\n");
      if (++copied % 25 === 0) console.log(`  ${copied} files copied…`);
    }
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(`✓ ${copied} files copied to R2 ${values.bucket} (${files.length - copied} already there)`);
  }
} else if (!dry) {
  execFileSync(path.join(pkg, "node_modules/.bin/wrangler"), ["d1", "execute", values.database, where, "--file", sqlFile, "--yes", "-c", config], { cwd: pkg, stdio: ["ignore", "ignore", "inherit"] });
}

if (dry) console.log("Dry run: nothing was written. Run again without --dry-run to copy.");
else console.log("✓ Done. Open a link on the new site before pointing the domain at it.");
