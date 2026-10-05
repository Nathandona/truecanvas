import { Blocks, ChartColumn, House, Settings, SquarePen, Workflow } from "lucide-react";
import { cn } from "@/lib/cn";

export type SidebarLinkProps = {
  /** Text of the link. */
  label?: string;
  /** Leading icon. */
  icon?: "home" | "reports" | "automations" | "integrations" | "settings" | "new";
  /** Highlights the link as the current page. */
  active?: boolean;
  /** Optional count shown on the right. */
  count?: string;
  /** Extra classes merged onto the root element. */
  className?: string;
};

const icons = {
  home: House,
  reports: ChartColumn,
  automations: Workflow,
  integrations: Blocks,
  settings: Settings,
  new: SquarePen,
} as const;

export function SidebarLink({ label = "Home", icon = "home", active = false, count, className }: SidebarLinkProps) {
  const Icon = icons[icon];
  return (
    <a
      href="#"
      className={cn(
        "group flex h-7 items-center gap-2 rounded-md px-2 text-[13px] transition-colors",
        active ? "bg-muted-strong font-medium text-text" : "text-text-muted hover:bg-muted hover:text-text",
        className,
      )}
    >
      <Icon className={cn("size-3.5 shrink-0", active ? "text-text" : "text-text-subtle group-hover:text-text-muted")} strokeWidth={1.75} />
      <span className="truncate">{label}</span>
      {count && <span className="ml-auto text-[11px] tabular-nums text-text-subtle">{count}</span>}
    </a>
  );
}
