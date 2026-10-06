import { BrandLogo, type BrandName } from "@/components/brand-logo";
import { IsoStack } from "@/components/iso-stack";

const STACK: BrandName[] = ["next", "vite", "react", "tailwind", "typescript", "claude", "cursor", "github"];

export function WorksWith() {
  return (
    <section className="border-y border-line/70 bg-white/50 px-6 py-24">
      <div className="mx-auto grid max-w-6xl items-center gap-12 md:grid-cols-[1fr_1.35fr]">
        <div className="flex flex-col gap-5">
          <span className="font-mono text-[12px] uppercase tracking-[0.14em] text-coral-ink">Works with</span>
          <h2 className="text-4xl font-semibold tracking-tight text-balance">Between your stack and your agents</h2>
          <p className="text-[17px] leading-relaxed text-muted text-pretty">
            Truecanvas runs next to your Next.js or Vite app and speaks MCP. Your components render as they are, and the agents you already use can see and edit
            them.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-3 text-ink-2">
            {STACK.map((b) => (
              <BrandLogo key={b} name={b} size={22} mono />
            ))}
            <span className="font-mono text-[12px] text-muted">+ any MCP client</span>
          </div>
        </div>
        <IsoStack />
      </div>
    </section>
  );
}
