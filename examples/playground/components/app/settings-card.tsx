import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

export type SettingsCardProps = {
  /** Heading of the card. */
  title?: string;
  /** Supporting text under the heading. */
  description?: string;
  /** Label of the primary action. */
  saveLabel?: string;
  /** Hides the Cancel / Save footer. */
  hideFooter?: boolean;
  /** Settings rows. */
  children?: ReactNode;
  /** Extra classes merged onto the root element. */
  className?: string;
};

export function SettingsCard({
  title = "Settings",
  description = "Manage how this workspace behaves.",
  saveLabel = "Save changes",
  hideFooter = false,
  children,
  className,
}: SettingsCardProps) {
  return (
    <section
      className={cn(
        "flex flex-col rounded-xl border border-border bg-surface text-text shadow-[0_1px_2px_rgb(0_0_0/0.04),0_4px_16px_-4px_rgb(0_0_0/0.06)]",
        className,
      )}
    >
      <div className="flex flex-col gap-1 px-5 pt-5 pb-2">
        <h2 className="text-[15px] font-semibold tracking-[-0.01em]">{title}</h2>
        <p className="text-[13px] text-text-muted">{description}</p>
      </div>
      <div className="flex flex-col divide-y divide-border px-5">{children}</div>
      {!hideFooter && (
        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <Button variant="ghost" size="sm">
            Cancel
          </Button>
          <Button variant="primary" size="sm">
            {saveLabel}
          </Button>
        </div>
      )}
    </section>
  );
}
