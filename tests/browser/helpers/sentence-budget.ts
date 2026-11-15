import { expect, type Locator } from "@playwright/test";
import { visibleSentences } from "./sentence-count";

/**
 * Opt-in check for rule 4 ("one sentence or ⓘ"): fails when `locator` shows more than `max`
 * explanatory sentences. Mark money or receipt content with `data-sentence-budget="ignore"`.
 */
export async function expectAtMostSentences(locator: Locator, max: number) {
  const sentences = await locator.evaluate(visibleSentences);
  expect(
    sentences.length,
    `Expected at most ${max} explanatory sentence(s), found ${sentences.length}:\n${sentences.join("\n")}`,
  ).toBeLessThanOrEqual(max);
}
