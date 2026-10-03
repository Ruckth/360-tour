import { unknownReply } from "convex/lib/unknownReply";
import { defaultLocale, isLocale, type Locale } from "@/i18n/routing";

export type LineIntent =
  | "availability"
  | "pricing"
  | "direct_booking"
  | "villa_details"
  | "tour"
  | "contact"
  | "airport"
  | "cancellation"
  | "location"
  | "amenities"
  | "welcome";

export type LineReplyMode = "exact" | "postback" | "follow";

export type LinePropertySummary = {
  slug: string;
  name: string;
  tagline: string;
  pricePerNight: number;
  currency: string;
  maxGuests: number;
  bedrooms: number;
  bathrooms: number;
  area: number;
  amenities: string[];
  directDiscountPercent: number;
};

export type LineQuickReplyItem = {
  type: "action";
  action: {
    type: "postback";
    label: string;
    data: string;
    displayText: string;
  };
};

export type LineQuickAnswer = {
  intent: LineIntent;
  mode: LineReplyMode;
  text: string;
  quickReplyItems: LineQuickReplyItem[];
};

export type QuickAnswerLocale = Locale;

type QuickReplyIntent = "availability" | "pricing" | "tour" | "contact";
const quickReplyIntents: QuickReplyIntent[] = [
  "availability",
  "pricing",
  "tour",
  "contact",
];
const localeCopy: Record<
  QuickAnswerLocale,
  {
    quickReplyLabels: Record<QuickReplyIntent, string>;
    timeout: string;
    welcome: string;
  }
> = {
  en: {
    quickReplyLabels: {
      availability: "Check dates",
      pricing: "See prices",
      tour: "View 360 tour",
      contact: "Contact host",
    },
    timeout:
      "I'm checking that for you, but the concierge is taking longer than usual. Please send your villa, dates, and guest count here and the host can help confirm.",
    welcome:
      "Thanks for adding Auralis Cove Retreat. I can help with availability, prices, 360 tours, and direct booking. Tap a quick option or send your question here.",
  },
  th: {
    quickReplyLabels: {
      availability: "เช็ควันที่",
      pricing: "ดูราคา",
      tour: "ดูทัวร์ 360",
      contact: "ติดต่อโฮสต์",
    },
    timeout:
      "ผมกำลังเช็คให้อยู่ครับ แต่ระบบใช้เวลานานกว่าปกติ ส่งชื่อวิลล่า วันที่เข้าพัก และจำนวนผู้เข้าพักมาได้เลย เดี๋ยวโฮสต์ช่วยยืนยันให้ครับ",
    welcome:
      "ขอบคุณที่เพิ่ม Auralis Cove Retreat ครับ ผมช่วยดูห้องว่าง ราคา ทัวร์ 360 และการจองตรงได้เลย ส่งคำถามมาได้ครับ",
  },
  "zh-CN": {
    quickReplyLabels: {
      availability: "查看日期",
      pricing: "查看价格",
      tour: "查看 360 导览",
      contact: "联系房东",
    },
    timeout:
      "我正在为您查询，但礼宾系统响应比平时慢。请把别墅、日期和入住人数发来，房东会帮您确认。",
    welcome:
      "感谢添加 Auralis Cove Retreat。我可以帮您查询空房、价格、360 导览和直接预订。请选择快捷选项或直接发送问题。",
  },
  ja: {
    quickReplyLabels: {
      availability: "日程を確認",
      pricing: "料金を見る",
      tour: "360ツアーを見る",
      contact: "ホストに連絡",
    },
    timeout:
      "確認中ですが、コンシェルジュの応答に通常より時間がかかっています。ヴィラ名、日程、人数を送っていただければ、ホストが確認します。",
    welcome:
      "Auralis Cove Retreat を追加していただきありがとうございます。空室、料金、360ツアー、直接予約についてお手伝いできます。クイック項目を選ぶか、そのまま質問を送ってください。",
  },
  ko: {
    quickReplyLabels: {
      availability: "날짜 확인",
      pricing: "가격 보기",
      tour: "360 투어 보기",
      contact: "호스트 문의",
    },
    timeout:
      "확인 중이지만 컨시어지 응답이 평소보다 오래 걸리고 있습니다. 빌라, 날짜, 인원수를 보내주시면 호스트가 확인해 드립니다.",
    welcome:
      "Auralis Cove Retreat를 추가해 주셔서 감사합니다. 예약 가능 여부, 가격, 360 투어, 직접 예약을 도와드릴 수 있습니다. 빠른 옵션을 누르거나 질문을 보내주세요.",
  },
  fr: {
    quickReplyLabels: {
      availability: "Voir les dates",
      pricing: "Voir les prix",
      tour: "Voir la visite 360",
      contact: "Contacter l'hote",
    },
    timeout:
      "Je verifie pour vous, mais le concierge prend plus de temps que d'habitude. Envoyez la villa, les dates et le nombre de voyageurs, et l'hote pourra confirmer.",
    welcome:
      "Merci d'avoir ajoute Auralis Cove Retreat. Je peux vous aider avec les disponibilites, les prix, les visites 360 et la reservation directe. Choisissez une option rapide ou envoyez votre question ici.",
  },
  de: {
    quickReplyLabels: {
      availability: "Daten pruefen",
      pricing: "Preise ansehen",
      tour: "360-Tour ansehen",
      contact: "Host kontaktieren",
    },
    timeout:
      "Ich pruefe das gerade, aber der Concierge braucht laenger als sonst. Senden Sie bitte Villa, Daten und Gaestezahl, dann kann der Host bestaetigen.",
    welcome:
      "Danke, dass Sie Auralis Cove Retreat hinzugefuegt haben. Ich helfe bei Verfuegbarkeit, Preisen, 360-Touren und Direktbuchung. Waehlen Sie eine Schnelloption oder senden Sie Ihre Frage.",
  },
  es: {
    quickReplyLabels: {
      availability: "Ver fechas",
      pricing: "Ver precios",
      tour: "Ver tour 360",
      contact: "Contactar anfitrion",
    },
    timeout:
      "Estoy revisandolo, pero el concierge tarda mas de lo habitual. Envie la villa, fechas y numero de huespedes para que el anfitrion confirme.",
    welcome:
      "Gracias por agregar Auralis Cove Retreat. Puedo ayudar con disponibilidad, precios, tours 360 y reserva directa. Toque una opcion rapida o envie su pregunta aqui.",
  },
  ru: {
    quickReplyLabels: {
      availability: "Проверить даты",
      pricing: "Посмотреть цены",
      tour: "Смотреть 360-тур",
      contact: "Связаться с хостом",
    },
    timeout:
      "Я проверяю информацию, но консьерж отвечает дольше обычного. Отправьте виллу, даты и число гостей, и хост поможет подтвердить.",
    welcome:
      "Спасибо, что добавили Auralis Cove Retreat. Я помогу с доступностью, ценами, 360-турами и прямым бронированием. Выберите быстрый вариант или отправьте вопрос.",
  },
  it: {
    quickReplyLabels: {
      availability: "Controlla date",
      pricing: "Vedi prezzi",
      tour: "Vedi tour 360",
      contact: "Contatta host",
    },
    timeout:
      "Sto controllando, ma il concierge sta impiegando piu tempo del solito. Invia villa, date e numero di ospiti e l'host potra confermare.",
    welcome:
      "Grazie per aver aggiunto Auralis Cove Retreat. Posso aiutarti con disponibilita, prezzi, tour 360 e prenotazione diretta. Tocca un'opzione rapida o invia la tua domanda qui.",
  },
  hi: {
    quickReplyLabels: {
      availability: "तारीखें देखें",
      pricing: "कीमत देखें",
      tour: "360 टूर देखें",
      contact: "होस्ट से संपर्क",
    },
    timeout:
      "मैं आपके लिए जांच रहा हूं, लेकिन concierge सामान्य से ज्यादा समय ले रहा है। कृपया विला, तारीखें और मेहमानों की संख्या भेजें, होस्ट पुष्टि कर देगा।",
    welcome:
      "Auralis Cove Retreat जोड़ने के लिए धन्यवाद। मैं उपलब्धता, कीमत, 360 टूर और सीधी बुकिंग में मदद कर सकता हूं। कोई quick option चुनें या अपना सवाल भेजें।",
  },
};
export function normalizeQuickAnswerLocale(
  locale?: string | null,
): QuickAnswerLocale {
  return locale && isLocale(locale) ? locale : defaultLocale;
}

export function detectQuickAnswerLocale(
  text?: string,
): QuickAnswerLocale | undefined {
  const clean = text?.trim();
  if (!clean) return undefined;

  if (/[\u0E00-\u0E7F]/u.test(clean)) return "th";
  if (/[ऀ-ॿ]/u.test(clean)) return "hi";
  if (/[А-Яа-яЁё]/u.test(clean)) return "ru";
  if (/[가-힣]/u.test(clean)) return "ko";
  if (/[ぁ-ゟ゠-ヿ]/u.test(clean)) return "ja";
  if (/\p{Script=Han}/u.test(clean)) return "zh-CN";

  const normalized = normalizeLineQuestion(clean);
  if (
    /[ñáéíóúü¿¡]/u.test(normalized) ||
    /\b(precio|precios|disponibilidad|reservar|cuanto|cuesta|anfitrion)\b/u.test(
      normalized,
    )
  ) {
    return "es";
  }
  if (
    /[àâçéèêëîïôûùüÿœ]/u.test(normalized) ||
    /\b(prix|disponibilites|reservation|combien|hote|annulation)\b/u.test(
      normalized,
    )
  ) {
    return "fr";
  }
  if (
    /[äöüß]/u.test(normalized) ||
    /\b(preis|preise|verfuegbarkeit|verfügbarkeit|buchen|kostet|wieviel|stornierung)\b/u.test(
      normalized,
    )
  ) {
    return "de";
  }
  if (
    /\b(prezzo|prezzi|disponibilita|disponibilità|prenotazione|quanto costa|cancellazione)\b/u.test(
      normalized,
    )
  ) {
    return "it";
  }

  return "en";
}

export function parseLineLocaleFromPostback(data?: string) {
  if (!data?.trim()) return undefined;
  const params = new URLSearchParams(data);
  const locale = params.get("locale");
  return locale && isLocale(locale) ? locale : undefined;
}

export function localizedTimeoutFallbackReply(locale?: string | null) {
  return localeCopy[normalizeQuickAnswerLocale(locale)].timeout;
}
export function localizedUnknownFallbackReply(locale?: string | null) {
  return unknownReply(normalizeQuickAnswerLocale(locale));
}
export function normalizeLineQuestion(text: string) {
  return text
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[?.!。！？¿¡؟।]+$/u, "")
    .toLocaleLowerCase();
}

export function buildLineQuickReplyItems(
  locale?: string | null,
): LineQuickReplyItem[] {
  const normalizedLocale = normalizeQuickAnswerLocale(locale);
  const labels = localeCopy[normalizedLocale].quickReplyLabels;

  return quickReplyIntents.map((intent) => {
    const label = labels[intent];
    return {
      type: "action",
      action: {
        type: "postback",
        label,
        data: new URLSearchParams({
          intent,
          locale: normalizedLocale,
        }).toString(),
        displayText: label,
      },
    };
  });
}

export function parseLineIntentFromPostback(data?: string) {
  if (!data?.trim()) return null;
  const params = new URLSearchParams(data);
  const intent = params.get("intent");
  return isLineIntent(intent) ? intent : null;
}

function isLineIntent(value: string | null): value is LineIntent {
  return (
    value === "availability" ||
    value === "pricing" ||
    value === "direct_booking" ||
    value === "villa_details" ||
    value === "tour" ||
    value === "contact" ||
    value === "airport" ||
    value === "cancellation" ||
    value === "location" ||
    value === "amenities" ||
    value === "welcome"
  );
}

const postbackQuestions: Record<LineIntent, string> = {
  availability: "Can I check villa availability?",
  pricing: "What is the current price?",
  direct_booking: "How do I book direct?",
  villa_details: "What are the villa details?",
  tour: "How can I view the 360 tour?",
  contact: "How can I contact the host?",
  airport: "Is airport pickup included?",
  cancellation: "What is the cancellation policy?",
  location: "Where is this demo property located?",
  amenities: "What amenities are included?",
  welcome: "Hello, what can you help me with?",
};
/** Existing menu payloads become questions, never canned business claims. */
export function questionFromLinePostback(data?: string) {
  const intent = parseLineIntentFromPostback(data);
  if (!intent) return undefined;
  const locale = normalizeQuickAnswerLocale(parseLineLocaleFromPostback(data));
  if (quickReplyIntents.includes(intent as QuickReplyIntent))
    return localeCopy[locale].quickReplyLabels[intent as QuickReplyIntent];
  return postbackQuestions[intent];
}
/** Compatibility for callers: only the presentation greeting remains deterministic. */
export function resolveLineQuickAnswer(args: {
  eventType: "message" | "follow" | "postback" | "unsupported";
  locale?: string;
  messageText?: string;
  postbackData?: string;
  properties: LinePropertySummary[];
  siteUrl: string;
}): LineQuickAnswer | null {
  if (args.eventType !== "follow") return null;
  const locale = normalizeQuickAnswerLocale(args.locale);
  return {
    intent: "welcome",
    mode: "follow",
    text: localeCopy[locale].welcome,
    quickReplyItems: buildLineQuickReplyItems(locale),
  };
}
