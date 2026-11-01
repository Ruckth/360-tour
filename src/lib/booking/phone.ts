import { parsePhoneNumberFromString } from "libphonenumber-js/min";

/** E.164 for recognizable contacts; undefined for ambiguous legacy text the host must check. */
export function normalizeGuestPhone(value: string): string | undefined {
  const trimmed = value.trim();
  const explicit = trimmed.startsWith("+") || trimmed.startsWith("00");
  const input = trimmed.startsWith("00") ? `+${trimmed.slice(2)}` : trimmed;
  const parsed = parsePhoneNumberFromString(input, explicit ? undefined : "TH");
  if (parsed?.ext) return undefined;
  if (parsed && (explicit ? parsed.isPossible() : parsed.isValid())) return parsed.number;
  // Historic WhatsApp contacts are stored as international digits without '+'.
  if (/^[1-9]\d{9,14}$/.test(trimmed)) {
    const international = parsePhoneNumberFromString(`+${trimmed}`);
    if (international?.isValid()) return international.number;
  }
  return undefined;
}

/** Optional customer contact, using the same Thai/local and international rules as guest input. */
export function customerPhoneError(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  // Historic international digits may also be entered with spaces or punctuation, without '+'.
  const compact = value.replace(/[\s().-]/g, "");
  // The phone parser can extract numbers from prose; a contact field must be the whole number.
  if (!/^\+?\d+$/.test(compact)) return "Enter a valid phone number. Include the country code for numbers outside Thailand.";
  const international = /^[1-9]\d{9,14}$/.test(compact) ? parsePhoneNumberFromString(`+${compact}`) : undefined;
  if (normalizeGuestPhone(compact) || international?.isPossible()) return undefined;
  return "Enter a valid phone number. Include the country code for numbers outside Thailand.";
}
