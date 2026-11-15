import { test as base } from "@playwright/test";
export * from "@playwright/test";
/** Consent interaction has dedicated coverage; unrelated flows explicitly decline measurement. */
export const test = base.extend({
  context: async ({ context }, provideContext) => {
    await context.addInitScript(() =>
      localStorage.setItem("analytics-consent-v2", "no"),
    );
    await provideContext(context);
  },
});
