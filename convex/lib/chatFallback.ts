import type { Doc } from '../_generated/dataModel';
import { calculateDirectQuote } from './pricing';

type LocaleCode = 'en' | 'th' | 'zh-CN' | 'ja' | 'ko' | 'fr' | 'de' | 'es' | 'ru' | 'it' | 'hi';

type FallbackCopy = {
	night: string;
	priceProperty: (property: Doc<'properties'>, direct: number) => string;
	priceAll: string;
	booking: string;
	details: (property: Doc<'properties'>) => string;
	generic: string;
};

const fallbackCopies: Record<LocaleCode, FallbackCopy> = {
	en: {
		night: 'night',
		priceProperty: (property, direct) =>
			`${property.name} is ฿${property.pricePerNight.toLocaleString()}/night, but with our **${property.directDiscountPercent}% direct booking discount**, you pay just **฿${direct.toLocaleString()}/night**! That's a significant saving compared to OTA platforms. Use the booking form above to check total pricing for your dates.`,
		priceAll:
			`We have 3 luxury properties:\n- **Pool Villa**: ฿8,500/night (฿7,225 direct)\n- **Garden Suite**: ฿4,500/night (฿3,825 direct)\n- **Canopy Loft Penthouse**: ฿12,000/night (฿10,200 direct)\n\nAll prices include a **15% direct booking discount**. Which property interests you?`,
		booking:
			`You can check availability and book directly using the date picker on the property page. Direct booking gives you **15% off** plus free airport pickup, welcome basket, and late checkout! If you need help with specific dates, feel free to message us on WhatsApp.`,
		details: (property) =>
			`**${property.name}** includes: ${property.amenities.join(', ')}. It's ${property.area}m² with ${property.bedrooms} bedroom(s) and ${property.bathrooms} bathroom(s), perfect for up to ${property.maxGuests} guests. Take the **360° virtual tour** to explore every room!`,
		generic:
			`Welcome to Seaview Residence! I can help you with:\n- **Pricing** for our luxury villas\n- **Availability** for your travel dates\n- **Property details** and amenities\n\nWhich property are you interested in? We have the Pool Villa, Garden Suite, and Canopy Loft Penthouse in Koh Samui, Thailand.`
	},
	th: {
		night: 'คืน',
		priceProperty: (property, direct) =>
			`${property.name} ราคา ฿${property.pricePerNight.toLocaleString()}/คืน แต่เมื่อใช้ **ส่วนลดจองตรง ${property.directDiscountPercent}%** จะเหลือเพียง **฿${direct.toLocaleString()}/คืน** ใช้แบบฟอร์มจองบนเว็บไซต์เพื่อตรวจสอบราคารวมตามวันที่ต้องการได้เลย`,
		priceAll:
			`เรามีที่พักหรู 3 แบบ:\n- **Pool Villa**: ฿8,500/คืน (จองตรง ฿7,225)\n- **Garden Suite**: ฿4,500/คืน (จองตรง ฿3,825)\n- **Canopy Loft Penthouse**: ฿12,000/คืน (จองตรง ฿10,200)\n\nราคาทั้งหมดรวม **ส่วนลดจองตรง 15%** แล้ว สนใจที่พักแบบไหนเป็นพิเศษไหม?`,
		booking:
			`คุณสามารถตรวจสอบห้องว่างและจองตรงได้จากตัวเลือกวันที่บนหน้าที่พัก จองตรงรับ **ส่วนลด 15%** พร้อมบริการรับสนามบิน ของต้อนรับ และเช็กเอาต์สาย หากต้องการความช่วยเหลือเรื่องวันที่เฉพาะเจาะจง สามารถทัก WhatsApp ได้เลย`,
		details: (property) =>
			`**${property.name}** มีสิ่งอำนวยความสะดวก: ${property.amenities.join(', ')} พื้นที่ ${property.area}m² มี ${property.bedrooms} ห้องนอน และ ${property.bathrooms} ห้องน้ำ รองรับผู้เข้าพักสูงสุด ${property.maxGuests} คน ลองชม **ทัวร์เสมือนจริง 360°** เพื่อดูทุกห้องได้เลย`,
		generic:
			`ยินดีต้อนรับสู่ Seaview Residence! ฉันช่วยได้เรื่อง:\n- **ราคา** วิลล่าหรูของเรา\n- **ห้องว่าง** ตามวันที่เดินทาง\n- **รายละเอียดที่พัก** และสิ่งอำนวยความสะดวก\n\nสนใจ Pool Villa, Garden Suite หรือ Canopy Loft Penthouse ในเกาะสมุยเป็นพิเศษไหม?`
	},
	'zh-CN': {
		night: '晚',
		priceProperty: (property, direct) =>
			`${property.name} 的价格是 ฿${property.pricePerNight.toLocaleString()}/晚，使用 **${property.directDiscountPercent}% 直接预订折扣** 后仅需 **฿${direct.toLocaleString()}/晚**。请使用网站上的预订表单查看所选日期的总价。`,
		priceAll:
			`我们有 3 间豪华房源：\n- **Pool Villa**: ฿8,500/晚（直接预订 ฿7,225）\n- **Garden Suite**: ฿4,500/晚（直接预订 ฿3,825）\n- **Canopy Loft Penthouse**: ฿12,000/晚（直接预订 ฿10,200）\n\n所有价格均包含 **15% 直接预订折扣**。您对哪间房源感兴趣？`,
		booking:
			`您可以在房源页面使用日期选择器查看可订情况并直接预订。直接预订可享 **15% 折扣**，并包含免费机场接送、欢迎礼遇和延迟退房。如需具体日期帮助，请通过 WhatsApp 联系我们。`,
		details: (property) =>
			`**${property.name}** 包含：${property.amenities.join(', ')}。面积 ${property.area}m²，设有 ${property.bedrooms} 间卧室和 ${property.bathrooms} 间浴室，最多适合 ${property.maxGuests} 位住客。您可以通过 **360° 虚拟导览** 查看每个房间！`,
		generic:
			`欢迎来到 Seaview Residence！我可以帮助您了解：\n- 豪华别墅的 **价格**\n- 旅行日期的 **可订情况**\n- **房源详情** 和设施\n\n您对 Koh Samui, Thailand 的 Pool Villa、Garden Suite 还是 Canopy Loft Penthouse 感兴趣？`
	},
	ja: {
		night: '泊',
		priceProperty: (property, direct) =>
			`${property.name} は ฿${property.pricePerNight.toLocaleString()}/泊ですが、**${property.directDiscountPercent}% の直接予約割引**で **฿${direct.toLocaleString()}/泊**になります。ご希望日の合計料金は予約フォームで確認できます。`,
		priceAll:
			`3つのラグジュアリー宿泊施設があります：\n- **Pool Villa**: ฿8,500/泊（直接予約 ฿7,225）\n- **Garden Suite**: ฿4,500/泊（直接予約 ฿3,825）\n- **Canopy Loft Penthouse**: ฿12,000/泊（直接予約 ฿10,200）\n\nすべて **15% の直接予約割引**込みです。どの施設に興味がありますか？`,
		booking:
			`空室確認と直接予約は、宿泊施設ページの日付ピッカーから行えます。直接予約では **15% オフ**に加え、無料空港送迎、ウェルカムバスケット、レイトチェックアウトが含まれます。具体的な日程の相談は WhatsApp でどうぞ。`,
		details: (property) =>
			`**${property.name}** には ${property.amenities.join(', ')} が含まれます。広さは ${property.area}m²、${property.bedrooms} ベッドルーム、${property.bathrooms} バスルームで、最大 ${property.maxGuests} 名に最適です。**360° バーチャルツアー**で全室をご覧ください！`,
		generic:
			`Seaview Residence へようこそ！\n- ラグジュアリーヴィラの **料金**\n- ご旅行日の **空室状況**\n- **宿泊施設の詳細** と設備\n\nKoh Samui, Thailand の Pool Villa、Garden Suite、Canopy Loft Penthouse のどれに興味がありますか？`
	},
	ko: {
		night: '박',
		priceProperty: (property, direct) =>
			`${property.name} 은 ฿${property.pricePerNight.toLocaleString()}/박이며, **${property.directDiscountPercent}% 직접 예약 할인** 적용 시 **฿${direct.toLocaleString()}/박**입니다. 선택한 날짜의 총액은 예약 양식에서 확인하세요.`,
		priceAll:
			`고급 숙소 3곳이 있습니다:\n- **Pool Villa**: ฿8,500/박 (직접 예약 ฿7,225)\n- **Garden Suite**: ฿4,500/박 (직접 예약 ฿3,825)\n- **Canopy Loft Penthouse**: ฿12,000/박 (직접 예약 ฿10,200)\n\n모든 가격에는 **15% 직접 예약 할인**이 포함됩니다. 어떤 숙소가 궁금하신가요?`,
		booking:
			`숙소 페이지의 날짜 선택기로 가능 여부를 확인하고 직접 예약할 수 있습니다. 직접 예약 시 **15% 할인**과 무료 공항 픽업, 웰컴 바스켓, 레이트 체크아웃이 제공됩니다. 특정 날짜 도움이 필요하면 WhatsApp 으로 문의하세요.`,
		details: (property) =>
			`**${property.name}** 포함 사항: ${property.amenities.join(', ')}. ${property.area}m², 침실 ${property.bedrooms}개, 욕실 ${property.bathrooms}개이며 최대 ${property.maxGuests}명에게 적합합니다. **360° 가상 투어**로 모든 방을 둘러보세요!`,
		generic:
			`Seaview Residence 에 오신 것을 환영합니다! 다음을 도와드릴 수 있습니다:\n- 고급 빌라 **가격**\n- 여행 날짜 **예약 가능 여부**\n- **숙소 상세 정보** 및 편의시설\n\nKoh Samui, Thailand 의 Pool Villa, Garden Suite, Canopy Loft Penthouse 중 어떤 곳이 궁금하신가요?`
	},
	fr: {
		night: 'nuit',
		priceProperty: (property, direct) =>
			`${property.name} est à ฿${property.pricePerNight.toLocaleString()}/nuit, mais avec notre **remise de réservation directe de ${property.directDiscountPercent}%**, vous payez seulement **฿${direct.toLocaleString()}/nuit**. Utilisez le formulaire de réservation pour vérifier le prix total à vos dates.`,
		priceAll:
			`Nous avons 3 hébergements de luxe :\n- **Pool Villa** : ฿8,500/nuit (฿7,225 en direct)\n- **Garden Suite** : ฿4,500/nuit (฿3,825 en direct)\n- **Canopy Loft Penthouse** : ฿12,000/nuit (฿10,200 en direct)\n\nTous les prix incluent une **remise directe de 15%**. Quel hébergement vous intéresse ?`,
		booking:
			`Vous pouvez vérifier les disponibilités et réserver directement avec le sélecteur de dates sur la page de l’hébergement. La réservation directe offre **15% de réduction**, plus le transfert aéroport gratuit, un panier de bienvenue et le départ tardif. Pour des dates précises, contactez-nous sur WhatsApp.`,
		details: (property) =>
			`**${property.name}** inclut : ${property.amenities.join(', ')}. C’est un espace de ${property.area}m² avec ${property.bedrooms} chambre(s) et ${property.bathrooms} salle(s) de bain, parfait pour jusqu’à ${property.maxGuests} hôtes. Lancez la **visite virtuelle 360°** pour tout explorer !`,
		generic:
			`Bienvenue à Seaview Residence ! Je peux vous aider avec :\n- les **prix** de nos villas de luxe\n- les **disponibilités** à vos dates\n- les **détails** et équipements\n\nQuel hébergement vous intéresse : Pool Villa, Garden Suite ou Canopy Loft Penthouse à Koh Samui, Thailand ?`
	},
	de: {
		night: 'Nacht',
		priceProperty: (property, direct) =>
			`${property.name} kostet ฿${property.pricePerNight.toLocaleString()}/Nacht, mit unserem **${property.directDiscountPercent}% Direktbuchungsrabatt** zahlen Sie nur **฿${direct.toLocaleString()}/Nacht**. Nutzen Sie das Buchungsformular, um den Gesamtpreis für Ihre Daten zu prüfen.`,
		priceAll:
			`Wir haben 3 Luxusunterkünfte:\n- **Pool Villa**: ฿8,500/Nacht (฿7,225 direkt)\n- **Garden Suite**: ฿4,500/Nacht (฿3,825 direkt)\n- **Canopy Loft Penthouse**: ฿12,000/Nacht (฿10,200 direkt)\n\nAlle Preise enthalten **15% Direktbuchungsrabatt**. Welche Unterkunft interessiert Sie?`,
		booking:
			`Sie können Verfügbarkeit prüfen und direkt über den Datumswähler auf der Unterkunftsseite buchen. Direktbuchung bietet **15% Rabatt** plus kostenlosen Flughafentransfer, Willkommenskorb und späten Checkout. Bei konkreten Daten schreiben Sie uns gern auf WhatsApp.`,
		details: (property) =>
			`**${property.name}** umfasst: ${property.amenities.join(', ')}. Sie hat ${property.area}m², ${property.bedrooms} Schlafzimmer und ${property.bathrooms} Badezimmer, ideal für bis zu ${property.maxGuests} Gäste. Erkunden Sie alles in der **360°-Tour**!`,
		generic:
			`Willkommen bei Seaview Residence! Ich helfe Ihnen mit:\n- **Preisen** unserer Luxusvillen\n- **Verfügbarkeit** für Ihre Reisedaten\n- **Details** und Ausstattung\n\nInteressieren Sie sich für Pool Villa, Garden Suite oder Canopy Loft Penthouse in Koh Samui, Thailand?`
	},
	es: {
		night: 'noche',
		priceProperty: (property, direct) =>
			`${property.name} cuesta ฿${property.pricePerNight.toLocaleString()}/noche, pero con nuestro **${property.directDiscountPercent}% de descuento por reserva directa**, paga solo **฿${direct.toLocaleString()}/noche**. Use el formulario de reserva para ver el precio total de sus fechas.`,
		priceAll:
			`Tenemos 3 propiedades de lujo:\n- **Pool Villa**: ฿8,500/noche (฿7,225 directo)\n- **Garden Suite**: ฿4,500/noche (฿3,825 directo)\n- **Canopy Loft Penthouse**: ฿12,000/noche (฿10,200 directo)\n\nTodos los precios incluyen **15% de descuento directo**. ¿Qué propiedad le interesa?`,
		booking:
			`Puede comprobar disponibilidad y reservar directamente con el selector de fechas en la página de la propiedad. La reserva directa ofrece **15% de descuento**, traslado gratuito desde el aeropuerto, cesta de bienvenida y salida tardía. Para fechas específicas, escríbanos por WhatsApp.`,
		details: (property) =>
			`**${property.name}** incluye: ${property.amenities.join(', ')}. Tiene ${property.area}m², ${property.bedrooms} dormitorio(s) y ${property.bathrooms} baño(s), perfecto para hasta ${property.maxGuests} huéspedes. ¡Explore cada habitación con el **tour virtual 360°**!`,
		generic:
			`¡Bienvenido a Seaview Residence! Puedo ayudarle con:\n- **precios** de nuestras villas de lujo\n- **disponibilidad** para sus fechas\n- **detalles** y servicios\n\n¿Qué propiedad le interesa: Pool Villa, Garden Suite o Canopy Loft Penthouse en Koh Samui, Thailand?`
	},
	ru: {
		night: 'ночь',
		priceProperty: (property, direct) =>
			`${property.name} стоит ฿${property.pricePerNight.toLocaleString()}/ночь, но с нашей **скидкой ${property.directDiscountPercent}% за прямое бронирование** вы платите всего **฿${direct.toLocaleString()}/ночь**. Используйте форму бронирования, чтобы проверить итоговую цену на ваши даты.`,
		priceAll:
			`У нас есть 3 роскошных объекта:\n- **Pool Villa**: ฿8,500/ночь (฿7,225 напрямую)\n- **Garden Suite**: ฿4,500/ночь (฿3,825 напрямую)\n- **Canopy Loft Penthouse**: ฿12,000/ночь (฿10,200 напрямую)\n\nВсе цены включают **15% скидку за прямое бронирование**. Какой объект вас интересует?`,
		booking:
			`Вы можете проверить доступность и забронировать напрямую с помощью выбора дат на странице объекта. Прямое бронирование дает **скидку 15%**, бесплатный трансфер из аэропорта, приветственный набор и поздний выезд. Для конкретных дат напишите нам в WhatsApp.`,
		details: (property) =>
			`**${property.name}** включает: ${property.amenities.join(', ')}. Площадь ${property.area}m², ${property.bedrooms} спальни и ${property.bathrooms} ванные, подходит до ${property.maxGuests} гостей. Посмотрите все комнаты в **виртуальном туре 360°**!`,
		generic:
			`Добро пожаловать в Seaview Residence! Я могу помочь с:\n- **ценами** на наши роскошные виллы\n- **доступностью** на ваши даты\n- **деталями объекта** и удобствами\n\nЧто вас интересует: Pool Villa, Garden Suite или Canopy Loft Penthouse в Koh Samui, Thailand?`
	},
	it: {
		night: 'notte',
		priceProperty: (property, direct) =>
			`${property.name} costa ฿${property.pricePerNight.toLocaleString()}/notte, ma con il nostro **sconto prenotazione diretta del ${property.directDiscountPercent}%** paghi solo **฿${direct.toLocaleString()}/notte**. Usa il modulo di prenotazione per controllare il totale per le tue date.`,
		priceAll:
			`Abbiamo 3 proprietà di lusso:\n- **Pool Villa**: ฿8,500/notte (฿7,225 diretto)\n- **Garden Suite**: ฿4,500/notte (฿3,825 diretto)\n- **Canopy Loft Penthouse**: ฿12,000/notte (฿10,200 diretto)\n\nTutti i prezzi includono **15% di sconto diretto**. Quale proprietà ti interessa?`,
		booking:
			`Puoi controllare disponibilità e prenotare direttamente con il selettore date nella pagina della proprietà. La prenotazione diretta offre **15% di sconto**, transfer aeroportuale gratuito, welcome basket e late checkout. Per date specifiche scrivici su WhatsApp.`,
		details: (property) =>
			`**${property.name}** include: ${property.amenities.join(', ')}. È di ${property.area}m² con ${property.bedrooms} camera/e e ${property.bathrooms} bagno/i, perfetta per fino a ${property.maxGuests} ospiti. Esplora ogni stanza con il **tour virtuale 360°**!`,
		generic:
			`Benvenuto a Seaview Residence! Posso aiutarti con:\n- **prezzi** delle nostre ville di lusso\n- **disponibilità** per le tue date\n- **dettagli** e servizi\n\nTi interessa Pool Villa, Garden Suite o Canopy Loft Penthouse a Koh Samui, Thailand?`
	},
	hi: {
		night: 'रात',
		priceProperty: (property, direct) =>
			`${property.name} की कीमत ฿${property.pricePerNight.toLocaleString()}/रात है, लेकिन **${property.directDiscountPercent}% सीधी बुकिंग छूट** के बाद आप केवल **฿${direct.toLocaleString()}/रात** देते हैं। अपनी तारीखों का कुल मूल्य देखने के लिए बुकिंग फॉर्म उपयोग करें।`,
		priceAll:
			`हमारे पास 3 लक्जरी प्रॉपर्टी हैं:\n- **Pool Villa**: ฿8,500/रात (सीधे ฿7,225)\n- **Garden Suite**: ฿4,500/रात (सीधे ฿3,825)\n- **Canopy Loft Penthouse**: ฿12,000/रात (सीधे ฿10,200)\n\nसभी कीमतों में **15% सीधी बुकिंग छूट** शामिल है। आपको कौन सी प्रॉपर्टी पसंद है?`,
		booking:
			`आप प्रॉपर्टी पेज पर तारीख चयनकर्ता से उपलब्धता जाँचकर सीधे बुक कर सकते हैं। सीधी बुकिंग में **15% छूट**, मुफ्त एयरपोर्ट पिकअप, वेलकम बास्केट और लेट चेकआउट मिलता है। खास तारीखों में मदद चाहिए तो WhatsApp पर संदेश भेजें।`,
		details: (property) =>
			`**${property.name}** में शामिल हैं: ${property.amenities.join(', ')}। यह ${property.area}m² है, इसमें ${property.bedrooms} बेडरूम और ${property.bathrooms} बाथरूम हैं, और अधिकतम ${property.maxGuests} मेहमानों के लिए उपयुक्त है। हर कमरे को देखने के लिए **360° वर्चुअल टूर** लें!`,
		generic:
			`Seaview Residence में आपका स्वागत है! मैं मदद कर सकता हूँ:\n- हमारी लक्जरी विला की **कीमतों** में\n- आपकी यात्रा तारीखों की **उपलब्धता** में\n- **प्रॉपर्टी विवरण** और सुविधाओं में\n\nKoh Samui, Thailand में Pool Villa, Garden Suite या Canopy Loft Penthouse में से किसमें रुचि है?`
	}
};

const intentKeywords = {
	price: [
		'price', 'cost', 'how much', 'rate', 'ราคา', 'เท่าไหร่', '价格', '多少钱', '料金', 'いくら',
		'가격', '얼마', 'prix', 'tarif', 'preis', 'kosten', 'precio', 'cuánto', 'цена', 'стоимость',
		'prezzo', 'costo', 'कीमत', 'कितना'
	],
	booking: [
		'available', 'availability', 'book', 'dates', 'จอง', 'ว่าง', 'วันที่', '可订', '预订', '日期',
		'予約', '空室', '예약', '가능', 'disponible', 'réserver', 'verfügbar', 'buchen', 'disponibilidad',
		'reservar', 'доступ', 'забронировать', 'даты', 'disponibile', 'prenot', 'उपलब्ध', 'बुक', 'तारीख'
	],
	details: [
		'amenit', 'feature', 'what', 'detail', 'สิ่งอำนวย', 'อะไร', '设施', '什么', '詳細', '設備',
		'편의', '무엇', 'équipement', 'quoi', 'ausstattung', 'was', 'servicios', 'qué', 'удобства',
		'что', 'servizi', 'cosa', 'सुविध', 'क्या'
	]
};

function normalizeLocale(locale: string): LocaleCode {
	if (locale.toLowerCase() === 'zh-cn') return 'zh-CN';
	if (locale.startsWith('th')) return 'th';
	if (locale.startsWith('ja')) return 'ja';
	if (locale.startsWith('ko')) return 'ko';
	if (locale.startsWith('fr')) return 'fr';
	if (locale.startsWith('de')) return 'de';
	if (locale.startsWith('es')) return 'es';
	if (locale.startsWith('ru')) return 'ru';
	if (locale.startsWith('it')) return 'it';
	if (locale.startsWith('hi')) return 'hi';
	return 'en';
}

function hasIntent(message: string, intent: keyof typeof intentKeywords) {
	return intentKeywords[intent].some((keyword) => message.includes(keyword));
}

export function getFallbackResponse(
	message: string,
	property: Doc<'properties'> | null,
	locale = 'en'
): string {
	const lower = message.toLowerCase();
	const copy = fallbackCopies[normalizeLocale(locale)];

	if (hasIntent(lower, 'price')) {
		if (property) {
			const direct = calculateDirectQuote(property, 1).directTotal;
			return copy.priceProperty(property, direct);
		}
		return copy.priceAll;
	}

	if (hasIntent(lower, 'booking')) {
		return copy.booking;
	}

	if (hasIntent(lower, 'details')) {
		if (property) {
			return copy.details(property);
		}
	}

	return copy.generic;
}
