type AdminChatLabelSession = {
  _id: string;
  visitorId?: string;
  visitorName?: string;
  visitorEmail?: string;
  visitorContactHandle?: string;
};

const externalVisitorPrefixes = ["line:", "facebook:", "whatsapp:", "instagram:"];
const shortVisitorIdLength = 8;

function cleanValue(value?: string) {
  return value?.trim() || undefined;
}

function stripVisitorPrefix(visitorId: string) {
  const prefix = externalVisitorPrefixes.find((candidate) => visitorId.startsWith(candidate));
  return prefix ? visitorId.slice(prefix.length) : visitorId;
}

export function adminChatVisitorLabel(session?: AdminChatLabelSession | null) {
  if (!session) return "Unknown";

  const visitorName = cleanValue(session.visitorName);
  if (visitorName) return visitorName;

  const visitorEmail = cleanValue(session.visitorEmail);
  if (visitorEmail) return visitorEmail;

  const visitorContactHandle = cleanValue(session.visitorContactHandle);
  if (visitorContactHandle) return visitorContactHandle;

  const visitorId = cleanValue(session.visitorId);
  if (visitorId) {
    const cleanVisitorId = stripVisitorPrefix(visitorId);
    return cleanVisitorId === visitorId ? cleanVisitorId.slice(0, shortVisitorIdLength) : cleanVisitorId;
  }

  return session._id.slice(-6);
}
