import fs from "node:fs";
import path from "node:path";
import type { TruecanvasConfig } from "./config.js";

/*
 * Motion components Truecanvas adds to a project the first time an animation
 * is applied. They become the project's own code: plain React and CSS
 * transitions, no dependencies, editable like any other component.
 */

const REVEAL = `"use client";

import { Children, cloneElement, isValidElement, useEffect, useRef, useState, type CSSProperties, type ReactElement, type ReactNode } from "react";

export type RevealEffect = "fade-up" | "fade-down" | "fade-in" | "blur-in" | "scale-in" | "slide-left" | "slide-right";

export interface RevealProps {
  /** How it enters */
  effect?: RevealEffect;
  /** Wait before it starts, in seconds (0 to 2) */
  delay?: number;
  /** Length of the animation, in seconds (0.1 to 2) */
  duration?: number;
  /** Animate each child one after another, this many seconds apart (0 to 0.3) */
  stagger?: number;
  /** Play only the first time it scrolls into view */
  once?: boolean;
  className?: string;
  children?: ReactNode;
}

// Short distances and a light blur: enough to read as motion, never a jump.
const HIDDEN: Record<RevealEffect, CSSProperties> = {
  "fade-up": { opacity: 0, transform: "translateY(16px)", filter: "blur(4px)" },
  "fade-down": { opacity: 0, transform: "translateY(-16px)", filter: "blur(4px)" },
  "fade-in": { opacity: 0 },
  "blur-in": { opacity: 0, filter: "blur(10px)" },
  "scale-in": { opacity: 0, transform: "scale(0.96)", filter: "blur(4px)" },
  "slide-left": { opacity: 0, transform: "translateX(24px)", filter: "blur(4px)" },
  "slide-right": { opacity: 0, transform: "translateX(-24px)", filter: "blur(4px)" },
};

const EASE_OUT = "cubic-bezier(0.23, 1, 0.32, 1)";

/** Animates its content in when it scrolls into view. Added by Truecanvas; it's your code now. */
export function Reveal({ effect = "fade-up", delay = 0, duration = 0.6, stagger = 0, once = true, className, children }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true);
          if (once) io.disconnect();
        } else if (!once) setShown(false);
      },
      { root: document, rootMargin: "0px 0px -48px 0px", threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [once]);

  const styleAt = (d: number): CSSProperties => {
    // Reduced motion keeps a short fade (it helps reading) and drops the movement.
    if (reduced) return { opacity: shown ? 1 : 0, transition: \`opacity 0.2s ease \${d}s\` };
    return {
      ...(shown ? { opacity: 1, transform: "none", filter: "none" } : HIDDEN[effect]),
      transition: \`opacity \${duration}s \${EASE_OUT} \${d}s, transform \${duration}s \${EASE_OUT} \${d}s, filter \${duration}s \${EASE_OUT} \${d}s\`,
    };
  };

  if (stagger > 0) {
    let i = 0;
    return (
      <div ref={ref} className={className}>
        {Children.map(children, (child) => {
          if (!isValidElement(child)) return child;
          const el = child as ReactElement<{ style?: CSSProperties }>;
          return cloneElement(el, { style: { ...el.props.style, ...styleAt(delay + i++ * stagger) } });
        })}
      </div>
    );
  }
  return (
    <div ref={ref} className={className} style={styleAt(delay)}>
      {children}
    </div>
  );
}
`;

const TEXT_ANIMATE = `"use client";

import { Children, cloneElement, isValidElement, use, useEffect, useRef, useState, type CSSProperties, type ReactElement, type ReactNode } from "react";

export type TextEffect = "words" | "letters" | "blur-in" | "slide-up" | "typewriter";

export interface TextAnimateProps {
  /** How the text appears */
  effect?: TextEffect;
  /** Time between words or letters, in seconds (0 to 0.3) */
  stagger?: number;
  /** Wait before it starts, in seconds (0 to 2) */
  delay?: number;
  /** Length of each word's or letter's animation, in seconds (0.1 to 1.5) */
  duration?: number;
  /** Play only the first time it scrolls into view */
  once?: boolean;
  className?: string;
  children?: ReactNode;
}

const FROM: Record<TextEffect, CSSProperties> = {
  words: { opacity: 0, transform: "translateY(0.25em)", filter: "blur(6px)" },
  letters: { opacity: 0, transform: "translateY(0.25em)", filter: "blur(4px)" },
  "blur-in": { opacity: 0, filter: "blur(8px)" },
  "slide-up": { transform: "translateY(110%)" },
  typewriter: { opacity: 0 },
};

const SR_ONLY: CSSProperties = { position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" };

// Elements a Server Component passes down can reach the client as lazy
// references (React 19). Resolve them so server and client split the same text.
const LAZY = Symbol.for("react.lazy");
function resolve(node: ReactNode): ReactNode {
  const lazy = node as { $$typeof?: symbol; _payload?: PromiseLike<ReactNode> } | null;
  return lazy && typeof lazy === "object" && lazy.$$typeof === LAZY && lazy._payload ? resolve(use(lazy._payload as Promise<ReactNode>)) : node;
}

function textOf(node: ReactNode): string {
  node = resolve(node);
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement(node)) {
    const props = node.props as { children?: ReactNode; "aria-hidden"?: unknown };
    return props["aria-hidden"] ? "" : textOf(props.children);
  }
  return "";
}

/**
 * Reveals text word by word or letter by letter when it scrolls into view.
 * Inline elements inside (like <em>) keep their styling. Added by Truecanvas;
 * it's your code now.
 */
export function TextAnimate({ effect = "words", stagger = 0.06, delay = 0, duration = 0.5, once = true, className, children }: TextAnimateProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true);
          if (once) io.disconnect();
        } else if (!once) setShown(false);
      },
      { root: document, rootMargin: "0px 0px -48px 0px", threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [once]);

  const byLetter = effect === "letters" || effect === "typewriter";
  const ease = "cubic-bezier(0.23, 1, 0.32, 1)";
  let i = 0;
  const piece = (content: ReactNode, key: string) => {
    const d = delay + i++ * stagger;
    const transition =
      effect === "typewriter" ? \`opacity 0.01s linear \${d}s\` : \`opacity \${duration}s \${ease} \${d}s, transform \${duration}s \${ease} \${d}s, filter \${duration}s \${ease} \${d}s\`;
    const style: CSSProperties = { display: "inline-block", whiteSpace: "pre", ...(shown ? { opacity: 1, transform: "none", filter: "none" } : FROM[effect]), transition };
    const span = (
      <span key={key} style={style}>
        {content}
      </span>
    );
    // slide-up: each word rises from behind its own line
    return effect === "slide-up" ? (
      <span key={key} style={{ display: "inline-block", overflow: "hidden", verticalAlign: "bottom" }}>
        {span}
      </span>
    ) : (
      span
    );
  };
  const split = (nodes: ReactNode, prefix: string): ReactNode[] => {
    const out: ReactNode[] = [];
    Children.toArray(nodes).forEach((raw, ci) => {
      const child = resolve(raw);
      const key = \`\${prefix}\${ci}\`;
      if (typeof child === "string" || typeof child === "number") {
        String(child)
          .split(/(\\s+)/)
          .forEach((part, pi) => {
            if (!part) return;
            if (/^\\s+$/.test(part)) return void out.push(" ");
            const k = \`\${key}-\${pi}\`;
            if (byLetter)
              out.push(
                <span key={k} style={{ display: "inline-block", whiteSpace: "nowrap" }}>
                  {Array.from(part).map((ch, li) => piece(ch, \`\${k}-\${li}\`))}
                </span>,
              );
            else out.push(piece(part, k));
          });
      } else if (isValidElement(child) && (child.props as { children?: ReactNode }).children != null && !(child.props as { "aria-hidden"?: unknown })["aria-hidden"]) {
        // <em>, <strong>, links…: keep the element, animate the text inside it
        const el = child as ReactElement<{ children?: ReactNode }>;
        out.push(cloneElement(el, { key }, split(el.props.children, \`\${key}.\`)));
      } else out.push(child);
    });
    return out;
  };

  return (
    <span ref={ref} className={className}>
      <span style={SR_ONLY}>{textOf(children)}</span>
      <span aria-hidden>{split(children, "")}</span>
    </span>
  );
}
`;

export interface MotionFiles {
  reveal: string;
  text: string;
}

/** Where the motion components live: `<components>/motion/`, next to the project's components. */
export function motionFiles(config: TruecanvasConfig): MotionFiles {
  const glob = config.components[0] ?? "components/**/*.tsx";
  const base = glob.split("/").filter((p) => !p.includes("*")).join("/") || "components";
  const dir = path.join(base, "motion");
  return { reveal: path.join(dir, "reveal.tsx"), text: path.join(dir, "text-animate.tsx") };
}

/** Writes the motion components if they aren't in the project yet. Returns the files and whether any was created. */
export function ensureMotionComponents(config: TruecanvasConfig): MotionFiles & { created: boolean } {
  const files = motionFiles(config);
  let created = false;
  for (const [rel, content] of [
    [files.reveal, REVEAL],
    [files.text, TEXT_ANIMATE],
  ] as const) {
    const abs = path.join(config.root, rel);
    if (fs.existsSync(abs)) continue;
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
    created = true;
  }
  return { ...files, created };
}
