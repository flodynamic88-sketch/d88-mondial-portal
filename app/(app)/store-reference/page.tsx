"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import RequireRole from "@/components/RequireRole";
import { exportToExcel } from "@/lib/exportExcel";
import type { InvoiceCategory, VInvoiceStoreReference } from "@/types/database";

const TABS: { value: InvoiceCategory; label: string }[] = [
  { value: "CONSIGNMENT", label: "Consignment" },
  { value: "OUTRIGHT", label: "Outright" },
  { value: "MERCURY_DRUG", label: "Flo Mercury" },
];

export default function StoreReferencePage() {
  const [rows, setRows] = useState<VInvoiceStoreReference[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<InvoiceCategory>("CONSIGNMENT");
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setErrorMsg(null);
      const supabase = createClient();
      const { data, error } = await supabase
        .from("v_invoice_store_reference")
        .select("*")
        .order("store_name", { ascending: true });
      if (cancelled) return;
      if (error) {
        setErrorMsg("Could not load store list. Connect a Supabase project to see live data.");
        setRows([]);
      } else {
        setRows((data as VInvoiceStoreReference[]) ?? []);
      }
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredRows = useMemo(() => {
    const bySearch = search.trim().toLowerCase();
    return rows
      .filter((r) => r.category === activeTab)
      .filter((r) => {
        if (!bySearch) return true;
        return (
          r.store_name.toLowerCase().includes(bySearch) ||
          (r.branch_address ?? "").toLowerCase().includes(bySearch)
        );
      });
  }, [rows, activeTab, search]);

  const counts = useMemo(() => {
    const map: Record<InvoiceCategory, number> = {
      CONSIGNMENT: 0,
      OUTRIGHT: 0,
      MERCURY_DRUG: 0,
      FLO_PRINCIPAL: 0,
    };
    rows.forEach((r) => {
      map[r.category] = (map[r.category] ?? 0) + 1;
    });
    return map;
  }, [rows]);

  function handleExport() {
    exportToExcel(`store-reference-${activeTab.toLowerCase()}`, [
      {
        name: TABS.find((t) => t.value === activeTab)?.label ?? activeTab,
        rows: filteredRows.map((r) => ({
          "Store Name": r.store_name,
          Address: r.branch_address ?? "",
        })),
      },
    ]);
  }

  return (
    <RequireRole
      roles={[
        "ADMIN",
        "LOGISTICS_OFFICER",
        "JMD_PLANNER",
        "MONDIAL_TEAM",
        "LOGISTICS_ASSOCIATE",
        "GENERAL_MANAGER",
        "INVOICING_TEAM",
        "JMD_ADMIN",
      ]}
    >
      <div>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Store Reference</h1>
            <p className="text-sm text-gray-500">
              Store name and address on record per invoice category, for quick lookup.
            </p>
          </div>
          <button onClick={handleExport} className="btn-secondary">
            Export to Excel
          </button>
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          {TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setActiveTab(tab.value)}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === tab.value
                  ? "bg-brand-600 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {tab.label}
              <span className="ml-1.5 text-xs opacity-75">({counts[tab.value] ?? 0})</span>
            </button>
          ))}
        </div>

        <div className="card">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search store name or address..."
            className="input mb-4 max-w-sm"
          />

          {loading ? (
            <p className="text-sm text-gray-500">Loading...</p>
          ) : errorMsg ? (
            <p className="text-sm text-red-600">{errorMsg}</p>
          ) : filteredRows.length === 0 ? (
            <p className="text-sm text-gray-500">No stores found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead>
                  <tr className="text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                    <th className="py-2 pr-4">Store Name</th>
                    <th className="py-2 pr-4">Address</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredRows.map((r, i) => (
                    <tr key={`${r.store_name}-${r.branch_address}-${i}`}>
                      <td className="py-2 pr-4 font-medium text-gray-900">{r.store_name}</td>
                      <td className="py-2 pr-4 text-gray-600">{r.branch_address ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </RequireRole>
  );
}
