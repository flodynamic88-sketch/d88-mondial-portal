"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/Toast";
import { findOrCreateBranchAddress, findOrCreateCompany } from "@/lib/invoiceHelpers";
import { monthValueToDate, currentMonthValue } from "@/lib/dateHelpers";
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
  { key: "amount", label: "Amount", type: "text", minWidth: "95px" },
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
    // Most invoices are encoded for the current month -- default it here but
    // keep the field fully editable (including drag-fill) for exceptions.
    billingPeriod: currentMonthValue(),
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

/** Amount fill-handle just repeats the source value (like Excel does when
 * dragging a single numeric/currency cell without a second reference point),
 * instead of incrementing trailing digits which would mangle "135,000.00". */
function dragFillAmountValue(seed: string): string {
  return seed;
}

/** Strips everything except digits, a decimal point, and a leading minus. */
function stripAmountToNumericString(raw: string): string {
  return raw.replace(/[^0-9.-]/g, "");
}

/** Converts a raw/typed amount into the display format sample the user asked
 * for, e.g. "135000" -> "135,000.00". Leaves the value alone if it isn't a
 * parseable number (so the user can keep typing without it fighting back). */
function formatAmountDisplay(raw: string): string {
  const cleaned = stripAmountToNumericString(raw);
  if (!cleaned) return "";
  const num = Number(cleaned);
  if (Number.isNaN(num)) return raw.trim();
  return num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Removes the thousands commas so the field is easy to keep typing in while
 * focused; re-applied on blur via formatAmountDisplay. */
function unformatAmountForEditing(raw: string): string {
  return raw.replace(/,/g, "");
}

/**
 * Normalizes a pasted "Posting Date" cell into the "YYYY-MM-DD" shape the
 * native date input requires. Excel copies a date cell to the clipboard as
 * locale-formatted text (e.g. "8/6/2026"), not ISO, so pasting it straight
 * into an <input type="date"> silently fails to display (the browser just
 * shows it blank) while the invalid string still sits in state and would
 * later fail the insert. Handles already-ISO text, "M/D/YY(YY)", and a bare
 * Excel serial number (in case the source cell's format was "General").
 * Falls back to the raw trimmed text for anything unrecognized, so a
 * hand-typed value never gets silently blanked.
 */
function parsePastedDate(raw: string): string {
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

export default function BulkEncodeGrid({ category, onSaved }: BulkEncodeGridProps) {
  const { showToast } = useToast();
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
        const fill =
          column === "billingPeriod"
            ? dragFillMonthValue
            : column === "amount"
              ? dragFillAmountValue
              : dragFillValue;
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

  function handleAmountFocus(index: number) {
    setRows((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], amount: unformatAmountForEditing(next[index].amount) };
      return next;
    });
  }

  function handleAmountBlur(index: number) {
    setRows((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], amount: formatAmountDisplay(next[index].amount) };
      return next;
    });
  }

  /**
   * Handles pasting a block of cells copied from Excel (or from elsewhere in
   * the grid). Excel puts tab-separated columns and newline-separated rows
   * on the clipboard, so a multi-cell copy pastes down *and* across starting
   * from whatever cell has focus — no more clicking into every single cell.
   */
  function handleGridPaste(
    e: React.ClipboardEvent<HTMLInputElement>,
    rowIndex: number,
    colIndex: number
  ) {
    const text = e.clipboardData.getData("text");
    if (!text) return;
    e.preventDefault();

    const pastedRows = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    while (pastedRows.length > 1 && pastedRows[pastedRows.length - 1] === "") {
      pastedRows.pop();
    }

    setRows((prev) => {
      let next = [...prev];
      const neededLength = rowIndex + pastedRows.length;
      if (neededLength > next.length) {
        next = [...next, ...makeInitialRows(neededLength - next.length)];
      }

      pastedRows.forEach((lineText, i) => {
        const targetRowIndex = rowIndex + i;
        const cells = lineText.split("\t");
        let updatedRow = { ...next[targetRowIndex] };
        cells.forEach((cellValue, j) => {
          const targetColIndex = colIndex + j;
          if (targetColIndex >= COLUMNS.length) return;
          const colDef = COLUMNS[targetColIndex];
          const value = cellValue.trim();
          updatedRow = {
            ...updatedRow,
            [colDef.key]:
              colDef.key === "amount"
                ? formatAmountDisplay(value)
                : colDef.key === "postingDate"
                  ? parsePastedDate(value)
                  : value,
          };
        });
        next[targetRowIndex] = updatedRow;
      });

      return next;
    });
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
      ({ r }) =>
        !r.documentNo.trim() ||
        !r.amount.trim() ||
        Number.isNaN(Number(stripAmountToNumericString(r.amount)))
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
            amount: Number(stripAmountToNumericString(r.amount)),
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
        const msg = `${succeeded.length} invoice${succeeded.length === 1 ? "" : "s"} encoded successfully.`;
        setFeedback({ type: "success", message: msg });
        showToast(msg, "success");
      } else if (succeeded.length === 0) {
        const msg = `Nothing was saved. ${failed
          .map((f) => `${f.docNo} (${f.reason})`)
          .join(", ")}.`;
        setFeedback({ type: "error", message: msg });
        showToast("Nothing was saved. See details below.", "error");
      } else {
        const msg = `${succeeded.length} saved. Not saved: ${failed
          .map((f) => `${f.docNo} (${f.reason})`)
          .join(", ")}.`;
        setFeedback({ type: "error", message: msg });
        showToast(`${succeeded.length} saved, ${failed.length} failed. See details below.`, "error");
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
            any cell downward to auto-fill the rows below it (like Excel). You
            can also copy cells from Excel (or elsewhere in this grid) and
            paste — it fills down and across starting from the selected cell.
            Amount format sample: 135,000.00
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

      <div className="mt-4 table-scroll-container">
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
                {COLUMNS.map((col, colIdx) => (
                  <td
                    key={col.key}
                    className={`py-0.5 pr-1.5 ${
                      isCellInDragPreview(index, col.key) ? "bg-brand-50" : ""
                    }`}
                  >
                    <div className="relative">
                      <input
                        type={col.type}
                        inputMode={col.key === "amount" ? "decimal" : undefined}
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
                        onFocus={col.key === "amount" ? () => handleAmountFocus(index) : undefined}
                        onBlur={col.key === "amount" ? () => handleAmountBlur(index) : undefined}
                        onPaste={(e) => handleGridPaste(e, index, colIdx)}
                        placeholder={
                          col.key === "documentNo"
                            ? "CD_00123"
                            : col.key === "amount"
                              ? "135,000.00"
                              : undefined
                        }
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
