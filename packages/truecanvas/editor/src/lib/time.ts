import { useSyncExternalStore } from "react";

/** "now", "5m", "3h", "2d" (short) or "just now", "5m ago"… (long). */
export function ago(t: number, style: "short" | "long" = "short"): string {
  const s = (Date.now() - t) / 1000;
  const unit = s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`;
  if (s < 60) return style === "short" ? "now" : "just now";
  return style === "short" ? unit : `${unit} ago`;
}

// one clock for every relative time on screen, ticking only while something shows one
const listeners = new Set<() => void>();
let tick = 0;
let timer = 0;
function subscribe(fn: () => void) {
  listeners.add(fn);
  if (!timer)
    timer = window.setInterval(() => {
      tick++;
      for (const l of listeners) l();
    }, 15_000);
  return () => {
    listeners.delete(fn);
    if (!listeners.size) {
      clearInterval(timer);
      timer = 0;
    }
  };
}

/** Re-renders every 15s, so "5m ago" stays true. */
export function useClock(): number {
  return useSyncExternalStore(subscribe, () => tick);
}
