-- Schema for FLO-Principal invoices: clients other than Mondial (billed on
-- a separate system). Unlike Mondial's fee_rates (rate depends on zone),
-- each principal has its own flat service rate -- optionally split by DC
-- the same way fee_rates splits Consignment/Outright by is_dc.
--
-- ASSUMPTION (flag to user): Healthwellness Lifestyle, Inc. was given two
-- rates, 13% and 17%, with no stated distinguishing factor. This models
-- them as its non-DC / DC rates -- the same is_dc split already used
-- everywhere else in the schema -- since that's the only existing binary
-- distinction available. Confirm with the user and adjust the seed data
-- below if that's not what the two rates actually mean.

create table principals (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz default now()
);

create table principal_rates (
  id uuid primary key default gen_random_uuid(),
  principal_id uuid not null references principals(id) on delete cascade,
  is_dc boolean not null default false,
  rate_pct numeric(5,2) not null,
  unique (principal_id, is_dc)
);

insert into principals (name) values
  ('Adesteck Marketing Corp'),
  ('Rodzon Marketing Corporation'),
  ('Healthwellness Lifestyle, Inc.');

insert into principal_rates (principal_id, is_dc, rate_pct)
select id, false, 10.00 from principals where name = 'Adesteck Marketing Corp'
union all
select id, false, 12.00 from principals where name = 'Rodzon Marketing Corporation'
union all
select id, false, 13.00 from principals where name = 'Healthwellness Lifestyle, Inc.'
union all
select id, true, 17.00 from principals where name = 'Healthwellness Lifestyle, Inc.';

-- Invoices belonging to a FLO-Principal record which principal they're for
-- (analogous to zone for the Mondial categories -- set later from Recently
-- Encoded, once known). Null for the 3 Mondial categories.
alter table invoices add column principal_id uuid references principals(id);

-- ── RLS: same pattern as fee_rates (static reference, Admin-managed) ───────
alter table principals enable row level security;
alter table principal_rates enable row level security;

revoke all on principals, principal_rates from anon;

create policy "principals select" on principals for select to authenticated using (true);
create policy "principals write" on principals for all to authenticated
  using (public.current_user_role() = 'ADMIN')
  with check (public.current_user_role() = 'ADMIN');

create policy "principal_rates select" on principal_rates for select to authenticated using (true);
create policy "principal_rates write" on principal_rates for all to authenticated
  using (public.current_user_role() = 'ADMIN')
  with check (public.current_user_role() = 'ADMIN');
