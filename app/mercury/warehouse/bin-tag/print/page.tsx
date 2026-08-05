"use client";

/**
 * Bin Tag — printable warehouse card.
 *
 * Opened via /warehouse/bin-tag/print?itemId=xxx (itemId optional — omit
 * for a fully blank card). Redesigned from the physical Dynamic88 "BIN
 * TAG" index card taped to warehouse bins: one card per Letter sheet,
 * portrait, with the daily In/Out grid encoders fill by hand at the bin.
 *
 * Per the 2026-07-13 requests:
 *   - "Warehouse Shipment No." is relabeled to "Invoice Number".
 *   - Portrait (not landscape) to match how it's actually filed.
 *   - Our UoM set is just Case / Box / Pcs (not the MCart/ICart/Pack/PCs
 *     on the reference photo).
 *   - Uses the Dynamic88 teal brand (#5ea5a0) instead of the plain
 *     black/gray of the original paper form.
 * Placed outside the (app) layout group, following the same @page /
 * print-toolbar pattern used by every other print page in the app.
 */

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/mercury/supabase/client";
import type { Item } from "@/lib/mercury/types";

const BLANK_ROWS = 20;
const UOM_GROUPS = ["Case", "Box", "Pcs"];
// Date, BEG, Outright/Concession, Invoice Number, Ending Balance, Checked
// by, Picked by (7 fixed columns) + one In/Out pair per UoM group.
const TOTAL_COLS = 7 + UOM_GROUPS.length * 2;

function BinTagContent() {
  const searchParams = useSearchParams();
  const itemId = searchParams.get("itemId") || "";

  const [item, setItem] = useState<Item | null>(null);
  const [loading, setLoading] = useState(!!itemId);

  useEffect(() => {
    if (!itemId) {
      setLoading(false);
      return;
    }
    const supabase = createClient();
    supabase
      .schema("flo").from("items")
      .select("*, clients(id, client_code, client_name)")
      .eq("id", itemId)
      .single()
      .then(({ data }) => {
        setItem((data as Item) || null);
        setLoading(false);
      });
  }, [itemId]);

  if (loading) return <div className="p-8 text-sm text-gray-400">Loading…</div>;

  return (
    <div>
      <style jsx global>{`
        @page {
          size: 8.5in 11in;
          margin: 0.4in;
        }
        body {
          background: white !important;
        }
        table {
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
          border: 1.5px solid #000;
        }
        table td,
        table th {
          border: 1px solid #000 !important;
        }
        @media print {
          .print-toolbar {
            display: none !important;
          }
          * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
        }
      `}</style>

      <div className="print-toolbar flex justify-center gap-2 py-4">
        <button className="btn-primary" onClick={() => window.print()}>
          Print / Save as PDF
        </button>
      </div>

      <div
        className="mx-auto bg-white text-gray-900"
        style={{ width: "7.7in", fontFamily: "Arial, Helvetica, sans-serif" }}
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b-2 border-brand pb-2 mb-2">
          <div className="flex items-center gap-2">
            <img src="/logo-icon.png" alt="Dynamic88" className="h-10 w-10" />
            <div>
              <div className="text-base font-extrabold tracking-tight text-brand-dark leading-tight">
                Dynamic88 Solutions
              </div>
              <div className="text-[9px] uppercase tracking-wider text-gray-500 leading-tight">
                FLO Division — Warehouse
              </div>
            </div>
          </div>
          <div className="text-xl font-extrabold tracking-wide text-brand-dark self-center">
            BIN TAG
          </div>
          <div className="flex text-[9px]">
            <div className="border border-gray-800">
              <div className="bg-brand text-white font-semibold px-2 py-0.5 text-center">
                Location
              </div>
              <div className="h-6 w-20 border-t border-gray-800">&nbsp;</div>
            </div>
            <div className="border border-l-0 border-gray-800">
              <div className="bg-brand text-white font-semibold px-2 py-0.5 text-center">
                Bin No.
              </div>
              <div className="h-6 w-16 border-t border-gray-800">&nbsp;</div>
            </div>
          </div>
        </div>

        {/* Item info block */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[9px] mb-2 px-0.5">
          <div className="flex gap-1">
            <span className="font-semibold text-gray-600 w-24 shrink-0">Brand Name</span>
            <span className="flex-1 border-b border-gray-700 font-medium">
              {item?.clients?.client_name || " "}
            </span>
          </div>
          <div className="flex gap-1">
            <span className="font-semibold text-gray-600 w-32 shrink-0">
              Expiration Date (DD/MM/YY)
            </span>
            <span className="flex-1 border-b border-gray-700">&nbsp;</span>
          </div>
          <div className="flex gap-1">
            <span className="font-semibold text-gray-600 w-24 shrink-0">Item Description</span>
            <span className="flex-1 border-b border-gray-700 font-medium">
              {item?.item_description || " "}
            </span>
          </div>
          <div className="flex gap-1">
            <span className="font-semibold text-gray-600 w-32 shrink-0">
              Beginning Balance Date
            </span>
            <span className="flex-1 border-b border-gray-700">&nbsp;</span>
          </div>
          <div className="flex gap-1">
            <span className="font-semibold text-gray-600 w-24 shrink-0">Item Code</span>
            <span className="flex-1 border-b border-gray-700 font-medium">
              {item?.mercury_item_code || item?.item_code || " "}
            </span>
          </div>
          <div className="flex gap-1">
            <span className="font-semibold text-gray-600 w-32 shrink-0">Shipment Arrival No.</span>
            <span className="flex-1 border-b border-gray-700">&nbsp;</span>
          </div>
        </div>

        {/* Grid */}
        <table className="w-full border-collapse text-[7.5px]" style={{ tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: "0.75in" }} />
            <col style={{ width: "0.4in" }} />
            <col style={{ width: "0.6in" }} />
            <col style={{ width: "0.85in" }} />
            {UOM_GROUPS.map((g) => (
              <>
                <col key={`${g}-in`} style={{ width: "0.42in" }} />
                <col key={`${g}-out`} style={{ width: "0.42in" }} />
              </>
            ))}
            <col style={{ width: "0.6in" }} />
            <col style={{ width: "0.65in" }} />
            <col style={{ width: "0.65in" }} />
          </colgroup>
          <thead>
            <tr className="bg-brand-dark text-white">
              <th rowSpan={3} className="border border-gray-400 px-1 py-1 align-middle">
                Date
                <div className="font-normal text-[6.5px]">(DD/MM/YY)</div>
              </th>
              <th rowSpan={3} className="border border-gray-400 px-1 py-1 align-middle">
                BEG
              </th>
              <th colSpan={2} className="border border-gray-400 px-1 py-1">
                Store
              </th>
              <th colSpan={UOM_GROUPS.length * 2} className="border border-gray-400 px-1 py-1">
                UoM
              </th>
              <th rowSpan={3} className="border border-gray-400 px-1 py-1 align-middle">
                Ending
                <br />
                Balance
                <div className="font-normal text-[6.5px]">(pcs)</div>
              </th>
              <th rowSpan={3} className="border border-gray-400 px-1 py-1 align-middle">
                Checked by
              </th>
              <th rowSpan={3} className="border border-gray-400 px-1 py-1 align-middle">
                Picked by
              </th>
            </tr>
            <tr className="bg-brand-dark text-white">
              <th className="border border-gray-400 px-1 py-1 font-normal text-[6.5px]">
                Mercury Drug
              </th>
              <th className="border border-gray-400 px-1 py-1 font-normal text-[6.5px]">
                Invoice Number
              </th>
              {UOM_GROUPS.map((g) => (
                <th key={g} colSpan={2} className="border border-gray-400 px-1 py-1">
                  {g}
                </th>
              ))}
            </tr>
            <tr className="bg-brand-dark text-white">
              <th className="border border-gray-400 px-1 py-0.5" />
              <th className="border border-gray-400 px-1 py-0.5" />
              {UOM_GROUPS.map((g) => (
                <>
                  <th key={`${g}-in-h`} className="border border-gray-400 px-1 py-0.5 font-normal">
                    In
                  </th>
                  <th key={`${g}-out-h`} className="border border-gray-400 px-1 py-0.5 font-normal">
                    Out
                  </th>
                </>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: BLANK_ROWS }).map((_, idx) => (
              <tr key={idx} className={idx % 2 === 1 ? "bg-brand-light/40" : ""}>
                {Array.from({ length: TOTAL_COLS }).map((__, col) => (
                  <td key={col} className="border border-gray-300" style={{ height: "0.3in" }}>
                    &nbsp;
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>

        {/* Footer signatures */}
        <table className="w-full border-collapse text-[9px] mt-0">
          <tbody>
            <tr>
              <td className="border border-gray-400 bg-brand text-white font-semibold px-2 py-1 w-1/3">
                Counted by
              </td>
              <td className="border border-gray-400 bg-brand text-white font-semibold px-2 py-1 w-1/3">
                Audited by
              </td>
              <td className="border border-gray-400 bg-brand text-white font-semibold px-2 py-1 w-1/3">
                Date
              </td>
            </tr>
            <tr>
              <td className="border border-gray-400" style={{ height: "0.4in" }}>
                &nbsp;
              </td>
              <td className="border border-gray-400" style={{ height: "0.4in" }}>
                &nbsp;
              </td>
              <td className="border border-gray-400" style={{ height: "0.4in" }}>
                &nbsp;
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function BinTagPrintPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-gray-400">Loading…</div>}>
      <BinTagContent />
    </Suspense>
  );
}
