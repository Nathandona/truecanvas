import type { ReactNode } from "react";
import { Reveal } from "@/components/motion/reveal";
import { CommandPill } from "@/components/command-pill";

/*
 * A timeline with one real artifact per step: the setup output the CLI
 * prints, this site's own homepage on the canvas, and the Git panel's commit
 * box. No illustrations.
 */

function Entry({ icon, lead, children, last }: { icon: ReactNode; lead: ReactNode; children?: ReactNode; last?: boolean }) {
  return (
    <li className="relative grid grid-cols-[2.25rem_1fr] gap-x-5">
      {!last && <span className="tc-draw absolute top-10 bottom-0 left-[1.125rem] w-px -translate-x-1/2 bg-line" aria-hidden />}
      <span className="relative z-10 flex size-9 items-center justify-center rounded-full bg-paper text-ink-2 ring-1 ring-line">{icon}</span>
      <Reveal stagger={0.1} className={`flex min-w-0 flex-col gap-5 ${last ? "" : "pb-16"}`}>
        <p className="pt-1.5 text-[17px] leading-relaxed text-muted text-pretty">{lead}</p>
        <div>{children}</div>
      </Reveal>
    </li>
  );
}

const Icon = ({ d }: { d: string }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

export function HowItWorks() {
  return (
    <section id="how" className="border-t border-line/70 bg-white/40 px-6 py-28">
      <div className="mx-auto grid max-w-6xl gap-14 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.6fr)]">
        <Reveal stagger={0.08} className="flex flex-col gap-5 md:sticky md:top-28 md:self-start">
          <h2 className="text-4xl font-semibold tracking-tight text-balance">Running in your app in about a minute.</h2>
          <p className="text-[15px] leading-relaxed text-muted">
            Works in Next.js (App Router) and Vite + React apps with Tailwind, on macOS, Linux and Windows, with Node 22 or newer. Production builds are untouched.
          </p>
          <div className="flex flex-col items-start gap-3 pt-2">
            <CommandPill command="npx truecanvas" />
            <a href="https://github.com/Nathandona/truecanvas#quick-start" className="group inline-flex items-center gap-1.5 text-[14px] font-medium text-ink-2 hover:text-ink">
              Read the quick start <span aria-hidden className="transition-transform duration-200 group-hover:translate-x-0.5">→</span>
            </a>
          </div>
        </Reveal>
        <ol className="flex flex-col">
          <Entry
            icon={<Icon d="M4 17l6-5-6-5M12 19h8" />}
            lead={
              <>
                <strong className="font-semibold text-ink">Run it from your project root.</strong> It asks once, then adds a dev dependency, enables
                its plugin in next.config or vite.config and writes a canvas with your homepage on it.
              </>
            }
          >
            <div className="overflow-hidden rounded-xl bg-ink font-mono text-[12.5px] leading-[1.7] text-white/80 ring-1 ring-ink">
              <div className="flex items-center justify-between border-b border-white/10 px-4 py-2 text-[11.5px] text-white/40">
                <span>~/acme-web</span>
                <span>zsh</span>
              </div>
              <pre className="overflow-x-auto px-4 py-3.5">
                <span className="text-white/40">$ </span>
                <span className="text-white">npx truecanvas</span>
                {"\n\n  "}
                <span className="text-coral">◆</span> <span className="font-semibold text-white">Truecanvas</span> <span className="text-white/40">v0.2.0</span>
                {"\n\n"}
                {"  This adds Truecanvas to "}
                <span className="font-semibold text-white">acme-web</span>
                {": a dev dependency, a plugin in next.config,\n  a "}
                <span className="font-semibold text-white">canvas</span>
                {" script and a canvas with your homepage.\n\n"}
                {[
                  "Wrapped next.config.ts with withTruecanvas()",
                  'Added the "canvas" script (npm run canvas)',
                  "Ignored /app/truecanvas/ in .gitignore",
                  "Canvas folder canvas",
                  "Truecanvas added to .mcp.json",
                ].map((line) => (
                  <span key={line}>
                    {"  "}
                    <span className="text-[#86efac]">✓</span> {line}
                    {"\n"}
                  </span>
                ))}
              </pre>
            </div>
          </Entry>
          <Entry
            icon={<Icon d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z" />}
            lead={
              <>
                <strong className="font-semibold text-ink">Your page is already on the canvas.</strong> Linked frames render the real route, desktop and
                phone side by side. Edits go straight to page.tsx and the components it uses.
              </>
            }
          >
            <figure className="flex flex-col gap-2.5">
              <div className="overflow-hidden rounded-xl bg-white ring-1 ring-line shadow-[0_24px_60px_-28px_rgb(28_25_23/0.35)]">
                <img
                  src="/canvas-home.webp"
                  alt="The Truecanvas editor showing this website's homepage as two linked frames, desktop and iPhone 16"
                  width={1440}
                  height={900}
                  className="block w-full"
                />
              </div>
              <figcaption className="font-mono text-[12px] text-muted">This page, open in Truecanvas.</figcaption>
            </figure>
          </Entry>
          <Entry
            last
            icon={<Icon d="M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a9 9 0 0 1-9 9" />}
            lead={
              <>
                <strong className="font-semibold text-ink">Commit from the Git panel.</strong> Every change is listed by frame in plain words, and it
                suggests a branch so nothing lands on main by accident.
              </>
            }
          >
            <div className="w-full max-w-md overflow-hidden rounded-xl bg-white text-[13px] ring-1 ring-line">
              <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
                <span className="font-medium">Home</span>
                <span className="rounded-full bg-paper-2 px-2 py-0.5 font-mono text-[11.5px] text-muted">design/home-hero</span>
              </div>
              <ul className="flex flex-col gap-1.5 px-4 py-3 text-ink-2">
                <li>Changed h1 text to “Design with your real components”</li>
                <li>
                  Restyled h1 <span className="font-mono text-[12px] text-muted">(+text-6xl +tracking-tight -text-5xl)</span>
                </li>
                <li>
                  Added a fade-up reveal to Features <span className="text-muted italic">(claude)</span>
                </li>
              </ul>
              <div className="flex items-center justify-between gap-3 border-t border-line bg-paper/60 px-4 py-2.5">
                <span className="truncate text-muted">Home: restyle the hero, add a reveal</span>
                <span className="shrink-0 rounded-md bg-ink px-2.5 py-1 text-[12px] font-medium text-white">Commit design changes</span>
              </div>
            </div>
          </Entry>
        </ol>
      </div>
    </section>
  );
}
