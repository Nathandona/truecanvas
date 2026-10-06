import { useEffect } from "react";
import { onFrameKey } from "../lib/bridge";
import { handleShortcut } from "./shortcuts";

/**
 * The canvas keyboard: shortcuts, and Space held for panning. Keys typed into
 * fields, used by a focused control (Enter on a button) or meant for an open
 * dialog never become canvas shortcuts. Keys pressed inside a frame arrive
 * through the bridge.
 */
export function useCanvasKeyboard(setSpace: (held: boolean) => void) {
  useEffect(() => {
    const isTyping = () => {
      const a = document.activeElement as HTMLElement | null;
      return !!a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName));
    };
    // a dialog owns the keyboard while it's open
    const modalOpen = () => !!document.querySelector('[aria-modal="true"], .modal-backdrop, .review-sheet');
    // Enter, Space, arrows and Delete on a focused button, tab or switch belong to that control
    const onControl = () => {
      const a = document.activeElement as HTMLElement | null;
      if (!a || a === document.body) return false;
      return /^(BUTTON|A|SUMMARY)$/.test(a.tagName) || /^(button|switch|tab|menuitem|option|radio|checkbox|slider|treeitem)$/.test(a.getAttribute("role") ?? "");
    };
    const CONTROL_KEYS = new Set(["Enter", " ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Delete", "Backspace"]);
    const down = (e: KeyboardEvent) => {
      if (isTyping() || modalOpen()) return;
      if (!e.metaKey && !e.ctrlKey && !e.altKey && onControl() && (CONTROL_KEYS.has(e.key) || e.code === "Space")) return;
      if (e.code === "Space" && !e.repeat) {
        setSpace(true);
        e.preventDefault();
        return;
      }
      if (handleShortcut({ key: e.key, code: e.code, meta: e.metaKey, ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey })) e.preventDefault();
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpace(false);
    };
    // Space released while the window was in the background: stop panning
    const blur = () => setSpace(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    onFrameKey((k) => !modalOpen() && handleShortcut(k));
    return () => {
      window.removeEventListener("blur", blur);
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [setSpace]);
}
