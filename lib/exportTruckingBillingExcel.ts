import type ExcelJSType from "exceljs";
import { createClient } from "@/lib/supabase/client";
import type { VTruckingBillingStatement, VTruckingBillingStatementItem } from "@/types/database";

function thinBorder(): Partial<ExcelJSType.Borders> {
  return {
    top: { style: "thin" },
    left: { style: "thin" },
    bottom: { style: "thin" },
    right: { style: "thin" },
  };
}

function money(value: number | null | undefined) {
  return Math.round((value ?? 0) * 100) / 100;
}

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

// "JULY 14,2026", matching the Delivery Report's "DATE:" field on JMD's own sheet.
function fmtLongDateNoSpace(value: string | null | undefined) {
  const d = toDate(value);
  if (!d) return "";
  const month = d.toLocaleDateString(undefined, { month: "long" }).toUpperCase();
  return `${month} ${d.getDate()},${d.getFullYear()}`;
}

// Sheet names are capped at 31 chars and can't contain: \ / ? * [ ] :
// Both waybill_no and series_no are now plain editable fields (see migration
// 0025), so a freshly-generated statement can have both still blank -- name
// must tolerate null/undefined, not just an empty string.
function safeSheetName(name: string | null | undefined, fallback: string) {
  const cleaned = (name ?? "").replace(/[\\/?*[\]:]/g, "").trim().slice(0, 31);
  return cleaned || fallback;
}

// When one or more convoy sub-trucks ride along on this truck's single rate,
// each of their waybill #s is joined onto the main truck's with " / "
// (e.g. "12345 / 67890 / 67891") so all show together on the one shared
// sheet. Reads every entry in `convoys` (migration 0058), not just a single
// legacy value, so a main truck with N convoy sub-trucks shows all N.
function combinedWaybill(statement: Pick<VTruckingBillingStatement, "waybill_no" | "convoys">) {
  const main = statement.waybill_no ?? "";
  const convoyNos = (statement.convoys ?? [])
    .map((c) => c.waybill_no?.trim())
    .filter((v): v is string => !!v);
  if (convoyNos.length === 0) return main;
  return [main, ...convoyNos].filter(Boolean).join(" / ");
}

// Same " / " combine as combinedWaybill, but for plate numbers -- a convoy
// route's Billing Statement/Delivery Report should show every plate # that
// actually rode, not just the main truck's.
function combinedPlateNumber(statement: Pick<VTruckingBillingStatement, "plate_number" | "convoys">) {
  const main = statement.plate_number ?? "";
  const convoyPlates = (statement.convoys ?? [])
    .map((c) => c.plate_number?.trim())
    .filter((v): v is string => !!v);
  if (convoyPlates.length === 0) return main;
  return [main, ...convoyPlates].filter(Boolean).join(" / ");
}

// Same " / " combine, for drivers -- every driver who rode the convoy, not
// just the main truck's.
function combinedDriverName(statement: Pick<VTruckingBillingStatement, "driver_name" | "convoys">) {
  const main = statement.driver_name ?? "";
  const convoyDrivers = (statement.convoys ?? [])
    .map((c) => c.driver_name?.trim())
    .filter((v): v is string => !!v);
  if (convoyDrivers.length === 0) return main;
  return [main, ...convoyDrivers].filter(Boolean).join(" / ");
}

const ACCOUNTING_FMT = '_-* #,##0.00_-;-* #,##0.00_-;_-* "-"??_-;_-@_-';

// JMD's own Billing Statement always carries these two signatures -- there's
// no per-statement UI to set them (and none is needed), so they're written
// as fixed constants on every exported statement.
const PREPARED_BY_NAME = "Algene Kianne Bueza";
const APPROVED_BY_NAME = "Mr. Roshan Mirani";

function headerCell(ws: ExcelJSType.Worksheet, addr: string, value: unknown) {
  const cell = ws.getCell(addr);
  cell.value = value as ExcelJSType.CellValue;
  cell.font = { bold: true };
  cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  cell.border = thinBorder();
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
  return cell;
}

/**
 * Builds one worksheet per billing statement, laid out to match JMD
 * Industrial Trading's own "Billing Statement" + "Delivery Report" sheet
 * format exactly (see the sample JMD BILLING workbook): the Mondial88
 * Trading Corporation letterhead, an 11-column billing summary table
 * (Transaction Date / Account / Branch Name / Delivery Date / Declared
 * Value / No. Cases / Truck Class. / Unit / Rate / Total Rental / % CTS)
 * with a bold totals row, a "DATE FORWARDED" line, then a Delivery Report
 * section (with Truck Type) listing every receipt on the truck under a
 * merged Sched/Area cell. No VAT line -- this export mirrors the vendor's
 * own paperwork exactly; the 12% VAT total only ever appears in this app's
 * own Trucking Billing monitoring tab.
 */
export async function exportTruckingBillingExcel(statementIds: string[]) {
  if (statementIds.length === 0) return;

  const supabase = createClient();
  const [{ data: statementsData }, { data: itemsData }] = await Promise.all([
    supabase.from("v_trucking_billing_statements").select("*").in("id", statementIds),
    supabase.from("v_trucking_billing_statement_items").select("*").in("statement_id", statementIds),
  ]);

  // Sheets should come out in order: by delivery date first, then by truck
  // number within that date -- same "Truck 1, 2, 3" order Route Plan derives
  // from route_plan_trucks.created_at (see RoutePlanBoard.tsx truckLabelById).
  // Supabase's .in(...) does not preserve the passed-in id order, so without
  // this the sheets came out in whatever order Postgres happened to return
  // them.
  const statements = ((statementsData ?? []) as VTruckingBillingStatement[]).sort((a, b) => {
    const dateA = a.route_date ?? "";
    const dateB = b.route_date ?? "";
    if (dateA !== dateB) return dateA.localeCompare(dateB);
    const createdA = a.truck_created_at ?? "";
    const createdB = b.truck_created_at ?? "";
    return createdA.localeCompare(createdB);
  });
  const itemsByStatement = new Map<string, VTruckingBillingStatementItem[]>();
  for (const item of (itemsData ?? []) as VTruckingBillingStatementItem[]) {
    const list = itemsByStatement.get(item.statement_id) ?? [];
    list.push(item);
    itemsByStatement.set(item.statement_id, list);
  }

  // Dynamically imported so exceljs (a sizeable dependency) is only fetched
  // when an export is actually triggered, instead of bloating the Trucking
  // Billing page's main bundle on every visit.
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Dynamic88 Mondial Portal";
  workbook.created = new Date();

  // Excel sheet names must be unique within a workbook -- two trucks sharing
  // the same waybill # (or both still blank) would otherwise crash the
  // export, so duplicates get a " (2)", " (3)", ... suffix.
  const usedSheetNames = new Set<string>();
  function uniqueSheetName(base: string) {
    if (!usedSheetNames.has(base)) {
      usedSheetNames.add(base);
      return base;
    }
    let n = 2;
    let candidate = safeSheetName(`${base} (${n})`, base);
    while (usedSheetNames.has(candidate)) {
      n += 1;
      candidate = safeSheetName(`${base} (${n})`, base);
    }
    usedSheetNames.add(candidate);
    return candidate;
  }

  statements.forEach((statement, idx) => {
    const items = itemsByStatement.get(statement.id) ?? [];
    const sheetName = uniqueSheetName(
      safeSheetName(combinedWaybill(statement) || statement.series_no, `Statement ${idx + 1}`)
    );
    const ws = workbook.addWorksheet(sheetName, {
      pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1 },
    });

    ws.columns = [
      { width: 14 }, // A - Transaction Date / Sched-Area
      { width: 30 }, // B - Account / Inv-DR-CN
      { width: 16 }, // C - Branch Name (own col in billing row; merged w/ B in item row)
      { width: 12 }, // D - Delivery Date / Account Name
      { width: 14 }, // E - Declared Value / Account Name (cont.)
      { width: 10 }, // F - No. Cases / Account Name (cont.)
      { width: 10 }, // G - Truck Class. / Branch
      { width: 10 }, // H - Unit / Branch (cont.)
      { width: 14 }, // I - Rate / Branch (cont.)
      { width: 14 }, // J - Total Rental / Boxes
      { width: 12 }, // K - % CTS / Price
    ];

    let r = 1;

    // ── Letterhead ───────────────────────────────────────────────────
    ws.mergeCells(`A${r}:K${r}`);
    ws.getCell(`A${r}`).value = "MONDIAL88 TRADING CORPORATION";
    ws.getCell(`A${r}`).font = { bold: true, size: 14 };
    ws.getCell(`A${r}`).alignment = { horizontal: "center" };
    r += 1;
    ws.mergeCells(`A${r}:K${r}`);
    ws.getCell(`A${r}`).value = "MIRAX BUILDING";
    ws.getCell(`A${r}`).alignment = { horizontal: "center" };
    r += 1;
    ws.mergeCells(`A${r}:K${r}`);
    ws.getCell(`A${r}`).value = "Unit A Ground Floor, 2270 Don Chino Roces Avenue, Makati City, Philippines";
    ws.getCell(`A${r}`).alignment = { horizontal: "center" };
    r += 1;
    ws.mergeCells(`A${r}:K${r}`);
    ws.getCell(`A${r}`).value = "Tel. No.: 840-3374-75   |   Telefax No.: 840-3390";
    ws.getCell(`A${r}`).alignment = { horizontal: "center" };
    r += 2;

    // "Date:" header field / "DATE FORWARDED" line -- when the statement
    // was forwarded for billing. Falls back to today while still unbilled.
    const forwardedDate = toDate(statement.billed_at) ?? new Date();
    // "DELIVERY DATE" on the billing summary row / the Delivery Report's
    // own "DATE:" field -- the actual route/delivery date.
    const deliveryDate = toDate(statement.route_date);

    // ── Title + date ─────────────────────────────────────────────────
    ws.mergeCells(`A${r}:G${r}`);
    ws.getCell(`A${r}`).value = "BILLING STATEMENT";
    ws.getCell(`A${r}`).font = { bold: true, size: 12 };
    ws.getCell(`A${r}`).alignment = { horizontal: "center" };
    ws.getCell(`H${r}`).value = "Date:";
    ws.getCell(`H${r}`).font = { bold: true };
    ws.getCell(`H${r}`).alignment = { horizontal: "right" };
    ws.mergeCells(`I${r}:K${r}`);
    ws.getCell(`I${r}`).value = forwardedDate;
    ws.getCell(`I${r}`).numFmt = "mm-dd-yy";
    r += 1;

    // ── Series / Trucker / Waybill / Plate ──────────────────────────
    ws.getCell(`A${r}`).value = "SERIES NO#:";
    ws.getCell(`A${r}`).font = { bold: true };
    ws.mergeCells(`B${r}:D${r}`);
    ws.getCell(`B${r}`).value = statement.series_no;
    ws.getCell(`F${r}`).value = "TRUCKER:";
    ws.getCell(`F${r}`).font = { bold: true };
    ws.mergeCells(`G${r}:K${r}`);
    ws.getCell(`G${r}`).value = statement.carrier ?? "";
    r += 1;

    ws.getCell(`A${r}`).value = "WAYBILL No#:";
    ws.getCell(`A${r}`).font = { bold: true };
    ws.mergeCells(`B${r}:D${r}`);
    ws.getCell(`B${r}`).value = combinedWaybill(statement);
    ws.getCell(`F${r}`).value = "PLATE#:";
    ws.getCell(`F${r}`).font = { bold: true };
    ws.mergeCells(`G${r}:K${r}`);
    ws.getCell(`G${r}`).value = combinedPlateNumber(statement);
    r += 2;

    // ── Billing summary table (11 columns) ──────────────────────────
    const billingHeaderRow = r;
    const billingHeaders = [
      "TRANSACTION\nDATE",
      "ACCOUNT",
      "BRANCH\nNAME",
      "DELIVERY\nDATE",
      "DECLARED\nVALUE",
      "No#\nCASES",
      "TRUCK\nCLASS.",
      "UNIT",
      "RATE",
      "TOTAL\nRENTAL",
      "% CTS",
    ];
    billingHeaders.forEach((h, i) => {
      headerCell(ws, `${String.fromCharCode(65 + i)}${billingHeaderRow}`, h);
    });
    r += 1;

    // Backloaded items (is_backload, migration 0059) are kept in `items` so
    // the original truck's own sheet still lists/tags them, but they never
    // actually rode this truck, so they're excluded from its declared-value
    // total and % CTS -- same exclusion as the print pages.
    const totalDeclaredValue = items
      .filter((x) => !x.is_backload)
      .reduce((sum, x) => sum + (x.declared_value ?? 0), 0);
    // Override-aware -- matches the merged Boxes total shown on the Delivery
    // Report print page (statement.total_boxes = coalesce(total_boxes_override,
    // live-computed sum)), so a manual edit there is reflected here too.
    const totalBoxes = statement.total_boxes;
    const accountsLabel = Array.from(
      new Set(items.map((x) => x.company_name_raw).filter(Boolean))
    ).join(", ");
    // Raw fraction (not multiplied by 100) so the "0.00%" number format
    // renders it the same way JMD's own sheet does.
    const ctsFraction =
      statement.truck_rate != null && totalDeclaredValue > 0
        ? statement.truck_rate / totalDeclaredValue
        : null;

    const dataRow = ws.getRow(r);
    dataRow.getCell(1).value = forwardedDate;
    dataRow.getCell(1).numFmt = "mm-dd-yy";
    dataRow.getCell(2).value = accountsLabel;
    dataRow.getCell(3).value = statement.area ?? "";
    if (deliveryDate) {
      dataRow.getCell(4).value = deliveryDate;
      dataRow.getCell(4).numFmt = "mm-dd-yy";
    }
    dataRow.getCell(5).value = money(totalDeclaredValue);
    dataRow.getCell(5).numFmt = ACCOUNTING_FMT;
    dataRow.getCell(6).value = totalBoxes || "";
    dataRow.getCell(6).numFmt = "#,##0";
    dataRow.getCell(7).value = statement.truck_type ?? "";
    dataRow.getCell(8).value = 1;
    dataRow.getCell(8).numFmt = "#,##0";
    dataRow.getCell(9).value = statement.truck_rate != null ? money(statement.truck_rate) : "";
    dataRow.getCell(9).numFmt = "#,##0.00";
    dataRow.getCell(10).value = statement.truck_rate != null ? money(statement.truck_rate) : "";
    dataRow.getCell(10).numFmt = "#,##0.00";
    if (ctsFraction != null) {
      dataRow.getCell(11).value = ctsFraction;
      dataRow.getCell(11).numFmt = "0.00%";
    }
    dataRow.eachCell({ includeEmpty: true }, (cell, col) => {
      if (col > 11) return;
      cell.border = thinBorder();
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    });
    dataRow.getCell(2).alignment = { horizontal: "left", vertical: "middle", wrapText: true };
    r += 1;

    // ── Totals row (bold) ────────────────────────────────────────────
    const totalsRow = ws.getRow(r);
    totalsRow.getCell(5).value = money(totalDeclaredValue);
    totalsRow.getCell(5).numFmt = ACCOUNTING_FMT;
    totalsRow.getCell(9).value = statement.truck_rate != null ? money(statement.truck_rate) : "";
    totalsRow.getCell(9).numFmt = "#,##0.00";
    totalsRow.getCell(10).value = statement.truck_rate != null ? money(statement.truck_rate) : "";
    totalsRow.getCell(10).numFmt = "#,##0.00";
    if (ctsFraction != null) {
      totalsRow.getCell(11).value = ctsFraction;
      totalsRow.getCell(11).numFmt = "0.00%";
    }
    [5, 9, 10, 11].forEach((col) => {
      const cell = totalsRow.getCell(col);
      cell.font = { bold: true };
      cell.border = thinBorder();
      cell.alignment = { horizontal: "right", vertical: "middle" };
    });
    r += 2;

    // ── Date Forwarded ───────────────────────────────────────────────
    ws.getCell(`A${r}`).value = `DATE FORWARDED : ${
      forwardedDate
        ? `${String(forwardedDate.getMonth() + 1).padStart(2, "0")}/${String(
            forwardedDate.getDate()
          ).padStart(2, "0")}/${forwardedDate.getFullYear()}`
        : ""
    }`;
    ws.getCell(`A${r}`).font = { bold: true };
    r += 2;

    // ── Delivery Report ──────────────────────────────────────────────
    ws.mergeCells(`A${r}:K${r}`);
    ws.getCell(`A${r}`).value = "DELIVERY REPORT";
    ws.getCell(`A${r}`).font = { bold: true, size: 12 };
    ws.getCell(`A${r}`).alignment = { horizontal: "center" };
    r += 1;

    ws.getCell(`A${r}`).value = "WAYBILL NO.:";
    ws.getCell(`A${r}`).font = { bold: true };
    ws.getCell(`B${r}`).value = combinedWaybill(statement);
    ws.getCell(`C${r}`).value = "PLATE NO.:";
    ws.getCell(`C${r}`).font = { bold: true };
    ws.getCell(`D${r}`).value = combinedPlateNumber(statement);
    ws.getCell(`E${r}`).value = "DRIVER'S NAME:";
    ws.getCell(`E${r}`).font = { bold: true };
    ws.mergeCells(`F${r}:H${r}`);
    ws.getCell(`F${r}`).value = combinedDriverName(statement);
    ws.getCell(`I${r}`).value = "DATE:";
    ws.getCell(`I${r}`).font = { bold: true };
    ws.mergeCells(`J${r}:K${r}`);
    ws.getCell(`J${r}`).value = fmtLongDateNoSpace(statement.route_date);
    r += 1;

    ws.getCell(`A${r}`).value = "TRUCK TYPE:";
    ws.getCell(`A${r}`).font = { bold: true };
    ws.getCell(`B${r}`).value = statement.truck_type ?? "";
    r += 2;

    const drHeaderRow = r;
    headerCell(ws, `A${drHeaderRow}`, "SCHED / AREA");
    ws.mergeCells(`B${drHeaderRow}:C${drHeaderRow}`);
    headerCell(ws, `B${drHeaderRow}`, "INV. / DR / CN");
    ws.mergeCells(`D${drHeaderRow}:F${drHeaderRow}`);
    headerCell(ws, `D${drHeaderRow}`, "ACCOUNT NAME");
    ws.mergeCells(`G${drHeaderRow}:I${drHeaderRow}`);
    headerCell(ws, `G${drHeaderRow}`, "BRANCH");
    headerCell(ws, `J${drHeaderRow}`, "BOXES");
    headerCell(ws, `K${drHeaderRow}`, "PRICE");
    r += 1;

    const firstItemRow = r;
    items.forEach((item) => {
      ws.mergeCells(`B${r}:C${r}`);
      const tag = item.is_backload ? " (BACKLOAD)" : item.is_redeliver ? " (REDELIVER)" : "";
      ws.getCell(`B${r}`).value = `${item.document_no}${tag}`;
      if (tag) {
        ws.getCell(`B${r}`).font = { bold: true, color: { argb: item.is_backload ? "FFDC2626" : "FF2563EB" } };
      }
      ws.mergeCells(`D${r}:F${r}`);
      ws.getCell(`D${r}`).value = item.company_name_raw ?? "";
      ws.mergeCells(`G${r}:I${r}`);
      ws.getCell(`G${r}`).value = item.branch_address ?? "";
      ws.getCell(`K${r}`).value = money(item.declared_value);
      ws.getCell(`K${r}`).numFmt = "#,##0.00";
      ["A", "B", "D", "G", "J", "K"].forEach((col) => {
        ws.getCell(`${col}${r}`).border = thinBorder();
        ws.getCell(`${col}${r}`).alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      });
      ws.getCell(`D${r}`).alignment = { horizontal: "left", vertical: "middle", wrapText: true };
      ws.getCell(`G${r}`).alignment = { horizontal: "left", vertical: "middle", wrapText: true };
      r += 1;
    });
    const lastItemRow = r - 1;
    // "SCHED / AREA" is a single merged cell spanning every item row --
    // one area value applies to the whole truck, not per receipt. "BOXES" is
    // merged the same way, showing the one override-aware total (matching
    // the print page's rowSpan) instead of a qty_box figure per receipt.
    if (items.length > 0) {
      ws.mergeCells(`A${firstItemRow}:A${lastItemRow}`);
      ws.getCell(`A${firstItemRow}`).value = statement.area ?? "";
      ws.getCell(`A${firstItemRow}`).alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      ws.getCell(`A${firstItemRow}`).border = thinBorder();

      ws.mergeCells(`J${firstItemRow}:J${lastItemRow}`);
      ws.getCell(`J${firstItemRow}`).value = statement.total_boxes || "";
      ws.getCell(`J${firstItemRow}`).numFmt = "#,##0";
      ws.getCell(`J${firstItemRow}`).alignment = { horizontal: "center", vertical: "middle" };
      ws.getCell(`J${firstItemRow}`).border = thinBorder();
    }

    // ── Grand total ──────────────────────────────────────────────────
    ws.mergeCells(`A${r}:J${r}`);
    ws.getCell(`A${r}`).alignment = { horizontal: "right" };
    ws.getCell(`A${r}`).font = { bold: true };
    ws.getCell(`K${r}`).value = money(totalDeclaredValue);
    ws.getCell(`K${r}`).numFmt = "#,##0.00";
    ws.getCell(`K${r}`).font = { bold: true };
    r += 3;

    // ── Signatures ───────────────────────────────────────────────────
    ws.getCell(`A${r}`).value = "Prepared By:";
    ws.getCell(`A${r}`).font = { bold: true };
    ws.mergeCells(`B${r}:E${r}`);
    ws.getCell(`B${r}`).value = "_________________________________";
    ws.getCell(`B${r}`).alignment = { horizontal: "center" };
    ws.getCell(`G${r}`).value = "Approved By:";
    ws.getCell(`G${r}`).font = { bold: true };
    ws.mergeCells(`H${r}:K${r}`);
    ws.getCell(`H${r}`).value = "_________________________________";
    ws.getCell(`H${r}`).alignment = { horizontal: "center" };
    r += 1;

    ws.mergeCells(`B${r}:E${r}`);
    ws.getCell(`B${r}`).value = PREPARED_BY_NAME;
    ws.getCell(`B${r}`).alignment = { horizontal: "center" };
    ws.mergeCells(`H${r}:K${r}`);
    ws.getCell(`H${r}`).value = APPROVED_BY_NAME;
    ws.getCell(`H${r}`).alignment = { horizontal: "center" };
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Trucking Billing ${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
