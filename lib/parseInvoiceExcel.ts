import * as XLSX from "xlsx";

/**
 * Parses a Consignment delivery Excel export (the format JMD/MGM branches
 * send for encoding) into ready-to-insert invoice rows.
 *
 * Real-world files (e.g. "MGM 3 - CAVITE.xlsx") accumulate one sheet per
 * batch over years -- 300+ sheets is normal -- but only the sheet that was
 * on-screen when the file was last saved holds the batch to import. Excel
 * records that as the workbook's "active tab" in its own XML, which the
 * `xlsx` library surfaces via `Workbook.WBView[0].activeTab`. We read that
 * sheet, not `SheetNames[0]`.
 *
 * Column headers vary slightly release to release (older exports use
 * "Transfer-to Code" for the account name and "BRANCH" for the store
 * address; current exports spell them out as "Transfer-to Name" /
 * "Transfer-to Address"), so headers are matched by alias list rather than
 * fixed position, and the header row itself is searched for rather than
 * assumed to be row 1.
 */

export interface ParsedInvoiceRow {
  documentNo: string;
  postingDate: string | null; // "YYYY-MM-DD"
  companyName: string;
  branchAddress: string;
  amount: number;
  remarks: string;
}

export interface ParseInvoiceExcelResult {
  sheetName: string;
  rows: ParsedInvoiceRow[];
  /** Rows under the header that were skipped for missing Document No./Amount, 1-based within the data block. */
  skippedRowNumbers: number[];
}

type FieldKey = "documentNo" | "postingDate" | "companyName" | "branchAddress" | "amount" | "remarks";

// Order matters within each list: the first alias present in the header row
// wins. "Transfer-to Name"/"Transfer-to Address" (current format) are tried
// before the older "Transfer-to Code"/"BRANCH" fallbacks.
const HEADER_ALIASES: Record<FieldKey, string[]> = {
  documentNo: ["no.", "no", "document no.", "document no", "cd #", "cd#"],
  postingDate: ["posting date"],
  companyName: ["transfer-to name", "transfer to name", "retail chain / account", "retail chain/account", "transfer-to code", "transfer to code"],
  branchAddress: ["transfer-to address", "transfer to address", "branch/store address", "branch"],
  amount: ["total amount", "amount"],
  remarks: ["remarks"],
};

const REQUIRED_FOR_HEADER_ROW: FieldKey[] = ["documentNo", "postingDate", "amount"];
const MAX_HEADER_SEARCH_ROWS = 25;

function normalizeHeader(value: unknown): string {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** Finds the header row + column index for each field within the first N rows of a sheet. */
function detectHeader(
  rawRows: unknown[][]
): { headerRowIndex: number; columnByField: Partial<Record<FieldKey, number>> } | null {
  const searchLimit = Math.min(rawRows.length, MAX_HEADER_SEARCH_ROWS);

  for (let r = 0; r < searchLimit; r += 1) {
    const row = rawRows[r] ?? [];
    const normalizedCells = row.map(normalizeHeader);
    const columnByField: Partial<Record<FieldKey, number>> = {};
    const usedColumns = new Set<number>();

    (Object.keys(HEADER_ALIASES) as FieldKey[]).forEach((field) => {
      for (const alias of HEADER_ALIASES[field]) {
        const idx = normalizedCells.findIndex((cell, i) => cell === alias && !usedColumns.has(i));
        if (idx !== -1) {
          columnByField[field] = idx;
          usedColumns.add(idx);
          break;
        }
      }
    });

    const hasAllRequired = REQUIRED_FOR_HEADER_ROW.every((field) => columnByField[field] !== undefined);
    if (hasAllRequired) {
      return { headerRowIndex: r, columnByField };
    }
  }

  return null;
}

/** Converts a variety of Excel date cell shapes into "YYYY-MM-DD", or null if unparseable. */
function parseDateCell(value: unknown): string | null {
  if (value == null || value === "") return null;

  if (value instanceof Date) {
    // Excel date-only cells decode to UTC midnight; toISOString's date part
    // is therefore the calendar date regardless of the browser's timezone.
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === "number") {
    // Excel serial date (days since 1899-12-30).
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;
    const mm = String(parsed.m).padStart(2, "0");
    const dd = String(parsed.d).padStart(2, "0");
    return `${parsed.y}-${mm}-${dd}`;
  }

  const text = String(value).trim();
  if (!text) return null;

  // Already ISO.
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);

  // "M/D/YY" or "M/D/YYYY".
  const slashMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slashMatch) {
    const [, mStr, dStr, yStr] = slashMatch;
    let year = parseInt(yStr, 10);
    if (yStr.length === 2) year += year < 70 ? 2000 : 1900;
    const mm = mStr.padStart(2, "0");
    const dd = dStr.padStart(2, "0");
    return `${year}-${mm}-${dd}`;
  }

  return null;
}

function parseAmountCell(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") return value;
  const cleaned = String(value).replace(/[^0-9.-]/g, "");
  if (!cleaned) return null;
  const num = Number(cleaned);
  return Number.isNaN(num) ? null : num;
}

/**
 * Reads the workbook's active sheet tab. The `xlsx` package's own type
 * declarations only expose `Workbook.Views`, but at runtime the parsed
 * workbook.xml view state actually comes back under `Workbook.WBView`
 * (verified against a real multi-hundred-sheet export) -- so this reads
 * defensively through an unknown-typed view rather than trusting either
 * declared shape, and falls back to the first sheet if neither is present.
 */
function getActiveSheetName(workbook: XLSX.WorkBook): string {
  const rawWorkbookProps = workbook.Workbook as unknown as
    | { WBView?: { activeTab?: number }[]; Views?: { activeTab?: number }[] }
    | undefined;
  const view = rawWorkbookProps?.WBView?.[0] ?? rawWorkbookProps?.Views?.[0];
  const activeTabIndex = view?.activeTab;

  if (typeof activeTabIndex === "number" && workbook.SheetNames[activeTabIndex]) {
    return workbook.SheetNames[activeTabIndex];
  }
  return workbook.SheetNames[0];
}

function cellToString(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim();
}

/**
 * Reads an uploaded .xlsx file's active sheet and extracts invoice rows.
 * Throws with a user-facing message if the file can't be parsed or no
 * recognizable header row is found.
 */
export async function parseInvoiceExcelFile(file: File): Promise<ParseInvoiceExcelResult> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });

  const sheetName = getActiveSheetName(workbook);

  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    throw new Error("Could not read any sheet from this file.");
  }

  const rawRows: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: true,
    defval: "",
  });

  const detected = detectHeader(rawRows);
  if (!detected) {
    throw new Error(
      'Could not find a header row with "No.", "Posting Date", and "Total Amount" columns in this sheet.'
    );
  }
  const { headerRowIndex, columnByField } = detected;

  const rows: ParsedInvoiceRow[] = [];
  const skippedRowNumbers: number[] = [];

  for (let r = headerRowIndex + 1; r < rawRows.length; r += 1) {
    const row = rawRows[r] ?? [];
    const isBlank = row.every((cell) => cellToString(cell) === "");
    if (isBlank) continue;

    const documentNo = cellToString(row[columnByField.documentNo!]);
    const amount = parseAmountCell(row[columnByField.amount!]);

    if (!documentNo || amount == null) {
      skippedRowNumbers.push(r - headerRowIndex);
      continue;
    }

    rows.push({
      documentNo,
      postingDate:
        columnByField.postingDate !== undefined ? parseDateCell(row[columnByField.postingDate]) : null,
      companyName:
        columnByField.companyName !== undefined ? cellToString(row[columnByField.companyName]) : "",
      branchAddress:
        columnByField.branchAddress !== undefined ? cellToString(row[columnByField.branchAddress]) : "",
      amount,
      remarks: columnByField.remarks !== undefined ? cellToString(row[columnByField.remarks]) : "",
    });
  }

  return { sheetName, rows, skippedRowNumbers };
}
