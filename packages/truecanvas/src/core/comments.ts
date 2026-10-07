import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { TruecanvasConfig } from "./config.js";
import { assertCanvasName } from "./scaffold.js";

export interface CommentAuthor {
  name: string;
  /** client: someone commenting on a share link (synced from the review site) */
  kind: "user" | "agent" | "client";
}

export interface CommentMessage {
  id: string;
  author: CommentAuthor;
  text: string;
  at: number;
}

export interface CommentThread {
  id: string;
  /** frame name + position in frame coordinates */
  frame: string;
  x: number;
  y: number;
  /** the layer under the pin when it was placed (tree path + name), best effort */
  node: { path: string; name: string } | null;
  resolved: boolean;
  resolvedBy?: CommentAuthor;
  /** when `resolved` last changed, to sync it with a share link both ways */
  resolvedAt?: number;
  messages: CommentMessage[];
  createdAt: number;
  /** a client thread from a share link: replies and resolutions go back to it */
  share?: { link: string; version: string };
}

interface CommentFile {
  version: 1;
  threads: CommentThread[];
  /** client threads deleted here: the share link's sync doesn't bring them back */
  dismissed?: string[];
}

/**
 * Comments live next to the canvas in `<page>.comments.json`, so they are
 * versioned, reviewed and merged with git like the design itself.
 */
export class Comments {
  constructor(private config: TruecanvasConfig) {}

  file(canvas: string) {
    return path.join(this.config.root, this.config.canvasDir, `${assertCanvasName(canvas)}.comments.json`);
  }

  private read(canvas: string): CommentFile {
    try {
      const f = JSON.parse(fs.readFileSync(this.file(canvas), "utf8")) as CommentFile;
      return { version: 1, threads: f.threads ?? [], dismissed: f.dismissed };
    } catch {
      return { version: 1, threads: [] };
    }
  }

  list(canvas: string): CommentThread[] {
    return this.read(canvas).threads;
  }

  /** Ids of client threads deleted here. */
  dismissed(canvas: string): Set<string> {
    return new Set(this.read(canvas).dismissed ?? []);
  }

  private save(canvas: string, threads: CommentThread[], dismissed = this.read(canvas).dismissed) {
    const file = this.file(canvas);
    if (!threads.length && !dismissed?.length) {
      if (fs.existsSync(file)) fs.rmSync(file);
      return;
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const data: CommentFile = { version: 1, threads, ...(dismissed?.length ? { dismissed } : {}) };
    fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
  }

  private update(canvas: string, id: string, fn: (t: CommentThread) => void) {
    const threads = this.list(canvas);
    // an exact id, or an unambiguous prefix of at least 4 characters
    const prefixed = id.length >= 4 ? threads.filter((x) => x.id.startsWith(id)) : [];
    const t = threads.find((x) => x.id === id) ?? (prefixed.length === 1 ? prefixed[0] : undefined);
    if (!t) throw new Error(prefixed.length > 1 ? `"${id}" matches several comment threads. Use the full id.` : `No comment thread "${id}".`);
    fn(t);
    this.save(canvas, threads);
    return t;
  }

  add(canvas: string, input: { frame: string; x: number; y: number; node?: CommentThread["node"]; text: string; author: CommentAuthor }): CommentThread {
    const threads = this.list(canvas);
    const now = Date.now();
    const thread: CommentThread = {
      id: randomUUID().slice(0, 8),
      frame: input.frame,
      x: Math.round(input.x),
      y: Math.round(input.y),
      node: input.node ?? null,
      resolved: false,
      messages: [{ id: randomUUID().slice(0, 8), author: input.author, text: input.text.trim(), at: now }],
      createdAt: now,
    };
    threads.push(thread);
    this.save(canvas, threads);
    return thread;
  }

  reply(canvas: string, id: string, text: string, author: CommentAuthor) {
    return this.update(canvas, id, (t) => {
      t.messages.push({ id: randomUUID().slice(0, 8), author, text: text.trim(), at: Date.now() });
    });
  }

  resolve(canvas: string, id: string, resolved: boolean, author: CommentAuthor) {
    return this.update(canvas, id, (t) => {
      t.resolved = resolved;
      t.resolvedBy = resolved ? author : undefined;
      t.resolvedAt = Date.now();
    });
  }

  /** Applies synced threads (from a share link) in one write; returns whether anything changed. */
  merge(canvas: string, fn: (threads: CommentThread[]) => boolean): boolean {
    const threads = this.list(canvas);
    if (!fn(threads)) return false;
    this.save(canvas, threads);
    return true;
  }

  remove(canvas: string, id: string) {
    const { threads, dismissed = [] } = this.read(canvas);
    const gone = threads.find((t) => t.id === id);
    this.save(
      canvas,
      threads.filter((t) => t.id !== id),
      gone?.share ? [...new Set([...dismissed, id])] : dismissed,
    );
  }

  /** Frames keep their comments when renamed. */
  renameFrame(canvas: string, from: string, to: string) {
    const threads = this.list(canvas);
    let changed = false;
    for (const t of threads) if (t.frame === from) (t.frame = to), (changed = true);
    if (changed) this.save(canvas, threads);
  }

  renameCanvas(from: string, to: string) {
    const a = this.file(from);
    if (fs.existsSync(a)) fs.renameSync(a, this.file(to));
  }
}
