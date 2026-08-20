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

// Same " / " combine as combinedWaybill, but for the main truck's own
// plate_number joined with each convoy sub-truck's plate_number -- so a
// convoy route (e.g. Aug 4, 2026: main truck DBR2926 convoying with
// NKH2668) shows every plate # actually involved instead of only the main
// truck's.
export function combinedPlateNumber(
  statement: Pick<VTruckingBillingStatement, "plate_number" | "convoys">
) {
  const main = statement.plate_number?.trim() ?? "";
  const convoyPlates = (statement.convoys ?? [])
    .map((c) => c.plate_number?.trim())
    .filter((v): v is string => !!v);
  if (convoyPlates.length === 0) return main || "—";
  return [main, ...convoyPlates].filter(Boolean).join(" / ");
}

// Same " / " combine, for the main truck's driver joined with each convoy
// sub-truck's own driver -- the Delivery Report should show every driver
// who actually rode the route, not just the main truck's.
export function combinedDriverName(
  statement: Pick<VTruckingBillingStatement, "driver_name" | "convoys">
) {
  const main = statement.driver_name?.trim() ?? "";
  const convoyDrivers = (statement.convoys ?? [])
    .map((c) => c.driver_name?.trim())
    .filter((v): v is string => !!v);
  if (convoyDrivers.length === 0) return main || "—";
  return [main, ...convoyDrivers].filter(Boolean).join(" / ");
}

// Dedupe company names on a normalized key (uppercased, trailing
// ./, and extra whitespace stripped) so encoder-typo variants of the same
// store ("ROBINSONS SUPERMARKET CORP." vs "ROBINSONS SUPERMARKET CORP,.")
// collapse into one entry instead of listing the same store twice. The
// first raw (original-case, trimmed) spelling seen for a given key is what
// actually gets displayed.
export function normalizeAndJoinAccountNames(
  items: Pick<VTruckingBillingStatementItem, "company_name_raw">[]
) {
  const seen = new Map<string, string>();
  for (const item of items) {
    const raw = item.company_name_raw?.trim();
    if (!raw) continue;
    const key = raw
      .toUpperCase()
      .replace(/[.,]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!seen.has(key)) seen.set(key, raw);
  }
  const names = Array.from(seen.values());
  return names.length > 0 ? names.join(", ") : "—";
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

  // Per user request (2026-08-14): the Delivery Report / Billing Statement
  // totals should include EVERY item shown on this truck's own sheet --
  // backloaded items (is_backload) and redelivered items (is_redeliver)
  // both count -- rather than the DB view's active-assignment aggregate
  // (which drops a backloaded invoice's boxes entirely once it's superseded,
  // since that aggregate only sums the currently-active row per invoice).
  // Manual total_boxes_override still wins when set; otherwise sum every
  // line item actually printed on this sheet.
  const computedTotalBoxes = useMemo(
    () => items.reduce((sum, r) => sum + (r.qty_box ?? 0), 0),
    [items]
  );
  const totalBoxes = statement?.total_boxes_override ?? computedTotalBoxes;

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
  // Same inclusion as computedTotalBoxes above -- backloaded and redelivered
  // items both count toward this truck's own declared-value total and
  // (below) its % CTS, matching what's actually shown/tagged in the printed
  // item list.
  const totalDeclaredValue = useMemo(
    () => items.reduce((sum, r) => sum + (r.declared_value ?? 0), 0),
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
  //
  // Encoders don't always type a store's name identically ("ROBINSONS
  // SUPERMARKET CORP." vs "ROBINSONS SUPERMARKET CORP,." vs trailing/extra
  // spaces), so a plain Set dedupe still let the same store show up twice
  // in this line with only a punctuation difference. Dedupe on a
  // normalized key (case-insensitive, trailing punctuation/space
  // stripped) instead, while still displaying the first raw spelling seen.
  const accountsLabel = useMemo(() => normalizeAndJoinAccountNames(items), [items]);

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
