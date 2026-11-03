import { describe, expect, it } from "vitest";
import { redactPairing, scrubBreadcrumb, scrubEvent } from "@/lib/sentry-privacy";

const SECRET = "Xy9_secret-AbC";

describe("pairing secrets in Sentry reports", () => {
  it("redacts a pair= fragment or query parameter, keeping the rest of the URL", () => {
    expect(redactPairing(`https://shop.test/display#pair=${SECRET}&name=This%20computer`)).toBe("https://shop.test/display#pair=[redacted]&name=This%20computer");
    expect(redactPairing(`/display?x=1&pair=${SECRET}`)).toBe("/display?x=1&pair=[redacted]");
    expect(redactPairing("/admin/checkout?order=k17abc")).toBe("/admin/checkout?order=k17abc");
  });

  it("scrubs navigation, fetch and XHR breadcrumbs", () => {
    const navigation = scrubBreadcrumb({ category: "navigation", data: { from: `/display#pair=${SECRET}`, to: "/display" } });
    const fetch = scrubBreadcrumb({ category: "fetch", data: { url: `/x?pair=${SECRET}`, status_code: 200 } });
    const console = scrubBreadcrumb({ category: "console", message: `opened /display#pair=${SECRET}` });
    expect(JSON.stringify([navigation, fetch, console])).not.toContain(SECRET);
    expect(navigation.data).toEqual({ from: "/display#pair=[redacted]", to: "/display" });
    expect(fetch.data?.status_code).toBe(200);
  });

  it("scrubs the event URL, its name and its breadcrumbs", () => {
    const event = scrubEvent({
      request: { url: `https://shop.test/display#pair=${SECRET}` },
      transaction: `/display#pair=${SECRET}`,
      breadcrumbs: [{ data: { from: `/display#pair=${SECRET}`, to: "/display" } }],
    });
    expect(JSON.stringify(event)).not.toContain(SECRET);
  });
});
