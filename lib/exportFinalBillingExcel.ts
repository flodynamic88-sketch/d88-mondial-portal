import type ExcelJSType from "exceljs";

// Mirrors formatMoney() in app/(app)/final-billing/page.tsx so the Excel
// export reads identically to the on-screen amounts.
function money(value: number) {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function thinBorder(): Partial<ExcelJSType.Borders> {
  return {
    top: { style: "thin" },
    left: { style: "thin" },
    bottom: { style: "thin" },
    right: { style: "thin" },
  };
}

export interface FeeSummaryGroupRow {
  label: string;
  totalAmount: number;
  ratePct: number | null;
  totalFee: number;
}

export interface FeeSummaryCategory {
  label: string;
  isMercury: boolean;
  groups: FeeSummaryGroupRow[];
  subtotalAmount: number;
  subtotalFee: number;
}

export interface DetailSection {
  label: string;
  columnHeaders: string[];
  amountColIndex: number;
  rows: string[][];
  subtotalAmount: number;
}

export interface FinalBillingExportParams {
  startDate: string;
  endDate: string;
  feeCategories: FeeSummaryCategory[];
  grandTotalFee: number;
  grandTotalAmount: number;
  detailSections: DetailSection[];
}

const SLATE_800 = "FF1E293B";
const SLATE_900 = "FF0F172A";
const AMBER_500 = "FFF59E0B";
const AMBER_300_TEXT = "FFFCD34D";
const GRAY_100 = "FFF3F4F6";

function fillRow(
  ws: ExcelJSType.Worksheet,
  row: number,
  fromCol: number,
  toCol: number,
  argb: string,
  fontArgb?: string
) {
  for (let c = fromCol; c <= toCol; c++) {
    const cell = ws.getCell(row, c);
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
    if (fontArgb) {
      cell.font = { ...(cell.font ?? {}), color: { argb: fontArgb } };
    }
  }
}

function headerRowCells(ws: ExcelJSType.Worksheet, row: number, colCount: number) {
  for (let c = 1; c <= colCount; c++) {
    const cell = ws.getCell(row, c);
    cell.font = { bold: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GRAY_100 } };
    cell.border = thinBorder();
    cell.alignment = { vertical: "middle", wrapText: true };
  }
}

/**
 * Builds a single worksheet that mirrors the Final Billing page exactly:
 * the Fulfillment Fee Summary (with per-zone/DC groups, subtotal per
 * category, and grand totals) followed by each category's invoice
 * breakdown table -- same content and same order as what's on screen,
 * just in one sheet instead of one-sheet-per-category with no summary.
 */
export async function exportFinalBillingExcel(params: FinalBillingExportParams) {
  const { startDate, endDate, feeCategories, grandTotalFee, grandTotalAmount, detailSections } =
    params;

  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Dynamic88 Mondial Portal";
  workbook.created = new Date();

  const maxCols = Math.max(5, ...detailSections.map((s) => s.columnHeaders.length), 1);
  const ws = workbook.addWorksheet("Final Billing", {
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1 },
  });
  ws.columns = Array.from({ length: maxCols }, () => ({ width: 18 }));

  let r = 1;

  // ── Letterhead ───────────────────────────────────────────────────────
  ws.mergeCells(r, 1, r, maxCols);
  ws.getCell(r, 1).value = "MONDIAL88 TRADING CORPORATION";
  ws.getCell(r, 1).font = { bold: true, size: 14 };
  ws.getCell(r, 1).alignment = { horizontal: "center" };
  r += 1;

  ws.mergeCells(r, 1, r, maxCols);
  ws.getCell(r, 1).value = "BILLING STATEMENT";
  ws.getCell(r, 1).font = { bold: true, size: 12 };
  ws.getCell(r, 1).alignment = { horizontal: "center" };
  r += 1;

  ws.mergeCells(r, 1, r, maxCols);
  ws.getCell(r, 1).value = `Delivery Period: ${startDate} to ${endDate}`;
  ws.getCell(r, 1).alignment = { horizontal: "center" };
  r += 2;

  // ── Fulfillment Fee Summary ──────────────────────────────────────────
  ws.mergeCells(r, 1, r, 5);
  ws.getCell(r, 1).value = "Fulfillment Fee Summary";
  ws.getCell(r, 1).font = { bold: true, size: 12 };
  r += 1;

  const feeHeaderRow = r;
  ["Category", "Indicator", "Total Invoice Amt", "Rate", "Fulfillment Fee"].forEach((h, i) => {
    ws.getCell(feeHeaderRow, i + 1).value = h;
  });
  headerRowCells(ws, feeHeaderRow, 5);
  r += 1;

  feeCategories.forEach((cat) => {
    const catStartRow = r;
    cat.groups.forEach((g, idx) => {
      const row = r;
      if (idx === 0) {
        ws.getCell(row, 1).value = cat.label;
      }
      ws.getCell(row, 2).value = g.label;
      ws.getCell(row, 3).value = money(g.totalAmount);
      ws.getCell(row, 4).value = g.ratePct != null ? `${g.ratePct.toFixed(2)}%` : "—";
      ws.getCell(row, 5).value = money(g.totalFee);
      for (let c = 1; c <= 5; c++) {
        ws.getCell(row, c).border = thinBorder();
        ws.getCell(row, c).alignment = { vertical: "middle", wrapText: true };
      }
      ws.getCell(row, 3).alignment = { horizontal: "right", vertical: "middle" };
      ws.getCell(row, 5).alignment = { horizontal: "right", vertical: "middle" };
      r += 1;
    });
    if (cat.groups.length > 1) {
      ws.mergeCells(catStartRow, 1, r - 1, 1);
    }
    const catFill = cat.isMercury ? AMBER_500 : SLATE_800;
    fillRow(ws, catStartRow, 1, 1, catFill, "FFFFFFFF");
    ws.getCell(catStartRow, 1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    ws.getCell(catStartRow, 1).alignment = { vertical: "top", wrapText: true };

    // Subtotal row for this category.
    const subRow = r;
    ws.mergeCells(subRow, 1, subRow, 2);
    ws.getCell(subRow, 1).value = `Subtotal — ${cat.label}`;
    ws.getCell(subRow, 3).value = money(cat.subtotalAmount);
    ws.getCell(subRow, 5).value = money(cat.subtotalFee);
    fillRow(ws, subRow, 1, 5, cat.isMercury ? AMBER_500 : SLATE_800, "FFFFFFFF");
    for (let c = 1; c <= 5; c++) {
      ws.getCell(subRow, c).font = { bold: true, color: { argb: "FFFFFFFF" } };
    }
    ws.getCell(subRow, 3).alignment = { horizontal: "right" };
    ws.getCell(subRow, 5).alignment = { horizontal: "right" };
    r += 1;
  });

  const grandFeeRow = r;
  ws.mergeCells(grandFeeRow, 1, grandFeeRow, 4);
  ws.getCell(grandFeeRow, 1).value = "Grand Total Fulfillment Fee";
  ws.getCell(grandFeeRow, 5).value = money(grandTotalFee);
  fillRow(ws, grandFeeRow, 1, 5, SLATE_900, AMBER_300_TEXT);
  for (let c = 1; c <= 5; c++) {
    ws.getCell(grandFeeRow, c).font = { bold: true, size: 12, color: { argb: AMBER_300_TEXT } };
  }
  ws.getCell(grandFeeRow, 5).alignment = { horizontal: "right" };
  r += 1;

  const totalInvoiceRow = r;
  ws.mergeCells(totalInvoiceRow, 1, totalInvoiceRow, 4);
  ws.getCell(totalInvoiceRow, 1).value = "Total Invoice Amount (Billing Period)";
  ws.getCell(totalInvoiceRow, 5).value = money(grandTotalAmount);
  fillRow(ws, totalInvoiceRow, 1, 5, GRAY_100);
  for (let c = 1; c <= 5; c++) {
    ws.getCell(totalInvoiceRow, c).font = { bold: true };
  }
  ws.getCell(totalInvoiceRow, 5).alignment = { horizontal: "right" };
  r += 3;

  // ── Per-category invoice breakdown ───────────────────────────────────
  detailSections.forEach((section) => {
    const colCount = section.columnHeaders.length;

    ws.mergeCells(r, 1, r, colCount);
    ws.getCell(r, 1).value = section.label;
    ws.getCell(r, 1).font = { bold: true, size: 12 };
    r += 1;

    const headerRow = r;
    section.columnHeaders.forEach((h, i) => {
      ws.getCell(headerRow, i + 1).value = h;
    });
    headerRowCells(ws, headerRow, colCount);
    r += 1;

    section.rows.forEach((cells) => {
      cells.forEach((val, i) => {
        const cell = ws.getCell(r, i + 1);
        cell.value = val;
        cell.border = thinBorder();
        cell.alignment = { vertical: "middle", wrapText: true };
        if (i === 0) cell.font = { bold: true };
        if (i === section.amountColIndex) cell.alignment = { horizontal: "right", vertical: "middle" };
      });
      r += 1;
    });

    const subRow = r;
    ws.mergeCells(subRow, 1, subRow, section.amountColIndex);
    ws.getCell(subRow, 1).value = `Subtotal — ${section.label}`;
    ws.getCell(subRow, section.amountColIndex + 1).value = money(section.subtotalAmount);
    for (let c = 1; c <= colCount; c++) {
      ws.getCell(subRow, c).font = { bold: true };
      ws.getCell(subRow, c).border = { top: { style: "double" } };
    }
    ws.getCell(subRow, section.amountColIndex + 1).alignment = { horizontal: "right" };
    r += 2;
  });

  // ── Grand total ──────────────────────────────────────────────────────
  ws.mergeCells(r, 1, r, maxCols);
  ws.getCell(r, 1).value = `Grand Total Amount: ${money(grandTotalAmount)}`;
  ws.getCell(r, 1).font = { bold: true, size: 13 };
  ws.getCell(r, 1).alignment = { horizontal: "right" };

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `final-billing-${startDate}_to_${endDate}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
