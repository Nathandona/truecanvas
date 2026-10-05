import type { ReactNode } from "react";
import { PanelLeft } from "lucide-react";
import { cn } from "@/lib/cn";

export type SidebarProps = {
  /** Workspace name shown in the sidebar header. */
  workspace?: string;
  /** Width preset of the sidebar column. */
  width?: "sm" | "md" | "lg";
  /** Links, sections and session rows. */
  children?: ReactNode;
  /** Extra classes merged onto the root element. */
  className?: string;
};

const widths: Record<NonNullable<SidebarProps["width"]>, string> = {
  sm: "w-56",
  md: "w-[264px]",
  lg: "w-80",
};

export function Sidebar({ workspace = "Acme", width = "md", children, className }: SidebarProps) {
  return (
    <aside className={cn("flex h-full shrink-0 flex-col border-r border-border bg-sidebar", widths[width], className)}>
      <div className="flex h-11 items-center justify-between px-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex size-5 items-center justify-center rounded-[5px] bg-primary text-[10px] font-semibold text-primary-fg">
            {workspace.slice(0, 1).toUpperCase()}
          </span>
          <span className="truncate text-[13px] font-medium">{workspace}</span>
        </div>
        <button type="button" aria-label="Toggle sidebar" className="flex size-6 items-center justify-center rounded-md text-text-muted hover:bg-muted hover:text-text">
          <PanelLeft className="size-3.5" />
        </button>
      </div>
      <nav className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-2 pb-3">{children}</nav>
    </aside>
  );
}
