-- ============================================================================
-- VAS Memo No. auto-numbering when left blank
-- ============================================================================
-- 0092 deliberately made memo_no required free text, matching the physical
-- memo paper from Sales exactly. In practice some of Mondial Sales' memos
-- don't carry a printed Memo No. at all, so VAS Officers had nothing to copy
-- and were stuck typing something just to satisfy the required field.
--
-- This keeps typed-in numbers as the priority (the paper's own number, when
-- it has one, should still be used verbatim) but lets the field be left
-- blank -- the trigger then assigns a running VAS-prefixed number from its
-- own sequence. Same per-document auto-numbering pattern already used for
-- transmittal_no (see 0012_transmittals.sql: sequence + before-insert
-- trigger that only fires when the column wasn't already supplied).
-- ============================================================================

create sequence if not exists vas.memo_seq;

-- SECURITY DEFINER so the calling role (authenticated, via RLS) doesn't need
-- direct USAGE grants on vas.memo_seq -- same reasoning as
-- public.set_transmittal_no() in 0012_transmittals.sql.
create or replace function vas.set_memo_no()
returns trigger
language plpgsql
security definer
set search_path = vas, public
as $$
begin
  if new.memo_no is not null and btrim(new.memo_no) <> '' then
    return new;
  end if;
  new.memo_no := 'VAS-' || lpad(nextval('vas.memo_seq')::text, 5, '0');
  return new;
end;
$$;

drop trigger if exists trg_set_vas_memo_no on vas.memos;
create trigger trg_set_vas_memo_no
  before insert on vas.memos
  for each row execute function vas.set_memo_no();
