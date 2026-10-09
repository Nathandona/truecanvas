import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, Dices, Download, ImagePlus, LoaderCircle, Plus, RefreshCcw, Trash2 } from "lucide-react";
import { newShot, normalizeShot, SHOT_FORMATS, SHOT_SHADERS, type Shot, type ShotFormat, type ShotShader } from "../../../src/core/shot-model";
import { api } from "../lib/api";
import { useStore } from "../lib/store";
import { Backdrop, ShotStage, type ShotImage } from "../shot/ShotStage";
import { ColorList, Segmented } from "./controls";
import { Dialog } from "./Dialog";

/*
 * Shot: a frame staged for social posts. The preview is the compositor the
 * export uses, so it's exact; the frame image comes from the app (cached on
 * the server), everything else is drawn here, live. Settings are saved to
 * `<page>.shots.json` as you go, so "Export" later gives the same image with
 * the design as it is then.
 */

export function openShot(frame: string) {
  useStore.setState({ shotDialog: { frame } });
}

export function ShotDialog() {
  const open = useStore((s) => s.shotDialog);
  const canvas = useStore((s) => s.canvas);
  if (!open || !canvas) return null;
  return <ShotEditor key={`${canvas}/${open.frame}`} canvas={canvas} frame={open.frame} />;
}

const SHADER_LABEL: Record<ShotShader, string> = {
  MeshGradient: "Mesh",
  GrainGradient: "Grain",
  StaticMeshGradient: "Silk",
  StaticRadialGradient: "Glow",
  Warp: "Warp",
};

/** Hand-picked palettes, next to the project's own. */
const PALETTES: { name: string; colors: string[] }[] = [
  { name: "Dusk", colors: ["#1e1b4b", "#6d5dfc", "#f0abfc", "#fde68a"] },
  { name: "Ocean", colors: ["#03111f", "#0e4f73", "#2bb3c0", "#d8f3ee"] },
  { name: "Ember", colors: ["#1a0b06", "#9a2b12", "#f2763a", "#ffd9a8"] },
  { name: "Paper", colors: ["#efe9df", "#d8cdbd", "#b9a891", "#fbf8f3"] },
  { name: "Ink", colors: ["#0a0a0b", "#26272b", "#53555c", "#9a9ba1"] },
];

function ShotEditor({ canvas, frame }: { canvas: string; frame: string }) {
  const close = () => useStore.setState({ shotDialog: null });
  const [shots, setShots] = useState<Shot[] | null>(null);
  const [shot, setShot] = useState<Shot | null>(null);
  const [image, setImage] = useState<ShotImage | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [exporting, setExporting] = useState<"" | "copy" | "download">("");
  const [copied, setCopied] = useState(false);
  const [brand, setBrand] = useState<string[]>([]);
  const toast = useStore((s) => s.toast);

  // the frame's shots, or a new one in the project's colors
  useEffect(() => {
    let live = true;
    Promise.all([api.shots(canvas), api.tokens().catch(() => null)]).then(([{ shots: all }, tokens]) => {
      if (!live) return;
      const palette = brandPalette((tokens?.colors ?? []).map((c) => c.light));
      setBrand(palette);
      const mine = all.filter((s) => s.frame === frame);
      setShots(mine);
      // a first shot in the brand's colors when it has some, else a palette that flatters any design
      setShot(mine[0] ?? newShot(frame, palette));
    });
    return () => {
      live = false;
    };
  }, [canvas, frame]);

  // the frame as the app renders it: again when the crop changes
  const cropKey = shot ? `${shot.crop.mode}:${shot.crop.height}:${shot.framing.position}:${shot.format}` : "";
  const capture = useCallback(
    async (fresh = false) => {
      if (!shot) return;
      setCapturing(true);
      try {
        setImage((await api.captureShot(canvas, shot, fresh)).image);
      } catch (e) {
        toast((e as Error).message);
      } finally {
        setCapturing(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canvas, cropKey],
  );
  useEffect(() => {
    const t = setTimeout(() => void capture(), 350);
    return () => clearTimeout(t);
  }, [capture]);

  // saved as you go
  const saveTimer = useRef<number>(0);
  const update = (change: (s: Shot) => Shot) => {
    setShot((s) => {
      if (!s) return s;
      const next = normalizeShot(change(s));
      clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        void api.saveShot(canvas, next).then(({ shot: saved }) => setShots((list) => [saved, ...(list ?? []).filter((x) => x.id !== saved.id)]));
      }, 500);
      return next;
    });
  };

  // colors sampled from the design itself
  const fromDesign = useDesignColors(image?.src);

  const exportPng = async (mode: "copy" | "download") => {
    if (!shot) return;
    setExporting(mode);
    try {
      const blob = await api.exportShot(canvas, shot);
      if (mode === "copy") {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      } else {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `${canvas}-${frame}-${shot.format.replace(":", "x")}.png`.toLowerCase().replace(/[^a-z0-9.-]+/g, "-");
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      }
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setExporting("");
    }
  };

  if (!shot || !shots) {
    return (
      <Dialog title={`Shot of ${frame}`} width={420} onClose={close}>
        <div className="share-busy">
          <LoaderCircle size={16} className="spin-working" />
        </div>
      </Dialog>
    );
  }

  const b = shot.backdrop;
  const f = shot.framing;
  return (
    <Dialog title={<ShotTitle frame={frame} shots={shots} shot={shot} onPick={(s) => setShot(s)} onNew={() => setShot(newShot(frame, b.colors))} onDelete={(id) => void api.deleteShot(canvas, id).then(() => {
      const left = shots.filter((s) => s.id !== id);
      setShots(left);
      setShot(left[0] ?? newShot(frame, b.colors));
    })} />} width={1180} onClose={close}>
      <div className="shot">
        <Preview shot={shot} image={image} busy={capturing} />
        <div className="shot-side">
          <Group title="Format">
            <div className="shot-formats">
              {(Object.keys(SHOT_FORMATS) as ShotFormat[]).map((k) => (
                <button key={k} className={`shot-format${shot.format === k ? " on" : ""}`} onClick={() => update((s) => ({ ...s, format: k }))} title={SHOT_FORMATS[k].label}>
                  <span className="shot-format-box" style={{ aspectRatio: `${SHOT_FORMATS[k].width} / ${SHOT_FORMATS[k].height}` }} />
                  {k}
                </button>
              ))}
            </div>
            <p className="faint shot-hint">{SHOT_FORMATS[shot.format].label}</p>
          </Group>

          <Group
            title="Backdrop"
            action={
              <button className="icon-btn sm" title="Shuffle: another variation" aria-label="Shuffle" onClick={() => update((s) => ({ ...s, backdrop: { ...s.backdrop, seed: Math.floor(Math.random() * 100_000), angle: Math.floor(Math.random() * 360) } }))}>
                <Dices size={14} />
              </button>
            }
          >
            <Segmented
              value={b.type}
              options={[
                { value: "shader", label: "Shader" },
                { value: "gradient", label: "Gradient" },
                { value: "solid", label: "Color" },
              ]}
              onChange={(v) => update((s) => ({ ...s, backdrop: { ...s.backdrop, type: v } }))}
            />
            {b.type === "shader" && (
              <div className="shot-shaders">
                {SHOT_SHADERS.map((name) => (
                  <button key={name} className={`shot-shader${b.shader === name ? " on" : ""}`} onClick={() => update((s) => ({ ...s, backdrop: { ...s.backdrop, shader: name } }))} title={SHADER_LABEL[name]}>
                    <span className="shot-shader-swatch">
                      <Backdrop shot={{ ...shot, backdrop: { ...b, type: "shader", shader: name, grain: 0 } }} />
                    </span>
                    {SHADER_LABEL[name]}
                  </button>
                ))}
              </div>
            )}
            <div className="shot-row">
              <span className="shot-label">Colors</span>
              <ColorList value={b.colors} onCommit={(colors) => update((s) => ({ ...s, backdrop: { ...s.backdrop, colors } }))} />
            </div>
            <div className="shot-palettes">
              {fromDesign.length >= 2 && <Palette name="From the design" colors={fromDesign} onPick={(colors) => update((s) => ({ ...s, backdrop: { ...s.backdrop, colors } }))} />}
              {brand.length >= 2 && <Palette name="Brand" colors={brand.slice(0, 5)} onPick={(colors) => update((s) => ({ ...s, backdrop: { ...s.backdrop, colors } }))} />}
              {PALETTES.map((p) => (
                <Palette key={p.name} name={p.name} colors={p.colors} onPick={(colors) => update((s) => ({ ...s, backdrop: { ...s.backdrop, colors } }))} />
              ))}
            </div>
            {b.type === "gradient" && <Range label="Angle" value={b.angle} min={0} max={360} unit="°" onChange={(angle) => update((s) => ({ ...s, backdrop: { ...s.backdrop, angle } }))} />}
            <Range label="Grain" value={Math.round(b.grain * 100)} min={0} max={100} unit="%" onChange={(g) => update((s) => ({ ...s, backdrop: { ...s.backdrop, grain: g / 100 } }))} />
          </Group>

          <Group title="Framing">
            <Segmented
              value={f.chrome}
              options={[
                { value: "none", label: "None" },
                { value: "browser", label: "Browser" },
                { value: "phone", label: "Phone" },
              ]}
              onChange={(v) => update((s) => ({ ...s, framing: { ...s.framing, chrome: v } }))}
            />
            <Segmented
              value={f.position}
              options={[
                { value: "center", label: "Centered" },
                { value: "bleed", label: "Off the edge" },
              ]}
              onChange={(v) => update((s) => ({ ...s, framing: { ...s.framing, position: v } }))}
            />
            <Range label="Margin" value={Math.round(f.padding * 100)} min={0} max={30} unit="%" onChange={(p) => update((s) => ({ ...s, framing: { ...s.framing, padding: p / 100 } }))} />
            <Range label="Corners" value={f.radius} min={0} max={48} unit="px" onChange={(radius) => update((s) => ({ ...s, framing: { ...s.framing, radius } }))} />
            <Range label="Tilt" value={f.tilt} min={-20} max={20} unit="°" onChange={(tilt) => update((s) => ({ ...s, framing: { ...s.framing, tilt } }))} />
            <div className="shot-row">
              <span className="shot-label">Shadow</span>
              <Segmented
                value={f.shadow}
                options={[
                  { value: "none", label: "None" },
                  { value: "soft", label: "Soft" },
                  { value: "strong", label: "Strong" },
                ]}
                onChange={(v) => update((s) => ({ ...s, framing: { ...s.framing, shadow: v } }))}
              />
            </div>
          </Group>

          <Group title="Crop">
            <Segmented
              value={shot.crop.mode}
              options={[
                { value: "top", label: "Top of the frame" },
                { value: "full", label: "Whole frame" },
              ]}
              onChange={(v) => update((s) => ({ ...s, crop: { ...s.crop, mode: v } }))}
            />
            {shot.crop.mode === "top" && (
              <Range label="Height" value={shot.crop.height} min={300} max={4000} step={20} unit="px" lazy onChange={(height) => update((s) => ({ ...s, crop: { ...s.crop, height } }))} />
            )}
          </Group>

          <Group title="Export">
            <Segmented
              value={String(shot.scale) as "1" | "2"}
              options={[
                { value: "2", label: `2x · ${SHOT_FORMATS[shot.format].width * 2}×${SHOT_FORMATS[shot.format].height * 2}` },
                { value: "1", label: "1x" },
              ]}
              onChange={(v) => update((s) => ({ ...s, scale: v === "1" ? 1 : 2 }))}
            />
          </Group>
        </div>
      </div>
      <div className="modal-actions shot-actions">
        <button className="btn" onClick={() => void capture(true)} disabled={capturing} title="Render the frame again from your app">
          <RefreshCcw size={13} /> Refresh frame
        </button>
        <span className="shot-saved faint">Saved to {canvas}.shots.json</span>
        <button className="btn outline" onClick={() => void exportPng("copy")} disabled={!!exporting}>
          {exporting === "copy" ? <LoaderCircle size={13} className="spin-working" /> : copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copied" : "Copy image"}
        </button>
        <button className="btn primary" onClick={() => void exportPng("download")} disabled={!!exporting}>
          {exporting === "download" ? <LoaderCircle size={13} className="spin-working" /> : <Download size={13} />} Export PNG
        </button>
      </div>
    </Dialog>
  );
}

function ShotTitle({ frame, shots, shot, onPick, onNew, onDelete }: { frame: string; shots: Shot[]; shot: Shot; onPick: (s: Shot) => void; onNew: () => void; onDelete: (id: string) => void }) {
  const saved = shots.some((s) => s.id === shot.id);
  return (
    <div className="shot-title">
      <ImagePlus size={15} />
      <span>Shot of {frame}</span>
      <div className="shot-tabs">
        {shots.map((s, i) => (
          <button key={s.id} className={`shot-tab${s.id === shot.id ? " on" : ""}`} onClick={() => onPick(s)} title={`${s.format}, ${s.backdrop.type}`}>
            {i + 1}
          </button>
        ))}
        {!saved && <span className="shot-tab on">{shots.length + 1}</span>}
        <button className="icon-btn sm" onClick={onNew} title="New shot of this frame" aria-label="New shot">
          <Plus size={13} />
        </button>
        {saved && (
          <button className="icon-btn sm" onClick={() => onDelete(shot.id)} title="Delete this shot" aria-label="Delete shot">
            <Trash2 size={13} />
          </button>
        )}
      </div>
    </div>
  );
}

/** The compositor scaled to fit, exactly as it exports. */
function Preview({ shot, image, busy }: { shot: Shot; image: ShotImage | null; busy: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 600, h: 600 });
  useEffect(() => {
    const el = ref.current!;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const { width, height } = SHOT_FORMATS[shot.format];
  const k = Math.min((box.w - 48) / width, (box.h - 48) / height);
  return (
    <div className="shot-preview" ref={ref}>
      <div className="shot-canvas" style={{ width: width * k, height: height * k }}>
        <div style={{ width, height, transform: `scale(${k})`, transformOrigin: "0 0" }}>
          <ShotStage shot={shot} image={image} />
        </div>
      </div>
      {busy && (
        <div className="shot-busy" role="status">
          <LoaderCircle size={14} className="spin-working" /> {image ? "Updating the frame…" : "Rendering the frame from your app…"}
        </div>
      )}
    </div>
  );
}

function Group({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="shot-group">
      <div className="shot-group-head">
        <span>{title}</span>
        {action}
      </div>
      {children}
    </section>
  );
}

/** A live slider: the preview follows the drag (`lazy`: only on release, for changes that re-render the frame). */
function Range({ label, value, min, max, step = 1, unit, lazy, onChange }: { label: string; value: number; min: number; max: number; step?: number; unit: string; lazy?: boolean; onChange: (v: number) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <label className="shot-row">
      <span className="shot-label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={draft}
        style={{ ["--p" as string]: `${((draft - min) / (max - min)) * 100}%` }}
        onChange={(e) => {
          const v = Number(e.target.value);
          setDraft(v);
          if (!lazy) onChange(v);
        }}
        onPointerUp={() => lazy && draft !== value && onChange(draft)}
        onKeyUp={() => lazy && draft !== value && onChange(draft)}
        onKeyDown={(e) => e.stopPropagation()}
      />
      <span className="shot-value">
        {Math.round(draft)}
        {unit}
      </span>
    </label>
  );
}

function Palette({ name, colors, onPick }: { name: string; colors: string[]; onPick: (c: string[]) => void }) {
  return (
    <button className="shot-palette" onClick={() => onPick(colors)} title={name}>
      <span className="shot-palette-swatches">
        {colors.slice(0, 5).map((c, i) => (
          <span key={i} style={{ background: c }} />
        ))}
      </span>
      <span className="shot-palette-name">{name}</span>
    </button>
  );
}

/** A few distinct colors of the captured frame, darkest first: palettes that match the design. */
function useDesignColors(src: string | undefined) {
  const [colors, setColors] = useState<string[]>([]);
  useEffect(() => {
    if (!src) return;
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      const w = (c.width = 64);
      const h = (c.height = Math.max(8, Math.round((64 * img.naturalHeight) / img.naturalWidth)));
      const ctx = c.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, w, h);
      setColors(dominant(ctx.getImageData(0, 0, w, h).data));
    };
    img.src = src;
  }, [src]);
  return useMemo(() => colors, [colors]);
}

function dominant(data: Uint8ClampedArray): string[] {
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 200) continue;
    const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
    const b = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    b.n++;
    b.r += data[i];
    b.g += data[i + 1];
    b.b += data[i + 2];
    buckets.set(key, b);
  }
  const sat = (c: number[]) => {
    const max = Math.max(...c);
    return max === 0 ? 0 : (max - Math.min(...c)) / max;
  };
  const lum = (c: number[]) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
  // a brand color covers little of a page next to its white and grey surfaces: saturation counts more than area
  const ranked = [...buckets.values()]
    .map((b) => ({ c: [b.r / b.n, b.g / b.n, b.b / b.n], n: b.n }))
    .map((x) => ({ ...x, score: Math.sqrt(x.n) * (0.15 + 2.5 * sat(x.c) ** 0.8) * (lum(x.c) > 0.93 ? 0.3 : 1) }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.c);
  const picked: number[][] = [];
  for (const c of ranked) {
    if (picked.every((p) => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]) > 70)) picked.push(c);
    if (picked.length === 4) break;
  }
  return picked.sort((a, b) => lum(a) - lum(b)).map((c) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`);
}

/** Any CSS color as rgb, through the browser (hex, rgb, hsl, oklch…). */
function toRgb(color: string): number[] | null {
  const c = document.createElement("canvas");
  c.width = c.height = 1;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.fillStyle = "#010203";
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
  return a < 200 ? null : [r, g, b];
}

/**
 * The project's colors worth a backdrop: saturated and distinct ones first
 * (whites and greys are surfaces, not a brand), darkest first.
 */
function brandPalette(colors: string[]): string[] {
  const seen: { hex: string; rgb: number[]; sat: number; lum: number }[] = [];
  for (const color of colors) {
    const rgb = toRgb(color);
    if (!rgb) continue;
    const max = Math.max(...rgb) / 255;
    const min = Math.min(...rgb) / 255;
    const sat = max === 0 ? 0 : (max - min) / max;
    const lum = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
    if (seen.some((x) => Math.hypot(x.rgb[0] - rgb[0], x.rgb[1] - rgb[1], x.rgb[2] - rgb[2]) < 48)) continue;
    seen.push({ hex: `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`, rgb, sat, lum });
  }
  const vivid = seen.filter((x) => x.sat > 0.25 && x.lum > 0.04 && x.lum < 0.92);
  const dark = seen.filter((x) => x.lum < 0.18).sort((a, b) => a.lum - b.lum)[0];
  const picked = [...(dark ? [dark] : []), ...vivid.sort((a, b) => b.sat - a.sat)].filter((x, i, all) => all.indexOf(x) === i).slice(0, 4);
  return picked.length >= 2 ? picked.sort((a, b) => a.lum - b.lum).map((x) => x.hex) : [];
}
