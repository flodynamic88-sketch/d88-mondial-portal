import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { VTruckingBillingStatement, VTruckingBillingStatementItem } from "@/types/database";

// JMD's own Billing Statement / Delivery Report always carry these two
// signatures -- there's no per-statement UI to set them (and none is
// needed), so they're shown as fixed constants on every printed document.
export const PREPARED_BY_NAME = "Algene Kianne Bueza";
export const APPROVED_BY_NAME = "Mr. Roshan Mirani";

export function formatMoney(value: number | null | undefined) {
  return (value ?? 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// MM/DD/YYYY, matching the "Date:" / "DATE FORWARDED" fields on JMD's own sheet.
export function formatMMDDYYYY(value: string | Date | null | undefined) {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}/${dd}/${d.getFullYear()}`;
}

// "JULY 14,2026", matching the Delivery Report's "DATE:" field on JMD's own sheet.
export function formatLongDateNoSpace(value: string | Date | null | undefined) {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  const month = d.toLocaleDateString(undefined, { month: "long" }).toUpperCase();
  return `${month} ${d.getDate()},${d.getFullYear()}`;
}

// When one or more convoy sub-trucks ride along on this truck's single rate,
// each of their waybill #s is joined onto the main truck's with " / "
// (e.g. "12345 / 67890 / 67891") so all show together on the one shared
// sheet. Reads every entry in `convoys` (migration 0058), not just a single
// legacy value, so a main truck with N convoy sub-trucks shows all N.
export function combinedWaybill(
  statement: Pick<VTruckingBillingStatement, "waybill_no" | "convoys">
) {
  const main = statement.waybill_no ?? "";
  const convoyNos = (statement.convoys ?? [])
    .map((c) => c.waybill_no?.trim())
    .filter((v): v is string => !!v);
  if (convoyNos.length === 0) return main || "—";
  return [main, ...convoyNos].filter(Boolean).join(" / ");
}

/** Shared data loader for both the Billing Statement and Delivery Report printable pages. */
export function useTruckingBillingPrintData(id: string) {
  const [statement, setStatement] = useState<VTruckingBillingStatement | null>(null);
  const [items, setItems] = useState<VTruckingBillingStatementItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    (async () => {
      setLoading(true);
      setErrorMsg(null);
      try {
        const supabase = createClient();
        const [{ data: s, error: sErr }, { data: itemRows }] = await Promise.all([
          supabase.from("v_trucking_billing_statements").select("*").eq("id", id).maybeSingle(),
          supabase
            .from("v_trucking_billing_statement_items")
            .select("*")
            .eq("statement_id", id),
        ]);

        if (sErr || !s) {
          setErrorMsg("Could not load this billing statement.");
          return;
        }
        setStatement(s as VTruckingBillingStatement);
        setItems((itemRows ?? []) as VTruckingBillingStatementItem[]);
      } catch {
        setErrorMsg("Could not load this billing statement.");
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  // total_boxes on the view is already override-aware (coalesce(total_boxes_override,
  // computed sum)) -- prefer it once the statement has loaded; fall back to summing
  // the line items only for the brief moment before the statement row arrives.
  // Backloaded items (is_backload) are kept in `items` so the original truck's
  // report still shows/tags them (migration 0059), but they never actually
  // rode this truck, so they're excluded from the summed total here too --
  // matching the view's own item_count/total_boxes aggregate.
  const computedTotalBoxes = useMemo(
    () => items.filter((r) => !r.is_backload).reduce((sum, r) => sum + (r.qty_box ?? 0), 0),
    [items]
  );
  const totalBoxes = statement ? statement.total_boxes : computedTotalBoxes;

  /** Best-effort save of the manual Boxes-total override; updates local state so the print preview reflects it immediately. */
  async function updateTotalBoxesOverride(value: number | null) {
    if (!statement) return;
    const supabase = createClient();
    const { error } = await supabase
      .from("trucking_billing_statements")
      .update({ total_boxes_override: value })
      .eq("id", statement.id);
    if (!error) {
      setStatement({
        ...statement,
        total_boxes_override: value,
        total_boxes: value ?? computedTotalBoxes,
      });
    }
    return error;
  }
  // Same backload exclusion as computedTotalBoxes above -- a backloaded
  // invoice's declared value never actually rode this truck, so it's kept
  // visible/tagged in the printed item list but left out of the truck's own
  // declared-value total and (below) its % CTS.
  const totalDeclaredValue = useMemo(
    () => items.filter((r) => !r.is_backload).reduce((sum, r) => sum + (r.declared_value ?? 0), 0),
    [items]
  );
  // Raw fraction (not multiplied by 100) to match JMD's own "% CTS" column,
  // which stores e.g. 0.0401 formatted as a percentage rather than the
  // number 4.01.
  const ctsFraction =
    statement?.truck_rate != null && totalDeclaredValue > 0
      ? statement.truck_rate / totalDeclaredValue
      : null;

  // The accounts on a JMD-format Billing Statement are the retail chains
  // across all receipts on this truck, combined into one line -- distinct
  // company names, comma-joined, matching how the sample sheet lists a
  // single combined "ACCOUNT" per truck-day.
  const accountsLabel = useMemo(() => {
    const names = Array.from(
      new Set(items.map((r) => r.company_name_raw).filter(Boolean) as string[])
    );
    return names.length > 0 ? names.join(", ") : "—";
  }, [items]);

  // "DELIVERY DATE" on the billing summary row / the Delivery Report's own
  // "DATE:" field -- the actual route/delivery date, distinct from the
  // "Date:" header field (when the statement was forwarded for billing).
  const deliveryDate = statement?.route_date ?? null;
  // "Date:" header field / "DATE FORWARDED" line -- when the statement was
  // forwarded for billing. Falls back to today while still unbilled.
  const forwardedDate = statement?.billed_at ?? new Date().toISOString();

  return {
    statement,
    items,
    loading,
    errorMsg,
    totalBoxes,
    totalDeclaredValue,
    ctsFraction,
    accountsLabel,
    deliveryDate,
    forwardedDate,
    updateTotalBoxesOverride,
  };
}
