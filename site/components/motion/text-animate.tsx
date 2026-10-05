"use client";

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
      effect === "typewriter" ? `opacity 0.01s linear ${d}s` : `opacity ${duration}s ${ease} ${d}s, transform ${duration}s ${ease} ${d}s, filter ${duration}s ${ease} ${d}s`;
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
      const key = `${prefix}${ci}`;
      if (typeof child === "string" || typeof child === "number") {
        String(child)
          .split(/(\s+)/)
          .forEach((part, pi) => {
            if (!part) return;
            if (/^\s+$/.test(part)) return void out.push(" ");
            const k = `${key}-${pi}`;
            if (byLetter)
              out.push(
                <span key={k} style={{ display: "inline-block", whiteSpace: "nowrap" }}>
                  {Array.from(part).map((ch, li) => piece(ch, `${k}-${li}`))}
                </span>,
              );
            else out.push(piece(part, k));
          });
      } else if (isValidElement(child) && (child.props as { children?: ReactNode }).children != null && !(child.props as { "aria-hidden"?: unknown })["aria-hidden"]) {
        // <em>, <strong>, links…: keep the element, animate the text inside it
        const el = child as ReactElement<{ children?: ReactNode }>;
        out.push(cloneElement(el, { key }, split(el.props.children, `${key}.`)));
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
