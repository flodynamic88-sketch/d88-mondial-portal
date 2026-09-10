-- ============================================================================
-- v_truck_cts: count an in-house truck's delivered invoices toward CTS even
-- though it has no truck_rate
-- ============================================================================
-- Bug report: "dpat kapag inhouse ginamit na truck dapat kasama sya sa
-- computation ng cts, kahit wala syang rate. kasi truck nmen gamit walang
-- truck rate, para mahatak yung cts ng ibang mga truck" -- an in-house
-- (company-owned) truck is never given a truck_rate (there's no external
-- carrier being paid for it), so today it's invisible to every CTS
-- computation that requires truck_rate to be non-null. That means its
-- delivered invoice amount never shows up anywhere CTS is averaged/pooled
-- across trucks, which understates how much revenue the fleet is actually
-- covering for its cost and makes the reported CTS look worse than it is.
--
-- Root cause: cts_pct/cts_pass were computed straight off t.truck_rate, so
-- a null rate (in-house truck) always produced cts_pct = null and
-- cts_pass = null -- effectively excluded, not "0% cost, always passing".
-- Every place that pools CTS across multiple trucks (Dashboard MTD CTS %,
-- Route Plan day-average CTS, pass/fail counts) either drops null cts_pct
-- rows outright or (in the Dashboard's weighted sumRate/sumAmount) requires
-- truck_rate itself to be non-null, so the in-house truck's
-- total_invoice_amount never enters the denominator either.
--
-- Fix: an in-house truck has a real cost of 0 for CTS purposes (D88 already
-- owns it -- there's no rental fee eating into the fulfillment fee), so
-- treat null truck_rate as 0 when computing cts_pct/cts_pass. A truck with
-- no rate and any delivered invoice amount now correctly shows 0.00% / Pass
-- instead of "no data" -- and because that 0% is real data (not null), it
-- now participates in every average/pool downstream, pulling the reported
-- CTS toward what the fleet is actually achieving.
--
-- truck_rate itself (the masked, actual-entered-rate column used for
-- display) is unchanged -- still null/blank for an in-house truck, still
-- masked to null for non-Admin/Logistics-Officer roles. A new
-- truck_rate_for_cts column exposes the same 0-coalesced, role-masked value
-- so app code that currently pools raw truck_rate (Dashboard MTD CTS) can
-- switch to it without leaking real rate figures to unprivileged roles.
-- ============================================================================

-- CREATE OR REPLACE VIEW can only append new columns at the end of the
-- select list (Postgres errors if a new column lands before an existing
-- one, since that reads as renaming/reordering an existing column) -- so
-- truck_rate_for_cts is added last, after cts_pass, keeping every existing
-- column in its original position.
create or replace view v_truck_cts
with (security_invoker = false) as
select
  t.id as truck_id,
  t.route_plan_id,
  t.plate_number,
  case when public.current_user_role() in ('ADMIN','LOGISTICS_OFFICER')
    then t.truck_rate else null end as truck_rate,
  li.total_invoice_amount,
  case when public.current_user_role() in ('ADMIN','LOGISTICS_OFFICER')
    then round(100.0 * coalesce(t.truck_rate, 0) / nullif(li.total_invoice_amount, 0), 2)
    else null end as cts_pct,
  (
    round(100.0 * coalesce(t.truck_rate, 0) / nullif(li.total_invoice_amount, 0), 2) <= 5
  ) as cts_pass,
  case when public.current_user_role() in ('ADMIN','LOGISTICS_OFFICER')
    then coalesce(t.truck_rate, 0) else null end as truck_rate_for_cts
from route_plan_trucks t
join (
  select
    coalesce(t2.main_truck_id, t2.id) as group_truck_id,
    sum(i.amount) filter (
      where dr.type is distinct from 'BACKLOAD'
         or dr.chargeable_to_mondial = true
    ) as total_invoice_amount
  from route_plan_invoices rpi
  join route_plan_trucks t2 on t2.id = rpi.route_plan_truck_id
  join invoices i on i.id = rpi.invoice_id
  left join delivery_reasons dr on dr.id = rpi.reason_id
  group by coalesce(t2.main_truck_id, t2.id)
) li on li.group_truck_id = t.id
where t.main_truck_id is null;

grant select on v_truck_cts to authenticated;
