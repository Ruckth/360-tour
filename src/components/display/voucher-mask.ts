/**
 * A gift voucher's full code ("GV-7K2M-Q9XD") is shown only on its gift slip. Anything else that
 * might carry one (receipts, shared text, the customer display) passes its text through here, so a
 * code becomes its mask ("GV-••••-Q9XD") even if a full code ever reached the screen by mistake.
 */
export function maskVoucherCodes(text: string) {
  return text.replace(/\b([A-Z]{2,4})-([A-Z0-9]{4})-([A-Z0-9]{4})\b/g, "$1-••••-$3");
}
