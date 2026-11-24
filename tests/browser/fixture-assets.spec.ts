import { globSync } from "node:fs";
import { expect, test } from "@playwright/test";

test("fixture pages load built modules throughout the browser suite", async ({ request }) => {
  const pages = globSync("tests/browser/**/*.html");
  expect(pages).toContain("tests/browser/pay-desk.html");
  for (const path of pages) {
    const response = await request.get(`/${path}`);
    expect(response.ok(), path).toBe(true);
    const html = await response.text();
    expect(html, path).toMatch(/<script\b[^>]*\bsrc="\/assets\/[^"]+\.js"/);
    expect(html, path).not.toContain("/@vite/client");
  }
});
