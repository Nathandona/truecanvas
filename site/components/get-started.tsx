import { CommandPill } from "@/components/command-pill";
import { MeshGradient } from "@paper-design/shaders-react";
import { IsoMark } from "@/components/iso-mark";
import { Reveal } from "@/components/motion/reveal";

export function GetStarted() {
  return (
    <section id="start" className="px-6 pb-28">
      <Reveal effect="scale-in" duration={0.8}>
      <div className="relative isolate mx-auto flex max-w-6xl flex-col items-center gap-6 overflow-hidden rounded-3xl bg-ink [clip-path:inset(0_round_1.5rem)] px-6 pt-10 pb-20 text-center text-white">
        <MeshGradient
          className="pointer-events-none absolute inset-0 -z-10 h-full w-full rounded-[inherit] opacity-80"
          colors={["#1c1917", "#7c2d12", "#f2774a", "#2e1065"]}
          distortion={0.9}
          swirl={0.55}
          speed={0.3}
          grainOverlay={0.12}
        />
        <div className="-mb-4 w-80">
          <IsoMark />
        </div>
        <h2 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
          Built by you, or your agents
        </h2>
        <p className="max-w-xl text-[17px] leading-relaxed text-white/70">
          Open source and MIT licensed. Runs on your machine next to your app, with nothing to sign
          up for.
        </p>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
          <CommandPill command="npx truecanvas" tone="dark" />
          <a
            href="https://github.com/Nathandona/truecanvas"
            className="press inline-flex h-11 items-center rounded-full bg-white px-5 text-[14px] font-medium text-ink"
          >
            Star on GitHub
          </a>
        </div>
        <p className="font-mono text-[13px] text-white/50">New app? npm create truecanvas</p>
      </div>
      </Reveal>
    </section>
  );
}
