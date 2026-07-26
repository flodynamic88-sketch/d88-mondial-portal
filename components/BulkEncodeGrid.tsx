"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { findOrCreateBranchAddress, findOrCreateCompany } from "@/lib/invoiceHelpers";
import { monthValueToDate } from "@/lib/dateHelpers";
import type { InvoiceCategory } from "@/types/database";

interface BulkEncodeGridProps {
  category: InvoiceCategory;
  onSaved?: () => void;
}

// Fields collected at initial encode time. Zone, DC, Plan Date, and
// Transmittal Date are filled in later from Recently Encoded, once the
// invoice is being scheduled for delivery.
interface GridRow {
  key: string;
  documentNo: string;
  companyName: string;
  branchAddress: string;
  amount: string;
  postingDate: string;
  billingPeriod: string;
  remarks: string;
}

type TextColumnKey = Exclude<keyof GridRow, "key">;

const COLUMNS: {
  key: TextColumnKey;
  label: string;
  type: "text" | "number" | "date" | "month";
  minWidth: string;
}[] = [
  { key: "documentNo", label: "Document No.", type: "text", minWidth: "105px" },
  { key: "companyName", label: "Retail Chain / Account", type: "text", minWidth: "135px" },
  { key: "branchAddress", label: "Branch/Store Address", type: "text", minWidth: "150px" },
  { key: "amount", label: "Amount", type: "number", minWidth: "85px" },
  { key: "postingDate", label: "Posting Date", type: "date", minWidth: "105px" },
  { key: "billingPeriod", label: "Month", type: "month", minWidth: "95px" },
  { key: "remarks", label: "Remarks", type: "text", minWidth: "115px" },
];

let rowCounter = 0;
function makeKey() {
  rowCounter += 1;
  return `row-${Date.now()}-${rowCounter}`;
}

function emptyRow(): GridRow {
  return {
    key: makeKey(),
    documentNo: "",
    companyName: "",
    branchAddress: "",
    amount: "",
    postingDate: "",
    billingPeriod: "",
    remarks: "",
  };
}

function makeInitialRows(count: number): GridRow[] {
  return Array.from({ length: count }, () => emptyRow());
}

/**
 * Mimics Excel's fill-handle: detects a trailing numeric run in the seed
 * value and increments it per step, preserving prefix and zero-padding.
 * e.g. "CD_00123" + step 1 -> "CD_00124". A date string like "2026-07-24"
 * has its trailing "24" incremented the same way, which conveniently
 * advances it by a day per row. Values with no trailing digits are just
 * repeated as-is (matching Excel's behavior for non-numeric fill).
 */
function dragFillValue(seed: string, step: number): string {
  const match = seed.match(/^(.*?)(\d+)$/);
  if (!match) return seed;
  const [, prefix, numStr] = match;
  const width = numStr.length;
  const nextNum = parseInt(numStr, 10) + step;
  return `${prefix}${String(nextNum).padStart(width, "0")}`;
}

/**
 * Month-aware fill for the "Month" column (input type="month", value
 * "YYYY-MM"). Adds `step` months with correct year rollover, instead of the
 * generic trailing-digit increment (which would turn "2026-07" into the
 * invalid "2026-13" once step got past 6).
 */
function dragFillMonthValue(seed: string, step: number): string {
  const match = seed.match(/^(\d{4})-(\d{2})$/);
  if (!match) return seed;
  const [, yearStr, monthStr] = match;
  const totalMonths = parseInt(yearStr, 10) * 12 + (parseInt(monthStr, 10) - 1) + step;
  const nextYear = Math.floor(totalMonths / 12);
  const nextMonth = (totalMonths % 12) + 1;
  return `${nextYear}-${String(nextMonth).padStart(2, "0")}`;
}

export default function BulkEncodeGrid({ category, onSaved }: BulkEncodeGridProps) {
  const [rows, setRows] = useState<GridRow[]>(() => makeInitialRows(8));
  const [companyOptions, setCompanyOptions] = useState<string[]>([]);
  const [branchOptions, setBranchOptions] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<
    { type: "success" | "error"; message: string } | null
  >(null);

  // Tracks the cell (row + column) the current fill-handle drag started from.
  const dragSourceRef = useRef<{ index: number; column: TextColumnKey } | null>(null);
  const dragSeedRef = useRef<string>("");
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [dragColumn, setDragColumn] = useState<TextColumnKey | null>(null);
  const rowsRef = useRef<GridRow[]>(rows);
  rowsRef.current = rows;

  useEffect(() => {
    async function loadOptions() {
      try {
        const supabase = createClient();
        const [{ data: companies }, { data: branches }] = await Promise.all([
          supabase.from("companies").select("name").order("name").limit(500),
          supabase.from("branch_addresses").select("address").order("address").limit(500),
        ]);
        setCompanyOptions((companies ?? []).map((c) => c.name));
        setBranchOptions((branches ?? []).map((b) => b.address));
      } catch {
        // Non-fatal: datalist suggestions just won't be populated.
      }
    }
    loadOptions();
  }, []);

  function updateRow<K extends keyof GridRow>(index: number, key: K, value: GridRow[K]) {
    setRows((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [key]: value };
      return next;
    });
  }

  function addRows(count: number) {
    setRows((prev) => [...prev, ...makeInitialRows(count)]);
  }

  function removeRow(index: number) {
    setRows((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
  }

  function clearAll() {
    setRows(makeInitialRows(8));
    setFeedback(null);
  }

  const finishDrag = useCallback(() => {
    const source = dragSourceRef.current;
    const target = dragOverIndex;
    if (source !== null && target !== null && target > source.index) {
      const { index: sourceIndex, column } = source;
      setRows((prev) => {
        let next = [...prev];
        if (target >= next.length) {
          next = [...next, ...makeInitialRows(target - next.length + 1)];
        }
        const fill = column === "billingPeriod" ? dragFillMonthValue : dragFillValue;
        for (let i = sourceIndex + 1; i <= target; i += 1) {
          next[i] = {
            ...next[i],
            [column]: fill(dragSeedRef.current, i - sourceIndex),
          };
        }
        return next;
      });
    }
    dragSourceRef.current = null;
    setDragOverIndex(null);
    setDragColumn(null);
  }, [dragOverIndex]);

  useEffect(() => {
    function handleMouseUp() {
      if (dragSourceRef.current !== null) finishDrag();
    }
    window.addEventListener("mouseup", handleMouseUp);
    return () => window.removeEventListener("mouseup", handleMouseUp);
  }, [finishDrag]);

  function startFillDrag(index: number, column: TextColumnKey, e: React.MouseEvent) {
    e.preventDefault();
    dragSourceRef.current = { index, column };
    dragSeedRef.current = rowsRef.current[index][column];
    setDragColumn(column);
    setDragOverIndex(index);
  }

  function isCellInDragPreview(index: number, column: TextColumnKey): boolean {
    const source = dragSourceRef.current;
    if (source === null || dragOverIndex === null || dragColumn !== column) return false;
    return index > source.index && index <= dragOverIndex;
  }

  async function handleSaveAll() {
    setFeedback(null);

    const candidates = rows
      .map((r, idx) => ({ r, idx }))
      .filter(({ r }) => r.documentNo.trim() || r.amount.trim());

    if (candidates.length === 0) {
      setFeedback({ type: "error", message: "No rows with data to save." });
      return;
    }

    const invalid = candidates.filter(
      ({ r }) => !r.documentNo.trim() || !r.amount.trim() || Number.isNaN(Number(r.amount))
    );
    if (invalid.length > 0) {
      setFeedback({
        type: "error",
        message: `Row ${invalid
          .map(({ idx }) => idx + 1)
          .join(", ")} is missing Document No./Amount.`,
      });
      return;
    }

    setSaving(true);
    try {
      const supabase = createClient();
      const companyCache = new Map<string, string | null>();
      const branchSeen = new Set<string>();

      const succeeded: string[] = [];
      const failed: { docNo: string; reason: string }[] = [];
      const savedKeys = new Set<string>();

      for (const { r } of candidates) {
        try {
          const nameTrimmed = r.companyName.trim();
          let companyId: string | null = null;
          if (nameTrimmed) {
            const cacheKey = nameTrimmed.toLowerCase();
            if (companyCache.has(cacheKey)) {
              companyId = companyCache.get(cacheKey) ?? null;
            } else {
              companyId = await findOrCreateCompany(nameTrimmed);
              companyCache.set(cacheKey, companyId);
            }
          }

          const addressTrimmed = r.branchAddress.trim();
          if (addressTrimmed && !branchSeen.has(addressTrimmed.toLowerCase())) {
            branchSeen.add(addressTrimmed.toLowerCase());
            await findOrCreateBranchAddress(addressTrimmed, companyId);
          }

          // Zone, DC, Plan Date, and Transmittal Date are filled in later
          // from Recently Encoded.
          const { error } = await supabase.from("invoices").insert({
            document_no: r.documentNo.trim(),
            category,
            zone: null,
            is_dc: false,
            company_id: companyId,
            company_name_raw: nameTrimmed || null,
            branch_address: addressTrimmed || null,
            amount: Number(r.amount),
            plan_date: null,
            posting_date: r.postingDate || null,
            transmittal_received_date: null,
            billing_period: monthValueToDate(r.billingPeriod),
            remarks: r.remarks.trim() || null,
          });

          if (error) {
            failed.push({
              docNo: r.documentNo.trim(),
              reason: error.code === "23505" ? "already exists" : error.message,
            });
          } else {
            succeeded.push(r.documentNo.trim());
            savedKeys.add(r.key);
          }
        } catch {
          failed.push({ docNo: r.documentNo.trim(), reason: "save failed" });
        }
      }

      setRows((prev) => {
        const remaining = prev.filter((row) => !savedKeys.has(row.key));
        return remaining.length > 0 ? remaining : makeInitialRows(8);
      });

      if (failed.length === 0) {
        setFeedback({
          type: "success",
          message: `${succeeded.length} invoice${succeeded.length === 1 ? "" : "s"} encoded successfully.`,
        });
      } else if (succeeded.length === 0) {
        setFeedback({
          type: "error",
          message: `Nothing was saved. ${failed
            .map((f) => `${f.docNo} (${f.reason})`)
            .join(", ")}.`,
        });
      } else {
        setFeedback({
          type: "error",
          message: `${succeeded.length} saved. Not saved: ${failed
            .map((f) => `${f.docNo} (${f.reason})`)
            .join(", ")}.`,
        });
      }

      if (succeeded.length > 0) onSaved?.();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card select-none">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-700">Grid Entry</h2>
          <p className="text-xs text-gray-500">
            Type a value, then drag the small square at the bottom-right of
            any cell downward to auto-fill the rows below it (like Excel).
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" className="tab-button tab-button-inactive" onClick={() => addRows(5)}>
            + Add 5 Rows
          </button>
          <button type="button" className="tab-button tab-button-inactive" onClick={clearAll}>
            Clear
          </button>
        </div>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 text-xs">
          <thead>
            <tr className="text-left text-[11px] font-semibold uppercase text-gray-500">
              <th className="py-1.5 pr-1.5">#</th>
              {COLUMNS.map((col) => (
                <th key={col.key} className="py-1.5 pr-1.5" style={{ minWidth: col.minWidth }}>
                  {col.label}
                </th>
              ))}
              <th className="py-1.5 pr-1.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((row, index) => (
              <tr
                key={row.key}
                onMouseEnter={() => {
                  if (dragSourceRef.current !== null) setDragOverIndex(index);
                }}
              >
                <td className="py-0.5 pr-1.5 text-[11px] text-gray-400">{index + 1}</td>
                {COLUMNS.map((col) => (
                  <td
                    key={col.key}
                    className={`py-0.5 pr-1.5 ${
                      isCellInDragPreview(index, col.key) ? "bg-brand-50" : ""
                    }`}
                  >
                    <div className="relative">
                      <input
                        type={col.type}
                        step={col.type === "number" ? "0.01" : undefined}
                        min={col.type === "number" ? "0" : undefined}
                        list={
                          col.key === "companyName"
                            ? "company-options"
                            : col.key === "branchAddress"
                              ? "branch-options"
                              : undefined
                        }
                        className="input-sm"
                        value={row[col.key]}
                        onChange={(e) => updateRow(index, col.key, e.target.value)}
                        placeholder={col.key === "documentNo" ? "CD_00123" : undefined}
                      />
                      <div
                        onMouseDown={(e) => startFillDrag(index, col.key, e)}
                        title="Drag down to auto-fill"
                        className="absolute -bottom-1 -right-1 h-3 w-3 cursor-crosshair rounded-sm border border-white bg-brand-600"
                      />
                    </div>
                  </td>
                ))}
                <td className="py-0.5 pr-1.5">
                  <button
                    type="button"
                    onClick={() => removeRow(index)}
                    className="text-xs text-gray-400 hover:text-red-600"
                    title="Remove row"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <datalist id="company-options">
        {companyOptions.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      <datalist id="branch-options">
        {branchOptions.map((address) => (
          <option key={address} value={address} />
        ))}
      </datalist>

      {feedback && (
        <p className={`mt-3 text-sm ${feedback.type === "success" ? "text-green-600" : "text-red-600"}`}>
          {feedback.message}
        </p>
      )}

      <div className="mt-4">
        <button type="button" className="btn-primary" onClick={handleSaveAll} disabled={saving}>
          {saving ? "Saving…" : "Save All"}
        </button>
      </div>
    </div>
  );
}
