import type { Doc } from "convex/_generated/dataModel";
import { initials } from "@/lib/staff-bookings";
import { cn } from "@/lib/utils";

/** Initials in white on dark staff colours, navy on light ones, so they stay readable on any colour. */
export function avatarInk(color: string) {
  const hex = color.match(/^#([\da-f]{3}|[\da-f]{6})$/i)?.[1];
  if (!hex) return "text-white";
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = parseInt(full.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  // Above this luminance, dark text has more contrast than white.
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.18 ? "text-navy" : "text-white";
}

export function StaffAvatar({
  staff,
  className,
}: {
  staff: Pick<Doc<"staff">, "name" | "avatarUrl" | "color">;
  className?: string;
}) {
  return staff.avatarUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={staff.avatarUrl} alt="" className={cn("shrink-0 rounded-full object-cover", className)} />
  ) : (
    <span
      aria-hidden
      className={cn("flex shrink-0 items-center justify-center rounded-full text-xs font-semibold", avatarInk(staff.color), className)}
      style={{ backgroundColor: staff.color }}
    >
      {initials(staff.name)}
    </span>
  );
}
