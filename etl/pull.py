"""Download each feed and flatten it to one common row shape.

Every source here is wide — one row per place, one column per month. The
dashboard wants the opposite (one row per place/metric/month) so that adding a
metric never needs a migration and so that two sources measuring the same thing
can sit side by side, which is the whole point of the "show both when they
disagree" rule.

The common shape, matching public.market_metrics:

    (geo_level, geo_id, geo_name, county_fips, property_type,
     source, metric, period, value)

`geo_id` is the stable join key: 5-digit FIPS for a county, 'z' + Zillow
RegionID for a city. Never join on a place name — 24 California city names map
to more than one region id.
"""

from __future__ import annotations

import csv
import gzip
import io
import json
import urllib.request
from datetime import date

import sources as S

UA = {'User-Agent': 'bluedoor-market-etl/1.0 (+https://github.com/michaelhyun)'}


def _fetch(url: str, timeout: int = 300) -> str:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read()
    if raw[:2] == b'\x1f\x8b':
        raw = gzip.decompress(raw)
    return raw.decode('utf-8-sig', errors='replace')


def _month_columns(fieldnames):
    """Zillow's month columns are ISO dates; everything else is metadata."""
    return [c for c in fieldnames if len(c) == 10 and c[:2] == '20' and c[4] == '-']


def _period(col: str) -> str:
    """Zillow labels a month by its LAST day. Normalise to the first, so a
    Zillow month and a Realtor.com month land on the same date and can join."""
    return col[:8] + '01'


def _num(v):
    if v is None or v == '':
        return None
    try:
        f = float(v)
    except ValueError:
        return None
    return f if f == f else None          # drop NaN


# ---------------------------------------------------------------------------
# Zillow
# ---------------------------------------------------------------------------

def zillow_rows(geo_level: str):
    """All Zillow series for one geo level, filtered to the five counties."""
    rows = []
    for metric, url, pt in S.zillow_plan(geo_level):
        text = _fetch(url)
        rdr = csv.DictReader(io.StringIO(text))
        months = _month_columns(rdr.fieldnames)
        if not months:
            raise RuntimeError(f'no month columns in {url} — schema changed')

        for rec in rdr:
            if rec.get('State') != 'CA':
                continue

            if geo_level == 'city':
                fips = S.COUNTY_NAME_TO_FIPS.get(rec.get('CountyName', ''))
                if not fips:
                    continue
                geo_id = 'z' + rec['RegionID']
                geo_name = rec['RegionName']
            else:
                # The county files carry real FIPS in two columns; the city
                # files carry none, which is why the name map above exists.
                fips = f"{rec.get('StateCodeFIPS','')}{rec.get('MunicipalCodeFIPS','')}"
                if fips not in S.COUNTIES:
                    continue
                geo_id = fips
                geo_name = rec['RegionName']

            for col in months:
                v = _num(rec.get(col))
                if v is None:
                    continue
                rows.append((geo_level, geo_id, geo_name, fips, pt,
                             'zillow', metric, _period(col), v))
    return rows


# ---------------------------------------------------------------------------
# Realtor.com
# ---------------------------------------------------------------------------

def realtor_county_rows():
    """Realtor.com's county history, filtered to the five counties.

    The file is ~98 MB and streams fine, so it is parsed incrementally rather
    than read into memory. `quality_flag` marks a month the publisher itself
    considers unreliable; those rows are dropped rather than charted.
    """
    req = urllib.request.Request(S.REALTOR_COUNTY_URL, headers=UA)
    rows = []
    with urllib.request.urlopen(req, timeout=600) as resp:
        stream = io.TextIOWrapper(resp, encoding='utf-8-sig', errors='replace')
        for rec in csv.DictReader(stream):
            fips = str(rec.get('county_fips', '')).zfill(5)
            if fips not in S.COUNTIES:
                continue
            if str(rec.get('quality_flag', '0')).strip() not in ('', '0', '0.0'):
                continue

            ym = rec['month_date_yyyymm']           # e.g. '202608'
            period = f'{ym[:4]}-{ym[4:]}-01'
            geo_name = f'{S.COUNTIES[fips]} County'

            for col, metric in S.REALTOR_METRICS.items():
                v = _num(rec.get(col))
                if v is None:
                    continue
                # Realtor.com publishes shares as fractions (0.1363); Zillow
                # publishes them as percents (13.63). Normalise to percent so a
                # chart can hold both without a per-source unit lookup.
                if metric in ('price_cut_share', 'price_increase_share'):
                    v *= 100.0
                rows.append(('county', fips, geo_name, fips, 'all',
                             'realtor', metric, period, v))
    return rows


# ---------------------------------------------------------------------------
# Macro
# ---------------------------------------------------------------------------

def fred_rows():
    """One keyless request per series — see the trap noted in sources.py.

    FRED writes a gap in a daily series as '.', which `_num` drops.
    """
    out = []
    for series_id in S.FRED_SERIES:
        rdr = csv.reader(io.StringIO(_fetch(S.fred_url(series_id), timeout=120)))
        header = next(rdr, None)
        if not header or len(header) < 2:
            raise RuntimeError(f'FRED returned no data for {series_id}')
        for row in rdr:
            if not row or not row[0]:
                continue
            v = _num(row[1])
            if v is not None:
                out.append((series_id, row[0], v))
    return out


def bls_rows():
    """County unemployment rate. Jobs lead housing, and this is the best local
    leading indicator that is not itself a housing metric."""
    this_year = date.today().year
    body = json.dumps({
        'seriesid': list(S.BLS_SERIES),
        'startyear': str(this_year - 9),      # v1 caps a request at 10 years
        'endyear': str(this_year),
    }).encode()
    req = urllib.request.Request(
        S.BLS_URL, data=body,
        headers={**UA, 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=180) as r:
        payload = json.load(r)

    if payload.get('status') != 'REQUEST_SUCCEEDED':
        raise RuntimeError(f'BLS refused the request: {payload.get("message")}')

    out = []
    for series in payload['Results']['series']:
        fips = S.BLS_SERIES[series['seriesID']]
        for pt in series['data']:
            if not pt['period'].startswith('M') or pt['period'] == 'M13':
                continue                      # M13 is the annual average
            v = _num(pt['value'])
            if v is not None:
                out.append((fips, f"{pt['year']}-{pt['period'][1:]}-01", v))
    return out
