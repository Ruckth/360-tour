/** What `/admin/checkout` opens with: a new bill, one bill, or a bill for one booking or appointment. */
export type CheckoutSource =
  | { kind: "new" }
  | { kind: "bill"; id: string }
  | { kind: "booking"; id: string }
  | { kind: "appointment"; id: string }
  | { kind: "invalid"; reason: string };

const KEYS = ["bill", "booking", "appointment"] as const;

/** Strict: exactly zero or one of `?bill=`, `?booking=`, `?appointment=`, given once with a plain id. */
export function parseCheckoutSource(params: URLSearchParams): CheckoutSource {
  const present = KEYS.filter((key) => params.has(key));
  if (present.length === 0) return { kind: "new" };
  if (present.length > 1) return { kind: "invalid", reason: `Open checkout with only one of ${present.map((k) => `?${k}=`).join(", ")}.` };
  const key = present[0];
  const values = params.getAll(key);
  if (values.length !== 1) return { kind: "invalid", reason: `?${key}= is given more than once.` };
  const id = values[0].trim();
  if (!/^[a-z0-9]{8,64}$/i.test(id)) return { kind: "invalid", reason: `?${key}= is not a valid id.` };
  return { kind: key, id };
}
