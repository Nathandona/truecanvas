import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type PageLayoutProps = {
  /** Sidebar followed by the main content. */
  children?: ReactNode;
  /** Draws a rounded border around the whole app window. */
  framed?: boolean;
  /** Extra classes merged onto the root element. */
  className?: string;
};

export function PageLayout({ children, framed = false, className }: PageLayoutProps) {
  return (
    <div
      className={cn(
        "flex h-full min-h-0 w-full overflow-hidden bg-background text-text",
        framed && "rounded-xl border border-border",
        className,
      )}
    >
      {children}
    </div>
  );
}
