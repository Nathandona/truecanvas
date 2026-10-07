import path from "node:path";
import type { Workspace } from "../core/workspace.js";
import type { CommentAuthor, CommentMessage, CommentThread } from "../core/comments.js";
import { reviewSite, type ReviewSite } from "./publish.js";

/*
 * Client comments on share links, kept in sync with the canvas's comments
 * file while Truecanvas runs:
 * - threads clients start on a link appear here (author kind "client");
 * - replies and resolutions made here, by the user or an agent, go back.
 * Messages keep their id on both sides, so syncing twice never duplicates.
 * Threads started here stay internal: clients never see them.
 */

interface RemoteThread {
  id: string;
  frame: string;
  version: string;
  x: number;
  y: number;
  resolved: boolean;
  resolvedAt?: number;
  resolvedBy?: { name: string; kind: "client" | "studio" };
  messages: { id: string; author: { name: string; kind: "client" | "studio" }; text: string; at: number }[];
  createdAt: number;
  updatedAt: number;
}

const EVERY = 20_000;
const LOOKUP_EVERY = 5 * 60_000;

export class CommentSync {
  private links = new Map<string, { slug: string | null; at: number }>();
  private remote = new Map<string, { updated: number; threads: RemoteThread[] }>();
  private timer: NodeJS.Timeout | null = null;
  private kickTimer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private off: (() => void) | null = null;

  constructor(private ws: Workspace) {}

  start() {
    this.timer = setInterval(() => void this.syncAll(), EVERY);
    this.timer.unref();
    setTimeout(() => void this.syncAll(), 3000).unref();
    // a reply or resolution written here (editor, agent, code editor): send it soon
    this.off = this.ws.on((e) => {
      if (e.type !== "comments") return;
      if (this.kickTimer) clearTimeout(this.kickTimer);
      this.kickTimer = setTimeout(() => void this.syncAll(), 1500);
    });
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    if (this.kickTimer) clearTimeout(this.kickTimer);
    this.off?.();
  }

  /** A canvas was just shared: look its link up again on the next sync. */
  forget(canvas: string) {
    this.links.delete(canvas);
  }

  syncAll(): Promise<void> {
    // one pass at a time
    this.running ??= this.pass().finally(() => (this.running = null));
    return this.running;
  }

  private async pass() {
    const site = reviewSite();
    if (!site) return;
    for (const canvas of this.ws.canvases()) {
      try {
        await this.syncCanvas(site, canvas);
      } catch {
        // offline, or the site is down: the next pass retries
      }
    }
  }

  private async slugOf(site: ReviewSite, canvas: string): Promise<string | null> {
    const known = this.links.get(canvas);
    if (known && (known.slug || Date.now() - known.at < LOOKUP_EVERY)) return known.slug;
    const project = path.basename(this.ws.config.root);
    const res = (await call(site, "GET", `/api/shares?project=${encodeURIComponent(project)}&canvas=${encodeURIComponent(canvas)}`)) as { slug: string | null };
    this.links.set(canvas, { slug: res.slug, at: Date.now() });
    return res.slug;
  }

  async syncCanvas(site: ReviewSite, canvas: string) {
    const slug = await this.slugOf(site, canvas);
    if (!slug) return;
    const cached = this.remote.get(slug);
    const res = (await call(site, "GET", `/api/shares/${slug}/comments?since=${cached?.updated ?? 0}`)) as { updated: number; threads: RemoteThread[] | null };
    const remote = res.threads ?? cached?.threads ?? [];
    this.remote.set(slug, { updated: res.updated, threads: remote });
    const byId = new Map(remote.map((t) => [t.id, t]));

    // 1. the link's threads into the comments file
    const dismissed = this.ws.comments.dismissed(canvas);
    this.ws.comments.merge(canvas, (local) => {
      let changed = false;
      for (const r of remote) {
        if (dismissed.has(r.id)) continue;
        const l = local.find((t) => t.id === r.id);
        if (!l) {
          local.push(fromRemote(r, slug));
          changed = true;
          continue;
        }
        if (!l.share) continue;
        const have = new Set(l.messages.map((m) => m.id));
        for (const m of r.messages) {
          if (have.has(m.id)) continue;
          l.messages.push(message(m));
          changed = true;
        }
        if (changed) l.messages.sort((a, b) => a.at - b.at);
        // the newer resolution wins
        if (r.resolved !== l.resolved && (r.resolvedAt ?? 0) > (l.resolvedAt ?? 0)) {
          l.resolved = r.resolved;
          l.resolvedBy = r.resolved && r.resolvedBy ? author(r.resolvedBy) : undefined;
          l.resolvedAt = r.resolvedAt;
          changed = true;
        }
      }
      return changed;
    });

    // 2. replies and resolutions made here, back to the link
    let pushed = false;
    for (const l of this.ws.comments.list(canvas)) {
      if (l.share?.link !== slug) continue;
      const r = byId.get(l.id);
      if (!r) continue;
      const there = new Set(r.messages.map((m) => m.id));
      for (const m of l.messages) {
        if (there.has(m.id) || m.author.kind === "client") continue;
        await call(site, "POST", `/api/shares/${slug}/comments`, { thread: l.id, message: { id: m.id, name: displayName(m.author), text: m.text, at: m.at } });
        pushed = true;
      }
      if (l.resolved !== r.resolved && (l.resolvedAt ?? 0) > (r.resolvedAt ?? 0)) {
        await call(site, "POST", `/api/shares/${slug}/comments`, { thread: l.id, resolved: l.resolved, name: l.resolvedBy ? displayName(l.resolvedBy) : "Studio" });
        pushed = true;
      }
    }
    // read our own writes back next time, so their timestamps match the link's
    if (pushed) this.remote.delete(slug);
  }
}

function fromRemote(r: RemoteThread, slug: string): CommentThread {
  return {
    id: r.id,
    frame: r.frame,
    x: r.x,
    y: r.y,
    node: null,
    resolved: r.resolved,
    ...(r.resolved && r.resolvedBy ? { resolvedBy: author(r.resolvedBy) } : {}),
    ...(r.resolvedAt ? { resolvedAt: r.resolvedAt } : {}),
    messages: r.messages.map(message),
    createdAt: r.createdAt,
    share: { link: slug, version: r.version },
  };
}

/** The studio's own messages come back as the user's. */
const author = (a: { name: string; kind: "client" | "studio" }): CommentAuthor => ({ name: a.name, kind: a.kind === "client" ? "client" : "user" });
const message = (m: RemoteThread["messages"][number]): CommentMessage => ({ id: m.id, author: author(m.author), text: m.text, at: m.at });

/** "claude-code" reads as "Claude" to a client. */
function displayName(a: CommentAuthor): string {
  if (a.kind !== "agent") return a.name;
  const base = a.name.replace(/[-_ ]?(code|cli|agent)$/i, "") || a.name;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

async function call(site: ReviewSite, method: string, route: string, body?: unknown): Promise<unknown> {
  const res = await fetch(site.url + route, {
    method,
    headers: { authorization: `Bearer ${site.token}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Review site ${res.status}`);
  return res.json();
}
