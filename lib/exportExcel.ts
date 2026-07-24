import * as XLSX from "xlsx";

export interface ExportSheet {
  name: string;
  rows: Record<string, unknown>[];
}

/**
 * Builds an .xlsx workbook (one sheet per entry in `sheets`) and triggers a
 * browser download. Runs entirely client-side — no data leaves the browser.
 */
export function exportToExcel(filename: string, sheets: ExportSheet[]) {
  const wb = XLSX.utils.book_new();

  sheets.forEach(({ name, rows }) => {
    const ws = XLSX.utils.json_to_sheet(rows.length > 0 ? rows : [{}]);
    // Sheet names are capped at 31 chars and can't contain: \ / ? * [ ]
    const safeName = name.replace(/[\\/?*[\]]/g, "").slice(0, 31) || "Sheet1";
    XLSX.utils.book_append_sheet(wb, ws, safeName);
  });

  const safeFilename = filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`;
  XLSX.writeFile(wb, safeFilename);
}
