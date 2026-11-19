/** Mask both the printed voucher format and its normalized, separator-free form. */
export function maskVoucherCodes(text: string) {
  return text.replace(/GV[- ]?[A-Z0-9]{4}[- ]?([A-Z0-9]{4})/gi, 'GV-••••-$1');
}
