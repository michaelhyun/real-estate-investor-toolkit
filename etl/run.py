"""Pull every feed, assert it is fresh, and load it. The whole ETL entry point.

    python3 etl/run.py            # pull, check, load
    python3 etl/run.py --dry-run  # pull and check only, print a summary

FAIL LOUDLY IS THE POINT. A housing feed that dies does not return an error, it
returns HTTP 200 and last quarter's numbers — Redfin's legacy S3 paths have been
doing exactly that since May 2026. So this script treats "the newest month is
older than it should be" as a hard failure, exits non-zero so the GitHub Actions
run goes red, and records the reason in etl_runs for the dashboard to surface.
A silent success on stale data is the failure mode worth engineering against.
"""

from __future__ import annotations

import sys
import traceback
from datetime import date

import load
import pull
import sources as S

# A city needs these, current, to be worth putting in the picker. They are the
# metrics every persona's headline reads from; without them the page is empty.
CORE_METRICS = ('dom_median', 'inventory', 'new_listings')

# How many of the last N months a core metric must appear in to count as
# current. Zillow suppresses a thin month rather than publishing a noisy median,
# so a real market can legitimately miss one.
RECENT_WINDOW = 6
RECENT_REQUIRED = 3


def _months_between(a: str, b: str) -> int:
    ay, am = int(a[:4]), int(a[5:7])
    by, bm = int(b[:4]), int(b[5:7])
    return (by - ay) * 12 + (bm - am)


def _today_month() -> str:
    t = date.today()
    return f'{t.year:04d}-{t.month:02d}-01'


def check_freshness(rows, source: str) -> str:
    """Raise if `source`'s newest month is older than its contract allows."""
    periods = [r[7] for r in rows if r[5] == source]
    if not periods:
        raise RuntimeError(f'{source}: no rows at all — the feed or the filter broke')
    newest = max(periods)
    lag = _months_between(newest, _today_month())
    limit = S.MAX_STALENESS_MONTHS[source]
    if lag > limit:
        raise RuntimeError(
            f'{source} is STALE: newest month is {newest}, {lag} months behind '
            f'(limit {limit}). The URL probably still returns 200 — check whether '
            f'the publisher moved the files before touching this threshold.')
    return newest


def build_geos(rows):
    """Derive the place directory, including which cities are worth listing."""
    recent = sorted({r[7] for r in rows})[-RECENT_WINDOW:]
    recent_set = set(recent)

    geos, present = {}, {}
    for geo_level, geo_id, geo_name, fips, pt, src, metric, period, _v in rows:
        g = geos.get(geo_id)
        if g is None:
            g = geos[geo_id] = {
                'geo_id': geo_id, 'geo_level': geo_level, 'geo_name': geo_name,
                'county_fips': fips, 'county_name': S.COUNTIES[fips],
                'latest_period': period, 'listable': False, 'core_metrics': 0,
            }
        if period > g['latest_period']:
            g['latest_period'] = period
        if pt == 'all' and metric in CORE_METRICS and period in recent_set:
            present.setdefault(geo_id, {}).setdefault(metric, set()).add(period)

    for geo_id, g in geos.items():
        have = present.get(geo_id, {})
        n = sum(1 for m in CORE_METRICS
                if len(have.get(m, ())) >= RECENT_REQUIRED)
        g['core_metrics'] = n
        # Counties are always listable — they are the fallback a thin city
        # falls back TO, so hiding one would strand its cities.
        g['listable'] = g['geo_level'] == 'county' or n == len(CORE_METRICS)

    return list(geos.values())


def to_metric_dicts(rows):
    keys = ('geo_level', 'geo_id', 'geo_name', 'county_fips', 'property_type',
            'source', 'metric', 'period', 'value')
    return [dict(zip(keys, r)) for r in rows]


def main() -> int:
    dry = '--dry-run' in sys.argv
    run_id = None
    written = 0
    detail: dict = {}

    try:
        print('pulling Zillow city…',   flush=True)
        rows = pull.zillow_rows('city')
        print('pulling Zillow county…', flush=True)
        rows += pull.zillow_rows('county')
        print('pulling Realtor.com county…', flush=True)
        rows += pull.realtor_county_rows()

        detail['zillow_newest']  = check_freshness(rows, 'zillow')
        detail['realtor_newest'] = check_freshness(rows, 'realtor')

        print('pulling FRED…', flush=True)
        macro = [{'series_id': s, 'period': d, 'value': v}
                 for s, d, v in pull.fred_rows()]
        print('pulling BLS…', flush=True)
        macro += [{'series_id': f'UNEMP_{fips}', 'period': d, 'value': v}
                  for fips, d, v in pull.bls_rows()]

        geos = build_geos(rows)
        listable = [g for g in geos if g['listable'] and g['geo_level'] == 'city']

        detail.update({
            'metric_rows': len(rows),
            'macro_rows': len(macro),
            'geos': len(geos),
            'listable_cities': len(listable),
        })

        print(f"\n  metric rows      {len(rows):>9,}")
        print(f"  macro rows       {len(macro):>9,}")
        print(f"  places           {len(geos):>9,}")
        print(f"  listable cities  {len(listable):>9,}")
        print(f"  zillow newest    {detail['zillow_newest']}")
        print(f"  realtor newest   {detail['realtor_newest']}")

        if dry:
            for g in sorted(listable, key=lambda g: (g['county_name'], g['geo_name'])):
                print(f"    {g['county_name']:<16s} {g['geo_name']}")
            return 0

        run_id = load.start_run()
        written += load.upsert('market_geos', geos, 'geo_id')
        written += load.upsert(
            'market_metrics', to_metric_dicts(rows),
            'geo_id,metric,property_type,source,period')
        written += load.upsert('macro_series', macro, 'series_id,period')

        load.finish_run(run_id, 'ok', written, detail)
        print(f'\nloaded {written:,} rows')
        return 0

    except Exception as exc:
        detail['error'] = str(exc)
        traceback.print_exc()
        if run_id is not None:
            try:
                load.finish_run(run_id, 'failed', written, detail)
            except Exception:
                pass                      # never mask the original failure
        print(f'\nETL FAILED: {exc}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
