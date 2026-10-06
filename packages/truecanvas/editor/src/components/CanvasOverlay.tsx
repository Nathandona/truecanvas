/* What's drawn over the frames: labels, hover and selection boxes, handles, inline text editing. */
import { useEffect, useRef, useState } from "react";
import { Component, Play, RotateCcw, Square as StopIcon, Eye, FlaskConical, Moon, Sun } from "lucide-react";
import { useStore, layerName, type Rect } from "../lib/store";
import { frameHeight, playFrame, replayFrame } from "../lib/actions";
import { findDevice, type CanvasFrame } from "../lib/api";
import { AgentCursors } from "./AgentCursors";
import { changeBadge, comparePlacement } from "./Compare";
import { CommentLayer } from "./Comments";

import { fileName, type Drag, type Override } from "./canvasShared";

export function textTarget(node: import("../lib/api").CanvasNode): { kind: "text"; value: string } | { kind: "prop"; prop: string; value: string } | null {
  if (node.kind === "text") return { kind: "text", value: node.text ?? "" };
  if (node.kind !== "component" && node.kind !== "element") return null;
  if (node.children.length && node.children.every((c) => c.kind === "text")) return { kind: "text", value: node.children.map((c) => c.text).join(" ") };
  for (const prop of ["title", "label", "text", "name", "placeholder"]) {
    const v = node.props[prop];
    if (v?.kind === "string") return { kind: "prop", prop, value: v.value };
  }
  return null;
}

export function Overlay({
  framePos,
  drag,
  drop,
  onResizeStart,
  onLabelDown,
}: {
  framePos: (f: CanvasFrame) => Override;
  drag: Drag | null;
  drop: { frame: string; rect: Rect; label: string } | null;
  onResizeStart: (f: CanvasFrame, edge: "e" | "s" | "se" | "w", e: React.PointerEvent) => void;
  onLabelDown: (f: CanvasFrame, e: React.PointerEvent) => void;
}) {
  const doc = useStore((s) => s.doc);
  const camera = useStore((s) => s.camera);
  const selection = useStore((s) => s.selection);
  const hover = useStore((s) => s.hover);
  const rects = useStore((s) => s.rects);
  const index = useStore((s) => s.index);
  const tool = useStore((s) => s.tool);
  const review = useStore((s) => s.review);
  const flashes = useStore((s) => s.flashes);
  const editingText = useStore((s) => s.editingText);
  const compare = useStore((s) => s.compare);
  useStore((s) => s.frameHeights);
  const z = camera.zoom;

  const toScreen = (f: CanvasFrame, r: Rect) => {
    const p = framePos(f);
    return { left: camera.x + (p.x + r.x) * z, top: camera.y + (p.y + r.y) * z, width: r.width * z, height: r.height * z };
  };
  const frameScreen = (f: CanvasFrame) => {
    const p = framePos(f);
    const h = p.height ?? frameHeight(f);
    return { left: camera.x + p.x * z, top: camera.y + p.y * z, width: p.width * z, height: h * z };
  };

  if (!doc) return null;
  const showBoxes = tool !== "interact";
  const dirty = new Set(review.find((p) => p.canvas === doc.name)?.frames.filter((fr) => fr.status !== "removed").map((fr) => fr.name) ?? []);
  const hoverEntry = hover ? index.get(hover) : null;

  return (
    <div className="overlay">
      {doc.frames.map((f) => {
        const b = frameScreen(f);
        const selected = selection.includes(f.id);
        return (
          <div key={f.id} className={`frame-label${selected ? " selected" : ""}`} style={{ left: b.left, top: b.top - 20, maxWidth: Math.max(40, b.width) }} onPointerDown={(e) => onLabelDown(f, e)}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{f.frameName}</span>
            {f.theme && <span className="theme-tag">{f.theme === "dark" ? <Moon size={11} /> : <Sun size={11} />}</span>}
            {f.device && <span className="theme-tag">{findDevice(f.device)?.name}</span>}
            {dirty.has(f.frameName) && <span className="change-dot" title="Changed since the last commit" />}
            <LinkTag frame={f} compact={b.width < 220} />
            <PlayControls frame={f} compact={b.width < 260} />
            {(() => {
              const b = changeBadge(f.frameName);
              return b && <span className={`change-badge ${b.tone}`}>{b.text}</span>;
            })()}
          </div>
        );
      })}
      {compare &&
        compare.doc.frames
          .filter(() => compare.mode === "side")
          .map((f) => {
            const p = comparePlacement(f);
            return (
              <div key={`cmp-${f.frameName}`} className="frame-label compare-label" style={{ left: camera.x + p.x * z, top: camera.y + p.y * z - 20, maxWidth: Math.max(40, p.width * z) }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{f.frameName}</span>
                <span className={`change-badge ${compare.changes[f.frameName] === "removed" ? "removed" : "before"}`}>{compare.changes[f.frameName] === "removed" ? `Removed · ${compare.label}` : compare.changes[f.frameName] === "same" ? `${compare.label} · same` : compare.label}</span>
              </div>
            );
          })}

      {showBoxes && hoverEntry && !selection.includes(hoverEntry.node.id) && (() => {
        if (hoverEntry.node.id === hoverEntry.frame.id) {
          const b = frameScreen(hoverEntry.frame);
          return <div className="box hover" style={b} />;
        }
        const r = rects[hoverEntry.node.id];
        if (!r) return null;
        return <div className={`box hover`} style={toScreen(hoverEntry.frame, r)} />;
      })()}

      {showBoxes &&
        selection.map((id) => {
          const e = index.get(id);
          if (!e) return null;
          if (e.node.id === e.frame.id) {
            const b = frameScreen(e.frame);
            const p = framePos(e.frame);
            return (
              <div key={id} className="box frame-select" style={b}>
                {selection.length === 1 && (
                  <>
                    <div className="edge" style={{ right: -4, top: 0, bottom: 0, width: 8, cursor: "ew-resize" }} onPointerDown={(ev) => resizeDown(ev, e.frame, "e")} />
                    <div className="edge" style={{ left: -4, top: 0, bottom: 0, width: 8, cursor: "ew-resize" }} onPointerDown={(ev) => resizeDown(ev, e.frame, "w")} />
                    <div className="edge" style={{ bottom: -4, left: 0, right: 0, height: 8, cursor: "ns-resize" }} onPointerDown={(ev) => resizeDown(ev, e.frame, "s")} />
                    <div className="handle" style={{ right: -5, bottom: -5, cursor: "nwse-resize" }} onPointerDown={(ev) => resizeDown(ev, e.frame, "se")} />
                    <div className="handle" style={{ right: -5, top: -5 }} />
                    <div className="handle" style={{ left: -5, bottom: -5 }} />
                    <div className="handle" style={{ left: -5, top: -5 }} />
                    <div className="size-badge" style={{ left: "50%", top: b.height + 8 }}>
                      {Math.round(p.width)} × {Math.round(p.height ?? frameHeight(e.frame))}
                      {p.height === null ? " Hug" : ""}
                    </div>
                  </>
                )}
              </div>
            );
          }
          const r = rects[id];
          if (!r) return null;
          const b = toScreen(e.frame, r);
          const comp = e.node.kind === "component";
          return (
            <div key={id} className={`box select${comp ? " component" : ""}`} style={b}>
              {selection.length === 1 && editingText !== id && (
                <>
                  <div className={`name-tag${comp ? " component" : ""}`} style={{ left: -0.75, top: -1 }}>
                    {layerName(e.node)}
                  </div>
                  <div className={`size-badge${comp ? " component" : ""}`} style={{ left: "50%", top: b.height + 6 }}>
                    {Math.round(r.width)} × {Math.round(r.height)}
                  </div>
                </>
              )}
            </div>
          );
        })}

      {flashes.map((fl) => {
        const e = index.get(fl.id);
        const r = e && (e.node.id === e.frame.id ? { x: 0, y: 0, width: e.frame.width, height: frameHeight(e.frame) } : rects[fl.id]);
        if (!e || !r) return null;
        const b = toScreen(e.frame, r);
        return <div key={fl.key} className="box flash" style={{ ...b, ["--c" as string]: fl.color }} />;
      })}

      {drop && (() => {
        const f = doc.frames.find((x) => x.frameName === drop.frame);
        if (!f) return null;
        return <div className="drop-target" style={toScreen(f, drop.rect)} />;
      })()}

      {drag?.kind === "node-drag" && drag.target && <div className="drop-line" style={toScreen(drag.frame, drag.target.line)} />}

      {(drag?.kind === "draw" || drag?.kind === "marquee") && (
        <div
          className="marquee"
          style={{
            left: camera.x + Math.min(drag.startX, drag.x) * z,
            top: camera.y + Math.min(drag.startY, drag.y) * z,
            width: Math.abs(drag.x - drag.startX) * z,
            height: Math.abs(drag.y - drag.startY) * z,
          }}
        />
      )}

      {editingText && <InlineText id={editingText} toScreen={toScreen} />}

      <CommentLayer camera={camera} framePos={framePos} />
      <AgentCursors camera={camera} framePos={framePos} />
    </div>
  );

  function resizeDown(e: React.PointerEvent, f: CanvasFrame, edge: "e" | "s" | "se" | "w") {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    onResizeStart(f, edge, e);
  }
}

function InlineText({ id, toScreen }: { id: string; toScreen: (f: CanvasFrame, r: Rect) => { left: number; top: number; width: number; height: number } }) {
  const entry = useStore((s) => s.index.get(id));
  const rect = useStore((s) => s.rects[id]);
  const target = entry ? textTarget(entry.node) : null;
  const [value, setValue] = useState(target?.value ?? "");
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  if (!entry || !rect || !target) return null;
  const b = toScreen(entry.frame, rect);
  const close = () => useStore.setState({ editingText: null });
  const commit = async () => {
    close();
    if (value === target.value) return;
    const s = useStore.getState();
    if (target.kind === "text") await s.run({ op: "set_text", canvas: s.canvas!, id, text: value });
    else await s.run({ op: "set_props", canvas: s.canvas!, id, props: { [target.prop]: value } });
  };
  return (
    <div className="inline-edit" style={{ left: b.left - 4, top: b.top - 4, width: Math.max(220, b.width + 8) }} onPointerDown={(e) => e.stopPropagation()}>
      <textarea
        ref={ref}
        value={value}
        rows={Math.min(5, Math.max(1, Math.ceil(value.length / 40)))}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void commit();
          }
          if (e.key === "Escape") close();
        }}
      />
    </div>
  );
}


/** ▶ on a frame's label; while playing: Replay and Stop. */
function PlayControls({ frame: f, compact }: { frame: CanvasFrame; compact: boolean }) {
  const playing = useStore((s) => s.playing === f.frameName);
  const stop = (e: React.PointerEvent) => e.stopPropagation();
  if (!playing)
    return (
      <button className="label-btn play-btn" title="Play: scroll inside the frame to run scroll animations" aria-label={`Play ${f.frameName}`} onPointerDown={stop} onClick={() => playFrame(f.frameName)}>
        <Play size={10} />
      </button>
    );
  return (
    <span className="play-controls" onPointerDown={stop}>
      <span className="playing-tag">
        <span className="live-dot" />
        {compact ? "" : "Playing · scroll inside"}
      </span>
      <button className="label-btn" title="Replay entrance animations" aria-label="Replay" onClick={() => replayFrame(f.frameName)}>
        <RotateCcw size={10} />
      </button>
      <button className="label-btn" title="Stop (Esc)" aria-label="Stop playing" onClick={() => playFrame(null)}>
        <StopIcon size={9} fill="currentColor" />
      </button>
    </span>
  );
}

/** "Live · page.tsx" on linked frames, "Exploration" on copies of a page. */
function LinkTag({ frame: f, compact }: { frame: CanvasFrame; compact: boolean }) {
  if (f.link?.kind === "component") {
    return (
      <span className={`link-tag component${f.link.editable ? "" : " view"}`} title={f.link.editable ? `Main component ${f.link.route} in ${f.link.page}. Edits change every instance.` : (f.link.reason ?? "")}>
        <Component size={10} />
        {!compact && `Main component · ${fileName(f.link.page)}`}
      </span>
    );
  }
  if (f.link) {
    const tip = f.link.editable ? `Linked to ${f.link.files.join(" and ")}. Editing its layers edits the code.` : `View only: ${f.link.reason ?? ""}`;
    return (
      <span className={`link-tag${f.link.editable ? "" : " view"}${compact ? " compact" : ""}`} title={tip}>
        {f.link.editable ? <span className="live-dot" /> : <Eye size={10} />}
        {!compact && `${f.link.editable ? "Live" : "View only"} · ${fileName(f.link.page)}`}
      </span>
    );
  }
  if (f.from)
    return (
      <span className={`link-tag draft${compact ? " compact" : ""}`} title={`Copy of ${f.from}. Right-click → Apply to page to write it back.`}>
        <FlaskConical size={10} />
        {!compact && "Exploration"}
      </span>
    );
  return null;
}

/** The right-click menu for the selection: on the canvas and in the Layers panel (which adds `extra` on top). */
