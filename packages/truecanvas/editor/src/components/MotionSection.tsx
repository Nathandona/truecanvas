import { useState } from "react";
import { Play, RotateCcw, Sparkles, X } from "lucide-react";
import { useStore } from "../lib/store";
import type { CanvasNode, Literal, PropValue } from "../lib/api";
import { playFrame, replayFrame } from "../lib/actions";
import { Section, Select, SliderField, Switch, Tip } from "./controls";

const REVEAL_EFFECTS = [
  { value: "fade-up", label: "Fade up" },
  { value: "fade-down", label: "Fade down" },
  { value: "fade-in", label: "Fade in" },
  { value: "blur-in", label: "Blur in" },
  { value: "scale-in", label: "Scale in" },
  { value: "slide-left", label: "Slide from right" },
  { value: "slide-right", label: "Slide from left" },
];

const TEXT_EFFECTS = [
  { value: "words", label: "Word by word" },
  { value: "letters", label: "Letter by letter" },
  { value: "blur-in", label: "Blur in" },
  { value: "slide-up", label: "Slide up" },
  { value: "typewriter", label: "Typewriter" },
];

const solid = (n: CanvasNode) => n.children.filter((c) => !(c.kind === "text" && !c.text?.trim()));
const hasText = (n: CanvasNode): boolean => n.kind === "text" || n.children.some(hasText);

function num(v: PropValue | undefined, fallback: number) {
  return v?.kind === "number" ? v.value : fallback;
}
function str(v: PropValue | undefined, fallback: string) {
  return v?.kind === "string" ? v.value : fallback;
}

/** Scroll reveal and text animation for a layer: wraps it in the project's <Reveal> / <TextAnimate>. */
export function MotionSection({ node }: { node: CanvasNode }) {
  const entry = useStore((s) => s.index.get(node.id));
  const canvas = useStore((s) => s.canvas)!;
  const run = useStore((s) => s.run);
  const [revealEffect, setRevealEffect] = useState("fade-up");
  const [textEffect, setTextEffect] = useState("words");
  if (!entry || entry.node.id === entry.frame.id || entry.frame.link?.editable === false) return null;
  const parent = entry.parent;
  const frameName = entry.frame.frameName;

  const reveal = node.name === "Reveal" ? node : parent?.name === "Reveal" && solid(parent).length === 1 ? parent : null;
  const kids = solid(node);
  const text = node.name === "TextAnimate" ? node : kids.length === 1 && kids[0].name === "TextAnimate" ? kids[0] : parent?.name === "TextAnimate" ? parent : null;
  const canText = !!text || hasText(node);

  // changes show after Fast Refresh; replay so the new animation is visible
  const after = (p: Promise<unknown>) => void p.then(() => setTimeout(() => replayFrame(frameName), 700));
  const setProp = (wrapper: CanvasNode, key: string, value: Literal) => after(run({ op: "set_props", canvas, id: wrapper.id, props: { [key]: value } }, { select: false }));
  const add = (kind: "reveal" | "text", effect: string) => after(run({ op: "add_animation", canvas, id: node.id, kind, effect }));
  const remove = (kind: "reveal" | "text") => void run({ op: "remove_animation", canvas, id: node.id, kind });

  return (
    <Section
      title={
        <span className="node-head">
          <Sparkles size={14} className="faint" /> Motion
        </span>
      }
      actions={
        <>
          <Tip label="Replay animations">
            <button className="icon-btn sm" aria-label="Replay animations" onClick={() => replayFrame(frameName)}>
              <RotateCcw size={13} />
            </button>
          </Tip>
          <Tip label="Play: scroll inside the frame">
            <button className="icon-btn sm" aria-label="Play frame" onClick={() => playFrame(frameName)}>
              <Play size={13} />
            </button>
          </Tip>
        </>
      }
    >
      <div className="motion-block">
        <div className="motion-head">
          <span>Reveal on scroll</span>
          {reveal && (
            <Tip label="Remove reveal">
              <button className="icon-btn sm" aria-label="Remove reveal" onClick={() => remove("reveal")}>
                <X size={13} />
              </button>
            </Tip>
          )}
        </div>
        {reveal ? (
          <>
            <Select value={str(reveal.props.effect, "fade-up")} options={REVEAL_EFFECTS} onChange={(v) => setProp(reveal, "effect", v)} ariaLabel="Reveal effect" />
            <label className="motion-row">
              <span>Delay</span>
              <SliderField value={num(reveal.props.delay, 0)} min={0} max={2} onCommit={(v) => setProp(reveal, "delay", v)} ariaLabel="Reveal delay" />
            </label>
            <label className="motion-row">
              <span>Duration</span>
              <SliderField value={num(reveal.props.duration, 0.6)} min={0.1} max={2} onCommit={(v) => setProp(reveal, "duration", v)} ariaLabel="Reveal duration" />
            </label>
            <div className="motion-row">
              <span>Only once</span>
              <Switch on={reveal.props.once?.kind !== "boolean" || reveal.props.once.value} onChange={(v) => setProp(reveal, "once", v ? null : false)} ariaLabel="Reveal only once" />
            </div>
          </>
        ) : (
          <div className="grid2" style={{ gridTemplateColumns: "1fr auto" }}>
            <Select value={revealEffect} options={REVEAL_EFFECTS} onChange={setRevealEffect} ariaLabel="Reveal effect" />
            <button className="btn primary" onClick={() => add("reveal", revealEffect)}>
              Add
            </button>
          </div>
        )}
      </div>

      {canText && (
        <div className="motion-block">
          <div className="motion-head">
            <span>Text animation</span>
            {text && (
              <Tip label="Remove text animation">
                <button className="icon-btn sm" aria-label="Remove text animation" onClick={() => remove("text")}>
                  <X size={13} />
                </button>
              </Tip>
            )}
          </div>
          {text ? (
            <>
              <Select value={str(text.props.effect, "words")} options={TEXT_EFFECTS} onChange={(v) => setProp(text, "effect", v)} ariaLabel="Text effect" />
              <label className="motion-row">
                <span>Stagger</span>
                <SliderField value={num(text.props.stagger, 0.06)} min={0} max={0.3} onCommit={(v) => setProp(text, "stagger", v)} ariaLabel="Text stagger" />
              </label>
              <label className="motion-row">
                <span>Delay</span>
                <SliderField value={num(text.props.delay, 0)} min={0} max={2} onCommit={(v) => setProp(text, "delay", v)} ariaLabel="Text delay" />
              </label>
            </>
          ) : (
            <div className="grid2" style={{ gridTemplateColumns: "1fr auto" }}>
              <Select value={textEffect} options={TEXT_EFFECTS} onChange={setTextEffect} ariaLabel="Text effect" />
              <button className="btn primary" onClick={() => add("text", textEffect)}>
                Add
              </button>
            </div>
          )}
        </div>
      )}
      {!canText && node.kind === "component" && node.name !== "Reveal" && (
        <p className="faint" style={{ margin: "8px 0 0" }}>
          Text inside {`<${node.name} />`} lives in its own file; animate text where it's written.
        </p>
      )}
    </Section>
  );
}
