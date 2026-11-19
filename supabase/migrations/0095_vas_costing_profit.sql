-- ============================================================================
-- VAS cost/profit tracking: unit cost on items, selling price on kits,
-- manpower cost on production batches, and a profit breakdown surfaced on
-- the existing "Progress per Kit Line" report (vas.v_production_progress).
-- ============================================================================
-- Design, per conversation with the user: for every kitting batch they want
-- to see how much it costs to produce (materials used + consumables
-- allocated to that specific batch, via the CONSUMABLE_ALLOCATION mechanism
-- from migration -- see stock_movements.reference_id -- + manpower cost)
-- against how much the client is billed for it (selling price per finished
-- unit x qty produced), so Profit = Revenue - Total Cost is visible per
-- batch and cumulatively per kit/memo line.
-- ============================================================================

alter table vas.items
  add column if not exists unit_cost numeric not null default 0;

alter table vas.kit_boms
  add column if not exists selling_price_per_unit numeric not null default 0;

alter table vas.production_batches
  add column if not exists manpower_cost numeric not null default 0;

-- Replace the progress view with the same shape plus a cost/revenue/profit
-- breakdown, both per-batch and cumulative per memo line (same window-
-- function pattern already used for cumulative_qty_to_date).
drop view if exists vas.v_production_progress;

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
    -- Material cost per finished unit: sum of (qty of each BOM component
    -- per kit x that component's unit_cost). Excludes CONSUMABLE items by
    -- construction -- kit_bom_components only ever references COMPONENT
    -- items (see 0092's trg_validate_kit_bom_component_item).
    select sum(c.qty_per_kit * i.unit_cost) as material_cost_per_unit
    from vas.kit_bom_components c
    join vas.items i on i.id = c.component_item_id
    where c.kit_bom_id = kb.id
  ) bom_cost on true
  left join lateral (
    -- Consumable cost actually allocated to THIS batch -- only movements
    -- the VAS Officer tagged with this batch via the Stock Ledger's "Used
    -- For (Batch/Project)" dropdown (reference_type = CONSUMABLE_ALLOCATION,
    -- reference_id = this batch's id). Untagged/general consumable usage is
    -- intentionally excluded -- it isn't attributable to any one project.
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
