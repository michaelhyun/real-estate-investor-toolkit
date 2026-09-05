"""Every external feed the market dashboard reads, declared in one place.

WHY THIS FILE IS DECLARATIVE: the failure mode that kills a housing-data
pipeline is not a crash, it is a URL that still returns HTTP 200 while the file
behind it has quietly stopped being updated. Redfin did exactly this in May 2026
— the legacy S3 paths still serve a complete file whose newest row is months
old. Nothing errors; the dashboard just lies. So every source here carries an
expected freshness, `run.py` checks it, and a stale feed fails the run loudly
rather than publishing stale numbers.

THE PUBLIC/PRIVATE LINE. Decided 2026-09-04, see the vault note "Market
Dashboard Requirements". Redfin's Terms of Use are ambiguous about whether the
deliberately-published bulk downloads may be redistributed, so Redfin is not in
this file at all — the client-facing dashboard is built only on sources whose
licences plainly permit it:

  * Zillow Research  — free for public use with clear attribution
  * Realtor.com      — free public data library
  * FRED / BLS       — US government works, public domain

The cost of that line is real and is not worked around here: Redfin is the only
free source publishing sold counts below metro level, so MONTHS OF SUPPLY CANNOT
BE COMPUTED. `pending_ratio` (county) and `market_heat` (city) stand in for it.
See METRICS in packages/core/src/market.ts for how that is disclosed in the UI.
"""

# --------------------------------------------------------------------------
# Geography — V1 is the five Bay Area counties and the cities inside them.
# FIPS is the join key everywhere. Names differ between sources; FIPS never does.
# --------------------------------------------------------------------------

COUNTIES = {
    '06001': 'Alameda',
    '06013': 'Contra Costa',
    '06075': 'San Francisco',
    '06081': 'San Mateo',
    '06085': 'Santa Clara',
}

# Zillow labels counties "Alameda County"; Realtor.com labels them "alameda, ca".
# Neither is a join key. This maps Zillow's *city* file, whose only county
# reference is the plain name in `CountyName`, back onto FIPS.
COUNTY_NAME_TO_FIPS = {f'{name} County': fips for fips, name in COUNTIES.items()}


# --------------------------------------------------------------------------
# Zillow Research — the city layer, and a county layer used as the cross-check
# --------------------------------------------------------------------------

ZILLOW_BASE = 'https://files.zillowstatic.com/research/public_csvs'

# Zillow encodes the property-type cut in the filename: `uc_sfrcondo` is all
# homes, `uc_sfr` single-family only, `uc_condo` condo only. There is no condo
# file for most series, which is why the UI's property-type split is
# "All homes vs Single-family" rather than "SFR vs Condo" — see market.ts.
#
# `sm` = smoothed (a 3-month rolling window, which is Zillow already doing the
# thin-market smoothing we would otherwise have had to build). `sa` = seasonally
# adjusted, and applies only to ZHVI. NEVER chart an `sa` series against an
# unadjusted one in the same "is the market up" claim.
#
# (metric, folder, file stem, property_type)
ZILLOW_SERIES = [
    # Days on market, measured list-to-pending. This is the definition Michael
    # locked, and Zillow is the only free source that measures literally it.
    ('dom_median',        'med_doz_pending',        'med_doz_pending',        'all'),
    ('dom_median',        'med_doz_pending',        'med_doz_pending',        'sfr'),
    ('dom_mean',          'mean_doz_pending',       'mean_doz_pending',       'all'),
    ('dom_mean',          'mean_doz_pending',       'mean_doz_pending',       'sfr'),

    ('inventory',         'invt_fs',                'invt_fs',                'all'),
    ('inventory',         'invt_fs',                'invt_fs',                'sfr'),

    ('new_listings',      'new_listings',           'new_listings',           'all'),
    ('new_listings',      'new_listings',           'new_listings',           'sfr'),

    ('median_sale_price', 'median_sale_price',      'median_sale_price',      'all'),
    ('median_sale_price', 'median_sale_price',      'median_sale_price',      'sfr'),

    ('price_cut_share',   'perc_listings_price_cut', 'perc_listings_price_cut', 'all'),
    ('price_cut_share',   'perc_listings_price_cut', 'perc_listings_price_cut', 'sfr'),

    # Sale-to-list has no single-family variant published — combined only.
    # Verified 2026-09-04: the `uc_sfr` URLs 404.
    ('sale_to_list_mean',   'mean_sale_to_list',   'mean_sale_to_list',   'all'),
    ('sale_to_list_median', 'median_sale_to_list', 'median_sale_to_list', 'all'),
]

# Two series break the `_sm_month` filename convention, so they are listed apart
# rather than special-cased inside the URL builder.
ZILLOW_SERIES_UNSMOOTHED = [
    # Zillow's own absorption/leverage measure. It stands in for months of
    # supply at city level, which no permissively-licensed source publishes.
    ('market_heat', 'market_temp_index', 'market_temp_index', 'all'),
]

ZILLOW_SERIES_ZHVI = [
    ('home_value', 'zhvi', 'zhvi', 'all'),
    ('home_value', 'zhvi', 'zhvi', 'sfr'),
    ('home_value', 'zhvi', 'zhvi', 'condo'),   # the one series with a condo cut
]

_PT_SLUG = {'all': 'uc_sfrcondo', 'sfr': 'uc_sfr', 'condo': 'uc_condo'}


def zillow_url(geo_level: str, folder: str, stem: str, property_type: str,
               kind: str = 'smoothed') -> str:
    """Build a Zillow public CSV URL.

    `geo_level` is Zillow's own capitalisation — 'City' or 'County'.
    """
    geo = 'City' if geo_level == 'city' else 'County'
    pt = _PT_SLUG[property_type]
    if kind == 'zhvi':
        # ZHVI carries the middle-tier band and the seasonal adjustment in the name
        name = f'{geo}_{stem}_{pt}_tier_0.33_0.67_sm_sa_month.csv'
    elif kind == 'raw':
        name = f'{geo}_{stem}_{pt}_month.csv'
    else:
        name = f'{geo}_{stem}_{pt}_sm_month.csv'
    return f'{ZILLOW_BASE}/{folder}/{name}'


def zillow_plan(geo_level: str):
    """Every (metric, url, property_type) this run should pull for one geo level."""
    plan = []
    for metric, folder, stem, pt in ZILLOW_SERIES:
        plan.append((metric, zillow_url(geo_level, folder, stem, pt), pt))
    for metric, folder, stem, pt in ZILLOW_SERIES_UNSMOOTHED:
        plan.append((metric, zillow_url(geo_level, folder, stem, pt, 'raw'), pt))
    for metric, folder, stem, pt in ZILLOW_SERIES_ZHVI:
        plan.append((metric, zillow_url(geo_level, folder, stem, pt, 'zhvi'), pt))
    return plan


# --------------------------------------------------------------------------
# Realtor.com — the county layer. Listing-side only: no sold price, no
# sale-to-list, no sold counts. Use it for inventory and momentum, never for
# what homes actually sold for.
# --------------------------------------------------------------------------

REALTOR_COUNTY_URL = (
    'https://econdata.s3-us-west-2.amazonaws.com/Reports/Core/'
    'RDC_Inventory_Core_Metrics_County_History.csv'
)

# Realtor.com's `median_days_on_market` is list-to-OFF-MARKET, not
# list-to-pending. It runs roughly double Zillow's number for the same county
# and month. That is not an error in either source and it is not reconciled
# here — the dashboard shows both and names the definition, which is the rule
# Michael set for disagreeing sources.
REALTOR_METRICS = {
    'median_days_on_market':                 'dom_median',
    'active_listing_count':                  'inventory',
    'new_listing_count':                     'new_listings',
    'pending_listing_count':                 'pending',
    'pending_ratio':                         'pending_ratio',
    'price_reduced_share':                   'price_cut_share',
    'price_increased_share':                 'price_increase_share',
    'median_listing_price':                  'median_list_price',
    'median_listing_price_per_square_foot':  'list_ppsf',
    'median_square_feet':                    'median_sqft',
    'total_listing_count':                   'total_listings',
}


# --------------------------------------------------------------------------
# Macro — FRED's keyless CSV endpoint, and BLS county unemployment.
# Both are US government works: public domain, no key, no licence question.
# --------------------------------------------------------------------------

# FRED's documented API needs a key. This graph endpoint does not.
#
# TRAP, verified 2026-09-04: asking for several ids at once returns a ZIP
# (README.txt + daily.csv + monthly.csv + weekly.csv) whenever the requested
# series do not share a frequency — and these do not, they are weekly, daily and
# monthly. The response is still HTTP 200 with a .csv in the URL, so a naive
# reader gets binary and a confusing "line contains NUL". One id per request
# always returns a plain CSV, so that is what this does. Six small requests.
FRED_SERIES = {
    'MORTGAGE30US': '30-year fixed mortgage rate',
    'MORTGAGE15US': '15-year fixed mortgage rate',
    'DGS10':        '10-year Treasury yield',
    'SFXRSA':       'Case-Shiller San Francisco home price index',
    'UNRATE':       'US unemployment rate',
    'FEDFUNDS':     'Federal funds rate',
}


def fred_url(series_id: str) -> str:
    return f'https://fred.stlouisfed.org/graph/fredgraph.csv?id={series_id}'

# BLS LAUS series id = 'LAUCN' + 5-digit county FIPS + '0000000003' (unemployment
# rate). The v1 API takes no key but caps a request at 25 series and 10 years.
BLS_URL = 'https://api.bls.gov/publicAPI/v1/timeseries/data/'
BLS_SERIES = {f'LAUCN{fips}0000000003': fips for fips in COUNTIES}


# --------------------------------------------------------------------------
# Freshness contract — what "this feed is still alive" means, per source.
# --------------------------------------------------------------------------

# Months of slack allowed between today and the newest period in a feed before
# the run fails. Zillow publishes mid-month for the prior month, so two months
# of slack is normal and three means something broke. Realtor.com publishes
# within days of month end.
MAX_STALENESS_MONTHS = {
    'zillow':  3,
    'realtor': 2,
}
