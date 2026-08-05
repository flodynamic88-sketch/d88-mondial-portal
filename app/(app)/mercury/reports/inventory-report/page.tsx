"use client";

/**
 * Monthly Inventory Report — configuration page.
 *
 * Pick a client (only clients with Manages Inventory turned on have
 * warehouse stock to report on) + month/year, then jump to the polished,
 * client-facing print page (/reports/inventory-report/print) showing
 * Beginning Balance, Stock In, Stock Out, and Ending/Actual Stock on Hand
 * per item for that period.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/mercury/supabase/client";
import type { Client } from "@/lib/mercury/types";

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 6 }, (_, i) => CURRENT_YEAR - i);
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export default function InventoryReportConfigPage() {
  const router = useRouter();
  const now = new Date();

  const [clients, setClients] = useState<Client[]>([]);
  const [clientId, setClientId] = useState("");
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .schema("flo").from("clients")
      .select("*")
      .eq("manages_inventory", true)
      .order("client_code")
      .then(({ data }) => setClients((data as Client[]) || []));
  }, []);

  function handleGenerate() {
    if (!clientId) return;
    router.push(`/mercury/reports/inventory-report/print?clientId=${clientId}&year=${year}&month=${month}`);
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Monthly Inventory Report</h1>
        <p className="text-sm text-gray-500">
          Detailed, client-ready report — beginning balance, stock in, stock out, and actual stock
          on hand per item, for one client, for one month.
        </p>
      </div>

      <div className="card p-4 flex flex-wrap items-end gap-3">
        <div className="min-w-[16rem]">
          <label className="label">Client</label>
          <select className="input" value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">Select a client…</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.client_code} — {c.client_name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Month</label>
          <select className="input" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
            {MONTHS.map((m, idx) => (
              <option key={m} value={idx + 1}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Year</label>
          <select className="input" value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {YEARS.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
        <button className="btn-primary" onClick={handleGenerate} disabled={!clientId}>
          Generate Report
        </button>
      </div>

      {clients.length === 0 && (
        <div className="text-sm text-gray-400">
          Walang client na may naka-enable na Manages Inventory. I-set muna ito sa Clients page.
        </div>
      )}
      {clients.length > 0 && !clientId && (
        <div className="text-sm text-gray-400">Pumili muna ng client para makagawa ng report.</div>
      )}
    </div>
  );
}
