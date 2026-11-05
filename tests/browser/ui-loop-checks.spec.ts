import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { captureSegments } from "../../scripts/ui-loop/capture";
import { measureDOM } from "../../scripts/ui-loop/checks";
import { THRESHOLDS } from "../../scripts/ui-loop/config";

test("keyboard captures preserve the focused field's scrolled viewport", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 400, height: 300 });
  await page.setContent(
    '<main style="height:200px;overflow:auto"><div style="height:400px;background:#ccc">Top of form</div><input aria-label="Amount"><div style="height:200px;background:#eee">Actions</div></main>',
  );
  await page.getByLabel("Amount").focus();
  await page
    .getByLabel("Amount")
    .evaluate((el) => el.scrollIntoView({ block: "center" }));
  await page.addStyleTag({ content: "*{caret-color:transparent}" });
  const expected = await page.screenshot();
  const stem = info.outputPath("keyboard");
  await captureSegments(page, stem, true);
  expect(await readFile(stem + ".png")).toEqual(expected);
});

async function truncation(page: Page, html: string) {
  await page.setContent(
    `<style>body { font: 16px/24px monospace; color: #000; background: #fff; }</style>${html}`,
  );
  const checks = await page.evaluate(measureDOM, {
    touch: false,
    phone: false,
    t: THRESHOLDS,
  });
  return checks.find((check) => check.id === "truncation")!;
}

test("ellipsized row text does not collide past its own clip", async ({
  page,
}) => {
  const check = await truncation(
    page,
    `<div role="row" style="display:flex;gap:8px">
    <span title="A very long guest name" style="width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">A very long guest name</span>
    <span>Waiting</span></div>`,
  );
  expect(check.pass).toBe(true);
});

test("wrapped inline fragments do not collide in their empty bounding area", async ({
  page,
}) => {
  const check = await truncation(
    page,
    `<div style="width:190px"><span>Money received </span><span>2026-11-05 · 10:00</span><span> · Bangkok</span></div>`,
  );
  expect(check.pass).toBe(true);
});

test("visible overlapping labels are still reported", async ({ page }) => {
  const check = await truncation(
    page,
    `<div style="position:relative;height:48px"><span style="position:absolute;left:0">Guest name</span><span style="position:absolute;left:24px">Waiting</span></div>`,
  );
  expect(check.pass).toBe(false);
  expect(
    check.offenders.some((item) => item.detail.startsWith("Text intersects")),
  ).toBe(true);
});

test("checks text nodes after an inline child as well as the first node", async ({
  page,
}) => {
  const check = await truncation(
    page,
    `<div style="position:relative;height:48px"><span>First <b>middle</b> trailing text</span><span style="position:absolute;left:140px;top:0">Waiting</span></div>`,
  );
  expect(check.pass).toBe(false);
  expect(
    check.offenders.some((item) => item.detail.startsWith("Text intersects")),
  ).toBe(true);
});
