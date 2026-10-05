import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type SidebarSectionProps = {
  /** Small uppercase-free heading above the group. */
  title?: string;
  /** Rows inside the section. */
  children?: ReactNode;
  /** Extra classes merged onto the root element. */
  className?: string;
};

export function SidebarSection({ title = "Section", children, className }: SidebarSectionProps) {
  return (
    <div className={cn("mt-4 flex flex-col gap-px", className)}>
      <div className="px-2 pb-1 text-[11px] font-medium text-text-subtle">{title}</div>
      {children}
    </div>
  );
}
