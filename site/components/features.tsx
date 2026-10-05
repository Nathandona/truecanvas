import { FeatureCard } from "@/components/feature-card";
import { IsoPipeline } from "@/components/iso-pipeline";
import { MeshGradient } from "@paper-design/shaders-react";
import { TextAnimate } from "@/components/motion/text-animate";
import { Reveal } from "@/components/motion/reveal";

export function Features() {
  return (
    <section id="features" className="px-6 py-28">
      <div className="mx-auto flex max-w-6xl flex-col gap-14">
        <Reveal className="grid items-end gap-8 md:grid-cols-2" stagger={0.08}>
          <h2 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">A design tool where the design is the code</h2>
          <p className="text-[17px] leading-relaxed text-muted text-pretty md:pb-1.5">
            Design tools draw pictures of your product. Someone rebuilds them in code, and the two drift apart. Truecanvas skips the
            picture: you design with the components you ship.
          </p>
        </Reveal>
        <Reveal effect="fade-up" delay={0.1}>
          <div className="grid overflow-hidden rounded-2xl bg-white ring-1 ring-line md:grid-cols-2">
            <div className="flex flex-col gap-5 p-8">
              <span className="text-[13px] font-medium text-muted">The usual way</span>
              <IsoPipeline variant="old" />
              <p className="text-[15px] leading-relaxed text-muted">Two sources of truth. Every change is made twice, and they never quite match.</p>
            </div>
            <div className="flex flex-col gap-5 border-t border-line bg-coral/[0.07] p-8 md:border-t-0 md:border-l">
              <span className="text-[13px] font-medium text-coral-ink">With Truecanvas</span>
              <IsoPipeline variant="new" />
              <p className="text-[15px] leading-relaxed text-ink-2">One source of truth: your repo. What you design is what ships.</p>
            </div>
          </div>
        </Reveal>
        <Reveal className="grid gap-5 md:grid-cols-3" stagger={0.08}>
          <FeatureCard
            title="Layers are your components"
            description="Every layer is a real instance. Props become controls from their TypeScript types, so a status union is a dropdown."
            className="md:col-span-2"
          >
            <div className="flex w-full max-w-xl items-stretch gap-3">
              <div className="flex flex-1 flex-col gap-1 rounded-xl bg-white p-3 shadow-sm ring-1 ring-line">
                <span className="mb-1 px-2 text-[10.5px] text-muted">Sessions</span>
                <div className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[12px] ring-2 ring-[#7c3aed]">
                  <span className="size-2 rounded-full bg-coral"></span>
                  <span className="flex-1 truncate">Review release readiness</span>
                  <span className="text-muted">2m</span>
                </div>
                <div className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[12px]">
                  <span className="size-2 rounded-full bg-ink/20"></span>
                  <span className="flex-1 truncate">Draft the Q4 changelog</span>
                  <span className="text-muted">3h</span>
                </div>
                <div className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[12px]">
                  <span className="size-2 rounded-full bg-ink/20"></span>
                  <span className="flex-1 truncate">Migrate billing webhooks</span>
                  <span className="text-muted">5h</span>
                </div>
                <div className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[12px]">
                  <span className="size-2 rounded-full bg-ink/20"></span>
                  <span className="flex-1 truncate">Fix the flaky billing test</span>
                  <span className="text-muted">1d</span>
                </div>
              </div>
              <div className="hidden w-52 flex-col rounded-xl bg-white p-3 text-[12px] shadow-sm ring-1 ring-line sm:flex">
                <div className="mb-2 font-medium text-[#7c3aed]">SessionRow</div>
                <div className="flex items-center justify-between py-1">
                  <span className="text-muted">Status</span>
                  <span className="rounded-md bg-paper-2 px-2 py-0.5">Working ▾</span>
                </div>
                <div className="flex items-center justify-between py-1">
                  <span className="text-muted">Source</span>
                  <span className="rounded-md bg-paper-2 px-2 py-0.5">Web ▾</span>
                </div>
                <div className="flex items-center justify-between py-1">
                  <span className="text-muted">Elapsed</span>
                  <span className="rounded-md bg-paper-2 px-2 py-0.5">2m</span>
                </div>
                <div className="flex items-center justify-between py-1">
                  <span className="text-muted">Active</span>
                  <span className="h-4 w-7 rounded-full bg-coral"></span>
                </div>
              </div>
            </div>
          </FeatureCard>
          <FeatureCard
            title="The code is the document"
            description="Edits are small patches to your TSX that keep your formatting. Your editor and the canvas stay in sync both ways."
          >
            <div className="w-full max-w-72 overflow-hidden rounded-xl bg-ink font-mono text-[12px] leading-6 text-white/80 ring-1 ring-ink">
              <div className="border-b border-white/10 px-4 py-2 text-white/50">app/page.tsx</div>
              <div className="bg-[#7f1d1d]/40 px-4">- &lt;h1 className="text-4xl"&gt;</div>
              <div className="bg-[#14532d]/50 px-4">+ &lt;h1 className="text-6xl"&gt;</div>
              <div className="px-4 pb-2"> Design with your</div>
            </div>
          </FeatureCard>
          <FeatureCard
            title="Design on your real pages"
            description="Link a page and its layers are your page.tsx. Explore a copy for bold ideas, then apply it back as a clean diff."
          >
            <div className="flex w-full max-w-72 flex-col gap-2">
              <div className="flex items-center gap-2 text-[12px]">
                <span className="text-muted">Home</span>
                <span className="rounded-full bg-coral/15 px-2 py-0.5 font-medium text-coral-ink">● Live · page.tsx</span>
              </div>
              <div className="flex flex-col gap-1.5 rounded-lg bg-white p-4 ring-1 ring-line">
                <span className="text-[10px] font-semibold">Acme</span>
                <span className="mt-1.5 text-[15px] leading-tight font-semibold tracking-tight">Invoices that pay themselves</span>
                <span className="text-[10.5px] leading-snug text-muted">Send, chase and reconcile in one place.</span>
                <span className="mt-2 self-start rounded-full bg-coral px-2.5 py-1 text-[10px] font-medium text-white">Start free</span>
              </div>
              <div className="flex items-center gap-1.5 text-[11.5px] text-muted">
                <span className="rounded-md bg-white px-2 py-0.5 ring-1 ring-line">Explore a copy</span>
                <span aria-hidden>→</span>
                <span className="rounded-md bg-white px-2 py-0.5 ring-1 ring-line">Apply to page</span>
              </div>
            </div>
          </FeatureCard>
          <FeatureCard
            title="Motion and shaders"
            description="Scroll reveals, text animations and Paper shaders are components in your repo. Press play on a frame to watch them run."
            className="md:col-span-2"
          >
            <div className="flex w-full max-w-xl flex-col gap-2">
              <div className="flex items-center gap-2 text-[12px]">
                <span className="text-muted">Launch</span>
                <span className="inline-flex items-center gap-1 rounded-full bg-ink px-2 py-0.5 font-medium text-white">
                  <svg width="8" height="8" viewBox="0 0 10 10" aria-hidden>
                    <path d="M2 1l7 4-7 4z" fill="currentColor" />
                  </svg>
                  Playing
                </span>
              </div>
              <div className="relative isolate flex h-44 items-end overflow-hidden rounded-xl bg-ink p-5 [clip-path:inset(0_round_0.75rem)]">
                <MeshGradient
                  className="pointer-events-none absolute inset-0 -z-10 h-full w-full rounded-[inherit]"
                  colors={["#1c1917", "#f2774a", "#ffd2bd", "#3b1d0f"]}
                  distortion={0.8}
                  swirl={0.6}
                  speed={0.6}
                  grainOverlay={0.15}
                />
                <span className="text-3xl font-semibold tracking-tight text-white">
                  <TextAnimate effect="words" stagger={0.08} once={false}>
                    Launch week, day one
                  </TextAnimate>
                </span>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-muted">
                <span>&lt;MeshGradient speed={"{0.6}"} /&gt;</span>
                <span>&lt;TextAnimate effect=&quot;words&quot;&gt;</span>
              </div>
            </div>
          </FeatureCard>
        </Reveal>
      </div>
    </section>
  );
}
