"use client";

import { useEffect, useMemo, useState } from "react";
import CrudTable, { CrudColumn } from "@/components/mercury/MercuryCrudTable";
import { createClient } from "@/lib/mercury/supabase/client";
import type { Client, LookupValue } from "@/lib/mercury/types";
import { DEFAULT_INVOICE_TEMPLATE, INVOICE_TEMPLATE_OPTIONS } from "@/lib/mercury/invoiceTemplates";
import { useRole } from "@/lib/mercury/RoleContext";

const FALLBACK_PAYMENT_TERMS = ["COD", "7 Days", "15 Days", "30 Days", "45 Days", "60 Days"];

const emptyRow: Omit<Client, "id"> = {
  client_code: "",
  client_name: "",
  vendor_code: "",
  contact_person: "",
  contact_no: "",
  email: "",
  delivery_address: "",
  billing_address: "",
  payment_terms: "",
  credit_limit: null,
  service_rate: null,
  status: "Active",
  date_onboarded: null,
  invoice_template: DEFAULT_INVOICE_TEMPLATE,
  manages_inventory: false,
  invoice_booklet_start: null,
  invoice_booklet_size: 50,
  created_at: "",
  updated_at: "",
};

export default function ClientsPage() {
  const role = useRole();
  const [paymentTermsOptions, setPaymentTermsOptions] = useState<string[]>(FALLBACK_PAYMENT_TERMS);

  useEffect(() => {
    const supabase = createClient();
    // Pull Payment Terms choices from Settings (lookup_values) instead of a
    // list hardcoded here, so anything added/edited there — e.g. renaming
    // "Net 15" to "15 Days" — shows up immediately, without needing a code
    // change every time (same fix already applied to Items' Unit/Category).
    supabase
      .schema("flo").from("lookup_values")
      .select("*")
      .eq("category", "payment_terms")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .then(({ data }) => {
        const rows = (data as LookupValue[]) || [];
        const terms = rows.map((r) => r.value);
        if (terms.length > 0) setPaymentTermsOptions(terms);
      });
  }, []);

  const columns: CrudColumn<Client>[] = useMemo(
    () => [
      { key: "client_code", label: "Client Code", required: true },
      { key: "client_name", label: "Client Name", required: true },
      { key: "vendor_code", label: "Vendor Code" },
      { key: "contact_person", label: "Contact Person" },
      { key: "contact_no", label: "Contact No." },
      { key: "email", label: "Email" },
      { key: "delivery_address", label: "Delivery Address", hideInTable: true },
      { key: "billing_address", label: "Billing Address", hideInTable: true },
      {
        key: "payment_terms",
        label: "Payment Terms",
        type: "select",
        options: paymentTermsOptions,
      },
      { key: "credit_limit", label: "Credit Limit", type: "number" },
      { key: "service_rate", label: "Service Rate (%)", type: "number" },
      {
        key: "status",
        label: "Status",
        type: "select",
        options: ["Active", "Inactive"],
        required: true,
      },
      { key: "date_onboarded", label: "Date Onboarded", type: "date" },
      {
        key: "invoice_template",
        label: "Invoice Format",
        type: "fk",
        fkOptions: INVOICE_TEMPLATE_OPTIONS,
        required: true,
      },
      {
        key: "manages_inventory",
        label: "Manages Inventory",
        type: "boolean",
      },
    ],
    [paymentTermsOptions]
  );

  return (
    <CrudTable<Client>
      tableName="clients"
      title="Clients"
      columns={columns}
      defaultOrder="client_code"
      emptyRow={emptyRow}
      searchPlaceholder="Search clients…"
      readOnly={role === "general_manager"}
      autoCode={{ column: "client_code", prefix: "C-", padLength: 4 }}
    />
  );
}
