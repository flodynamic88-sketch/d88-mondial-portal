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

function fmtDate(value: string | null | undefined) {
  return value ? new Date(value).toLocaleDateString() : "";
}

// Sheet names are capped at 31 chars and can't contain: \ / ? * [ ] :
function safeSheetName(name: string, fallback: string) {
  const cleaned = name.replace(/[\\/?*[\]:]/g, "").slice(0, 31);
  return cleaned || fallback;
}

/**
 * Builds one worksheet per billing statement, laid out to match JMD
 * Industrial Trading's own "Billing Statement" + "Delivery Report" sheet
 * format (see the sample JMD BILLING workbook) -- header block, a one-line
 * billing summary row (Transaction Date / Account / Declared Value / No.
 * Cases / Unit / Rate / Total Rental / % CTS), then a Delivery Report
 * section listing every receipt on the truck. No VAT line -- this export
 * mirrors the vendor's own paperwork exactly; the 12% VAT total only ever
 * appears in this app's own Trucking Billing monitoring tab.
 */
export async function exportTruckingBillingExcel(statementIds: string[]) {
  if (statementIds.length === 0) return;

  const supabase = createClient();
  const [{ data: statementsData }, { data: itemsData }] = await Promise.all([
    supabase.from("v_trucking_billing_statements").select("*").in("id", statementIds),
    supabase.from("v_trucking_billing_statement_items").select("*").in("statement_id", statementIds),
  ]);

  const statements = (statementsData ?? []) as VTruckingBillingStatement[];
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

  statements.forEach((statement, idx) => {
    const items = itemsByStatement.get(statement.id) ?? [];
    const sheetName = safeSheetName(
      statement.waybill_no || statement.series_no,
      `Statement ${idx + 1}`
    );
    const ws = workbook.addWorksheet(sheetName, {
      pageSetup: { orientation: "portrait", fitToPage: true, fitToWidth: 1 },
    });

    ws.columns = [
      { width: 16 }, // A
      { width: 22 }, // B
      { width: 22 }, // C
      { width: 16 }, // D
      { width: 14 }, // E
      { width: 12 }, // F
      { width: 14 }, // G
    ];

    // ── Company header ──────────────────────────────────────────────
    ws.mergeCells("A1:G1");
    ws.getCell("A1").value = "Dynamic88 Solutions";
    ws.getCell("A1").font = { bold: true, size: 14 };
    ws.mergeCells("A2:G2");
    ws.getCell("A2").value = "Mondial Portal — Trucking Billing Statement";
    ws.getCell("A2").font = { size: 10, color: { argb: "FF666666" } };

    // ── Title + date ────────────────────────────────────────────────
    ws.mergeCells("A4:G4");
    ws.getCell("A4").value = "BILLING STATEMENT";
    ws.getCell("A4").font = { bold: true, size: 12 };
    ws.getCell("A4").alignment = { horizontal: "center" };

    ws.getCell("A5").value = "Date:";
    ws.getCell("A5").font = { bold: true };
    ws.getCell("B5").value = fmtDate(statement.route_date);

    // ── Series / Trucker / Waybill / Plate ─────────────────────────
    ws.getCell("A6").value = "Series No.:";
    ws.getCell("A6").font = { bold: true };
    ws.getCell("B6").value = statement.series_no;
    ws.getCell("D6").value = "Trucker:";
    ws.getCell("D6").font = { bold: true };
    ws.getCell("E6").value = statement.carrier ?? "";

    ws.getCell("A7").value = "Waybill No.:";
    ws.getCell("A7").font = { bold: true };
    ws.getCell("B7").value = statement.waybill_no ?? "";
    ws.getCell("D7").value = "Plate No.:";
    ws.getCell("D7").font = { bold: true };
    ws.getCell("E7").value = statement.plate_number ?? "";

    // ── Billing summary table ───────────────────────────────────────
    const billingHeaderRow = 9;
    const billingHeaders = [
      "Transaction Date",
      "Account",
      "Declared Value",
      "No. Cases",
      "Unit",
      "Rate",
      "Total Rental",
      "% CTS",
    ];
    ws.getRow(billingHeaderRow).values = billingHeaders;
    ws.getRow(billingHeaderRow).font = { bold: true };
    ws.getRow(billingHeaderRow).eachCell((cell) => {
      cell.border = thinBorder();
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
    });

    const totalDeclaredValue = items.reduce((sum, r) => sum + (r.declared_value ?? 0), 0);
    const totalBoxes = items.reduce((sum, r) => sum + (r.qty_box ?? 0), 0);
    const ctsPct =
      statement.truck_rate != null && totalDeclaredValue > 0
        ? Math.round((100 * statement.truck_rate / totalDeclaredValue) * 100) / 100
        : "";

    const billingDataRow = ws.getRow(billingHeaderRow + 1);
    billingDataRow.values = [
      fmtDate(statement.route_date),
      Array.from(new Set(items.map((r) => r.company_name_raw).filter(Boolean))).join(", "),
      money(totalDeclaredValue),
      totalBoxes || "",
      statement.plate_number ?? "",
      statement.truck_rate != null ? money(statement.truck_rate) : "",
      statement.truck_rate != null ? money(statement.truck_rate) : "",
      ctsPct,
    ];
    billingDataRow.eachCell((cell) => {
      cell.border = thinBorder();
    });
    billingDataRow.getCell(3).numFmt = "#,##0.00";
    billingDataRow.getCell(6).numFmt = "#,##0.00";
    billingDataRow.getCell(7).numFmt = "#,##0.00";

    // ── Delivery Report ──────────────────────────────────────────────
    let r = billingHeaderRow + 4;
    ws.mergeCells(`A${r}:G${r}`);
    ws.getCell(`A${r}`).value = "DELIVERY REPORT";
    ws.getCell(`A${r}`).font = { bold: true, size: 12 };
    r += 1;

    ws.getCell(`A${r}`).value = "Waybill No.:";
    ws.getCell(`A${r}`).font = { bold: true };
    ws.getCell(`B${r}`).value = statement.waybill_no ?? "";
    ws.getCell(`D${r}`).value = "Plate No.:";
    ws.getCell(`D${r}`).font = { bold: true };
    ws.getCell(`E${r}`).value = statement.plate_number ?? "";
    r += 1;

    ws.getCell(`A${r}`).value = "Driver's Name:";
    ws.getCell(`A${r}`).font = { bold: true };
    ws.getCell(`B${r}`).value = statement.driver_name ?? "";
    ws.getCell(`D${r}`).value = "Date:";
    ws.getCell(`D${r}`).font = { bold: true };
    ws.getCell(`E${r}`).value = fmtDate(statement.route_date);
    r += 2;

    const drHeaderRow = r;
    const drHeaders = ["Inv./DR/CN", "Account Name", "Branch", "", "Boxes", "Price"];
    ws.getRow(drHeaderRow).values = drHeaders;
    ws.getRow(drHeaderRow).font = { bold: true };
    ws.getRow(drHeaderRow).eachCell((cell) => {
      if (!cell.value && cell.value !== 0) return;
      cell.border = thinBorder();
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
    });
    r += 1;

    items.forEach((item) => {
      const row = ws.getRow(r);
      row.values = [
        item.document_no,
        item.company_name_raw ?? "",
        item.branch_address ?? "",
        "",
        item.qty_box ?? "",
        money(item.declared_value),
      ];
      row.getCell(6).numFmt = "#,##0.00";
      [1, 2, 3, 5, 6].forEach((col) => {
        row.getCell(col).border = thinBorder();
      });
      r += 1;
    });

    const totalRow = ws.getRow(r);
    totalRow.getCell(2).value = "Total";
    totalRow.getCell(2).font = { bold: true };
    totalRow.getCell(5).value = totalBoxes || "";
    totalRow.getCell(6).value = money(totalDeclaredValue);
    totalRow.getCell(6).numFmt = "#,##0.00";
    [2, 5, 6].forEach((col) => {
      totalRow.getCell(col).border = thinBorder();
      totalRow.getCell(col).font = { bold: true };
    });
    r += 3;

    ws.getCell(`A${r}`).value = statement.prepared_by || "";
    ws.getCell(`A${r + 1}`).value = "Prepared By";
    ws.getCell(`A${r + 1}`).font = { italic: true, size: 9, color: { argb: "FF888888" } };
    ws.getCell(`D${r}`).value = statement.approved_by || "";
    ws.getCell(`D${r + 1}`).value = "Approved By";
    ws.getCell(`D${r + 1}`).font = { italic: true, size: 9, color: { argb: "FF888888" } };
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
