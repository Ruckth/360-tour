/** Cells starting with these are run as formulas by Excel/Sheets, so they get a leading apostrophe. */
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

/**
 * One CSV cell: neutralises spreadsheet formulas and quotes values containing separators or quotes.
 * A number is written as it is, so a negative amount stays a number a spreadsheet can add up.
 */
export function csvCell(value: string | number) {
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  const safe = FORMULA_PREFIX.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** A CSV document with a UTF-8 BOM so Excel reads non-Latin text (Thai, Korean, ...) correctly. */
export function toCsv(rows: (string | number)[][]) {
  return `﻿${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
}
