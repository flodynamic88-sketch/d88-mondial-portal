"use client";

import { useState } from "react";
import InvoiceForm from "@/components/InvoiceForm";
import BulkEncodeGrid from "@/components/BulkEncodeGrid";
import ImportInvoicesExcel from "@/components/ImportInvoicesExcel";
import RecentInvoicesTable from "@/components/RecentInvoicesTable";
import RequireRole from "@/components/RequireRole";
import { useAuth } from "@/components/AuthProvider";
import type { InvoiceCategory } from "@/types/database";

const TABS: { value: InvoiceCategory; label: string }[] = [
  { value: "CONSIGNMENT", label: "Consignment" },
  { value: "OUTRIGHT", label: "Outright" },
  { value: "MERCURY_DRUG", label: "Mercury Drug" },
];

type EntryMode = "grid" | "single";

export default function EncodeInvoicesPage() {
  const profile = useAuth();
  // JMD Planner can review Encode Invoices but not add or edit anything --
  // matches invoices insert/update/delete RLS (ADMIN/LOGISTICS_OFFICER only).
  const canEdit = profile?.role === "ADMIN" || profile?.role === "LOGISTICS_OFFICER";

  const [activeTab, setActiveTab] = useState<InvoiceCategory>("CONSIGNMENT");
  const [mode, setMode] = useState<EntryMode>("grid");
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <RequireRole roles={["ADMIN", "LOGISTICS_OFFICER", "JMD_PLANNER"]}>
    <div>
      <div className="page-header border-b-0 pb-0">
        <div>
          <h1 className="page-title">Encode Invoices</h1>
          <p className="page-subtitle">
            {canEdit
              ? "Add new invoices by category. Company and branch/store fields autocomplete against previously encoded records."
              : "View-only access — review recently encoded invoices below."}
          </p>
        </div>
      </div>

      {canEdit && (
        <>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 pb-2">
            <div className="flex gap-2">
              {TABS.map((tab) => (
                <button
                  key={tab.value}
                  type="button"
                  onClick={() => setActiveTab(tab.value)}
                  className={`tab-button ${
                    activeTab === tab.value ? "tab-button-active" : "tab-button-inactive"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setMode("grid")}
                className={`tab-button ${mode === "grid" ? "tab-button-active" : "tab-button-inactive"}`}
              >
                Grid Entry
              </button>
              <button
                type="button"
                onClick={() => setMode("single")}
                className={`tab-button ${mode === "single" ? "tab-button-active" : "tab-button-inactive"}`}
              >
                Single Entry
              </button>
              {/* Consignment-only for now -- the Excel format this reads
                  (No./Posting Date/Transfer-to Name/Transfer-to Address/Total
                  Amount) is JMD's Consignment delivery export layout. */}
              {activeTab === "CONSIGNMENT" && (
                <ImportInvoicesExcel
                  category={activeTab}
                  onImported={() => setRefreshKey((k) => k + 1)}
                />
              )}
            </div>
          </div>

          <div className="mt-6">
            {/* Remount per tab so field state doesn't leak across categories */}
            {mode === "grid" ? (
              <BulkEncodeGrid
                key={activeTab}
                category={activeTab}
                onSaved={() => setRefreshKey((k) => k + 1)}
              />
            ) : (
              <InvoiceForm
                key={activeTab}
                category={activeTab}
                onSaved={() => setRefreshKey((k) => k + 1)}
              />
            )}
          </div>
        </>
      )}

      {/* Has its own category tabs, independent of the entry tab above, so
          any category's recently encoded invoices can be reviewed/edited
          without switching what's being encoded up top. */}
      <RecentInvoicesTable refreshKey={refreshKey} readOnly={!canEdit} />
    </div>
    </RequireRole>
  );
}
