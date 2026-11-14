import { expect, it, vi } from "vitest";

it("reuses locale formatters across date and calendar renders", async () => {
  vi.resetModules();
  const Original = Intl.DateTimeFormat;
  const constructor = vi.spyOn(Intl, "DateTimeFormat").mockImplementation(function (locale, options) {
    return new Original(locale, options);
  });
  try {
    const { formatPickerDate, getCalendarFormatters } = await import("@/lib/dates/format");
    const first = formatPickerDate("2026-11-14", "en");
    const calendar = getCalendarFormatters("en");
    for (let index = 0; index < 100; index++) {
      expect(formatPickerDate("2026-11-14", "en-US")).toBe(first);
      expect(getCalendarFormatters("en-US")).toBe(calendar);
    }
    expect(constructor).toHaveBeenCalledTimes(3);
    expect(formatPickerDate("", "en", "Choose")).toBe("Choose");
    expect(formatPickerDate("2026-11-14", "th")).toContain("2569");
  } finally {
    constructor.mockRestore();
  }
});
