import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type CardProps = {
  /** Surface elevation of the card. */
  elevation?: "flat" | "raised";
  /** Inner padding preset. */
  padding?: "none" | "sm" | "md";
  /** Card content. */
  children?: ReactNode;
  /** Extra classes merged onto the root element. */
  className?: string;
};

const paddings: Record<NonNullable<CardProps["padding"]>, string> = {
  none: "",
  sm: "p-3",
  md: "p-5",
};

export function Card({ elevation = "raised", padding = "md", children, className }: CardProps) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-surface",
        elevation === "raised" && "shadow-[0_1px_2px_rgb(0_0_0/0.04),0_4px_16px_-4px_rgb(0_0_0/0.06)]",
        paddings[padding],
        className,
      )}
    >
      {children}
    </div>
  );
}
