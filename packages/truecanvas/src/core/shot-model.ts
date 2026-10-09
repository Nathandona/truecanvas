/*
 * Shots: a frame staged for social posts, on a backdrop (a Paper shader, a
 * gradient or a color), with framing (margin, corners, shadow, tilt, browser
 * or phone chrome) at a social format. Settings live next to the canvas in
 * `<page>.shots.json` so a shot can be regenerated after the design changes.
 *
 * No Node or browser APIs here: the editor (the compositor) and the server
 * (storage, export, CLI, MCP) share this file.
 */

export type ShotFormat = "4:5" | "1:1" | "16:9" | "9:16" | "3:2";

/** CSS size of each format; exports render at 1x or 2x of it. */
export const SHOT_FORMATS: Record<ShotFormat, { width: number; height: number; label: string }> = {
  "4:5": { width: 1080, height: 1350, label: "Feed (LinkedIn, X)" },
  "1:1": { width: 1080, height: 1080, label: "Square" },
  "16:9": { width: 1600, height: 900, label: "Wide (X, slides)" },
  "9:16": { width: 1080, height: 1920, label: "Story" },
  "3:2": { width: 1500, height: 1000, label: "Landscape" },
};

/** Paper shaders offered as backdrops (static: speed 0, `seed` picks the frame). */
export const SHOT_SHADERS = ["MeshGradient", "GrainGradient", "StaticMeshGradient", "StaticRadialGradient", "Warp"] as const;
export type ShotShader = (typeof SHOT_SHADERS)[number];

export interface ShotBackdrop {
  type: "shader" | "gradient" | "solid";
  /** type "shader" */
  shader: ShotShader;
  /** 2 to 5 colors, the first is the base */
  colors: string[];
  /** gradient direction in degrees (type "gradient") */
  angle: number;
  /** which variation of the shader: "Shuffle" picks another */
  seed: number;
  /** film grain over the backdrop, 0 to 1 */
  grain: number;
}

export interface ShotFraming {
  /** space around the design, as a share of the format's shorter side (0 to 0.3) */
  padding: number;
  /** corner radius in px */
  radius: number;
  shadow: "none" | "soft" | "strong";
  /** 3D tilt in degrees (-20 to 20) */
  tilt: number;
  chrome: "none" | "browser" | "phone";
  /** centered, or rising from the bottom edge and cut off by it */
  position: "center" | "bleed";
}

export interface ShotCrop {
  /** the top of the frame (most social posts), or all of it */
  mode: "top" | "full";
  /** with "top": how many px of the frame, from its top */
  height: number;
}

/** How a video shot moves. */
export interface ShotMotion {
  /** reveal: the frame rises into place while its own animations play; scroll: the page scrolls like a visitor would; drift: a slow push in */
  template: "reveal" | "scroll" | "drift";
  /** seconds */
  duration: number;
  /** the shader backdrop drifts gently */
  backdropMotion: boolean;
  /** scroll: how far down the page goes, in the frame's px */
  scrollDistance: number;
}

export const SHOT_MOTIONS: { value: ShotMotion["template"]; label: string; hint: string }[] = [
  { value: "reveal", label: "Reveal", hint: "The design rises into place while its own animations play" },
  { value: "scroll", label: "Scroll", hint: "The page scrolls like a visitor would, scroll animations included" },
  { value: "drift", label: "Drift", hint: "A slow push in on the design" },
];

export interface Shot {
  id: string;
  /** an image (PNG) or a video (MP4) */
  kind: "image" | "video";
  /** the frame's name in the canvas */
  frame: string;
  format: ShotFormat;
  crop: ShotCrop;
  backdrop: ShotBackdrop;
  framing: ShotFraming;
  /** 1 or 2 (2: sharp on retina screens) */
  scale: 1 | 2;
  motion: ShotMotion;
  updatedAt: number;
}

/** Colors that work on any design until the project's own are picked. */
export const SHOT_DEFAULT_COLORS = ["#1e1b4b", "#6d5dfc", "#f0abfc", "#fde68a"];

const clamp = (n: unknown, min: number, max: number, fallback: number) => (typeof n === "number" && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback);
const oneOf = <T extends string>(v: unknown, options: readonly T[], fallback: T): T => (options.includes(v as T) ? (v as T) : fallback);
const isColor = (c: unknown): c is string => typeof c === "string" && /^(#[0-9a-f]{3,8}|rgba?\([^)]{5,40}\)|hsla?\([^)]{5,40}\)|oklch\([^)]{5,60}\))$/i.test(c.trim());

export function newShotId() {
  return Math.random().toString(36).slice(2, 10);
}

/** A new shot of a frame, with the project's colors when known. */
export function newShot(frame: string, colors: string[] = []): Shot {
  const picked = colors.filter(isColor).slice(0, 4);
  return normalizeShot({ id: newShotId(), frame, backdrop: { colors: picked.length >= 2 ? picked : SHOT_DEFAULT_COLORS } });
}

/** Any input (a saved file, an agent's request) made into a complete, safe shot. */
export function normalizeShot(input: unknown): Shot {
  const x = (input && typeof input === "object" ? input : {}) as Partial<Shot> & Record<string, unknown>;
  const b = (x.backdrop ?? {}) as Partial<ShotBackdrop>;
  const f = (x.framing ?? {}) as Partial<ShotFraming>;
  const c = (x.crop ?? {}) as Partial<ShotCrop>;
  const m = (x.motion ?? {}) as Partial<ShotMotion>;
  const colors = Array.isArray(b.colors) ? b.colors.filter(isColor).slice(0, 5) : [];
  return {
    id: typeof x.id === "string" && /^[a-z0-9-]{1,40}$/i.test(x.id) ? x.id : newShotId(),
    kind: oneOf(x.kind, ["image", "video"] as const, "image"),
    frame: typeof x.frame === "string" ? x.frame.slice(0, 120) : "",
    format: oneOf(x.format, Object.keys(SHOT_FORMATS) as ShotFormat[], "4:5"),
    crop: { mode: oneOf(c.mode, ["top", "full"] as const, "top"), height: Math.round(clamp(c.height, 200, 8000, 1100)) },
    backdrop: {
      type: oneOf(b.type, ["shader", "gradient", "solid"] as const, "shader"),
      shader: oneOf(b.shader, SHOT_SHADERS, "MeshGradient"),
      colors: colors.length ? colors : SHOT_DEFAULT_COLORS,
      angle: Math.round(clamp(b.angle, 0, 360, 135)),
      seed: Math.round(clamp(b.seed, 0, 100_000, 0)),
      grain: clamp(b.grain, 0, 1, 0.25),
    },
    framing: {
      padding: clamp(f.padding, 0, 0.3, 0.09),
      radius: Math.round(clamp(f.radius, 0, 48, 14)),
      shadow: oneOf(f.shadow, ["none", "soft", "strong"] as const, "soft"),
      tilt: clamp(f.tilt, -20, 20, 0),
      chrome: oneOf(f.chrome, ["none", "browser", "phone"] as const, "none"),
      position: oneOf(f.position, ["center", "bleed"] as const, "center"),
    },
    scale: x.scale === 1 ? 1 : 2,
    motion: {
      template: oneOf(m.template, ["reveal", "scroll", "drift"] as const, "reveal"),
      duration: Math.round(clamp(m.duration, 3, 20, 7) * 10) / 10,
      backdropMotion: typeof m.backdropMotion === "boolean" ? m.backdropMotion : true,
      scrollDistance: Math.round(clamp(m.scrollDistance, 200, 12_000, 2400)),
    },
    updatedAt: typeof x.updatedAt === "number" ? x.updatedAt : Date.now(),
  };
}

/**
 * How many px of the frame to capture. Off the edge, the frame must run past
 * the bottom of the format: enough of a tall page is captured for that.
 */
export function captureHeight(shot: Shot, frameWidth: number): number {
  if (shot.crop.mode === "full") return 7000;
  if (shot.framing.position !== "bleed") return shot.crop.height;
  const { width: W, height: H } = SHOT_FORMATS[shot.format];
  return Math.max(shot.crop.height, Math.ceil(((frameWidth * H) / W) * 1.08));
}

/** Where the frame sits in the format (CSS px), for a frame image of `img` CSS px. */
export function shotLayout(shot: Shot, img: { width: number; height: number }) {
  const { width: W, height: H } = SHOT_FORMATS[shot.format];
  const pad = Math.round(Math.min(W, H) * shot.framing.padding);
  const chromeTop = shot.framing.chrome === "browser" ? 36 : 0;
  const bezel = shot.framing.chrome === "phone" ? 14 : 0;
  // the visible part of the frame, in its own px
  const bleed = shot.framing.position === "bleed";
  // off the edge, all of the capture shows (it was taken tall enough to run past the bottom)
  const visibleH = shot.crop.mode === "top" && !bleed ? Math.min(img.height, shot.crop.height) : img.height;
  const availW = W - pad * 2 - bezel * 2;
  const availH = (bleed ? H - pad : H - pad * 2) - chromeTop - bezel * 2;
  // bleed: the frame fills the width and runs off the bottom edge
  const k = bleed ? availW / img.width : Math.min(availW / img.width, availH / visibleH);
  const w = Math.round(img.width * k);
  // bleed: whatever passes the bottom edge is cut off by the format
  const h = Math.round(visibleH * k);
  const boxW = w + bezel * 2;
  const boxH = h + chromeTop + bezel * 2;
  const left = Math.round((W - boxW) / 2);
  // bleed: the frame always runs past the bottom edge (a short one sits lower)
  const top = bleed ? Math.max(pad, Math.round(H - boxH * 0.86)) : Math.round((H - boxH) / 2);
  return { W, H, left, top, boxW, boxH, imgW: w, imgH: h, k, chromeTop, bezel };
}

/** Frames per second of exported videos. */
export const SHOT_FPS = 30;

/** Where everything is at time `t` (seconds) of a video shot: the compositor and the recorder both read this. */
export interface ShotPose {
  /** the frame box */
  opacity: number;
  /** px, in the format's space */
  y: number;
  scale: number;
  /** extra rotateX in degrees, on top of the shot's tilt */
  lift: number;
  /** px scrolled inside the frame, in the frame's own px */
  scroll: number;
  /** the shader's time, for a moving backdrop */
  shaderTime: number;
}

const easeOut = (p: number) => 1 - (1 - p) ** 3;
const easeOutExpo = (p: number) => (p >= 1 ? 1 : 1 - 2 ** (-10 * p));
const easeInOut = (p: number) => (p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2);
const part = (t: number, from: number, to: number) => Math.min(1, Math.max(0, (t - from) / (to - from)));

export function shotPoseAt(shot: Shot, t: number): ShotPose {
  const m = shot.motion;
  const d = m.duration;
  const shaderTime = m.backdropMotion ? t * 0.35 : 0;
  if (shot.kind !== "video") return { opacity: 1, y: 0, scale: 1, lift: 0, scroll: 0, shaderTime: 0 };
  if (m.template === "reveal") {
    // rises in over 1.4 s, then settles with a slow push in
    const p = easeOutExpo(part(t, 0.15, 1.55));
    return { opacity: Math.min(1, part(t, 0.15, 0.9) * 1.2), y: (1 - p) * 140, scale: 0.94 + 0.06 * p + 0.02 * easeInOut(part(t, 1.55, d)), lift: (1 - p) * 9, scroll: 0, shaderTime };
  }
  if (m.template === "scroll") {
    // a beat on the top of the page, the scroll, a beat at the end
    const fade = easeOut(part(t, 0, 0.5));
    const s = easeInOut(part(t, 0.9, Math.max(1.4, d - 0.9)));
    return { opacity: fade, y: (1 - fade) * 24, scale: 1, lift: 0, scroll: s * m.scrollDistance, shaderTime };
  }
  // drift: a slow push in
  const fade = easeOut(part(t, 0, 0.5));
  return { opacity: fade, y: (1 - fade) * 24 - easeInOut(part(t, 0, d)) * 30, scale: 1 + 0.1 * easeInOut(part(t, 0, d)), lift: 0, scroll: 0, shaderTime };
}
