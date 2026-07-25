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
