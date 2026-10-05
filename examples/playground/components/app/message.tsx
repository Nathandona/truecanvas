import type { ReactNode } from "react";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/cn";

export type MessageProps = {
  /** Name of the person who wrote the message. */
  author?: string;
  /** Channel the message came from. */
  via?: "web" | "slack" | "github" | "linear";
  /** Who sent the message; agent replies render without a bubble. */
  role?: "user" | "agent";
  /** Message text. */
  children?: ReactNode;
  /** Extra classes merged onto the root element. */
  className?: string;
};

const viaLabel = { web: "Web", slack: "Slack", github: "GitHub", linear: "Linear" } as const;

export function Message({ author = "Ada Lovelace", via = "web", role = "user", children, className }: MessageProps) {
  if (role === "agent") {
    return <div className={cn("px-3 py-1.5 text-[13px] leading-relaxed text-text", className)}>{children}</div>;
  }
  return (
    <div className={cn("flex flex-col gap-1.5 rounded-lg bg-muted px-3 py-2.5", className)}>
      <div className="flex items-center gap-1.5 text-[12px] text-text-muted">
        <Avatar name={author} size="xs" />
        <span className="font-medium text-text">{author}</span>
        <span className="text-text-subtle">·</span>
        <span>{viaLabel[via]}</span>
      </div>
      <div className="text-[13px] leading-relaxed text-text">{children}</div>
    </div>
  );
}
