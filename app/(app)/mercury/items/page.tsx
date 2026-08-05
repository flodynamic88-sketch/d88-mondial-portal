"use client";

import { useEffect, useMemo, useState } from "react";
import CrudTable, { CrudColumn } from "@/components/mercury/MercuryCrudTable";
import { createClient } from "@/lib/mercury/supabase/client";
import type { Client, Item, LookupValue } from "@/lib/mercury/types";
import { useRole } from "@/lib/mercury/RoleContext";

const FALLBACK_UNITS = ["PC", "BOX", "PACK", "KG", "L", "SET", "ROLL", "CTN"];
const FALLBACK_CATEGORIES = ["Foods", "Beverages", "Consumables", "Equipment", "Spare Parts", "Others"];

export default function ItemsPage() {
  const role = useRole();
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClient, setSelectedClient] = useState<string>("");
  const [unitOptions, setUnitOptions] = useState<string[]>(FALLBACK_UNITS);
  const [categoryOptions, setCategoryOptions] = useState<string[]>(FALLBACK_CATEGORIES);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .schema("flo").from("clients")
      .select("*")
      .order("client_code")
      .then(({ data }) => setClients((data as Client[]) || []));

    // Pull Unit of Measure and Item Category choices from Settings (lookup_values)
    // so anything added there shows up here right away, instead of a fixed list.
    supabase
      .schema("flo").from("lookup_values")
      .select("*")
      .in("category", ["unit_of_measure", "item_category"])
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .then(({ data }) => {
        const rows = (data as LookupValue[]) || [];
        const units = rows.filter((r) => r.category === "unit_of_measure").map((r) => r.value);
        const categories = rows.filter((r) => r.category === "item_category").map((r) => r.value);
        if (units.length > 0) setUnitOptions(units);
        if (categories.length > 0) setCategoryOptions(categories);
      });
  }, []);

  const clientOptions = useMemo(
    () => clients.map((c) => ({ value: c.id, label: `${c.client_code} — ${c.client_name}` })),
    [clients]
  );

  const columns: CrudColumn<Item>[] = useMemo(
    () => [
      { key: "client_id", label: "Client", type: "fk", fkOptions: clientOptions },
      { key: "item_code", label: "Item Code", required: true },
      {
        key: "mercury_item_code",
        label: "Mercury Item Code",
      },
      { key: "item_description", label: "Item Description", required: true },
      {
        key: "category",
        label: "Category",
        type: "select",
        options: categoryOptions,
      },
      {
        key: "unit",
        label: "Unit",
        type: "select",
        options: unitOptions,
      },
      { key: "unit_price", label: "Unit Price (PHP, VAT-incl.)", type: "number", required: true },
      { key: "reorder_pt", label: "Reorder Pt.", type: "number", hideInTable: true },
      {
        key: "status",
        label: "Status",
        type: "select",
        options: ["Active", "Inactive"],
        required: true,
      },
      { key: "notes", label: "Notes", type: "textarea", hideInTable: true },
    ],
    [clientOptions, categoryOptions, unitOptions]
  );

  const emptyRow: Omit<Item, "id"> = {
    client_id: selectedClient || null,
    item_code: "",
    mercury_item_code: "",
    item_description: "",
    category: "",
    unit: "",
    unit_price: 0,
    reorder_pt: null,
    status: "Active",
    notes: "",
    current_stock: 0,
    created_at: "",
    updated_at: "",
  };

  return (
    <div className="space-y-4">
      <div className="card p-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="label">Client</label>
          <select
            className="input w-72"
            value={selectedClient}
            onChange={(e) => setSelectedClient(e.target.value)}
          >
            <option value="">— All Clients —</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.client_code} — {c.client_name}
              </option>
            ))}
          </select>
        </div>
        <p className="text-sm text-gray-500 pb-2">
          Different clients carry different items. Pick a client to see/manage only their item
          catalog, or leave on &quot;All Clients&quot; to see everything.
        </p>
      </div>

      <CrudTable<Item>
        key={selectedClient}
        tableName="items"
        title="Items"
        columns={columns}
        defaultOrder="item_code"
        emptyRow={emptyRow}
        searchPlaceholder="Search items…"
        filterColumn="client_id"
        filterValue={selectedClient || null}
        readOnly={role === "general_manager"}
        duplicateCheck={{ matchColumns: ["client_id", "item_description"], label: "item description sa client na ito" }}
      />
    </div>
  );
}
