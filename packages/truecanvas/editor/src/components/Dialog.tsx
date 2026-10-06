import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

const FOCUSABLE = 'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

/**
 * The editor's modal: focus moves in on open and is trapped inside, Escape
 * and a click outside close it (unless busy), and focus returns where it was.
 * Keys typed in it never reach the canvas shortcuts.
 */
export function Dialog({
  title,
  width = 420,
  busy = false,
  role = "dialog",
  onClose,
  children,
}: {
  title: ReactNode;
  width?: number;
  busy?: boolean;
  /** "alertdialog" for confirmations */
  role?: "dialog" | "alertdialog";
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const el = ref.current!;
    // autoFocus children are already focused; otherwise the first control, else the dialog
    if (!el.contains(document.activeElement)) (el.querySelector<HTMLElement>(FOCUSABLE) ?? el).focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  const onKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Escape" && !busy) {
      e.preventDefault();
      onClose();
    }
    if (e.key === "Tab") {
      const items = [...ref.current!.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };
  return createPortal(
    <div className="modal-backdrop" onPointerDown={() => !busy && onClose()}>
      <div ref={ref} className="modal" role={role} aria-modal="true" aria-labelledby={titleId} tabIndex={-1} style={{ width }} onPointerDown={(e) => e.stopPropagation()} onKeyDown={onKeyDown}>
        <div className="modal-title" id={titleId}>
          {title}
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
