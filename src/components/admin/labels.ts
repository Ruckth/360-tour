/**
 * The one place for human labels shown in admin: channels and booking sources,
 * statuses, payments and money. Views should never print a raw enum value.
 */

/** Where a guest, booking or date block came from. `messenger` and `facebook` are the same channel. */
export const SOURCE_LABELS: Record<string, string> = {
  web: "Website",
  whatsapp: "WhatsApp",
  messenger: "Facebook Messenger",
  facebook: "Facebook Messenger",
  line: "LINE",
  instagram: "Instagram",
  admin: "Manual",
  booking_com: "Booking.com",
  airbnb: "Airbnb",
  agoda: "Agoda",
  expedia: "Expedia",
  direct: "Direct",
  manual: "Manual block",
};

/** Label for a channel or booking source. Unknown values are shown as-is rather than hidden. */
export function sourceLabel(source?: string | null) {
  if (!source) return "Unknown";
  return SOURCE_LABELS[source] ?? source;
}

/** Short fallback name for a chat guest who has not given a name, by channel. */
const GUEST_LABELS: Record<string, string> = {
  web: "Web guest",
  whatsapp: "WhatsApp guest",
  line: "LINE guest",
  facebook: "Facebook guest",
  messenger: "Facebook guest",
  instagram: "Instagram guest",
};

export function guestLabel(channel?: string | null) {
  return GUEST_LABELS[channel ?? "web"] ?? "Guest";
}

/** Human labels for every status the admin shows. Tones live in `status-tones.ts`. */
export const STATUS_LABELS = {
  hotelBooking: {
    pending: "Pending",
    confirmed: "Confirmed",
    paid: "Paid",
    completed: "Completed",
    cancelled: "Cancelled",
    hostBlock: "Host block",
    otaBlock: "OTA block",
  },
  appointment: {
    booked: "Booked",
    arrived: "Arrived",
    in_service: "In service",
    completed: "Completed",
    unpaid: "Unpaid",
    no_show: "No-show",
    cancelled: "Cancelled",
  },
  payment: {
    unpaid: "Unpaid",
    pending: "Unpaid",
    paid: "Paid",
    refunded: "Refunded",
    failed: "Payment failed",
  },
  chatSession: {
    open: "Open",
    needs_reply: "Needs reply",
    resolved: "Resolved",
    archived: "Archived",
    ai_paused: "AI paused",
  },
  answer: {
    draft: "Draft",
    approved: "Approved",
    archived: "Archived",
  },
  unknownQuestion: {
    new: "New",
    resolved: "Resolved",
    ignored: "Ignored",
  },
  channelHealth: {
    ok: "Working",
    warning: "Needs attention",
    failing: "Failing",
    not_configured: "Not set up",
  },
} as const;

export type StatusDomain = keyof typeof STATUS_LABELS;
export type StatusKey<D extends StatusDomain> = keyof (typeof STATUS_LABELS)[D];
export type PaymentStatus = StatusKey<"payment">;

/** Payment status, with how it was paid when that matters to the desk. */
export function paymentLabel(status: PaymentStatus | undefined, method?: string | null) {
  if (status === "paid") {
    if (method === "stripe") return "Paid by card (Stripe)";
    if (method === "admin") return "Paid (recorded by host)";
  }
  return STATUS_LABELS.payment[status ?? "unpaid"];
}

const CURRENCY_SYMBOLS: Record<string, string> = { THB: "฿", USD: "$", EUR: "€", GBP: "£" };

/** `formatMoney(12000, "THB")` → "฿12,000". Unknown currencies read "SGD 12,000". */
export function formatMoney(amount: number, currency = "THB") {
  const digits = Math.abs(amount).toLocaleString("en-US", { maximumFractionDigits: 2 });
  const symbol = CURRENCY_SYMBOLS[currency];
  const sign = amount < 0 ? "-" : "";
  return symbol ? `${sign}${symbol}${digits}` : `${sign}${currency} ${digits}`;
}
