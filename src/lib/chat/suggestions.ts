export type ChatSuggestionId =
  | "availability"
  | "totalPrice"
  | "direct"
  | "tour"
  | "guests"
  | "contact"
  | "couple"
  | "family"
  | "cancellation"
  | "airport"
  | "amenitiesIncluded"
  | "location";

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
  "availability",
  "totalPrice",
  "direct",
  "tour",
  "guests",
  "contact",
];
const INITIAL_PROPERTY_ORDER: ChatSuggestionId[] = [
  "tour",
  "availability",
  "totalPrice",
  "direct",
  "guests",
  "contact",
];

const FOLLOW_UP_ORDERS: Record<ChatSuggestionId, ChatSuggestionId[]> = {
  availability: [
    "totalPrice",
    "direct",
    "family",
    "cancellation",
    "airport",
    "amenitiesIncluded",
    "location",
    "tour",
    "guests",
    "contact",
    "couple",
    "availability",
  ],
  totalPrice: [
    "availability",
    "direct",
    "cancellation",
    "airport",
    "amenitiesIncluded",
    "location",
    "family",
    "tour",
    "guests",
    "contact",
    "couple",
    "totalPrice",
  ],
  direct: [
    "totalPrice",
    "availability",
    "airport",
    "cancellation",
    "amenitiesIncluded",
    "location",
    "tour",
    "family",
    "contact",
    "guests",
    "couple",
    "direct",
  ],
  tour: [
    "availability",
    "totalPrice",
    "direct",
    "family",
    "guests",
    "amenitiesIncluded",
    "location",
    "couple",
    "airport",
    "cancellation",
    "contact",
    "tour",
  ],
  guests: [
    "family",
    "availability",
    "totalPrice",
    "tour",
    "amenitiesIncluded",
    "couple",
    "location",
    "direct",
    "airport",
    "cancellation",
    "contact",
    "guests",
  ],
  contact: [
    "availability",
    "totalPrice",
    "direct",
    "airport",
    "cancellation",
    "location",
    "amenitiesIncluded",
    "tour",
    "family",
    "guests",
    "couple",
    "contact",
  ],
  couple: [
    "availability",
    "totalPrice",
    "tour",
    "direct",
    "amenitiesIncluded",
    "location",
    "airport",
    "cancellation",
    "contact",
    "guests",
    "family",
    "couple",
  ],
  family: [
    "guests",
    "availability",
    "totalPrice",
    "tour",
    "amenitiesIncluded",
    "location",
    "direct",
    "airport",
    "cancellation",
    "contact",
    "couple",
    "family",
  ],
  cancellation: [
    "availability",
    "totalPrice",
    "direct",
    "contact",
    "airport",
    "location",
    "amenitiesIncluded",
    "tour",
    "guests",
    "family",
    "couple",
    "cancellation",
  ],
  airport: [
    "direct",
    "availability",
    "totalPrice",
    "location",
    "contact",
    "cancellation",
    "amenitiesIncluded",
    "tour",
    "family",
    "guests",
    "couple",
    "airport",
  ],
  amenitiesIncluded: [
    "tour",
    "availability",
    "totalPrice",
    "family",
    "guests",
    "location",
    "direct",
    "airport",
    "cancellation",
    "contact",
    "couple",
    "amenitiesIncluded",
  ],
  location: [
    "airport",
    "amenitiesIncluded",
    "tour",
    "availability",
    "totalPrice",
    "direct",
    "contact",
    "family",
    "guests",
    "couple",
    "cancellation",
    "location",
  ],
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
  totalPrice: [
    "cost",
    "total",
    "rate",
    "rates",
    "price",
    "pricing",
    "nightly",
    "fare",
    "ราคา",
    "ค่าใช้จ่าย",
    "总价",
    "价格",
    "料金",
    "요금",
    "стоимость",
    "цена",
    "कीमत",
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
  family: [
    "family",
    "families",
    "group",
    "kids",
    "children",
    "ครอบครัว",
    "กลุ่ม",
    "家庭",
    "家族",
    "가족",
    "семья",
    "परिवार",
  ],
  cancellation: [
    "cancel",
    "cancellation",
    "refund",
    "flexible",
    "ยกเลิก",
    "คืนเงิน",
    "取消",
    "キャンセル",
    "취소",
    "отмена",
    "रद्द",
  ],
  airport: [
    "airport",
    "pickup",
    "transfer",
    "arrival",
    "สนามบิน",
    "รับส่ง",
    "机场",
    "空港",
    "공항",
    "аэропорт",
    "एयरपोर्ट",
  ],
  amenitiesIncluded: [
    "amenities",
    "included",
    "wifi",
    "pool",
    "breakfast",
    "beach",
    "สิ่งอำนวยความสะดวก",
    "รวม",
    "设施",
    "アメニティ",
    "편의시설",
    "удобства",
    "सुविधाएं",
  ],
  location: [
    "location",
    "beach",
    "restaurant",
    "restaurants",
    "bophut",
    "fisherman",
    "ที่ตั้ง",
    "ชายหาด",
    "ร้านอาหาร",
    "位置",
    "海滩",
    "場所",
    "위치",
    "пляж",
    "स्थान",
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
    "availability",
    "direct",
    "totalPrice",
    "tour",
    "guests",
    "contact",
    "couple",
    "family",
    "cancellation",
    "airport",
    "amenitiesIncluded",
    "location",
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
