/**
 * What `/admin/checkout` opens with: a new order, one order, or the order for one booking or
 * appointment. `?bill=` is the old name for `?order=`; it still opens the order (`legacy`), and
 * the page rewrites the URL.
 */
export type CheckoutSource =
  | { kind: "new" }
  | { kind: "order"; id: string; legacy?: true }
  | { kind: "booking"; id: string }
  | { kind: "appointment"; id: string }
  | { kind: "invalid"; reason: string };

const KEYS = ["order", "bill", "booking", "appointment"] as const;

/** Strict: exactly zero or one of `?order=` (or `?bill=`), `?booking=`, `?appointment=`, given once with a plain id. */
export function parseCheckoutSource(params: URLSearchParams): CheckoutSource {
  const present = KEYS.filter((key) => params.has(key));
  if (present.length === 0) return { kind: "new" };
  if (present.length > 1) return { kind: "invalid", reason: `Open checkout with only one of ${present.map((k) => `?${k}=`).join(", ")}.` };
  const key = present[0];
  const values = params.getAll(key);
  if (values.length !== 1) return { kind: "invalid", reason: `?${key}= is given more than once.` };
  const id = values[0].trim();
  if (!/^[a-z0-9]{8,64}$/i.test(id)) return { kind: "invalid", reason: `?${key}= is not a valid id.` };
  if (key === "bill") return { kind: "order", id, legacy: true };
  return { kind: key, id };
}

export const orderPath = (orderId: string) => `/admin/checkout?order=${orderId}`;
export const receiptPath = (orderId: string) => `/admin/receipt/${orderId}`;
