import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { Workspace, PublicEntry } from "../core/workspace.js";
import { parseCanvas } from "../core/parse.js";
import { layoutFiles } from "../core/routes.js";
import { clearCompare, frameChanges, writeCompare } from "../core/compare.js";
import { findDevice } from "../core/devices.js";
import type { Screenshotter } from "./screenshot.js";

/*
 * "What changed" for the Git panel and pull requests: per page, which frames
 * changed against a ref (the last commit, or the PR's base), what was done to
 * them (from the edit history), and before/after renders.
 */

export type FrameStatus = "changed" | "added" | "removed";

export interface FrameReview {
  name: string;
  status: FrameStatus;
  /** what was done, newest last ("Removed Companies") */
  changes: { label: string; actor: string; at: number }[];
}

export interface PageReview {
  canvas: string;
  status: "modified" | "added" | "deleted";
  frames: FrameReview[];
  /** files of this page that differ: canvas, linked pages/layouts, comments */
  files: string[];
}

const actorName = (e: PublicEntry) => (e.actor.kind === "agent" ? e.actor.name : e.actor.kind === "file" ? "code editor" : "you");

/** A page's source at a ref, with the page/layout files its linked frames show. */
async function versionAt(ws: Workspace, canvas: string, ref: string) {
  const rel = ws.relFile(canvas);
  const source = await ws.git.show(ref, rel);
  const files: Record<string, string | null> = {};
  if (source !== null) {
    for (const f of parseCanvas(canvas, rel, source).frames) {
      if (!f.page) continue;
      for (const file of [f.page, ...layoutFiles(ws.config, f.page)]) files[file] = await ws.git.show(ref, file);
    }
  }
  return { source, files };
}

const readNow = (ws: Workspace, file: string) => {
  try {
    return fs.readFileSync(path.join(ws.config.root, file), "utf8");
  } catch {
    return null;
  }
};

/** Frames of a page that differ between `ref` and the working tree. */
export async function reviewPage(ws: Workspace, canvas: string, ref: string, since: number): Promise<PageReview | null> {
  const rel = ws.relFile(canvas);
  const exists = fs.existsSync(ws.file(canvas));
  const old = await versionAt(ws, canvas, ref);
  if (!exists && old.source === null) return null;
  const now = exists ? ws.read(canvas) : null;
  const files: string[] = [];
  if (old.source !== now) files.push(rel);

  const status: Record<string, FrameStatus> = {};
  if (old.source === null) {
    for (const f of parseCanvas(canvas, rel, now!).frames) status[f.frameName] = "added";
  } else if (now === null) {
    for (const f of parseCanvas(canvas, rel, old.source).frames) status[f.frameName] = "removed";
  } else {
    for (const [name, s] of Object.entries(frameChanges(old.source, now))) if (s !== "same") status[name] = s;
    // linked frames also change when their page or layout does
    const linkedNow = ws.doc(canvas).frames.filter((f) => f.page);
    for (const f of linkedNow) {
      for (const file of [f.page!, ...layoutFiles(ws.config, f.page!)]) {
        const before = file in old.files ? old.files[file] : await ws.git.show(ref, file);
        if (before !== readNow(ws, file)) {
          status[f.frameName] ??= "changed";
          if (!files.includes(file)) files.push(file);
        }
      }
    }
  }
  const comments = path.join(ws.config.canvasDir, `${canvas}.comments.json`);
  if ((await ws.git.show(ref, comments)) !== readNow(ws, comments)) files.push(comments);
  if (!files.length) return null;

  const history = exists ? ws.changesSince(canvas, since) : [];
  const frames: FrameReview[] = Object.entries(status).map(([name, s]) => ({
    name,
    status: s,
    changes: history.filter((e) => e.frames?.includes(name)).map((e) => ({ label: e.label, actor: actorName(e), at: e.at })),
  }));
  // edits that touched no frame in particular (page-level) go on the first changed frame
  const loose = history.filter((e) => !e.frames?.length || !e.frames.some((n) => n in status));
  if (loose.length && frames.length) frames[0].changes.push(...loose.map((e) => ({ label: e.label, actor: actorName(e), at: e.at })));
  for (const f of frames) f.changes.sort((a, b) => a.at - b.at);
  return { canvas, status: old.source === null ? "added" : now === null ? "deleted" : "modified", frames, files };
}

/** Every page with uncommitted changes. */
export async function reviewAll(ws: Workspace): Promise<PageReview[]> {
  const status = await ws.git.status();
  if (!status.repo) return [];
  const since = await ws.git.lastCommitAt();
  const ref = status.unborn ? "__none__" : "HEAD";
  const names = new Set(ws.canvases());
  // deleted pages show up only in git status
  for (const f of status.files) {
    const m = new RegExp(`^${ws.config.canvasDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/(.+)\\.canvas\\.tsx$`).exec(f.path);
    if (m) names.add(m[1]);
  }
  const changed = new Set(status.files.map((f) => f.path));
  const linked = new Set(ws.linkedFiles());
  const out: PageReview[] = [];
  for (const canvas of names) {
    // cheap filter: skip pages none of whose files changed
    const own = [ws.relFile(canvas), path.join(ws.config.canvasDir, `${canvas}.comments.json`)];
    const touchesLinked = [...linked].some((f) => changed.has(f));
    if (!own.some((f) => changed.has(f)) && !touchesLinked) continue;
    const page = await reviewPage(ws, canvas, ref, since).catch(() => null);
    if (page) out.push(page);
  }
  return out;
}

// ---------- before/after renders ----------

const cache = new Map<string, Buffer>();

/**
 * JPEG of a frame now ("after") or at a ref ("before"). The old version is
 * written as a hidden snapshot canvas (like Compare) and rendered by the app.
 */
let queue: Promise<unknown> = Promise.resolve();

export function renderFrame(ws: Workspace, shots: Screenshotter, canvas: string, frame: string, side: "before" | "after", ref: string): Promise<Buffer | null> {
  // one at a time: snapshots share files, and one Chromium page at a time keeps memory flat
  const job = queue.then(() => render(ws, shots, canvas, frame, side, ref));
  queue = job.catch(() => undefined);
  return job;
}

async function render(ws: Workspace, shots: Screenshotter, canvas: string, frame: string, side: "before" | "after", ref: string): Promise<Buffer | null> {
  let source: string | null;
  let files: Record<string, string> = {};
  if (side === "after") source = fs.existsSync(ws.file(canvas)) ? ws.read(canvas) : null;
  else {
    const old = await versionAt(ws, canvas, ref);
    source = old.source;
    for (const [f, content] of Object.entries(old.files)) if (content !== null && content !== readNow(ws, f)) files[f] = content;
  }
  if (source === null) return null;
  const doc = parseCanvas(canvas, ws.relFile(canvas), source);
  const f = doc.frames.find((x) => x.frameName === frame);
  if (!f) return null;
  // linked pages render from disk: their current content is part of the key
  const linkedNow = f.page ? [f.page, ...layoutFiles(ws.config, f.page)].map((x) => readNow(ws, x) ?? "").join("\0") : "";
  const key = createHash("sha1").update([canvas, frame, side, source, JSON.stringify(files), side === "after" ? linkedNow : ""].join("\0")).digest("hex");
  const hit = cache.get(key);
  if (hit) return hit;

  let name = canvas;
  const snapshot = `${canvas}.${side === "before" ? "base" : "now"}`;
  if (side === "before" || !fs.existsSync(ws.file(canvas))) name = writeCompare(ws.config, canvas, source, files, snapshot);
  try {
    const device = findDevice(f.device);
    const png = await shots.frame({ canvas: name, frame, width: f.width, height: f.height, theme: f.theme ?? "light", scale: Math.min(2, Math.max(0.4, 1000 / f.width)), mobile: device ? device.kind !== "desktop" : false, jpeg: true, maxHeight: 6000 });
    if (cache.size > 60) cache.delete(cache.keys().next().value!);
    cache.set(key, png);
    return png;
  } finally {
    if (name !== canvas) clearCompare(ws.config, snapshot);
  }
}

// ---------- pull request body ----------

export interface PrImage {
  canvas: string;
  frame: string;
  before: string | null;
  after: string | null;
}

/** Markdown for the PR: what changed per frame, with before/after images when there are some. */
export function prDesignSection(pages: PageReview[], images: PrImage[]): string {
  if (!pages.length) return "";
  const lines = ["## Design changes", "", "_Made in Truecanvas._", ""];
  for (const page of pages) {
    for (const f of page.frames) {
      lines.push(`### ${f.name} \`${page.canvas}\`${f.status === "added" ? " · new" : f.status === "removed" ? " · removed" : ""}`, "");
      const img = images.find((i) => i.canvas === page.canvas && i.frame === f.name);
      if (img && (img.before || img.after)) {
        if (img.before && img.after) lines.push("| Before | After |", "| --- | --- |", `| <img src="${img.before}" width="420"> | <img src="${img.after}" width="420"> |`, "");
        else lines.push(`<img src="${img.after ?? img.before}" width="420">`, "");
      }
      const seen = new Set<string>();
      for (const c of f.changes) {
        if (seen.has(c.label)) continue;
        seen.add(c.label);
        lines.push(`- ${c.label}${c.actor !== "you" ? ` _(${c.actor})_` : ""}`);
      }
      if (f.changes.length) lines.push("");
    }
  }
  return lines.join("\n");
}
