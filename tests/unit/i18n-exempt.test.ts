import { describe, expect, it } from "vitest";
import { bypassesI18n } from "@/lib/i18n-exempt";

describe("proxy i18n exemptions", () => {
  it.each(["/display", "/display/", "/admin/checkout", "/api/chat", "/dev/checkout-preview", "/sign-in", "/__clerk/x"])("skips next-intl for %s", (path) => {
    expect(bypassesI18n(path)).toBe(true);
  });

  it.each(["/", "/booking", "/th/display", "/displays", "/displayed", "/dev"])("localizes %s", (path) => {
    expect(bypassesI18n(path)).toBe(false);
  });
});
