import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { toolEnv } from "../core/pm.js";

/*
 * Video encoding for shots: frames are piped to ffmpeg as images. MP4 (H.264)
 * is what X and LinkedIn take, so the system's ffmpeg with libx264 comes
 * first (or TRUECANVAS_FFMPEG); Playwright's own ffmpeg only writes WebM, the
 * fallback.
 */

export interface Encoder {
  bin: string;
  ext: "mp4" | "webm";
  /** frames are piped as this image type */
  frames: "jpeg" | "png";
}

let found: Encoder | null | undefined;

export function findEncoder(): Encoder | null {
  if (found !== undefined) return found;
  const env = toolEnv();
  const candidates = [process.env.TRUECANVAS_FFMPEG, "ffmpeg"].filter(Boolean) as string[];
  for (const bin of candidates) {
    const r = spawnSync(bin, ["-hide_banner", "-encoders"], { env, encoding: "utf8", timeout: 5000 });
    if (r.status === 0 && /libx264/.test(r.stdout)) return (found = { bin, ext: "mp4", frames: "jpeg" });
  }
  // Playwright's ffmpeg: VP8 in WebM only
  const cache = process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(os.homedir(), process.platform === "darwin" ? "Library/Caches/ms-playwright" : process.platform === "win32" ? "AppData/Local/ms-playwright" : ".cache/ms-playwright");
  try {
    for (const dir of fs.readdirSync(cache).filter((d) => d.startsWith("ffmpeg-")).sort().reverse()) {
      const bin = ["ffmpeg-linux", "ffmpeg-mac", "ffmpeg-win64.exe"].map((f) => path.join(cache, dir, f)).find((f) => fs.existsSync(f));
      if (bin) return (found = { bin, ext: "webm", frames: "png" });
    }
  } catch {
    /* no Playwright cache */
  }
  return (found = null);
}

export const NO_ENCODER =
  "Videos need ffmpeg. Install it (Fedora: sudo dnf install ffmpeg, Ubuntu: sudo apt install ffmpeg, macOS: brew install ffmpeg) or set TRUECANVAS_FFMPEG to its path.";

/** An ffmpeg process that takes images on stdin and writes a video file. */
export function startEncoder(enc: Encoder, fps: number) {
  const out = path.join(os.tmpdir(), `truecanvas-shot-${process.pid}-${Date.now()}.${enc.ext}`);
  const codec =
    enc.ext === "mp4"
      ? ["-c:v", "libx264", "-preset", "medium", "-crf", "17", "-pix_fmt", "yuv420p", "-movflags", "+faststart"]
      : ["-c:v", "libvpx", "-crf", "6", "-b:v", "12M", "-deadline", "good"];
  const ff = spawn(enc.bin, ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(fps), "-i", "-", ...codec, "-r", String(fps), out], { env: toolEnv(), stdio: ["pipe", "ignore", "pipe"] });
  let err = "";
  ff.stderr.on("data", (d: Buffer) => (err = (err + d.toString()).slice(-2000)));
  const closed = new Promise<number>((resolve) => ff.on("close", (code) => resolve(code ?? 1)));
  return {
    async write(frame: Buffer) {
      if (!ff.stdin.write(frame)) await new Promise<void>((r) => ff.stdin.once("drain", () => r()));
    },
    async finish(): Promise<Buffer> {
      ff.stdin.end();
      const code = await closed;
      try {
        if (code !== 0) throw new Error(`ffmpeg failed: ${err.trim() || `exit ${code}`}`);
        return fs.readFileSync(out);
      } finally {
        fs.rmSync(out, { force: true });
      }
    },
    abort() {
      ff.kill("SIGKILL");
      fs.rmSync(out, { force: true });
    },
  };
}

/** One frame of a video as a small PNG (what an agent looks at). */
export function videoStill(enc: Encoder, video: Buffer, ext: string, at: number, width = 432): Buffer | null {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "truecanvas-still-"));
  try {
    const input = path.join(dir, `in.${ext}`);
    const out = path.join(dir, "still.png");
    fs.writeFileSync(input, video);
    const r = spawnSync(enc.bin, ["-y", "-loglevel", "error", "-ss", String(at), "-i", input, "-frames:v", "1", "-vf", `scale=${width}:-2`, out], { env: toolEnv(), timeout: 20_000 });
    return r.status === 0 && fs.existsSync(out) ? fs.readFileSync(out) : null;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
