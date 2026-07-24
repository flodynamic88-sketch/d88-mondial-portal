import { createClient } from "@/lib/supabase/server";

interface Kpi {
  label: string;
  value: string;
  hint?: string;
}

async function getKpis(): Promise<Kpi[]> {
  // Best-effort live counts. Falls back to placeholders if Supabase isn't
  // configured yet (no project created) or the query fails for any reason.
  try {
    const supabase = createClient();

    const [{ count: total }, { count: pending }, { count: delivered }] =
      await Promise.all([
        supabase.from("invoices").select("*", { count: "exact", head: true }),
        supabase
          .from("invoices")
          .select("*", { count: "exact", head: true })
          .eq("status", "PENDING"),
        supabase
          .from("invoices")
          .select("*", { count: "exact", head: true })
          .eq("status", "DELIVERED"),
      ]);

    const totalCount = total ?? 0;
    const deliveredCount = delivered ?? 0;
    const fulfillmentRate =
      totalCount > 0 ? ((deliveredCount / totalCount) * 100).toFixed(1) : "0.0";

    return [
      { label: "Total Invoices", value: String(totalCount) },
      { label: "Pending", value: String(pending ?? 0) },
      { label: "Delivered", value: String(deliveredCount) },
      { label: "Fulfillment Rate", value: `${fulfillmentRate}%` },
    ];
  } catch {
    return [
      { label: "Total Invoices", value: "—", hint: "Connect Supabase to see live data" },
      { label: "Pending", value: "—", hint: "Connect Supabase to see live data" },
      { label: "Delivered", value: "—", hint: "Connect Supabase to see live data" },
      { label: "Fulfillment Rate", value: "—", hint: "Connect Supabase to see live data" },
    ];
  }
}

export default async function DashboardPage() {
  const kpis = await getKpis();

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">Overview of Mondial delivery operations.</p>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="card hover:shadow-card-hover">
            <p className="text-sm font-medium text-gray-500">{kpi.label}</p>
            <p className="mt-2 text-3xl font-bold text-brand-700">{kpi.value}</p>
            {kpi.hint && <p className="mt-1 text-xs text-gray-400">{kpi.hint}</p>}
          </div>
        ))}
      </div>

      <div className="card mt-6">
        <h2 className="text-lg font-semibold text-gray-800">Getting started</h2>
        <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-gray-600">
          <li>Use &quot;Encode Invoices&quot; to add Consignment, Outright, and Mercury Drug invoices.</li>
          <li>Assign encoded invoices to trucks in &quot;Route Plan&quot;, then dispatch and mark delivered.</li>
          <li>Track fulfillment rate and CTS per truck in &quot;Deliveries Fulfillment&quot;.</li>
          <li>Delivered invoices flow automatically into &quot;Billing&quot;, then &quot;Mondial Confirmation&quot;, and finally &quot;Final Billing&quot; once confirmed.</li>
        </ul>
      </div>
    </div>
  );
}
