"use client";

import { useState, type CSSProperties } from "react";

const swap = (on: boolean): CSSProperties => ({
  opacity: on ? 1 : 0,
  transform: on ? "scale(1)" : "scale(0.6)",
  filter: on ? "blur(0)" : "blur(3px)",
  transition: "opacity 200ms var(--ease-out), transform 200ms var(--ease-out), filter 200ms var(--ease-out)",
});

/** A shell command with a copy button, like `$ npx truecanvas`. */
export function CommandPill({ command = "npx truecanvas", tone = "light" }: { command?: string; tone?: "light" | "dark" }) {
  const [copied, setCopied] = useState(false);
  const dark = tone === "dark";
  return (
    <button
      type="button"
      aria-label={copied ? "Copied" : `Copy “${command}”`}
      onClick={() => {
        void navigator.clipboard?.writeText(command);
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      }}
      className={`press group inline-flex h-11 items-center gap-3 rounded-full pr-3.5 pl-5 font-mono text-[14px] ${
        dark ? "bg-white/10 text-white ring-1 ring-white/15 hover:bg-white/15" : "bg-white text-ink ring-1 ring-line hover:ring-ink/20"
      }`}
    >
      <span className={dark ? "text-white/50" : "text-muted"}>$</span>
      <span>{command}</span>
      <span className={`grid size-7 place-items-center rounded-full transition-colors duration-150 ${dark ? "text-white/50 group-hover:text-white" : "text-muted group-hover:bg-paper-2 group-hover:text-ink"}`}>
        {/* copy and check crossfade in place; the blur hides the overlap */}
        <svg style={swap(!copied)} className="col-start-1 row-start-1" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="9" y="9" width="13" height="13" rx="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
        <svg style={swap(copied)} className="col-start-1 row-start-1 text-[#16a34a]" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </span>
    </button>
  );
}
