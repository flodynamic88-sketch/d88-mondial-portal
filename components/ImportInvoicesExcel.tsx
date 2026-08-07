"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/Toast";
import { findOrCreateBranchAddress, findOrCreateCompany } from "@/lib/invoiceHelpers";
import { currentMonthValue, monthValueToDate } from "@/lib/dateHelpers";
import { parseInvoiceExcelFile } from "@/lib/parseInvoiceExcel";
import type { InvoiceCategory } from "@/types/database";

interface ImportInvoicesExcelProps {
  category: InvoiceCategory;
  onImported?: () => void;
}

/**
 * "Import Excel" button for Encode Invoices -- reads a Consignment delivery
 * export (e.g. "MGM 3 - CAVITE.xlsx") straight from disk and inserts every
 * row directly into `invoices`, no manual grid review step, per JMD's
 * request. Column mapping and active-sheet detection live in
 * lib/parseInvoiceExcel.ts; this component only handles the file picker and
 * the same find-or-create-company/branch + insert flow BulkEncodeGrid uses
 * for its "Save All", so imported and manually-encoded rows behave
 * identically afterward (same dedupe-by-document_no, same company/branch
 * autocomplete tables get populated).
 */
export default function ImportInvoicesExcel({ category, onImported }: ImportInvoicesExcelProps) {
  const { showToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  function handleClick() {
    fileInputRef.current?.click();
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file name later
    if (!file) return;

    setImporting(true);
    try {
      const { sheetName, rows, skippedRowNumbers } = await parseInvoiceExcelFile(file);

      if (rows.length === 0) {
        showToast(
          `No usable rows found in sheet "${sheetName}" (missing Document No. or Amount).`,
          "error"
        );
        return;
      }

      const supabase = createClient();
      const companyCache = new Map<string, string | null>();
      const branchSeen = new Set<string>();
      const billingPeriod = monthValueToDate(currentMonthValue());

      let succeeded = 0;
      let duplicates = 0;
      const otherFailures: string[] = [];

      for (const row of rows) {
        try {
          const nameTrimmed = row.companyName.trim();
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

          const addressTrimmed = row.branchAddress.trim();
          if (addressTrimmed && !branchSeen.has(addressTrimmed.toLowerCase())) {
            branchSeen.add(addressTrimmed.toLowerCase());
            await findOrCreateBranchAddress(addressTrimmed, companyId);
          }

          // Zone, DC, Plan Date, and Transmittal Date are filled in later
          // from Recently Encoded -- same as manual grid/single entry.
          const { error } = await supabase.from("invoices").insert({
            document_no: row.documentNo,
            category,
            zone: null,
            is_dc: false,
            company_id: companyId,
            company_name_raw: nameTrimmed || null,
            branch_address: addressTrimmed || null,
            amount: row.amount,
            plan_date: null,
            posting_date: row.postingDate,
            transmittal_received_date: null,
            billing_period: billingPeriod,
            remarks: row.remarks.trim() || null,
          });

          if (error) {
            if (error.code === "23505") {
              duplicates += 1;
            } else {
              otherFailures.push(`${row.documentNo} (${error.message})`);
            }
          } else {
            succeeded += 1;
          }
        } catch {
          otherFailures.push(`${row.documentNo} (import failed)`);
        }
      }

      const skippedNote = skippedRowNumbers.length > 0 ? `, ${skippedRowNumbers.length} skipped (blank)` : "";

      if (otherFailures.length === 0) {
        const msg = `Imported ${succeeded} invoice${succeeded === 1 ? "" : "s"} from "${sheetName}"${
          duplicates > 0 ? `, ${duplicates} already existed` : ""
        }${skippedNote}.`;
        showToast(msg, succeeded > 0 ? "success" : "info");
      } else {
        showToast(
          `Imported ${succeeded}, ${duplicates} already existed, ${otherFailures.length} failed: ${otherFailures
            .slice(0, 3)
            .join(", ")}${otherFailures.length > 3 ? "…" : ""}`,
          "error"
        );
      }

      if (succeeded > 0) onImported?.();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not read this Excel file.", "error");
    } finally {
      setImporting(false);
    }
  }

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={handleFileChange}
      />
      <button
        type="button"
        className="tab-button tab-button-inactive"
        onClick={handleClick}
        disabled={importing}
        title="Import a Consignment delivery Excel export directly into Encode Invoices"
      >
        {importing ? "Importing…" : "Import Excel"}
      </button>
    </>
  );
}
