import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  kbd?: string;
  danger?: boolean;
  onSelect: () => void;
}

export function Menu({ x, y, items, onClose, anchor = "below" }: { x: number; y: number; items: (MenuItem | "sep")[]; onClose: () => void; anchor?: "below" | "above" }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: Event) => {
      if (e instanceof PointerEvent && ref.current?.contains(e.target as Node)) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("blur", close);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("blur", close);
      window.removeEventListener("keydown", key, true);
    };
  }, [onClose]);
  // keyboard: focus moves into the menu, and back where it was when it closes
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
    return () => {
      if (previous?.isConnected && (!document.activeElement || document.activeElement === document.body)) previous.focus({ preventScroll: true });
    };
  }, []);
  const onKeyDown = (e: React.KeyboardEvent) => {
    const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => {
      e.preventDefault();
      items[(n + items.length) % items.length]?.focus();
    };
    if (e.key === "ArrowDown") go(i + 1);
    else if (e.key === "ArrowUp") go(i - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(items.length - 1);
    else if (e.key === "Tab") onClose();
    // the canvas shortcuts must not see keys meant for the menu
    e.stopPropagation();
  };
  // keep inside the window
  const style: React.CSSProperties =
    anchor === "above"
      ? { left: Math.min(x, window.innerWidth - 220), bottom: window.innerHeight - y, maxHeight: y - 8, overflowY: "auto" }
      : { left: Math.min(x, window.innerWidth - 220), top: Math.min(y, window.innerHeight - items.length * 28 - 16) };
  return createPortal(
    <div className="menu" ref={ref} style={style} role="menu" onContextMenu={(e) => e.preventDefault()} onKeyDown={onKeyDown}>
      {items.map((item, i) =>
        item === "sep" ? (
          <div key={i} className="sep" />
        ) : (
          <button
            key={i}
            role="menuitem"
            className={item.danger ? "danger" : ""}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
          >
            {item.icon}
            {item.label}
            {item.kbd && <span className="kbd">{item.kbd}</span>}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}
