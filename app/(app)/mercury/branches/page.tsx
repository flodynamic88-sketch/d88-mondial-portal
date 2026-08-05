"use client";

import CrudTable, { CrudColumn } from "@/components/mercury/MercuryCrudTable";
import type { Branch } from "@/lib/mercury/types";
import { useRole } from "@/lib/mercury/RoleContext";
import { createClient } from "@/lib/mercury/supabase/client";

// Registered Name / TIN / Registered Business Address are buyer head-office
// details that are normally IDENTICAL for every branch of the same retail
// chain (e.g. every Mercury Drug branch shares the same TIN and business
// address — only the branch name/delivery address differ). So the moment
// any one of these 3 fields is filled in for a branch, automatically copy it
// to every OTHER branch of that same Retail Chain that doesn't have that
// field filled in yet — that's what makes it show up correctly on those
// branches' invoices too without re-typing it branch by branch. This only
// ever fills in blanks; it never overwrites a value someone already entered
// on another branch (in case one branch really is registered differently).
async function propagateBillingInfoToChain(payload: Record<string, unknown>) {
  const retailChain = payload.retail_chain as string | undefined | null;
  if (!retailChain) return;

  const fields = ["registered_name", "tin", "registered_business_address"] as const;
  const supabase = createClient();

  for (const field of fields) {
    const value = payload[field];
    if (!value) continue;
    await supabase
      .schema("flo").from("branches")
      .update({ [field]: value })
      .eq("retail_chain", retailChain)
      .is(field, null);
  }
}

const columns: CrudColumn<Branch>[] = [
  { key: "branch_code", label: "Branch Code", required: true },
  {
    key: "retail_chain",
    label: "Retail Chain",
    type: "select",
    options: [
      "Mercury Drug",
      "Watsons",
      "South Star Drug",
      "Rose Pharmacy",
      "Generika Drugstore",
      "TGP (The Generics Pharmacy)",
      "SM Hypermarket",
      "SM Supermarket",
      "SM Savemore",
      "Robinsons Supermarket",
      "Puregold",
      "Shopwise",
      "Rustans",
      "WalterMart",
      "Gaisano",
      "Direct / Non-Chain",
      "Others",
    ],
  },
  { key: "branch_name", label: "Branch Name", required: true },
  { key: "delivery_address", label: "Delivery Address" },
  {
    key: "registered_name",
    label: "Registered Name (for invoice Sold To)",
    hideInTable: true,
  },
  { key: "tin", label: "TIN (for invoice)", hideInTable: true },
  {
    key: "registered_business_address",
    label: "Registered Business Address (for invoice)",
    hideInTable: true,
  },
  { key: "region", label: "Region" },
  { key: "province", label: "Province", hideInTable: true },
  { key: "city_municipality", label: "City / Municipality", hideInTable: true },
  { key: "barangay", label: "Barangay", hideInTable: true },
  { key: "contact_person", label: "Contact Person", hideInTable: true },
  { key: "contact_no", label: "Contact No.", hideInTable: true },
  { key: "email", label: "Email", hideInTable: true },
  { key: "receiving_hours", label: "Receiving Hours", hideInTable: true },
  { key: "cutoff_time", label: "Cut-off Time", hideInTable: true },
  {
    key: "max_truck_size",
    label: "Max Truck Size",
    type: "select",
    options: ["L300 Van", "Elf 4-Wheeler", "6-Wheeler", "10-Wheeler"],
    hideInTable: true,
  },
  {
    key: "status",
    label: "Status",
    type: "select",
    options: ["Active", "Inactive"],
    required: true,
  },
  { key: "notes", label: "Notes", type: "textarea", hideInTable: true },
];

const emptyRow: Omit<Branch, "id"> = {
  branch_code: "",
  retail_chain: "Mercury Drug",
  branch_name: "",
  delivery_address: "",
  registered_name: "",
  tin: "",
  registered_business_address: "",
  region: "",
  province: "",
  city_municipality: "",
  barangay: "",
  contact_person: "",
  contact_no: "",
  email: "",
  receiving_hours: "",
  cutoff_time: "",
  max_truck_size: "",
  status: "Active",
  notes: "",
  created_at: "",
  updated_at: "",
};

export default function BranchesPage() {
  const role = useRole();
  return (
    <CrudTable<Branch>
      tableName="branches"
      title="Branches"
      columns={columns}
      defaultOrder="branch_code"
      emptyRow={emptyRow}
      searchPlaceholder="Search branches…"
      readOnly={role === "general_manager"}
      onAfterSave={propagateBillingInfoToChain}
    />
  );
}
