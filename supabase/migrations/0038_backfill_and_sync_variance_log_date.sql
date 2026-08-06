-- Task #260 made new discrepancy/backload reason-sets always stamp
-- delivery_variance_logs.log_date with the route plan's own route_date.
-- That fix only applied going forward -- rows created before it (e.g.
-- CD_0100261, backloaded on 2026-08-01 but stuck showing 2026-08-04) kept
-- whatever stale date they were first written with. This migration:
--   1) backfills every existing row so log_date matches the actual route
--      plan date it's linked to, and
--   2) adds a trigger so if a route plan's route_date is ever corrected
--      later, every delivery_variance_logs row linked to that plan is
--      re-synced automatically -- log_date can no longer drift out of sync
--      again.

-- 1) One-time backfill of existing rows.
update delivery_variance_logs dvl
set log_date = rp.route_date
from route_plan_invoices rpi
join route_plan_trucks rpt on rpt.id = rpi.route_plan_truck_id
join route_plans rp on rp.id = rpt.route_plan_id
where dvl.route_plan_invoice_id = rpi.id
  and rp.route_date is not null
  and dvl.log_date is distinct from rp.route_date;

-- 2) Keep log_date in sync if a route plan's date is edited afterward.
create or replace function sync_variance_log_dates_on_route_date_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.route_date is distinct from old.route_date then
    update delivery_variance_logs dvl
    set log_date = new.route_date
    from route_plan_invoices rpi
    join route_plan_trucks rpt on rpt.id = rpi.route_plan_truck_id
    where dvl.route_plan_invoice_id = rpi.id
      and rpt.route_plan_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_variance_log_dates on route_plans;
create trigger trg_sync_variance_log_dates
after update on route_plans
for each row
execute function sync_variance_log_dates_on_route_date_change();
