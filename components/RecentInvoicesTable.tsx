"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
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

  return (
    <div className="card mt-6">
      <h2 className="text-lg font-semibold text-gray-800">
        Recently Encoded ({category.replace("_", " ")})
      </h2>

      {loading && <p className="mt-3 text-sm text-gray-400">Loading…</p>}
      {!loading && errorMsg && (
        <p className="mt-3 text-sm text-gray-400">{errorMsg}</p>
      )}
      {!loading && !errorMsg && invoices.length === 0 && (
        <p className="mt-3 text-sm text-gray-400">No invoices encoded yet.</p>
      )}

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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
