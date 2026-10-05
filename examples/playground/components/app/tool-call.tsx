import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";

export type ToolCallProps = {
  /** What the agent did, e.g. "Read" or "Searched". */
  verb?: string;
  /** What the action was applied to. */
  detail?: string;
  /** Outcome of the tool call. */
  state?: "done" | "running" | "error";
  /** Extra classes merged onto the root element. */
  className?: string;
};

export function ToolCall({ verb = "Read", detail = "README.md", state = "done", className }: ToolCallProps) {
  return (
    <div className={cn("group flex h-7 items-center gap-1.5 px-3 text-[13px]", className)}>
      <span className={cn("font-medium", state === "error" ? "text-danger" : "text-text")}>{verb}</span>
      <span className={cn("truncate text-text-muted", state === "running" && "animate-pulse")}>{detail}</span>
      <ChevronRight className="size-3.5 shrink-0 text-text-subtle opacity-0 transition-opacity group-hover:opacity-100" />
    </div>
  );
}
