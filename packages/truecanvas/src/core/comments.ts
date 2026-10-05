import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { TruecanvasConfig } from "./config.js";

export interface CommentAuthor {
  name: string;
  kind: "user" | "agent";
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
  messages: CommentMessage[];
  createdAt: number;
}

interface CommentFile {
  version: 1;
  threads: CommentThread[];
}

/**
 * Comments live next to the canvas in `<page>.comments.json`, so they are
 * versioned, reviewed and merged with git like the design itself.
 */
export class Comments {
  constructor(private config: TruecanvasConfig) {}

  file(canvas: string) {
    return path.join(this.config.root, this.config.canvasDir, `${canvas}.comments.json`);
  }

  list(canvas: string): CommentThread[] {
    try {
      return (JSON.parse(fs.readFileSync(this.file(canvas), "utf8")) as CommentFile).threads ?? [];
    } catch {
      return [];
    }
  }

  private save(canvas: string, threads: CommentThread[]) {
    const file = this.file(canvas);
    if (!threads.length) {
      if (fs.existsSync(file)) fs.rmSync(file);
      return;
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify({ version: 1, threads } satisfies CommentFile, null, 2)}\n`);
  }

  private update(canvas: string, id: string, fn: (t: CommentThread) => void) {
    const threads = this.list(canvas);
    const t = threads.find((x) => x.id === id || x.id.startsWith(id));
    if (!t) throw new Error(`No comment thread "${id}".`);
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
    });
  }

  remove(canvas: string, id: string) {
    this.save(
      canvas,
      this.list(canvas).filter((t) => t.id !== id),
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
