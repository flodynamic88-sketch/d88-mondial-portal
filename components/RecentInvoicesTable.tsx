"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { exportToExcel } from "@/lib/exportExcel";
import type { Invoice, InvoiceCategory } from "@/types/database";

interface RecentInvoicesTableProps {
  category: InvoiceCategory;
  refreshKey: number;
}

export default function RecentInvoicesTable({
  category,
  refreshKey,
}: RecentInvoicesTableProps) {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setErrorMsg(null);
      try {
        const supabase = createClient();
        const { data, error } = await supabase
          .from("invoices")
          .select("*")
          .eq("category", category)
          .order("created_at", { ascending: false })
          .limit(20);

        if (cancelled) return;

        if (error) {
          setErrorMsg(
            "Could not load recent invoices. Connect a Supabase project to see live data."
          );
          setInvoices([]);
        } else {
          setInvoices(data ?? []);
        }
      } catch {
        if (!cancelled) {
          setErrorMsg(
            "Could not load recent invoices. Connect a Supabase project to see live data."
          );
          setInvoices([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [category, refreshKey]);

  async function handleDelete(inv: Invoice) {
    const confirmed = window.confirm(
      `Sigurado ka bang gusto mong i-delete ang invoice ${inv.document_no}? Hindi na ito mababawi.`
    );
    if (!confirmed) return;

    setDeletingId(inv.id);
    setDeleteError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.from("invoices").delete().eq("id", inv.id);

      if (error) {
        if (error.code === "23503") {
          setDeleteError(
            `Hindi pwedeng i-delete ang ${inv.document_no} kasi naka-assign na ito sa isang route plan/truck. Alisin muna ito sa route plan bago i-delete.`
          );
        } else {
          setDeleteError(`Failed to delete ${inv.document_no}: ${error.message}`);
        }
        return;
      }

      setInvoices((prev) => prev.filter((row) => row.id !== inv.id));
    } catch {
      setDeleteError("Could not delete invoice. Make sure a Supabase project is connected.");
    } finally {
      setDeletingId(null);
    }
  }

  function handleExport() {
    exportToExcel(`recent-invoices-${category.toLowerCase()}`, [
      {
        name: category.replace("_", " "),
        rows: invoices.map((inv) => ({
          "Document No.": inv.document_no,
          Zone: inv.zone,
          DC: inv.is_dc ? "Yes" : "No",
          Company: inv.company_name_raw ?? "",
          "Branch/Store": inv.branch_address ?? "",
          Amount: inv.amount,
          "Plan Date": inv.plan_date ?? "",
          Status: inv.status,
        })),
      },
    ]);
  }

  return (
    <div className="card mt-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-gray-800">
          Recently Encoded ({category.replace("_", " ")})
        </h2>
        {invoices.length > 0 && (
          <button
            type="button"
            className="tab-button tab-button-inactive"
            onClick={handleExport}
          >
            Export to Excel
          </button>
        )}
      </div>

      {loading && <p className="mt-3 text-sm text-gray-400">Loading…</p>}
      {!loading && errorMsg && (
        <p className="mt-3 text-sm text-gray-400">{errorMsg}</p>
      )}
      {!loading && !errorMsg && invoices.length === 0 && (
        <p className="mt-3 text-sm text-gray-400">No invoices encoded yet.</p>
      )}
      {deleteError && <p className="mt-3 text-sm text-red-600">{deleteError}</p>}

      {!loading && !errorMsg && invoices.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold uppercase text-gray-500">
                <th className="py-2 pr-4">Document No.</th>
                <th className="py-2 pr-4">Zone</th>
                <th className="py-2 pr-4">DC</th>
                <th className="py-2 pr-4">Company</th>
                <th className="py-2 pr-4">Branch/Store</th>
                <th className="py-2 pr-4">Amount</th>
                <th className="py-2 pr-4">Plan Date</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {invoices.map((inv) => (
                <tr key={inv.id}>
                  <td className="py-2 pr-4 font-medium text-gray-800">
                    {inv.document_no}
                  </td>
                  <td className="py-2 pr-4">{inv.zone}</td>
                  <td className="py-2 pr-4">{inv.is_dc ? "Yes" : "No"}</td>
                  <td className="py-2 pr-4">{inv.company_name_raw ?? "—"}</td>
                  <td className="py-2 pr-4">{inv.branch_address ?? "—"}</td>
                  <td className="py-2 pr-4">
                    {inv.amount.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </td>
                  <td className="py-2 pr-4">{inv.plan_date ?? "—"}</td>
                  <td className="py-2 pr-4">{inv.status}</td>
                  <td className="py-2 pr-4">
                    <button
                      type="button"
                      className="text-xs font-medium text-red-600 hover:text-red-800 disabled:opacity-50"
                      onClick={() => handleDelete(inv)}
                      disabled={deletingId === inv.id}
                    >
                      {deletingId === inv.id ? "Deleting…" : "Delete"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
