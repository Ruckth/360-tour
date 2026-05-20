import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultLocale, locales, localizeHref, stripLocalePrefix } from "@/i18n/routing";

type Messages = Record<string, unknown>;

function flattenKeys(value: Messages, prefix = ""): string[] {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return child && typeof child === "object" && !Array.isArray(child)
      ? flattenKeys(child as Messages, path)
      : [path];
  });
}

function readMessages(locale: string) {
  return JSON.parse(readFileSync(join(process.cwd(), "messages", `${locale}.json`), "utf8")) as Messages;
}

describe("i18n routing helpers", () => {
  it("keeps English unprefixed and prefixes translated routes", () => {
    expect(localizeHref("/", defaultLocale)).toBe("/");
    expect(localizeHref("/booking", "en")).toBe("/booking");
    expect(localizeHref("/booking", "th")).toBe("/th/booking");
    expect(localizeHref("/rooms/garden-suite?tour=1", "ja")).toBe("/ja/rooms/garden-suite?tour=1");
    expect(localizeHref("/#villas", "zh-CN")).toBe("/zh-CN#villas");
    expect(localizeHref("/th/booking?unit=garden-suite", "en")).toBe("/booking?unit=garden-suite");
  });

  it("strips supported locale prefixes and leaves external links unchanged", () => {
    expect(stripLocalePrefix("/th/booking")).toBe("/booking");
    expect(stripLocalePrefix("/zh-CN/rooms/pool-villa")).toBe("/rooms/pool-villa");
    expect(stripLocalePrefix("/ar/booking")).toBe("/ar/booking");
    expect(localizeHref("https://example.com", "ja")).toBe("https://example.com");
    expect(localizeHref("mailto:stay@example.com", "ja")).toBe("mailto:stay@example.com");
    expect(localizeHref("tel:+6677000000", "ja")).toBe("tel:+6677000000");
  });
});

describe("message files", () => {
  it("has complete message keys for every supported locale", () => {
    const englishKeys = flattenKeys(readMessages("en")).sort();

    for (const locale of locales) {
      const keys = flattenKeys(readMessages(locale)).sort();
      expect(keys, locale).toEqual(englishKeys);
    }
  });
});
