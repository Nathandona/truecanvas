import { ArrowUp, Box, Code, Paperclip, Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";

export type ComposerProps = {
  /** Hint shown while the input is empty. */
  placeholder?: string;
  /** Model picked for the next message. */
  model?: string;
  /** Environment the agent runs against. */
  environment?: "Production" | "Staging" | "Preview";
  /** Repository the agent works in. */
  repository?: string;
  /** Extra classes merged onto the root element. */
  className?: string;
};

export function Composer({
  placeholder = "Ask anything",
  model = "Opus 5.5",
  environment = "Production",
  repository = "web",
  className,
}: ComposerProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-xl border border-border bg-surface p-3 shadow-[0_1px_2px_rgb(0_0_0/0.04),0_8px_24px_-12px_rgb(0_0_0/0.12)]",
        className,
      )}
    >
      <div className="min-h-9 px-1 text-[13px] text-text-subtle">{placeholder}</div>
      <div className="flex items-center gap-1 text-[12px] text-text-muted">
        <button type="button" aria-label="Attach" className="flex size-6 items-center justify-center rounded-md hover:bg-muted hover:text-text">
          <Paperclip className="size-3.5" strokeWidth={1.75} />
        </button>
        <span className="flex h-6 items-center gap-1.5 rounded-md px-1.5 hover:bg-muted">
          <Box className="size-3.5" strokeWidth={1.75} />
          {environment}
        </span>
        <span className="flex h-6 items-center gap-1.5 rounded-md px-1.5 hover:bg-muted">
          <Code className="size-3.5" strokeWidth={1.75} />
          {repository}
        </span>
        <span className="ml-auto flex h-6 items-center gap-1.5 rounded-md px-1.5 hover:bg-muted">
          <Sparkles className="size-3.5" strokeWidth={1.75} />
          {model}
        </span>
        <button type="button" aria-label="Send" className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-fg hover:opacity-90">
          <ArrowUp className="size-3.5" strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}
