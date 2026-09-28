import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "@/lib/admin/csv";

describe("csvCell", () => {
  it("leaves plain values alone", () => {
    expect(csvCell("guest@example.com")).toBe("guest@example.com");
    expect(csvCell("")).toBe("");
  });

  it("quotes separators, quotes and line breaks", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line\nbreak")).toBe('"line\nbreak"');
  });

  it("neutralises spreadsheet formulas", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("-1")).toBe("'-1");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("\tx")).toBe("'\tx");
    expect(csvCell("\rx")).toBe("\"'\rx\"");
  });

  it("only checks the first character", () => {
    expect(csvCell("a=b")).toBe("a=b");
    expect(csvCell("2026-09-28T00:00:00.000Z")).toBe("2026-09-28T00:00:00.000Z");
  });
});

describe("toCsv", () => {
  it("prepends a UTF-8 BOM and joins rows with CRLF", () => {
    expect(toCsv([["email", "villa"], ["a@b.co", "บ้าน, ริมทะเล"]])).toBe('﻿email,villa\r\na@b.co,"บ้าน, ริมทะเล"');
  });
});
