import { CircleCheck, CircleDashed, Globe, GitPullRequest, Hash, LoaderCircle, SquareKanban, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/cn";

export type SessionRowProps = {
  /** Title of the agent session. */
  title?: string;
  /** Current state of the session. */
  status?: "working" | "idle" | "review" | "failed" | "done";
  /** Where the session was started from. */
  source?: "web" | "slack" | "github" | "linear";
  /** Time since the last activity, e.g. "3h". */
  elapsed?: string;
  /** Marks the session as having unseen activity. */
  unread?: boolean;
  /** Highlights the row as the open session. */
  active?: boolean;
  /** Extra classes merged onto the root element. */
  className?: string;
};

const statusIcon = {
  working: { Icon: LoaderCircle, className: "text-text-muted animate-spin [animation-duration:1.6s]" },
  idle: { Icon: null, className: "" },
  review: { Icon: CircleDashed, className: "text-warning" },
  failed: { Icon: TriangleAlert, className: "text-danger" },
  done: { Icon: CircleCheck, className: "text-success" },
} as const;

const sourceIcon = {
  web: Globe,
  slack: Hash,
  github: GitPullRequest,
  linear: SquareKanban,
} as const;

export function SessionRow({
  title = "Untitled session",
  status = "idle",
  source = "web",
  elapsed = "1h",
  unread = false,
  active = false,
  className,
}: SessionRowProps) {
  const { Icon, className: iconClass } = statusIcon[status];
  const Source = sourceIcon[source];
  return (
    <a
      href="#"
      className={cn(
        "group flex h-7 items-center gap-2 rounded-md px-2 text-[13px] transition-colors",
        active ? "bg-muted-strong text-text" : "text-text-muted hover:bg-muted hover:text-text",
        className,
      )}
    >
      <span className="flex size-3.5 shrink-0 items-center justify-center">
        {Icon ? (
          <Icon className={cn("size-3.5", iconClass)} strokeWidth={1.75} />
        ) : (
          <span className="size-1 rounded-full bg-text-subtle" />
        )}
      </span>
      <span className={cn("min-w-0 flex-1 truncate", (unread || active) && "text-text", unread && "font-medium")}>{title}</span>
      {source !== "web" && <Source className="size-3 shrink-0 text-text-subtle" strokeWidth={1.75} />}
      {unread && <span className="size-1.5 shrink-0 rounded-full bg-accent" />}
      <span className="w-6 shrink-0 text-right text-[11px] tabular-nums text-text-subtle">{elapsed}</span>
    </a>
  );
}
