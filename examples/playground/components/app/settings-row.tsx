import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/cn";

export type SettingsRowProps = {
  /** Name of the setting. */
  title?: string;
  /** One-line explanation under the title. */
  description?: string;
  /** Control rendered on the right. */
  control?: "switch" | "badge";
  /** State of the switch, or whether the badge reads Enabled. */
  checked?: boolean;
  /** Extra classes merged onto the root element. */
  className?: string;
};

export function SettingsRow({
  title = "Setting",
  description = "Describe what this setting does.",
  control = "switch",
  checked = false,
  className,
}: SettingsRowProps) {
  return (
    <div className={cn("flex items-center gap-4 py-3", className)}>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[13px] font-medium text-text">{title}</span>
        <span className="text-[12px] text-text-muted">{description}</span>
      </div>
      {control === "switch" ? (
        <Switch checked={checked} />
      ) : (
        <Badge tone={checked ? "success" : "neutral"}>{checked ? "Enabled" : "Disabled"}</Badge>
      )}
    </div>
  );
}
