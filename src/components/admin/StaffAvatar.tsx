import type { Doc } from "convex/_generated/dataModel";
import { initials } from "@/lib/staff-bookings";
import { cn } from "@/lib/utils";

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
      className={cn("flex shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white", className)}
      style={{ backgroundColor: staff.color }}
    >
      {initials(staff.name)}
    </span>
  );
}
