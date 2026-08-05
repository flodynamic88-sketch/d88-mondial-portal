-- ============================================================================
-- Include Charge-to-Mondial backloads in the original truck's CTS %
-- ============================================================================
-- Since 0010, v_truck_cts excluded EVERY Backload invoice from a truck's
-- total_invoice_amount, on the theory that the truck never actually
-- delivered it so it shouldn't count as revenue covering that truck's cost.
--
-- That blanket exclusion is wrong for the "Charge to Mondial" subset (0028):
-- those backloads still get billed to Mondial in full (the automatic second
-- billing line fires the moment the invoice is rescheduled for redelivery),
-- so the amount IS still being collected against that original truck's
-- wasted trip -- it should count toward covering the truck_rate, same as a
-- normally-delivered invoice.
--
-- Plain no-fault backloads and D88 Error backloads (0029) are NOT billed to
-- anyone for the failed attempt, so they stay excluded -- only
-- chargeable_to_mondial = true flips a Backload row back into the total.
--
-- Only the inner aggregate's FILTER clause changes; everything else
-- (convoy grouping from 0027) is unchanged.
-- ============================================================================

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
    then round(100.0 * t.truck_rate / nullif(li.total_invoice_amount, 0), 2)
    else null end as cts_pct,
  (
    round(100.0 * t.truck_rate / nullif(li.total_invoice_amount, 0), 2) <= 5
  ) as cts_pass
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
