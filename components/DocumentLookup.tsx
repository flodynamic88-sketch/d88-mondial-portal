"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Invoice } from "@/types/database";

interface DocumentLookupProps {
  routePlanTruckId: string;
  onAssigned: () => void;
}

export default function DocumentLookup({ routePlanTruckId, onAssigned }: DocumentLookupProps) {
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [ratePct, setRatePct] = useState("");
  // FLO_PRINCIPAL only -- resolved name of invoice.principal_id, shown in
  // place of Zone since FLO_PRINCIPAL invoices don't carry a zone.
  const [principalName, setPrincipalName] = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [assignMsg, setAssignMsg] = useState<
    { type: "success" | "error"; message: string } | null
  >(null);

  async function handleLookup(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;

    setSearching(true);
    setSearchError(null);
    setNotFound(false);
    setInvoice(null);
    setAssignMsg(null);
    setRatePct("");
    setPrincipalName(null);

    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("invoices")
        .select("*")
        .ilike("document_no", trimmed)
        .maybeSingle();

      if (error) {
        setSearchError("Could not look up the document number.");
        return;
      }
      if (!data) {
        setNotFound(true);
        return;
      }

      // Consignment/Outright rates depend on Zone + DC, which are set later
      // from Recently Encoded (not at initial encode time). Mercury Drug
      // uses one flat rate regardless of zone, so it's unaffected. FLO_PRINCIPAL
      // has its own guard below (principal_id instead of zone).
      if (data.category !== "MERCURY_DRUG" && data.category !== "FLO_PRINCIPAL" && !data.zone) {
        setSearchError(
          `${data.document_no} doesn't have a Zone set yet. Go to Encode Invoices → Recently Encoded and set its Zone (and DC, if applicable) first.`
        );
        return;
      }

      if (data.category === "FLO_PRINCIPAL" && !data.principal_id) {
        setSearchError(
          `${data.document_no} doesn't have a Principal set yet. Go to Encode Invoices → Recently Encoded and set its Principal (and DC, if applicable) first.`
        );
        return;
      }

      setInvoice(data);

      let rate: number | null = null;
      if (data.category === "MERCURY_DRUG") {
        const { data: rateRow } = await supabase
          .from("fee_rates")
          .select("*")
          .eq("category", "MERCURY_DRUG")
          .limit(1)
          .maybeSingle();
        rate = rateRow?.rate_pct ?? null;
      } else if (data.category === "FLO_PRINCIPAL") {
        // FLO-Principal rates are flat per-principal (optionally split by
        // DC), looked up from principal_rates instead of zone-based
        // fee_rates -- see migration 0047.
        const [{ data: rateRow }, { data: principalRow }] = await Promise.all([
          supabase
            .from("principal_rates")
            .select("*")
            .eq("principal_id", data.principal_id)
            .eq("is_dc", data.is_dc)
            .maybeSingle(),
          supabase.from("principals").select("name").eq("id", data.principal_id).maybeSingle(),
        ]);
        rate = rateRow?.rate_pct ?? null;
        setPrincipalName(principalRow?.name ?? null);
      } else {
        const { data: rateRow } = await supabase
          .from("fee_rates")
          .select("*")
          .eq("category", data.category)
          .eq("zone", data.zone)
          .eq("is_dc", data.is_dc)
          .maybeSingle();
        rate = rateRow?.rate_pct ?? null;
      }
      setRatePct(rate !== null ? String(rate) : "");
    } catch {
      setSearchError(
        "Could not look up the document number. Connect a Supabase project to see live data."
      );
    } finally {
      setSearching(false);
    }
  }

  async function handleAssign() {
    if (!invoice) return;

    const rateNumber = Number(ratePct);
    if (ratePct.trim() === "" || Number.isNaN(rateNumber)) {
      setAssignMsg({ type: "error", message: "Enter a valid service rate percentage." });
      return;
    }

    setAssigning(true);
    setAssignMsg(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.from("route_plan_invoices").insert({
        route_plan_truck_id: routePlanTruckId,
        invoice_id: invoice.id,
        service_rate_pct: rateNumber,
      });

      if (error) {
        if (error.code === "23505") {
          setAssignMsg({
            type: "error",
            message: "This invoice is already assigned to a truck.",
          });
        } else {
          setAssignMsg({ type: "error", message: `Failed to assign invoice: ${error.message}` });
        }
        return;
      }

      setAssignMsg({
        type: "success",
        message: `Invoice ${invoice.document_no} assigned to this truck.`,
      });
      setQuery("");
      setInvoice(null);
      setRatePct("");
      onAssigned();
    } catch {
      setAssignMsg({
        type: "error",
        message: "Could not assign invoice. Make sure a Supabase project is connected.",
      });
    } finally {
      setAssigning(false);
    }
  }

  return (
    <div className="rounded-md border border-dashed border-gray-300 p-3">
      <form onSubmit={handleLookup} className="flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[200px]">
          <label className="label" htmlFor={`doc-lookup-${routePlanTruckId}`}>
            Document Lookup
          </label>
          <input
            id={`doc-lookup-${routePlanTruckId}`}
            type="text"
            className="input"
            placeholder="e.g. CD_00123, PSI-00456, BR_00789"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <button type="submit" className="btn-primary" disabled={searching}>
          {searching ? "Searching…" : "Look Up"}
        </button>
      </form>

      {searchError && <p className="mt-2 text-sm text-red-600">{searchError}</p>}
      {notFound && (
        <p className="mt-2 text-sm text-gray-500">No invoice found with that document number.</p>
      )}

      {invoice && (
        <div className="mt-3 rounded-md bg-gray-50 p-3 text-sm">
          <p className="font-medium text-gray-800">{invoice.document_no}</p>
          <p className="text-gray-600">{invoice.company_name_raw ?? "—"}</p>
          <p className="text-gray-500">{invoice.branch_address ?? "—"}</p>
          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-gray-600 sm:grid-cols-4">
            <span>
              Amount:{" "}
              {invoice.amount.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </span>
            <span>Category: {invoice.category.replace("_", " ")}</span>
            {invoice.category === "FLO_PRINCIPAL" ? (
              <span>Principal: {principalName ?? "—"}</span>
            ) : (
              <span>Zone: {invoice.zone}</span>
            )}
            <span>DC: {invoice.is_dc ? "Yes" : "No"}</span>
          </div>

          <div className="mt-3 flex flex-wrap items-end gap-2">
            <div>
              <label className="label" htmlFor={`rate-${routePlanTruckId}`}>
                Service Rate %
              </label>
              <input
                id={`rate-${routePlanTruckId}`}
                type="number"
                step="0.01"
                min="0"
                className="input w-28"
                value={ratePct}
                onChange={(e) => setRatePct(e.target.value)}
              />
            </div>
            <button
              type="button"
              className="btn-primary"
              onClick={handleAssign}
              disabled={assigning}
            >
              {assigning ? "Assigning…" : "Assign to this truck"}
            </button>
          </div>
        </div>
      )}

      {assignMsg && (
        <p
          className={`mt-2 text-sm ${
            assignMsg.type === "success" ? "text-green-600" : "text-red-600"
          }`}
        >
          {assignMsg.message}
        </p>
      )}
    </div>
  );
}
