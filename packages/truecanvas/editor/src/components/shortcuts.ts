import { ELEMENTS, insertElement } from "../lib/elements";
import { openComponentDialog } from "./ComponentDialog";
import { useStore } from "../lib/store";
import { toggleMotion } from "./Toolbar";
import {
  copySelectionCode,
  deleteSelection,
  duplicateSelection,
  reorderSelection,
  selectChild,
  selectParent,
  wrapSelection,
  zoomBy,
  zoomTo,
  zoomToFit,
  zoomToSelection,
} from "../lib/actions";

export interface KeyLike {
  key: string;
  code: string;
  meta: boolean;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
}

export const SHORTCUTS: [string, string][] = [
  ["Select", "V"],
  ["Frame", "F"],
  ["Hand", "H"],
  ["Interact", "P"],
  ["Comment", "C"],
  ["Insert text", "T"],
  ["Create component", "⌘⌥K"],
  ["Pause animations", "⇧P"],
  ["Duplicate", "⌘D"],
  ["Wrap in auto layout", "⇧A"],
  ["Move up / down", "↑ ↓"],
  ["Select parent / child", "⇧↵ / ↵"],
  ["Copy as JSX", "⌘C"],
  ["Zoom to fit", "⇧1"],
  ["Zoom to selection", "⇧2"],
  ["Actual size", "⇧0"],
  ["Undo / Redo", "⌘Z / ⇧⌘Z"],
];

/** Returns true when handled. Works for real key events and ones forwarded from frames. */
export function handleShortcut(k: KeyLike): boolean {
  const s = useStore.getState();
  const mod = k.meta || k.ctrl;
  const key = k.key.length === 1 ? k.key.toLowerCase() : k.key;

  if (mod) {
    if (k.alt && key === "k") return openComponentDialog(true), true;
    if (key === "z" && !k.shift) return void s.undo(), true;
    if ((key === "z" && k.shift) || key === "y") return void s.redo(), true;
    if (key === "d") return duplicateSelection(), true;
    if (key === "c" && !k.shift) {
      if (window.getSelection()?.toString()) return false;
      return void copySelectionCode(), true;
    }
    if (key === "=" || key === "+") return zoomBy(1.25), true;
    if (key === "-") return zoomBy(0.8), true;
    if (key === "0") return zoomTo(1), true;
    if (key === "a") {
      const frames = s.doc?.frames.map((f) => f.id) ?? [];
      s.select(frames);
      return true;
    }
    return false;
  }

  if (k.shift && k.code === "Digit1") return zoomToFit(), true;
  if (k.shift && k.code === "Digit2") return zoomToSelection(), true;
  if (k.shift && k.code === "Digit0") return zoomTo(1), true;
  if (k.shift && key === "a") return wrapSelection(), true;
  if (k.shift && key === "Enter") return selectParent(), true;
  if (k.shift && key === "p") return toggleMotion(), true;

  switch (key) {
    case "t":
      return void insertElement(ELEMENTS[0]), true;
    case "v":
      return s.set({ tool: "select" }), true;
    case "f":
      return s.set({ tool: "frame" }), true;
    case "h":
      return s.set({ tool: "hand" }), true;
    case "c":
      return s.set({ tool: s.tool === "comment" ? "select" : "comment", hover: null }), true;
    case "p":
      return s.set({ tool: s.tool === "interact" ? "select" : "interact", hover: null }), true;
    case "Escape":
      if (s.editingText) return s.set({ editingText: null }), true;
      if (s.playing) return s.set({ playing: null }), true;
      if (s.draftComment || s.openThread) return s.set({ draftComment: null, openThread: null }), true;
      if (s.compare) return void import("./GitPanel").then((m) => m.stopCompare()), true;
      if (s.tool !== "select") return s.set({ tool: "select" }), true;
      if (s.selection.length) {
        const parent = s.index.get(s.selection[0])?.parent;
        s.select(parent ? [parent.id] : []);
      }
      return true;
    case "Enter": {
      const node = s.index.get(s.selection[0])?.node;
      if (node && s.selection.length === 1 && node.children.every((c) => c.kind === "text") && node.children.length) {
        s.set({ editingText: node.id });
        return true;
      }
      return selectChild(), true;
    }
    case "Delete":
    case "Backspace":
      return deleteSelection(), true;
    case "ArrowUp":
    case "ArrowLeft":
      return reorderSelection(-1), true;
    case "ArrowDown":
    case "ArrowRight":
      return reorderSelection(1), true;
  }
  return false;
}
