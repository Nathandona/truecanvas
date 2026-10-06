import type { CanvasFrame } from "../lib/api";
import type { Rect } from "../lib/store";

/* Types and helpers shared by the canvas, its frames, overlay and menu. */

/** A frame's position and size on the canvas (live while dragging or resizing). */
export interface Override {
  x: number;
  y: number;
  width: number;
  height: number | null;
}

export type Drag =
  | { kind: "pan"; startX: number; startY: number; camX: number; camY: number }
  | { kind: "frame-move"; frame: CanvasFrame; startX: number; startY: number; moved: boolean }
  | { kind: "frame-resize"; frame: CanvasFrame; edge: "e" | "s" | "se" | "w"; startX: number; startY: number }
  | { kind: "draw"; startX: number; startY: number; x: number; y: number }
  | { kind: "marquee"; startX: number; startY: number; x: number; y: number; additive: boolean }
  | { kind: "click"; id: string; startX: number; startY: number; additive: boolean }
  | { kind: "node-drag"; id: string; frame: CanvasFrame; target: Reorder | null };

/** Where a dragged layer would land among its siblings. */
export interface Reorder {
  parent: string;
  index: number;
  /** indicator line in frame coordinates */
  line: Rect;
}

/** "app/page.tsx" → "page.tsx" */
export const fileName = (p: string) => p.split("/").pop() ?? p;
