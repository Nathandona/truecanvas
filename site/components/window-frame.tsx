import type { ReactNode } from "react";

/** Desktop window chrome around a screenshot or a UI mock. */
export function WindowFrame({ title = "Truecanvas", children, className = "" }: { title?: string; children?: ReactNode; className?: string }) {
  return (
    <div className={`overflow-hidden rounded-2xl bg-white shadow-[0_30px_80px_-20px_rgb(28_25_23/0.35)] ring-1 ring-ink/10 ${className}`}>
      <div className="flex h-10 items-center gap-2 border-b border-line bg-paper px-4">
        <span className="size-3 rounded-full bg-[#ff5f57]" />
        <span className="size-3 rounded-full bg-[#febc2e]" />
        <span className="size-3 rounded-full bg-[#28c840]" />
        <span className="ml-3 text-[12.5px] text-muted">{title}</span>
      </div>
      {children}
    </div>
  );
}
