import { Globe2, MessageCircle } from "lucide-react";
import { ContactAppBrandIcon } from "@/components/chat/ContactAppBrandIcon";
import { adminChatVisitorLabel } from "@/components/admin/admin-chat-labels";
import type { AdminSession, SessionChannelFilter } from "@/components/admin/admin-chat-types";
import { cn } from "@/lib/utils";

export function visitorLabel(session?: AdminSession | null) {
  return adminChatVisitorLabel(session);
}

export function relativeTime(timestamp?: number, now = Date.now()) {
  if (!timestamp) return "Unknown";
  const seconds = Math.max(1, Math.floor((now - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function formatDateTime(timestamp?: number) {
  if (!timestamp) return "Unknown";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

export function truncate(value?: string, max = 96) {
  if (!value) return "";
  return value.length > max ? `${value.slice(0, max - 1)}...` : value;
}

export function ChannelIcon({
  channel,
  className,
}: {
  channel: AdminSession["channel"] | Exclude<SessionChannelFilter, "all">;
  className?: string;
}) {
  if (channel === "line" || channel === "facebook" || channel === "whatsapp" || channel === "instagram") {
    return <ContactAppBrandIcon app={channel} className={className} />;
  }
  if (channel === "web") return <Globe2 className={cn("h-4 w-4", className)} aria-hidden="true" />;
  return <MessageCircle className={cn("h-4 w-4", className)} aria-hidden="true" />;
}
