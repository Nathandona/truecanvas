import { memo, useMemo } from "react";
import { GitCompare, X } from "lucide-react";
import { useStore, effectiveTheme } from "../lib/store";
import { registerFrame } from "../lib/bridge";
import type { CanvasFrame } from "../lib/api";
import { Segmented, SliderField } from "./controls";
import { stopCompare } from "./GitPanel";


/** Horizontal offset of the "before" copy: entirely to the right of the current canvas. */
function beforeOffset(): number {
  const s = useStore.getState();
  const now = s.doc?.frames ?? [];
  const old = s.compare?.doc.frames ?? [];
  if (!old.length) return 0;
  const right = now.length ? Math.max(...now.map((f) => f.x + f.width)) : 0;
  const left = Math.min(...old.map((f) => f.x));
  return right - left + 320;
}

/** Where an older frame is drawn: in a parallel copy of the canvas (side), or on top of its current version (overlay). */
export function comparePlacement(old: CanvasFrame): { x: number; y: number; width: number; height: number; overlay: boolean } {
  const s = useStore.getState();
  const cmp = s.compare!;
  const current = s.doc?.frames.find((f) => f.frameName === old.frameName);
  const height = old.height ?? s.frameHeights[`cmp:${old.frameName}`] ?? 360;
  if (cmp.mode === "overlay" && current) return { x: current.x, y: current.y, width: old.width, height, overlay: true };
  return { x: old.x + beforeOffset(), y: old.y, width: old.width, height, overlay: false };
}

/** The older version's frames, rendered by the app from a snapshot of that version. */
export function CompareFrames() {
  const compare = useStore((s) => s.compare);
  useStore((s) => s.frameHeights);
  useStore((s) => s.doc);
  if (!compare) return null;
  return (
    <>
      {compare.doc.frames
        .filter((f) => compare.mode === "side" || compare.changes[f.frameName] !== "removed")
        .map((f) => (
          <CompareFrame key={`${compare.name}:${f.frameName}`} frame={f} />
        ))}
    </>
  );
}

const CompareFrame = memo(function CompareFrame({ frame }: { frame: CanvasFrame }) {
  const appUrl = useStore((s) => s.appUrl);
  const compare = useStore((s) => s.compare)!;
  const canvasTheme = useStore((s) => s.canvasTheme);
  const p = comparePlacement(frame);
  const theme = effectiveTheme(frame, canvasTheme);
  const src = useMemo(
    () => `${appUrl}/truecanvas/${encodeURIComponent(compare.name)}?frame=${encodeURIComponent(frame.frameName)}&theme=${theme}&editor=${encodeURIComponent(location.origin)}`,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [appUrl, compare.name, compare.ref, frame.frameName],
  );
  return (
    <div
      className={`frame-box compare${p.overlay ? " overlay" : ""}${compare.changes[frame.frameName] === "same" && !p.overlay ? " same" : ""}`}
      style={{ left: p.x, top: p.y, width: p.width, height: p.height, opacity: p.overlay ? compare.opacity : undefined }}
    >
      <iframe ref={(el) => registerFrame(`cmp:${frame.frameName}`, el)} title={`${frame.frameName} (${compare.label})`} src={src} style={{ pointerEvents: "none" }} />
    </div>
  );
});

export function CompareBar() {
  const compare = useStore((s) => s.compare);
  if (!compare) return null;
  const counts = Object.values(compare.changes).reduce<Record<string, number>>((acc, c) => ((acc[c] = (acc[c] ?? 0) + 1), acc), {});
  const summary = [counts.changed && `${counts.changed} changed`, counts.added && `${counts.added} new`, counts.removed && `${counts.removed} removed`].filter(Boolean).join(" · ") || "No frame changes";
  return (
    <div className="compare-bar" role="region" aria-label="Compare">
      <GitCompare size={14} />
      <span>
        Comparing with <strong>{compare.label}</strong>
      </span>
      <span className="faint">{summary}</span>
      <span className="sep" />
      <div style={{ width: 180 }}>
        <Segmented
          value={compare.mode}
          options={[
            { value: "side", label: "Side by side" },
            { value: "overlay", label: "Overlay" },
          ]}
          onChange={(mode) => useStore.setState({ compare: { ...compare, mode } })}
        />
      </div>
      {compare.mode === "overlay" && (
        <div style={{ width: 150 }}>
          <SliderField value={Math.round(compare.opacity * 100)} min={0} max={100} onCommit={(v) => useStore.setState({ compare: { ...compare, opacity: v / 100 } })} ariaLabel="Overlay opacity" />
        </div>
      )}
      <button className="icon-btn" aria-label="Stop comparing" onClick={() => void stopCompare()}>
        <X size={14} />
      </button>
    </div>
  );
}

/** Badge for a current frame's label while comparing. */
export function changeBadge(frameName: string): { text: string; tone: string } | null {
  const c = useStore.getState().compare?.changes[frameName];
  if (c === "changed") return { text: "Changed", tone: "changed" };
  if (c === "added") return { text: "New", tone: "added" };
  return null;
}

