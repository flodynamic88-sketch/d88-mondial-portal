-- ============================================================================
-- VAS: reverse stock_movements when their originating row is deleted
-- ============================================================================
-- 0092 gave production_batches an AFTER INSERT OR UPDATE OF qty_produced
-- trigger (vas.record_batch_production) and warehouse_transfers an AFTER
-- INSERT trigger (vas.record_warehouse_transfer), each of which posts rows
-- into vas.stock_movements. Neither table had a matching delete-time
-- trigger, so deleting a batch or transfer (e.g. a sample/test entry) left
-- its BATCH_CONSUMPTION/BATCH_OUTPUT/WAREHOUSE_TRANSFER stock_movements
-- rows behind -- permanently skewing vas.v_stock_balance, which is always
-- derived live and never cached.
--
-- This adds a BEFORE DELETE trigger on each table that removes exactly the
-- stock_movements rows that row's own insert/update trigger created,
-- matched by reference_type + reference_id = the deleted row's id. Nothing
-- else about those triggers changes.
-- ============================================================================

create or replace function vas.cleanup_batch_stock_movements()
returns trigger
language plpgsql
security definer
set search_path = vas, public
as $$
begin
  delete from vas.stock_movements
  where reference_type in ('BATCH_CONSUMPTION', 'BATCH_OUTPUT')
    and reference_id = old.id;
  return old;
end;
$$;

drop trigger if exists trg_cleanup_batch_stock_movements on vas.production_batches;
create trigger trg_cleanup_batch_stock_movements
  before delete on vas.production_batches
  for each row execute function vas.cleanup_batch_stock_movements();

create or replace function vas.cleanup_transfer_stock_movements()
returns trigger
language plpgsql
security definer
set search_path = vas, public
as $$
begin
  delete from vas.stock_movements
  where reference_type = 'WAREHOUSE_TRANSFER'
    and reference_id = old.id;
  return old;
end;
$$;

drop trigger if exists trg_cleanup_transfer_stock_movements on vas.warehouse_transfers;
create trigger trg_cleanup_transfer_stock_movements
  before delete on vas.warehouse_transfers
  for each row execute function vas.cleanup_transfer_stock_movements();
