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

type LocalizedCopy = {
  quickReplyLabels: Record<QuickReplyIntent, string>;
  night: string;
  directPrefix?: string;
  directSuffix?: string;
  priceFallback: string;
  villasFallback: string;
  amenitiesFallback: string;
  villaLine: (property: LinePropertySummary, url: string) => string;
  answers: Record<LineIntent, (context: AnswerContext) => string>;
  timeout: string;
  unknown: string;
};

type AnswerContext = {
  activeProperties: LinePropertySummary[];
  amenities: string;
  bookingUrl: string;
  discount: number;
  firstVillaLink: string;
  propertyList: string;
  publicSiteUrl: string;
  siteUrl: string;
  villasList: string;
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
    night: "night",
    directSuffix: "direct",
    priceFallback: "Open the booking page to see current villa pricing.",
    villasFallback: "View villa details here:",
    amenitiesFallback: "Amenities are listed on each villa page:",
    villaLine: (property, url) =>
      `${property.name}: ${property.bedrooms} bed, ${property.bathrooms} bath, up to ${property.maxGuests} guests. ${url}`,
    timeout:
      "I'm checking that for you, but the concierge is taking longer than usual. Please send your villa, dates, and guest count here and the host can help confirm.",
    unknown:
      "I'm not fully sure about that yet. I'll ask the team and get back to you shortly.",
    answers: {
      welcome: () =>
        "Thanks for adding Auralis Cove Retreat. I can help with availability, prices, 360 tours, and direct booking. Tap a quick option or send your question here.",
      availability: ({ bookingUrl }) =>
        `You can check live availability and total price here: ${bookingUrl}\n\nIf you already have dates, reply with villa name, check-in, and checkout.`,
      pricing: ({ bookingUrl, propertyList }) =>
        `Current direct booking prices:\n${propertyList}\n\nUse ${bookingUrl} to calculate the total for your dates.`,
      direct_booking: ({ bookingUrl, discount }) =>
        `Book direct and save ${discount}% compared with the listed nightly rate. Direct booking also avoids OTA service fees and includes the resort's direct-booking benefits.\n\nStart here: ${bookingUrl}`,
      villa_details: ({ activeProperties, publicSiteUrl, villasList }) =>
        activeProperties.length ? `Our villas:\n${villasList}` : `View villa details here: ${publicSiteUrl}/#villas`,
      tour: ({ firstVillaLink }) =>
        `You can open the 360 tour from each villa page. Start here: ${firstVillaLink}\n\nThe tour lets you inspect rooms before choosing dates.`,
      contact: () =>
        "You can message us here in LINE. Send your dates, guest count, and preferred villa, and the host can help confirm the best option.",
      airport: () =>
        "Direct booking includes free airport pickup as part of the direct-booking benefits. Share your arrival time after booking so the host can coordinate pickup.",
      cancellation: () =>
        "Free cancellation is available up to 48 hours before check-in. For unusual travel changes, message the host here and we will help review the best option.",
      location: ({ publicSiteUrl }) =>
        `Auralis Cove Retreat is a boutique luxury villa resort in Koh Samui, Thailand. For booking and villa details, start here: ${publicSiteUrl}`,
      amenities: ({ activeProperties, amenities, publicSiteUrl }) =>
        activeProperties.length
          ? `Amenities vary by villa. Highlights include ${amenities}.`
          : `Amenities are listed on each villa page: ${publicSiteUrl}/#villas`,
    },
  },
  th: {
    quickReplyLabels: {
      availability: "เช็ควันที่",
      pricing: "ดูราคา",
      tour: "ดูทัวร์ 360",
      contact: "ติดต่อโฮสต์",
    },
    night: "คืน",
    directPrefix: "จองตรง",
    priceFallback: "เปิดหน้าจองเพื่อดูราคาวิลล่าล่าสุดได้เลย",
    villasFallback: "ดูรายละเอียดวิลล่าได้ที่นี่:",
    amenitiesFallback: "ดูสิ่งอำนวยความสะดวกได้ในหน้าวิลล่าแต่ละหลัง:",
    villaLine: (property, url) =>
      `${property.name}: ${property.bedrooms} ห้องนอน, ${property.bathrooms} ห้องน้ำ, พักได้สูงสุด ${property.maxGuests} คน ${url}`,
    timeout:
      "ผมกำลังเช็คให้อยู่ครับ แต่ระบบใช้เวลานานกว่าปกติ ส่งชื่อวิลล่า วันที่เข้าพัก และจำนวนผู้เข้าพักมาได้เลย เดี๋ยวโฮสต์ช่วยยืนยันให้ครับ",
    unknown:
      "ผมยังไม่มั่นใจคำตอบนี้ครับ เดี๋ยวผมถามทีมงานให้แล้วจะติดต่อกลับไปโดยเร็ว",
    answers: {
      welcome: () =>
        "ขอบคุณที่เพิ่ม Auralis Cove Retreat ครับ ผมช่วยดูห้องว่าง ราคา ทัวร์ 360 และการจองตรงได้เลย ส่งคำถามมาได้ครับ",
      availability: ({ bookingUrl }) =>
        `เช็คห้องว่างและราคารวมตามวันที่ได้ที่นี่: ${bookingUrl}\n\nถ้ามีวันที่แล้ว ส่งชื่อวิลล่า วันเช็คอิน และวันเช็คเอาต์มาได้เลยครับ`,
      pricing: ({ bookingUrl, propertyList }) =>
        `ราคาจองตรงตอนนี้:\n${propertyList}\n\nใช้ ${bookingUrl} เพื่อคำนวณราคารวมตามวันที่ต้องการได้เลยครับ`,
      direct_booking: ({ bookingUrl, discount }) =>
        `จองตรงประหยัด ${discount}% จากราคาปกติ และไม่เสียค่าบริการจากแพลตฟอร์ม OTA\n\nเริ่มจองได้ที่นี่: ${bookingUrl}`,
      villa_details: ({ activeProperties, publicSiteUrl, villasList }) =>
        activeProperties.length ? `วิลล่าของเรา:\n${villasList}` : `ดูรายละเอียดวิลล่าได้ที่นี่: ${publicSiteUrl}/#villas`,
      tour: ({ firstVillaLink }) =>
        `เปิดทัวร์ 360 ได้จากหน้าวิลล่าแต่ละหลัง เริ่มที่นี่: ${firstVillaLink}\n\nทัวร์ช่วยให้ดูห้องและบรรยากาศก่อนเลือกวันเข้าพักได้ครับ`,
      contact: () =>
        "ส่งข้อความมาที่นี่ได้เลยครับ แจ้งวันที่ จำนวนผู้เข้าพัก และวิลล่าที่สนใจ แล้วโฮสต์จะช่วยเช็คตัวเลือกที่เหมาะที่สุดให้",
      airport: () =>
        "การจองตรงรวมบริการรับจากสนามบินฟรีครับ หลังจองแล้วแจ้งเวลาถึงสนามบินเพื่อให้โฮสต์ช่วยประสานงานได้เลย",
      cancellation: () =>
        "ยกเลิกฟรีได้ถึง 48 ชั่วโมงก่อนเช็คอิน หากมีเหตุจำเป็นเรื่องการเดินทาง ส่งข้อความหาโฮสต์ที่นี่ได้ครับ",
      location: ({ publicSiteUrl }) =>
        `Auralis Cove Retreat เป็นคอนเซ็ปต์วิลล่าหรูในเกาะสมุย ประเทศไทย ดูข้อมูลและจองได้ที่นี่: ${publicSiteUrl}`,
      amenities: ({ activeProperties, amenities, publicSiteUrl }) =>
        activeProperties.length
          ? `สิ่งอำนวยความสะดวกแตกต่างกันตามวิลล่า ไฮไลต์มี ${amenities}`
          : `ดูสิ่งอำนวยความสะดวกได้ในหน้าวิลล่าแต่ละหลัง: ${publicSiteUrl}/#villas`,
    },
  },
  "zh-CN": {
    quickReplyLabels: {
      availability: "查看日期",
      pricing: "查看价格",
      tour: "查看 360 导览",
      contact: "联系房东",
    },
    night: "晚",
    directPrefix: "直接预订",
    priceFallback: "打开预订页面即可查看当前别墅价格。",
    villasFallback: "在这里查看别墅详情:",
    amenitiesFallback: "每个别墅页面都列出了设施:",
    villaLine: (property, url) =>
      `${property.name}: ${property.bedrooms} 间卧室，${property.bathrooms} 间浴室，最多 ${property.maxGuests} 位客人。${url}`,
    timeout:
      "我正在为您查询，但礼宾系统响应比平时慢。请把别墅、日期和入住人数发来，房东会帮您确认。",
    unknown: "我暂时还不能确定答案。我会询问团队，并尽快回复您。",
    answers: {
      welcome: () =>
        "感谢添加 Auralis Cove Retreat。我可以帮您查询空房、价格、360 导览和直接预订。请选择快捷选项或直接发送问题。",
      availability: ({ bookingUrl }) =>
        `您可以在这里查看实时房态和总价: ${bookingUrl}\n\n如果已有日期，请回复别墅名称、入住日期和退房日期。`,
      pricing: ({ bookingUrl, propertyList }) =>
        `当前直接预订价格:\n${propertyList}\n\n使用 ${bookingUrl} 按您的日期计算总价。`,
      direct_booking: ({ bookingUrl, discount }) =>
        `直接预订可比标价节省 ${discount}%，并避免 OTA 服务费，同时享受直接预订权益。\n\n从这里开始: ${bookingUrl}`,
      villa_details: ({ activeProperties, publicSiteUrl, villasList }) =>
        activeProperties.length ? `我们的别墅:\n${villasList}` : `在这里查看别墅详情: ${publicSiteUrl}/#villas`,
      tour: ({ firstVillaLink }) =>
        `您可以从每个别墅页面打开 360 导览。从这里开始: ${firstVillaLink}\n\n导览可帮助您在选择日期前查看房间。`,
      contact: () =>
        "您可以直接在这里留言。请发送日期、入住人数和偏好的别墅，房东会帮您确认最合适的选择。",
      airport: () =>
        "直接预订包含免费机场接送。预订后请发送抵达时间，房东会协助安排。",
      cancellation: () =>
        "入住前 48 小时之前可免费取消。如果行程有特殊变化，请在这里联系房东，我们会帮您查看。",
      location: ({ publicSiteUrl }) =>
        `Auralis Cove Retreat 是位于泰国苏梅岛的精品豪华别墅度假概念。预订和别墅详情请从这里开始: ${publicSiteUrl}`,
      amenities: ({ activeProperties, amenities, publicSiteUrl }) =>
        activeProperties.length
          ? `设施因别墅而异。亮点包括 ${amenities}。`
          : `每个别墅页面都列出了设施: ${publicSiteUrl}/#villas`,
    },
  },
  ja: {
    quickReplyLabels: {
      availability: "日程を確認",
      pricing: "料金を見る",
      tour: "360ツアーを見る",
      contact: "ホストに連絡",
    },
    night: "泊",
    directPrefix: "直接予約",
    priceFallback: "予約ページで現在のヴィラ料金をご確認ください。",
    villasFallback: "ヴィラ詳細はこちら:",
    amenitiesFallback: "設備は各ヴィラページに掲載しています:",
    villaLine: (property, url) =>
      `${property.name}: ${property.bedrooms}ベッドルーム、${property.bathrooms}バスルーム、最大${property.maxGuests}名。${url}`,
    timeout:
      "確認中ですが、コンシェルジュの応答に通常より時間がかかっています。ヴィラ名、日程、人数を送っていただければ、ホストが確認します。",
    unknown: "この回答はまだ確実ではありません。チームに確認して、できるだけ早く返信します。",
    answers: {
      welcome: () =>
        "Auralis Cove Retreat を追加していただきありがとうございます。空室、料金、360ツアー、直接予約についてお手伝いできます。クイック項目を選ぶか、そのまま質問を送ってください。",
      availability: ({ bookingUrl }) =>
        `リアルタイムの空室状況と合計料金はこちらで確認できます: ${bookingUrl}\n\n日程が決まっている場合は、ヴィラ名、チェックイン、チェックアウトを送ってください。`,
      pricing: ({ bookingUrl, propertyList }) =>
        `現在の直接予約料金:\n${propertyList}\n\n${bookingUrl} で日程に合わせた合計料金を計算できます。`,
      direct_booking: ({ bookingUrl, discount }) =>
        `直接予約なら表示料金から ${discount}% お得です。OTA手数料も避けられ、直接予約特典も含まれます。\n\nこちらから開始: ${bookingUrl}`,
      villa_details: ({ activeProperties, publicSiteUrl, villasList }) =>
        activeProperties.length ? `ヴィラ一覧:\n${villasList}` : `ヴィラ詳細はこちら: ${publicSiteUrl}/#villas`,
      tour: ({ firstVillaLink }) =>
        `360ツアーは各ヴィラページから開けます。まずはこちら: ${firstVillaLink}\n\n日程を選ぶ前に部屋を確認できます。`,
      contact: () =>
        "ここにメッセージを送ってください。日程、人数、希望ヴィラを送ると、ホストが最適な選択肢を確認します。",
      airport: () =>
        "直接予約には無料の空港送迎が含まれます。予約後に到着時間を共有してください。",
      cancellation: () =>
        "チェックイン48時間前まで無料キャンセル可能です。特別な変更がある場合は、ここでホストにご連絡ください。",
      location: ({ publicSiteUrl }) =>
        `Auralis Cove Retreat はタイ・サムイ島のブティック高級ヴィラリゾートのコンセプトです。予約と詳細はこちら: ${publicSiteUrl}`,
      amenities: ({ activeProperties, amenities, publicSiteUrl }) =>
        activeProperties.length
          ? `設備はヴィラによって異なります。主な設備: ${amenities}。`
          : `設備は各ヴィラページに掲載しています: ${publicSiteUrl}/#villas`,
    },
  },
  ko: {
    quickReplyLabels: {
      availability: "날짜 확인",
      pricing: "가격 보기",
      tour: "360 투어 보기",
      contact: "호스트 문의",
    },
    night: "박",
    directPrefix: "직접 예약",
    priceFallback: "예약 페이지에서 현재 빌라 가격을 확인해 주세요.",
    villasFallback: "빌라 상세 정보 보기:",
    amenitiesFallback: "편의시설은 각 빌라 페이지에 안내되어 있습니다:",
    villaLine: (property, url) =>
      `${property.name}: 침실 ${property.bedrooms}개, 욕실 ${property.bathrooms}개, 최대 ${property.maxGuests}명. ${url}`,
    timeout:
      "확인 중이지만 컨시어지 응답이 평소보다 오래 걸리고 있습니다. 빌라, 날짜, 인원수를 보내주시면 호스트가 확인해 드립니다.",
    unknown: "아직 정확한 답변을 확신하기 어렵습니다. 팀에 확인한 뒤 곧 다시 안내드리겠습니다.",
    answers: {
      welcome: () =>
        "Auralis Cove Retreat를 추가해 주셔서 감사합니다. 예약 가능 여부, 가격, 360 투어, 직접 예약을 도와드릴 수 있습니다. 빠른 옵션을 누르거나 질문을 보내주세요.",
      availability: ({ bookingUrl }) =>
        `실시간 예약 가능 여부와 총액은 여기에서 확인할 수 있습니다: ${bookingUrl}\n\n이미 날짜가 있다면 빌라명, 체크인, 체크아웃을 보내주세요.`,
      pricing: ({ bookingUrl, propertyList }) =>
        `현재 직접 예약 가격:\n${propertyList}\n\n${bookingUrl} 에서 날짜별 총액을 계산할 수 있습니다.`,
      direct_booking: ({ bookingUrl, discount }) =>
        `직접 예약하면 표시 요금보다 ${discount}% 절약할 수 있고 OTA 수수료도 없습니다.\n\n여기에서 시작하세요: ${bookingUrl}`,
      villa_details: ({ activeProperties, publicSiteUrl, villasList }) =>
        activeProperties.length ? `빌라 목록:\n${villasList}` : `빌라 상세 정보 보기: ${publicSiteUrl}/#villas`,
      tour: ({ firstVillaLink }) =>
        `360 투어는 각 빌라 페이지에서 열 수 있습니다. 여기에서 시작하세요: ${firstVillaLink}\n\n날짜를 선택하기 전에 객실을 확인할 수 있습니다.`,
      contact: () =>
        "여기에 메시지를 보내주세요. 날짜, 인원수, 선호 빌라를 알려주시면 호스트가 가장 알맞은 옵션을 확인해 드립니다.",
      airport: () =>
        "직접 예약에는 무료 공항 픽업이 포함됩니다. 예약 후 도착 시간을 공유해 주세요.",
      cancellation: () =>
        "체크인 48시간 전까지 무료 취소가 가능합니다. 특별한 일정 변경이 있다면 여기에서 호스트에게 메시지를 보내주세요.",
      location: ({ publicSiteUrl }) =>
        `Auralis Cove Retreat는 태국 코사무이에 있는 부티크 럭셔리 빌라 리조트 콘셉트입니다. 예약과 상세 정보는 여기에서 시작하세요: ${publicSiteUrl}`,
      amenities: ({ activeProperties, amenities, publicSiteUrl }) =>
        activeProperties.length
          ? `편의시설은 빌라마다 다릅니다. 주요 시설: ${amenities}.`
          : `편의시설은 각 빌라 페이지에 안내되어 있습니다: ${publicSiteUrl}/#villas`,
    },
  },
  fr: {
    quickReplyLabels: {
      availability: "Voir les dates",
      pricing: "Voir les prix",
      tour: "Voir la visite 360",
      contact: "Contacter l'hote",
    },
    night: "nuit",
    directSuffix: "en direct",
    priceFallback: "Ouvrez la page de reservation pour voir les prix actuels des villas.",
    villasFallback: "Voir les details des villas ici:",
    amenitiesFallback: "Les equipements sont listes sur chaque page de villa:",
    villaLine: (property, url) =>
      `${property.name}: ${property.bedrooms} chambre(s), ${property.bathrooms} salle(s) de bain, jusqu'a ${property.maxGuests} voyageurs. ${url}`,
    timeout:
      "Je verifie pour vous, mais le concierge prend plus de temps que d'habitude. Envoyez la villa, les dates et le nombre de voyageurs, et l'hote pourra confirmer.",
    unknown:
      "Je ne suis pas encore totalement certain de la reponse. Je vais demander a l'equipe et revenir vers vous rapidement.",
    answers: {
      welcome: () =>
        "Merci d'avoir ajoute Auralis Cove Retreat. Je peux vous aider avec les disponibilites, les prix, les visites 360 et la reservation directe. Choisissez une option rapide ou envoyez votre question ici.",
      availability: ({ bookingUrl }) =>
        `Vous pouvez verifier les disponibilites en direct et le prix total ici: ${bookingUrl}\n\nSi vous avez deja des dates, envoyez le nom de la villa, l'arrivee et le depart.`,
      pricing: ({ bookingUrl, propertyList }) =>
        `Prix actuels en reservation directe:\n${propertyList}\n\nUtilisez ${bookingUrl} pour calculer le total selon vos dates.`,
      direct_booking: ({ bookingUrl, discount }) =>
        `La reservation directe permet d'economiser ${discount}% par rapport au tarif affiche, sans frais OTA, avec les avantages de reservation directe.\n\nCommencez ici: ${bookingUrl}`,
      villa_details: ({ activeProperties, publicSiteUrl, villasList }) =>
        activeProperties.length ? `Nos villas:\n${villasList}` : `Voir les details des villas ici: ${publicSiteUrl}/#villas`,
      tour: ({ firstVillaLink }) =>
        `Vous pouvez ouvrir la visite 360 depuis chaque page de villa. Commencez ici: ${firstVillaLink}\n\nLa visite permet d'inspecter les pieces avant de choisir vos dates.`,
      contact: () =>
        "Vous pouvez nous envoyer un message ici. Indiquez vos dates, le nombre de voyageurs et la villa preferee, et l'hote confirmera la meilleure option.",
      airport: () =>
        "La reservation directe inclut le transfert gratuit depuis l'aeroport. Partagez votre heure d'arrivee apres la reservation.",
      cancellation: () =>
        "L'annulation gratuite est possible jusqu'a 48 heures avant l'arrivee. Pour un changement particulier, contactez l'hote ici.",
      location: ({ publicSiteUrl }) =>
        `Auralis Cove Retreat est un concept de villas de luxe boutique a Koh Samui, en Thailande. Pour reserver et voir les details: ${publicSiteUrl}`,
      amenities: ({ activeProperties, amenities, publicSiteUrl }) =>
        activeProperties.length
          ? `Les equipements varient selon la villa. Points forts: ${amenities}.`
          : `Les equipements sont listes sur chaque page de villa: ${publicSiteUrl}/#villas`,
    },
  },
  de: {
    quickReplyLabels: {
      availability: "Daten pruefen",
      pricing: "Preise ansehen",
      tour: "360-Tour ansehen",
      contact: "Host kontaktieren",
    },
    night: "Nacht",
    directSuffix: "direkt",
    priceFallback: "Oeffnen Sie die Buchungsseite, um die aktuellen Villenpreise zu sehen.",
    villasFallback: "Villendetails hier ansehen:",
    amenitiesFallback: "Ausstattung steht auf jeder Villenseite:",
    villaLine: (property, url) =>
      `${property.name}: ${property.bedrooms} Schlafzimmer, ${property.bathrooms} Badezimmer, bis zu ${property.maxGuests} Gaeste. ${url}`,
    timeout:
      "Ich pruefe das gerade, aber der Concierge braucht laenger als sonst. Senden Sie bitte Villa, Daten und Gaestezahl, dann kann der Host bestaetigen.",
    unknown:
      "Ich bin mir bei dieser Antwort noch nicht ganz sicher. Ich frage das Team und melde mich schnell wieder.",
    answers: {
      welcome: () =>
        "Danke, dass Sie Auralis Cove Retreat hinzugefuegt haben. Ich helfe bei Verfuegbarkeit, Preisen, 360-Touren und Direktbuchung. Waehlen Sie eine Schnelloption oder senden Sie Ihre Frage.",
      availability: ({ bookingUrl }) =>
        `Live-Verfuegbarkeit und Gesamtpreis finden Sie hier: ${bookingUrl}\n\nWenn Sie bereits Daten haben, senden Sie Villa, Check-in und Check-out.`,
      pricing: ({ bookingUrl, propertyList }) =>
        `Aktuelle Direktbuchungspreise:\n${propertyList}\n\nNutzen Sie ${bookingUrl}, um den Gesamtpreis fuer Ihre Daten zu berechnen.`,
      direct_booking: ({ bookingUrl, discount }) =>
        `Direkt buchen und ${discount}% gegenueber dem Listenpreis sparen. Ausserdem vermeiden Sie OTA-Gebuehren und erhalten Direktbuchungsvorteile.\n\nStart hier: ${bookingUrl}`,
      villa_details: ({ activeProperties, publicSiteUrl, villasList }) =>
        activeProperties.length ? `Unsere Villen:\n${villasList}` : `Villendetails hier ansehen: ${publicSiteUrl}/#villas`,
      tour: ({ firstVillaLink }) =>
        `Die 360-Tour ist auf jeder Villenseite verfuegbar. Starten Sie hier: ${firstVillaLink}\n\nSo koennen Sie die Zimmer vor der Datumsauswahl ansehen.`,
      contact: () =>
        "Schreiben Sie uns hier. Senden Sie Daten, Gaestezahl und bevorzugte Villa, dann hilft der Host bei der besten Option.",
      airport: () =>
        "Direktbuchung beinhaltet kostenlosen Flughafentransfer. Teilen Sie nach der Buchung Ihre Ankunftszeit mit.",
      cancellation: () =>
        "Kostenlose Stornierung ist bis 48 Stunden vor Check-in moeglich. Bei besonderen Aenderungen schreiben Sie dem Host hier.",
      location: ({ publicSiteUrl }) =>
        `Auralis Cove Retreat ist ein Boutique-Luxusvilla-Konzept auf Koh Samui, Thailand. Buchung und Details: ${publicSiteUrl}`,
      amenities: ({ activeProperties, amenities, publicSiteUrl }) =>
        activeProperties.length
          ? `Die Ausstattung variiert je nach Villa. Highlights: ${amenities}.`
          : `Ausstattung steht auf jeder Villenseite: ${publicSiteUrl}/#villas`,
    },
  },
  es: {
    quickReplyLabels: {
      availability: "Ver fechas",
      pricing: "Ver precios",
      tour: "Ver tour 360",
      contact: "Contactar anfitrion",
    },
    night: "noche",
    directSuffix: "directo",
    priceFallback: "Abra la pagina de reserva para ver los precios actuales de las villas.",
    villasFallback: "Ver detalles de las villas aqui:",
    amenitiesFallback: "Los servicios estan en la pagina de cada villa:",
    villaLine: (property, url) =>
      `${property.name}: ${property.bedrooms} dormitorio(s), ${property.bathrooms} bano(s), hasta ${property.maxGuests} huespedes. ${url}`,
    timeout:
      "Estoy revisandolo, pero el concierge tarda mas de lo habitual. Envie la villa, fechas y numero de huespedes para que el anfitrion confirme.",
    unknown:
      "Todavia no estoy completamente seguro de esa respuesta. Consultare al equipo y le respondere pronto.",
    answers: {
      welcome: () =>
        "Gracias por agregar Auralis Cove Retreat. Puedo ayudar con disponibilidad, precios, tours 360 y reserva directa. Toque una opcion rapida o envie su pregunta aqui.",
      availability: ({ bookingUrl }) =>
        `Puede consultar disponibilidad en vivo y precio total aqui: ${bookingUrl}\n\nSi ya tiene fechas, responda con villa, check-in y check-out.`,
      pricing: ({ bookingUrl, propertyList }) =>
        `Precios actuales de reserva directa:\n${propertyList}\n\nUse ${bookingUrl} para calcular el total segun sus fechas.`,
      direct_booking: ({ bookingUrl, discount }) =>
        `Reserve directo y ahorre ${discount}% frente al precio publicado. Tambien evita tarifas OTA e incluye beneficios de reserva directa.\n\nEmpiece aqui: ${bookingUrl}`,
      villa_details: ({ activeProperties, publicSiteUrl, villasList }) =>
        activeProperties.length ? `Nuestras villas:\n${villasList}` : `Ver detalles de las villas aqui: ${publicSiteUrl}/#villas`,
      tour: ({ firstVillaLink }) =>
        `Puede abrir el tour 360 desde cada pagina de villa. Empiece aqui: ${firstVillaLink}\n\nEl tour permite revisar las habitaciones antes de elegir fechas.`,
      contact: () =>
        "Puede escribirnos aqui. Envie fechas, numero de huespedes y villa preferida, y el anfitrion confirmara la mejor opcion.",
      airport: () =>
        "La reserva directa incluye recogida gratuita en el aeropuerto. Comparta su hora de llegada despues de reservar.",
      cancellation: () =>
        "La cancelacion gratuita esta disponible hasta 48 horas antes del check-in. Si hay cambios especiales, escriba al anfitrion aqui.",
      location: ({ publicSiteUrl }) =>
        `Auralis Cove Retreat es un concepto boutique de villas de lujo en Koh Samui, Tailandia. Para reservas y detalles: ${publicSiteUrl}`,
      amenities: ({ activeProperties, amenities, publicSiteUrl }) =>
        activeProperties.length
          ? `Los servicios varian segun la villa. Destacados: ${amenities}.`
          : `Los servicios estan en la pagina de cada villa: ${publicSiteUrl}/#villas`,
    },
  },
  ru: {
    quickReplyLabels: {
      availability: "Проверить даты",
      pricing: "Посмотреть цены",
      tour: "Смотреть 360-тур",
      contact: "Связаться с хостом",
    },
    night: "ночь",
    directPrefix: "прямое бронирование",
    priceFallback: "Откройте страницу бронирования, чтобы увидеть актуальные цены вилл.",
    villasFallback: "Смотреть детали вилл здесь:",
    amenitiesFallback: "Удобства указаны на странице каждой виллы:",
    villaLine: (property, url) =>
      `${property.name}: ${property.bedrooms} спален, ${property.bathrooms} ванных, до ${property.maxGuests} гостей. ${url}`,
    timeout:
      "Я проверяю информацию, но консьерж отвечает дольше обычного. Отправьте виллу, даты и число гостей, и хост поможет подтвердить.",
    unknown:
      "Я пока не полностью уверен в ответе. Я уточню у команды и скоро вернусь с ответом.",
    answers: {
      welcome: () =>
        "Спасибо, что добавили Auralis Cove Retreat. Я помогу с доступностью, ценами, 360-турами и прямым бронированием. Выберите быстрый вариант или отправьте вопрос.",
      availability: ({ bookingUrl }) =>
        `Проверить доступность и итоговую цену можно здесь: ${bookingUrl}\n\nЕсли даты уже есть, отправьте название виллы, заезд и выезд.`,
      pricing: ({ bookingUrl, propertyList }) =>
        `Текущие цены при прямом бронировании:\n${propertyList}\n\nИспользуйте ${bookingUrl}, чтобы рассчитать итог по вашим датам.`,
      direct_booking: ({ bookingUrl, discount }) =>
        `При прямом бронировании вы экономите ${discount}% от указанной цены, без OTA-сборов и с преимуществами прямого бронирования.\n\nНачать здесь: ${bookingUrl}`,
      villa_details: ({ activeProperties, publicSiteUrl, villasList }) =>
        activeProperties.length ? `Наши виллы:\n${villasList}` : `Смотреть детали вилл здесь: ${publicSiteUrl}/#villas`,
      tour: ({ firstVillaLink }) =>
        `360-тур доступен на странице каждой виллы. Начните здесь: ${firstVillaLink}\n\nТур поможет осмотреть комнаты до выбора дат.`,
      contact: () =>
        "Вы можете написать нам здесь. Отправьте даты, число гостей и желаемую виллу, и хост поможет подтвердить лучший вариант.",
      airport: () =>
        "Прямое бронирование включает бесплатный трансфер из аэропорта. После бронирования сообщите время прибытия.",
      cancellation: () =>
        "Бесплатная отмена доступна до 48 часов до заезда. При особых изменениях напишите хосту здесь.",
      location: ({ publicSiteUrl }) =>
        `Auralis Cove Retreat - концепт бутик-вилл класса люкс на Самуи, Таиланд. Бронирование и детали: ${publicSiteUrl}`,
      amenities: ({ activeProperties, amenities, publicSiteUrl }) =>
        activeProperties.length
          ? `Удобства зависят от виллы. Основное: ${amenities}.`
          : `Удобства указаны на странице каждой виллы: ${publicSiteUrl}/#villas`,
    },
  },
  it: {
    quickReplyLabels: {
      availability: "Controlla date",
      pricing: "Vedi prezzi",
      tour: "Vedi tour 360",
      contact: "Contatta host",
    },
    night: "notte",
    directSuffix: "diretto",
    priceFallback: "Apri la pagina di prenotazione per vedere i prezzi attuali delle ville.",
    villasFallback: "Vedi i dettagli delle ville qui:",
    amenitiesFallback: "I servizi sono indicati nella pagina di ogni villa:",
    villaLine: (property, url) =>
      `${property.name}: ${property.bedrooms} camera/e, ${property.bathrooms} bagno/i, fino a ${property.maxGuests} ospiti. ${url}`,
    timeout:
      "Sto controllando, ma il concierge sta impiegando piu tempo del solito. Invia villa, date e numero di ospiti e l'host potra confermare.",
    unknown:
      "Non sono ancora completamente sicuro della risposta. Chiedero al team e ti rispondero a breve.",
    answers: {
      welcome: () =>
        "Grazie per aver aggiunto Auralis Cove Retreat. Posso aiutarti con disponibilita, prezzi, tour 360 e prenotazione diretta. Tocca un'opzione rapida o invia la tua domanda qui.",
      availability: ({ bookingUrl }) =>
        `Puoi controllare disponibilita live e prezzo totale qui: ${bookingUrl}\n\nSe hai gia le date, invia villa, check-in e check-out.`,
      pricing: ({ bookingUrl, propertyList }) =>
        `Prezzi attuali per prenotazione diretta:\n${propertyList}\n\nUsa ${bookingUrl} per calcolare il totale per le tue date.`,
      direct_booking: ({ bookingUrl, discount }) =>
        `Prenota direttamente e risparmia ${discount}% rispetto alla tariffa indicata. Eviti anche le commissioni OTA e ottieni i vantaggi della prenotazione diretta.\n\nInizia qui: ${bookingUrl}`,
      villa_details: ({ activeProperties, publicSiteUrl, villasList }) =>
        activeProperties.length ? `Le nostre ville:\n${villasList}` : `Vedi i dettagli delle ville qui: ${publicSiteUrl}/#villas`,
      tour: ({ firstVillaLink }) =>
        `Puoi aprire il tour 360 dalla pagina di ogni villa. Inizia qui: ${firstVillaLink}\n\nIl tour ti aiuta a vedere le stanze prima di scegliere le date.`,
      contact: () =>
        "Puoi scriverci qui. Invia date, numero di ospiti e villa preferita, e l'host confermera l'opzione migliore.",
      airport: () =>
        "La prenotazione diretta include il pickup gratuito in aeroporto. Dopo la prenotazione condividi l'orario di arrivo.",
      cancellation: () =>
        "La cancellazione gratuita e disponibile fino a 48 ore prima del check-in. Per cambi particolari, scrivi qui all'host.",
      location: ({ publicSiteUrl }) =>
        `Auralis Cove Retreat e un concept boutique di ville di lusso a Koh Samui, Thailandia. Prenotazioni e dettagli: ${publicSiteUrl}`,
      amenities: ({ activeProperties, amenities, publicSiteUrl }) =>
        activeProperties.length
          ? `I servizi variano per villa. In evidenza: ${amenities}.`
          : `I servizi sono indicati nella pagina di ogni villa: ${publicSiteUrl}/#villas`,
    },
  },
  hi: {
    quickReplyLabels: {
      availability: "तारीखें देखें",
      pricing: "कीमत देखें",
      tour: "360 टूर देखें",
      contact: "होस्ट से संपर्क",
    },
    night: "रात",
    directPrefix: "सीधी बुकिंग",
    priceFallback: "मौजूदा विला कीमत देखने के लिए बुकिंग पेज खोलें।",
    villasFallback: "विला विवरण यहां देखें:",
    amenitiesFallback: "सुविधाएं हर विला पेज पर दी गई हैं:",
    villaLine: (property, url) =>
      `${property.name}: ${property.bedrooms} बेडरूम, ${property.bathrooms} बाथरूम, अधिकतम ${property.maxGuests} मेहमान। ${url}`,
    timeout:
      "मैं आपके लिए जांच रहा हूं, लेकिन concierge सामान्य से ज्यादा समय ले रहा है। कृपया विला, तारीखें और मेहमानों की संख्या भेजें, होस्ट पुष्टि कर देगा।",
    unknown:
      "मैं अभी इस जवाब को लेकर पूरी तरह निश्चित नहीं हूं। मैं टीम से पूछकर जल्द आपको बताऊंगा।",
    answers: {
      welcome: () =>
        "Auralis Cove Retreat जोड़ने के लिए धन्यवाद। मैं उपलब्धता, कीमत, 360 टूर और सीधी बुकिंग में मदद कर सकता हूं। कोई quick option चुनें या अपना सवाल भेजें।",
      availability: ({ bookingUrl }) =>
        `Live availability और कुल कीमत यहां देखें: ${bookingUrl}\n\nअगर तारीखें तय हैं, तो विला नाम, check-in और checkout भेजें।`,
      pricing: ({ bookingUrl, propertyList }) =>
        `मौजूदा सीधी बुकिंग कीमतें:\n${propertyList}\n\nअपनी तारीखों के लिए कुल कीमत निकालने के लिए ${bookingUrl} इस्तेमाल करें।`,
      direct_booking: ({ bookingUrl, discount }) =>
        `सीधी बुकिंग से listed rate की तुलना में ${discount}% बचत होती है। OTA service fees भी नहीं लगतीं और direct-booking benefits मिलते हैं।\n\nयहां शुरू करें: ${bookingUrl}`,
      villa_details: ({ activeProperties, publicSiteUrl, villasList }) =>
        activeProperties.length ? `हमारे विला:\n${villasList}` : `विला विवरण यहां देखें: ${publicSiteUrl}/#villas`,
      tour: ({ firstVillaLink }) =>
        `360 टूर हर विला पेज से खुलता है। यहां शुरू करें: ${firstVillaLink}\n\nतारीख चुनने से पहले आप कमरों को देख सकते हैं।`,
      contact: () =>
        "आप यहां message कर सकते हैं। तारीखें, मेहमानों की संख्या और पसंदीदा विला भेजें, होस्ट best option confirm कर देगा।",
      airport: () =>
        "सीधी बुकिंग में free airport pickup शामिल है। booking के बाद arrival time share करें।",
      cancellation: () =>
        "Check-in से 48 घंटे पहले तक free cancellation उपलब्ध है। unusual travel changes के लिए host को यहां message करें।",
      location: ({ publicSiteUrl }) =>
        `Auralis Cove Retreat Koh Samui, Thailand में boutique luxury villa resort concept है। booking और details यहां देखें: ${publicSiteUrl}`,
      amenities: ({ activeProperties, amenities, publicSiteUrl }) =>
        activeProperties.length
          ? `सुविधाएं विला के अनुसार अलग होती हैं। Highlights: ${amenities}.`
          : `सुविधाएं हर विला पेज पर दी गई हैं: ${publicSiteUrl}/#villas`,
    },
  },
};

const exactQuestionSeeds: Array<[QuickAnswerLocale, LineIntent, string[]]> = [
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

const exactQuestionIntents = new Map<string, { intent: LineIntent; locale: QuickAnswerLocale }>();
for (const [locale, intent, phrases] of exactQuestionSeeds) {
  for (const phrase of phrases) {
    exactQuestionIntents.set(normalizeLineQuestion(phrase), { intent, locale });
  }
}

function normalizeSiteUrl(siteUrl: string) {
  const fallback = "https://tour.helpgueststay.com";
  const trimmed = siteUrl.trim();
  if (!trimmed) return fallback;

  try {
    const url = new URL(trimmed);
    return url.origin;
  } catch {
    return trimmed.replace(/\/+$/, "") || fallback;
  }
}

function formatBaht(value: number) {
  return `฿${Math.round(value).toLocaleString("en-US")}`;
}

function directRate(property: LinePropertySummary) {
  return property.pricePerNight * (1 - property.directDiscountPercent / 100);
}

function bookingUrl(siteUrl: string) {
  return `${normalizeSiteUrl(siteUrl)}/booking`;
}

function villaUrl(siteUrl: string, slug: string) {
  return `${normalizeSiteUrl(siteUrl)}/rooms/${slug}`;
}

function fallbackProperties(properties: LinePropertySummary[]) {
  return properties.length > 0 ? properties : [];
}

function formatDirectRate(copy: LocalizedCopy, property: LinePropertySummary) {
  const direct = formatBaht(directRate(property));
  if (copy.directPrefix) return `${copy.directPrefix} ${direct}`;
  if (copy.directSuffix) return `${direct} ${copy.directSuffix}`;
  return direct;
}

function propertyLines(properties: LinePropertySummary[], locale: QuickAnswerLocale) {
  const copy = localeCopy[locale];
  return properties
    .map(
      (property) =>
        `${property.name}: ${formatBaht(property.pricePerNight)}/${copy.night} (${formatDirectRate(
          copy,
          property,
        )})`,
    )
    .join("\n");
}

function amenitiesList(properties: LinePropertySummary[]) {
  return Array.from(new Set(properties.flatMap((property) => property.amenities)))
    .slice(0, 10)
    .join(", ");
}

function answerContext({
  locale,
  properties,
  siteUrl,
}: {
  locale: QuickAnswerLocale;
  properties: LinePropertySummary[];
  siteUrl: string;
}): AnswerContext {
  const activeProperties = fallbackProperties(properties);
  const publicSiteUrl = normalizeSiteUrl(siteUrl);
  const firstVillaLink = activeProperties[0] ? villaUrl(siteUrl, activeProperties[0].slug) : `${publicSiteUrl}/#villas`;
  const copy = localeCopy[locale];
  const villasList = activeProperties
    .map((property) => copy.villaLine(property, villaUrl(siteUrl, property.slug)))
    .join("\n");

  return {
    activeProperties,
    amenities: amenitiesList(activeProperties),
    bookingUrl: bookingUrl(siteUrl),
    discount: activeProperties[0]?.directDiscountPercent ?? 15,
    firstVillaLink,
    propertyList: activeProperties.length ? propertyLines(activeProperties, locale) : copy.priceFallback,
    publicSiteUrl,
    siteUrl,
    villasList,
  };
}

export function normalizeQuickAnswerLocale(locale?: string | null): QuickAnswerLocale {
  return locale && isLocale(locale) ? locale : defaultLocale;
}

export function detectQuickAnswerLocale(text?: string): QuickAnswerLocale | undefined {
  const clean = text?.trim();
  if (!clean) return undefined;

  const exact = exactQuestionIntents.get(normalizeLineQuestion(clean));
  if (exact) return exact.locale;

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

function answerForIntent({
  intent,
  locale,
  mode,
  properties,
  siteUrl,
}: {
  intent: LineIntent;
  locale: QuickAnswerLocale;
  mode: LineReplyMode;
  properties: LinePropertySummary[];
  siteUrl: string;
}): LineQuickAnswer {
  const context = answerContext({ locale, properties, siteUrl });
  return {
    intent,
    mode,
    text: stripTerminalPunctuationAfterUrls(localeCopy[locale].answers[intent](context)),
    quickReplyItems: buildLineQuickReplyItems(locale),
  };
}

function stripTerminalPunctuationAfterUrls(text: string) {
  return text.replace(/(https?:\/\/\S+?)([.。])(?=\s|$)/gu, "$1");
}

export function resolveLineQuickAnswer({
  eventType,
  locale,
  messageText,
  postbackData,
  properties,
  siteUrl,
}: {
  eventType: "message" | "follow" | "postback" | "unsupported";
  locale?: string;
  messageText?: string;
  postbackData?: string;
  properties: LinePropertySummary[];
  siteUrl: string;
}) {
  const fallbackLocale = normalizeQuickAnswerLocale(locale);

  if (eventType === "follow") {
    return answerForIntent({ intent: "welcome", locale: fallbackLocale, mode: "follow", properties, siteUrl });
  }

  if (eventType === "postback") {
    const intent = parseLineIntentFromPostback(postbackData);
    const postbackLocale = parseLineLocaleFromPostback(postbackData) ?? fallbackLocale;
    return intent ? answerForIntent({ intent, locale: postbackLocale, mode: "postback", properties, siteUrl }) : null;
  }

  if (eventType !== "message" || !messageText) return null;

  const exact = exactQuestionIntents.get(normalizeLineQuestion(messageText));
  return exact
    ? answerForIntent({
        intent: exact.intent,
        locale: exact.locale ?? detectQuickAnswerLocale(messageText) ?? fallbackLocale,
        mode: "exact",
        properties,
        siteUrl,
      })
    : null;
}
