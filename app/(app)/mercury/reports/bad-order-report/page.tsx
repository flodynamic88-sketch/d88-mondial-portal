"use client";

/**
 * Bad Order Monthly Report — configuration page.
 *
 * Pick a client + month/year, then jump to the client-facing print page
 * (/reports/bad-order-report/print) which lists every backload item due
 * to a bad order for that client in the selected month, broken down by
 * status (Stored in Warehouse / Returned to Client-Principal / Disposed).
 * Meant to be generated and sent straight to the client, mirroring the
 * Sales Report / Inventory Report client-facing flow elsewhere in the app.
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

export default function BadOrderReportConfigPage() {
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
      .order("client_code")
      .then(({ data }) => setClients((data as Client[]) || []));
  }, []);

  function handleGenerate() {
    if (!clientId) return;
    router.push(`/mercury/reports/bad-order-report/print?clientId=${clientId}&year=${year}&month=${month}`);
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Bad Order Monthly Report</h1>
        <p className="text-sm text-gray-500">
          Client-ready report — backload items due to bad orders (e.g. from Mercury), with status
          breakdown, for one client, for one month.
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

      {!clientId && (
        <div className="text-sm text-gray-400">Pumili muna ng client para makagawa ng report.</div>
      )}
    </div>
  );
}
