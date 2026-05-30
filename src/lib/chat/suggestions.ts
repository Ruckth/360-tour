export type ChatSuggestionId = "couple" | "direct" | "tour" | "availability" | "guests" | "contact";

export interface ChatSuggestionCandidate {
  id: ChatSuggestionId;
  text: string;
}

export interface ChatSuggestionSelectionInput {
  candidates: ChatSuggestionCandidate[];
  activePropertySlug?: string;
  latestUserMessage?: string;
  latestAssistantMessage?: string;
  clickedSuggestionId?: ChatSuggestionId | null;
  limit?: number;
}

const INITIAL_HOME_ORDER: ChatSuggestionId[] = [
  "couple",
  "direct",
  "tour",
  "availability",
  "guests",
  "contact",
];
const INITIAL_PROPERTY_ORDER: ChatSuggestionId[] = [
  "tour",
  "direct",
  "availability",
  "couple",
  "guests",
  "contact",
];

const FOLLOW_UP_ORDERS: Record<ChatSuggestionId, ChatSuggestionId[]> = {
  couple: ["direct", "tour", "availability", "guests", "contact", "couple"],
  direct: ["tour", "couple", "availability", "contact", "guests", "direct"],
  tour: ["direct", "couple", "availability", "guests", "contact", "tour"],
  availability: ["couple", "direct", "tour", "guests", "contact", "availability"],
  guests: ["couple", "availability", "direct", "tour", "contact", "guests"],
  contact: ["availability", "direct", "tour", "couple", "guests", "contact"],
};

const KEYWORDS: Record<ChatSuggestionId, string[]> = {
  couple: [
    "couple",
    "pair",
    "romantic",
    "honeymoon",
    "anniversary",
    "paar",
    "paare",
    "couples",
    "pareja",
    "couple",
    "คู่รัก",
    "情侣",
    "カップル",
    "커플",
  ],
  direct: [
    "direct",
    "booking",
    "book",
    "discount",
    "price",
    "saving",
    "included",
    "ota",
    "airport",
    "direkt",
    "direktbuchung",
    "rabatt",
    "preis",
    "buchung",
    "réservation directe",
    "reserva directa",
    "prenotazione diretta",
    "จองตรง",
    "ราคา",
    "ส่วนลด",
    "直接预订",
    "直接予約",
    "직접 예약",
    "할인",
    "прям",
    "सीधी बुकिंग",
  ],
  tour: [
    "360",
    "tour",
    "virtual",
    "explore",
    "see",
    "view",
    "hotspot",
    "room",
    "virtuell",
    "ansehen",
    "sehen",
    "visite",
    "visita",
    "ทัวร์",
    "ดู",
    "虚拟",
    "見",
    "투어",
  ],
  availability: [
    "available",
    "availability",
    "date",
    "dates",
    "check in",
    "check-in",
    "checkout",
    "check out",
    "vacancy",
    "ว่าง",
    "ห้องว่าง",
    "วันที่",
    "空房",
    "空き",
    "예약 가능",
  ],
  guests: [
    "guest",
    "guests",
    "group",
    "family",
    "capacity",
    "sleep",
    "stay comfortably",
    "ผู้เข้าพัก",
    "กี่คน",
    "客人",
    "ゲスト",
    "인원",
  ],
  contact: [
    "contact",
    "host",
    "whatsapp",
    "line",
    "message",
    "call",
    "ติดต่อ",
    "เจ้าของ",
    "โฮสต์",
    "联系",
    "連絡",
    "호스트",
  ],
};

function normalizeText(value?: string) {
  return value?.trim().toLocaleLowerCase() ?? "";
}

function detectTopic({
  candidates,
  latestUserMessage,
  latestAssistantMessage,
  clickedSuggestionId,
}: ChatSuggestionSelectionInput): ChatSuggestionId | null {
  if (clickedSuggestionId) return clickedSuggestionId;

  const latestUser = normalizeText(latestUserMessage);
  const exactCandidate = candidates.find((candidate) => normalizeText(candidate.text) === latestUser);
  if (exactCandidate) return exactCandidate.id;

  const searchable = normalizeText(`${latestUserMessage ?? ""} ${latestAssistantMessage ?? ""}`);
  if (!searchable) return null;

  for (const id of [
    "couple",
    "direct",
    "tour",
    "availability",
    "guests",
    "contact",
  ] satisfies ChatSuggestionId[]) {
    if (KEYWORDS[id].some((keyword) => searchable.includes(keyword))) {
      return id;
    }
  }

  return null;
}

function orderCandidates(
  order: ChatSuggestionId[],
  candidates: ChatSuggestionCandidate[],
  excludedId?: ChatSuggestionId | null,
  limit = 2,
) {
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const seen = new Set<ChatSuggestionId>();
  const result: ChatSuggestionCandidate[] = [];

  for (const id of [...order, ...candidates.map((candidate) => candidate.id)]) {
    if (id === excludedId || seen.has(id)) continue;
    const candidate = byId.get(id);
    if (!candidate) continue;
    seen.add(id);
    result.push(candidate);
    if (result.length >= limit) break;
  }

  return result;
}

export function selectChatSuggestions(input: ChatSuggestionSelectionInput) {
  const topic = detectTopic(input);
  const limit = input.limit ?? (topic ? 2 : 6);
  const initialOrder = input.activePropertySlug ? INITIAL_PROPERTY_ORDER : INITIAL_HOME_ORDER;
  const order = topic ? FOLLOW_UP_ORDERS[topic] : initialOrder;

  return orderCandidates(order, input.candidates, input.clickedSuggestionId, limit);
}
