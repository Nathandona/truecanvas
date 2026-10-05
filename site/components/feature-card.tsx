import type { CSSProperties, ReactNode } from "react";

/** A card of the features grid: a visual on top, then a title and a short description. */
export function FeatureCard({
  title = "Feature",
  description = "What it does, in one or two sentences.",
  children,
  className = "",
  style,
}: {
  /** Short, plain title */
  title?: string;
  /** One or two sentences */
  description?: string;
  /** The visual on top of the card */
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div style={style} className={`flex flex-col overflow-hidden rounded-2xl bg-white ring-1 ring-line ${className}`}>
      <div className="flex min-h-48 flex-1 items-center justify-center bg-paper-2/60 p-6">{children}</div>
      <div className="flex flex-col gap-1.5 p-6">
        <h3 className="text-[17px] font-semibold tracking-tight">{title}</h3>
        <p className="text-[14.5px] leading-relaxed text-muted">{description}</p>
      </div>
    </div>
  );
}
