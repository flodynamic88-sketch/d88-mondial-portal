"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { findOrCreateBranchAddress, findOrCreateCompany } from "@/lib/invoiceHelpers";
import type { InvoiceCategory, ZoneType } from "@/types/database";

interface BulkEncodeGridProps {
  category: InvoiceCategory;
  onSaved?: () => void;
}

interface GridRow {
  key: string;
  documentNo: string;
  zone: ZoneType | "";
  isDc: boolean;
  companyName: string;
  branchAddress: string;
  amount: string;
  planDate: string;
  postingDate: string;
  transmittalReceivedDate: string;
  billingPeriod: string;
  remarks: string;
}

const ZONE_OPTIONS: { value: ZoneType; label: string }[] = [
  { value: "NCR", label: "NCR" },
  { value: "FAR_NORTH_SOUTH", label: "Far North / South" },
  { value: "VIZMIN", label: "VisMin" },
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
    zone: "",
    isDc: false,
    companyName: "",
    branchAddress: "",
    amount: "",
    planDate: "",
    postingDate: "",
    transmittalReceivedDate: "",
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
 * e.g. "CD_00123" + step 1 -> "CD_00124". Values with no trailing digits
 * are just repeated as-is (matching Excel's behavior for non-numeric fill).
 */
function incrementDocNo(seed: string, step: number): string {
  const match = seed.match(/^(.*?)(\d+)$/);
  if (!match) return seed;
  const [, prefix, numStr] = match;
  const width = numStr.length;
  const nextNum = parseInt(numStr, 10) + step;
  return `${prefix}${String(nextNum).padStart(width, "0")}`;
}

export default function BulkEncodeGrid({ category, onSaved }: BulkEncodeGridProps) {
  const [rows, setRows] = useState<GridRow[]>(() => makeInitialRows(8));
  const [companyOptions, setCompanyOptions] = useState<string[]>([]);
  const [branchOptions, setBranchOptions] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<
    { type: "success" | "error"; message: string } | null
  >(null);

  const dragSourceRef = useRef<number | null>(null);
  const dragSeedRef = useRef<string>("");
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
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
    if (source !== null && target !== null && target > source) {
      setRows((prev) => {
        let next = [...prev];
        if (target >= next.length) {
          next = [...next, ...makeInitialRows(target - next.length + 1)];
        }
        for (let i = source + 1; i <= target; i += 1) {
          next[i] = {
            ...next[i],
            documentNo: incrementDocNo(dragSeedRef.current, i - source),
          };
        }
        return next;
      });
    }
    dragSourceRef.current = null;
    setDragOverIndex(null);
  }, [dragOverIndex]);

  useEffect(() => {
    function handleMouseUp() {
      if (dragSourceRef.current !== null) finishDrag();
    }
    window.addEventListener("mouseup", handleMouseUp);
    return () => window.removeEventListener("mouseup", handleMouseUp);
  }, [finishDrag]);

  function startFillDrag(index: number, e: React.MouseEvent) {
    e.preventDefault();
    dragSourceRef.current = index;
    dragSeedRef.current = rowsRef.current[index].documentNo;
    setDragOverIndex(index);
  }

  function isRowInDragPreview(index: number): boolean {
    const source = dragSourceRef.current;
    if (source === null || dragOverIndex === null) return false;
    return index > source && index <= dragOverIndex;
  }

  async function handleSaveAll() {
    setFeedback(null);

    const candidates = rows
      .map((r, idx) => ({ r, idx }))
      .filter(({ r }) => r.documentNo.trim() || r.zone || r.amount.trim());

    if (candidates.length === 0) {
      setFeedback({ type: "error", message: "Walang laman na row na pwedeng i-save." });
      return;
    }

    const invalid = candidates.filter(
      ({ r }) => !r.documentNo.trim() || !r.zone || !r.amount.trim() || Number.isNaN(Number(r.amount))
    );
    if (invalid.length > 0) {
      setFeedback({
        type: "error",
        message: `May kulang na Document No./Zone/Amount sa row ${invalid
          .map(({ idx }) => idx + 1)
          .join(", ")}.`,
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

          const { error } = await supabase.from("invoices").insert({
            document_no: r.documentNo.trim(),
            category,
            zone: r.zone,
            is_dc: r.isDc,
            company_id: companyId,
            company_name_raw: nameTrimmed || null,
            branch_address: addressTrimmed || null,
            amount: Number(r.amount),
            plan_date: r.planDate || null,
            posting_date: r.postingDate || null,
            transmittal_received_date: r.transmittalReceivedDate || null,
            billing_period: r.billingPeriod || null,
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
          message: `Walang na-save. ${failed
            .map((f) => `${f.docNo} (${f.reason})`)
            .join(", ")}.`,
        });
      } else {
        setFeedback({
          type: "error",
          message: `${succeeded.length} saved. Hindi na-save: ${failed
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
            I-type ang unang Document No., tapos i-drag pababa ang maliit na kahon sa
            kanang-ibaba ng cell para awtomatikong sumunod ang mga numero (tulad ng Excel).
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
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead>
            <tr className="text-left text-xs font-semibold uppercase text-gray-500">
              <th className="py-2 pr-2">#</th>
              <th className="py-2 pr-2 min-w-[140px]">Document No.</th>
              <th className="py-2 pr-2 min-w-[130px]">Zone</th>
              <th className="py-2 pr-2">DC</th>
              <th className="py-2 pr-2 min-w-[160px]">Company</th>
              <th className="py-2 pr-2 min-w-[180px]">Branch/Store</th>
              <th className="py-2 pr-2 min-w-[110px]">Amount</th>
              <th className="py-2 pr-2 min-w-[130px]">Plan Date</th>
              <th className="py-2 pr-2 min-w-[130px]">Posting Date</th>
              <th className="py-2 pr-2 min-w-[130px]">Transmittal</th>
              <th className="py-2 pr-2 min-w-[130px]">Billing Period</th>
              <th className="py-2 pr-2 min-w-[140px]">Remarks</th>
              <th className="py-2 pr-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((row, index) => (
              <tr
                key={row.key}
                onMouseEnter={() => {
                  if (dragSourceRef.current !== null) setDragOverIndex(index);
                }}
                className={isRowInDragPreview(index) ? "bg-brand-50" : undefined}
              >
                <td className="py-1 pr-2 text-xs text-gray-400">{index + 1}</td>
                <td className="py-1 pr-2">
                  <div className="relative">
                    <input
                      type="text"
                      className="input"
                      value={row.documentNo}
                      onChange={(e) => updateRow(index, "documentNo", e.target.value)}
                      placeholder="CD_00123"
                    />
                    <div
                      onMouseDown={(e) => startFillDrag(index, e)}
                      title="I-drag pababa para sumunod na Document No."
                      className="absolute -bottom-1 -right-1 h-3 w-3 cursor-crosshair rounded-sm border border-white bg-brand-600"
                    />
                  </div>
                </td>
                <td className="py-1 pr-2">
                  <select
                    className="input"
                    value={row.zone}
                    onChange={(e) => updateRow(index, "zone", e.target.value as ZoneType)}
                  >
                    <option value="">Select</option>
                    {ZONE_OPTIONS.map((z) => (
                      <option key={z.value} value={z.value}>
                        {z.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-1 pr-2 text-center">
                  <input
                    type="checkbox"
                    checked={row.isDc}
                    onChange={(e) => updateRow(index, "isDc", e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                  />
                </td>
                <td className="py-1 pr-2">
                  <input
                    type="text"
                    list="company-options"
                    className="input"
                    value={row.companyName}
                    onChange={(e) => updateRow(index, "companyName", e.target.value)}
                  />
                </td>
                <td className="py-1 pr-2">
                  <input
                    type="text"
                    list="branch-options"
                    className="input"
                    value={row.branchAddress}
                    onChange={(e) => updateRow(index, "branchAddress", e.target.value)}
                  />
                </td>
                <td className="py-1 pr-2">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className="input"
                    value={row.amount}
                    onChange={(e) => updateRow(index, "amount", e.target.value)}
                  />
                </td>
                <td className="py-1 pr-2">
                  <input
                    type="date"
                    className="input"
                    value={row.planDate}
                    onChange={(e) => updateRow(index, "planDate", e.target.value)}
                  />
                </td>
                <td className="py-1 pr-2">
                  <input
                    type="date"
                    className="input"
                    value={row.postingDate}
                    onChange={(e) => updateRow(index, "postingDate", e.target.value)}
                  />
                </td>
                <td className="py-1 pr-2">
                  <input
                    type="date"
                    className="input"
                    value={row.transmittalReceivedDate}
                    onChange={(e) => updateRow(index, "transmittalReceivedDate", e.target.value)}
                  />
                </td>
                <td className="py-1 pr-2">
                  <input
                    type="date"
                    className="input"
                    value={row.billingPeriod}
                    onChange={(e) => updateRow(index, "billingPeriod", e.target.value)}
                  />
                </td>
                <td className="py-1 pr-2">
                  <input
                    type="text"
                    className="input"
                    value={row.remarks}
                    onChange={(e) => updateRow(index, "remarks", e.target.value)}
                  />
                </td>
                <td className="py-1 pr-2">
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
