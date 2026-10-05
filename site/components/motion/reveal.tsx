"use client";

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
    if (reduced) return { opacity: shown ? 1 : 0, transition: `opacity 0.2s ease ${d}s` };
    return {
      ...(shown ? { opacity: 1, transform: "none", filter: "none" } : HIDDEN[effect]),
      transition: `opacity ${duration}s ${EASE_OUT} ${d}s, transform ${duration}s ${EASE_OUT} ${d}s, filter ${duration}s ${EASE_OUT} ${d}s`,
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
