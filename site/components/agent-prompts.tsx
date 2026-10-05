import type { CSSProperties } from "react";
import { Reveal } from "@/components/motion/reveal";
import { CommandPill } from "@/components/command-pill";

/*
 * One agent session, shown the way it looks: the Claude Code transcript with
 * the real tool calls on the left, the canvas it is editing on the right.
 */

function Call({ tool, args, result, style }: { tool: string; args?: string; result: string; style?: CSSProperties }) {
  return (
    <div className="flex flex-col" style={style}>
      <div>
        <span className="text-[#86efac]">⏺</span> <span className="font-semibold text-white">truecanvas - {tool}</span>{" "}
        <span className="text-white/45">(MCP){args ? `(${args})` : ""}</span>
      </div>
      <div className="pl-2 text-white/55">
        <span className="text-white/30">⎿</span>  {result}
      </div>
    </div>
  );
}

function Plan({ name, price, note, cta, featured, compact }: { name: string; price: string; note: string; cta: string; featured?: boolean; compact?: boolean }) {
  return (
    <div className={`flex flex-1 flex-col rounded-lg bg-white ring-1 ring-line ${compact ? "gap-1 p-2.5" : "gap-1.5 p-3"}`}>
      <span className="text-[10px] font-medium text-muted">{name}</span>
      <span className="text-[15px] font-semibold tracking-tight">
        {price}
        <span className="text-[10px] font-normal text-muted">/mo</span>
      </span>
      <span className="text-[9.5px] leading-snug text-muted">{note}</span>
      <span className={`mt-1 self-start rounded-md px-2 py-0.5 text-[9.5px] font-medium ${featured ? "bg-coral text-white" : "bg-ink text-white"}`}>{cta}</span>
    </div>
  );
}

export function AgentPrompts() {
  return (
    <section className="bg-ink px-6 py-28 text-white">
      <div className="mx-auto flex max-w-6xl flex-col gap-14">
        <Reveal stagger={0.08} className="grid gap-6 md:grid-cols-2 md:items-end">
          <h2 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">Your agent gets the same canvas you do.</h2>
          <div className="flex max-w-md flex-col items-start gap-6 md:justify-self-end">
          <p className="text-[17px] leading-relaxed text-white/60">
            Truecanvas is an MCP server with no model inside. Claude Code, Cursor or any MCP client reads your frames, edits the real
            files and screenshots its own work. Its cursor shows up on the canvas while it does.
          </p>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
            <CommandPill command="npx truecanvas connect" tone="dark" />
            <a href="https://github.com/Nathandona/truecanvas#connect-your-agent" className="group inline-flex items-center gap-1.5 text-[14px] font-medium text-white/70 hover:text-white">
              Agent setup <span aria-hidden className="transition-transform duration-200 group-hover:translate-x-0.5">→</span>
            </a>
          </div>
          </div>
        </Reveal>

        <div className="grid overflow-hidden rounded-2xl ring-1 ring-white/10 lg:grid-cols-[1.15fr_1fr]">
          <div className="flex min-w-0 flex-col bg-[#141210]">
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-2.5 font-mono text-[11.5px] text-white/40">
              <span>claude · ~/acme-web</span>
              <span>3 files changed</span>
            </div>
            <Reveal stagger={0.35} delay={0.2} duration={0.5} className="flex flex-col gap-4 overflow-x-auto px-5 py-5 font-mono text-[12.5px] leading-[1.65] whitespace-pre">
              <div className="text-white">
                <span className="text-white/40">&gt;</span> the selected cards feel loose. tighten them and check on a phone
              </div>
              <Call tool="get_selection" result="3 nodes: PricingCard in Pricing (components/pricing-card.tsx)" />
              <Call tool="set_class_name" args={'id: "…/pricing-card.tsx#9:4"'} result="Restyled PricingCard (+gap-3 +p-5 -gap-6 -p-8)" />
              <Call tool="create_frame" args={'name: "Pricing mobile", device: "iphone-16"'} result="Added frame Pricing mobile" />
              <Call tool="screenshot_frame" args={'frame: "Pricing mobile"'} result="[image 393×852]" />
              <div className="font-sans text-[14px] leading-relaxed whitespace-normal text-white/85">
                <span className="text-white">⏺</span> Cards use 20px padding now. On an iPhone 16 they stack cleanly and the Pro CTA stays above the fold.
              </div>
            </Reveal>
          </div>

          <div className="relative flex min-h-96 items-center justify-center gap-6 overflow-hidden bg-paper-2 p-8 text-ink [background-image:radial-gradient(#d6cfc4_1px,transparent_1px)] [background-size:16px_16px]">
            <div className="flex w-full max-w-72 flex-col gap-1.5">
              <span className="text-[11px] text-muted">Pricing</span>
              <div className="flex gap-1.5 rounded-xl bg-paper p-1.5 ring-2 ring-[#7c3aed]">
                <Plan name="Hobby" price="$0" note="One project, local only" cta="Start" />
                <Plan name="Pro" price="$12" note="Unlimited projects and PR previews" cta="Upgrade" featured />
              </div>
            </div>
            <Reveal effect="scale-in" delay={1.3} duration={0.5} className="flex w-32 shrink-0 flex-col gap-1.5">
              <span className="text-[11px] text-muted">Pricing mobile</span>
              <div className="flex flex-col gap-1.5 rounded-[20px] bg-paper p-2 ring-1 ring-ink/25 shadow-sm">
                <div className="mx-auto mb-0.5 h-2 w-10 rounded-full bg-ink" />
                <Plan name="Hobby" price="$0" note="One project" cta="Start" compact />
                <Plan name="Pro" price="$12" note="PR previews" cta="Upgrade" featured compact />
              </div>
            </Reveal>
            <div className="absolute bottom-10 left-[36%] flex items-start gap-1">
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
                <path d="M2 1l11 6-5 1.5L6 14z" fill="#7c3aed" stroke="white" strokeWidth="1.2" />
              </svg>
              <span className="mt-3 rounded-full bg-[#7c3aed] px-2 py-0.5 text-[11px] font-medium text-white">Claude</span>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t border-white/10 pt-6 font-mono text-[12px] text-white/45 md:flex-row md:items-baseline md:gap-8">
          <span className="shrink-0 uppercase tracking-[0.14em] text-white/30">Tools include</span>
          <p className="leading-6">
            get_canvas · get_selection · get_design_tokens · insert_component · insert_jsx · set_text · set_class_name · wrap_nodes ·
            create_variants · add_animation · explore_copy · apply_to_page · screenshot_frame · list_comments · resolve_comment{" "}
            <a href="https://github.com/Nathandona/truecanvas#mcp-tools" className="text-white/70 underline decoration-white/25 underline-offset-4 hover:text-white">
              and more
            </a>
          </p>
        </div>
      </div>
    </section>
  );
}
