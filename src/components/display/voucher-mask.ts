/**
 * A gift voucher's full code ("GV-7K2M-Q9XD") is shown only on its gift slip. Anything else that
 * might carry one (receipts, shared text, the customer display) passes its text through the one
 * shared masker, so a code in any case or spelling becomes its mask ("GV-••••-Q9XD").
 */
export { maskVoucherCodes } from "convex/shared/voucherCode";
