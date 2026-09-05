-- Market dashboard — backend schema.
-- Paste into the Supabase SQL editor and run. Idempotent; safe to re-run.
--
-- Separate from schema.sql because the two have opposite ownership models.
-- `deals` is per-user data that only its owner may read. Everything here is
-- one shared public dataset that every SIGNED-IN user reads and NO user
-- writes — the ETL writes it with the service-role key, which bypasses RLS.
-- That is why the tables below have select policies and no insert/update
-- policies at all: the absence is the protection, not an oversight.
--
-- The read policies gate on `auth.uid() is not null` rather than on a specific
-- user. That single line is the lead-magnet gate: the dashboard is worthless
-- without a login, which is what makes it worth an email address.

-- ---------------------------------------------------------------------------
-- The long-format metric store
-- ---------------------------------------------------------------------------
-- One row per place / metric / property type / source / month. Long rather than
-- wide for two reasons: a new metric never needs a migration, and two sources
-- measuring the same thing sit side by side instead of fighting over a column.
-- The second matters — Zillow's days-on-market is list-to-pending and
-- Realtor.com's is list-to-off-market, they differ by roughly 2x for the same
-- county and month, and the product rule is to show both rather than pick.

create table if not exists public.market_metrics (
  geo_id        text not null,                 -- 5-digit FIPS (county) or 'z'+Zillow RegionID (city)
  metric        text not null,                 -- see METRICS in packages/core/src/market.ts
  property_type text not null,
  source        text not null,
  period        date not null,                 -- always the FIRST of the month
  value         numeric not null,
  geo_level     text not null,
  geo_name      text not null,
  county_fips   text not null,
  -- Column order is the query order, not the reading order: the dashboard asks
  -- "this place, this metric, every month", so geo_id and metric lead.
  primary key (geo_id, metric, property_type, source, period),
  constraint market_metrics_geo_level_check  check (geo_level in ('city', 'county')),
  constraint market_metrics_prop_type_check  check (property_type in ('all', 'sfr', 'condo')),
  -- Adding a source means adding it here. The check is deliberate: it is what
  -- stops Redfin data being loaded into the client-facing table by accident.
  -- Redfin's redistribution terms are unresolved, so it is private-view only.
  constraint market_metrics_source_check     check (source in ('zillow', 'realtor'))
);

-- Serves the compare view, which asks for one metric across up to three places.
create index if not exists market_metrics_metric_period_idx
  on public.market_metrics (metric, property_type, period);


-- ---------------------------------------------------------------------------
-- The place directory
-- ---------------------------------------------------------------------------
-- Computed by the ETL, not hand-maintained. It exists because Zillow publishes
-- *some* series for far more places than it publishes the core ones for: 92
-- California cities in the five counties appear in at least one file, but only
-- ~39 carry days-on-market and inventory through to the present. Listing all 92
-- in a city picker would hand a client an empty dashboard and no explanation.
--
-- `listable` is that filter. Cities below the bar are still queryable — a
-- direct link works and each tile suppresses itself individually — they just do
-- not appear in the picker.

create table if not exists public.market_geos (
  geo_id        text primary key,
  geo_level     text not null,
  geo_name      text not null,
  county_fips   text not null,
  county_name   text not null,
  listable      boolean not null default false,
  latest_period date,
  core_metrics  int not null default 0,        -- how many core metrics are current
  updated_at    timestamptz not null default now()
);

create index if not exists market_geos_listable_idx
  on public.market_geos (geo_level, listable, geo_name);


-- ---------------------------------------------------------------------------
-- Macro series — rates, Case-Shiller, county unemployment
-- ---------------------------------------------------------------------------
-- Not geo-scoped the way the housing metrics are, and mixed frequency (daily,
-- weekly, monthly), so it gets its own table rather than being forced into
-- market_metrics with a fake geo. County unemployment rides here as
-- 'UNEMP_<fips>' — it is a macro indicator that happens to have a county.

create table if not exists public.macro_series (
  series_id text not null,
  period    date not null,
  value     numeric not null,
  primary key (series_id, period)
);


-- ---------------------------------------------------------------------------
-- ETL run log — the "fail loudly" half
-- ---------------------------------------------------------------------------
-- A stale housing feed does not raise an error; it returns HTTP 200 and old
-- numbers. So staleness has to be asserted, recorded, and surfaced. The
-- workflow fails the job on a stale or failed run, and the dashboard reads the
-- latest row here to decide whether to show a banner. Readable by every
-- signed-in user on purpose: a client seeing "data as of July, checked 3 hours
-- ago" is trust, and a silent wrong number is the opposite.

create table if not exists public.etl_runs (
  id          bigint generated always as identity primary key,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  status      text not null,
  rows_written integer,
  detail      jsonb,
  constraint etl_runs_status_check check (status in ('running', 'ok', 'failed'))
);

create index if not exists etl_runs_started_idx on public.etl_runs (started_at desc);


-- ---------------------------------------------------------------------------
-- Profiles — the sign-up questionnaire
-- ---------------------------------------------------------------------------
-- Persona changes what the dashboard leads with: an investor wants yield and
-- absorption, a seller wants days-on-market and sale-to-list, a buyer wants
-- price cuts and negotiating leverage. One row per user, owned by that user.

create table if not exists public.profiles (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  persona     text,
  home_geo_id text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint profiles_persona_check check (persona in ('investor', 'seller', 'buyer'))
);


-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.market_metrics enable row level security;
alter table public.market_geos    enable row level security;
alter table public.macro_series   enable row level security;
alter table public.etl_runs       enable row level security;
alter table public.profiles       enable row level security;

-- Shared reference data: any signed-in user reads, nobody writes through the
-- publishable key. No insert/update/delete policy is defined anywhere below,
-- and under RLS an operation with no policy is denied.
drop policy if exists "market_metrics: read signed in" on public.market_metrics;
create policy "market_metrics: read signed in" on public.market_metrics
  for select using (auth.uid() is not null);

drop policy if exists "market_geos: read signed in" on public.market_geos;
create policy "market_geos: read signed in" on public.market_geos
  for select using (auth.uid() is not null);

drop policy if exists "macro_series: read signed in" on public.macro_series;
create policy "macro_series: read signed in" on public.macro_series
  for select using (auth.uid() is not null);

drop policy if exists "etl_runs: read signed in" on public.etl_runs;
create policy "etl_runs: read signed in" on public.etl_runs
  for select using (auth.uid() is not null);

-- Profiles are per-user, so they follow the `deals` pattern: four explicit
-- policies, with_check on write so a client cannot create a row it does not own.
drop policy if exists "profiles: read own"   on public.profiles;
drop policy if exists "profiles: insert own" on public.profiles;
drop policy if exists "profiles: update own" on public.profiles;

create policy "profiles: read own"   on public.profiles for select using (auth.uid() = user_id);
create policy "profiles: insert own" on public.profiles for insert with check (auth.uid() = user_id);
create policy "profiles: update own" on public.profiles for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- keep updated_at honest even if a client forgets to send it.
-- schema.sql defines this too; repeated here so this file can be run first or
-- alone without a "function does not exist" failure.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();
