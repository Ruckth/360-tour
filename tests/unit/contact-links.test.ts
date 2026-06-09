import { describe, expect, it } from "vitest";
import {
  CONTACT_EMAIL_SUBJECT,
  CONTACT_PREFILL_MESSAGE,
  buildEmailHref,
  buildLineHref,
  buildWhatsAppHref,
  normalizeWhatsAppNumber,
} from "@/lib/contact-links";

describe("contact link helpers", () => {
  it("normalizes a Thai local mobile number for WhatsApp", () => {
    expect(normalizeWhatsAppNumber("095 682 3432")).toBe("66956823432");
    expect(normalizeWhatsAppNumber("+66 95 682 3432")).toBe("66956823432");
  });

  it("builds a WhatsApp link with the prefilled outreach message", () => {
    const href = buildWhatsAppHref("095 682 3432");
    const url = new URL(href);

    expect(url.origin).toBe("https://wa.me");
    expect(url.pathname).toBe("/66956823432");
    expect(url.searchParams.get("text")).toBe(CONTACT_PREFILL_MESSAGE);
  });

  it("builds an email link with subject and body", () => {
    const href = buildEmailHref(" rugbykritsakorn@gmail.com ");
    const url = new URL(href);

    expect(url.protocol).toBe("mailto:");
    expect(url.pathname).toBe("rugbykritsakorn@gmail.com");
    expect(href).toContain("subject=Website%20inquiry");
    expect(href).toContain("body=Hi%2C%20I%27m%20interested");
    expect(href).not.toContain("+");
    expect(url.searchParams.get("subject")).toBe(CONTACT_EMAIL_SUBJECT);
    expect(url.searchParams.get("body")).toBe(CONTACT_PREFILL_MESSAGE);
  });

  it("preserves a direct LINE URL before falling back to LINE ID", () => {
    expect(
      buildLineHref({
        lineId: "@legacy",
        lineUrl: " https://line.me/R/ti/p/@361jhvij ",
      }),
    ).toBe("https://line.me/R/ti/p/@361jhvij");
    expect(buildLineHref({ lineId: "@legacy" })).toBe("https://line.me/R/ti/p/%40legacy");
  });
});
