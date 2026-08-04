-- Real Estate Investor Toolkit — backend schema.
-- Paste into the Supabase SQL editor and run. Safe to re-run.
--
-- One row per (user, deal name). The whole DealState rides in `data` as jsonb
-- so the calculator can gain fields without a migration. Row-level security is
-- the only thing standing between users' data and the publishable key that
-- ships in the browser bundle — every policy below is load-bearing.

create table if not exists public.deals (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null,
  data        jsonb not null,
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  constraint deals_user_name_key unique (user_id, name)
);

-- the app always filters by the signed-in user; index it
create index if not exists deals_user_id_idx on public.deals (user_id);

alter table public.deals enable row level security;

-- Four explicit policies rather than one FOR ALL: with_check on insert/update
-- is what stops a client from writing rows owned by someone else.
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
