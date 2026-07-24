"use client";

import { useState } from "react";
import InvoiceForm from "@/components/InvoiceForm";
import type { InvoiceCategory } from "@/types/database";

const TABS: { value: InvoiceCategory; label: string }[] = [
  { value: "CONSIGNMENT", label: "Consignment" },
  { value: "OUTRIGHT", label: "Outright" },
  { value: "MERCURY_DRUG", label: "Mercury Drug" },
];

export default function EncodeInvoicesPage() {
  const [activeTab, setActiveTab] = useState<InvoiceCategory>("CONSIGNMENT");

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-800">Encode Invoices</h1>
      <p className="mt-1 text-sm text-gray-500">
        Add new invoices by category. Company and branch/store fields
        autocomplete against previously encoded records.
      </p>

      <div className="mt-6 flex gap-2 border-b border-gray-200 pb-2">
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

      <div className="mt-6">
        {/* Remount the form per tab so field state doesn't leak across categories */}
        <InvoiceForm key={activeTab} category={activeTab} />
      </div>
    </div>
  );
}
