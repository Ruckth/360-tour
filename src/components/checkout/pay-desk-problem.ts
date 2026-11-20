import { COMMERCE_REFUSAL_MESSAGES, type PayRefusal } from "./backend";

/** A failed step: the server's refusal (nothing written), or no answer at all (safe to retry). */
export type Problem = { refusal: PayRefusal } | { lost: true };

export function payProblem(err: unknown): Problem {
  const data = err && typeof err === "object" && "data" in err ? (err as { data?: unknown }).data : undefined;
  if (data && typeof data === "object" && typeof (data as { code?: unknown }).code === "string") {
    const { code } = data as { code: string };
    if (code === "SERVER" || Object.hasOwn(COMMERCE_REFUSAL_MESSAGES, code)) return { refusal: data as PayRefusal };
    // Attempt commands already arrive in the client's terms (pay-desk-attempts); anything else is the server's own words.
    return { refusal: { code: "SERVER", reason: code, message: (data as { message?: string }).message || "Review the payment again." } };
  }
  if (typeof data === "string") return { refusal: { code: "SERVER", reason: "error", message: data } };
  return { lost: true };
}
