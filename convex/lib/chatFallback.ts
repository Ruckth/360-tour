import type { Doc } from '../_generated/dataModel';
import { calculateDirectQuote } from './pricing';

type LocaleCode = 'en' | 'th' | 'zh-CN' | 'ja' | 'ko' | 'fr' | 'de' | 'es' | 'ru' | 'it' | 'hi';

/** The villa fields the fallback copy needs; callers pass active `properties` rows. */
export type FallbackVilla = Pick<
	Doc<'properties'>,
	'name' | 'pricePerNight' | 'currency' | 'directDiscountPercent' | 'amenities' | 'area' | 'bedrooms' | 'bathrooms' | 'maxGuests'
>;

type FallbackCopy = {
	priceProperty: (property: FallbackVilla, direct: number) => string;
	priceLine: (name: string, price: string, direct: string) => string;
	priceAll: (count: number, lines: string, discountNote: string) => string;
	discountNote: (percent: number) => string;
	booking: (percent: number) => string;
	details: (property: FallbackVilla) => string;
	generic: (names: string) => string;
};

function money(amount: number, currency = 'THB') {
	const value = amount.toLocaleString('en-US');
	return currency === 'THB' ? `฿${value}` : `${currency} ${value}`;
}

const amenityCopies: Record<LocaleCode, Record<string, string>> = {
	en: {},
	th: {
		'Private Pool': 'สระส่วนตัว',
		WiFi: 'WiFi',
		'Air Conditioning': 'เครื่องปรับอากาศ',
		Kitchen: 'ครัว',
		'Garden View': 'วิวสวน',
		'King Bed': 'เตียงคิงไซส์',
		'Garden Terrace': 'ระเบียงสวน',
		'Rain Shower': 'เรนชาวเวอร์',
		'Queen Bed': 'เตียงควีนไซส์',
		Kitchenette: 'คิทเชเน็ต',
		'Treetop Windows': 'หน้าต่างยอดไม้',
		'Loft Lounge': 'เลานจ์ลอฟต์',
		'Designer Lighting': 'ไฟดีไซน์'
	},
	'zh-CN': {
		'Private Pool': '私人泳池',
		WiFi: 'WiFi',
		'Air Conditioning': '空调',
		Kitchen: '厨房',
		'Garden View': '花园景观',
		'King Bed': '特大床',
		'Garden Terrace': '花园露台',
		'Rain Shower': '雨淋花洒',
		'Queen Bed': '大床',
		Kitchenette: '小厨房',
		'Treetop Windows': '树梢窗',
		'Loft Lounge': '阁楼休闲区',
		'Designer Lighting': '设计灯具'
	},
	ja: {
		'Private Pool': 'プライベートプール',
		WiFi: 'WiFi',
		'Air Conditioning': 'エアコン',
		Kitchen: 'キッチン',
		'Garden View': 'ガーデンビュー',
		'King Bed': 'キングベッド',
		'Garden Terrace': 'ガーデンテラス',
		'Rain Shower': 'レインシャワー',
		'Queen Bed': 'クイーンベッド',
		Kitchenette: '簡易キッチン',
		'Treetop Windows': '木々を望む窓',
		'Loft Lounge': 'ロフトラウンジ',
		'Designer Lighting': 'デザイン照明'
	},
	ko: {
		'Private Pool': '프라이빗 풀',
		WiFi: 'WiFi',
		'Air Conditioning': '에어컨',
		Kitchen: '주방',
		'Garden View': '정원 전망',
		'King Bed': '킹 침대',
		'Garden Terrace': '정원 테라스',
		'Rain Shower': '레인 샤워',
		'Queen Bed': '퀸 침대',
		Kitchenette: '간이 주방',
		'Treetop Windows': '나무 전망 창',
		'Loft Lounge': '로프트 라운지',
		'Designer Lighting': '디자이너 조명'
	},
	fr: {
		'Private Pool': 'piscine privée',
		WiFi: 'WiFi',
		'Air Conditioning': 'climatisation',
		Kitchen: 'cuisine',
		'Garden View': 'vue jardin',
		'King Bed': 'lit king-size',
		'Garden Terrace': 'terrasse jardin',
		'Rain Shower': 'douche pluie',
		'Queen Bed': 'lit queen-size',
		Kitchenette: 'kitchenette',
		'Treetop Windows': 'fenêtres sur la canopée',
		'Loft Lounge': 'lounge loft',
		'Designer Lighting': 'éclairage design'
	},
	de: {
		'Private Pool': 'privater Pool',
		WiFi: 'WiFi',
		'Air Conditioning': 'Klimaanlage',
		Kitchen: 'Küche',
		'Garden View': 'Gartenblick',
		'King Bed': 'Kingsize-Bett',
		'Garden Terrace': 'Gartenterrasse',
		'Rain Shower': 'Regendusche',
		'Queen Bed': 'Queensize-Bett',
		Kitchenette: 'Kitchenette',
		'Treetop Windows': 'Baumwipfelfenster',
		'Loft Lounge': 'Loft-Lounge',
		'Designer Lighting': 'Designbeleuchtung'
	},
	es: {
		'Private Pool': 'piscina privada',
		WiFi: 'WiFi',
		'Air Conditioning': 'aire acondicionado',
		Kitchen: 'cocina',
		'Garden View': 'vista al jardín',
		'King Bed': 'cama king',
		'Garden Terrace': 'terraza jardín',
		'Rain Shower': 'ducha de lluvia',
		'Queen Bed': 'cama queen',
		Kitchenette: 'cocineta',
		'Treetop Windows': 'ventanas a los árboles',
		'Loft Lounge': 'sala loft',
		'Designer Lighting': 'iluminación de diseño'
	},
	ru: {
		'Private Pool': 'частный бассейн',
		WiFi: 'WiFi',
		'Air Conditioning': 'кондиционер',
		Kitchen: 'кухня',
		'Garden View': 'вид на сад',
		'King Bed': 'кровать king-size',
		'Garden Terrace': 'садовая терраса',
		'Rain Shower': 'тропический душ',
		'Queen Bed': 'кровать queen-size',
		Kitchenette: 'мини-кухня',
		'Treetop Windows': 'окна в кроны деревьев',
		'Loft Lounge': 'лофт-гостиная',
		'Designer Lighting': 'дизайнерское освещение'
	},
	it: {
		'Private Pool': 'piscina privata',
		WiFi: 'WiFi',
		'Air Conditioning': 'aria condizionata',
		Kitchen: 'cucina',
		'Garden View': 'vista giardino',
		'King Bed': 'letto king',
		'Garden Terrace': 'terrazza giardino',
		'Rain Shower': 'doccia a pioggia',
		'Queen Bed': 'letto queen',
		Kitchenette: 'angolo cottura',
		'Treetop Windows': 'finestre sugli alberi',
		'Loft Lounge': 'lounge loft',
		'Designer Lighting': 'illuminazione di design'
	},
	hi: {
		'Private Pool': 'निजी पूल',
		WiFi: 'WiFi',
		'Air Conditioning': 'एयर कंडीशनिंग',
		Kitchen: 'किचन',
		'Garden View': 'गार्डन व्यू',
		'King Bed': 'किंग बेड',
		'Garden Terrace': 'गार्डन टेरेस',
		'Rain Shower': 'रेन शॉवर',
		'Queen Bed': 'क्वीन बेड',
		Kitchenette: 'किचनेट',
		'Treetop Windows': 'पेड़ों के बीच खिड़कियाँ',
		'Loft Lounge': 'लॉफ्ट लाउंज',
		'Designer Lighting': 'डिज़ाइनर लाइटिंग'
	}
};

function localizedAmenities(property: FallbackVilla, locale: LocaleCode) {
	const copy = amenityCopies[locale];
	return property.amenities.map((amenity) => copy[amenity] ?? amenity).join(', ');
}

const fallbackCopies: Record<LocaleCode, FallbackCopy> = {
	en: {
		priceProperty: (property, direct) =>
			`${property.name} is ${money(property.pricePerNight, property.currency)}/night, but with our **${property.directDiscountPercent}% direct booking discount**, you pay just **${money(direct, property.currency)}/night**! That's a significant saving compared to OTA platforms. Use the booking form above to check total pricing for your dates.`,
		priceLine: (name, price, direct) => `- **${name}**: ${price}/night (${direct} direct)`,
		priceAll: (count, lines, discountNote) =>
			`We have ${count} luxury properties:\n${lines}\n\n${discountNote}Which property interests you?`,
		discountNote: (percent) => `All prices include a **${percent}% direct booking discount**. `,
		booking: (percent) =>
			`Use the booking card below to choose a villa and dates, then continue to secure direct booking. Direct booking gives you **${percent}% off** plus free airport pickup, welcome basket, and late checkout.`,
		details: (property) =>
			`**${property.name}** includes: ${localizedAmenities(property, 'en')}. It's ${property.area}m² with ${property.bedrooms} bedroom(s) and ${property.bathrooms} bathroom(s), perfect for up to ${property.maxGuests} guests. Take the **360° virtual tour** to explore every room!`,
		generic: (names) =>
			`Welcome to Auralis Cove Retreat! I can help you with:\n- **Pricing** for our luxury villas\n- **Availability** for your travel dates\n- **Property details** and amenities\n\nWhich property are you interested in? We have ${names} in Koh Samui, Thailand.`
	},
	th: {
		priceProperty: (property, direct) =>
			`${property.name} ราคา ${money(property.pricePerNight, property.currency)}/คืน แต่เมื่อใช้ **ส่วนลดจองตรง ${property.directDiscountPercent}%** จะเหลือเพียง **${money(direct, property.currency)}/คืน** ใช้แบบฟอร์มจองบนเว็บไซต์เพื่อตรวจสอบราคารวมตามวันที่ต้องการได้เลย`,
		priceLine: (name, price, direct) => `- **${name}**: ${price}/คืน (จองตรง ${direct})`,
		priceAll: (count, lines, discountNote) =>
			`เรามีที่พักหรู ${count} แบบ:\n${lines}\n\n${discountNote}สนใจที่พักแบบไหนเป็นพิเศษไหม?`,
		discountNote: (percent) => `ราคาทั้งหมดรวม **ส่วนลดจองตรง ${percent}%** แล้ว `,
		booking: (percent) =>
			`ใช้การ์ดจองด้านล่างเลือกวิลล่าและวันที่ แล้วไปจองตรงอย่างปลอดภัยได้เลย จองตรงรับ **ส่วนลด ${percent}%** พร้อมบริการรับสนามบิน ของต้อนรับ และเช็กเอาต์สาย`,
		details: (property) =>
			`**${property.name}** มีสิ่งอำนวยความสะดวก: ${localizedAmenities(property, 'th')} พื้นที่ ${property.area}m² มี ${property.bedrooms} ห้องนอน และ ${property.bathrooms} ห้องน้ำ รองรับผู้เข้าพักสูงสุด ${property.maxGuests} คน ลองชม **ทัวร์เสมือนจริง 360°** เพื่อดูทุกห้องได้เลย`,
		generic: (names) =>
			`ยินดีต้อนรับสู่ Auralis Cove Retreat! ฉันช่วยได้เรื่อง:\n- **ราคา** วิลล่าหรูของเรา\n- **ห้องว่าง** ตามวันที่เดินทาง\n- **รายละเอียดที่พัก** และสิ่งอำนวยความสะดวก\n\nสนใจ ${names} ในเกาะสมุยเป็นพิเศษไหม?`
	},
	'zh-CN': {
		priceProperty: (property, direct) =>
			`${property.name} 的价格是 ${money(property.pricePerNight, property.currency)}/晚，使用 **${property.directDiscountPercent}% 直接预订折扣** 后仅需 **${money(direct, property.currency)}/晚**。请使用网站上的预订表单查看所选日期的总价。`,
		priceLine: (name, price, direct) => `- **${name}**: ${price}/晚（直接预订 ${direct}）`,
		priceAll: (count, lines, discountNote) =>
			`我们有 ${count} 间豪华房源：\n${lines}\n\n${discountNote}您对哪间房源感兴趣？`,
		discountNote: (percent) => `所有价格均包含 **${percent}% 直接预订折扣**。`,
		booking: (percent) =>
			`请使用下方预订卡选择别墅和日期，然后继续安全的直接预订。直接预订可享 **${percent}% 折扣**，并包含免费机场接送、欢迎礼遇和延迟退房。`,
		details: (property) =>
			`**${property.name}** 包含：${localizedAmenities(property, 'zh-CN')}。面积 ${property.area}m²，设有 ${property.bedrooms} 间卧室和 ${property.bathrooms} 间浴室，最多适合 ${property.maxGuests} 位住客。您可以通过 **360° 虚拟导览** 查看每个房间！`,
		generic: (names) =>
			`欢迎来到 Auralis Cove Retreat！我可以帮助您了解：\n- 豪华别墅的 **价格**\n- 旅行日期的 **可订情况**\n- **房源详情** 和设施\n\n您对 Koh Samui, Thailand 的 ${names} 感兴趣？`
	},
	ja: {
		priceProperty: (property, direct) =>
			`${property.name} は ${money(property.pricePerNight, property.currency)}/泊ですが、**${property.directDiscountPercent}% の直接予約割引**で **${money(direct, property.currency)}/泊**になります。ご希望日の合計料金は予約フォームで確認できます。`,
		priceLine: (name, price, direct) => `- **${name}**: ${price}/泊（直接予約 ${direct}）`,
		priceAll: (count, lines, discountNote) =>
			`${count}つのラグジュアリー宿泊施設があります：\n${lines}\n\n${discountNote}どの施設に興味がありますか？`,
		discountNote: (percent) => `すべて **${percent}% の直接予約割引**込みです。`,
		booking: (percent) =>
			`下の予約カードでヴィラと日付を選び、安全な直接予約へ進んでください。直接予約では **${percent}% オフ**に加え、無料空港送迎、ウェルカムバスケット、レイトチェックアウトが含まれます。`,
		details: (property) =>
			`**${property.name}** には ${localizedAmenities(property, 'ja')} が含まれます。広さは ${property.area}m²、${property.bedrooms} ベッドルーム、${property.bathrooms} バスルームで、最大 ${property.maxGuests} 名に最適です。**360° バーチャルツアー**で全室をご覧ください！`,
		generic: (names) =>
			`Auralis Cove Retreat へようこそ！\n- ラグジュアリーヴィラの **料金**\n- ご旅行日の **空室状況**\n- **宿泊施設の詳細** と設備\n\nKoh Samui, Thailand の ${names} のどれに興味がありますか？`
	},
	ko: {
		priceProperty: (property, direct) =>
			`${property.name} 은 ${money(property.pricePerNight, property.currency)}/박이며, **${property.directDiscountPercent}% 직접 예약 할인** 적용 시 **${money(direct, property.currency)}/박**입니다. 선택한 날짜의 총액은 예약 양식에서 확인하세요.`,
		priceLine: (name, price, direct) => `- **${name}**: ${price}/박 (직접 예약 ${direct})`,
		priceAll: (count, lines, discountNote) =>
			`고급 숙소 ${count}곳이 있습니다:\n${lines}\n\n${discountNote}어떤 숙소가 궁금하신가요?`,
		discountNote: (percent) => `모든 가격에는 **${percent}% 직접 예약 할인**이 포함됩니다. `,
		booking: (percent) =>
			`아래 예약 카드에서 빌라와 날짜를 선택한 뒤 안전한 직접 예약으로 진행하세요. 직접 예약 시 **${percent}% 할인**과 무료 공항 픽업, 웰컴 바스켓, 레이트 체크아웃이 제공됩니다.`,
		details: (property) =>
			`**${property.name}** 포함 사항: ${localizedAmenities(property, 'ko')}. ${property.area}m², 침실 ${property.bedrooms}개, 욕실 ${property.bathrooms}개이며 최대 ${property.maxGuests}명에게 적합합니다. **360° 가상 투어**로 모든 방을 둘러보세요!`,
		generic: (names) =>
			`Auralis Cove Retreat 에 오신 것을 환영합니다! 다음을 도와드릴 수 있습니다:\n- 고급 빌라 **가격**\n- 여행 날짜 **예약 가능 여부**\n- **숙소 상세 정보** 및 편의시설\n\nKoh Samui, Thailand 의 ${names} 중 어떤 곳이 궁금하신가요?`
	},
	fr: {
		priceProperty: (property, direct) =>
			`${property.name} est à ${money(property.pricePerNight, property.currency)}/nuit, mais avec notre **remise de réservation directe de ${property.directDiscountPercent}%**, vous payez seulement **${money(direct, property.currency)}/nuit**. Utilisez le formulaire de réservation pour vérifier le prix total à vos dates.`,
		priceLine: (name, price, direct) => `- **${name}** : ${price}/nuit (${direct} en direct)`,
		priceAll: (count, lines, discountNote) =>
			`Nous avons ${count} hébergements de luxe :\n${lines}\n\n${discountNote}Quel hébergement vous intéresse ?`,
		discountNote: (percent) => `Tous les prix incluent une **remise directe de ${percent}%**. `,
		booking: (percent) =>
			`Utilisez la carte de réservation ci-dessous pour choisir la villa et les dates, puis continuez vers la réservation directe sécurisée. La réservation directe offre **${percent}% de réduction**, le transfert aéroport gratuit, un panier de bienvenue et le départ tardif.`,
		details: (property) =>
			`**${property.name}** inclut : ${localizedAmenities(property, 'fr')}. C’est un espace de ${property.area}m² avec ${property.bedrooms} chambre(s) et ${property.bathrooms} salle(s) de bain, parfait pour jusqu’à ${property.maxGuests} hôtes. Lancez la **visite virtuelle 360°** pour tout explorer !`,
		generic: (names) =>
			`Bienvenue à Auralis Cove Retreat ! Je peux vous aider avec :\n- les **prix** de nos villas de luxe\n- les **disponibilités** à vos dates\n- les **détails** et équipements\n\nQuel hébergement vous intéresse : ${names} à Koh Samui, Thailand ?`
	},
	de: {
		priceProperty: (property, direct) =>
			`${property.name} kostet ${money(property.pricePerNight, property.currency)}/Nacht, mit unserem **${property.directDiscountPercent}% Direktbuchungsrabatt** zahlen Sie nur **${money(direct, property.currency)}/Nacht**. Nutzen Sie das Buchungsformular, um den Gesamtpreis für Ihre Daten zu prüfen.`,
		priceLine: (name, price, direct) => `- **${name}**: ${price}/Nacht (${direct} direkt)`,
		priceAll: (count, lines, discountNote) =>
			`Wir haben ${count} Luxusunterkünfte:\n${lines}\n\n${discountNote}Welche Unterkunft interessiert Sie?`,
		discountNote: (percent) => `Alle Preise enthalten **${percent}% Direktbuchungsrabatt**. `,
		booking: (percent) =>
			`Wählen Sie Villa und Daten in der Buchungskarte unten und fahren Sie mit der sicheren Direktbuchung fort. Direktbuchung bietet **${percent}% Rabatt** plus kostenlosen Flughafentransfer, Willkommenskorb und späten Checkout.`,
		details: (property) =>
			`**${property.name}** umfasst: ${localizedAmenities(property, 'de')}. Sie hat ${property.area}m², ${property.bedrooms} Schlafzimmer und ${property.bathrooms} Badezimmer, ideal für bis zu ${property.maxGuests} Gäste. Erkunden Sie alles in der **360°-Tour**!`,
		generic: (names) =>
			`Willkommen bei Auralis Cove Retreat! Ich helfe Ihnen mit:\n- **Preisen** unserer Luxusvillen\n- **Verfügbarkeit** für Ihre Reisedaten\n- **Details** und Ausstattung\n\nInteressieren Sie sich für ${names} in Koh Samui, Thailand?`
	},
	es: {
		priceProperty: (property, direct) =>
			`${property.name} cuesta ${money(property.pricePerNight, property.currency)}/noche, pero con nuestro **${property.directDiscountPercent}% de descuento por reserva directa**, paga solo **${money(direct, property.currency)}/noche**. Use el formulario de reserva para ver el precio total de sus fechas.`,
		priceLine: (name, price, direct) => `- **${name}**: ${price}/noche (${direct} directo)`,
		priceAll: (count, lines, discountNote) =>
			`Tenemos ${count} propiedades de lujo:\n${lines}\n\n${discountNote}¿Qué propiedad le interesa?`,
		discountNote: (percent) => `Todos los precios incluyen **${percent}% de descuento directo**. `,
		booking: (percent) =>
			`Use la tarjeta de reserva de abajo para elegir villa y fechas, y continúe con la reserva directa segura. La reserva directa ofrece **${percent}% de descuento**, traslado gratuito desde el aeropuerto, cesta de bienvenida y salida tardía.`,
		details: (property) =>
			`**${property.name}** incluye: ${localizedAmenities(property, 'es')}. Tiene ${property.area}m², ${property.bedrooms} dormitorio(s) y ${property.bathrooms} baño(s), perfecto para hasta ${property.maxGuests} huéspedes. ¡Explore cada habitación con el **tour virtual 360°**!`,
		generic: (names) =>
			`¡Bienvenido a Auralis Cove Retreat! Puedo ayudarle con:\n- **precios** de nuestras villas de lujo\n- **disponibilidad** para sus fechas\n- **detalles** y servicios\n\n¿Qué propiedad le interesa: ${names} en Koh Samui, Thailand?`
	},
	ru: {
		priceProperty: (property, direct) =>
			`${property.name} стоит ${money(property.pricePerNight, property.currency)}/ночь, но с нашей **скидкой ${property.directDiscountPercent}% за прямое бронирование** вы платите всего **${money(direct, property.currency)}/ночь**. Используйте форму бронирования, чтобы проверить итоговую цену на ваши даты.`,
		priceLine: (name, price, direct) => `- **${name}**: ${price}/ночь (${direct} напрямую)`,
		priceAll: (count, lines, discountNote) =>
			`У нас есть ${count} роскошных объекта:\n${lines}\n\n${discountNote}Какой объект вас интересует?`,
		discountNote: (percent) => `Все цены включают **${percent}% скидку за прямое бронирование**. `,
		booking: (percent) =>
			`Выберите виллу и даты в карточке бронирования ниже, затем перейдите к безопасному прямому бронированию. Прямое бронирование дает **скидку ${percent}%**, бесплатный трансфер из аэропорта, приветственный набор и поздний выезд.`,
		details: (property) =>
			`**${property.name}** включает: ${localizedAmenities(property, 'ru')}. Площадь ${property.area}m², ${property.bedrooms} спальни и ${property.bathrooms} ванные, подходит до ${property.maxGuests} гостей. Посмотрите все комнаты в **виртуальном туре 360°**!`,
		generic: (names) =>
			`Добро пожаловать в Auralis Cove Retreat! Я могу помочь с:\n- **ценами** на наши роскошные виллы\n- **доступностью** на ваши даты\n- **деталями объекта** и удобствами\n\nЧто вас интересует: ${names} в Koh Samui, Thailand?`
	},
	it: {
		priceProperty: (property, direct) =>
			`${property.name} costa ${money(property.pricePerNight, property.currency)}/notte, ma con il nostro **sconto prenotazione diretta del ${property.directDiscountPercent}%** paghi solo **${money(direct, property.currency)}/notte**. Usa il modulo di prenotazione per controllare il totale per le tue date.`,
		priceLine: (name, price, direct) => `- **${name}**: ${price}/notte (${direct} diretto)`,
		priceAll: (count, lines, discountNote) =>
			`Abbiamo ${count} proprietà di lusso:\n${lines}\n\n${discountNote}Quale proprietà ti interessa?`,
		discountNote: (percent) => `Tutti i prezzi includono **${percent}% di sconto diretto**. `,
		booking: (percent) =>
			`Usa la scheda di prenotazione sotto per scegliere villa e date, poi continua con la prenotazione diretta sicura. La prenotazione diretta offre **${percent}% di sconto**, transfer aeroportuale gratuito, welcome basket e late checkout.`,
		details: (property) =>
			`**${property.name}** include: ${localizedAmenities(property, 'it')}. È di ${property.area}m² con ${property.bedrooms} camera/e e ${property.bathrooms} bagno/i, perfetta per fino a ${property.maxGuests} ospiti. Esplora ogni stanza con il **tour virtuale 360°**!`,
		generic: (names) =>
			`Benvenuto a Auralis Cove Retreat! Posso aiutarti con:\n- **prezzi** delle nostre ville di lusso\n- **disponibilità** per le tue date\n- **dettagli** e servizi\n\nTi interessa ${names} a Koh Samui, Thailand?`
	},
	hi: {
		priceProperty: (property, direct) =>
			`${property.name} की कीमत ${money(property.pricePerNight, property.currency)}/रात है, लेकिन **${property.directDiscountPercent}% सीधी बुकिंग छूट** के बाद आप केवल **${money(direct, property.currency)}/रात** देते हैं। अपनी तारीखों का कुल मूल्य देखने के लिए बुकिंग फॉर्म उपयोग करें।`,
		priceLine: (name, price, direct) => `- **${name}**: ${price}/रात (सीधे ${direct})`,
		priceAll: (count, lines, discountNote) =>
			`हमारे पास ${count} लक्जरी प्रॉपर्टी हैं:\n${lines}\n\n${discountNote}आपको कौन सी प्रॉपर्टी पसंद है?`,
		discountNote: (percent) => `सभी कीमतों में **${percent}% सीधी बुकिंग छूट** शामिल है। `,
		booking: (percent) =>
			`नीचे बुकिंग कार्ड से विला और तारीखें चुनें, फिर सुरक्षित सीधी बुकिंग पर जाएँ। सीधी बुकिंग में **${percent}% छूट**, मुफ्त एयरपोर्ट पिकअप, वेलकम बास्केट और लेट चेकआउट मिलता है।`,
		details: (property) =>
			`**${property.name}** में शामिल हैं: ${localizedAmenities(property, 'hi')}। यह ${property.area}m² है, इसमें ${property.bedrooms} बेडरूम और ${property.bathrooms} बाथरूम हैं, और अधिकतम ${property.maxGuests} मेहमानों के लिए उपयुक्त है। हर कमरे को देखने के लिए **360° वर्चुअल टूर** लें!`,
		generic: (names) =>
			`Auralis Cove Retreat में आपका स्वागत है! मैं मदद कर सकता हूँ:\n- हमारी लक्जरी विला की **कीमतों** में\n- आपकी यात्रा तारीखों की **उपलब्धता** में\n- **प्रॉपर्टी विवरण** और सुविधाओं में\n\nKoh Samui, Thailand में ${names} में से किसमें रुचि है?`
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

function listNames(names: string[], locale: LocaleCode) {
	try {
		return new Intl.ListFormat(locale, { type: 'disjunction' }).format(names);
	} catch {
		return names.join(', ');
	}
}

/** Keyword-based reply used when no AI key is configured. `villas` are the active properties. */
export function getFallbackResponse(
	message: string,
	property: FallbackVilla | null,
	locale = 'en',
	villas: FallbackVilla[] = property ? [property] : []
): string {
	const lower = message.toLowerCase();
	const code = normalizeLocale(locale);
	const copy = fallbackCopies[code];
	const discounts = villas.map((villa) => villa.directDiscountPercent);

	if (hasIntent(lower, 'price')) {
		if (property) {
			return copy.priceProperty(property, calculateDirectQuote(property, 1).directTotal);
		}
		if (villas.length) {
			const lines = villas
				.map((villa) =>
					copy.priceLine(
						villa.name,
						money(villa.pricePerNight, villa.currency),
						money(calculateDirectQuote(villa, 1).directTotal, villa.currency)
					)
				)
				.join('\n');
			const sharedDiscount = discounts.every((percent) => percent === discounts[0]) ? discounts[0] : 0;
			return copy.priceAll(villas.length, lines, sharedDiscount > 0 ? copy.discountNote(sharedDiscount) : '');
		}
	}

	if (hasIntent(lower, 'booking')) {
		return copy.booking(property?.directDiscountPercent ?? Math.max(0, ...discounts));
	}

	if (hasIntent(lower, 'details') && property) {
		return copy.details(property);
	}

	return copy.generic(listNames(villas.map((villa) => villa.name), code));
}
