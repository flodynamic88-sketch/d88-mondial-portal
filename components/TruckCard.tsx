"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import DocumentLookup from "@/components/DocumentLookup";
import AddTruckForm from "@/components/AddTruckForm";
import { useAuth } from "@/components/AuthProvider";
import { useToast } from "@/components/Toast";
import { findOrCreateDeliveryReason } from "@/lib/invoiceHelpers";
import { ensureVarianceLog } from "@/lib/varianceLog";
import type {
  RoutePlanTruck,
  RoutePlanInvoice,
  Invoice,
  DeliveryReason,
  ReasonType,
  VTruckCts,
  FeeRate,
} from "@/types/database";

/** Human-readable zone label matching the fee schedule (NCR / NCR (DC) / etc). */
function zoneLabel(invoice: Invoice | null): string {
  if (!invoice) return "—";
  if (invoice.category === "MERCURY_DRUG") return "Flat rate";
  if (!invoice.zone) return "No zone set";
  const base =
    invoice.zone === "NCR" ? "NCR" : invoice.zone === "FAR_NORTH_SOUTH" ? "Far South/North" : "VizMin";
  return invoice.is_dc ? `${base} (DC)` : base;
}

const CUSTOM_DISCREPANCY = "__custom_discrepancy__";
const CUSTOM_BACKLOAD = "__custom_backload__";

/** Slices an ISO timestamp down to the yyyy-mm-dd a <input type="date"> expects. */
function toDateInputValue(iso: string | null): string {
  if (!iso) return "";
  return iso.slice(0, 10);
}

interface AssignedInvoiceRow extends RoutePlanInvoice {
  invoice: Invoice | null;
}

interface TruckCardProps {
  truck: RoutePlanTruck;
  /** Display label for this truck, e.g. "Truck 1" or "Truck 1 · Convoy 1". */
  truckLabel: string;
  convoys: RoutePlanTruck[];
  deliveryReasons: DeliveryReason[];
  routePlanId: string;
  /** The route plan's own route_date -- the actual day this truck is
   *  attempting delivery. Threaded through to ensureVarianceLog() so a
   *  Discrepancy/Backload reason set on an assigned invoice logs against
   *  that date, not whenever the reason happens to be typed in. */
  routeDate: string;
  onRefreshTrucks: () => void;
  /** Refetches deliveryReasons after a custom reason is created or its
   *  Mondial/D88 flag is toggled, so the shared list stays in sync. */
  onRefreshReasons?: () => void;
  isConvoy?: boolean;
  /** Id of the truck whose details row is currently open, shared across the whole table. */
  expandedTruckId: string | null;
  onToggleExpand: (id: string) => void;
}

export default function TruckCard({
  truck,
  truckLabel,
  convoys,
  deliveryReasons,
  routePlanId,
  routeDate,
  onRefreshTrucks,
  onRefreshReasons,
  isConvoy = false,
  expandedTruckId,
  onToggleExpand,
}: TruckCardProps) {
  const profile = useAuth();
  const { showToast } = useToast();
  const role = profile?.role;
  // Matches the server-side RLS/trigger rules in 0003_user_management.sql —
  // the UI hides actions the backend would reject, but the DB is still the
  // real enforcement point.
  const canSeeTruckRate = role === "ADMIN" || role === "LOGISTICS_OFFICER";
  const canDispatch = role === "ADMIN" || role === "JMD_PLANNER" || role === "LOGISTICS_OFFICER";
  const canUpdateDelivery =
    role === "ADMIN" || role === "LOGISTICS_OFFICER" || role === "LOGISTICS_ASSOCIATE";
  const canAddCustomReason = role === "ADMIN" || role === "LOGISTICS_ASSOCIATE";
  const canAddConvoy = role === "ADMIN" || role === "JMD_PLANNER" || role === "LOGISTICS_OFFICER";
  // Matches the route_plan_trucks/route_plan_invoices DELETE RLS policies.
  const canManageTruck = canAddConvoy;
  const canUnassignInvoice =
    role === "ADMIN" || role === "JMD_PLANNER" || role === "LOGISTICS_OFFICER";
  // Truck details (Carrier / Plate # / Driver / Helpers) -- Admin, JMD
  // Planner, and Logistics Officer (full Route Plan access), matching the
  // route_plan_trucks UPDATE RLS policy.
  const canEditTruckDetails =
    role === "ADMIN" || role === "JMD_PLANNER" || role === "LOGISTICS_OFFICER";
  // Area is derived from the truck's destination and masked server-side (see
  // v_route_plan_trucks in 0033_trucking_rates.sql) to ADMIN/LOGISTICS_OFFICER/
  // LOGISTICS_ASSOCIATE -- JMD Planner, Mondial Team, GM, and Invoicing Team
  // never see it.
  const canSeeArea =
    role === "ADMIN" || role === "LOGISTICS_OFFICER" || role === "LOGISTICS_ASSOCIATE";
  // Matches the route_plan_invoices UPDATE RLS policy (0003 + 0020) -- the
  // only roles that can actually save a Qty/Box edit. View-only roles like
  // GENERAL_MANAGER, MONDIAL_TEAM, INVOICING_TEAM, and JMD_ADMIN previously
  // saw a live-looking input here with no server-side effect on save.
  const canEditQtyBox =
    role === "ADMIN" ||
    role === "JMD_PLANNER" ||
    role === "LOGISTICS_OFFICER" ||
    role === "LOGISTICS_ASSOCIATE";

  const [rows, setRows] = useState<AssignedInvoiceRow[]>([]);
  // True when at least one of this truck's active (non-superseded) invoices
  // was previously superseded on a DIFFERENT truck with a Discrepancy/
  // Backload reason -- i.e. this truck is the redelivery leg of a backload
  // reported on an earlier route plan day. Flags the truck label blue so
  // it's traceable at a glance, distinct from the red "has its own
  // discrepancy/backload today" flag below.
  const [hasRedeliveredBackload, setHasRedeliveredBackload] = useState(false);
  const [loadingRows, setLoadingRows] = useState(true);
  const [rowsError, setRowsError] = useState<string | null>(null);
  const [cts, setCts] = useState<VTruckCts | null>(null);
  const [feeRates, setFeeRates] = useState<FeeRate[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [dispatching, setDispatching] = useState(false);
  const [showAddConvoy, setShowAddConvoy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deletingTruck, setDeletingTruck] = useState(false);
  const [removingRowId, setRemovingRowId] = useState<string | null>(null);
  const [editingDetails, setEditingDetails] = useState(false);
  const [savingDetails, setSavingDetails] = useState(false);
  const [detailsDraft, setDetailsDraft] = useState({
    carrier: truck.carrier ?? "",
    plate_number: truck.plate_number ?? "",
    driver_name: truck.driver_name ?? "",
    helper1_name: truck.helper1_name ?? "",
    helper2_name: truck.helper2_name ?? "",
    truck_rate: truck.truck_rate !== null && truck.truck_rate !== undefined ? String(truck.truck_rate) : "",
    destination: truck.destination ?? "",
  });
  const [destinationOptions, setDestinationOptions] = useState<
    { destination: string; area: string; rate: number | null; convoy_rate: number | null }[]
  >([]);
  const [customEntry, setCustomEntry] = useState<{
    rowId: string;
    type: ReasonType;
    text: string;
    /** Backload only: Mondial's fault -- see findOrCreateDeliveryReason. */
    chargeableToMondial: boolean;
    /** Backload only: D88's own mistake -- reporting tag, never billed twice. */
    isD88Error: boolean;
  } | null>(null);
  const [savingCustom, setSavingCustom] = useState(false);

  const loadAssigned = useCallback(async () => {
    setLoadingRows(true);
    setRowsError(null);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("route_plan_invoices")
        .select("*, invoice:invoices(*)")
        .eq("route_plan_truck_id", truck.id)
        .order("created_at", { ascending: true });

      if (error) {
        setRowsError("Could not load assigned invoices.");
        setRows([]);
        setHasRedeliveredBackload(false);
      } else {
        const assignedRows = (data ?? []) as unknown as AssignedInvoiceRow[];
        setRows(assignedRows);

        // Check whether any of this truck's *active* invoices were
        // previously superseded on a different truck with a Discrepancy/
        // Backload reason -- i.e. this is where that backload got
        // redelivered. superseded rows on THIS truck are excluded since
        // they're this truck's own history, not an active redelivery.
        const activeInvoiceIds = assignedRows
          .filter((r) => !r.superseded_at && r.invoice_id)
          .map((r) => r.invoice_id as string);
        if (activeInvoiceIds.length > 0) {
          const { data: priorBackloads } = await supabase
            .from("route_plan_invoices")
            .select("invoice_id")
            .in("invoice_id", activeInvoiceIds)
            .neq("route_plan_truck_id", truck.id)
            .not("superseded_at", "is", null)
            .not("reason_id", "is", null);
          setHasRedeliveredBackload((priorBackloads ?? []).length > 0);
        } else {
          setHasRedeliveredBackload(false);
        }
      }

      const { data: ctsData } = await supabase
        .from("v_truck_cts")
        .select("*")
        .eq("truck_id", truck.id)
        .maybeSingle();
      setCts(ctsData ?? null);

      const { data: feeRateData } = await supabase.from("fee_rates").select("*");
      setFeeRates((feeRateData ?? []) as FeeRate[]);
    } catch {
      setRowsError(
        "Could not load assigned invoices. Connect a Supabase project to see live data."
      );
      setRows([]);
      setHasRedeliveredBackload(false);
    } finally {
      setLoadingRows(false);
    }
  }, [truck.id]);

  useEffect(() => {
    loadAssigned();
  }, [loadAssigned, refreshKey]);

  // Keep the edit draft in sync with the latest truck data whenever we're
  // not actively editing (e.g. after onRefreshTrucks() re-fetches).
  useEffect(() => {
    if (!editingDetails) {
      setDetailsDraft({
        carrier: truck.carrier ?? "",
        plate_number: truck.plate_number ?? "",
        driver_name: truck.driver_name ?? "",
        helper1_name: truck.helper1_name ?? "",
        helper2_name: truck.helper2_name ?? "",
        truck_rate:
          truck.truck_rate !== null && truck.truck_rate !== undefined ? String(truck.truck_rate) : "",
        destination: truck.destination ?? "",
      });
    }
  }, [
    truck.carrier,
    truck.plate_number,
    truck.driver_name,
    truck.helper1_name,
    truck.helper2_name,
    truck.truck_rate,
    truck.destination,
    editingDetails,
  ]);

  // Destination options for the picker -- convoy trucks never need their own
  // destination (they're covered by the main truck's), and only Admin/
  // Logistics Officer are allowed to set one (0034_destination_officer_admin_only.sql),
  // so skip the fetch for everyone else. Also pull rate/convoy_rate (masked
  // to the same ADMIN/LOGISTICS_OFFICER roles in v_trucking_rates, so this is
  // safe) so the edit row can preview the rate the trigger will derive for
  // whichever destination is currently selected in the draft, instead of
  // showing the truck's last-saved rate while a new destination is pending.
  useEffect(() => {
    if (isConvoy || !canSeeTruckRate) return;
    const supabase = createClient();
    supabase
      .from("v_trucking_rates")
      .select("destination, area, rate, convoy_rate")
      .then(({ data }) => {
        if (data) {
          setDestinationOptions(
            [...data].sort(
              (a, b) => a.area.localeCompare(b.area) || a.destination.localeCompare(b.destination)
            )
          );
        }
      });
  }, [isConvoy, canSeeTruckRate]);

  async function handleSaveTruckDetails() {
    setActionError(null);

    // Truck Rate is only editable (and only visible) for ADMIN/LOGISTICS_OFFICER
    // (canSeeTruckRate), and never applies to convoy trucks (they're covered by
    // the main truck's rate). Leave it out of the payload entirely otherwise so
    // we never accidentally send a stale/blank value for a role that can't see it.
    // Once a destination is set (or being set in this same save), truck_rate is
    // always derived server-side from trucking_rates -- see
    // enforce_truck_rate_edit() in 0033_trucking_rates.sql -- so skip sending
    // our manual draft in that case too; it would just get overwritten, and
    // the input is hidden in that state anyway (see the Truck Rate cell below).
    const savingDestination = canSeeTruckRate && !isConvoy ? detailsDraft.destination.trim() : "";
    let rateNumber: number | null | undefined;
    if (canSeeTruckRate && !isConvoy && !savingDestination) {
      if (detailsDraft.truck_rate.trim() === "") {
        rateNumber = null;
      } else {
        const parsed = Number(detailsDraft.truck_rate);
        if (Number.isNaN(parsed)) {
          const msg = "Truck rate must be a valid number.";
          setActionError(msg);
          showToast(msg, "error");
          return;
        }
        rateNumber = parsed;
      }
    }

    setSavingDetails(true);
    try {
      const supabase = createClient();
      // NOTE: route_plan_trucks intentionally has no SELECT RLS policy --
      // reads are only meant to go through the v_route_plan_trucks view
      // (see migrations 0003/0014). That means chaining .select() after this
      // update would always come back empty regardless of role, so unlike
      // route_plan_invoices (which does have a permissive SELECT policy) we
      // can't use a 0-row RETURNING check here. We trust the `error` field:
      // the UPDATE RLS policy already covers ADMIN/JMD_PLANNER/
      // LOGISTICS_OFFICER, a superset of who the UI lets edit this form.
      const { error } = await supabase
        .from("route_plan_trucks")
        .update({
          carrier: detailsDraft.carrier.trim() || null,
          plate_number: detailsDraft.plate_number.trim() || null,
          driver_name: detailsDraft.driver_name.trim() || null,
          helper1_name: detailsDraft.helper1_name.trim() || null,
          helper2_name: detailsDraft.helper2_name.trim() || null,
          ...(rateNumber !== undefined ? { truck_rate: rateNumber } : {}),
          // Convoy trucks never carry their own destination -- the trigger
          // derives their main truck's rate instead (0033_trucking_rates.sql).
          // Destination is Admin/Logistics Officer only
          // (0034_destination_officer_admin_only.sql) -- for other roles the
          // select never renders so the draft always matches the existing
          // value; omit it from the payload entirely so we never resend a
          // stale value for a role that can't see/edit it.
          ...(isConvoy || !canSeeTruckRate
            ? {}
            : { destination: detailsDraft.destination.trim() || null }),
        })
        .eq("id", truck.id);
      if (error) {
        const msg = `Failed to update truck details: ${error.message}`;
        setActionError(msg);
        showToast(msg, "error");
        return;
      }
      showToast(`${truckLabel} details updated.`, "success");
      setEditingDetails(false);
      onRefreshTrucks();
    } catch {
      setActionError("Could not update truck details. Make sure a Supabase project is connected.");
      showToast("Could not update truck details.", "error");
    } finally {
      setSavingDetails(false);
    }
  }

  function handleCancelEditDetails() {
    setDetailsDraft({
      carrier: truck.carrier ?? "",
      plate_number: truck.plate_number ?? "",
      driver_name: truck.driver_name ?? "",
      helper1_name: truck.helper1_name ?? "",
      helper2_name: truck.helper2_name ?? "",
      truck_rate:
        truck.truck_rate !== null && truck.truck_rate !== undefined ? String(truck.truck_rate) : "",
      destination: truck.destination ?? "",
    });
    setEditingDetails(false);
  }

  async function handleDispatch() {
    setDispatching(true);
    setActionError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("route_plan_trucks")
        .update({ dispatched_at: new Date().toISOString() })
        .eq("id", truck.id);
      if (error) {
        setActionError("Failed to mark truck as dispatched.");
        showToast("Failed to mark truck as dispatched.", "error");
      } else {
        showToast(`${truckLabel} marked as dispatched.`, "success");
        onRefreshTrucks();
      }
    } catch {
      setActionError("Could not dispatch truck. Make sure a Supabase project is connected.");
      showToast("Could not dispatch truck.", "error");
    } finally {
      setDispatching(false);
    }
  }

  async function handleDeleteTruck() {
    const confirmed = window.confirm(
      `Remove ${truckLabel}${
        truck.plate_number ? ` (${truck.plate_number})` : ""
      } from this route plan? Any assigned invoices will be unassigned. This cannot be undone.`
    );
    if (!confirmed) return;

    setDeletingTruck(true);
    setActionError(null);
    try {
      const supabase = createClient();
      // NOTE: route_plan_trucks has no SELECT RLS policy by design (reads
      // only happen through v_route_plan_trucks -- see migrations
      // 0003/0014), so a .select() chained after this delete would always
      // come back empty regardless of role, making a 0-row RETURNING check
      // meaningless here (unlike tables that do have a SELECT policy). We
      // trust the `error` field instead: the DELETE RLS policy (migration
      // 0008) already matches ADMIN/JMD_PLANNER/LOGISTICS_OFFICER, the same
      // set the UI gates this button on.
      const { error } = await supabase
        .from("route_plan_trucks")
        .delete()
        .eq("id", truck.id);
      if (error) {
        if (error.code === "23503") {
          const msg =
            "Cannot remove this truck because it still has convoy trucks linked to it. Remove those convoy trucks first.";
          setActionError(msg);
          showToast(msg, "error");
        } else {
          const msg = `Failed to remove truck: ${error.message}`;
          setActionError(msg);
          showToast(msg, "error");
        }
        return;
      }
      showToast(`${truckLabel} removed from the route plan.`, "success");
      onRefreshTrucks();
    } catch {
      setActionError("Could not remove truck. Make sure a Supabase project is connected.");
      showToast("Could not remove truck.", "error");
    } finally {
      setDeletingTruck(false);
    }
  }

  async function handleRescheduleForRedelivery(row: AssignedInvoiceRow) {
    const confirmed = window.confirm(
      `Mark invoice ${row.invoice?.document_no ?? ""} as subject for redelivery? It will stay on this truck for history and no longer count toward this truck's CTS, and can be assigned to a new truck/date via Document Lookup.`
    );
    if (!confirmed) return;

    setRemovingRowId(row.id);
    setActionError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("route_plan_invoices")
        .update({ superseded_at: new Date().toISOString() })
        .eq("id", row.id);
      if (error) {
        setActionError("Failed to reschedule invoice for redelivery.");
        return;
      }
      setRefreshKey((k) => k + 1);
    } catch {
      setActionError(
        "Could not reschedule invoice for redelivery. Make sure a Supabase project is connected."
      );
    } finally {
      setRemovingRowId(null);
    }
  }

  async function handleRemoveAssignedInvoice(row: AssignedInvoiceRow) {
    const confirmed = window.confirm(
      `Unassign invoice ${row.invoice?.document_no ?? ""} from this truck? It will become available to assign again.`
    );
    if (!confirmed) return;

    setRemovingRowId(row.id);
    setActionError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.from("route_plan_invoices").delete().eq("id", row.id);
      if (error) {
        setActionError("Failed to unassign invoice.");
        return;
      }
      setRefreshKey((k) => k + 1);
    } catch {
      setActionError("Could not unassign invoice. Make sure a Supabase project is connected.");
    } finally {
      setRemovingRowId(null);
    }
  }

  /** Looks up the fee-schedule rate that matches this invoice's zone/DC/category. */
  function expectedRateFor(invoice: Invoice | null): number | null {
    if (!invoice) return null;
    const match =
      invoice.category === "MERCURY_DRUG"
        ? feeRates.find((r) => r.category === "MERCURY_DRUG")
        : feeRates.find(
            (r) =>
              r.category === invoice.category &&
              r.zone === invoice.zone &&
              r.is_dc === invoice.is_dc
          );
    return match?.rate_pct ?? null;
  }

  async function handleRateChange(rowId: string, value: string) {
    const trimmed = value.trim();
    if (trimmed === "") return;
    const num = Number(trimmed);
    if (Number.isNaN(num)) return;
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("route_plan_invoices")
        .update({ service_rate_pct: num })
        .eq("id", rowId);
      if (error) {
        setActionError("Failed to update service rate.");
      } else {
        setRefreshKey((k) => k + 1);
      }
    } catch {
      setActionError("Could not update service rate. Make sure a Supabase project is connected.");
    }
  }

  async function handleQtyBoxChange(rowId: string, value: string) {
    const trimmed = value.trim();
    const num = trimmed === "" ? null : Number(trimmed);
    if (num !== null && Number.isNaN(num)) return;
    try {
      const supabase = createClient();
      // .select() so we can tell a real 0-row RLS-blocked "success" (see
      // handleDeleteTruck above for the same pattern) apart from an actual
      // save -- otherwise a role without UPDATE rights here would see the
      // value silently revert with no explanation.
      const { data, error } = await supabase
        .from("route_plan_invoices")
        .update({ qty_box: num })
        .eq("id", rowId)
        .select("id");
      if (error) {
        setActionError("Failed to update qty per box.");
      } else if (!data || data.length === 0) {
        setActionError(
          "Qty/Box was not saved -- you may not have permission to edit it. Ask an Admin to check your account access."
        );
        setRefreshKey((k) => k + 1);
      } else {
        setRefreshKey((k) => k + 1);
      }
    } catch {
      setActionError("Could not update qty per box. Make sure a Supabase project is connected.");
    }
  }

  async function handleDeliveryDateChange(row: AssignedInvoiceRow, value: string) {
    setActionError(null);
    try {
      const supabase = createClient();
      // Store as UTC midnight for the picked date so the sync trigger's
      // `(delivered_at at time zone 'UTC')::date` cast lands on the exact
      // date the Logistics Associate chose, regardless of local timezone.
      const isoValue = value ? `${value}T00:00:00.000Z` : null;
      const { error } = await supabase
        .from("route_plan_invoices")
        .update({ delivered_at: isoValue })
        .eq("id", row.id);

      if (error) {
        setActionError("Failed to update delivery date.");
        return;
      }

      // invoices.actual_delivery_date and invoices.status are kept in sync by
      // the sync_invoice_delivery_date trigger (see
      // 0011_delivery_date_sync.sql), which runs as SECURITY DEFINER so it
      // isn't blocked by the ADMIN/JMD_PLANNER-only "invoices update" RLS
      // policy that would otherwise silently reject this for a Logistics
      // Associate.
      setRefreshKey((k) => k + 1);
    } catch {
      setActionError(
        "Could not update delivery date. Make sure a Supabase project is connected."
      );
    }
  }

  async function handleReasonChange(rowId: string, reasonId: string) {
    setActionError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("route_plan_invoices")
        .update({ reason_id: reasonId || null })
        .eq("id", rowId);

      if (error) {
        setActionError("Failed to save the reported issue.");
        return;
      }

      // Auto-link to the Delivery Variance Log: whenever a Discrepancy or
      // Backload reason is set, make sure a variance log header exists for
      // this assigned invoice so the details (items, etc.) can be filled in
      // from the Delivery Variance Log page.
      if (reasonId) {
        const invoiceId = rows.find((r) => r.id === rowId)?.invoice_id ?? null;
        await ensureVarianceLog(rowId, invoiceId, reasonId, routeDate);
      }

      setRefreshKey((k) => k + 1);
    } catch {
      setActionError("Could not save the reported issue. Make sure a Supabase project is connected.");
    }
  }

  function handleReasonSelect(rowId: string, value: string) {
    if (value === CUSTOM_DISCREPANCY) {
      setCustomEntry({
        rowId,
        type: "DISCREPANCY",
        text: "",
        chargeableToMondial: false,
        isD88Error: false,
      });
      return;
    }
    if (value === CUSTOM_BACKLOAD) {
      setCustomEntry({
        rowId,
        type: "BACKLOAD",
        text: "",
        chargeableToMondial: false,
        isD88Error: false,
      });
      return;
    }
    setCustomEntry(null);
    handleReasonChange(rowId, value);
  }

  async function handleSaveCustomReason() {
    if (!customEntry) return;
    const text = customEntry.text.trim();
    if (!text) {
      setActionError("Type a reason before saving.");
      return;
    }
    setSavingCustom(true);
    setActionError(null);
    try {
      const reasonId = await findOrCreateDeliveryReason(customEntry.type, text, {
        chargeableToMondial: customEntry.chargeableToMondial,
        isD88Error: customEntry.isD88Error,
      });
      if (!reasonId) {
        setActionError("Failed to save the custom reason.");
        return;
      }
      await handleReasonChange(customEntry.rowId, reasonId);
      setCustomEntry(null);
      onRefreshReasons?.();
    } finally {
      setSavingCustom(false);
    }
  }

  /** Flip a Backload reason's Charge-to-Mondial / D88-Error tag. The two are
   *  mutually exclusive (a backload is either nobody's fault, D88's fault,
   *  or Mondial's fault), and the flag lives on the shared delivery_reasons
   *  row -- not the invoice row -- so it affects every other invoice already
   *  using that same reason label going forward too. */
  async function handleToggleReasonFlag(
    reasonId: string,
    field: "chargeable_to_mondial" | "is_d88_error",
    value: boolean
  ) {
    try {
      const supabase = createClient();
      const patch: Record<string, boolean> = { [field]: value };
      if (value) {
        patch[field === "chargeable_to_mondial" ? "is_d88_error" : "chargeable_to_mondial"] = false;
      }
      await supabase.from("delivery_reasons").update(patch).eq("id", reasonId);
      onRefreshReasons?.();
    } catch {
      setActionError("Could not update the reason's Mondial/D88 tag.");
    }
  }

  const discrepancyReasons = deliveryReasons.filter((r) => r.type === "DISCREPANCY");
  const backloadReasons = deliveryReasons.filter((r) => r.type === "BACKLOAD");
  const expanded = expandedTruckId === truck.id;

  // Trace-back flag: row.reason_id is only ever set via the Discrepancy/
  // Backload <select> above, so any assigned invoice with a reason_id means
  // this truck encountered one that day -- flag the truck label itself so
  // it's traceable at a glance directly from the Route Plan board, without
  // having to open the Delivery Variance Log page.
  const hasDiscrepancyOrBackload = rows.some((r) => r.reason_id);

  // Live preview of the auto-derived rate for whatever destination is
  // currently selected in the edit draft (which may not be saved yet) --
  // mirrors enforce_truck_rate_edit()'s own lookup (convoy_rate once this
  // truck has any convoy trucks attached, plain rate otherwise) so the row
  // doesn't show the truck's last-*saved* rate while a different, unsaved
  // destination is selected in the dropdown.
  const draftDestinationOption = detailsDraft.destination.trim()
    ? destinationOptions.find((d) => d.destination === detailsDraft.destination.trim())
    : undefined;
  const hasConvoyTrucks = convoys.length > 0;
  const previewTruckRate = draftDestinationOption
    ? (hasConvoyTrucks ? draftDestinationOption.convoy_rate : draftDestinationOption.rate) ??
      truck.truck_rate
    : truck.truck_rate;

  return (
    <>
      <tr className={`border-t border-gray-100 align-top ${isConvoy ? "bg-gray-50/60" : ""}`}>
        <td className="py-2 pl-4 pr-3 text-xs text-gray-700">
          {editingDetails ? (
            <input
              type="text"
              className="input w-24 text-xs"
              value={detailsDraft.carrier}
              onChange={(e) => setDetailsDraft((d) => ({ ...d, carrier: e.target.value }))}
              placeholder="Carrier"
            />
          ) : (
            truck.carrier ?? "—"
          )}
        </td>
        <td className="py-2 pr-3">
          <button
            type="button"
            onClick={() => onToggleExpand(truck.id)}
            className="mr-1 text-gray-400 hover:text-gray-600"
            title={expanded ? "Collapse" : "Expand"}
          >
            {expanded ? "▾" : "▸"}
          </button>
          <span
            className={
              hasDiscrepancyOrBackload
                ? "text-sm font-semibold text-red-600"
                : hasRedeliveredBackload
                  ? "text-sm font-semibold text-blue-600"
                  : isConvoy
                    ? "text-sm text-gray-700"
                    : "text-sm font-semibold text-gray-800"
            }
            title={
              hasDiscrepancyOrBackload
                ? "This truck has a reported discrepancy/backload"
                : hasRedeliveredBackload
                  ? "This truck is redelivering a previously reported discrepancy/backload"
                  : undefined
            }
          >
            {truckLabel}
            {hasDiscrepancyOrBackload && " ⚠"}
            {!hasDiscrepancyOrBackload && hasRedeliveredBackload && " ↻"}
          </span>
          {editingDetails ? (
            <input
              type="text"
              className="input mt-1 ml-4 w-28 text-xs"
              value={detailsDraft.plate_number}
              onChange={(e) => setDetailsDraft((d) => ({ ...d, plate_number: e.target.value }))}
              placeholder="Plate #"
            />
          ) : (
            truck.plate_number && (
              <p className="pl-4 text-xs text-gray-500">{truck.plate_number}</p>
            )
          )}
        </td>
        <td className="py-2 pr-3 text-xs text-gray-700">
          {editingDetails ? (
            <input
              type="text"
              className="input w-28 text-xs"
              value={detailsDraft.driver_name}
              onChange={(e) => setDetailsDraft((d) => ({ ...d, driver_name: e.target.value }))}
              placeholder="Driver"
            />
          ) : (
            truck.driver_name ?? "—"
          )}
        </td>
        <td className="py-2 pr-3 text-xs text-gray-700">
          {editingDetails ? (
            <div className="flex flex-col gap-1">
              <input
                type="text"
                className="input w-28 text-xs"
                value={detailsDraft.helper1_name}
                onChange={(e) => setDetailsDraft((d) => ({ ...d, helper1_name: e.target.value }))}
                placeholder="Helper 1"
              />
              <input
                type="text"
                className="input w-28 text-xs"
                value={detailsDraft.helper2_name}
                onChange={(e) => setDetailsDraft((d) => ({ ...d, helper2_name: e.target.value }))}
                placeholder="Helper 2"
              />
            </div>
          ) : (
            [truck.helper1_name, truck.helper2_name].filter(Boolean).join(", ") || "—"
          )}
        </td>
        <td className="py-2 pr-3 text-xs text-gray-700">
          {isConvoy ? (
            <span className="text-gray-400">Included in main</span>
          ) : editingDetails && canSeeTruckRate ? (
            <select
              className="input w-32 text-xs"
              value={detailsDraft.destination}
              onChange={(e) => setDetailsDraft((d) => ({ ...d, destination: e.target.value }))}
            >
              <option value="">— Select —</option>
              {destinationOptions.map((d) => (
                <option key={d.destination} value={d.destination}>
                  {d.destination}
                </option>
              ))}
            </select>
          ) : (
            <>
              {truck.destination ?? "—"}
              {canSeeArea && truck.area && (
                <p className="text-xs text-gray-400">{truck.area}</p>
              )}
            </>
          )}
        </td>
        <td className="py-2 pr-3 text-xs text-gray-700">
          {isConvoy ? (
            <span className="text-gray-400">Included in main</span>
          ) : canSeeTruckRate ? (
            editingDetails && !detailsDraft.destination.trim() ? (
              <input
                type="number"
                step="0.01"
                min="0"
                className="input no-spinner w-24 text-xs"
                value={detailsDraft.truck_rate}
                onChange={(e) => setDetailsDraft((d) => ({ ...d, truck_rate: e.target.value }))}
                placeholder="0.00"
              />
            ) : (
              <div className="flex flex-col">
                <span>
                  {/* While editing, preview the rate the trigger will derive
                      for whichever destination is currently selected in the
                      draft (previewTruckRate) rather than the truck's
                      last-saved rate (truck.truck_rate) -- otherwise picking
                      a new destination shows the OLD destination's rate
                      until Save is clicked, which reads as a mismatch. */}
                  {((editingDetails ? previewTruckRate : truck.truck_rate) ?? 0).toLocaleString(
                    undefined,
                    { minimumFractionDigits: 2, maximumFractionDigits: 2 }
                  )}
                </span>
                {/* Once a destination is set, truck_rate is always derived
                    server-side from trucking_rates (convoy_rate instead of
                    rate whenever this truck has convoy trucks attached) --
                    see enforce_truck_rate_edit() in 0033_trucking_rates.sql.
                    Manual entry only applies to legacy rows with no
                    destination, so we hide the input here to match
                    AddTruckForm's behavior and avoid implying the typed
                    value would stick. */}
                {editingDetails && (
                  <span className="text-[10px] text-gray-400">Auto (destination)</span>
                )}
              </div>
            )
          ) : (
            "—"
          )}
        </td>
        <td className="py-2 pr-3 text-xs text-gray-700">
          {isConvoy ? (
            <span className="text-gray-400">Included in main</span>
          ) : cts && cts.total_invoice_amount !== null && cts.total_invoice_amount !== undefined ? (
            cts.total_invoice_amount.toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })
          ) : (
            "—"
          )}
        </td>
        <td className="py-2 pr-3">
          {cts ? (
            <span
              className={`whitespace-nowrap ${
                cts.cts_pass === null || cts.cts_pass === undefined
                  ? "badge-neutral"
                  : cts.cts_pass
                    ? "badge-success"
                    : "badge-danger"
              }`}
            >
              {canSeeTruckRate && cts.cts_pct !== null && cts.cts_pct !== undefined
                ? `${cts.cts_pct}% · `
                : ""}
              {cts.cts_pass === null || cts.cts_pass === undefined
                ? "No data"
                : cts.cts_pass
                  ? "Passed"
                  : "Not Passed"}
            </span>
          ) : (
            <span className="text-xs text-gray-400">—</span>
          )}
        </td>
        <td className="py-2 pr-3">
          {truck.dispatched_at ? (
            <span className="whitespace-nowrap text-xs font-medium text-green-600">
              Dispatched {new Date(truck.dispatched_at).toLocaleDateString()}
            </span>
          ) : canDispatch ? (
            <button
              type="button"
              className="btn-primary px-2 py-1 text-xs"
              onClick={handleDispatch}
              disabled={dispatching}
            >
              {dispatching ? "…" : "Dispatch"}
            </button>
          ) : (
            <span className="text-xs text-gray-400">Not yet</span>
          )}
        </td>
        <td className="py-2 pl-3 pr-4">
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={`/route-plan/print/${truck.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="tab-button tab-button-inactive whitespace-nowrap text-xs"
              title="Open a printable itinerary for this truck"
            >
              Print
            </a>
            {canEditTruckDetails && !editingDetails && (
              <button
                type="button"
                className="whitespace-nowrap text-xs font-medium text-blue-600 hover:text-blue-800"
                onClick={() => setEditingDetails(true)}
                title="Edit carrier, plate #, driver, helpers, and (if visible) truck rate"
              >
                Edit
              </button>
            )}
            {editingDetails && (
              <>
                <button
                  type="button"
                  className="whitespace-nowrap text-xs font-medium text-green-600 hover:text-green-800 disabled:opacity-50"
                  onClick={handleSaveTruckDetails}
                  disabled={savingDetails}
                >
                  {savingDetails ? "…" : "Save"}
                </button>
                <button
                  type="button"
                  className="whitespace-nowrap text-xs font-medium text-gray-500 hover:text-gray-700"
                  onClick={handleCancelEditDetails}
                  disabled={savingDetails}
                >
                  Cancel
                </button>
              </>
            )}
            {canManageTruck && (
              <button
                type="button"
                className="whitespace-nowrap text-xs font-medium text-red-600 hover:text-red-800 disabled:opacity-50"
                onClick={handleDeleteTruck}
                disabled={deletingTruck}
                title="Remove this truck from the route plan"
              >
                {deletingTruck ? "…" : "Remove"}
              </button>
            )}
          </div>
        </td>
      </tr>

      {expanded && (
        <tr className="bg-gray-50/50">
          <td colSpan={9} className="px-4 pb-4 pt-1">
            {(role === "ADMIN" || role === "JMD_PLANNER" || role === "LOGISTICS_OFFICER") && (
              <div className="mb-3">
                <DocumentLookup
                  routePlanTruckId={truck.id}
                  onAssigned={() => setRefreshKey((k) => k + 1)}
                />
              </div>
            )}

            {actionError && <p className="mb-2 text-sm text-red-600">{actionError}</p>}

            <div>
              <h3 className="text-sm font-semibold text-gray-700">Assigned Invoices</h3>
              {loadingRows && <p className="mt-2 text-sm text-gray-400">Loading…</p>}
        {!loadingRows && rowsError && <p className="mt-2 text-sm text-gray-400">{rowsError}</p>}
        {!loadingRows && !rowsError && rows.length === 0 && (
          <p className="mt-2 text-sm text-gray-400">No invoices assigned yet.</p>
        )}
        {!loadingRows && !rowsError && rows.length > 0 && (
          <div className="mt-2 table-scroll-container">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold uppercase text-gray-500">
                  <th className="py-2 pr-4">Document No.</th>
                  <th className="py-2 pr-4">Company / Branch</th>
                  <th className="py-2 pr-4">Qty/Box</th>
                  <th className="py-2 pr-4">Amount</th>
                  <th className="py-2 pr-4">Rate %</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="py-2 pr-4 font-medium text-gray-800">
                      {row.invoice?.document_no ?? "—"}
                    </td>
                    <td className="py-2 pr-4">
                      <p>{row.invoice?.company_name_raw ?? "—"}</p>
                      <p className="text-xs text-gray-400">{row.invoice?.branch_address ?? "—"}</p>
                    </td>
                    <td className="py-2 pr-4">
                      {canEditQtyBox ? (
                        <input
                          type="number"
                          step="1"
                          min="0"
                          className="input no-spinner w-20 text-center"
                          defaultValue={row.qty_box ?? ""}
                          onBlur={(e) => handleQtyBoxChange(row.id, e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              e.currentTarget.blur();
                            }
                          }}
                        />
                      ) : (
                        <span className="text-center text-gray-700">{row.qty_box ?? "—"}</span>
                      )}
                    </td>
                    <td className="py-2 pr-4">
                      {(row.invoice?.amount ?? 0).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </td>
                    <td className="py-2 pr-4">
                      {canSeeTruckRate ? (
                        <div className="flex w-28 flex-col items-center gap-0.5">
                          <div className="flex items-center gap-1">
                            <input
                              key={`${row.id}-${row.service_rate_pct ?? "empty"}`}
                              type="number"
                              step="0.01"
                              min="0"
                              placeholder="0.00"
                              className="input no-spinner w-20 text-center"
                              defaultValue={row.service_rate_pct ?? ""}
                              onBlur={(e) => handleRateChange(row.id, e.target.value)}
                            />
                            <span className="text-xs text-gray-400">%</span>
                          </div>
                          <span className="max-w-full whitespace-normal break-words text-center text-[10px] leading-tight text-gray-400">
                            {zoneLabel(row.invoice)}
                            {expectedRateFor(row.invoice) !== null &&
                              expectedRateFor(row.invoice) !== row.service_rate_pct && (
                                <>
                                  {" · "}
                                  <button
                                    type="button"
                                    className="text-brand-600 underline hover:text-brand-700"
                                    onClick={() =>
                                      handleRateChange(row.id, String(expectedRateFor(row.invoice)))
                                    }
                                  >
                                    Use {expectedRateFor(row.invoice)}%
                                  </button>
                                </>
                              )}
                          </span>
                        </div>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="py-2 pr-4">
                      <div className="flex flex-col items-start gap-1">
                        {row.delivered_at && (
                          <span className="badge-success">
                            Delivered {toDateInputValue(row.delivered_at)}
                          </span>
                        )}
                        {row.reason_id &&
                          (() => {
                            const reason = deliveryReasons.find((r) => r.id === row.reason_id);
                            return (
                              <>
                                <span className="badge-warning">{reason?.label ?? "Issue reported"}</span>
                                {reason?.type === "BACKLOAD" && canAddCustomReason && (
                                  <div className="flex flex-wrap gap-2 text-[10px] text-gray-500">
                                    <label className="flex items-center gap-1">
                                      <input
                                        type="checkbox"
                                        className="h-3 w-3"
                                        checked={reason.chargeable_to_mondial}
                                        onChange={(e) =>
                                          handleToggleReasonFlag(
                                            reason.id,
                                            "chargeable_to_mondial",
                                            e.target.checked
                                          )
                                        }
                                      />
                                      Charge to Mondial
                                    </label>
                                    <label className="flex items-center gap-1">
                                      <input
                                        type="checkbox"
                                        className="h-3 w-3"
                                        checked={reason.is_d88_error}
                                        onChange={(e) =>
                                          handleToggleReasonFlag(reason.id, "is_d88_error", e.target.checked)
                                        }
                                      />
                                      D88 Error
                                    </label>
                                  </div>
                                )}
                                {reason?.type === "BACKLOAD" &&
                                  !canAddCustomReason &&
                                  (reason.chargeable_to_mondial || reason.is_d88_error) && (
                                    <span className="text-[10px] text-gray-500">
                                      {reason.chargeable_to_mondial ? "Charge to Mondial" : "D88 Error"}
                                    </span>
                                  )}
                              </>
                            );
                          })()}
                        {row.superseded_at && (
                          <span className="badge-info">Subject for Redelivery</span>
                        )}
                        {!row.delivered_at && !row.reason_id && !row.superseded_at && (
                          <span className="badge-neutral">Pending</span>
                        )}
                      </div>
                    </td>
                    <td className="py-2 pr-4">
                      {row.superseded_at ? (
                        <p className="text-xs text-gray-400">
                          Rescheduled {new Date(row.superseded_at).toLocaleDateString()} — kept
                          here for history. Look up this document on the new date's Route Plan to
                          assign it for redelivery.
                        </p>
                      ) : (
                      <div className="flex flex-col flex-wrap gap-1 sm:flex-row sm:items-center">
                        {canUpdateDelivery ? (
                          <>
                        <input
                          type="date"
                          className="input"
                          value={toDateInputValue(row.delivered_at)}
                          onChange={(e) => handleDeliveryDateChange(row, e.target.value)}
                        />
                        <select
                          className="input"
                          value={
                            customEntry?.rowId === row.id ? "" : row.reason_id ?? ""
                          }
                          onChange={(e) => handleReasonSelect(row.id, e.target.value)}
                        >
                          <option value="">
                            {row.reason_id ? "Clear Issue" : "Report Issue…"}
                          </option>
                          <optgroup label="Discrepancy">
                            {discrepancyReasons.map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.label}
                              </option>
                            ))}
                            {canAddCustomReason && (
                              <option value={CUSTOM_DISCREPANCY}>+ Type new reason…</option>
                            )}
                          </optgroup>
                          <optgroup label="Backload">
                            {backloadReasons.map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.label}
                              </option>
                            ))}
                            {canAddCustomReason && (
                              <option value={CUSTOM_BACKLOAD}>+ Type new reason…</option>
                            )}
                          </optgroup>
                        </select>
                          </>
                        ) : (
                          <span className="text-xs text-gray-400">View only</span>
                        )}
                        {canUnassignInvoice &&
                          deliveryReasons.find((r) => r.id === row.reason_id)?.type ===
                            "BACKLOAD" && (
                            <button
                              type="button"
                              className="text-xs font-medium text-purple-600 hover:text-purple-800 disabled:opacity-50"
                              onClick={() => handleRescheduleForRedelivery(row)}
                              disabled={removingRowId === row.id}
                              title="Keep this invoice's history on this truck, exclude it from CTS, and free it up to assign to a new truck/date"
                            >
                              {removingRowId === row.id ? "Saving…" : "Reschedule for Redelivery"}
                            </button>
                          )}
                        {canUnassignInvoice && (
                          <button
                            type="button"
                            className="text-xs font-medium text-red-600 hover:text-red-800 disabled:opacity-50"
                            onClick={() => handleRemoveAssignedInvoice(row)}
                            disabled={removingRowId === row.id}
                            title="Unassign this invoice from the truck"
                          >
                            {removingRowId === row.id ? "Removing…" : "Remove"}
                          </button>
                        )}
                        {canUpdateDelivery && customEntry?.rowId === row.id && (
                          <div className="flex w-full flex-col gap-1 sm:w-auto">
                            <div className="flex w-full items-center gap-1 sm:w-auto">
                              <input
                                type="text"
                                className="input w-full min-w-[12rem] flex-none sm:w-48"
                                autoFocus
                                placeholder={
                                  customEntry.type === "DISCREPANCY"
                                    ? "New discrepancy reason"
                                    : "New backload reason"
                                }
                                value={customEntry.text}
                                onChange={(e) =>
                                  setCustomEntry({ ...customEntry, text: e.target.value })
                                }
                              />
                              <button
                                type="button"
                                className="btn-primary"
                                onClick={handleSaveCustomReason}
                                disabled={savingCustom}
                              >
                                {savingCustom ? "Saving…" : "Save"}
                              </button>
                              <button
                                type="button"
                                className="tab-button tab-button-inactive"
                                onClick={() => setCustomEntry(null)}
                              >
                                Cancel
                              </button>
                            </div>
                            {customEntry.type === "BACKLOAD" && (
                              <div className="flex flex-wrap gap-3 text-[11px] text-gray-500">
                                <label className="flex items-center gap-1">
                                  <input
                                    type="checkbox"
                                    className="h-3 w-3"
                                    checked={customEntry.chargeableToMondial}
                                    onChange={(e) =>
                                      setCustomEntry({
                                        ...customEntry,
                                        chargeableToMondial: e.target.checked,
                                        isD88Error: e.target.checked ? false : customEntry.isD88Error,
                                      })
                                    }
                                  />
                                  Charge to Mondial — Mondial&apos;s fault, auto-double-bill on redelivery
                                </label>
                                <label className="flex items-center gap-1">
                                  <input
                                    type="checkbox"
                                    className="h-3 w-3"
                                    checked={customEntry.isD88Error}
                                    onChange={(e) =>
                                      setCustomEntry({
                                        ...customEntry,
                                        isD88Error: e.target.checked,
                                        chargeableToMondial: e.target.checked
                                          ? false
                                          : customEntry.chargeableToMondial,
                                      })
                                    }
                                  />
                                  D88 Error — our own mistake
                                </label>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
            </div>

            {!isConvoy && canAddConvoy && (
              <div className="mt-4 border-t border-gray-100 pt-4">
                {showAddConvoy ? (
                  <AddTruckForm
                    routePlanId={routePlanId}
                    mainTruckId={truck.id}
                    onCreated={() => {
                      setShowAddConvoy(false);
                      onRefreshTrucks();
                    }}
                    onCancel={() => setShowAddConvoy(false)}
                  />
                ) : (
                  <button
                    type="button"
                    className="tab-button tab-button-inactive"
                    onClick={() => setShowAddConvoy(true)}
                  >
                    + Add Convoy Truck
                  </button>
                )}
              </div>
            )}
          </td>
        </tr>
      )}

      {!isConvoy &&
        convoys.map((c, convoyIndex) => (
          <TruckCard
            key={c.id}
            truck={c}
            truckLabel={`${truckLabel} · Convoy ${convoyIndex + 1}`}
            convoys={[]}
            deliveryReasons={deliveryReasons}
            routePlanId={routePlanId}
            routeDate={routeDate}
            onRefreshTrucks={onRefreshTrucks}
            onRefreshReasons={onRefreshReasons}
            isConvoy
            expandedTruckId={expandedTruckId}
            onToggleExpand={onToggleExpand}
          />
        ))}
    </>
  );
}
