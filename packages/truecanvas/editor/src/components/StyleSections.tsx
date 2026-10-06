import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlignCenter, AlignLeft, AlignRight, ArrowDown, ArrowRight, Grid2x2, Minus, Plus, Scan, Square, WrapText } from "lucide-react";
import { useStore } from "../lib/store";
import type { CanvasNode, TokenData } from "../lib/api";
import {
  LEADING,
  RADIUS_PX,
  TEXT_PX,
  TRACKING,
  WEIGHTS,
  WEIGHT_NUM,
  alignFromGrid,
  getGroup,
  gridFromAlign,
  readLayout,
  readPadding,
  readSize,
  setAlign,
  setAutoLayout,
  setDisplayMode,
  setGroup,
  setSpacing,
  setWrap,
  suffix,
  writePadding,
  writeSize,
  type SizeMode,
} from "../lib/classes";
import { NumberField, Section, Segmented, Select, SliderField, TextField, Tip } from "./controls";

const words = (c: string) => c.split(/\s+/).filter(Boolean);
let classQueue: Promise<unknown> = Promise.resolve();

/**
 * Applies a style edit as a change (classes added and removed) to the node's
 * class list as it is when the edit runs. Edits run one after another, so two
 * quick edits to different style groups both land instead of the second one
 * overwriting the first with a stale class list.
 */
function writeClassChange(run: ReturnType<typeof useStore.getState>["run"], canvas: string, id: string, from: string, to: string) {
  const before = words(from);
  const after = words(to);
  const removed = new Set(before.filter((c) => !after.includes(c)));
  const added = after.filter((c) => !before.includes(c));
  if (!removed.size && !added.length) return;
  classQueue = classQueue.then(async () => {
    const s = useStore.getState();
    const live = (s.index.get(id) ?? s.index.get(s.selection[0]))?.node;
    const prop = live?.props.className;
    const current = prop?.kind === "string" ? words(prop.value) : prop ? null : [];
    if (!live || current === null) return;
    const next = [...current.filter((c) => !removed.has(c)), ...added.filter((c) => !current.includes(c))].join(" ");
    if (next !== current.join(" ")) await run({ op: "set_class", canvas, id: live.id, className: next }, { select: false });
  }).catch(() => {}); // a failed edit (already reported) must not block the next ones
}

const TEXT_TAGS = /^(h[1-6]|p|span|a|label|button|li|strong|em|small|blockquote|code|figcaption|dt|dd|th|td)$/;

/** Every Figma-style section for a node whose className we can edit. */
export function StyleSections({ node, component }: { node: CanvasNode; component: boolean }) {
  const canvas = useStore((s) => s.canvas)!;
  const run = useStore((s) => s.run);
  const tokens = useStore((s) => s.tokens);
  const cv = node.props.className;
  const className = cv?.kind === "string" ? cv.value : "";

  if (cv?.kind === "expression") {
    return (
      <Section title="Styles">
        <div className="field readonly">{`{${cv.code}}`}</div>
        <p className="faint" style={{ margin: "8px 0 0" }}>The class name is computed in code, so it can't be edited here.</p>
      </Section>
    );
  }

  const write = (next: string) => writeClassChange(run, canvas, node.id, className, next);
  const hasText = node.kind === "element" && (TEXT_TAGS.test(node.name) || node.children.some((c) => c.kind === "text"));
  const p = { className, write, tokens };
  return (
    <>
      <LayoutStyle {...p} component={component} />
      <AppearanceStyle {...p} />
      <FillStyle {...p} />
      <StrokeStyle {...p} />
      <EffectsStyle {...p} />
      {(hasText || getGroup(className, "textSize") || getGroup(className, "textColor")) && <TextStyle {...p} />}
      <Section title="Classes">
        <TextField mono multiline value={className} placeholder="Tailwind classes" onCommit={write} ariaLabel="Classes" />
      </Section>
    </>
  );
}

interface StyleProps {
  className: string;
  write: (next: string) => unknown;
  tokens: TokenData | null;
}

const pretty = (s: string) => s.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());

// ---------------------------------------------------------------------------
// Layout: size, auto layout, padding, clip
// ---------------------------------------------------------------------------

function SizeRow({ axis, className, write }: { axis: "w" | "h"; className: string; write: (n: string) => unknown }) {
  const size = readSize(className, axis);
  return (
    <div className="size-row">
      <NumberField
        prefix={axis.toUpperCase()}
        value={size.mode === "fixed" ? size.px : null}
        placeholder={size.mode === "fixed" ? "" : pretty(size.mode)}
        min={0}
        onCommit={(v) => write(v === null ? writeSize(className, axis, "auto") : writeSize(className, axis, "fixed", v))}
        ariaLabel={axis === "w" ? "Width" : "Height"}
      />
      <Select
        value={size.mode}
        options={[
          { value: "fixed", label: "Fixed" },
          { value: "hug", label: "Hug", hint: `${axis}-fit` },
          { value: "fill", label: "Fill", hint: `${axis}-full` },
          { value: "auto", label: "Auto" },
        ]}
        onChange={(m) => write(writeSize(className, axis, m as SizeMode, size.px ?? 240))}
        ariaLabel={`${axis === "w" ? "Width" : "Height"} mode`}
      />
    </div>
  );
}

function LayoutStyle({ className, write, component }: StyleProps & { component: boolean }) {
  const m = useMemo(() => readLayout(className), [className]);
  const auto = m.display === "flex" || m.display === "inline-flex";
  const grid = m.display === "grid";
  const pad = readPadding(className);
  const [sides, setSides] = useState(() => pad.t !== pad.b || pad.l !== pad.r);
  const clip = getGroup(className, "overflow");
  const cols = suffix(getGroup(className, "gridCols"), "grid-cols-");
  const align = gridFromAlign(m);

  return (
    <Section
      title="Layout"
      actions={
        <Tip label={auto ? "Remove auto layout" : "Add auto layout"} kbd={auto ? undefined : "⇧A"}>
          <button className="icon-btn sm" onClick={() => write(setAutoLayout(className, !auto))} aria-label="Toggle auto layout">
            {auto ? <Minus size={13} /> : <Plus size={13} />}
          </button>
        </Tip>
      }
    >
      <div className="grid2">
        <SizeRow axis="w" className={className} write={write} />
        <SizeRow axis="h" className={className} write={write} />
      </div>

      {(auto || grid) && (
        <div className="row" style={{ alignItems: "flex-start", marginTop: 10 }}>
          <div style={{ flex: 1, display: "grid", gap: 6, minWidth: 0 }}>
            <Segmented
              value={grid ? "grid" : m.direction}
              options={[
                { value: "col", icon: <ArrowDown size={13} />, title: "Vertical" },
                { value: "row", icon: <ArrowRight size={13} />, title: "Horizontal" },
                { value: "grid", icon: <Grid2x2 size={13} />, title: "Grid" },
              ]}
              onChange={(d) => write(setDisplayMode(className, d as "row" | "col" | "grid"))}
            />
            <NumberField prefix={<Tip label="Gap between items"><span>Gap</span></Tip>} value={m.gap} placeholder="0" min={0} onCommit={(v) => write(setSpacing(className, "gap", v))} ariaLabel="Gap" />
            {grid ? (
              <NumberField prefix="Cols" value={cols ? Number(cols) || null : null} placeholder="1" min={1} onCommit={(v) => write(setGroup(className, "gridCols", v ? `grid-cols-${Math.round(v)}` : null))} ariaLabel="Grid columns" />
            ) : (
              <div className="row" style={{ gap: 6 }}>
                <Tip label="Wrap">
                  <button className={`icon-btn${m.wrap ? " on" : ""}`} onClick={() => write(setWrap(className, !m.wrap))} aria-label="Wrap">
                    <WrapText size={14} />
                  </button>
                </Tip>
                <span className="faint">Wrap</span>
              </div>
            )}
          </div>
          {auto && (
            <div className={`align-grid${m.direction === "col" ? " col" : ""}`} role="group" aria-label="Alignment">
              {[0, 1, 2].map((row) =>
                [0, 1, 2].map((col) => (
                  <button
                    key={`${row}${col}`}
                    className={align.col === col && align.row === row ? "on" : ""}
                    aria-label={`Align ${row}-${col}`}
                    onClick={() => {
                      const a = alignFromGrid(m.direction, col as 0 | 1 | 2, row as 0 | 1 | 2);
                      write(setAlign(className, a.items, a.justify));
                    }}
                  />
                )),
              )}
            </div>
          )}
        </div>
      )}

      <div className="sub-label">
        <span>Padding</span>
        <Tip label={sides ? "Same padding per axis" : "Padding per side"}>
          <button className={`icon-btn sm${sides ? " on" : ""}`} onClick={() => setSides(!sides)} aria-label="Padding per side">
            <Scan size={12} />
          </button>
        </Tip>
      </div>
      {sides ? (
        <div className="grid4">
          {(["t", "r", "b", "l"] as const).map((k) => (
            <NumberField key={k} prefix={{ t: "T", r: "R", b: "B", l: "L" }[k]} value={pad[k]} placeholder="0" min={0} onCommit={(v) => write(writePadding(className, { ...pad, [k]: v }))} ariaLabel={`Padding ${k}`} />
          ))}
        </div>
      ) : (
        <div className="grid2">
          <NumberField prefix="↔" value={pad.l === pad.r ? pad.l : null} placeholder={pad.l !== pad.r ? "Mixed" : "0"} min={0} onCommit={(v) => write(writePadding(className, { ...pad, l: v, r: v }))} ariaLabel="Horizontal padding" />
          <NumberField prefix="↕" value={pad.t === pad.b ? pad.t : null} placeholder={pad.t !== pad.b ? "Mixed" : "0"} min={0} onCommit={(v) => write(writePadding(className, { ...pad, t: v, b: v }))} ariaLabel="Vertical padding" />
        </div>
      )}

      {!component && (
        <label className="check-row">
          <input type="checkbox" checked={clip === "overflow-hidden" || clip === "overflow-clip"} onChange={(e) => write(setGroup(className, "overflow", e.target.checked ? "overflow-hidden" : null))} />
          Clip content
        </label>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Appearance: opacity, radius
// ---------------------------------------------------------------------------

function AppearanceStyle({ className, write, tokens }: StyleProps) {
  const opacityCls = suffix(getGroup(className, "opacity"), "opacity-");
  const opacity = opacityCls === null ? 100 : Number(opacityCls.replace(/[[\]%]/g, "")) || 0;
  const radiusCls = getGroup(className, "radius");
  const radiusKey = radiusCls === null ? "" : radiusCls === "rounded" ? "sm" : radiusCls.replace(/^rounded-/, "");
  const arbitrary = /^\[(\d+(?:\.\d+)?)px\]$/.exec(radiusKey);
  const scale = tokens?.radius ?? Object.keys(RADIUS_PX).filter((k) => k !== "none");
  return (
    <Section title="Appearance">
      <div className="prop">
        <label>Opacity</label>
        <SliderField value={opacity} min={0} max={100} onCommit={(v) => write(setGroup(className, "opacity", v >= 100 ? null : `opacity-${Math.round(v)}`))} ariaLabel="Opacity" />
        <span />
      </div>
      <div className="prop">
        <label>Radius</label>
        <Select
          value={arbitrary ? "custom" : radiusKey}
          placeholder="None"
          options={[
            { value: "", label: "None" },
            ...scale.map((k) => ({ value: k, label: k.toUpperCase(), hint: RADIUS_PX[k] !== undefined ? `${RADIUS_PX[k]}px` : undefined })),
            { value: "full", label: "Full", hint: "pill" },
            { value: "custom", label: "Custom…" },
          ]}
          onChange={(v) => write(setGroup(className, "radius", v === "" ? null : v === "custom" ? "rounded-[10px]" : `rounded-${v}`))}
          ariaLabel="Corner radius"
        />
        <span />
      </div>
      {arbitrary && (
        <div className="prop">
          <label />
          <NumberField value={Number(arbitrary[1])} min={0} onCommit={(v) => write(setGroup(className, "radius", v === null ? null : `rounded-[${v}px]`))} ariaLabel="Radius in px" />
          <span />
        </div>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Fill & Stroke
// ---------------------------------------------------------------------------

function FillStyle({ className, write, tokens }: StyleProps) {
  const fill = suffix(getGroup(className, "bg"), "bg-");
  return (
    <Section
      title="Fill"
      actions={
        <button className="icon-btn sm" aria-label={fill ? "Remove fill" : "Add fill"} onClick={() => write(setGroup(className, "bg", fill ? null : `bg-${tokens?.colors.find((c) => /surface|background|muted/.test(c.name))?.name ?? "white"}`))}>
          {fill ? <Minus size={13} /> : <Plus size={13} />}
        </button>
      }
    >
      {fill ? <TokenColorField value={fill} tokens={tokens} onChange={(v) => write(setGroup(className, "bg", v ? `bg-${v}` : null))} ariaLabel="Fill color" /> : <p className="faint" style={{ margin: 0 }}>No fill.</p>}
    </Section>
  );
}

function StrokeStyle({ className, write, tokens }: StyleProps) {
  const width = getGroup(className, "borderWidth");
  const color = suffix(getGroup(className, "borderColor"), "border-");
  const on = width !== null || color !== null;
  const widthPx = width === null ? 1 : width === "border" ? 1 : Number(width.replace(/^border-/, "").replace(/[[\]px]/g, ""));
  return (
    <Section
      title="Stroke"
      actions={
        <button
          className="icon-btn sm"
          aria-label={on ? "Remove stroke" : "Add stroke"}
          onClick={() => write(on ? setGroup(setGroup(className, "borderWidth", null), "borderColor", null) : setGroup(setGroup(className, "borderWidth", "border"), "borderColor", `border-${tokens?.colors.find((c) => c.name === "border")?.name ?? "black/10"}`))}
        >
          {on ? <Minus size={13} /> : <Plus size={13} />}
        </button>
      }
    >
      {on ? (
        <div className="stroke-row">
          <TokenColorField value={color} tokens={tokens} placeholder="Current color" onChange={(v) => write(setGroup(className, "borderColor", v ? `border-${v}` : null))} ariaLabel="Stroke color" />
          <Select
            value={String(widthPx)}
            options={["0", "1", "2", "4", "8"].map((v) => ({ value: v, label: `${v}px` }))}
            onChange={(v) => write(setGroup(className, "borderWidth", v === "1" ? "border" : `border-${v}`))}
            ariaLabel="Stroke width"
          />
        </div>
      ) : (
        <p className="faint" style={{ margin: 0 }}>No stroke.</p>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

function EffectsStyle({ className, write, tokens }: StyleProps) {
  const shadow = getGroup(className, "shadow");
  const blur = getGroup(className, "blur");
  const backdrop = getGroup(className, "backdropBlur");
  const any = shadow || blur || backdrop;
  const level = (cls: string | null, prefix: string) => (cls === null ? "" : cls === prefix ? "default" : cls.slice(prefix.length + 1));
  const blurOpts = [{ value: "", label: "None" }, ...["xs", "sm", "md", "lg", "xl", "2xl", "3xl"].map((v) => ({ value: v, label: v.toUpperCase() }))];
  return (
    <Section
      title="Effects"
      actions={
        <button className="icon-btn sm" aria-label={any ? "Remove effects" : "Add shadow"} onClick={() => write(any ? setGroup(setGroup(setGroup(className, "shadow", null), "blur", null), "backdropBlur", null) : setGroup(className, "shadow", "shadow-md"))}>
          {any ? <Minus size={13} /> : <Plus size={13} />}
        </button>
      }
    >
      {any ? (
        <>
          <div className="prop">
            <label>Shadow</label>
            <Select
              value={level(shadow, "shadow")}
              options={[{ value: "", label: "None" }, ...(tokens?.shadows ?? ["2xs", "xs", "sm", "md", "lg", "xl", "2xl"]).map((v) => ({ value: v, label: v.toUpperCase() })), { value: "inner", label: "Inner" }]}
              onChange={(v) => write(setGroup(className, "shadow", v ? `shadow-${v}` : null))}
              ariaLabel="Shadow"
            />
            <span />
          </div>
          <div className="prop">
            <label>Layer blur</label>
            <Select value={level(blur, "blur")} options={blurOpts} onChange={(v) => write(setGroup(className, "blur", v ? `blur-${v}` : null))} ariaLabel="Layer blur" />
            <span />
          </div>
          <div className="prop">
            <label>Backdrop</label>
            <Select value={level(backdrop, "backdrop-blur")} options={blurOpts} onChange={(v) => write(setGroup(className, "backdropBlur", v ? `backdrop-blur-${v}` : null))} ariaLabel="Background blur" />
            <span />
          </div>
        </>
      ) : (
        <p className="faint" style={{ margin: 0 }}>No effects.</p>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

function TextStyle({ className, write, tokens }: StyleProps) {
  const size = suffix(getGroup(className, "textSize"), "text-");
  const weight = suffix(getGroup(className, "weight"), "font-");
  const leading = suffix(getGroup(className, "leading"), "leading-");
  const tracking = suffix(getGroup(className, "tracking"), "tracking-");
  const align = suffix(getGroup(className, "textAlign"), "text-");
  const color = suffix(getGroup(className, "textColor"), "text-");
  const sizes = tokens?.textSizes ?? Object.keys(TEXT_PX);
  return (
    <Section title="Text">
      <div className="grid2">
        <Select
          value={size ?? ""}
          placeholder="Size"
          options={[{ value: "", label: "Inherit" }, ...sizes.map((s) => ({ value: s, label: s, hint: TEXT_PX[s] ? `${TEXT_PX[s]}px` : undefined }))]}
          onChange={(v) => write(setGroup(className, "textSize", v ? `text-${v}` : null))}
          ariaLabel="Font size"
        />
        <Select
          value={weight ?? ""}
          placeholder="Weight"
          options={[{ value: "", label: "Inherit" }, ...WEIGHTS.map((w) => ({ value: w, label: pretty(w), hint: String(WEIGHT_NUM[w]) }))]}
          onChange={(v) => write(setGroup(className, "weight", v ? `font-${v}` : null))}
          ariaLabel="Font weight"
        />
      </div>
      <div className="grid2">
        <Select
          value={leading ?? ""}
          placeholder="Line height"
          options={[{ value: "", label: "Auto" }, ...LEADING.map((l) => ({ value: l, label: pretty(l) }))]}
          onChange={(v) => write(setGroup(className, "leading", v ? `leading-${v}` : null))}
          ariaLabel="Line height"
        />
        <Select
          value={tracking ?? ""}
          placeholder="Letter spacing"
          options={[{ value: "", label: "Normal" }, ...TRACKING.filter((t) => t !== "normal").map((t) => ({ value: t, label: pretty(t) }))]}
          onChange={(v) => write(setGroup(className, "tracking", v ? `tracking-${v}` : null))}
          ariaLabel="Letter spacing"
        />
      </div>
      <div className="grid2">
        <Segmented
          value={align ?? "inherit"}
          options={[
            { value: "left", icon: <AlignLeft size={13} />, title: "Left" },
            { value: "center", icon: <AlignCenter size={13} />, title: "Center" },
            { value: "right", icon: <AlignRight size={13} />, title: "Right" },
          ]}
          onChange={(v) => write(setGroup(className, "textAlign", v === align ? null : `text-${v}`))}
        />
        <TokenColorField value={color} tokens={tokens} placeholder="Inherit" onChange={(v) => write(setGroup(className, "textColor", v ? `text-${v}` : null))} ariaLabel="Text color" />
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Token color picker: project tokens first, any color as a fallback
// ---------------------------------------------------------------------------

/** "accent/20" | "[#ff0000]" | "white" → CSS color for a swatch. */
export function swatchColor(value: string | null, tokens: TokenData | null): string | null {
  if (!value) return null;
  const [name, alpha] = value.split("/");
  let base: string | null = null;
  if (/^\[.+\]$/.test(name)) base = name.slice(1, -1).replace(/_/g, " ");
  else if (name === "white") base = "#fff";
  else if (name === "black") base = "#000";
  else if (name === "transparent") base = "transparent";
  else base = tokens?.colors.find((c) => c.name === name)?.light ?? null;
  if (!base) return null;
  return alpha ? `color-mix(in srgb, ${base} ${alpha.replace(/[[\]%]/g, "")}%, transparent)` : base;
}

export function TokenColorField({ value, tokens, onChange, placeholder, ariaLabel }: { value: string | null; tokens: TokenData | null; onChange: (v: string | null) => void; placeholder?: string; ariaLabel?: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [name, alpha] = (value ?? "").split("/");
  const [hex, setHex] = useState(/^\[#/.test(name) ? name.slice(1, -1) : "");
  useEffect(() => setHex(/^\[#/.test(name) ? name.slice(1, -1) : ""), [name]);

  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!pop.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // close only the picker, don't let the canvas treat it as "select parent"
      e.stopPropagation();
      setOpen(false);
    };
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("keydown", key, true);
    };
  }, [open]);

  const set = (n: string, a = alpha) => onChange(a && a !== "100" ? `${n}/${a}` : n);
  const label = !value ? (placeholder ?? "None") : /^\[/.test(name) ? name.slice(1, -1) : name;
  const sw = swatchColor(value, tokens);

  return (
    <>
      <button
        ref={btn}
        type="button"
        className="color-trigger"
        aria-label={ariaLabel}
        onClick={() => {
          const r = btn.current!.getBoundingClientRect();
          setPos({ left: Math.min(r.left, window.innerWidth - 268), top: Math.min(r.bottom + 4, window.innerHeight - 330) });
          setOpen(!open);
        }}
      >
        <span className="swatch" style={{ background: sw ?? undefined }}>
          {!sw && value && <Square size={10} className="faint" />}
        </span>
        <span className={`label${value ? "" : " placeholder"}`}>{label}</span>
        {alpha && <span className="faint">{alpha}%</span>}
      </button>
      {open &&
        pos &&
        createPortal(
          <div ref={pop} className="color-pop" style={{ left: pos.left, top: pos.top }} onKeyDown={(e) => e.stopPropagation()}>
            <div className="pop-title">Design tokens</div>
            <div className="token-grid">
              {[...(tokens?.colors ?? []), { name: "white", light: "#fff", dark: null }, { name: "black", light: "#000", dark: null }].map((c) => (
                <Tip key={c.name} label={c.name}>
                  <button className={`token-swatch${name === c.name ? " on" : ""}`} style={{ background: c.light }} aria-label={c.name} onClick={() => set(c.name)} />
                </Tip>
              ))}
            </div>
            <div className="pop-title">Custom</div>
            <div className="row" style={{ gap: 6 }}>
              <label className="swatch big" style={{ background: hex || "#ffffff" }}>
                <input type="color" value={/^#[0-9a-f]{6}$/i.test(hex) ? hex : "#ffffff"} onChange={(e) => setHex(e.target.value)} onBlur={() => hex && set(`[${hex}]`)} />
              </label>
              <div className="field" style={{ flex: 1 }}>
                <input className="mono-input" value={hex} placeholder="#hex" onChange={(e) => setHex(e.target.value)} onKeyDown={(e) => e.key === "Enter" && /^#[0-9a-f]{3,8}$/i.test(hex) && set(`[${hex}]`)} />
              </div>
            </div>
            <div className="row" style={{ marginTop: 8, gap: 6 }}>
              <span className="muted" style={{ width: 52 }}>Opacity</span>
              <div style={{ flex: 1 }}>
                <SliderField value={Number(alpha ?? 100)} min={0} max={100} onCommit={(v) => value && set(name, String(Math.round(v)))} ariaLabel="Color opacity" />
              </div>
            </div>
            {value && (
              <button className="btn block" style={{ marginTop: 8 }} onClick={() => (onChange(null), setOpen(false))}>
                Remove
              </button>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
