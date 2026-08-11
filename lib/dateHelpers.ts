import * as XLSX from "xlsx";

/**
 * Helpers for the "Month" field (billing_period), which is stored in the
 * database as a full `date` (first of the month) but should only ever be
 * picked/displayed as a month, with no specific day or day-level meaning.
 */

/** Converts a stored date string (e.g. "2026-07-01") to a month-input value ("2026-07"). */
export function dateToMonthValue(value: string | null | undefined): string {
  if (!value) return "";
  return value.slice(0, 7);
}

/** Converts a month-input value ("2026-07") to a storable date string ("2026-07-01"). */
export function monthValueToDate(value: string | null | undefined): string | null {
  if (!value) return null;
  return `${value}-01`;
}

/**
 * Today's month as a month-input value ("2026-07"). Used to default the
 * "Month" field to the current month at encode time -- most invoices are
 * encoded for the current month, and the field stays fully editable if a
 * different month is needed.
 */
export function currentMonthValue(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Normalizes a pasted date cell into the "YYYY-MM-DD" shape a native date
 * input requires. Excel copies a date cell to the clipboard as
 * locale-formatted text (e.g. "8/6/2026"), not ISO, so pasting it straight
 * into an <input type="date"> silently fails to display (the browser just
 * shows it blank) while the invalid string still sits in state and would
 * later fail the insert/update. Handles already-ISO text, "M/D/YY(YY)", and
 * a bare Excel serial number (in case the source cell's format was
 * "General"). Falls back to the raw trimmed text for anything unrecognized,
 * so a hand-typed value never gets silently blanked.
 */
export function parsePastedDate(raw: string): string {
  const text = raw.trim();
  if (!text) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);

  const slashMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slashMatch) {
    const [, mStr, dStr, yStr] = slashMatch;
    let year = parseInt(yStr, 10);
    if (yStr.length === 2) year += year < 70 ? 2000 : 1900;
    const mm = mStr.padStart(2, "0");
    const dd = dStr.padStart(2, "0");
    return `${year}-${mm}-${dd}`;
  }

  if (/^\d+(\.\d+)?$/.test(text)) {
    const parsed = XLSX.SSF.parse_date_code(Number(text));
    if (parsed) {
      const mm = String(parsed.m).padStart(2, "0");
      const dd = String(parsed.d).padStart(2, "0");
      return `${parsed.y}-${mm}-${dd}`;
    }
  }

  return text;
}

/**
 * Splits clipboard text into pasted lines the way Excel/grid copies do
 * (tab-separated columns, newline-separated rows), keeping only the first
 * tab-cell of each line -- callers pasting into a single column only care
 * about column 1 of whatever was copied.
 */
export function parsePasteLines(text: string): string[] {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  while (lines.length > 1 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines.map((line) => line.split("\t")[0]);
}
