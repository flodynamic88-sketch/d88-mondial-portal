"use client";

import { useParams } from "next/navigation";
import {
  APPROVED_BY_NAME,
  PREPARED_BY_NAME,
  combinedDriverName,
  combinedPlateNumber,
  combinedWaybill,
  formatLongDateNoSpace,
  formatMoney,
  useTruckingBillingPrintData,
} from "@/lib/truckingBillingPrint";

export default function PrintDeliveryReportPage() {
  const params = useParams();
  const id = typeof params?.id === "string" ? params.id : "";

  const {
    statement,
    items,
    loading,
    errorMsg,
    totalBoxes,
    totalDeclaredValue,
    deliveryDate,
    updateTotalBoxesOverride,
  } = useTruckingBillingPrintData(id);

  if (loading) {
    return <p className="p-8 text-sm text-gray-400">Loading…</p>;
  }
  if (errorMsg || !statement) {
    return <p className="p-8 text-sm text-red-600">{errorMsg ?? "Billing statement not found."}</p>;
  }

  return (
    <div>
      <div className="no-print mb-4 flex items-center justify-end gap-4">
        <label className="flex items-center gap-2 text-sm text-gray-600">
          Boxes total (editable):
          <input
            type="number"
            className="input w-24"
            defaultValue={statement.total_boxes_override ?? totalBoxes}
            onBlur={(e) => {
              const raw = e.target.value.trim();
              updateTotalBoxesOverride(raw === "" ? null : Number(raw));
            }}
          />
        </label>
        <button type="button" className="btn-primary" onClick={() => window.print()}>
          Print / Save as PDF
        </button>
      </div>

      <div className="printable-area mx-auto max-w-5xl rounded-xl border border-gray-200 bg-white p-8 text-sm text-gray-800">
        <div className="border-b-2 border-gray-800 pb-3 text-center">
          <p className="text-lg font-bold uppercase tracking-tight text-gray-900">
            Mondial88 Trading Corporation
          </p>
          <p className="text-xs text-gray-600">Mirax Building</p>
          <p className="text-xs text-gray-600">
            Unit A Ground Floor, 2270 Don Chino Roces Avenue, Makati City, Philippines
          </p>
          <p className="text-xs text-gray-600">Tel. No.: 840-3374-75 | Telefax No.: 840-3390</p>
        </div>

        <p className="mt-4 text-center text-base font-bold uppercase tracking-wide text-gray-900">
          Delivery Report
        </p>
        <div className="mt-3 grid grid-cols-2 gap-x-8 gap-y-1 text-sm sm:grid-cols-4">
          <p>
            <span className="font-bold">Waybill No.:</span> {combinedWaybill(statement)}
          </p>
          <p>
            <span className="font-bold">Plate No.:</span> {combinedPlateNumber(statement)}
          </p>
          <p>
            <span className="font-bold">Driver&apos;s Name:</span> {combinedDriverName(statement)}
          </p>
          <p>
            <span className="font-bold">Date:</span> {formatLongDateNoSpace(deliveryDate)}
          </p>
        </div>
        <p className="mt-1 text-sm">
          <span className="font-bold">Truck Type:</span> {statement.truck_type ?? "—"}
        </p>

        <div className="mt-3">
          {/* No rowSpan-merged cells here on purpose: a <td rowSpan> that
             stretches across every item row can't be split by the browser's
             print engine, so the whole table gets pinned to one page and
             the print dialog's "shrink to fit" squeezes everything down to
             fit, which is why long trucks used to come out unreadably tiny.
             Repeating the Area value per row and showing each item's own
             box count instead lets the table flow and page-break normally
             across as many pages as it needs (thead repeats via the shared
             print CSS's `display: table-header-group`), and the true totals
             still show once, clearly, in the footer row below. */}
          <table className="w-full table-fixed border-collapse text-xs">
            {/* Shared colgroup (identical widths + column count repeated on
               the standalone Total table below) is what actually keeps the
               two tables' cell boundaries lined up -- without it, each
               table auto-sizes its own columns from its own content, so
               the Total row's cells (short text) never land under the
               items table's cells (long Account Name / Branch text). */}
            <colgroup>
              <col style={{ width: "12%" }} />
              <col style={{ width: "10%" }} />
              <col style={{ width: "23%" }} />
              <col style={{ width: "35%" }} />
              <col style={{ width: "8%" }} />
              <col style={{ width: "12%" }} />
            </colgroup>
            <thead>
              <tr className="border border-gray-400 bg-gray-100 text-center uppercase text-gray-600">
                <th className="border border-gray-400 px-1.5 py-1.5">Sched / Area</th>
                <th className="border border-gray-400 px-1.5 py-1.5">Inv. / DR / CN</th>
                <th className="border border-gray-400 px-1.5 py-1.5">Account Name</th>
                <th className="border border-gray-400 px-1.5 py-1.5">Branch</th>
                <th className="border border-gray-400 px-1.5 py-1.5">Boxes</th>
                <th className="border border-gray-400 px-1.5 py-1.5">Amount</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row, idx) => (
                <tr key={row.route_plan_invoice_id ?? idx} className="text-center">
                  {/* Same fake-merge as the Boxes column below -- one area
                     applies to the whole truck, not per receipt, so this
                     reads as a single continuous merged box (no real
                     rowSpan, so pagination across pages still works). */}
                  <td
                    className={[
                      "border-x border-gray-300 px-1.5 py-1.5 align-middle break-words font-medium",
                      idx === 0 ? "border-t" : "",
                      idx === items.length - 1 ? "border-b" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    {idx === Math.floor((items.length - 1) / 2) ? statement.area ?? "—" : ""}
                  </td>
                  {/* break-words + the BACKLOAD/REDELIVER tag on its own
                     block line -- with table-fixed's narrow, rigid columns
                     a long "document_no(BACKLOAD)" run with no space
                     between the text node and the tag <span> has no wrap
                     point, so it overflowed the cell and visually
                     overlapped the Account Name column next to it. Forcing
                     the tag onto its own line removes the need for a wrap
                     point there at all. */}
                  <td className="border border-gray-300 px-1.5 py-1.5 break-words font-medium">
                    {row.document_no}
                    {row.is_backload && (
                      <span className="mt-0.5 block font-bold text-red-600">(BACKLOAD)</span>
                    )}
                    {row.is_redeliver && (
                      <span className="mt-0.5 block font-bold text-blue-600">(REDELIVER)</span>
                    )}
                  </td>
                  <td className="border border-gray-300 px-1.5 py-1.5 break-words text-left">
                    {row.company_name_raw ?? "—"}
                  </td>
                  <td className="border border-gray-300 px-1.5 py-1.5 break-words text-left">
                    {row.branch_address ?? "—"}
                  </td>
                  {/* Fakes a merged "Boxes" cell spanning every item row
                     without an actual <td rowSpan> -- a real rowSpan across
                     every row is exactly what used to pin the whole table
                     to one page (see note above), since the print engine
                     can't split a spanning cell across a page break. This
                     keeps the vertical border between rows but drops the
                     horizontal border between them (only the first row
                     keeps its top edge, only the last keeps its bottom
                     edge), so it reads as one continuous box, and the
                     truck's total is placed once near the middle of that
                     box instead of repeating per receipt. */}
                  <td
                    className={[
                      "border-x border-gray-300 px-1.5 py-1.5 align-middle",
                      idx === 0 ? "border-t" : "",
                      idx === items.length - 1 ? "border-b" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    {idx === Math.floor((items.length - 1) / 2) ? totalBoxes || "—" : ""}
                  </td>
                  <td className="border border-gray-300 px-1.5 py-1.5 text-right">
                    {formatMoney(row.declared_value)}
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={6} className="border border-gray-300 py-3 text-center text-gray-400">
                    No delivery receipts on this truck.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {/* Deliberately outside the <table> above, not a <tfoot> -- a
             tfoot's default `table-footer-group` display role makes
             browsers reprint it at the bottom of every paginated page, so
             the Total would repeat on page 1, 2, 3... instead of showing
             once at the very end of the report as requested. This plain
             row sits after the table and simply flows onto the last page
             wherever the item rows end. */}
          <table className="w-full table-fixed border-collapse text-xs">
            <colgroup>
              <col style={{ width: "12%" }} />
              <col style={{ width: "10%" }} />
              <col style={{ width: "23%" }} />
              <col style={{ width: "35%" }} />
              <col style={{ width: "8%" }} />
              <col style={{ width: "12%" }} />
            </colgroup>
            <tbody>
              <tr className="border-t-2 border-gray-400 text-center font-bold">
                <td className="border border-gray-300 px-1.5 py-1.5" colSpan={4}>
                  Total
                </td>
                <td className="border border-gray-300 px-1.5 py-1.5">{totalBoxes || "—"}</td>
                <td className="border border-gray-300 px-1.5 py-1.5 text-right">
                  {formatMoney(totalDeclaredValue)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="mt-12 grid grid-cols-2 gap-x-8 gap-y-10">
          <div>
            <p className="font-bold">Prepared By:</p>
            <div className="mt-6 border-t border-gray-400 pt-1">
              <p className="text-sm font-medium">{PREPARED_BY_NAME}</p>
            </div>
          </div>
          <div>
            <p className="font-bold">Approved By:</p>
            <div className="mt-6 border-t border-gray-400 pt-1">
              <p className="text-sm font-medium">{APPROVED_BY_NAME}</p>
            </div>
          </div>
        </div>

        <p className="mt-8 text-center text-[10px] text-gray-400">
          Generated {new Date().toLocaleString()} · Mondial88 Trading Corporation
        </p>
      </div>
    </div>
  );
}
