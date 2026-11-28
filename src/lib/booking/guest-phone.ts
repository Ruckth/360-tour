import { getCountryCallingCode, parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/min";
import { parseGuestPhoneInput } from "convex/shared/phone";

/** The booking phone field's draft: the guest's text exactly as typed and the country for national digits. */
export type GuestPhoneDraft = { country: CountryCode; text: string };

export const emptyGuestPhone: GuestPhoneDraft = { country: "TH", text: "" };

/** Quick picks for national input; any other country is accepted by typing its `+` code. */
export const phoneCountries = [
  { country: "TH", label: "TH +66", example: "81 234 5678" },
  { country: "US", label: "US +1", example: "202 555 0123" },
  { country: "GB", label: "UK +44", example: "7400 123456" },
  { country: "AU", label: "AU +61", example: "412 345 678" },
  { country: "SG", label: "SG +65", example: "8123 4567" },
  { country: "JP", label: "JP +81", example: "90 1234 5678" },
  { country: "KR", label: "KR +82", example: "10 1234 5678" },
  { country: "CN", label: "CN +86", example: "138 0013 8000" },
  { country: "DE", label: "DE +49", example: "151 23456789" },
  { country: "FR", label: "FR +33", example: "6 12 34 56 78" },
] as const satisfies readonly { country: CountryCode; label: string; example: string }[];

export const phoneCountryLabel = (country: CountryCode) =>
  phoneCountries.find((item) => item.country === country)?.label ?? `${country} +${getCountryCallingCode(country)}`;

export const isExplicitPhone = (text: string) => /^\s*(\+|00)/.test(text);

/** Valid E.164 for submission, else undefined (the text stays in the field for correction). */
export const guestPhoneE164 = (draft: GuestPhoneDraft) => parseGuestPhoneInput(draft.text, draft.country).e164;

/**
 * The country the selector shows: for `+…` input, the country the number itself identifies, or the
 * chosen country while that country's code is still being typed; otherwise the chosen country.
 */
export function shownPhoneCountry(draft: GuestPhoneDraft): CountryCode {
  if (!isExplicitPhone(draft.text)) return draft.country;
  return parseGuestPhoneInput(draft.text, draft.country).country ?? draft.country;
}

/** Choosing a country rewrites a recognised `+…` number as national digits so it follows the new pick. */
export function chooseGuestPhoneCountry(draft: GuestPhoneDraft, country: CountryCode): GuestPhoneDraft {
  if (!isExplicitPhone(draft.text)) return { country, text: draft.text };
  const parsed = parsePhoneNumberFromString(`+${draft.text.trim().replace(/^(\+|00)/, "")}`);
  return { country, text: parsed?.country === country ? draft.text : parsed?.nationalNumber ?? draft.text };
}

export const formatGuestPhone = (e164: string) => parsePhoneNumberFromString(e164)?.formatInternational() ?? e164;
