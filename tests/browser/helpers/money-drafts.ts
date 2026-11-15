import { type Page } from "@playwright/test";
import { DESK_NOW } from "./desk-taps";

export const MONEY_DRAFT_SCENARIOS = ["stay-pay", "stay-refund", "stay-amend", "stay-void", "stay-legacy", "stay-stripe", "appointment-pay", "appointment-refund", "appointment-amend", "appointment-cancel", "appointment-legacyCancel"] as const;
export async function openMoneyDraft(page: Page, scenario: typeof MONEY_DRAFT_SCENARIOS[number]) {
  await page.clock.setFixedTime(DESK_NOW);
  await page.goto(`/tests/browser/money-drafts.html?scenario=${scenario}`);
  await page.locator("[data-fixture-ready]").waitFor();
  if (!scenario.startsWith("stay")) return;
  if (["stay-amend", "stay-void", "stay-stripe"].includes(scenario)) await page.getByText("History", { exact: true }).click();
  const name = scenario === "stay-pay" ? "Record external payment…" : scenario === "stay-refund" ? "Record refund"
    : scenario === "stay-amend" ? "Correct…" : scenario === "stay-stripe" ? "Link Stripe refund evidence" : "Entered by mistake…";
  await page.getByRole("button", { name, exact: true }).click();
}
