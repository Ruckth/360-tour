import { defaultLocale, isLocale, type Locale } from "@/i18n/routing";

/**
 * LINE presentation helpers. Saved and coded answers are retired: every typed question and
 * every postback goes to the shared concierge (src/lib/chat/messaging-reply.ts). What remains
 * here is policy-free presentation copy: the quick-reply menu, the follow greeting, and the
 * timeout/unknown fallbacks. Nothing here may state prices, discounts, cancellation, pickup or
 * other business policies; those come from current records through the concierge's tools.
 */

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

export type LineQuickReplyItem = {
  type: "action";
  action: {
    type: "postback";
    label: string;
    data: string;
    displayText: string;
  };
};

export type QuickAnswerLocale = Locale;

type QuickReplyIntent = "availability" | "pricing" | "tour" | "contact";

type LocalizedCopy = {
  quickReplyLabels: Record<QuickReplyIntent, string>;
  welcome: string;
  timeout: string;
  unknown: string;
};

const quickReplyIntents = [
  "availability",
  "pricing",
  "tour",
  "contact",
] satisfies QuickReplyIntent[];

const localeCopy: Record<QuickAnswerLocale, LocalizedCopy> = {
  en: {
    quickReplyLabels: {
      availability: "Check dates",
      pricing: "See prices",
      tour: "View 360 tour",
      contact: "Contact host",
    },
    welcome:
      "Thanks for adding Auralis Cove Retreat. I can help with availability, prices, 360 tours, and direct booking. Tap a quick option or send your question here.",
    timeout:
      "I'm checking that for you, but the concierge is taking longer than usual. Please send your villa, dates, and guest count here and the host can help confirm.",
    unknown:
      "I'm not fully sure about that yet. I'll ask the team and get back to you shortly.",
  },
  th: {
    quickReplyLabels: {
      availability: "เช็ควันที่",
      pricing: "ดูราคา",
      tour: "ดูทัวร์ 360",
      contact: "ติดต่อโฮสต์",
    },
    welcome:
      "ขอบคุณที่เพิ่ม Auralis Cove Retreat ครับ ผมช่วยดูห้องว่าง ราคา ทัวร์ 360 และการจองตรงได้เลย ส่งคำถามมาได้ครับ",
    timeout:
      "ผมกำลังเช็คให้อยู่ครับ แต่ระบบใช้เวลานานกว่าปกติ ส่งชื่อวิลล่า วันที่เข้าพัก และจำนวนผู้เข้าพักมาได้เลย เดี๋ยวโฮสต์ช่วยยืนยันให้ครับ",
    unknown:
      "ผมยังไม่มั่นใจคำตอบนี้ครับ เดี๋ยวผมถามทีมงานให้แล้วจะติดต่อกลับไปโดยเร็ว",
  },
  "zh-CN": {
    quickReplyLabels: {
      availability: "查看日期",
      pricing: "查看价格",
      tour: "查看 360 导览",
      contact: "联系房东",
    },
    welcome:
      "感谢添加 Auralis Cove Retreat。我可以帮您查询空房、价格、360 导览和直接预订。请选择快捷选项或直接发送问题。",
    timeout:
      "我正在为您查询，但礼宾系统响应比平时慢。请把别墅、日期和入住人数发来，房东会帮您确认。",
    unknown:
      "我暂时还不能确定答案。我会询问团队，并尽快回复您。",
  },
  ja: {
    quickReplyLabels: {
      availability: "日程を確認",
      pricing: "料金を見る",
      tour: "360ツアーを見る",
      contact: "ホストに連絡",
    },
    welcome:
      "Auralis Cove Retreat を追加していただきありがとうございます。空室、料金、360ツアー、直接予約についてお手伝いできます。クイック項目を選ぶか、そのまま質問を送ってください。",
    timeout:
      "確認中ですが、コンシェルジュの応答に通常より時間がかかっています。ヴィラ名、日程、人数を送っていただければ、ホストが確認します。",
    unknown:
      "この回答はまだ確実ではありません。チームに確認して、できるだけ早く返信します。",
  },
  ko: {
    quickReplyLabels: {
      availability: "날짜 확인",
      pricing: "가격 보기",
      tour: "360 투어 보기",
      contact: "호스트 문의",
    },
    welcome:
      "Auralis Cove Retreat를 추가해 주셔서 감사합니다. 예약 가능 여부, 가격, 360 투어, 직접 예약을 도와드릴 수 있습니다. 빠른 옵션을 누르거나 질문을 보내주세요.",
    timeout:
      "확인 중이지만 컨시어지 응답이 평소보다 오래 걸리고 있습니다. 빌라, 날짜, 인원수를 보내주시면 호스트가 확인해 드립니다.",
    unknown:
      "아직 정확한 답변을 확신하기 어렵습니다. 팀에 확인한 뒤 곧 다시 안내드리겠습니다.",
  },
  fr: {
    quickReplyLabels: {
      availability: "Voir les dates",
      pricing: "Voir les prix",
      tour: "Voir la visite 360",
      contact: "Contacter l'hote",
    },
    welcome:
      "Merci d'avoir ajoute Auralis Cove Retreat. Je peux vous aider avec les disponibilites, les prix, les visites 360 et la reservation directe. Choisissez une option rapide ou envoyez votre question ici.",
    timeout:
      "Je verifie pour vous, mais le concierge prend plus de temps que d'habitude. Envoyez la villa, les dates et le nombre de voyageurs, et l'hote pourra confirmer.",
    unknown:
      "Je ne suis pas encore totalement certain de la reponse. Je vais demander a l'equipe et revenir vers vous rapidement.",
  },
  de: {
    quickReplyLabels: {
      availability: "Daten pruefen",
      pricing: "Preise ansehen",
      tour: "360-Tour ansehen",
      contact: "Host kontaktieren",
    },
    welcome:
      "Danke, dass Sie Auralis Cove Retreat hinzugefuegt haben. Ich helfe bei Verfuegbarkeit, Preisen, 360-Touren und Direktbuchung. Waehlen Sie eine Schnelloption oder senden Sie Ihre Frage.",
    timeout:
      "Ich pruefe das gerade, aber der Concierge braucht laenger als sonst. Senden Sie bitte Villa, Daten und Gaestezahl, dann kann der Host bestaetigen.",
    unknown:
      "Ich bin mir bei dieser Antwort noch nicht ganz sicher. Ich frage das Team und melde mich schnell wieder.",
  },
  es: {
    quickReplyLabels: {
      availability: "Ver fechas",
      pricing: "Ver precios",
      tour: "Ver tour 360",
      contact: "Contactar anfitrion",
    },
    welcome:
      "Gracias por agregar Auralis Cove Retreat. Puedo ayudar con disponibilidad, precios, tours 360 y reserva directa. Toque una opcion rapida o envie su pregunta aqui.",
    timeout:
      "Estoy revisandolo, pero el concierge tarda mas de lo habitual. Envie la villa, fechas y numero de huespedes para que el anfitrion confirme.",
    unknown:
      "Todavia no estoy completamente seguro de esa respuesta. Consultare al equipo y le respondere pronto.",
  },
  ru: {
    quickReplyLabels: {
      availability: "Проверить даты",
      pricing: "Посмотреть цены",
      tour: "Смотреть 360-тур",
      contact: "Связаться с хостом",
    },
    welcome:
      "Спасибо, что добавили Auralis Cove Retreat. Я помогу с доступностью, ценами, 360-турами и прямым бронированием. Выберите быстрый вариант или отправьте вопрос.",
    timeout:
      "Я проверяю информацию, но консьерж отвечает дольше обычного. Отправьте виллу, даты и число гостей, и хост поможет подтвердить.",
    unknown:
      "Я пока не полностью уверен в ответе. Я уточню у команды и скоро вернусь с ответом.",
  },
  it: {
    quickReplyLabels: {
      availability: "Controlla date",
      pricing: "Vedi prezzi",
      tour: "Vedi tour 360",
      contact: "Contatta host",
    },
    welcome:
      "Grazie per aver aggiunto Auralis Cove Retreat. Posso aiutarti con disponibilita, prezzi, tour 360 e prenotazione diretta. Tocca un'opzione rapida o invia la tua domanda qui.",
    timeout:
      "Sto controllando, ma il concierge sta impiegando piu tempo del solito. Invia villa, date e numero di ospiti e l'host potra confermare.",
    unknown:
      "Non sono ancora completamente sicuro della risposta. Chiedero al team e ti rispondero a breve.",
  },
  hi: {
    quickReplyLabels: {
      availability: "तारीखें देखें",
      pricing: "कीमत देखें",
      tour: "360 टूर देखें",
      contact: "होस्ट से संपर्क",
    },
    welcome:
      "Auralis Cove Retreat जोड़ने के लिए धन्यवाद। मैं उपलब्धता, कीमत, 360 टूर और सीधी बुकिंग में मदद कर सकता हूं। कोई quick option चुनें या अपना सवाल भेजें।",
    timeout:
      "मैं आपके लिए जांच रहा हूं, लेकिन concierge सामान्य से ज्यादा समय ले रहा है। कृपया विला, तारीखें और मेहमानों की संख्या भेजें, होस्ट पुष्टि कर देगा।",
    unknown:
      "मैं अभी इस जवाब को लेकर पूरी तरह निश्चित नहीं हूं। मैं टीम से पूछकर जल्द आपको बताऊंगा।",
  },
};

/** Common short phrases, used only to detect the guest's language (never to pick an answer). */
const localeHintPhrases: Array<[QuickAnswerLocale, LineIntent, string[]]> = [
  ["en", "availability", ["check dates", "check availability", "availability", "can i check availability"]],
  ["en", "pricing", ["see prices", "price", "prices", "pricing", "how much is it", "how much"]],
  ["en", "direct_booking", ["direct booking", "direct booking discount", "book direct"]],
  ["en", "villa_details", ["villa details", "property details", "which villas do you have"]],
  ["en", "tour", ["view 360 tour", "360 tour", "virtual tour"]],
  ["en", "contact", ["contact host", "contact", "message host"]],
  ["en", "airport", ["airport pickup", "airport transfer", "pickup from airport"]],
  ["en", "cancellation", ["cancellation", "cancellation policy", "refund policy"]],
  ["en", "location", ["location", "where are you located", "where is the resort"]],
  ["en", "amenities", ["amenities", "what is included", "facilities"]],

  ["th", "availability", ["ห้องว่าง", "เช็คห้องว่าง", "ตรวจสอบห้องว่าง"]],
  ["th", "pricing", ["ราคา", "ดูราคา", "ราคาเท่าไหร่"]],
  ["th", "direct_booking", ["จองตรง", "ส่วนลดจองตรง"]],
  ["th", "villa_details", ["รายละเอียดวิลล่า", "มีวิลล่าอะไรบ้าง"]],
  ["th", "tour", ["ดูทัวร์ 360", "ทัวร์ 360"]],
  ["th", "contact", ["ติดต่อโฮสต์", "ติดต่อ"]],
  ["th", "airport", ["รับสนามบิน", "รถรับส่งสนามบิน"]],
  ["th", "cancellation", ["ยกเลิกการจอง", "นโยบายยกเลิก"]],
  ["th", "location", ["ที่ตั้ง", "อยู่ที่ไหน"]],
  ["th", "amenities", ["สิ่งอำนวยความสะดวก", "มีอะไรให้บ้าง"]],

  ["zh-CN", "availability", ["查看日期", "有空房吗", "查看空房"]],
  ["zh-CN", "pricing", ["查看价格", "价格是多少", "多少钱"]],
  ["zh-CN", "direct_booking", ["直接预订", "直接预订折扣"]],
  ["zh-CN", "villa_details", ["别墅详情", "有哪些别墅"]],
  ["zh-CN", "tour", ["360导览", "查看360导览"]],
  ["zh-CN", "contact", ["联系房东", "联系"]],
  ["zh-CN", "airport", ["机场接送", "机场接机"]],
  ["zh-CN", "cancellation", ["取消政策", "取消预订"]],
  ["zh-CN", "location", ["位置", "在哪里"]],
  ["zh-CN", "amenities", ["设施", "包含什么"]],

  ["ja", "availability", ["日程を確認", "空室状況", "空きはありますか"]],
  ["ja", "pricing", ["料金を見る", "料金はいくらですか", "いくらですか"]],
  ["ja", "direct_booking", ["直接予約", "直接予約割引"]],
  ["ja", "villa_details", ["ヴィラ詳細", "どんなヴィラがありますか"]],
  ["ja", "tour", ["360ツアー", "360ツアーを見る"]],
  ["ja", "contact", ["ホストに連絡", "連絡"]],
  ["ja", "airport", ["空港送迎", "空港ピックアップ"]],
  ["ja", "cancellation", ["キャンセルポリシー", "キャンセル"]],
  ["ja", "location", ["場所", "どこにありますか"]],
  ["ja", "amenities", ["設備", "何が含まれますか"]],

  ["ko", "availability", ["날짜 확인", "예약 가능 여부", "빈방 있나요"]],
  ["ko", "pricing", ["가격 보기", "가격이 얼마인가요", "얼마인가요"]],
  ["ko", "direct_booking", ["직접 예약", "직접 예약 할인"]],
  ["ko", "villa_details", ["빌라 상세", "어떤 빌라가 있나요"]],
  ["ko", "tour", ["360 투어", "360 투어 보기"]],
  ["ko", "contact", ["호스트 문의", "문의"]],
  ["ko", "airport", ["공항 픽업", "공항 이동"]],
  ["ko", "cancellation", ["취소 정책", "취소"]],
  ["ko", "location", ["위치", "어디에 있나요"]],
  ["ko", "amenities", ["편의시설", "무엇이 포함되나요"]],

  ["fr", "availability", ["voir les disponibilites", "verifier les dates", "disponibilites"]],
  ["fr", "pricing", ["voir les prix", "quel est le prix", "combien ca coute"]],
  ["fr", "direct_booking", ["reservation directe", "reduction reservation directe"]],
  ["fr", "villa_details", ["details des villas", "quelles villas avez-vous"]],
  ["fr", "tour", ["visite 360", "voir la visite 360"]],
  ["fr", "contact", ["contacter l'hote", "contact"]],
  ["fr", "airport", ["transfert aeroport", "prise en charge aeroport"]],
  ["fr", "cancellation", ["politique d'annulation", "annulation"]],
  ["fr", "location", ["emplacement", "ou etes-vous situes"]],
  ["fr", "amenities", ["equipements", "qu'est-ce qui est inclus"]],

  ["de", "availability", ["daten pruefen", "verfuegbarkeit pruefen", "verfuegbarkeit"]],
  ["de", "pricing", ["preise ansehen", "wie viel kostet es", "was kostet es"]],
  ["de", "direct_booking", ["direktbuchung", "direktbuchungsrabatt"]],
  ["de", "villa_details", ["villendetails", "welche villen gibt es"]],
  ["de", "tour", ["360-tour", "360-tour ansehen"]],
  ["de", "contact", ["host kontaktieren", "kontakt"]],
  ["de", "airport", ["flughafentransfer", "abholung vom flughafen"]],
  ["de", "cancellation", ["stornierung", "stornierungsbedingungen"]],
  ["de", "location", ["lage", "wo befinden sie sich"]],
  ["de", "amenities", ["ausstattung", "was ist inbegriffen"]],

  ["es", "availability", ["ver fechas", "ver disponibilidad", "consultar fechas"]],
  ["es", "pricing", ["ver precios", "cuanto cuesta", "precio"]],
  ["es", "direct_booking", ["reserva directa", "descuento de reserva directa"]],
  ["es", "villa_details", ["detalles de las villas", "que villas tienen"]],
  ["es", "tour", ["tour 360", "ver tour 360"]],
  ["es", "contact", ["contactar anfitrion", "contacto"]],
  ["es", "airport", ["recogida aeropuerto", "traslado aeropuerto"]],
  ["es", "cancellation", ["politica de cancelacion", "cancelacion"]],
  ["es", "location", ["ubicacion", "donde estan"]],
  ["es", "amenities", ["servicios", "que incluye"]],

  ["ru", "availability", ["проверить даты", "доступность", "есть ли свободные номера"]],
  ["ru", "pricing", ["посмотреть цены", "сколько стоит", "цена"]],
  ["ru", "direct_booking", ["прямое бронирование", "скидка при прямом бронировании"]],
  ["ru", "villa_details", ["детали вилл", "какие виллы есть"]],
  ["ru", "tour", ["360-тур", "смотреть 360-тур"]],
  ["ru", "contact", ["связаться с хостом", "контакт"]],
  ["ru", "airport", ["трансфер из аэропорта", "встреча в аэропорту"]],
  ["ru", "cancellation", ["правила отмены", "отмена"]],
  ["ru", "location", ["расположение", "где вы находитесь"]],
  ["ru", "amenities", ["удобства", "что включено"]],

  ["it", "availability", ["controlla date", "verifica disponibilita", "disponibilita"]],
  ["it", "pricing", ["vedi prezzi", "quanto costa", "prezzo"]],
  ["it", "direct_booking", ["prenotazione diretta", "sconto prenotazione diretta"]],
  ["it", "villa_details", ["dettagli ville", "quali ville avete"]],
  ["it", "tour", ["tour 360", "vedi tour 360"]],
  ["it", "contact", ["contatta host", "contatto"]],
  ["it", "airport", ["pickup aeroporto", "transfer aeroporto"]],
  ["it", "cancellation", ["politica di cancellazione", "cancellazione"]],
  ["it", "location", ["posizione", "dove siete"]],
  ["it", "amenities", ["servizi", "cosa e incluso"]],

  ["hi", "availability", ["तारीखें देखें", "उपलब्धता जांचें", "कमरा उपलब्ध है"]],
  ["hi", "pricing", ["कीमत देखें", "कीमत कितनी है", "कितना खर्च है"]],
  ["hi", "direct_booking", ["सीधी बुकिंग", "सीधी बुकिंग छूट"]],
  ["hi", "villa_details", ["विला विवरण", "कौन से विला हैं"]],
  ["hi", "tour", ["360 टूर", "360 टूर देखें"]],
  ["hi", "contact", ["होस्ट से संपर्क", "संपर्क"]],
  ["hi", "airport", ["एयरपोर्ट पिकअप", "एयरपोर्ट ट्रांसफर"]],
  ["hi", "cancellation", ["रद्द करने की नीति", "कैंसलेशन"]],
  ["hi", "location", ["स्थान", "कहां है"]],
  ["hi", "amenities", ["सुविधाएं", "क्या शामिल है"]],
];

const localeHints = new Map<string, QuickAnswerLocale>();
for (const [locale, , phrases] of localeHintPhrases) {
  for (const phrase of phrases) localeHints.set(normalizeLineQuestion(phrase), locale);
}

export function normalizeQuickAnswerLocale(locale?: string | null): QuickAnswerLocale {
  return locale && isLocale(locale) ? locale : defaultLocale;
}

export function detectQuickAnswerLocale(text?: string): QuickAnswerLocale | undefined {
  const clean = text?.trim();
  if (!clean) return undefined;

  const hinted = localeHints.get(normalizeLineQuestion(clean));
  if (hinted) return hinted;

  if (/[\u0E00-\u0E7F]/u.test(clean)) return "th";
  if (/[ऀ-ॿ]/u.test(clean)) return "hi";
  if (/[А-Яа-яЁё]/u.test(clean)) return "ru";
  if (/[가-힣]/u.test(clean)) return "ko";
  if (/[ぁ-ゟ゠-ヿ]/u.test(clean)) return "ja";
  if (/\p{Script=Han}/u.test(clean)) return "zh-CN";

  const normalized = normalizeLineQuestion(clean);
  if (/[ñáéíóúü¿¡]/u.test(normalized) || /\b(precio|precios|disponibilidad|reservar|cuanto|cuesta|anfitrion)\b/u.test(normalized)) {
    return "es";
  }
  if (/[àâçéèêëîïôûùüÿœ]/u.test(normalized) || /\b(prix|disponibilites|reservation|combien|hote|annulation)\b/u.test(normalized)) {
    return "fr";
  }
  if (/[äöüß]/u.test(normalized) || /\b(preis|preise|verfuegbarkeit|verfügbarkeit|buchen|kostet|wieviel|stornierung)\b/u.test(normalized)) {
    return "de";
  }
  if (/\b(prezzo|prezzi|disponibilita|disponibilità|prenotazione|quanto costa|cancellazione)\b/u.test(normalized)) {
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
  return localeCopy[normalizeQuickAnswerLocale(locale)].unknown;
}

/** The follow/greeting text: a policy-free welcome in the guest's language. */
export function localizedGreetingReply(locale?: string | null) {
  return localeCopy[normalizeQuickAnswerLocale(locale)].welcome;
}

export function normalizeLineQuestion(text: string) {
  return text
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[?.!。！？¿¡؟।]+$/u, "")
    .toLocaleLowerCase();
}

export function buildLineQuickReplyItems(locale?: string | null): LineQuickReplyItem[] {
  const normalizedLocale = normalizeQuickAnswerLocale(locale);
  const labels = localeCopy[normalizedLocale].quickReplyLabels;

  return quickReplyIntents.map((intent) => {
    const label = labels[intent];
    return {
      type: "action",
      action: {
        type: "postback",
        label,
        data: new URLSearchParams({ intent, locale: normalizedLocale }).toString(),
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

const POSTBACK_QUESTIONS: Record<Exclude<LineIntent, QuickReplyIntent | "welcome">, string> = {
  direct_booking: "What are the benefits of booking direct?",
  villa_details: "Which villas do you have?",
  airport: "Do you offer airport pickup?",
  cancellation: "What is the cancellation policy?",
  location: "Where are you located?",
  amenities: "What amenities do the villas have?",
};

/**
 * A LINE postback becomes the ordinary question the guest saw themselves send (its displayText),
 * so it is answered by the same concierge as typed text. No fixed answer is attached.
 */
export function questionFromLinePostback(data?: string): string | undefined {
  const intent = parseLineIntentFromPostback(data);
  if (!intent || intent === "welcome") return undefined;
  const locale = normalizeQuickAnswerLocale(parseLineLocaleFromPostback(data));
  if ((quickReplyIntents as readonly string[]).includes(intent)) {
    return localeCopy[locale].quickReplyLabels[intent as QuickReplyIntent];
  }
  return POSTBACK_QUESTIONS[intent as keyof typeof POSTBACK_QUESTIONS];
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
