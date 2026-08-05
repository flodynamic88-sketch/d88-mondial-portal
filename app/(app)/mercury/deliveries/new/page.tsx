"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/mercury/supabase/client";
import type { Branch, Client, ClientBranchLink, Item, LookupValue, PurchaseOrder } from "@/lib/mercury/types";
import { useRole } from "@/lib/mercury/RoleContext";

interface LineRow {
  key: string;
  item_id: string;
  item_description: string;
  unit_price: number;
  qty: number;
  expiration_date: string;
}

function newLine(): LineRow {
  return {
    key: Math.random().toString(36).slice(2),
    item_id: "",
    item_description: "",
    unit_price: 0,
    qty: 1,
    expiration_date: "",
  };
}

export default function NewDeliveryPage() {
  const router = useRouter();
  const role = useRole();

  useEffect(() => {
    if (role === "general_manager") {
      router.replace("/mercury/deliveries");
    }
  }, [role, router]);

  const [clients, setClients] = useState<Client[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [links, setLinks] = useState<ClientBranchLink[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [lookups, setLookups] = useState<LookupValue[]>([]);
  const [openPos, setOpenPos] = useState<PurchaseOrder[]>([]);
  const [loadPoId, setLoadPoId] = useState("");
  const [poId, setPoId] = useState<string | null>(null);

  const [clientId, setClientId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [poNumber, setPoNumber] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [postingDate, setPostingDate] = useState("");
  const [dateOfDelivery, setDateOfDelivery] = useState("");
  // Per-delivery service rate override — e.g. HWL charges 13% for NCR
  // branches vs 17% for Far North / Far South, which a single flat
  // service_rate on the Client record can't express. Blank = keep using
  // the client's own default rate (unchanged behavior for every other client).
  const [serviceRateOverride, setServiceRateOverride] = useState("");
  // New deliveries always start as Pending — status can only change later via
  // an actual UPDATE (delivery detail page), which is what the stock
  // deduction trigger listens for. Letting this be picked at creation time
  // (a plain INSERT) let staff choose "In-Transit" straight away, silently
  // skipping stock deduction entirely — see the Adesteck inventory bug.
  const status = "Pending";
  const [priority, setPriority] = useState("Normal");
  const [remarks, setRemarks] = useState("");
  const [truckCarrier, setTruckCarrier] = useState("");

  const [lines, setLines] = useState<LineRow[]>([newLine()]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 2026-07-13: FEFO auto-fill — for clients with Manages Inventory enabled,
  // Expiration Date no longer needs to be typed in manually. This maps
  // item_id -> soonest-expiring warehouse batch currently in stock
  // (qty_remaining > 0), mirroring the same preview query already used on
  // the Delivery detail page. Still fully editable afterward — this is just
  // a starting value, not a lock.
  const [previewExpiry, setPreviewExpiry] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    const supabase = createClient();
    async function load() {
      const [clientsRes, branchesRes, linksRes, itemsRes, lookupsRes, posRes] = await Promise.all([
        supabase.schema("flo").from("clients").select("*").eq("status", "Active").order("client_code").range(0, 9999),
        supabase.schema("flo").from("branches").select("*").order("branch_code").range(0, 9999),
        supabase.schema("flo").from("client_branch_links").select("*").range(0, 9999),
        supabase.schema("flo").from("items").select("*").eq("status", "Active").order("item_code").range(0, 9999),
        supabase
          .schema("flo").from("lookup_values")
          .select("*")
          .in("category", ["delivery_status", "priority_level", "carrier_truck"])
          .eq("is_active", true)
          .order("sort_order"),
        supabase.schema("flo").from("purchase_orders").select("*").eq("status", "Open").order("po_number"),
      ]);
      const firstError = [clientsRes, branchesRes, linksRes, itemsRes, lookupsRes, posRes].find(
        (r) => r.error
      )?.error;
      if (firstError) setError(firstError.message);
      setClients((clientsRes.data as Client[]) || []);
      setBranches((branchesRes.data as Branch[]) || []);
      setLinks((linksRes.data as ClientBranchLink[]) || []);
      setItems((itemsRes.data as Item[]) || []);
      setLookups((lookupsRes.data as LookupValue[]) || []);
      setOpenPos((posRes.data as PurchaseOrder[]) || []);
    }
    load();

    // Refetch master data (clients/branches/client-branch links/items) any
    // time this tab regains focus. This page only fetches once on mount, so
    // if you add a Branch or a Client-Branch Link on another tab/page while
    // this "New Delivery" tab is still open, it would otherwise keep using
    // its stale in-memory list and the new branch/item would seem to be
    // "missing" from the dropdowns until a manual refresh.
    function handleFocus() {
      load();
    }
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, []);

  const availableBranches = useMemo(() => {
    if (!clientId) return [];
    const branchIds = new Set(links.filter((l) => l.client_id === clientId).map((l) => l.branch_id));
    return branches.filter((b) => branchIds.has(b.id));
  }, [clientId, links, branches]);

  // Items are scoped per client — show this client's items plus any
  // unassigned (client_id = null) legacy items so nothing disappears
  // for items that haven't been assigned to a client yet.
  const availableItems = useMemo(() => {
    if (!clientId) return items;
    return items.filter((i) => i.client_id === clientId || !i.client_id);
  }, [clientId, items]);

  const selectedBranch = useMemo(
    () => branches.find((b) => b.id === branchId) || null,
    [branchId, branches]
  );

  const selectedClient = useMemo(
    () => clients.find((c) => c.id === clientId) || null,
    [clientId, clients]
  );

  // 2026-07-13: fetch the FEFO preview map whenever the selected client
  // changes — only clients with manages_inventory=true have tracked
  // warehouse batches/expiration dates to draw from, so other clients keep
  // an empty map (Expiration Date stays fully manual for them, same as
  // before).
  useEffect(() => {
    if (!selectedClient?.manages_inventory || availableItems.length === 0) {
      setPreviewExpiry(new Map());
      return;
    }
    const itemIds = Array.from(new Set(availableItems.map((i) => i.id)));
    const supabase = createClient();
    supabase
      .schema("flo").from("stock_receipt_lines")
      .select("item_id, expiration_date, qty_remaining")
      .in("item_id", itemIds)
      .gt("qty_remaining", 0)
      .not("expiration_date", "is", null)
      .order("expiration_date", { ascending: true })
      .then(({ data }) => {
        const preview = new Map<string, string>();
        if (data) {
          for (const r of data as { item_id: string; expiration_date: string }[]) {
            if (!preview.has(r.item_id)) preview.set(r.item_id, r.expiration_date);
          }
        }
        setPreviewExpiry(preview);
      });
  }, [selectedClient, availableItems]);

  // 2026-07-13: whenever the FEFO preview map updates (client selected, or
  // items loaded/changed), auto-fill Expiration Date for any line that
  // already has an item picked but no expiration_date yet — covers both
  // manually-added lines and lines loaded via "Load from Purchase Order".
  // Never overwrites a value the encoder already typed/edited.
  useEffect(() => {
    if (previewExpiry.size === 0) return;
    setLines((prev) =>
      prev.map((l) =>
        !l.expiration_date && l.item_id && previewExpiry.has(l.item_id)
          ? { ...l, expiration_date: previewExpiry.get(l.item_id)! }
          : l
      )
    );
  }, [previewExpiry]);

  const priorityOptions = lookups.filter((l) => l.category === "priority_level");
  const carrierOptions = lookups.filter((l) => l.category === "carrier_truck");

  function handleClientChange(newClientId: string) {
    setClientId(newClientId);
    setBranchId("");
  }

  async function handleLoadFromPo(selectedId: string) {
    setLoadPoId(selectedId);
    if (!selectedId) return;

    const supabase = createClient();
    const { data: poLines, error: poLinesErr } = await supabase
      .schema("flo").from("po_lines")
      .select("*")
      .eq("po_id", selectedId)
      .order("created_at");

    const po = openPos.find((p) => p.id === selectedId);
    if (!po) return;

    if (poLinesErr) {
      setError(poLinesErr.message);
      return;
    }

    setPoId(po.id);
    setPoNumber(po.po_number);
    setClientId(po.client_id || "");
    setBranchId(po.branch_id || "");

    const loadedLines = (poLines || []).map((l) => ({
      key: Math.random().toString(36).slice(2),
      item_id: l.item_id || "",
      item_description: l.item_description,
      unit_price: l.unit_price,
      qty: l.qty,
      expiration_date: "",
    }));
    setLines(loadedLines.length > 0 ? loadedLines : [newLine()]);
  }

  function updateLine(key: string, patch: Partial<LineRow>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function handleItemSelect(key: string, itemId: string) {
    const item = availableItems.find((i) => i.id === itemId);
    // 2026-07-13: auto-fill Expiration Date right away from the FEFO
    // preview map (soonest-expiring in-stock batch) if this item's client
    // manages inventory and a batch is available — still just a starting
    // value, the date input right below stays fully editable.
    updateLine(key, {
      item_id: itemId,
      item_description: item?.item_description || "",
      unit_price: item?.unit_price || 0,
      expiration_date: previewExpiry.get(itemId) || "",
    });
  }

  function addLine() {
    setLines((prev) => [...prev, newLine()]);
  }

  function removeLine(key: string) {
    setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.key !== key) : prev));
  }

  const grandTotal = useMemo(
    () => lines.reduce((sum, l) => sum + l.qty * l.unit_price, 0),
    [lines]
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!clientId || !branchId) {
      setError("Please select a client and a branch.");
      return;
    }
    if (lines.some((l) => !l.item_id)) {
      setError("Please select an item for every line.");
      return;
    }

    setSaving(true);
    const supabase = createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (invoiceNumber.trim()) {
      const { data: dupInvoices } = await supabase
        .schema("flo").from("delivery_headers")
        .select("id")
        .eq("client_id", clientId)
        .ilike("invoice_number", invoiceNumber.trim())
        .limit(1);
      if (dupInvoices && dupInvoices.length > 0) {
        const proceed = confirm(
          `May existing delivery na sa client na ito na may Invoice # "${invoiceNumber.trim()}". Sigurado ka bang gusto mo pa ring i-save ito?`
        );
        if (!proceed) {
          setSaving(false);
          return;
        }
      }
    }

    const { data: header, error: headerErr } = await supabase
      .schema("flo").from("delivery_headers")
      .insert({
        po_number: poNumber || null,
        po_id: poId,
        invoice_number: invoiceNumber || null,
        invoice_date: invoiceDate || null,
        client_id: clientId,
        branch_id: branchId,
        posting_date: postingDate || null,
        date_of_delivery: dateOfDelivery || null,
        status,
        priority,
        service_rate_override: serviceRateOverride === "" ? null : Number(serviceRateOverride),
        remarks: remarks || null,
        truck_carrier: truckCarrier || null,
        created_by: user?.id || null,
      })
      .select()
      .single();

    if (headerErr || !header) {
      setError(headerErr?.message || "Failed to create delivery header.");
      setSaving(false);
      return;
    }

    const lineInserts = lines.map((l) => ({
      delivery_header_id: header.id,
      item_id: l.item_id,
      item_description: l.item_description,
      qty: l.qty,
      unit_price: l.unit_price,
      qty_delivered: 0,
      qty_returned: 0,
      expiration_date: l.expiration_date || null,
    }));

    const { error: linesErr } = await supabase.schema("flo").from("delivery_lines").insert(lineInserts);

    if (linesErr) {
      setSaving(false);
      setError(linesErr.message);
      return;
    }

    // Close the loop: mark the source P.O. as Used now that it has been
    // encoded into a Delivery, so it can't be loaded/used again.
    if (poId) {
      await supabase.schema("flo").from("purchase_orders").update({ status: "Used" }).eq("id", poId);
    }

    setSaving(false);
    router.push(`/mercury/deliveries/${header.id}`);
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">New Delivery</h1>
        <p className="text-sm text-gray-500">Encode a new delivery invoice and its line items.</p>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {openPos.length > 0 && (
        <div className="card p-5 space-y-3 border-brand/30">
          <h2 className="text-sm font-semibold text-gray-700">Load from Purchase Order</h2>
          <p className="text-xs text-gray-500">
            Optional — pick a client&apos;s Open P.O. to auto-fill the client, branch, P.O. #, and
            line items below. The P.O. will be marked &quot;Used&quot; once this delivery is saved.
          </p>
          <select
            className="input max-w-md"
            value={loadPoId}
            onChange={(e) => handleLoadFromPo(e.target.value)}
          >
            <option value="">— None (encode manually) —</option>
            {openPos.map((po) => {
              const client = clients.find((c) => c.id === po.client_id);
              return (
                <option key={po.id} value={po.id}>
                  {po.po_number} {client ? `— ${client.client_code} ${client.client_name}` : ""}
                </option>
              );
            })}
          </select>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="card p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-700">Client &amp; Branch</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="label">
                Client <span className="text-red-500">*</span>
              </label>
              <select
                className="input"
                value={clientId}
                onChange={(e) => handleClientChange(e.target.value)}
                required
              >
                <option value="">— Select Client —</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.client_code} — {c.client_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">
                Branch <span className="text-red-500">*</span>
              </label>
              <select
                className="input"
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
                required
                disabled={!clientId}
              >
                <option value="">
                  {clientId ? "— Select Branch —" : "Select a client first"}
                </option>
                {availableBranches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.branch_code} — {b.branch_name}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="label">Delivery Address</label>
              <input
                className="input bg-gray-50"
                value={selectedBranch?.delivery_address || ""}
                readOnly
              />
            </div>
          </div>
        </div>

        <div className="card p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-700">Invoice Details</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="label">PO #</label>
              <input className="input" value={poNumber} onChange={(e) => setPoNumber(e.target.value)} />
            </div>
            <div>
              <label className="label">Invoice #</label>
              <input
                className="input"
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
              />
            </div>
            <div>
              <label className="label">Invoice Date</label>
              <input
                type="date"
                className="input"
                value={invoiceDate}
                onChange={(e) => setInvoiceDate(e.target.value)}
              />
            </div>
            <div>
              <label className="label">Posting Date</label>
              <input
                type="date"
                className="input"
                value={postingDate}
                onChange={(e) => setPostingDate(e.target.value)}
              />
            </div>
            <div>
              <label className="label">Date of Delivery</label>
              <input
                type="date"
                className="input"
                value={dateOfDelivery}
                onChange={(e) => setDateOfDelivery(e.target.value)}
              />
            </div>
            <div>
              <label className="label">Status</label>
              <input className="input bg-gray-50 text-gray-500" value="Pending" disabled readOnly />
              <p className="mt-1 text-xs text-gray-400">
                New deliveries always start as Pending. Change the status later from the delivery&apos;s
                detail page — that&apos;s what triggers stock deduction when it moves to In-Transit.
              </p>
            </div>
            <div>
              <label className="label">Service Rate Override (%)</label>
              <select
                className="input"
                value={serviceRateOverride}
                onChange={(e) => setServiceRateOverride(e.target.value)}
              >
                <option value="">
                  Use client default{selectedClient?.service_rate != null ? ` (${selectedClient.service_rate}%)` : ""}
                </option>
                <option value="13">13% (NCR)</option>
                <option value="17">17% (Far North / Far South)</option>
              </select>
              <p className="mt-1 text-xs text-gray-400">
                For clients like HWL with different rates per zone. Leave as client default unless this
                specific delivery needs a different rate.
              </p>
            </div>
            <div>
              <label className="label">Priority</label>
              <select className="input" value={priority} onChange={(e) => setPriority(e.target.value)}>
                {priorityOptions.length === 0 && <option value="Normal">Normal</option>}
                {priorityOptions.map((o) => (
                  <option key={o.id} value={o.value}>
                    {o.value}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Truck / Carrier</label>
              <select
                className="input"
                value={truckCarrier}
                onChange={(e) => setTruckCarrier(e.target.value)}
              >
                <option value="">— Select —</option>
                {carrierOptions.map((o) => (
                  <option key={o.id} value={o.value}>
                    {o.value}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2 lg:col-span-3">
              <label className="label">Remarks</label>
              <input className="input" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
            </div>
          </div>
        </div>

        <div className="card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700">Line Items</h2>
            <button type="button" className="btn-secondary text-xs" onClick={addLine}>
              + Add Line
            </button>
          </div>

          {selectedClient?.manages_inventory && (
            <p className="text-xs text-gray-500">
              This client uses Warehouse inventory tracking — Expiration Date auto-fills with the
              soonest-expiring batch in stock (FEFO) when you pick an item. You can still edit it
              manually if needed.
            </p>
          )}

          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th className="w-56">Item</th>
                  <th>Description</th>
                  <th className="w-28">Unit Price (VAT-incl.)</th>
                  <th className="w-24">Qty</th>
                  <th className="w-32">Amount</th>
                  <th className="w-36">Expiration Date</th>
                  <th className="w-16"></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={line.key}>
                    <td>
                      <select
                        className="input"
                        value={line.item_id}
                        onChange={(e) => handleItemSelect(line.key, e.target.value)}
                        disabled={!clientId}
                      >
                        <option value="">
                          {clientId ? "— Select Item —" : "Select a client first"}
                        </option>
                        {availableItems.map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.mercury_item_code || i.item_code}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input className="input bg-gray-50" value={line.item_description} readOnly />
                    </td>
                    <td>
                      <input
                        type="number"
                        step="0.01"
                        className="input"
                        value={line.unit_price}
                        onChange={(e) =>
                          updateLine(line.key, { unit_price: Number(e.target.value) })
                        }
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        className="input"
                        value={line.qty}
                        onChange={(e) => updateLine(line.key, { qty: Number(e.target.value) })}
                      />
                    </td>
                    <td>
                      {new Intl.NumberFormat("en-PH", {
                        style: "currency",
                        currency: "PHP",
                      }).format(line.qty * line.unit_price)}
                    </td>
                    <td>
                      <input
                        type="date"
                        className="input"
                        value={line.expiration_date}
                        onChange={(e) => updateLine(line.key, { expiration_date: e.target.value })}
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="text-red-600 hover:underline text-xs font-medium"
                        onClick={() => removeLine(line.key)}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="text-right text-sm font-semibold text-gray-700">
            Grand Total:{" "}
            {new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(
              grandTotal
            )}
          </div>
        </div>

        <div className="flex gap-2">
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? "Saving…" : "Save Delivery"}
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => router.push("/mercury/deliveries")}
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
