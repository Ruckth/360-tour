type AdminChatChannel = "web" | "whatsapp" | "line" | "facebook" | "instagram";

type AdminChatLabelSession = {
  channel?: AdminChatChannel;
  visitorName?: string;
  visitorEmail?: string;
  visitorContactHandle?: string;
};

const guestLabels: Record<AdminChatChannel, string> = {
  web: "Web guest",
  whatsapp: "WhatsApp guest",
  line: "LINE guest",
  facebook: "Facebook guest",
  instagram: "Instagram guest",
};

function cleanValue(value?: string) {
  return value?.trim() || undefined;
}

// Raw channel IDs are never used as labels; they stay in the chat details for support.
export function adminChatVisitorLabel(session?: AdminChatLabelSession | null) {
  if (!session) return "Unknown";

  const channel = session.channel ?? "web";
  return (
    cleanValue(session.visitorName) ??
    cleanValue(session.visitorEmail) ??
    // Web visitors type their own contact handle; other channels store the raw platform ID there.
    (channel === "web" ? cleanValue(session.visitorContactHandle) : undefined) ??
    guestLabels[channel]
  );
}
