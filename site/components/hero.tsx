import { CommandPill } from "@/components/command-pill";
import { WindowFrame } from "@/components/window-frame";
import type { CSSProperties } from "react";

const d = (ms: number) => ({ "--d": `${ms}ms` }) as CSSProperties;

/* Words that rise in one after another. Plain CSS, so the entrance starts on
   the first paint instead of waiting for JavaScript. */
function Words({ text, from }: { text: string; from: number }) {
  return text.split(" ").map((word, i) => (
    <span key={i}>
      {i > 0 && " "}
      <span className="tc-word inline-block" style={d((from + i) * 45)}>
        {word}
      </span>
    </span>
  ));
}

export function Hero() {
  return (
    <section className="relative isolate overflow-hidden px-6 pt-24 pb-16">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(#d8d0c4_1px,transparent_1px)] [background-size:22px_22px] [mask-image:radial-gradient(ellipse_70%_60%_at_50%_35%,black_30%,transparent_80%)]"
      ></div>
      <div
        aria-hidden
        className="pointer-events-none absolute top-[52%] left-1/2 -z-10 h-[460px] w-[980px] -translate-x-1/2 rounded-full bg-coral/20 blur-[120px]"
      ></div>
      <div className="mx-auto flex max-w-4xl flex-col items-center text-center">
        <div className="tc-in" style={d(0)}>
          <a
            href="https://github.com/Nathandona/truecanvas"
            className="group mb-10 inline-flex items-center gap-2 text-[14px] text-muted transition-colors duration-150 hover:text-ink"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2.2c-3.3.7-4-1.4-4-1.4-.6-1.4-1.4-1.8-1.4-1.8-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 0-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.5-6 0-1.2.5-2.3 1.3-3.1-.2-.4-.6-1.6 0-3.2 0 0 1-.3 3.4 1.2a11.5 11.5 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.6 1.6.2 2.8.1 3.2.8.8 1.3 1.9 1.3 3.2 0 4.6-2.8 5.6-5.5 5.9.5.4.9 1.1.9 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .3" />
            </svg>
            Free and open source, MIT licensed
            <span aria-hidden className="transition-transform duration-200 group-hover:translate-x-0.5">→</span>
          </a>
        </div>
        <h1 className="text-6xl font-semibold tracking-[-0.035em] text-balance sm:text-7xl">
          <Words text="Design with your" from={0} />{" "}
          <span className="relative sm:whitespace-nowrap">
            <Words text="real components" from={3} />
              {/* the headline, selected on the canvas the way the editor draws it */}
              <span aria-hidden className="tc-select pointer-events-none absolute -inset-x-3 top-[0.1em] bottom-[0.06em] hidden border-[1.5px] border-[#0d99ff] sm:block">
                <span className="absolute -top-[5px] -left-[5px] size-2 border-[1.5px] border-[#0d99ff] bg-white" />
                <span className="absolute -top-[5px] -right-[5px] size-2 border-[1.5px] border-[#0d99ff] bg-white" />
                <span className="absolute -bottom-[5px] -left-[5px] size-2 border-[1.5px] border-[#0d99ff] bg-white" />
                <span className="absolute -right-[5px] -bottom-[5px] size-2 border-[1.5px] border-[#0d99ff] bg-white" />
                <span className="absolute -top-7 -left-[1.5px] rounded-[3px] bg-[#0d99ff] px-1.5 py-0.5 font-mono text-[12px] leading-none font-medium tracking-normal text-white">h1</span>
              </span>
          </span>
        </h1>
        <div className="flex flex-col items-center">
        <p style={d(200)} className="tc-in mt-6 max-w-2xl text-xl leading-relaxed text-muted text-pretty">
          A Figma-like canvas for your React app. Every layer is your code, your agent edits it
          through MCP, and every change ships as a pull request.
        </p>
        <div style={d(260)} className="tc-in mt-10 flex flex-wrap items-center justify-center gap-3">
          <CommandPill command="npx truecanvas" />
          <a
            href="https://github.com/Nathandona/truecanvas"
            className="press inline-flex h-11 items-center rounded-full bg-ink px-5 text-[14px] font-medium text-white"
          >
            Star on GitHub
          </a>
        </div>
        </div>
      </div>
      <div style={d(320)} className="tc-in tc-in-slow relative mx-auto mt-16 max-w-6xl">
        <div className="mb-2 flex items-center gap-2 text-[12.5px] text-muted">
          <span>Home</span>
          <span className="rounded-full bg-coral/15 px-2 py-0.5 text-[11.5px] font-medium text-coral-ink">
            ● Live · page.tsx
          </span>
        </div>
        <WindowFrame title="Truecanvas · playground">
          <img
            src="/editor.png"
            alt="The Truecanvas editor with a SessionRow component selected and its typed props in the design panel"
            className="block w-full"
          />
        </WindowFrame>
        <div
          aria-hidden
          className="tc-float absolute -right-6 bottom-24 hidden items-start gap-1 md:flex"
        >
          <svg width="20" height="20" viewBox="0 0 16 16">
            <path d="M2 1l11 6-5 1.5L6 14z" fill="#7c3aed" stroke="white" strokeWidth="1.2" />
          </svg>
          <span className="mt-4 rounded-full bg-[#7c3aed] px-2.5 py-1 text-[12px] font-medium text-white shadow-lg">
            Claude · Restyling SessionRow
          </span>
        </div>
        <div
          aria-hidden
          className="absolute top-36 -left-8 hidden max-w-60 items-start gap-2 md:flex"
        >
          <span className="grid size-8 shrink-0 place-items-center rounded-full rounded-bl-sm bg-ink text-[13px] font-semibold text-white shadow-lg">
            N
          </span>
          <span className="rounded-xl bg-white px-3 py-2 text-[12.5px] leading-snug text-ink-2 shadow-lg ring-1 ring-line">
            Can we try the dark theme on the settings card?
          </span>
        </div>
      </div>
    </section>
  );
}
