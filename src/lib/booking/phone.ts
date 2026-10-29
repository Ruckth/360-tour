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
