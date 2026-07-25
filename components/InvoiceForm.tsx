"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import AutocompleteInput from "@/components/AutocompleteInput";
import { findOrCreateBranchAddress, findOrCreateCompany } from "@/lib/invoiceHelpers";
import { monthValueToDate } from "@/lib/dateHelpers";
import type { InvoiceCategory } from "@/types/database";

interface InvoiceFormProps {
  category: InvoiceCategory;
  onSaved?: () => void;
}

interface FormState {
  documentNo: string;
  companyName: string;
  companyId: string | null;
  branchAddress: string;
  amount: string;
  postingDate: string;
  billingPeriod: string;
  remarks: string;
}

const EMPTY_FORM: FormState = {
  documentNo: "",
  companyName: "",
  companyId: null,
  branchAddress: "",
  amount: "",
  postingDate: "",
  billingPeriod: "",
  remarks: "",
};

export default function InvoiceForm({ category, onSaved }: InvoiceFormProps) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<
    { type: "success" | "error"; message: string } | null
  >(null);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);

    if (!form.documentNo.trim() || !form.amount) {
      setFeedback({
        type: "error",
        message: "Document No. and Amount are required.",
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
      // Zone, DC, Plan Date, and Transmittal Date are filled in later, from
      // Recently Encoded, once the invoice is being scheduled for delivery.
      const { error } = await supabase.from("invoices").insert({
        document_no: form.documentNo.trim(),
        category,
        zone: null,
        is_dc: false,
        company_id: companyId,
        company_name_raw: form.companyName.trim() || null,
        branch_address: form.branchAddress.trim() || null,
        amount: amountNumber,
        plan_date: null,
        posting_date: form.postingDate || null,
        transmittal_received_date: null,
        billing_period: monthValueToDate(form.billingPeriod),
        remarks: form.remarks.trim() || null,
      });

      if (error) {
        setFeedback({ type: "error", message: `Failed to save invoice: ${error.message}` });
      } else {
        setFeedback({ type: "success", message: `Invoice ${form.documentNo} encoded successfully.` });
        setForm(EMPTY_FORM);
        onSaved?.();
      }
    } catch {
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
          label="Retail Chain / Account"
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
          <label htmlFor="billingPeriod" className="label">
            Month
          </label>
          <input
            id="billingPeriod"
            type="month"
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
  );
}
