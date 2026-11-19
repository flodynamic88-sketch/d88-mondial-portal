-- ============================================================================
-- VAS manpower cost: replace manual "Manpower Cost" entry with an auto-
-- computed value, driven by a per-person daily rate (default PHP 700) and
-- the number of days the batch ran. Manpower Cost = Manpower Count x Rate
-- per Manpower per Day x # of Days -- computed server-side as a generated
-- column so it can never drift out of sync with its inputs.
-- ============================================================================

alter table vas.production_batches
  add column if not exists rate_per_manpower_day numeric not null default 700;

alter table vas.production_batches
  add column if not exists manpower_days numeric not null default 1;

-- manpower_cost must be dropped and re-added as a generated column -- Postgres
-- has no ALTER COLUMN ... ADD GENERATED for stored generated expressions
-- (only for identity columns). vas.v_production_progress depends on this
-- column, so it has to be dropped first and recreated unchanged after.
drop view if exists vas.v_production_progress;

alter table vas.production_batches drop column manpower_cost;

alter table vas.production_batches
  add column manpower_cost numeric
  generated always as (
    coalesce(manpower_count, 0) * coalesce(rate_per_manpower_day, 0) * coalesce(manpower_days, 1)
  ) stored;

create view vas.v_production_progress
with (security_invoker = false) as
with base as (
  select
    pb.id as batch_id,
    pb.batch_no,
    pb.batch_date,
    pb.manpower_count,
    pb.manpower_cost,
    pb.qty_produced,
    pb.status,
    pb.remarks,
    mi.id as memo_item_id,
    mi.qty_requested as target_qty,
    kb.id as kit_bom_id,
    kb.kit_no,
    kb.description as kit_description,
    kb.finished_item_id,
    kb.selling_price_per_unit,
    m.id as memo_id,
    m.memo_no,
    m.client_name,
    sum(pb.qty_produced) over (
      partition by mi.id order by pb.batch_date, pb.created_at
    ) as cumulative_qty_to_date,
    coalesce(bom_cost.material_cost_per_unit, 0) * pb.qty_produced as material_cost,
    coalesce(consumable_cost.consumable_cost, 0) as consumable_cost,
    coalesce(bom_cost.material_cost_per_unit, 0) * pb.qty_produced
      + coalesce(consumable_cost.consumable_cost, 0)
      + coalesce(pb.manpower_cost, 0) as total_cost,
    kb.selling_price_per_unit * pb.qty_produced as revenue
  from vas.production_batches pb
  join vas.memo_items mi on mi.id = pb.memo_item_id
  join vas.kit_boms kb on kb.id = mi.kit_bom_id
  join vas.memos m on m.id = mi.memo_id
  left join lateral (
    select sum(c.qty_per_kit * i.unit_cost) as material_cost_per_unit
    from vas.kit_bom_components c
    join vas.items i on i.id = c.component_item_id
    where c.kit_bom_id = kb.id
  ) bom_cost on true
  left join lateral (
    select sum(abs(sm.qty) * i.unit_cost) as consumable_cost
    from vas.stock_movements sm
    join vas.items i on i.id = sm.item_id
    where sm.reference_type = 'CONSUMABLE_ALLOCATION' and sm.reference_id = pb.id
  ) consumable_cost on true
)
select
  batch_id,
  batch_no,
  batch_date,
  manpower_count,
  manpower_cost,
  qty_produced,
  status,
  remarks,
  memo_item_id,
  target_qty,
  kit_bom_id,
  kit_no,
  kit_description,
  finished_item_id,
  selling_price_per_unit,
  memo_id,
  memo_no,
  client_name,
  cumulative_qty_to_date,
  material_cost,
  consumable_cost,
  total_cost,
  revenue,
  revenue - total_cost as profit,
  sum(material_cost) over (
    partition by memo_item_id order by batch_date, batch_id
  ) as cumulative_material_cost,
  sum(consumable_cost) over (
    partition by memo_item_id order by batch_date, batch_id
  ) as cumulative_consumable_cost,
  sum(manpower_cost) over (
    partition by memo_item_id order by batch_date, batch_id
  ) as cumulative_manpower_cost,
  sum(total_cost) over (
    partition by memo_item_id order by batch_date, batch_id
  ) as cumulative_total_cost,
  sum(revenue) over (
    partition by memo_item_id order by batch_date, batch_id
  ) as cumulative_revenue,
  sum(revenue - total_cost) over (
    partition by memo_item_id order by batch_date, batch_id
  ) as cumulative_profit
from base;

grant select on vas.v_production_progress to authenticated;
