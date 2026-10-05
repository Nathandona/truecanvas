// A tiny model of the Tailwind layout utilities the Layout panel edits.

export type Direction = "row" | "col";
export type Align = "start" | "center" | "end" | "stretch" | "baseline";
export type Justify = "start" | "center" | "end" | "between" | "around" | "evenly";

export interface LayoutModel {
  display: "flex" | "grid" | "block" | "inline-flex" | "other";
  direction: Direction;
  wrap: boolean;
  gap: number | null; // px
  padX: number | null;
  padY: number | null;
  items: Align | null;
  justify: Justify | null;
}

const spacingRe = /^(-?)(gap|p|px|py|pt|pr|pb|pl)-(\d+(?:\.\d+)?|px|\[(\d+(?:\.\d+)?)px\])$/;

function spacingPx(raw: string): number | null {
  if (raw === "px") return 1;
  const arb = /^\[(\d+(?:\.\d+)?)px\]$/.exec(raw);
  if (arb) return Number(arb[1]);
  const n = Number(raw);
  return Number.isFinite(n) ? n * 4 : null;
}

export function tokens(className: string): string[] {
  return className.split(/\s+/).filter(Boolean);
}

export function readLayout(className: string): LayoutModel {
  const t = tokens(className).filter((c) => !c.includes(":"));
  const m: LayoutModel = { display: "other", direction: "row", wrap: false, gap: null, padX: null, padY: null, items: null, justify: null };
  for (const c of t) {
    if (c === "flex" || c === "grid" || c === "block" || c === "inline-flex") m.display = c;
    else if (c === "flex-col") m.direction = "col";
    else if (c === "flex-row") m.direction = "row";
    else if (c === "flex-wrap") m.wrap = true;
    else if (c.startsWith("items-")) m.items = c.slice(6) as Align;
    else if (c.startsWith("justify-")) m.justify = c.slice(8) as Justify;
    else {
      const s = spacingRe.exec(c);
      if (!s) continue;
      const px = spacingPx(s[3]);
      if (s[2] === "gap") m.gap = px;
      else if (s[2] === "p") m.padX = m.padY = px;
      else if (s[2] === "px") m.padX = px;
      else if (s[2] === "py") m.padY = px;
    }
  }
  return m;
}

function spacingClass(prefix: string, px: number): string {
  const n = px / 4;
  if (Number.isInteger(n * 2)) return `${prefix}-${n}`;
  return `${prefix}-[${px}px]`;
}

/** Returns className with a group of utilities replaced. */
function replaceGroup(className: string, match: (c: string) => boolean, add: string[]): string {
  const t = tokens(className);
  const out: string[] = [];
  let inserted = false;
  for (const c of t) {
    if (match(c)) {
      if (!inserted) {
        out.push(...add);
        inserted = true;
      }
      continue;
    }
    out.push(c);
  }
  if (!inserted) out.push(...add);
  return [...new Set(out)].join(" ");
}

export function setAutoLayout(className: string, on: boolean, direction: Direction = "col"): string {
  if (!on) return replaceGroup(className, (c) => ["flex", "inline-flex", "flex-col", "flex-row", "flex-wrap"].includes(c) || c.startsWith("gap-") || c.startsWith("items-") || c.startsWith("justify-"), []);
  return replaceGroup(className, (c) => c === "block" || c === "grid", direction === "col" ? ["flex", "flex-col", "gap-2"] : ["flex", "gap-2"]);
}

export function setDirection(className: string, d: Direction): string {
  let next = className;
  if (!tokens(next).some((c) => c === "flex" || c === "inline-flex")) next = replaceGroup(next, () => false, ["flex"]);
  return replaceGroup(next, (c) => c === "flex-col" || c === "flex-row", d === "col" ? ["flex-col"] : []);
}

export function setSpacing(className: string, kind: "gap" | "px" | "py", px: number | null): string {
  const isKind = (c: string) => {
    const s = spacingRe.exec(c);
    if (!s || c.includes(":")) return false;
    if (kind === "gap") return s[2] === "gap";
    return s[2] === kind || s[2] === "p";
  };
  // expanding `p-4` into px/py when only one axis changes
  let base = className;
  const p = tokens(className).find((c) => /^p-/.test(c));
  if (p && kind !== "gap") {
    const val = spacingPx(spacingRe.exec(p)![3]);
    const other = kind === "px" ? "py" : "px";
    base = replaceGroup(className, (c) => c === p, val === null ? [] : [spacingClass(other, val)]);
  }
  return replaceGroup(base, isKind, px === null || Number.isNaN(px) ? [] : [spacingClass(kind, Math.max(0, px))]);
}

export function setWrap(className: string, wrap: boolean): string {
  return replaceGroup(className, (c) => c === "flex-wrap" || c === "flex-nowrap", wrap ? ["flex-wrap"] : []);
}

export function setAlign(className: string, items: Align | null, justify: Justify | null): string {
  let next = replaceGroup(className, (c) => c.startsWith("items-"), items && items !== "stretch" ? [`items-${items}`] : []);
  next = replaceGroup(next, (c) => c.startsWith("justify-") && !c.startsWith("justify-items") && !c.startsWith("justify-self"), justify && justify !== "start" ? [`justify-${justify}`] : []);
  return next;
}

/** 3×3 alignment grid → items/justify for the current direction. */
export function alignFromGrid(direction: Direction, col: 0 | 1 | 2, row: 0 | 1 | 2): { items: Align; justify: Justify } {
  const pos = ["start", "center", "end"] as const;
  return direction === "row" ? { justify: pos[col], items: pos[row] } : { items: pos[col], justify: pos[row] };
}

export function gridFromAlign(m: LayoutModel): { col: number; row: number } {
  const idx = (v: string | null) => (v === "center" ? 1 : v === "end" ? 2 : 0);
  return m.direction === "row" ? { col: idx(m.justify), row: idx(m.items) } : { col: idx(m.items), row: idx(m.justify) };
}

export function layoutLabel(className: string | undefined): string | null {
  if (!className) return null;
  const m = readLayout(className);
  if (m.display === "grid") return "Grid";
  if (m.display === "flex" || m.display === "inline-flex") return m.direction === "col" ? "Stack" : "Row";
  return null;
}

// ---------------------------------------------------------------------------
// Style groups: each Design-panel control reads/writes one group of utilities.
// Variant classes (hover:, md:, dark:) are never touched.
// ---------------------------------------------------------------------------

const TEXT_SIZE = /^text-(xs|sm|base|lg|xl|[2-9]xl|\[\d+(\.\d+)?(px|rem)\])$/;
const TEXT_ALIGN = /^text-(left|center|right|justify|start|end)$/;
const TEXT_OTHER = /^text-(wrap|nowrap|balance|pretty|ellipsis|clip|shadow.*)$/;
const BORDER_WIDTH = /^border(-(0|2|4|8|\[\d+(\.\d+)?px\]))?$/;
const BORDER_OTHER = /^border-(solid|dashed|dotted|double|none|hidden|collapse|separate|spacing.*|[trblxyse](-.+)?)$/;
const BG_OTHER = /^bg-(gradient|linear|radial|conic|none|cover|contain|auto|center|top|bottom|left|right|no-repeat|repeat.*|fixed|local|scroll|clip.*|origin.*|blend.*|\[url.*)/;

export const GROUPS = {
  width: (c: string) => /^w-/.test(c),
  height: (c: string) => /^h-/.test(c),
  opacity: (c: string) => /^opacity-/.test(c),
  radius: (c: string) => /^rounded(-(none|xs|sm|md|lg|xl|[2-4]xl|full|\[[^\]]+\]))?$/.test(c),
  overflow: (c: string) => /^overflow-(hidden|clip|visible|auto|scroll)$/.test(c),
  bg: (c: string) => /^bg-/.test(c) && !BG_OTHER.test(c),
  borderWidth: (c: string) => BORDER_WIDTH.test(c),
  borderColor: (c: string) => /^border-/.test(c) && !BORDER_WIDTH.test(c) && !BORDER_OTHER.test(c),
  shadow: (c: string) => /^shadow(-(2xs|xs|sm|md|lg|xl|2xl|none|inner|\[.+\]))?$/.test(c),
  blur: (c: string) => /^blur(-(none|xs|sm|md|lg|xl|[23]xl|\[.+\]))?$/.test(c),
  backdropBlur: (c: string) => /^backdrop-blur(-(none|xs|sm|md|lg|xl|[23]xl|\[.+\]))?$/.test(c),
  textSize: (c: string) => TEXT_SIZE.test(c),
  textAlign: (c: string) => TEXT_ALIGN.test(c),
  textColor: (c: string) => /^text-/.test(c) && !TEXT_SIZE.test(c) && !TEXT_ALIGN.test(c) && !TEXT_OTHER.test(c),
  weight: (c: string) => /^font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/.test(c),
  leading: (c: string) => /^leading-/.test(c),
  tracking: (c: string) => /^tracking-/.test(c),
  gridCols: (c: string) => /^grid-cols-/.test(c),
} as const;
export type GroupName = keyof typeof GROUPS;

const base = (className: string) => tokens(className).filter((c) => !c.includes(":"));

/** The class of a group currently on the element (first match), or null. */
export function getGroup(className: string, group: GroupName): string | null {
  return base(className).find(GROUPS[group]) ?? null;
}

/** Replace a group's class (or remove it with null), keeping the rest in place. */
export function setGroup(className: string, group: GroupName, cls: string | null): string {
  const match = (c: string) => !c.includes(":") && GROUPS[group](c);
  return replaceGroup(className, match, cls ? [cls] : []);
}

/** "bg-accent/20" → "accent/20" */
export function suffix(cls: string | null, prefix: string): string | null {
  return cls && cls.startsWith(prefix) ? cls.slice(prefix.length) : null;
}

// ---------- sizes ----------

export type SizeMode = "fixed" | "hug" | "fill" | "auto";

export function readSize(className: string, axis: "w" | "h"): { mode: SizeMode; px: number | null; raw: string | null } {
  const raw = getGroup(className, axis === "w" ? "width" : "height");
  const v = suffix(raw, `${axis}-`);
  if (!v) return { mode: "auto", px: null, raw: null };
  if (v === "full" || v === "screen" || v === "dvh" || v === "svh") return { mode: "fill", px: null, raw };
  if (v === "fit" || v === "max" || v === "min") return { mode: "hug", px: null, raw };
  if (v === "auto") return { mode: "auto", px: null, raw };
  return { mode: "fixed", px: spacingPx(v), raw };
}

export function writeSize(className: string, axis: "w" | "h", mode: SizeMode, px?: number | null): string {
  const group = axis === "w" ? "width" : "height";
  if (mode === "auto") return setGroup(className, group, null);
  if (mode === "fill") return setGroup(className, group, `${axis}-full`);
  if (mode === "hug") return setGroup(className, group, `${axis}-fit`);
  const n = Math.max(0, Math.round(px ?? 100));
  return setGroup(className, group, spacingClass(axis, n));
}

// ---------- padding, per side ----------

export interface Sides {
  t: number | null;
  r: number | null;
  b: number | null;
  l: number | null;
}

export function readPadding(className: string): Sides {
  const out: Sides = { t: null, r: null, b: null, l: null };
  for (const c of base(className)) {
    const m = spacingRe.exec(c);
    if (!m || m[2] === "gap") continue;
    const px = spacingPx(m[3]);
    const k = m[2];
    if (k === "p") out.t = out.r = out.b = out.l = px;
    if (k === "px") out.l = out.r = px;
    if (k === "py") out.t = out.b = px;
    if (k === "pt") out.t = px;
    if (k === "pr") out.r = px;
    if (k === "pb") out.b = px;
    if (k === "pl") out.l = px;
  }
  return out;
}

/** Writes the shortest classes for four sides: p-4, px-4 py-2, or pt/pr/pb/pl. */
export function writePadding(className: string, s: Sides): string {
  const isPad = (c: string) => {
    const m = spacingRe.exec(c);
    return !!m && !c.includes(":") && m[2] !== "gap";
  };
  const cls: string[] = [];
  const v = (n: number | null) => (n === null ? null : Math.max(0, n));
  const [t, r, b, l] = [v(s.t), v(s.r), v(s.b), v(s.l)];
  if (t !== null && t === r && r === b && b === l) cls.push(spacingClass("p", t));
  else {
    if (l !== null && l === r) cls.push(spacingClass("px", l));
    else {
      if (l !== null) cls.push(spacingClass("pl", l));
      if (r !== null) cls.push(spacingClass("pr", r));
    }
    if (t !== null && t === b) cls.push(spacingClass("py", t));
    else {
      if (t !== null) cls.push(spacingClass("pt", t));
      if (b !== null) cls.push(spacingClass("pb", b));
    }
  }
  return replaceGroup(className, isPad, cls);
}

// ---------- scales shown in pickers ----------

export const TEXT_PX: Record<string, number> = { xs: 12, sm: 14, base: 16, lg: 18, xl: 20, "2xl": 24, "3xl": 30, "4xl": 36, "5xl": 48, "6xl": 60, "7xl": 72, "8xl": 96, "9xl": 128 };
export const RADIUS_PX: Record<string, number> = { none: 0, xs: 2, sm: 4, md: 6, lg: 8, xl: 12, "2xl": 16, "3xl": 24, "4xl": 32 };
export const WEIGHTS = ["thin", "extralight", "light", "normal", "medium", "semibold", "bold", "extrabold", "black"];
export const WEIGHT_NUM: Record<string, number> = { thin: 100, extralight: 200, light: 300, normal: 400, medium: 500, semibold: 600, bold: 700, extrabold: 800, black: 900 };
export const LEADING = ["none", "tight", "snug", "normal", "relaxed", "loose"];
export const TRACKING = ["tighter", "tight", "normal", "wide", "wider", "widest"];

/** Switch an auto layout between flex (row/col) and grid without touching other classes. */
export function setDisplayMode(className: string, mode: "row" | "col" | "grid"): string {
  const drop = new Set(["flex", "inline-flex", "grid", "inline-grid", "flex-col", "flex-row", "flex-wrap"]);
  const keep = tokens(className).filter((c) => c.includes(":") || (!drop.has(c) && !/^grid-cols-/.test(c)));
  const cols = /\bgrid-cols-(\S+)/.exec(className)?.[1] ?? "2";
  const add = mode === "grid" ? ["grid", `grid-cols-${cols}`] : mode === "col" ? ["flex", "flex-col"] : ["flex"];
  return [...add, ...keep].join(" ");
}
