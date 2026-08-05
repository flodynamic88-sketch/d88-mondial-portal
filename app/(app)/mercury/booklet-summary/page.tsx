"use client";

/**
 * Booklet Summary — monitoring page.
 *
 * Rodzon and HealthWellnessLifestyle (HWL) hand us pre-printed,
 * pre-numbered invoice booklets (50 slips per booklet, numbers issued in
 * sequence: HWL starts at 43351, Rodzon at 716551). This page shows one
 * booklet's 50 invoice numbers at a time and auto-fills Invoice Date /
 * PO# / Branch / Address / Amount for any number that's already been
 * encoded as a real Delivery in the portal (matched by invoice_number,
 * no double-encoding). Numbers still blank can be marked "Cancelled"
 * (voided/spoiled slip) so the booklet reconciles end-to-end.
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/mercury/supabase/client";
import type { BookletInvoiceStatus, Client, DeliveryHeaderFull } from "@/lib/mercury/types";

function peso(n: number | null | undefined) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 2,
  }).format(n || 0);
}

function formatDate(d: string | null | undefined) {
  if (!d) return "";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "2-digit" });
}

function parseInvoiceNumber(v: string | null | undefined): number | null {
  if (!v) return null;
  const digits = v.replace(/\D/g, "");
  if (!digits) return null;
  return parseInt(digits, 10);
}

export default function BookletSummaryPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [clientId, setClientId] = useState("");
  const [bookletIndex, setBookletIndex] = useState(0); // 0 = first booklet (start..start+size-1)

  const [deliveries, setDeliveries] = useState<DeliveryHeaderFull[]>([]);
  const [cancelled, setCancelled] = useState<BookletInvoiceStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingNumber, setSavingNumber] = useState<number | null>(null);

  // Only clients configured with a booklet series show up here.
  useEffect(() => {
    const supabase = createClient();
    supabase
      .schema("flo").from("clients")
      .select("*")
      .not("invoice_booklet_start", "is", null)
      .order("client_name")
      .then(({ data }) => {
        const list = (data as Client[]) || [];
        setClients(list);
        if (list.length > 0) setClientId((prev) => prev || list[0].id);
      });
  }, []);

  const client = useMemo(() => clients.find((c) => c.id === clientId) || null, [clients, clientId]);

  const bookletSize = client?.invoice_booklet_size || 50;
  const rangeStart = client?.invoice_booklet_start != null ? client.invoice_booklet_start + bookletIndex * bookletSize : null;
  const rangeEnd = rangeStart != null ? rangeStart + bookletSize - 1 : null;

  async function load() {
    if (!client || rangeStart == null || rangeEnd == null) {
      setDeliveries([]);
      setCancelled([]);
      return;
    }
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const [{ data: dData, error: dErr }, { data: cData, error: cErr }] = await Promise.all([
      // invoice_number is free text, so we can't range-query it in SQL —
      // pull every delivery for this client and match numbers client-side.
      supabase
        .schema("flo").from("v_delivery_headers_full")
        .select("*")
        .eq("client_id", client.id),
      supabase
        .schema("flo").from("booklet_invoice_status")
        .select("*")
        .eq("client_id", client.id),
    ]);
    if (dErr) setError(dErr.message);
    if (cErr) setError(cErr.message);
    setDeliveries((dData as DeliveryHeaderFull[]) || []);
    setCancelled((cData as BookletInvoiceStatus[]) || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client?.id, rangeStart, rangeEnd]);

  const deliveryByNumber = useMemo(() => {
    const map = new Map<number, DeliveryHeaderFull>();
    for (const d of deliveries) {
      const n = parseInvoiceNumber(d.invoice_number);
      if (n != null) map.set(n, d);
    }
    return map;
  }, [deliveries]);

  const cancelledByNumber = useMemo(() => {
    const map = new Map<number, BookletInvoiceStatus>();
    for (const c of cancelled) map.set(c.invoice_number, c);
    return map;
  }, [cancelled]);

  const slips = useMemo(() => {
    if (rangeStart == null) return [];
    const list: { seq: number; invoiceNumber: number }[] = [];
    for (let i = 0; i < bookletSize; i++) {
      list.push({ seq: i + 1, invoiceNumber: rangeStart + i });
    }
    return list;
  }, [rangeStart, bookletSize]);

  async function markCancelled(invoiceNumber: number) {
    if (!client) return;
    setSavingNumber(invoiceNumber);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error } = await supabase.schema("flo").from("booklet_invoice_status").insert({
      client_id: client.id,
      invoice_number: invoiceNumber,
      status: "Cancelled",
      created_by: user?.id || null,
    });
    if (error) {
      setError(error.message);
    } else {
      await load();
    }
    setSavingNumber(null);
  }

  async function unmarkCancelled(invoiceNumber: number) {
    if (!client) return;
    setSavingNumber(invoiceNumber);
    const supabase = createClient();
    const { error } = await supabase
      .schema("flo").from("booklet_invoice_status")
      .delete()
      .eq("client_id", client.id)
      .eq("invoice_number", invoiceNumber);
    if (error) {
      setError(error.message);
    } else {
      await load();
    }
    setSavingNumber(null);
  }

  const usedCount = slips.filter((s) => deliveryByNumber.has(s.invoiceNumber)).length;
  const cancelledCount = slips.filter((s) => cancelledByNumber.has(s.invoiceNumber)).length;
  const blankCount = slips.length - usedCount - cancelledCount;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Booklet Summary</h1>
        <p className="text-sm text-gray-500">
          Pre-printed invoice booklet monitoring — Invoice Date, PO#, Branch, Address, and Amount
          are auto-filled from already-encoded Deliveries. Mark still-blank numbers as Cancelled
          for voided/spoiled slips.
        </p>
      </div>

      <div className="card p-4 flex flex-wrap items-end gap-3">
        <div className="min-w-[16rem]">
          <label className="label">Client</label>
          <select className="input" value={clientId} onChange={(e) => { setClientId(e.target.value); setBookletIndex(0); }}>
            {clients.length === 0 && <option value="">No booklet clients configured</option>}
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.client_code} — {c.client_name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Booklet</label>
          <div className="flex items-center gap-2">
            <button
              className="btn-secondary"
              onClick={() => setBookletIndex((i) => Math.max(0, i - 1))}
              disabled={bookletIndex === 0}
            >
              ← Prev
            </button>
            <div className="input flex items-center justify-center min-w-[10rem] text-sm">
              {rangeStart != null && rangeEnd != null ? `${rangeStart} – ${rangeEnd}` : "—"}
            </div>
            <button className="btn-secondary" onClick={() => setBookletIndex((i) => i + 1)}>
              Next →
            </button>
          </div>
        </div>
        {rangeStart != null && rangeEnd != null && (
          <Link
            className="btn-primary"
            href={`/mercury/reports/booklet-summary/print?clientId=${clientId}&start=${rangeStart}&end=${rangeEnd}`}
            target="_blank"
          >
            Print Booklet Summary
          </Link>
        )}
        <div className="ml-auto text-xs text-gray-500 space-x-3">
          <span>Used: {usedCount}</span>
          <span>Cancelled: {cancelledCount}</span>
          <span>Blank: {blankCount}</span>
        </div>
      </div>

      {error && <div className="text-sm text-red-600">{error}</div>}

      <div className="card overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="bg-gray-50 text-xs uppercase text-gray-500">
            <tr>
              <th className="px-3 py-2">Invoice #</th>
              <th className="px-3 py-2">Invoice Date</th>
              <th className="px-3 py-2">PO#</th>
              <th className="px-3 py-2">Branch</th>
              <th className="px-3 py-2">Address</th>
              <th className="px-3 py-2 text-right">Amount</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-gray-400">
                  Loading…
                </td>
              </tr>
            ) : (
              slips.map((s) => {
                const d = deliveryByNumber.get(s.invoiceNumber);
                const c = cancelledByNumber.get(s.invoiceNumber);
                const isSaving = savingNumber === s.invoiceNumber;
                return (
                  <tr key={s.invoiceNumber} className="border-t border-gray-100">
                    <td className="px-3 py-1.5 font-medium">{s.invoiceNumber}</td>
                    {d ? (
                      <>
                        <td className="px-3 py-1.5">{formatDate(d.invoice_date)}</td>
                        <td className="px-3 py-1.5">{d.po_number}</td>
                        <td className="px-3 py-1.5">{d.branch_name}</td>
                        <td className="px-3 py-1.5 text-gray-500">{d.branch_delivery_address}</td>
                        <td className="px-3 py-1.5 text-right">{peso(d.total_amount)}</td>
                        <td className="px-3 py-1.5">
                          <span className="inline-block rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">
                            Used
                          </span>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-3 py-1.5 text-gray-300" colSpan={4}>
                          —
                        </td>
                        <td className="px-3 py-1.5 text-right text-gray-300">—</td>
                        <td className="px-3 py-1.5">
                          <select
                            className="input text-xs py-1"
                            value={c ? "Cancelled" : ""}
                            disabled={isSaving}
                            onChange={(e) => {
                              if (e.target.value === "Cancelled") markCancelled(s.invoiceNumber);
                              else unmarkCancelled(s.invoiceNumber);
                            }}
                          >
                            <option value="">Blank</option>
                            <option value="Cancelled">Cancelled</option>
                          </select>
                        </td>
                      </>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
