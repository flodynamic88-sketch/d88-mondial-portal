"use client";

import { useState } from "react";
import InvoiceForm from "@/components/InvoiceForm";
import BulkEncodeGrid from "@/components/BulkEncodeGrid";
import RecentInvoicesTable from "@/components/RecentInvoicesTable";
import type { InvoiceCategory } from "@/types/database";

const TABS: { value: InvoiceCategory; label: string }[] = [
  { value: "CONSIGNMENT", label: "Consignment" },
  { value: "OUTRIGHT", label: "Outright" },
  { value: "MERCURY_DRUG", label: "Mercury Drug" },
];

type EntryMode = "grid" | "single";

export default function EncodeInvoicesPage() {
  const [activeTab, setActiveTab] = useState<InvoiceCategory>("CONSIGNMENT");
  const [mode, setMode] = useState<EntryMode>("grid");
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-800">Encode Invoices</h1>
      <p className="mt-1 text-sm text-gray-500">
        Add new invoices by category. Company and branch/store fields
        autocomplete against previously encoded records.
      </p>

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
        </div>
      </div>

      <div className="mt-6">
        {/* Remount per tab so field state doesn't leak across categories */}
        {mode === "grid" ? (
          <>
            <BulkEncodeGrid
              key={activeTab}
              category={activeTab}
              onSaved={() => setRefreshKey((k) => k + 1)}
            />
            <RecentInvoicesTable category={activeTab} refreshKey={refreshKey} />
          </>
        ) : (
          <InvoiceForm key={activeTab} category={activeTab} />
        )}
      </div>
    </div>
  );
}
