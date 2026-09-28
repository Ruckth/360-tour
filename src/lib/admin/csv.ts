/** Cells starting with these are run as formulas by Excel/Sheets, so they get a leading apostrophe. */
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

/** One CSV cell: neutralises spreadsheet formulas and quotes values containing separators or quotes. */
export function csvCell(value: string) {
  const safe = FORMULA_PREFIX.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** A CSV document with a UTF-8 BOM so Excel reads non-Latin text (Thai, Korean, ...) correctly. */
export function toCsv(rows: string[][]) {
  return `﻿${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
}
