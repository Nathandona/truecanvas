import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, Dices, Download, ImagePlus, LoaderCircle, Pause, Play, Plus, RefreshCcw, Trash2 } from "lucide-react";
import { linkScroll, newShot, normalizeShot, SHOT_FORMATS, SHOT_MOTIONS, SHOT_SCROLL_SPEEDS, SHOT_SHADERS, type Shot, type ShotFormat, type ShotShader } from "../../../src/core/shot-model";
import { api } from "../lib/api";
import { useStore } from "../lib/store";
import { Backdrop, ShotStage, type ShotImage, type ShotLive } from "../shot/ShotStage";
import { ColorList, Segmented, Switch } from "./controls";
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
  // videos: the page live in the preview, and where the preview is in time
  const [liveSrc, setLiveSrc] = useState<string | null>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  // Date.now() at the preview's time 0 while playing: the page scrolls itself along the same clock
  const [playingSince, setPlayingSince] = useState<number | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
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

  const video = shot?.kind === "video";
  const duration = shot?.motion.duration ?? 7;
  useEffect(() => {
    if (!video || liveSrc) return;
    void fetch(`/api/shot/live?canvas=${encodeURIComponent(canvas)}&frame=${encodeURIComponent(frame)}`)
      .then((r) => r.json())
      .then((r: { src?: string }) => r.src && setLiveSrc(r.src));
  }, [video, liveSrc, canvas, frame]);
  // the preview plays in real time, looping (the export is frame-exact)
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const start = performance.now() - time * 1000;
    setPlayingSince(Date.now() - time * 1000);
    const tick = (now: number) => {
      const t = (now - start) / 1000;
      if (t >= duration + 0.8) {
        setTime(0);
        setPlaying(false);
        // loop: the page's own animations start again with it
        setTimeout(() => replayAndPlay(), 300);
        return;
      }
      setTime(Math.min(t, duration));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      setPlayingSince(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, duration]);
  const previewRef = useRef<HTMLDivElement>(null);
  const replayAndPlay = () => {
    previewRef.current?.querySelector("iframe")?.contentWindow?.postMessage({ type: "tc:replay" }, "*");
    setTime(0);
    setPlaying(true);
  };

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

  const exportVideo = async () => {
    if (!shot) return;
    setPlaying(false);
    setProgress(0);
    const poll = window.setInterval(() => {
      void fetch(`/api/shot/progress?canvas=${encodeURIComponent(canvas)}`)
        .then((r) => r.json())
        .then((r: { progress: { done: number; total: number } | null }) => r.progress && setProgress(r.progress.done / r.progress.total));
    }, 600);
    try {
      const res = await fetch("/api/shot/video", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ canvas, shot }) });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `Export failed (${res.status})`);
      const ext = res.headers.get("x-shot-ext") ?? "mp4";
      const a = document.createElement("a");
      a.href = URL.createObjectURL(await res.blob());
      a.download = `${canvas}-${frame}-${shot.format.replace(":", "x")}.${ext}`.toLowerCase().replace(/[^a-z0-9.-]+/g, "-");
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      clearInterval(poll);
      setProgress(null);
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
        <div className="shot-left" ref={previewRef}>
          <Preview shot={shot} image={image} busy={capturing && !video} playingSince={playingSince} live={video && liveSrc && image ? { src: liveSrc, width: image.width, height: liveHeight(shot, image) } : null} time={video ? time : 0} />
          {video && (
            <div className="shot-play">
              <button className="icon-btn" onClick={() => (playing ? setPlaying(false) : time >= duration ? replayAndPlay() : time === 0 ? replayAndPlay() : setPlaying(true))} aria-label={playing ? "Pause" : "Play"} title={playing ? "Pause" : "Play"}>
                {playing ? <Pause size={15} /> : <Play size={15} />}
              </button>
              <input
                type="range"
                min={0}
                max={duration}
                step={0.01}
                value={time}
                aria-label="Time"
                style={{ ["--p" as string]: `${(time / duration) * 100}%` }}
                onChange={(e) => {
                  setPlaying(false);
                  setTime(Number(e.target.value));
                }}
                onKeyDown={(e) => e.stopPropagation()}
              />
              <span className="shot-time">
                {time.toFixed(1)}s / {duration}s
              </span>
            </div>
          )}
        </div>
        <div className="shot-side">
          <Segmented
            value={shot.kind}
            options={[
              { value: "image", label: "Image" },
              { value: "video", label: "Video" },
            ]}
            onChange={(v) => {
              update((s) => ({ ...s, kind: v }));
              if (v === "video") setTimeout(replayAndPlay, 600);
              else setPlaying(false);
            }}
          />
          {video && (
            <Group title="Motion">
              <div className="shot-motions">
                {SHOT_MOTIONS.map((m) => (
                  <button
                    key={m.value}
                    className={`shot-motion${shot.motion.template === m.value ? " on" : ""}`}
                    onClick={() => {
                      // a scroll's length follows its distance and speed
                      update((s) => ({ ...s, motion: m.value === "scroll" ? linkScroll({ ...s.motion, template: m.value }, "distance") : { ...s.motion, template: m.value } }));
                      setTimeout(replayAndPlay, 50);
                    }}
                  >
                    <b>{m.label}</b>
                    <span>{m.hint}</span>
                  </button>
                ))}
              </div>
              {shot.motion.template === "scroll" && (
                <>
                  <Range
                    label="Distance"
                    value={shot.motion.scrollDistance}
                    min={400}
                    max={8000}
                    step={100}
                    unit="px"
                    onChange={(scrollDistance) => update((s) => ({ ...s, motion: linkScroll({ ...s.motion, scrollDistance }, "distance") }))}
                  />
                  <div className="shot-row">
                    <span className="shot-label">Speed</span>
                    <Segmented
                      value={String(nearestSpeed(shot.motion.scrollSpeed))}
                      options={SHOT_SCROLL_SPEEDS.map((s) => ({ value: String(s.value), label: s.label }))}
                      onChange={(v) => update((s) => ({ ...s, motion: linkScroll({ ...s.motion, scrollSpeed: Number(v) }, "speed") }))}
                    />
                  </div>
                </>
              )}
              <div className="shot-row">
                <span className="shot-label">Smoothness</span>
                <Segmented
                  value={String(shot.motion.fps)}
                  options={[
                    { value: "60", label: "60 fps" },
                    { value: "30", label: "30 fps" },
                  ]}
                  onChange={(v) => update((s) => ({ ...s, motion: { ...s.motion, fps: v === "30" ? 30 : 60 } }))}
                />
              </div>
              <Range
                label="Length"
                value={shot.motion.duration}
                min={3}
                max={20}
                step={0.1}
                unit="s"
                onChange={(duration) => update((s) => ({ ...s, motion: s.motion.template === "scroll" ? linkScroll({ ...s.motion, duration }, "duration") : { ...s.motion, duration } }))}
              />
              {shot.motion.template === "scroll" && <p className="faint shot-hint">Distance, speed and length move together: the page cruises at one speed, easing in and out.</p>}
              {shot.backdrop.type === "shader" && (
                <div className="shot-row">
                  <span className="shot-label">Backdrop</span>
                  <span className="muted" style={{ fontSize: 12 }}>
                    Moves gently
                  </span>
                  <Switch on={shot.motion.backdropMotion} onChange={(backdropMotion) => update((s) => ({ ...s, motion: { ...s.motion, backdropMotion } }))} ariaLabel="Backdrop moves" />
                </div>
              )}
            </Group>
          )}
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

          {!video && (
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
          )}
        </div>
      </div>
      <div className="modal-actions shot-actions">
        <button className="btn" onClick={() => void capture(true)} disabled={capturing} title="Render the frame again from your app">
          <RefreshCcw size={13} /> Refresh frame
        </button>
        <span className="shot-saved faint">Saved to {canvas}.shots.json</span>
        {video ? (
          <button className="btn primary shot-export-video" onClick={() => void exportVideo()} disabled={progress !== null}>
            {progress !== null && <span className="shot-progress" style={{ width: `${Math.round(progress * 100)}%` }} />}
            <span className="shot-export-label">
              {progress !== null ? <LoaderCircle size={13} className="spin-working" /> : <Download size={13} />}
              {progress !== null ? `Rendering ${Math.round(progress * 100)}%` : "Export video"}
            </span>
          </button>
        ) : (
          <>
            <button className="btn outline" onClick={() => void exportPng("copy")} disabled={!!exporting}>
              {exporting === "copy" ? <LoaderCircle size={13} className="spin-working" /> : copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copied" : "Copy image"}
            </button>
            <button className="btn primary" onClick={() => void exportPng("download")} disabled={!!exporting}>
              {exporting === "download" ? <LoaderCircle size={13} className="spin-working" /> : <Download size={13} />} Export PNG
            </button>
          </>
        )}
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
function Preview({ shot, image, busy, live, time, playingSince }: { shot: Shot; image: ShotImage | null; busy: boolean; live: ShotLive | null; time: number; playingSince: number | null }) {
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
          <ShotStage shot={shot} image={image} live={live} time={time} scrollByMessage playingSince={playingSince} />
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
        {step < 1 ? draft.toFixed(1) : Math.round(draft)}
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

/** How much of the page the video shows at once: a screen of it when it scrolls, else what the shot shows. */
function liveHeight(shot: Shot, image: ShotImage) {
  return shot.motion.template === "scroll" && shot.crop.mode === "top" ? Math.min(image.height, shot.crop.height) : image.height;
}

/** The offered speed closest to a shot's (agents and older shots may use another). */
function nearestSpeed(speed: number) {
  return SHOT_SCROLL_SPEEDS.reduce((best, s) => (Math.abs(s.value - speed) < Math.abs(best.value - speed) ? s : best)).value;
}
