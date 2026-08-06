import { createClient } from "@/lib/supabase/client";

/**
 * Auto-links the Delivery Variance Log to Route Plan: called whenever a
 * Logistics Associate (or Admin/Logistics Officer) sets a Discrepancy or
 * Backload reason on an assigned invoice in Route Plan. Creates a variance
 * log header row for that route_plan_invoice if one doesn't exist yet, or
 * keeps its reason/invoice in sync if it does. Best-effort: failures here
 * should not block the reason update itself from succeeding.
 */
export async function ensureVarianceLog(
  routePlanInvoiceId: string,
  invoiceId: string | null,
  reasonId: string,
  /** The route plan's own route_date -- the actual day the discrepancy/
   *  backload occurred. Always re-sent on every call (even for an existing
   *  row) so log_date self-heals to the correct date instead of drifting to
   *  whatever day the reason happened to be typed in (e.g. a later
   *  redelivery). */
  logDate?: string | null
): Promise<void> {
  const supabase = createClient();

  try {
    await supabase.from("delivery_variance_logs").upsert(
      {
        route_plan_invoice_id: routePlanInvoiceId,
        invoice_id: invoiceId,
        reason_id: reasonId,
        ...(logDate ? { log_date: logDate } : {}),
      },
      { onConflict: "route_plan_invoice_id" }
    );
  } catch {
    // Non-fatal: the reason itself was already saved on route_plan_invoices;
    // the variance log can also be created/edited manually from its own page.
  }
}
