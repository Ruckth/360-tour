export const CONTACT_PREFILL_MESSAGE =
  "Hi, I'm interested in having a website built with you. I'm available on [date] at [time]. Could we talk then?";

export const CONTACT_EMAIL_SUBJECT = "Website inquiry";

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
) {
  const params = new URLSearchParams({
    subject: CONTACT_EMAIL_SUBJECT,
    body: message,
  });
  return `mailto:${email.trim()}?${params.toString()}`;
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
