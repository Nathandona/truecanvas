import type { ReactNode } from "react";

/** One step of "How it works": a number, a title, a sentence and an optional visual. */
export function Step({ number = 1, title = "Step", description = "What happens.", children }: { number?: number; title?: string; description?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-4">
      {children}
      <span className="flex size-9 items-center justify-center rounded-full bg-ink font-mono text-[14px] text-white">{number}</span>
      <h3 className="text-xl font-semibold tracking-tight">{title}</h3>
      <p className="text-[15px] leading-relaxed text-muted">{description}</p>
    </div>
  );
}
