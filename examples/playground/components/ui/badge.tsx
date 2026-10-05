import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type BadgeProps = {
  /** Color tone communicating the meaning of the badge. */
  tone?: "neutral" | "success" | "warning" | "danger" | "accent";
  /** Shows a small leading status dot. */
  dot?: boolean;
  /** Badge label. */
  children?: ReactNode;
  /** Extra classes merged onto the root element. */
  className?: string;
};

const tones: Record<NonNullable<BadgeProps["tone"]>, string> = {
  neutral: "bg-muted text-text-muted",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  accent: "bg-accent-soft text-accent",
};

export function Badge({ tone = "neutral", dot = false, children = "Badge", className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium leading-none whitespace-nowrap",
        tones[tone],
        className,
      )}
    >
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}
