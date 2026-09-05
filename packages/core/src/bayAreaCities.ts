/* Bay Area city presets for the flip analyzer — Santa Clara, Alameda and San
   Mateo counties.

   Transfer tax rates are from the California City Finance schedule effective
   1 December 2025 (californiacityfinance.com/PropTransfTaxRates.pdf), the table
   county recorders and title companies work from, cross-checked against the
   Santa Clara County Clerk-Recorder and the City of San José for Measure E.
   Every entry carries `verifiedOn` so a stale preset is visible rather than
   silently wrong, and every value the UI fills in stays editable.

   TIERS ARE CLIFFS, NOT MARGINAL BRACKETS. In San Jose, Berkeley, Mountain View
   and the city of San Mateo, crossing a threshold taxes the *entire*
   consideration at the higher rate — not just the excess. $2,299,000 and
   $2,301,000 in San Jose differ by roughly $17,000 of tax. `cityTransferTax`
   below evaluates the bracket against full value for exactly this reason. */

export const COUNTY_TRANSFER_PER_1000 = 1.10;   /* $0.55 per $500, every CA county */

/** A cliff bracket: applies to the whole value once it is >= `from`. */
export interface TaxTier {
  /** lower bound of the bracket, inclusive */
  from: number;
  /** dollars per $1,000 of full consideration */
  per1000?: number;
  /** percent of full consideration — used where the city states a % instead */
  pct?: number;
}

export interface CityPreset {
  slug: string;
  name: string;
  county: 'Santa Clara' | 'Alameda' | 'San Mateo';
  /** city transfer tax tiers, ascending by `from`; empty = county rate only */
  tiers: TaxTier[];
  /** local custom for who pays the city transfer tax */
  payer: 'seller' | 'buyer' | 'split';
  /** levied property tax rate: 1% Prop 13 base + typical voter-approved bonds.
      Approximate — the true rate is set per tax rate area and varies inside a
      single city, so this is a starting point to override from a real bill. */
  taxRatePct: number;
  /** retrofit items that apply on sale in this city, with typical cost */
  retrofit: { label: string; cost: number }[];
  /** typical permit cost for a full-house remodel */
  permit: number;
  verifiedOn: string;
  note?: string;
}

/* Retrofit bundles — most CA cities require the state items; the sewer lateral
   certificate is what varies and it is the expensive one. */
const STATE_RETROFIT = [
  { label: 'Smoke & CO alarms', cost: 250 },
  { label: 'Water heater strapping', cost: 200 },
];
const WITH_LATERAL = [
  ...STATE_RETROFIT,
  { label: 'Sewer lateral compliance certificate', cost: 2800 },
];

const V = '2025-12-01';

/** Cities with no city transfer tax — county $1.10 per $1,000 only. */
function plain(
  slug: string, name: string, county: CityPreset['county'],
  taxRatePct: number, permit: number,
  retrofit: { label: string; cost: number }[] = STATE_RETROFIT,
): CityPreset {
  return { slug, name, county, tiers: [], payer: 'seller', taxRatePct, retrofit, permit, verifiedOn: V };
}

export const CITY_PRESETS: CityPreset[] = [
  /* ---------------- Alameda County ----------------
     Where the money actually is: eight cities levy a city tax and the rates are
     among the highest in the country. */
  {
    slug: 'oakland', name: 'Oakland', county: 'Alameda',
    tiers: [
      { from: 0, per1000: 10.00 },
      { from: 300_000, per1000: 15.00 },
      { from: 2_000_000, per1000: 17.50 },
      { from: 5_000_000, per1000: 25.00 },
    ],
    payer: 'split', taxRatePct: 1.40, retrofit: WITH_LATERAL, permit: 9500, verifiedOn: V,
    note: 'Buyer and seller split the city tax by long-standing local custom — it is large enough to negotiate.',
  },
  {
    slug: 'berkeley', name: 'Berkeley', county: 'Alameda',
    tiers: [{ from: 0, per1000: 15.00 }, { from: 1_600_000, per1000: 25.00 }],
    payer: 'split', taxRatePct: 1.45, retrofit: WITH_LATERAL, permit: 11000, verifiedOn: V,
    note: 'Measure W (Nov 2024) changes these rates effective 1 Jan 2027 — re-verify before underwriting a 2027 close.',
  },
  {
    slug: 'albany', name: 'Albany', county: 'Alameda',
    tiers: [{ from: 0, per1000: 15.00 }],
    payer: 'split', taxRatePct: 1.45, retrofit: WITH_LATERAL, permit: 8500, verifiedOn: V,
  },
  {
    slug: 'piedmont', name: 'Piedmont', county: 'Alameda',
    tiers: [{ from: 0, per1000: 13.00 }],
    payer: 'seller', taxRatePct: 1.30, retrofit: WITH_LATERAL, permit: 12000, verifiedOn: V,
  },
  {
    slug: 'alameda', name: 'Alameda', county: 'Alameda',
    tiers: [{ from: 0, per1000: 12.00 }],
    payer: 'split', taxRatePct: 1.30, retrofit: STATE_RETROFIT, permit: 8000, verifiedOn: V,
  },
  {
    slug: 'san-leandro', name: 'San Leandro', county: 'Alameda',
    tiers: [{ from: 0, per1000: 11.00 }],
    payer: 'split', taxRatePct: 1.35, retrofit: STATE_RETROFIT, permit: 7000, verifiedOn: V,
  },
  {
    slug: 'hayward', name: 'Hayward', county: 'Alameda',
    tiers: [{ from: 0, per1000: 8.50 }],
    payer: 'split', taxRatePct: 1.35, retrofit: STATE_RETROFIT, permit: 6500, verifiedOn: V,
  },
  {
    slug: 'emeryville', name: 'Emeryville', county: 'Alameda',
    tiers: [
      { from: 0, per1000: 12.00 },
      { from: 1_000_000, per1000: 15.00 },
      { from: 2_000_000, per1000: 25.00 },
    ],
    payer: 'split', taxRatePct: 1.40, retrofit: WITH_LATERAL, permit: 8500, verifiedOn: V,
    note: 'The $1.5m–$2m band is unconfirmed and currently inherits the $1m tier — verify with the city before relying on it in that range.',
  },
  plain('fremont', 'Fremont', 'Alameda', 1.20, 6500),
  plain('livermore', 'Livermore', 'Alameda', 1.20, 6000),
  plain('pleasanton', 'Pleasanton', 'Alameda', 1.20, 6500),
  plain('dublin', 'Dublin', 'Alameda', 1.25, 6000),
  plain('newark', 'Newark', 'Alameda', 1.25, 5500),
  plain('union-city', 'Union City', 'Alameda', 1.30, 5500),

  /* ---------------- Santa Clara County ----------------
     12 of 15 cities are at the county floor. Only three levy a city tax, and at
     $3.30 per $1,000 it is small until San Jose's Measure E cliff bites. */
  {
    slug: 'san-jose', name: 'San Jose', county: 'Santa Clara',
    tiers: [
      { from: 0, per1000: 3.30 },
      /* Measure E: base $3.30 plus a surcharge on the FULL price once
         consideration passes $2.3m (raised from $2m on 1 Jul 2025, and
         inflation-adjusted every five years thereafter). */
      { from: 2_300_000, per1000: 3.30, pct: 0.75 },
      { from: 5_000_000, per1000: 3.30, pct: 1.00 },
      { from: 10_000_000, per1000: 3.30, pct: 1.50 },
    ],
    payer: 'seller', taxRatePct: 1.25, retrofit: STATE_RETROFIT, permit: 7500, verifiedOn: V,
    note: 'Measure E threshold is $2.3m as of 1 Jul 2025 and adjusts for inflation every five years.',
  },
  {
    slug: 'mountain-view', name: 'Mountain View', county: 'Santa Clara',
    tiers: [{ from: 0, per1000: 3.30 }, { from: 6_000_000, per1000: 15.00 }],
    payer: 'split', taxRatePct: 1.20, retrofit: STATE_RETROFIT, permit: 9000, verifiedOn: V,
  },
  {
    slug: 'palo-alto', name: 'Palo Alto', county: 'Santa Clara',
    tiers: [{ from: 0, per1000: 3.30 }],
    payer: 'split', taxRatePct: 1.20, retrofit: STATE_RETROFIT, permit: 12000, verifiedOn: V,
  },
  plain('santa-clara', 'Santa Clara', 'Santa Clara', 1.20, 7000),
  plain('sunnyvale', 'Sunnyvale', 'Santa Clara', 1.20, 8000),
  plain('cupertino', 'Cupertino', 'Santa Clara', 1.15, 8500),
  plain('campbell', 'Campbell', 'Santa Clara', 1.20, 7000),
  plain('milpitas', 'Milpitas', 'Santa Clara', 1.25, 6500),
  plain('los-gatos', 'Los Gatos', 'Santa Clara', 1.15, 9000),
  plain('los-altos', 'Los Altos', 'Santa Clara', 1.15, 10000),
  plain('los-altos-hills', 'Los Altos Hills', 'Santa Clara', 1.15, 12000),
  plain('saratoga', 'Saratoga', 'Santa Clara', 1.15, 9500),
  plain('morgan-hill', 'Morgan Hill', 'Santa Clara', 1.25, 6000),
  plain('gilroy', 'Gilroy', 'Santa Clara', 1.25, 5500),
  plain('monte-sereno', 'Monte Sereno', 'Santa Clara', 1.15, 9500),

  /* ---------------- San Mateo County ----------------
     19 of 20 cities charge nothing beyond the county floor. Only the city of
     San Mateo levies one. */
  {
    slug: 'san-mateo', name: 'San Mateo (city)', county: 'San Mateo',
    tiers: [{ from: 0, pct: 0.5 }, { from: 10_000_000, pct: 1.5 }],
    payer: 'split', taxRatePct: 1.15, retrofit: STATE_RETROFIT, permit: 8000, verifiedOn: V,
  },
  plain('redwood-city', 'Redwood City', 'San Mateo', 1.15, 7500),
  plain('daly-city', 'Daly City', 'San Mateo', 1.20, 6500),
  plain('burlingame', 'Burlingame', 'San Mateo', 1.15, 8500),
  plain('menlo-park', 'Menlo Park', 'San Mateo', 1.15, 9500),
  plain('san-carlos', 'San Carlos', 'San Mateo', 1.15, 8000),
  plain('belmont', 'Belmont', 'San Mateo', 1.15, 7500),
  plain('foster-city', 'Foster City', 'San Mateo', 1.15, 7500),
  plain('san-bruno', 'San Bruno', 'San Mateo', 1.20, 6500),
  plain('south-san-francisco', 'South San Francisco', 'San Mateo', 1.20, 7000),
  plain('millbrae', 'Millbrae', 'San Mateo', 1.15, 7500),
  plain('pacifica', 'Pacifica', 'San Mateo', 1.20, 6500),
  plain('east-palo-alto', 'East Palo Alto', 'San Mateo', 1.25, 6500),
  plain('half-moon-bay', 'Half Moon Bay', 'San Mateo', 1.15, 7000),
  plain('atherton', 'Atherton', 'San Mateo', 1.10, 14000),
  plain('hillsborough', 'Hillsborough', 'San Mateo', 1.10, 13000),
  plain('portola-valley', 'Portola Valley', 'San Mateo', 1.10, 11000),
  plain('woodside', 'Woodside', 'San Mateo', 1.10, 11000),
  plain('brisbane', 'Brisbane', 'San Mateo', 1.20, 6500),
  plain('colma', 'Colma', 'San Mateo', 1.20, 6000),
];

export const CITY_BY_SLUG: Record<string, CityPreset> =
  Object.fromEntries(CITY_PRESETS.map(c => [c.slug, c]));

export function findCity(slug: string): CityPreset | null {
  return CITY_BY_SLUG[slug] ?? null;
}

/** Cities grouped by county, for an optgroup-style picker. */
export function citiesByCounty(): { county: string; cities: CityPreset[] }[] {
  const order: CityPreset['county'][] = ['Santa Clara', 'Alameda', 'San Mateo'];
  return order.map(county => ({
    county,
    cities: CITY_PRESETS.filter(c => c.county === county)
      .sort((a, b) => a.name.localeCompare(b.name)),
  }));
}

/** The tier that applies to `value` — the highest whose `from` it reaches. */
export function tierFor(tiers: TaxTier[], value: number): TaxTier | null {
  let hit: TaxTier | null = null;
  for (const t of tiers) if (value >= t.from) hit = t;
  return hit;
}

/** City transfer tax on the FULL consideration (cliff, not marginal). */
export function cityTransferTax(city: CityPreset | null, value: number): number {
  if (!city || value <= 0) return 0;
  const t = tierFor(city.tiers, value);
  if (!t) return 0;
  const per = (t.per1000 ?? 0) / 1000 * value;
  const sur = (t.pct ?? 0) / 100 * value;
  return per + sur;
}

export function countyTransferTax(value: number): number {
  return value <= 0 ? 0 : value / 1000 * COUNTY_TRANSFER_PER_1000;
}

/** Share of a transfer tax borne by our side of the deal. */
export function payerShare(payer: CityPreset['payer'], side: 'buy' | 'sell'): number {
  if (payer === 'split') return 0.5;
  return (side === 'buy') === (payer === 'buyer') ? 1 : 0;
}
