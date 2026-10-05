import { Ellipsis, GitPullRequest, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";

export type PageHeaderProps = {
  /** Title of the open session. */
  title?: string;
  /** Session state shown as a badge. */
  status?: "active" | "paused" | "done" | "failed";
  /** Number of pull requests opened by the session. */
  pullRequests?: number;
  /** Shows the lock icon for private sessions. */
  private?: boolean;
  /** Initials of the people in the session, e.g. "MC +1". */
  participants?: string;
  /** Extra classes merged onto the root element. */
  className?: string;
};

const statusBadge = {
  active: { tone: "success", label: "Active" },
  paused: { tone: "warning", label: "Paused" },
  done: { tone: "neutral", label: "Done" },
  failed: { tone: "danger", label: "Failed" },
} as const;

export function PageHeader({
  title = "Untitled session",
  status = "active",
  pullRequests = 0,
  private: isPrivate = false,
  participants,
  className,
}: PageHeaderProps) {
  const badge = statusBadge[status];
  return (
    <header className={cn("flex h-11 shrink-0 items-center gap-3 border-b border-border px-4", className)}>
      <h1 className="min-w-0 flex-1 truncate text-[13px] font-medium">{title}</h1>
      <div className="flex shrink-0 items-center gap-3 text-text-muted">
        <Badge tone={badge.tone}>{badge.label}</Badge>
        {pullRequests > 0 && (
          <span className="flex items-center gap-1 text-[12px] tabular-nums">
            <GitPullRequest className="size-3.5" strokeWidth={1.75} />
            {pullRequests}
          </span>
        )}
        {isPrivate && <Lock className="size-3.5" strokeWidth={1.75} />}
        {participants && (
          <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-text-muted">{participants}</span>
        )}
        <button type="button" aria-label="More" className="flex size-6 items-center justify-center rounded-md hover:bg-muted hover:text-text">
          <Ellipsis className="size-4" />
        </button>
      </div>
    </header>
  );
}
