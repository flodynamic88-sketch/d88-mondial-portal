"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import AutocompleteInput from "@/components/AutocompleteInput";
import RecentInvoicesTable from "@/components/RecentInvoicesTable";
import { findOrCreateBranchAddress, findOrCreateCompany } from "@/lib/invoiceHelpers";
import type { InvoiceCategory, ZoneType } from "@/types/database";

interface InvoiceFormProps {
  category: InvoiceCategory;
}

interface FormState {
  documentNo: string;
  zone: ZoneType | "";
  isDc: boolean;
  companyName: string;
  companyId: string | null;
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

const EMPTY_FORM: FormState = {
  documentNo: "",
  zone: "",
  isDc: false,
  companyName: "",
  companyId: null,
  branchAddress: "",
  amount: "",
  planDate: "",
  postingDate: "",
  transmittalReceivedDate: "",
  billingPeriod: "",
  remarks: "",
};

export default function InvoiceForm({ category }: InvoiceFormProps) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<
    { type: "success" | "error"; message: string } | null
  >(null);
  const [refreshKey, setRefreshKey] = useState(0);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);

    if (!form.documentNo.trim() || !form.zone || !form.amount) {
      setFeedback({
        type: "error",
        message: "Document No., Zone, and Amount are required.",
      });
      return;
    }

    const amountNumber = Number(form.amount);
    if (Number.isNaN(amountNumber)) {
      setFeedback({ type: "error", message: "Amount must be a valid number." });
      return;
    }

    setSubmitting(true);
    try {
      // Resolve/create company + branch address reference rows so future
      // autocomplete stays consistent.
      const companyId =
        form.companyId ?? (await findOrCreateCompany(form.companyName));

      if (form.branchAddress.trim()) {
        await findOrCreateBranchAddress(form.branchAddress, companyId);
      }

      const supabase = createClient();
      const { error } = await supabase.from("invoices").insert({
        document_no: form.documentNo.trim(),
        category,
        zone: form.zone,
        is_dc: form.isDc,
        company_id: companyId,
        company_name_raw: form.companyName.trim() || null,
        branch_address: form.branchAddress.trim() || null,
        amount: amountNumber,
        plan_date: form.planDate || null,
        posting_date: form.postingDate || null,
        transmittal_received_date: form.transmittalReceivedDate || null,
        billing_period: form.billingPeriod || null,
        remarks: form.remarks.trim() || null,
      });

      if (error) {
        setFeedback({ type: "error", message: `Failed to save invoice: ${error.message}` });
      } else {
        setFeedback({ type: "success", message: `Invoice ${form.documentNo} encoded successfully.` });
        setForm(EMPTY_FORM);
        setRefreshKey((k) => k + 1);
      }
    } catch (err) {
      setFeedback({
        type: "error",
        message:
          "Could not save invoice. Make sure a Supabase project is connected (see .env.local.example).",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <form onSubmit={handleSubmit} className="card space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="documentNo" className="label">
              Document No. <span className="text-red-500">*</span>
            </label>
            <input
              id="documentNo"
              type="text"
              className="input"
              value={form.documentNo}
              onChange={(e) => update("documentNo", e.target.value)}
              required
            />
          </div>

          <div>
            <label htmlFor="zone" className="label">
              Zone <span className="text-red-500">*</span>
            </label>
            <select
              id="zone"
              className="input"
              value={form.zone}
              onChange={(e) => update("zone", e.target.value as ZoneType)}
              required
            >
              <option value="" disabled>
                Select zone
              </option>
              {ZONE_OPTIONS.map((z) => (
                <option key={z.value} value={z.value}>
                  {z.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2 pt-6">
            <input
              id="isDc"
              type="checkbox"
              checked={form.isDc}
              onChange={(e) => update("isDc", e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
            />
            <label htmlFor="isDc" className="text-sm font-medium text-gray-700">
              DC (Distribution Center) rate
            </label>
          </div>

          <div>
            <label htmlFor="amount" className="label">
              Amount <span className="text-red-500">*</span>
            </label>
            <input
              id="amount"
              type="number"
              step="0.01"
              min="0"
              className="input"
              value={form.amount}
              onChange={(e) => update("amount", e.target.value)}
              required
            />
          </div>

          <AutocompleteInput
            id="companyName"
            label="Company / Retail Chain / Account"
            placeholder="e.g. Mercury Drug Corporation"
            value={form.companyName}
            onTextChange={(text) => {
              update("companyName", text);
              update("companyId", null);
            }}
            onSelect={(s) => {
              update("companyName", s.text);
              update("companyId", s.id);
            }}
            table="companies"
            column="name"
          />

          <AutocompleteInput
            id="branchAddress"
            label="Branch / Store Address"
            placeholder="e.g. Unit 1, EDSA cor. ..."
            value={form.branchAddress}
            onTextChange={(text) => update("branchAddress", text)}
            onSelect={(s) => update("branchAddress", s.text)}
            table="branch_addresses"
            column="address"
          />

          <div>
            <label htmlFor="planDate" className="label">
              Plan Date
            </label>
            <input
              id="planDate"
              type="date"
              className="input"
              value={form.planDate}
              onChange={(e) => update("planDate", e.target.value)}
            />
          </div>

          <div>
            <label htmlFor="postingDate" className="label">
              Posting Date
            </label>
            <input
              id="postingDate"
              type="date"
              className="input"
              value={form.postingDate}
              onChange={(e) => update("postingDate", e.target.value)}
            />
          </div>

          <div>
            <label htmlFor="transmittalReceivedDate" className="label">
              Transmittal Received Date
            </label>
            <input
              id="transmittalReceivedDate"
              type="date"
              className="input"
              value={form.transmittalReceivedDate}
              onChange={(e) => update("transmittalReceivedDate", e.target.value)}
            />
          </div>

          <div>
            <label htmlFor="billingPeriod" className="label">
              Billing Period
            </label>
            <input
              id="billingPeriod"
              type="date"
              className="input"
              value={form.billingPeriod}
              onChange={(e) => update("billingPeriod", e.target.value)}
            />
          </div>
        </div>

        <div>
          <label htmlFor="remarks" className="label">
            Remarks
          </label>
          <textarea
            id="remarks"
            className="input"
            rows={3}
            value={form.remarks}
            onChange={(e) => update("remarks", e.target.value)}
          />
        </div>

        {feedback && (
          <p
            className={`text-sm ${
              feedback.type === "success" ? "text-green-600" : "text-red-600"
            }`}
          >
            {feedback.message}
          </p>
        )}

        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting ? "Saving…" : "Save Invoice"}
        </button>
      </form>

      <RecentInvoicesTable category={category} refreshKey={refreshKey} />
    </div>
  );
}
