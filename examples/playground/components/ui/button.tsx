import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type ButtonProps = {
  /** Visual style of the button. */
  variant?: "primary" | "secondary" | "ghost" | "danger";
  /** Height and padding preset. */
  size?: "sm" | "md";
  /** Shows the button as non-interactive. */
  disabled?: boolean;
  /** Button label. */
  children?: ReactNode;
  /** Extra classes merged onto the root element. */
  className?: string;
};

const variants: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary: "bg-primary text-primary-fg hover:opacity-90 shadow-[0_1px_0_rgb(255_255_255/0.08)_inset]",
  secondary: "bg-surface text-text border border-border hover:bg-muted shadow-[0_1px_2px_rgb(0_0_0/0.04)]",
  ghost: "text-text-muted hover:bg-muted hover:text-text",
  danger: "bg-danger text-white hover:opacity-90",
};

const sizes: Record<NonNullable<ButtonProps["size"]>, string> = {
  sm: "h-7 px-2.5 text-[12px] gap-1.5 rounded-md",
  md: "h-8 px-3 text-[13px] gap-2 rounded-lg",
};

export function Button({ variant = "secondary", size = "md", disabled = false, children = "Button", className }: ButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={cn(
        "inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
        variants[variant],
        sizes[size],
        className,
      )}
    >
      {children}
    </button>
  );
}
