-- Real Estate Investor Toolkit — backend schema.
-- Paste into the Supabase SQL editor and run. Safe to re-run, and safe to run
-- against a database that predates the `kind` column.
--
-- One row per (user, tool, deal name). The whole deal state rides in `data` as
-- jsonb so a calculator can gain fields without a migration. Row-level security
-- is the only thing standing between users' data and the publishable key that
-- ships in the browser bundle — every policy below is load-bearing.
--
-- `kind` names the tool that owns the row. It exists because every tool uses the
-- property address as the deal title, so without it the same house underwritten
-- as a rental and as a flip would collide on (user_id, name) — one save would
-- overwrite the other, and mergeDeals() would treat two unrelated underwrites as
-- two versions of one deal.

create table if not exists public.deals (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  kind        text not null default 'rental',
  name        text not null,
  data        jsonb not null,
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Migration for databases created before `kind` existed.
-- `create table if not exists` above is a no-op on an existing table, so the
-- column, the constraint swap and the index all have to be done explicitly.
-- Every statement here is idempotent.
-- ---------------------------------------------------------------------------

-- Existing rows are all rentals — the default backfills them in place.
alter table public.deals add column if not exists kind text not null default 'rental';

-- Guard against a typo'd kind silently creating a phantom deal list that the
-- UI would never show. Adding a tool means adding its slug here.
alter table public.deals drop constraint if exists deals_kind_check;
alter table public.deals add  constraint deals_kind_check check (kind in ('rental', 'flip'));

-- The uniqueness rule moves from (user, name) to (user, tool, name). Dropping
-- the old constraint first is what lets one address exist as both a rental deal
-- and a flip deal.
alter table public.deals drop constraint if exists deals_user_name_key;
alter table public.deals drop constraint if exists deals_user_kind_name_key;
alter table public.deals add  constraint deals_user_kind_name_key unique (user_id, kind, name);

-- Every query filters by user and tool together. This index serves those and,
-- on its user_id prefix, any query that filters by user alone — so the old
-- user_id-only index is redundant.
create index if not exists deals_user_kind_idx on public.deals (user_id, kind);
drop index if exists public.deals_user_id_idx;

alter table public.deals enable row level security;

-- Four explicit policies rather than one FOR ALL: with_check on insert/update
-- is what stops a client from writing rows owned by someone else. `kind` needs
-- no policy of its own — it partitions one user's own rows, it isn't a
-- security boundary between users.
drop policy if exists "deals: read own"   on public.deals;
drop policy if exists "deals: insert own" on public.deals;
drop policy if exists "deals: update own" on public.deals;
drop policy if exists "deals: delete own" on public.deals;

create policy "deals: read own"   on public.deals for select using (auth.uid() = user_id);
create policy "deals: insert own" on public.deals for insert with check (auth.uid() = user_id);
create policy "deals: update own" on public.deals for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "deals: delete own" on public.deals for delete using (auth.uid() = user_id);

-- keep updated_at honest even if a client forgets to send it
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists deals_touch_updated_at on public.deals;
create trigger deals_touch_updated_at
  before update on public.deals
  for each row execute function public.touch_updated_at();
