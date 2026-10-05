import { cn } from "@/lib/cn";

export type AvatarProps = {
  /** Full name, used to derive the initials. */
  name?: string;
  /** Background color of the avatar. */
  color?: "red" | "blue" | "green" | "violet" | "neutral";
  /** Diameter preset. */
  size?: "xs" | "sm" | "md";
  /** Extra classes merged onto the root element. */
  className?: string;
};

const colors: Record<NonNullable<AvatarProps["color"]>, string> = {
  red: "bg-[#ef4b36] text-white",
  blue: "bg-[#3b6cf6] text-white",
  green: "bg-[#22a55b] text-white",
  violet: "bg-[#7c5cf2] text-white",
  neutral: "bg-muted-strong text-text",
};

const sizes: Record<NonNullable<AvatarProps["size"]>, string> = {
  xs: "size-4 text-[8px] rounded-[4px]",
  sm: "size-5 text-[9px] rounded-[5px]",
  md: "size-7 text-[11px] rounded-md",
};

export function Avatar({ name = "Ada Lovelace", color = "red", size = "sm", className }: AvatarProps) {
  const initials = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  return (
    <span
      aria-label={name}
      className={cn("inline-flex shrink-0 items-center justify-center font-semibold leading-none", colors[color], sizes[size], className)}
    >
      {initials}
    </span>
  );
}
