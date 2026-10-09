import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  GrainGradient,
  grainGradientPresets,
  MeshGradient,
  meshGradientPresets,
  StaticMeshGradient,
  staticMeshGradientPresets,
  StaticRadialGradient,
  staticRadialGradientPresets,
  Warp,
  warpPresets,
} from "@paper-design/shaders-react";
import { shotLayout, shotPoseAt, type Shot } from "../../../src/core/shot-model";

/*
 * The compositor: a frame image staged on its backdrop at the shot's format.
 * The editor's preview and the export render this same component (the
 * export at the format's real size, in the screenshot browser), so what you
 * see is what you post.
 */

export interface ShotImage {
  src: string;
  /** CSS px of the captured frame */
  width: number;
  height: number;
}

const SHADERS = {
  MeshGradient: { C: MeshGradient, presets: meshGradientPresets, animated: true },
  GrainGradient: { C: GrainGradient, presets: grainGradientPresets, animated: true },
  StaticMeshGradient: { C: StaticMeshGradient, presets: staticMeshGradientPresets, animated: false },
  StaticRadialGradient: { C: StaticRadialGradient, presets: staticRadialGradientPresets, animated: false },
  Warp: { C: Warp, presets: warpPresets, animated: true },
} as const;

const SHADOWS = {
  none: "none",
  soft: "0 40px 90px -30px rgba(0,0,0,.45), 0 12px 30px -12px rgba(0,0,0,.25)",
  strong: "0 60px 140px -30px rgba(0,0,0,.65), 0 20px 40px -16px rgba(0,0,0,.4)",
};

/** Film grain: SVG noise, overlaid on the backdrop. */
const GRAIN = `url("data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="220" height="220"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 1.4 -0.2"/></filter><rect width="100%" height="100%" filter="url(#n)"/></svg>',
)}")`;

/** The live frame: the app's page in an iframe (videos), instead of a captured image. */
export interface ShotLive {
  src: string;
  /** CSS px of the frame's viewport */
  width: number;
  height: number;
}

/**
 * `fast`: the shader at a fraction of the pixels (videos, where it's redrawn
 * every frame: it's a soft blur under grain, upscaling doesn't show).
 */
export function Backdrop({ shot, style, time = 0, fast = false }: { shot: Shot; style?: CSSProperties; time?: number; fast?: boolean }) {
  const b = shot.backdrop;
  const fill: CSSProperties = { position: "absolute", inset: 0, ...style };
  let layer: React.ReactNode;
  if (b.type === "solid") layer = <div style={{ ...fill, background: b.colors[0] }} />;
  else if (b.type === "gradient") {
    const stops = b.colors.map((c, i) => `${c} ${Math.round((i / Math.max(1, b.colors.length - 1)) * 100)}%`).join(", ");
    layer = <div style={{ ...fill, background: `linear-gradient(${b.angle}deg, ${stops})` }} />;
  } else {
    const def = SHADERS[b.shader];
    const Shader = def.C as unknown as React.ComponentType<Record<string, unknown>>;
    const params = { ...(def.presets[0]?.params as Record<string, unknown>) };
    // a still image: no motion; the seed picks the moment (animated shaders) or the angle (static ones)
    const variation = def.animated ? { frame: 1500 + b.seed * 997 + time * 1000 } : { rotation: ((b.seed * 47) % 360) + time * 6 };
    layer = (
      <Shader
        {...params}
        {...variation}
        colors={b.colors}
        {...("colorBack" in params ? { colorBack: b.colors[0] } : {})}
        speed={0}
        minPixelRatio={fast ? 0.5 : 2}
        maxPixelCount={fast ? 160_000 : 16_000_000}
        webGlContextAttributes={{ preserveDrawingBuffer: true }}
        style={fill}
      />
    );
  }
  return (
    <>
      {layer}
      {b.grain > 0 && <div style={{ ...fill, backgroundImage: GRAIN, backgroundSize: "220px", opacity: b.grain * 0.55, mixBlendMode: "overlay", pointerEvents: "none" }} />}
    </>
  );
}

export function ShotStage({
  shot,
  image,
  live,
  time = 0,
  scrollByMessage,
  onReady,
}: {
  shot: Shot;
  image: ShotImage | null;
  /** videos: the page itself, live */
  live?: ShotLive | null;
  /** seconds into the video */
  time?: number;
  /** preview: scroll the live page by message (the recorder scrolls it directly) */
  scrollByMessage?: boolean;
  onReady?: () => void;
}) {
  const media = live ?? image;
  const L = shotLayout(shot, media ?? { width: 1440, height: 900 });
  const pose = shotPoseAt(shot, time);
  const iframe = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    if (!scrollByMessage || !live) return;
    iframe.current?.contentWindow?.postMessage({ type: "tc:scroll", y: Math.round(pose.scroll) }, "*");
  }, [scrollByMessage, live, pose.scroll]);
  const f = shot.framing;
  const [loaded, setLoaded] = useState(false);
  const reported = useRef(false);
  useEffect(() => setLoaded(false), [image?.src, live?.src]);
  useEffect(() => {
    if (!loaded || reported.current || !onReady) return;
    reported.current = true;
    // two frames: the shader has drawn, the image is painted
    requestAnimationFrame(() => requestAnimationFrame(() => onReady()));
  }, [loaded, onReady]);

  const rotX = Math.abs(f.tilt) * 0.45 + pose.lift;
  const moved = pose.y || pose.scale !== 1 ? `translateY(${pose.y.toFixed(2)}px) scale(${pose.scale.toFixed(4)})` : "";
  const tilted = f.tilt || pose.lift ? `perspective(2600px) rotateX(${rotX.toFixed(2)}deg) rotateY(${(-f.tilt).toFixed(2)}deg)` : "";
  const tilt = `${moved} ${tilted}`.trim() || undefined;
  const outer = f.chrome === "phone" ? Math.max(f.radius, 40) : f.radius;
  return (
    <div style={{ position: "relative", width: L.W, height: L.H, overflow: "hidden", background: shot.backdrop.colors[0] }}>
      <Backdrop shot={shot} time={pose.shaderTime} fast={!!live} />
      <div
        style={{
          position: "absolute",
          left: L.left,
          top: L.top,
          width: L.boxW,
          height: L.boxH,
          borderRadius: outer,
          boxShadow: SHADOWS[f.shadow],
          transform: tilt,
          transformOrigin: "50% 50%",
          opacity: pose.opacity,
          background: f.chrome === "phone" ? "#0b0b0c" : "#fff",
          padding: L.bezel,
          overflow: "hidden",
        }}
      >
        {f.chrome === "browser" && <BrowserBar height={L.chromeTop} />}
        <div style={{ position: "relative", width: L.imgW, height: L.imgH, overflow: "hidden", borderRadius: f.chrome === "phone" ? outer - L.bezel : f.chrome === "browser" ? `0 0 ${f.radius}px ${f.radius}px` : f.radius }}>
          {live ? (
            <iframe
              ref={iframe}
              src={live.src}
              title="Frame"
              scrolling="no"
              onLoad={() => setLoaded(true)}
              style={{ position: "absolute", left: 0, top: 0, width: live.width, height: live.height, border: 0, transform: `scale(${L.k})`, transformOrigin: "0 0", background: "#fff" }}
            />
          ) : image && (
            <img
              src={image.src}
              alt=""
              onLoad={() => setLoaded(true)}
              style={{ position: "absolute", left: 0, top: 0, width: L.imgW, height: Math.round(image.height * L.k), maxWidth: "none", display: "block" }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function BrowserBar({ height }: { height: number }) {
  return (
    <div style={{ height, display: "flex", alignItems: "center", gap: 7, padding: "0 14px", background: "#f4f3f1", borderBottom: "1px solid rgba(0,0,0,.07)" }}>
      {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
        <span key={c} style={{ width: 11, height: 11, borderRadius: "50%", background: c }} />
      ))}
      <span style={{ marginLeft: 18, height: 20, flex: "0 1 46%", borderRadius: 6, background: "rgba(0,0,0,.06)" }} />
    </div>
  );
}
