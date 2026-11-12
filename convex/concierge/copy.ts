export const locales = ['en','th','zh-CN','ja','ko','fr','de','es','ru','it','hi'] as const;
type Locale = typeof locales[number];
const defaultLocale = 'en';
const isLocale = (value: string): value is Locale => (locales as readonly string[]).includes(value);
const unknownCopy: Record<string, string> = {
  en: "I do not have verified information about that yet. Please contact the host here for help.",
  th: "ยังไม่มีข้อมูลที่ยืนยันแล้วเกี่ยวกับเรื่องนี้ กรุณาติดต่อเจ้าของที่พักในแชตนี้เพื่อขอความช่วยเหลือ",
  ko: "아직 확인된 정보가 없습니다. 이 채팅에서 호스트에게 문의해 주세요.",
  "zh-CN": "目前没有经过确认的信息。请在此聊天中联系房东。",
  ja: "確認済みの情報がありません。このチャットでホストにお問い合わせください。",
  fr: "Je n’ai pas encore d’information vérifiée. Veuillez contacter l’hôte ici.",
  de: "Dazu habe ich noch keine bestätigten Informationen. Bitte kontaktieren Sie hier den Gastgeber.",
  es: "Aún no tengo información verificada. Contacta con el anfitrión aquí.",
  ru: "Подтверждённой информации пока нет. Свяжитесь с хозяином здесь.",
  it: "Non ho ancora informazioni verificate. Contatta qui il proprietario.",
  hi: "अभी सत्यापित जानकारी नहीं है। कृपया इस चैट में मेज़बान से संपर्क करें।",
};

export function unknownReply(locale?: string | null) {
  const reply = locale ? unknownCopy[locale] : undefined;
  return typeof reply === "string" ? reply : unknownCopy.en;
}

export function detectReplyLocale(text?: string) {
  const clean = text?.trim();
  if (!clean) return undefined;

  if (/[\u0E00-\u0E7F]/u.test(clean)) return "th";
  if (/[ऀ-ॿ]/u.test(clean)) return "hi";
  if (/[А-Яа-яЁё]/u.test(clean)) return "ru";
  if (/[가-힣]/u.test(clean)) return "ko";
  if (/[ぁ-ゟ゠-ヿ]/u.test(clean)) return "ja";
  if (/\p{Script=Han}/u.test(clean)) return "zh-CN";

  const normalized = clean.normalize("NFKC").toLowerCase();
  const realityLanguage = realityGuardrailPatterns.find(candidate => candidate.patterns.some(pattern => pattern.test(normalized)))?.locale;
  if (realityLanguage) return realityLanguage;
  if (/\b(?:voir|visite)\b/u.test(normalized)) return 'fr';
  if (/\b(?:ansehen|kontakt)\b/u.test(normalized)) return 'de';
  if (/\bvedi\b/u.test(normalized)) return 'it';
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

export function normalizeQuickAnswerLocale(locale?: string | null): QuickAnswerLocale {
  return locale && isLocale(locale) ? locale : defaultLocale;
}

export function detectQuickAnswerLocale(text?: string): QuickAnswerLocale | undefined {
 const clean = text?.trim();
 if (!clean) return undefined;
 return detectReplyLocale(clean);
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

export function localizedUnknownFallbackReply(locale?: string | null) { return unknownReply(normalizeQuickAnswerLocale(locale)); }

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

function normalizeSiteUrl(siteUrl?: string) {
	const trimmed = siteUrl?.trim().replace(/\/+$/, '');
	if (!trimmed) return undefined;

	try {
		return new URL(trimmed).origin;
	} catch {
		return trimmed;
	}
}



type RealityGuardrailLocale =
	| 'en'
	| 'th'
	| 'zh-CN'
	| 'ja'
	| 'ko'
	| 'fr'
	| 'de'
	| 'es'
	| 'ru'
	| 'it'
	| 'hi';

const realityGuardrailPatterns: Array<{
	locale: RealityGuardrailLocale;
	patterns: RegExp[];
}> = [
	{
		locale: 'th',
		patterns: [/(จริงไหม|มีอยู่จริง|ที่พักจริง|รีสอร์ตจริง|หลอกลวง|ปลอม)/u]
	},
	{
		locale: 'zh-CN',
		patterns: [/(真的|真实吗|是真的吗|真实存在|存在吗|骗局|诈骗|虚假|假的|假的吗)/u]
	},
	{
		locale: 'ja',
		patterns: [/(本当|実在|存在しますか|詐欺|偽物|本物|本当にある)/u, /(?:(?:この|その|あの)(?:リゾート|ホテル|宿)|auralis cove retreat)\s*(?:は|が)\s*ありますか/u]
	},
	{
		locale: 'ko',
		patterns: [/(진짜|실제|실존|존재|사기|가짜|정말 있는)/u, /(?:(?:이|그|저)\s*(?:리조트|숙소|호텔)|auralis cove retreat)\s*(?:가|이|은|는)\s*(?:정말\s*)?있나요/u]
	},
	{
		locale: 'hi',
		patterns: [/(असली|वास्तविक|सच में|मौजूद|धोखा|घोटाला|नकली|फर्जी)/u]
	},
	{
		locale: 'ru',
		patterns: [/(настоящ|реальн|существу|мошенничеств|скам|фейк|подделк|легитим)/u]
	},
	{
		locale: 'fr',
		patterns: [/\b(réel|réelle|vrai|vraie|existe|arnaque|faux|fausse|authentique|légitime)\b/u]
	},
	{
		locale: 'es',
		patterns: [
			/\b(existe|estafa|falso|falsa|auténtico|auténtica|legítimo|legítima|verdadero|verdadera)\b/u,
			/\b(es|esto|lugar|sitio)\b.*\breal\b/u,
			/\breal\b.*\b(es|esto|lugar|sitio)\b/u
		]
	},
	{
		locale: 'it',
		patterns: [
			/\b(esiste|truffa|falso|falsa|autentico|autentica|legittimo|legittima|vero|vera)\b/u,
			/(?:^|\s)(è|e|questo|questa|posto|sito)(?:\s|$).*\breale?\b/u,
			/\breale?\b.*(?:^|\s)(è|e|questo|questa|posto|sito)(?:\s|$)/u
		]
	},
	{
		locale: 'de',
		patterns: [
			/\b(echt\w*|wirklich|existiert|betrug|legitim)\b/u,
			/\b(ist|das|seite)\b.*\breal\b/u,
			/\breal\b.*\b(ist|das|seite)\b/u
		]
	},
	{
		locale: 'en',
		patterns: [
			/\b(is|this|it|place|resort|villa|property|business|site)\b.*\b(real|legit|genuine|exist|exists|scam|fake|authentic|verified)\b/u,
			/\b(real|legit|genuine|authentic|verified)\b.*\b(place|resort|villa|property|business|site)\b/u,
			/\b(scam|fake|legit|genuine|authentic|verified)\b/u
		]
	}
];

const realityDisclosureByLocale: Record<RealityGuardrailLocale, (linkText: string) => string> = {
	en: (linkText) =>
		`Auralis Cove Retreat is presented here as a demo/preview experience for booking and 360° villa tours, so I should not claim it is a real-world verified resort from this chat. I can still help you explore the demo villas, pricing, availability, and tour links${linkText}.`,
	th: (linkText) =>
		`Auralis Cove Retreat ในเว็บไซต์นี้เป็นประสบการณ์เดโม/พรีวิวสำหรับการจองและทัวร์ 360° จึงไม่ควรยืนยันว่าเป็นรีสอร์ตจริงจากแชทนี้ได้ครับ ผมช่วยดูข้อมูลเดโมวิลล่า ราคา ห้องว่าง และลิงก์ทัวร์ให้ได้${linkText}`,
	'zh-CN': (linkText) =>
		`Auralis Cove Retreat 在这里是一个用于预订和 360° 别墅导览的演示/预览体验，所以我不能在聊天中声称它是经过现实世界独立验证的度假村。我仍然可以帮您了解演示别墅、价格、可订情况和 360° 导览链接${linkText}。`,
	ja: (linkText) =>
		`Auralis Cove Retreat は、このサイトでは予約と360°ヴィラツアー用のデモ/プレビュー体験として表示されています。そのため、このチャットで実在確認済みのリゾートだとは断言できません。デモヴィラ、料金、空室状況、360°ツアーリンクの案内はできます${linkText}。`,
	ko: (linkText) =>
		`Auralis Cove Retreat는 이 사이트에서 예약과 360° 빌라 투어를 위한 데모/미리보기 경험으로 제공됩니다. 따라서 이 채팅에서 실제로 독립 검증된 리조트라고 말할 수는 없습니다. 대신 데모 빌라, 가격, 예약 가능 여부, 360° 투어 링크는 도와드릴 수 있습니다${linkText}.`,
	fr: (linkText) =>
		`Auralis Cove Retreat est présenté ici comme une expérience de démonstration/aperçu pour la réservation et les visites de villas à 360°. Je ne dois donc pas affirmer dans ce chat qu'il s'agit d'un resort vérifié dans le monde réel. Je peux toutefois vous aider avec les villas de démonstration, les prix, les disponibilités et les liens de visite 360°${linkText}.`,
	de: (linkText) =>
		`Auralis Cove Retreat wird hier als Demo-/Vorschau-Erlebnis für Buchungen und 360°-Villentouren präsentiert. Deshalb sollte ich in diesem Chat nicht behaupten, dass es ein real verifiziertes Resort ist. Ich kann Ihnen aber mit den Demo-Villen, Preisen, Verfügbarkeit und 360°-Tour-Links helfen${linkText}.`,
	es: (linkText) =>
		`Auralis Cove Retreat se presenta aquí como una experiencia demo/vista previa para reservas y tours de villas en 360°. Por eso no debo afirmar en este chat que sea un resort verificado en el mundo real. Sí puedo ayudarle con las villas demo, precios, disponibilidad y enlaces al tour 360°${linkText}.`,
	ru: (linkText) =>
		`Auralis Cove Retreat здесь представлен как демо/предпросмотр для бронирования и 360°-туров по виллам. Поэтому в этом чате я не должен утверждать, что это независимо проверенный реальный курорт. Я могу помочь с демо-виллами, ценами, доступностью и ссылками на 360°-тур${linkText}.`,
	it: (linkText) =>
		`Auralis Cove Retreat qui è presentato come esperienza demo/anteprima per prenotazioni e tour delle ville a 360°. Per questo non devo affermare in chat che sia un resort verificato nel mondo reale. Posso comunque aiutarti con le ville demo, i prezzi, la disponibilità e i link ai tour 360°${linkText}.`,
	hi: (linkText) =>
		`Auralis Cove Retreat यहां booking और 360° villa tours के लिए demo/preview experience के रूप में दिखाया गया है, इसलिए मैं इस chat में यह दावा नहीं कर सकता कि यह real-world verified resort है। मैं फिर भी demo villas, pricing, availability और 360° tour links में मदद कर सकता हूं${linkText}.`
};

function isRealityQuestion(message: string): boolean {
 const normalized = message.normalize('NFKC').trim().toLocaleLowerCase();
 return !!normalized && realityGuardrailPatterns.some(candidate => candidate.patterns.some(pattern => pattern.test(normalized)));
}

export function getResortRealityDisclosure(message: string, siteUrl?: string) {
	if (!isRealityQuestion(message)) return null;
 const locale = detectReplyLocale(message) ?? 'en';

	const normalizedSiteUrl = normalizeSiteUrl(siteUrl);
	const linkText = normalizedSiteUrl ? ` ${normalizedSiteUrl}` : '';

	return realityDisclosureByLocale[locale](linkText);
}

export function getUnknownFallbackResponse(message: string, locale?: string) {
  return unknownReply(locale ?? detectReplyLocale(message));
}


import { chatCouponSummary } from '../lib/chatCouponCopy';
import type { EffectiveSettings } from '../lib/siteSettings';

export function replyLocale(message: string): 'en' | 'th' | 'ko' {
	const locale = detectReplyLocale(message);
 return locale === 'th' || locale === 'ko' ? locale : 'en';
}

export function requiresLiveFacts(message: string) {
	return /\b(price|pricing|cost|rates?|nightly|discount|guests?|cancellation|refund|policy|availability|available|book|booking|reservation|cancel|check[ -]?in|check[ -]?out|services?|spa|massage|duration|capacity|bedrooms?|bathrooms?)\b|฿|THB|ราคา|ส่วนลด|ว่าง|จอง|ยกเลิก|บริการ|นวด|จำนวนห้อง|เช(?:็|้)ก(?:อิน|เอา(?:ต์|ท์))|요금|가격|예약|취소|서비스|마사지|체크인|체크아웃/iu.test(message);
}

export function isCheckTimeQuestion(message: string) {
	if (!/check[ -]?(?:in|out)|เช(?:็|้)ก(?:อิน|เอา(?:ต์|ท์))|체크인|체크아웃/iu.test(message)) return false;
	const remaining = message.toLowerCase()
		.replace(/check[ -]?(?:in|out)/gu, '')
		.replace(/\b(?:what|which|when|time|times|is|are|the|your|and|please|tell|me|can|you)\b/gu, '')
		.replace(/เช(?:็|้)ก(?:อิน|เอา(?:ต์|ท์))|เวลา|กี่โมง|เมื่อไหร่|ครับ|ค่ะ|คะ|และ|ได้|ตอน|체크아웃|체크인|알려주세요|인가요|시간|몇|시|은|는|과|와|하고/gu, '')
		.replace(/[\s?!.\/,;&-]/gu, '');
	return remaining.length === 0;
}

export function checkTimeReply(message: string, settings: EffectiveSettings, requestedLocale?: string) {
	if (!isCheckTimeQuestion(message)) return null;
	const locale = requestedLocale ?? replyLocale(message);
	if (locale === 'th') return `เช็กอินตั้งแต่ ${settings.checkInTime} น. และเช็กเอาต์ภายใน ${settings.checkOutTime} น. ตามเวลา ${settings.timezone} ครับ`;
	if (locale === 'ko') return `체크인은 ${settings.checkInTime}부터, 체크아웃은 ${settings.checkOutTime}까지입니다. 시간대는 ${settings.timezone}입니다.`;
	return `Check-in is from ${settings.checkInTime}; check-out is by ${settings.checkOutTime} (${settings.timezone}).`;
}

export function capabilityReply(message: string) {
	const locale = replyLocale(message);
	if (/\breschedul|\bmove\b.{0,50}\b(?:booking|appointment|reservation)\b|เลื่อน(?:นัด|เวลา|วัน|จอง)|เปลี่ยน(?:วัน|เวลา).{0,30}(?:จอง|นัด)|예약.{0,30}변경|일정.{0,20}변경/iu.test(message)) {
		return {
			en: 'I cannot reschedule an existing booking in chat yet. Your existing booking has not been changed. Please contact the host to arrange the change.',
			th: 'ตอนนี้ผมยังเลื่อนวันหรือเวลาของการจองเดิมในแชตไม่ได้ครับ การจองเดิมยังไม่ถูกเปลี่ยน กรุณาติดต่อเจ้าหน้าที่เพื่อจัดการเลื่อนนัดครับ',
			ko: '현재 채팅에서는 기존 예약의 일정을 변경할 수 없습니다. 기존 예약은 변경되지 않았습니다. 변경은 담당자에게 문의해 주세요.'
		}[locale];
	}
	if (/(?:write|generate|create|debug).{0,50}(?:python|javascript|script|code)|(?:python|javascript).{0,30}(?:script|code)|(?:เขียน|สร้าง|แก้).{0,20}(?:โค้ด|โปรแกรม|สคริปต์)|(?:코드|스크립트).{0,20}(?:작성|만들)/iu.test(message)) {
		return {
			en: 'I can help with villas, services, pricing, availability, bookings, and tours. Which of those would you like help with?',
			th: 'ผมช่วยเรื่องวิลล่า บริการ ราคา วันว่าง การจอง และทัวร์ได้ครับ ต้องการให้ช่วยเรื่องไหนครับ?',
			ko: '빌라, 서비스, 가격, 예약 가능 여부, 예약 및 투어를 도와드릴 수 있습니다. 어떤 도움이 필요하신가요?'
		}[locale];
	}
	return null;
}

export function isGuestConfirmation(message: string) {
	return /^(?:(?:yes|yeah|yep|ok(?:ay)?)(?:[\s,]+(?:please|confirm(?: it| the booking)?|cancel it))?|confirm(?: it| the booking)?|please confirm|(?:ใช่|ยืนยัน|ตกลง)(?:\s*(?:ครับ|ค่ะ))?|(?:네|예|확인)(?:해 주세요|합니다)?)[\s.!]*$/iu.test(message.trim());
}

export function isCancellationPolicyQuestion(message: string) {
	return /^(?:(?:what(?: is|'s)|tell me|explain)\s+)?(?:(?:the|your)\s+)?cancellation policy[\s?!.]*$|^(?:นโยบายยกเลิก|นโยบายการยกเลิก)(?:เป็นยังไง|คืออะไร|ครับ|ค่ะ|\s|[?!.])*$|^취소\s*정책(?:은|이|을|\s|무엇인가요|알려주세요|[?!.])*$/iu.test(message.trim());
}

export function cancellationPolicyReply(message: string, settings: EffectiveSettings) {
	if (!isCancellationPolicyQuestion(message)) return null;
	return settings.cancellationPolicy || { en: 'Please ask the host for the current cancellation policy.', th: 'กรุณาสอบถามนโยบายยกเลิกล่าสุดกับเจ้าหน้าที่ครับ', ko: '현재 취소 정책은 담당자에게 문의해 주세요.' }[replyLocale(message)];
}

export function isCancellationRequest(message: string) {
	return /cancel|ยกเลิก|취소/iu.test(message) && !/\b(?:no|not|don't|do not|never)\b|ไม่|취소하지|아니/iu.test(message);
}

export function toolFailureReply(message: string) {
	return {
		en: 'I could not verify the result of that request. Please check your booking status with the host before trying again.',
		th: 'ผมยังยืนยันผลคำขอนี้ไม่ได้ครับ กรุณาตรวจสถานะการจองกับเจ้าหน้าที่ก่อนลองอีกครั้งครับ',
		ko: '요청 결과를 확인할 수 없습니다. 다시 시도하기 전에 담당자에게 예약 상태를 확인해 주세요.'
	}[replyLocale(message)];
}

/** Only committed tool results may supply transaction acknowledgements. */
export function committedReply(name: string, result: Record<string, unknown>, message: string): string | null {
	if (result.error || result.ok === false) return null;
	const locale = replyLocale(message);
	if (name === 'confirm_booking' && typeof result.confirmationCode === 'string' && typeof result.total === 'number') {
		const title = { en: result.status === 'paid' ? 'Villa booking confirmed; payment received.' : 'Villa booking created; payment is pending.', th: result.status === 'paid' ? 'ยืนยันการจองวิลล่าแล้วครับ ชำระเงินแล้ว' : 'สร้างการจองวิลล่าแล้วครับ ยังรอชำระเงิน', ko: result.status === 'paid' ? '빌라 예약이 확정되었습니다. 결제가 완료되었습니다.' : '빌라 예약이 생성되었습니다. 결제 대기 중입니다.' }[locale];
		return `${title}\n${result.confirmationCode}\n${result.property} · ${result.checkIn} → ${result.checkOut}\n${result.guests} guests · ${result.nights} nights\n${result.currency} ${result.total.toLocaleString('en-US')}\n${chatCouponSummary(result.coupon, result.currency, locale)}\n${typeof result.paymentUrl === 'string' ? result.paymentUrl : ''}`.trim();
	}
	if (name === 'confirm_service_booking' && typeof result.confirmationCode === 'string') {
		const title = { en: 'Service booking confirmed. Payment is at the resort.', th: 'ยืนยันการจองบริการแล้วครับ ชำระเงินที่รีสอร์ต', ko: '서비스 예약이 확정되었습니다. 리조트에서 결제해 주세요.' }[locale];
		return `${title}\n${result.confirmationCode}\n${result.service} · ${result.date} ${result.time}\n${result.staff}\n${result.currency} ${Number(result.price).toLocaleString('en-US')}`;
	}
	if (name === 'cancel_booking' && ['cancelled', 'already_cancelled'].includes(String(result.state))) {
		return `${{ en: 'Booking cancelled.', th: 'ยกเลิกการจองแล้วครับ', ko: '예약이 취소되었습니다.' }[locale]}\n${result.reference}`;
	}
	return null;
}

export function proposalReply(name: string, result: Record<string, unknown>, message: string): string | null {
	if (result.error || result.ok === false) return null;
	const locale = replyLocale(message);
	const confirm = { en: 'Reply yes to confirm this summary.', th: 'ตอบ “ใช่” เพื่อยืนยันรายละเอียดนี้ครับ', ko: '이 내용을 확인하고 동의하시면 “네”라고 답해 주세요.' }[locale];
	if ((name === 'prepare_booking' || (name === 'confirm_booking' && result.needsReview === true)) && typeof result.total === 'number') {
		const title = result.needsReview ? { en: 'The price or coupon changed. Review this new proposal; nothing is booked yet.', th: 'ราคาหรือคูปองเปลี่ยน กรุณาตรวจรายละเอียดใหม่ ยังไม่ได้สร้างการจองครับ', ko: '요금 또는 쿠폰이 변경되었습니다. 새 제안을 확인해 주세요. 아직 예약되지 않았습니다.' }[locale] : { en: 'Villa booking proposal — not booked yet.', th: 'รายละเอียดที่เตรียมไว้ ยังไม่ได้สร้างการจองวิลล่าครับ', ko: '빌라 예약 제안입니다. 아직 예약되지 않았습니다.' }[locale];
		return `${title}\n${result.property} · ${result.checkIn} → ${result.checkOut}\n${result.guests} guests · ${result.nights} nights\n${result.currency} ${result.total.toLocaleString('en-US')}\n${chatCouponSummary(result.coupon, result.currency, locale)}\n${typeof result.confirmUrl === 'string' ? `${{ en: 'Confirm & pay', th: 'ยืนยันและชำระเงิน', ko: '확인 및 결제' }[locale]}: ${result.confirmUrl}\n` : ''}${confirm}`;
	}
  if (name === 'preview_coupon' && typeof result.total === 'number') {
    return `${result.property} · ${result.checkIn} → ${result.checkOut}\n${chatCouponSummary(result.coupon, result.currency, locale)}\n${result.currency} ${result.total.toLocaleString('en-US')}\n${typeof result.bookingUrl === 'string' ? result.bookingUrl : ''}\n${{ en: 'No booking or hold yet. Review the final price in checkout.', th: 'ยังไม่ได้จองหรือกันวัน กรุณาตรวจราคาสุดท้ายก่อนยืนยันครับ', ko: '아직 예약되지 않았습니다. 결제 단계에서 최종 요금을 확인해 주세요.' }[locale]}`;
  }
	if (name === 'prepare_service_booking' && typeof result.price === 'number') {
		const title = { en: 'Service booking proposal — not confirmed yet.', th: 'รายละเอียดที่เตรียมไว้ ยังไม่ได้ยืนยันการจองบริการครับ', ko: '서비스 예약 제안입니다. 아직 확정되지 않았습니다.' }[locale];
		return `${title}\n${result.service} · ${result.date} ${result.time}\n${result.durationMin} min · ${result.staff}\n${result.currency} ${result.price.toLocaleString('en-US')}${typeof result.staffPreferenceIgnored === 'string' ? `\n${result.staffPreferenceIgnored}` : ''}\n${confirm}`;
	}
	if (name === 'cancel_booking' && result.state === 'needs_confirmation') {
		const title = { en: 'Cancel this booking? It has not been cancelled yet.', th: 'ต้องการยกเลิกการจองนี้ใช่ไหมครับ ตอนนี้ยังไม่ได้ยกเลิก', ko: '이 예약을 취소할까요? 아직 취소되지 않았습니다.' }[locale];
		return `${title}\n${result.reference}\n${result.service ?? ''} ${result.date ?? result.checkIn ?? ''} ${result.time ?? result.checkOut ?? ''}\n${confirm}`;
	}
	return null;
}

/** Status words and references come directly from owned rows, never model prose. */
export function bookingStatusReply(result: Record<string, unknown>, message: string): string | null {
	if (result.error || result.ok === false || !Array.isArray(result.bookings) || !Array.isArray(result.services)) return null;
	const rows = [...result.bookings, ...result.services] as Record<string, unknown>[];
	const title = rows.length
		? { en: 'Your booking records:', th: 'รายการจองของคุณ:', ko: '예약 내역:' }[replyLocale(message)]
		: { en: 'No booking records were found for this guest.', th: 'ไม่พบรายการจองของผู้เข้าพักนี้ครับ', ko: '이 고객의 예약 내역이 없습니다.' }[replyLocale(message)];
	return [title, ...rows.map(row => [row.reference, row.property ?? row.service, row.date ?? row.checkIn, row.time ?? row.checkOut, `status: ${row.status}`, ...(row.paymentStatus ? [`payment: ${row.paymentStatus}`] : []), ...(typeof row.total === 'number' ? [`${row.currency} ${row.total.toLocaleString('en-US')}`] : []), ...(typeof row.paymentUrl === 'string' ? [row.paymentUrl] : [])].join(' · '))].join('\n');
}


/** Detect positive completion assertions, preserving guidance and honest negatives. */
export function hasTransactionCompletionClaim(content: string) {
	return content.split(/[.!?;\n]+|\b(?:but|and)\b|แต่|และ|하지만/iu).some(clause => {
		if (/(?:^|[,])\s*(?:booked|confirmed|cancelled|canceled|rescheduled|refunded|success)\s*$|\b(?:is|are|was|were|has|have|already|successfully|now|just)\s+(?:been\s+)?(?:booked|confirmed|cancelled|canceled|rescheduled|refunded|created)\b|\b(?:I|we)\s+(?:booked|confirmed|cancelled|canceled|rescheduled|refunded)\b|\b(?:booking|reservation|appointment|payment)\s+(?:booked|confirmed|cancelled|canceled|rescheduled|refunded|created)\b/iu.test(clause)) return true;
		return !/ไม่|ยังไม่|않|아직/iu.test(clause) && /ยืนยัน.*แล้ว|จอง.*แล้ว|ยกเลิก.*แล้ว|예약.*(?:완료|확정되었습니다)|취소.*(?:완료|되었습니다)/iu.test(clause);
	});
}
