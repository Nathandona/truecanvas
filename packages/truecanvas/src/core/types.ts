export type PropValue =
  | { kind: "string"; value: string }
  | { kind: "number"; value: number }
  | { kind: "boolean"; value: boolean }
  | { kind: "array"; value: (string | number | boolean)[] }
  | { kind: "expression"; code: string };

export type NodeKind = "component" | "element" | "text" | "expression" | "fragment";

export interface AttrRange {
  name: string;
  start: number;
  end: number;
  /**
   * For `className={cn("a b", className)}` (cn, clsx, cx, twMerge, classNames):
   * the range of the string literal, so class edits replace it and keep the merge.
   */
  literal?: { start: number; end: number };
}

export interface CanvasNode {
  id: string;
  kind: NodeKind;
  /** Tag or component name; for text the trimmed text, for expressions the code. */
  name: string;
  props: Record<string, PropValue>;
  /** Spread attributes like {...rest}. When present, some props are not statically known. */
  spreads: number;
  children: CanvasNode[];
  text?: string;
  start: number;
  end: number;
  line: number;
  col: number;
  /** Index path from the canvas root: [frameIndex, childIndex, ...]. */
  path: number[];
  // Source positions used by the editor engine.
  attrs: AttrRange[];
  nameEnd: number;
  openEnd: number;
  selfClosing: boolean;
  closeStart: number;
}

export interface CanvasFrame extends CanvasNode {
  frameName: string;
  x: number;
  y: number;
  width: number;
  height: number | null;
  theme: "light" | "dark" | null;
  device: string | null;
  /** linked frame: the App Router page it shows (project-relative). Its layers are that page's JSX. */
  page: string | null;
  /** exploration copied from this page file ("Apply to page" writes it back) */
  from: string | null;
  /** main component frame: "components/button.tsx#Button". Its layers are that component's JSX. */
  component: string | null;
  /** set on linked frames once resolved */
  link: FrameLink | null;
}

export interface FrameLink {
  /** "page": a linked App Router page; "component": a main component */
  kind?: "page" | "component";
  page: string;
  /** URL path of the page, e.g. "/" */
  route: string;
  /** page and layout files whose JSX appears as layers */
  files: string[];
  /** false when the page has data or logic: shown as is, edit a copy instead */
  editable: boolean;
  reason?: string;
}

export interface ImportInfo {
  source: string;
  typeOnly: boolean;
  names: string[];
  /** named value imports, `{ Search as SearchIcon }` → { imported: "Search", local: "SearchIcon" } */
  bindings: { imported: string; local: string }[];
  defaultName: string | null;
  start: number;
  end: number;
  /** End of the last named specifier, for appending `, Name`. */
  lastSpecifierEnd: number | null;
}

export interface CanvasDoc {
  /** increases every time a doc is computed: lets clients drop a stale one that arrives late */
  rev?: number;
  name: string;
  file: string;
  frames: CanvasFrame[];
  imports: ImportInfo[];
  canvasNode: CanvasNode | null;
  /** End of the "use client" directive prologue; imports must go after it. */
  prologueEnd: number;
  /** Top-level names declared in the canvas file itself. */
  declared: string[];
  error?: string;
}

export interface PropSpec {
  name: string;
  type: "string" | "number" | "boolean" | "enum" | "node" | "function" | "color" | "colors" | "other";
  options?: string[];
  /** shown under "Advanced" in the inspector */
  advanced?: boolean;
  /** numeric range, from docs like "(0 to 1)" */
  min?: number;
  max?: number;
  optional: boolean;
  default?: string | number | boolean | (string | number | boolean)[];
  description?: string;
  typeText: string;
}

export interface Preset {
  name: string;
  props: Record<string, string | number | boolean | (string | number | boolean)[]>;
}

export interface ComponentSpec {
  name: string;
  /** project-relative file, or the package name for library components */
  file: string;
  /** set for components from npm packages: the import specifier */
  library?: string;
  presets?: Preset[];
  description?: string;
  props: PropSpec[];
  acceptsClassName: boolean;
  acceptsChildren: boolean;
}
