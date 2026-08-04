-- ============================================================================
-- Fix v_truck_cts: combine main truck + convoy truck invoices for CTS %
-- ============================================================================
-- Bug: v_truck_cts (migration 0010) computed each truck's CTS % using only
-- that specific truck's own linked route_plan_invoices. A convoy pair shares
-- ONE truck_rate (kept on the main truck only -- convoy trucks never get
-- their own rate, see AddTruckForm.tsx), but their invoices were NOT being
-- combined the way the billing views already do (migration 0026, via
-- coalesce(main_truck_id, id)). That left the main truck's CTS % computed
-- against only its own slice of the day's invoices, understating the total
-- invoice amount and inflating the % -- causing false "Not Passed" results
-- for any main truck that has a convoy.
--
-- Fix: group route_plan_invoices by coalesce(main_truck_id, id), same as the
-- billing views, and only emit one CTS row per main/standalone truck (convoy
-- trucks no longer get their own row -- their invoices are counted under the
-- main truck they're paired with, matching how the UI already treats them
-- as "Included in main" for the rate column).
--
-- Also: total_invoice_amount is unmasked here so it's visible to everyone
-- with Route Plan access, not just Admin/Logistics Officer -- per-truck
-- invoice total is not a cost figure the way truck_rate/cts_pct are.
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
    sum(i.amount) filter (where dr.type is distinct from 'BACKLOAD') as total_invoice_amount
  from route_plan_invoices rpi
  join route_plan_trucks t2 on t2.id = rpi.route_plan_truck_id
  join invoices i on i.id = rpi.invoice_id
  left join delivery_reasons dr on dr.id = rpi.reason_id
  group by coalesce(t2.main_truck_id, t2.id)
) li on li.group_truck_id = t.id
where t.main_truck_id is null;

grant select on v_truck_cts to authenticated;
