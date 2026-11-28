export const CONTACT_PREFILL_MESSAGE =
  "Hi, I'm interested in having a website built with you. I'm available on [date] at [time]. Could we talk then?";

export const CONTACT_EMAIL_SUBJECT = "Website inquiry";

function buildMailtoQuery(params: Record<string, string>) {
  // Some mail clients, including Gmail on Android, render URLSearchParams'
  // form-style "+" spaces literally in mailto compose fields.
  return new URLSearchParams(params).toString().replace(/\+/g, "%20");
}

export function normalizeWhatsAppNumber(number: string, countryCode = "66") {
  const digits = number.replace(/\D/g, "");
  if (digits.startsWith("0")) return `${countryCode}${digits.slice(1)}`;
  return digits;
}

export function buildWhatsAppHref(
  number: string,
  message = CONTACT_PREFILL_MESSAGE,
) {
  const cleanNumber = normalizeWhatsAppNumber(number);
  const params = new URLSearchParams({ text: message });
  return `https://wa.me/${cleanNumber}?${params.toString()}`;
}

export function buildEmailHref(
  email: string,
  message = CONTACT_PREFILL_MESSAGE,
  subject = CONTACT_EMAIL_SUBJECT,
) {
  const params = buildMailtoQuery({
    subject,
    body: message,
  });
  return `mailto:${email.trim()}?${params}`;
}

export function buildLineHref({
  fallbackHref = "",
  lineId,
  lineUrl,
}: {
  fallbackHref?: string;
  lineId?: string;
  lineUrl?: string;
}) {
  const trimmedUrl = lineUrl?.trim();
  if (trimmedUrl) return trimmedUrl;

  const trimmedId = lineId?.trim();
  if (trimmedId) {
    return `https://line.me/R/ti/p/${encodeURIComponent(trimmedId)}`;
  }

  return fallbackHref;
}
