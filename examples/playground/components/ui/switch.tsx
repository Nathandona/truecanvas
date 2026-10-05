import { cn } from "@/lib/cn";

export type SwitchProps = {
  /** Whether the switch is on. */
  checked?: boolean;
  /** Shows the switch as non-interactive. */
  disabled?: boolean;
  /** Extra classes merged onto the root element. */
  className?: string;
};

export function Switch({ checked = false, disabled = false, className }: SwitchProps) {
  return (
    <span
      role="switch"
      aria-checked={checked}
      aria-disabled={disabled}
      className={cn(
        "relative inline-flex h-[18px] w-8 shrink-0 items-center rounded-full p-[2px] transition-colors",
        checked ? "bg-primary" : "bg-muted-strong",
        disabled && "opacity-50",
        className,
      )}
    >
      <span
        className={cn(
          "size-3.5 rounded-full bg-white shadow-[0_1px_2px_rgb(0_0_0/0.2)] transition-transform dark:bg-background",
          checked ? "translate-x-3.5" : "translate-x-0",
          checked && "dark:bg-primary-fg",
        )}
      />
    </span>
  );
}
