import { personName } from "@/components/checkout/staff-approvals";

/**
 * How staff screens name a person recorded by sign-in email: "mint@resort.co" → "Mint", the same
 * name Approvals uses. Anything that isn't an email ("system", a webhook) is shown as it is.
 */
export function personLabel(value: string | null | undefined): string {
  const text = value?.trim() ?? "";
  return /^[^\s@]+@[^\s@]+$/.test(text) ? personName(text) : text;
}
