import crypto from "node:crypto";
import { findDevice } from "../core/devices.js";
import { captureHeight, normalizeShot, SHOT_FORMATS, type Shot } from "../core/shot-model.js";
import type { Workspace } from "../core/workspace.js";
import type { Screenshotter } from "./screenshot.js";

/*
 * Shots, server side: the frame is captured by the app (like Share does),
 * cached so backdrop changes don't re-render the page, and exported by
 * opening Truecanvas's compositor page (/shot.html, never the app) at the
 * format's size in the screenshot browser.
 */

interface Capture {
  png: Buffer;
  /** CSS px of the captured frame */
  width: number;
  height: number;
  at: number;
}

/** A capture stays fresh this long for previews; exports always capture again. */
const FRESH_MS = 5 * 60_000;

export class ShotService {
  private captures = new Map<string, Capture>();
  private jobs = new Map<string, { shot: Shot; key: string; expires: number }>();

  constructor(
    private ws: Workspace,
    private shots: Screenshotter,
    /** where the editor (and /shot.html) is served */
    private origin: () => string,
  ) {}

  private frameOf(canvas: string, name: string) {
    const frame = this.ws.doc(canvas).frames.find((f) => f.frameName === name);
    if (!frame) throw new Error(`No frame named "${name}" in ${canvas}.`);
    return frame;
  }

  /** What a shot's capture depends on: the frame and how much of it is shown. */
  key(canvas: string, shot: Shot) {
    const f = this.ws.doc(canvas).frames.find((x) => x.frameName === shot.frame);
    return crypto.createHash("sha1").update(JSON.stringify([canvas, shot.frame, captureHeight(shot, f?.width ?? 1440)])).digest("hex").slice(0, 16);
  }

  /** The frame rendered by the app: from the cache unless `fresh` or stale. */
  async capture(canvas: string, input: unknown, fresh = false): Promise<{ key: string; capture: Capture }> {
    const shot = normalizeShot(input);
    const key = this.key(canvas, shot);
    const hit = this.captures.get(key);
    if (hit && !fresh && Date.now() - hit.at < FRESH_MS) return { key, capture: hit };
    const f = this.frameOf(canvas, shot.frame);
    const device = findDevice(f.device);
    const maxHeight = captureHeight(shot, f.width);
    // very tall captures at 2x pass the browser's image size limit
    const scale = Math.min(maxHeight, f.height ?? maxHeight) * 2 > 14_000 ? 1 : 2;
    const png = await this.shots.frame({ canvas, frame: f.frameName, width: f.width, height: f.height, theme: f.theme ?? "light", scale, mobile: device ? device.kind !== "desktop" : false, maxHeight });
    const capture = { png, width: f.width, height: Math.round(pngHeight(png) / scale), at: Date.now() };
    this.captures.set(key, capture);
    if (this.captures.size > 40) this.captures.delete(this.captures.keys().next().value!);
    return { key, capture };
  }

  /** The cached frame image, for the editor's preview and the export page. */
  image(key: string): Buffer | null {
    return this.captures.get(key)?.png ?? null;
  }

  /** What the export page renders: the shot and its frame image. */
  job(id: string) {
    const job = this.jobs.get(id);
    if (!job || job.expires < Date.now()) return null;
    const c = this.captures.get(job.key);
    if (!c) return null;
    return { shot: job.shot, image: { src: `/api/shot/frame?key=${job.key}&t=${c.at}`, width: c.width, height: c.height } };
  }

  /** A small render from the cached capture: what an agent looks at. */
  async preview(canvas: string, input: unknown, scale = 0.4): Promise<Buffer> {
    const shot = normalizeShot(input);
    const { key } = await this.capture(canvas, shot);
    const id = crypto.randomBytes(9).toString("base64url");
    this.jobs.set(id, { shot, key, expires: Date.now() + 120_000 });
    try {
      const { width, height } = SHOT_FORMATS[shot.format];
      return await this.shots.render(`${this.origin()}/shot.html?job=${id}`, { width, height }, scale);
    } finally {
      this.jobs.delete(id);
    }
  }

  /** The shot as a PNG: the frame captured again (the design may have changed), then composed. */
  async export(canvas: string, input: unknown): Promise<{ png: Buffer; width: number; height: number; shot: Shot }> {
    const shot = normalizeShot(input);
    const { key } = await this.capture(canvas, shot, true);
    const id = crypto.randomBytes(9).toString("base64url");
    this.jobs.set(id, { shot, key, expires: Date.now() + 120_000 });
    try {
      const { width, height } = SHOT_FORMATS[shot.format];
      const png = await this.shots.render(`${this.origin()}/shot.html?job=${id}`, { width, height }, shot.scale);
      return { png, width: width * shot.scale, height: height * shot.scale, shot };
    } finally {
      this.jobs.delete(id);
    }
  }
}

/** A PNG's height in pixels, from its header. */
function pngHeight(png: Buffer) {
  return png.readUInt32BE(20);
}
