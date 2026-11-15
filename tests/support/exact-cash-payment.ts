import type { Locator } from "@playwright/test";

/** Cash UI journey shared by the component check and the real signed-in receipt test. */
export async function recordExactCash(order: Locator) {
  await order.getByRole("button", { name: /^Cash(?: ฿[\d,.]+)?$/, exact: true }).click();
  const cash = order.getByRole("group", { name: "Cash payment", exact: true });
  await cash.getByRole("button", { name: "Exact", exact: true }).click();
  await cash.getByRole("button", { name: /^Confirm cash · ฿[\d,.]+ received · no change$/, exact: true }).click();
}
