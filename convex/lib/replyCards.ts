import { allowedImageUrl } from './imageUrls';

/** Presentation data comes only from successful tool results, never model prose. */
export type ReplyCardAction =
  | { type: 'uri'; label: string; url: string }
  | { type: 'message'; label: string; id: string; text: string };
export type ReplyCardItem = { title: string; lines: string[]; imageUrl?: string; actions: ReplyCardAction[] };
export type ReplyCard = { kind: 'properties' | 'property' | 'quote' | 'booking' | 'services' | 'service'; items: ReplyCardItem[] };
export type ReplyToolTrace = { name: string; args: Record<string, unknown>; result: string };

const copy = {
  en: ['Details', 'View villa', 'Check times', 'Confirm & pay', 'Pay now', 'per night', 'guests', 'bedrooms', 'Total', 'Not booked yet', 'Pending payment', 'Paid', 'Confirmed', 'Reply yes to confirm', 'Pay at resort', 'min'],
  th: ['รายละเอียด', 'ดูวิลล่า', 'เช็คเวลา', 'ยืนยันและชำระเงิน', 'ชำระเงิน', 'ต่อคืน', 'ผู้เข้าพัก', 'ห้องนอน', 'รวม', 'ยังไม่ได้จอง', 'รอชำระเงิน', 'ชำระแล้ว', 'ยืนยันแล้ว', 'ตอบ yes เพื่อยืนยัน', 'ชำระที่รีสอร์ท', 'นาที'],
  ko: ['상세 정보', '빌라 보기', '시간 확인', '확인 및 결제', '결제하기', '1박', '명', '침실', '합계', '예약 전', '결제 대기', '결제 완료', '예약 확정', 'yes로 답해 확정', '리조트에서 결제', '분'],
  'zh-CN': ['详情', '查看别墅', '查看时间', '确认并付款', '付款', '每晚', '位客人', '卧室', '总计', '尚未预订', '待付款', '已付款', '已确认', '回复 yes 确认', '到店付款', '分钟'],
  ja: ['詳細', 'ヴィラを見る', '時間を確認', '確認して支払う', '支払う', '1泊', '名', '寝室', '合計', '未予約', '支払い待ち', '支払い済み', '確定', 'yes と返信して確定', '現地で支払い', '分'],
  fr: ['Détails', 'Voir la villa', 'Voir les horaires', 'Confirmer et payer', 'Payer', 'par nuit', 'voyageurs', 'chambres', 'Total', 'Pas encore réservé', 'Paiement en attente', 'Payé', 'Confirmé', 'Répondez yes pour confirmer', 'Paiement sur place', 'min'],
  de: ['Details', 'Villa ansehen', 'Zeiten prüfen', 'Bestätigen & zahlen', 'Jetzt zahlen', 'pro Nacht', 'Gäste', 'Schlafzimmer', 'Gesamt', 'Noch nicht gebucht', 'Zahlung ausstehend', 'Bezahlt', 'Bestätigt', 'Mit yes bestätigen', 'Zahlung vor Ort', 'Min.'],
  es: ['Detalles', 'Ver villa', 'Ver horarios', 'Confirmar y pagar', 'Pagar', 'por noche', 'huéspedes', 'dormitorios', 'Total', 'Aún sin reservar', 'Pago pendiente', 'Pagado', 'Confirmado', 'Responde yes para confirmar', 'Pago en el resort', 'min'],
  ru: ['Подробнее', 'Посмотреть виллу', 'Проверить время', 'Подтвердить и платить', 'Оплатить', 'за ночь', 'гостей', 'спален', 'Итого', 'Ещё не забронировано', 'Ожидает оплаты', 'Оплачено', 'Подтверждено', 'Ответьте yes для подтверждения', 'Оплата на месте', 'мин'],
  it: ['Dettagli', 'Vedi villa', 'Vedi orari', 'Conferma e paga', 'Paga', 'per notte', 'ospiti', 'camere', 'Totale', 'Non ancora prenotato', 'Pagamento in attesa', 'Pagato', 'Confermato', 'Rispondi yes per confermare', 'Pagamento in struttura', 'min'],
  hi: ['विवरण', 'विला देखें', 'समय देखें', 'पुष्टि और भुगतान', 'भुगतान करें', 'प्रति रात', 'मेहमान', 'बेडरूम', 'कुल', 'अभी बुक नहीं हुआ', 'भुगतान बाकी', 'भुगतान हुआ', 'पुष्टि हुई', 'पुष्टि के लिए yes लिखें', 'रिसॉर्ट में भुगतान', 'मिनट'],
} satisfies Record<string, string[]>;

export function cardText(value: string, max: number): string {
  // Count UTF-16 units conservatively, but never split a surrogate pair.
  if (value.length <= max) return value;
  return value.slice(0, max - 1).replace(/[\uD800-\uDBFF]$/, '') + '…';
}
function str(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function rows(value: unknown): Record<string, unknown>[] { return Array.isArray(value) ? value.slice(0, 10).map(record) : []; }
function money(value: unknown, currency: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && /^[A-Z]{3}$/.test(str(currency))
    ? `${str(currency)} ${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : '';
}
function secureUrl(value: unknown, siteUrl?: string): string | undefined {
  if (!str(value)) return;
  try {
    const url = new URL(str(value), siteUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.href.length > 2000) return;
    return url.href;
  } catch { return; }
}
function siteLink(value: string, siteUrl?: string): string | undefined {
  const url = secureUrl(value, siteUrl);
  try { return url && new URL(url).origin === new URL(siteUrl ?? '').origin ? url : undefined; } catch { return; }
}
function image(value: unknown, siteUrl?: string): string | undefined {
  if (!allowedImageUrl(str(value))) return;
  const url = secureUrl(value, siteUrl);
  if (str(value).startsWith('/')) return url && siteLink(url, siteUrl) ? url : undefined;
  return url && allowedImageUrl(url) ? url : undefined;
}

/** Only read-only browsing intents can be generated or accepted as button callbacks. */
const browseCopy: Record<string, [string, string]> = {
  en: ['Show details for villa', 'I am interested in service'],
  th: ['ขอรายละเอียดวิลล่า', 'สนใจบริการ'],
  ko: ['빌라 정보를 보여 주세요:', '이 서비스에 관심이 있어요:'],
  'zh-CN': ['请介绍别墅：', '我对这项服务感兴趣：'],
  ja: ['ヴィラの詳細を教えてください：', 'このサービスに興味があります：'],
  fr: ['Montrez les détails de la villa', 'Ce service m’intéresse :'],
  de: ['Zeigen Sie Details zur Villa', 'Ich interessiere mich für den Service'],
  es: ['Muéstrame los detalles de la villa', 'Me interesa el servicio'],
  ru: ['Покажите информацию о вилле', 'Меня интересует услуга'],
  it: ['Mostra i dettagli della villa', 'Mi interessa il servizio'],
  hi: ['विला का विवरण दिखाएँ:', 'मुझे इस सेवा में रुचि है:'],
};

export function cardBrowseAction(kind: 'property' | 'service', slug: string, label: string, locale = 'en'): ReplyCardAction | undefined {
  if (!/^[\p{L}\p{N}\p{M}_ -]{1,100}$/u.test(slug)) return;
  const id = `card:v1:${kind}:${encodeURIComponent(slug)}${locale !== 'en' && browseCopy[locale] ? `:${locale}` : ''}`;
  if (id.length > 256) return;
  return { type: 'message', id, label, text: cardBrowseMessage(id)! };
}
export function cardBrowseMessage(id: unknown): string | undefined {
  if (typeof id !== 'string') return;
  if (id.length > 256) return;
  const match = /^card:v1:(property|service):([a-zA-Z0-9_%~-]+)(?::([a-zA-Z-]+))?$/.exec(id);
  if (!match) return;
  let slug: string;
  try { slug = decodeURIComponent(match[2]); } catch { return; }
  if (!/^[\p{L}\p{N}\p{M}_ -]{1,100}$/u.test(slug)) return;
  const locale = match[3] ?? 'en';
  const phrases = browseCopy[locale];
  if (!phrases) return;
  return match[1] === 'property'
    ? `${phrases[0]} ${slug}.`
    : `${phrases[1]} ${slug}.${locale === 'en' ? ' Ask me which date and time I would like.' : ''}`;
}

export function replyCardFromTool(trace: ReplyToolTrace, options: { siteUrl?: string; locale?: string }): ReplyCard | undefined {
  let result: Record<string, unknown>;
  try { result = record(JSON.parse(trace.result)); } catch { return; }
  if (result.error || result.ok === false) return;
  const labels = copy[options.locale as keyof typeof copy] ?? copy.en;
  const [details, view, times, confirm, pay, night, guests, bedrooms, total, proposal, pending, paid, confirmed, yes, atResort, minutes] = labels;
  const items: ReplyCardItem[] = [];
  const add = (title: unknown, lines: string[], actions: Array<ReplyCardAction | undefined>, photo?: unknown) => {
    if (!str(title)) return;
    const photoUrl = image(photo, options.siteUrl);
    items.push({ title: cardText(str(title).replace(/\s+/g, ' '), 80), lines: lines.filter(Boolean).map(line => cardText(line, 200)).slice(0, 6),
      actions: actions.filter((a): a is ReplyCardAction => !!a).slice(0, 2), ...(photoUrl ? { imageUrl: photoUrl } : {}) });
  };
  const uri = (label: string, value: string): ReplyCardAction | undefined => {
    const url = siteLink(value, options.siteUrl);
    return url ? { type: 'uri', label, url } : undefined;
  };
  let kind: ReplyCard['kind'];
  switch (trace.name) {
    case 'list_properties':
    case 'get_property_details': {
      kind = trace.name === 'list_properties' ? 'properties' : 'property';
      for (const p of trace.name === 'list_properties' ? rows(result.properties) : [result]) {
        const price = money(p.directPrice, p.currency ?? result.currency);
        add(p.name, [price ? `${price} / ${night}` : '', typeof p.maxGuests === 'number' ? `${p.maxGuests} ${guests}` : '', typeof p.bedrooms === 'number' ? `${p.bedrooms} ${bedrooms}` : ''],
          [cardBrowseAction('property', str(p.slug), details, options.locale), uri(view, `/rooms/${encodeURIComponent(str(p.slug))}`)], p.imageUrl);
      }
      break;
    }
    case 'list_services': {
      kind = 'services';
      for (const s of rows(result.services)) add(s.name, [money(s.price, s.currency), typeof s.durationMin === 'number' ? `${s.durationMin} ${minutes}` : '', str(s.category)],
        [cardBrowseAction('service', str(s.slug), times, options.locale)], s.imageUrl);
      break;
    }
    case 'prepare_booking':
    case 'confirm_booking': {
      kind = 'booking';
      const preparing = trace.name === 'prepare_booking';
      const amount = money(result.total, result.currency);
      if (!amount || !str(result.checkIn) || !str(result.checkOut)) return;
      add(result.property, [preparing ? proposal : result.status === 'paid' ? paid : pending,
        `${str(result.checkIn)} → ${str(result.checkOut)}`, `${result.guests} ${guests}`, `${total}: ${amount}`, str(result.confirmationCode)],
        [preparing ? uri(confirm, str(result.confirmUrl)) : result.status === 'pending_payment' ? uri(pay, str(result.paymentUrl)) : undefined]);
      break;
    }
    case 'calculate_price': {
      kind = 'quote';
      const amount = money(result.directTotal, result.currency);
      if (!amount) return;
      add(result.property, [`${total}: ${amount}`, proposal], []);
      break;
    }
    case 'prepare_service_booking':
    case 'confirm_service_booking': {
      kind = 'service';
      const preparing = trace.name === 'prepare_service_booking';
      const amount = money(result.price, result.currency);
      if (!amount) return;
      // No generic yes button: an old card must never confirm a newer proposal.
      add(result.service, [preparing ? proposal : confirmed, `${str(result.date)} ${str(result.time)}`, `${total}: ${amount}`, atResort,
        preparing ? yes : str(result.confirmationCode)], []);
      break;
    }
    default: return;
  }
  return items.length ? { kind, items } : undefined;
}

/** A later failed read/write must not leave an earlier success card visible. */
export function isCardTool(name: string): boolean {
  return ['list_properties', 'get_property_details', 'list_services', 'calculate_price', 'check_availability', 'check_service_availability',
    'prepare_booking', 'confirm_booking', 'prepare_service_booking', 'confirm_service_booking', 'cancel_booking', 'get_my_bookings'].includes(name);
}
