/* Market dashboard — the metric vocabulary and the plain-English reading of it.

   This file is the contract between the ETL and the UI. The ETL writes metric
   keys; everything a human sees about a metric — its name, its unit, whose
   definition it is, which direction is good and for whom — is decided here, in
   one place, so a chart, a tooltip and an exported one-pager can never disagree
   about what a number means.

   THE DEFINITION PROBLEM IS THE WHOLE PROBLEM. Two sources publish a metric
   called "median days on market" and they do not measure the same thing:

     Zillow      list -> PENDING        Alameda County, Jul 2026: 18 days
     Realtor.com list -> OFF MARKET     Alameda County, Aug 2026: 36 days

   Neither is wrong. They differ by roughly 2x, forever, in every county. So a
   number is never shown without its source and definition attached, and the two
   are never averaged into one figure. Michael's rule, set 2026-09-04: when
   sources disagree, show both and name the definition.

   WHAT IS DELIBERATELY ABSENT: months of supply. It needs a count of closed
   sales, and no permissively-licensed source publishes one below metro level.
   Rather than fake it from listing counts, the dashboard substitutes real
   absorption measures — `pending_ratio` at county, `market_heat` at city — and
   says so in the UI. See SUBSTITUTIONS below. */

export type MetricKey =
  | 'dom_median' | 'dom_mean' | 'inventory' | 'new_listings' | 'pending'
  | 'pending_ratio' | 'median_sale_price' | 'median_list_price'
  | 'sale_to_list_mean' | 'sale_to_list_median' | 'price_cut_share'
  | 'price_increase_share' | 'market_heat' | 'home_value' | 'list_ppsf'
  | 'median_sqft' | 'total_listings';

export type Source = 'zillow' | 'realtor';
export type PropertyType = 'all' | 'sfr' | 'condo';
export type Persona = 'investor' | 'seller' | 'buyer';
export type MetricUnit = 'days' | 'count' | 'usd' | 'pct' | 'ratio' | 'index' | 'sqft';

export interface MetricDef {
  key: MetricKey;
  label: string;
  /** Column-header length, for tables and the one-pager. */
  short: string;
  unit: MetricUnit;
  decimals: number;
  /** True when a smaller number is the healthier one (days on market, price cuts). */
  lowerIsBetter?: boolean;
  /** What it is, for someone who has never bought a house. */
  plain: string;
  /** Per-source measurement definition. Absent source = not published by it. */
  definition: Partial<Record<Source, string>>;
  /** Personas that see this on their headline row. */
  headlineFor: Persona[];
}

export const METRICS: Record<MetricKey, MetricDef> = {
  dom_median: {
    key: 'dom_median', label: 'Median days on market', short: 'DOM',
    unit: 'days', decimals: 0, lowerIsBetter: true,
    plain: 'Half of homes went under contract faster than this, half slower. ' +
      'It is the single clearest read on how much hurry buyers are in.',
    definition: {
      zillow: 'Days from listing to going pending (accepted offer).',
      realtor: 'Days from listing to leaving the market — includes the escrow ' +
        'period, so it runs roughly twice the list-to-pending figure.',
    },
    headlineFor: ['investor', 'seller', 'buyer'],
  },
  dom_mean: {
    key: 'dom_mean', label: 'Average days on market', short: 'Avg DOM',
    unit: 'days', decimals: 0, lowerIsBetter: true,
    plain: 'The arithmetic average. It runs higher than the median because a ' +
      'handful of homes that sit for a year drag it up, which is why the ' +
      'median is the headline and this is the footnote.',
    definition: { zillow: 'Days from listing to going pending (accepted offer).' },
    headlineFor: [],
  },
  inventory: {
    key: 'inventory', label: 'Homes for sale', short: 'Inventory',
    unit: 'count', decimals: 0,
    plain: 'How many homes are actively listed. More choice for buyers, more ' +
      'competition for sellers.',
    definition: {
      zillow: 'Count of active for-sale listings, smoothed over three months.',
      realtor: 'Count of active listings on realtor.com during the month.',
    },
    headlineFor: ['investor', 'seller', 'buyer'],
  },
  new_listings: {
    key: 'new_listings', label: 'New listings', short: 'New',
    unit: 'count', decimals: 0,
    plain: 'Homes that came to market this month. Rising new listings with ' +
      'flat sales is how inventory builds.',
    definition: {
      zillow: 'Newly listed homes during the month.',
      realtor: 'Newly listed properties during the month.',
    },
    headlineFor: ['investor', 'buyer'],
  },
  pending: {
    key: 'pending', label: 'Homes under contract', short: 'Pending',
    unit: 'count', decimals: 0,
    plain: 'Homes with an accepted offer that have not closed yet. The ' +
      'earliest signal of demand, because it moves before closed sales do.',
    definition: { realtor: 'Listings in pending status during the month.' },
    headlineFor: ['investor'],
  },
  pending_ratio: {
    key: 'pending_ratio', label: 'Pending ratio', short: 'Pend/Act',
    unit: 'ratio', decimals: 2,
    plain: 'Homes under contract divided by homes still for sale. Think of it ' +
      'as how fast the shelf is clearing: 0.50 means one home goes under ' +
      'contract for every two sitting available. Higher favours sellers.',
    definition: {
      realtor: 'Pending listings divided by active listings. Stands in for ' +
        'months of supply, which needs closed-sale counts no free source publishes.',
    },
    headlineFor: ['investor', 'seller'],
  },
  median_sale_price: {
    key: 'median_sale_price', label: 'Median sale price', short: 'Sale price',
    unit: 'usd', decimals: 0,
    plain: 'The middle price of homes that actually sold. It moves with what ' +
      'kind of home sold that month, not just with values — a quiet month for ' +
      'big houses drops it without any home losing value.',
    definition: { zillow: 'Median price of homes sold during the month.' },
    headlineFor: ['seller', 'buyer'],
  },
  median_list_price: {
    key: 'median_list_price', label: 'Median asking price', short: 'Asking',
    unit: 'usd', decimals: 0,
    plain: 'The middle asking price of what is for sale right now. It is what ' +
      'sellers hope for, not what buyers paid.',
    definition: { realtor: 'Median list price of active listings during the month.' },
    headlineFor: ['buyer'],
  },
  sale_to_list_mean: {
    key: 'sale_to_list_mean', label: 'Sale-to-list ratio', short: 'SP/LP',
    unit: 'pct', decimals: 1,
    plain: 'What homes sold for as a share of asking. Above 100% means the ' +
      'typical home went over asking; below means buyers negotiated.',
    definition: { zillow: 'Mean of sale price divided by final list price.' },
    headlineFor: ['seller', 'buyer'],
  },
  sale_to_list_median: {
    key: 'sale_to_list_median', label: 'Sale-to-list (median)', short: 'SP/LP med',
    unit: 'pct', decimals: 1,
    plain: 'The middle sale-to-list ratio, less swayed by one wild overbid.',
    definition: { zillow: 'Median of sale price divided by final list price.' },
    headlineFor: [],
  },
  price_cut_share: {
    key: 'price_cut_share', label: 'Listings with a price cut', short: 'Price cuts',
    unit: 'pct', decimals: 1, lowerIsBetter: true,
    plain: 'The share of homes for sale that have dropped their price. The ' +
      'most honest measure of seller pain, and it turns before prices do.',
    definition: {
      zillow: 'Share of active listings with a price reduction that month.',
      realtor: 'Share of active listings with a price reduction that month.',
    },
    headlineFor: ['seller', 'buyer'],
  },
  price_increase_share: {
    key: 'price_increase_share', label: 'Listings with a price increase',
    short: 'Price ups', unit: 'pct', decimals: 1,
    plain: 'The share of listings that raised their price. Rare, and a sign of ' +
      'a market where sellers feel they underpriced.',
    definition: { realtor: 'Share of active listings with a price increase that month.' },
    headlineFor: [],
  },
  market_heat: {
    key: 'market_heat', label: 'Market heat index', short: 'Heat',
    unit: 'index', decimals: 0,
    plain: 'Zillow\'s 0-100 balance score. Around 50 is balanced; higher means ' +
      'sellers hold the leverage, lower means buyers do. It is the city-level ' +
      'stand-in for months of supply.',
    definition: {
      zillow: 'Composite of sale-to-list, days to pending, price cuts and ' +
        'sale-to-inventory. 0-100, 50 = balanced.',
    },
    headlineFor: ['investor', 'seller', 'buyer'],
  },
  home_value: {
    key: 'home_value', label: 'Typical home value', short: 'ZHVI',
    unit: 'usd', decimals: 0,
    plain: 'The value of a typical middle-tier home, adjusted so a month of ' +
      'unusual sales does not move it. This is the number to watch for "are ' +
      'values up or down" — the median sale price is not.',
    definition: {
      zillow: 'Zillow Home Value Index, 35th-65th percentile, smoothed and ' +
        'seasonally adjusted.',
    },
    headlineFor: ['investor', 'seller', 'buyer'],
  },
  list_ppsf: {
    key: 'list_ppsf', label: 'Asking price per sq ft', short: '$/sqft',
    unit: 'usd', decimals: 0,
    plain: 'Asking price divided by size. Comparing this instead of total ' +
      'price is how you tell a cheaper market from a smaller-house market.',
    definition: { realtor: 'Median list price per square foot of active listings.' },
    headlineFor: ['investor'],
  },
  median_sqft: {
    key: 'median_sqft', label: 'Median home size', short: 'Size',
    unit: 'sqft', decimals: 0,
    plain: 'The middle size of what is for sale. It explains most surprise ' +
      'moves in median price.',
    definition: { realtor: 'Median square footage of active listings.' },
    headlineFor: [],
  },
  total_listings: {
    key: 'total_listings', label: 'Total listings', short: 'Total',
    unit: 'count', decimals: 0,
    plain: 'Active plus pending listings — everything on the board.',
    definition: { realtor: 'Active plus pending listings during the month.' },
    headlineFor: [],
  },
};

export const SOURCES: Record<Source, {
  label: string; attribution: string; geoLevels: string; note: string;
}> = {
  zillow: {
    label: 'Zillow Research',
    attribution: 'Data provided by Zillow Research (zillow.com/research/data).',
    geoLevels: 'city and county',
    note: 'Days on market is measured to PENDING. Free for public use with ' +
      'attribution. History begins March 2018.',
  },
  realtor: {
    label: 'Realtor.com',
    attribution: 'Data provided by the Realtor.com Real Estate Data Library.',
    geoLevels: 'county',
    note: 'Listing-side only — no closed sale prices. Days on market is ' +
      'measured to OFF MARKET. History begins July 2016.',
  },
};

/** Metrics the dashboard shows in place of one it cannot honestly compute. */
export const SUBSTITUTIONS = [
  {
    missing: 'Months of supply',
    reason:
      'Months of supply is inventory divided by the number of homes that ' +
      'closed. No source we can license publishes closed-sale counts below ' +
      'metro level, and estimating it from listing counts would produce a ' +
      'number that looks precise and is not.',
    instead: ['pending_ratio', 'market_heat'] as MetricKey[],
  },
];

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

export function formatMetric(key: MetricKey, v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return '—';
  const m = METRICS[key];
  const n = (d: number) => v.toLocaleString('en-US', {
    minimumFractionDigits: d, maximumFractionDigits: d,
  });
  switch (m.unit) {
    case 'usd':   return '$' + Math.round(v).toLocaleString('en-US');
    case 'pct':   return n(m.decimals) + '%';
    case 'days':  return n(m.decimals) + (Math.round(v) === 1 ? ' day' : ' days');
    case 'sqft':  return n(0) + ' sq ft';
    case 'ratio':
    case 'index':
    default:      return n(m.decimals);
  }
}

/** Signed percent change, for the "vs last year" line under every tile. */
export function formatChange(now: number, then: number): string {
  if (!isFinite(now) || !isFinite(then) || then === 0) return '—';
  const pct = ((now - then) / Math.abs(then)) * 100;
  const sign = pct > 0 ? '+' : pct < 0 ? '−' : '';
  return `${sign}${Math.abs(pct).toFixed(Math.abs(pct) < 10 ? 1 : 0)}%`;
}

/* ------------------------------------------------------------------ */
/* Reading the market                                                  */
/* ------------------------------------------------------------------ */

export type Phase =
  | 'strong-seller' | 'seller' | 'balanced' | 'buyer' | 'strong-buyer';

export interface Signal {
  key: MetricKey;
  value: number;
  /** −1 = as buyer-friendly as this signal gets, +1 = as seller-friendly. */
  score: number;
  reading: string;
}

export interface MarketRead {
  phase: Phase;
  label: string;
  /** −1 … +1, the mean of whichever signals were available. */
  score: number;
  signals: Signal[];
  /** Named so the UI can say WHY the verdict is soft when it is. */
  confidence: 'high' | 'medium' | 'low';
  summary: string;
}

/* Each signal maps a raw value onto −1…+1 through two anchor points: the value
   at which the market is plainly buyer-friendly, and the value at which it is
   plainly seller-friendly. Anchors are Bay Area calibrated — 18 days on market
   is a hot market here and a dead one in much of the country, so these numbers
   do not travel outside the five counties without being re-set. */
const ANCHORS: Partial<Record<MetricKey, { buyer: number; seller: number }>> = {
  dom_median:        { buyer: 45, seller: 12 },
  sale_to_list_mean: { buyer: 97, seller: 105 },
  price_cut_share:   { buyer: 35, seller: 8 },
  market_heat:       { buyer: 30, seller: 75 },
  pending_ratio:     { buyer: 0.25, seller: 0.70 },
};

function scoreSignal(key: MetricKey, value: number): number | null {
  const a = ANCHORS[key];
  if (!a || !isFinite(value)) return null;
  const t = (value - a.buyer) / (a.seller - a.buyer);   // 0 at buyer, 1 at seller
  return Math.max(-1, Math.min(1, t * 2 - 1));
}

const PHASES: { at: number; phase: Phase; label: string }[] = [
  { at:  0.55, phase: 'strong-seller', label: "Strong seller's market" },
  { at:  0.18, phase: 'seller',        label: "Seller's market" },
  { at: -0.18, phase: 'balanced',      label: 'Balanced market' },
  { at: -0.55, phase: 'buyer',         label: "Buyer's market" },
  { at: -Infinity, phase: 'strong-buyer', label: "Strong buyer's market" },
];

/**
 * Turn the latest values into a leverage verdict plus the reasoning behind it.
 *
 * `latest` need only contain what the place actually has — a city has heat and
 * days on market but no pending ratio, a county has the reverse. The score is
 * the mean of the signals that were present, and `confidence` reports how many
 * that was, so a verdict resting on one signal is never presented as if it
 * rested on four.
 */
export function readMarket(latest: Partial<Record<MetricKey, number>>): MarketRead {
  const signals: Signal[] = [];

  for (const key of Object.keys(ANCHORS) as MetricKey[]) {
    const value = latest[key];
    if (value == null) continue;
    const score = scoreSignal(key, value);
    if (score == null) continue;
    signals.push({ key, value, score, reading: signalReading(key, value, score) });
  }

  const score = signals.length
    ? signals.reduce((s, x) => s + x.score, 0) / signals.length
    : 0;
  const { phase, label } = PHASES.find(p => score >= p.at)!;
  const confidence = signals.length >= 4 ? 'high' : signals.length >= 2 ? 'medium' : 'low';

  return { phase, label, score, signals, confidence, summary: phaseSummary(phase) };
}

function signalReading(key: MetricKey, value: number, score: number): string {
  const side = score > 0.2 ? 'sellers' : score < -0.2 ? 'buyers' : 'neither side';
  const v = formatMetric(key, value);
  switch (key) {
    case 'dom_median':
      return `Homes go under contract in ${v}, which favours ${side}.`;
    case 'sale_to_list_mean':
      return value >= 100
        ? `The typical home sells for ${v} of asking — over asking, so buyers are competing.`
        : `The typical home sells for ${v} of asking, so buyers are negotiating price down.`;
    case 'price_cut_share':
      return `${v} of listings have cut their price, which favours ${side}.`;
    case 'market_heat':
      return `Zillow scores this market ${v} out of 100, where 50 is balanced.`;
    case 'pending_ratio':
      return `${v} homes go under contract for every one sitting available.`;
    default:
      return `${METRICS[key].label}: ${v}.`;
  }
}

function phaseSummary(phase: Phase): string {
  switch (phase) {
    case 'strong-seller':
      return 'Demand is well ahead of supply. Well-priced homes go quickly and ' +
        'often over asking, and buyers have little room to negotiate.';
    case 'seller':
      return 'Sellers hold the advantage, but not overwhelmingly. Good homes ' +
        'still move fast; overpriced ones sit and end up cutting.';
    case 'balanced':
      return 'Supply and demand are roughly matched. Price and condition ' +
        'decide the outcome rather than the market doing the work.';
    case 'buyer':
      return 'Supply is ahead of demand. Homes take longer, price cuts are ' +
        'common, and buyers have real negotiating room.';
    case 'strong-buyer':
      return 'Buyers are firmly in control. Expect long marketing times, ' +
        'frequent reductions, and sellers accepting below asking.';
  }
}

/* ------------------------------------------------------------------ */
/* Persona-specific advice                                             */
/* ------------------------------------------------------------------ */

export interface Takeaway { heading: string; body: string; }

/**
 * The "what does this mean for me" block. Written for someone with no real
 * estate background — the standard is that a beginner finishes it knowing what
 * to do differently, not just what the chart said.
 *
 * `yoy` is the year-over-year change in each metric as a percentage.
 */
export function takeaways(
  persona: Persona,
  read: MarketRead,
  latest: Partial<Record<MetricKey, number>>,
  yoy: Partial<Record<MetricKey, number>>,
  mortgageRate?: number,
): Takeaway[] {
  const out: Takeaway[] = [];
  const sellerSide = read.score > 0.18;
  const buyerSide = read.score < -0.18;
  const domUp = (yoy.dom_median ?? 0) > 10;
  const invUp = (yoy.inventory ?? 0) > 10;
  const invDown = (yoy.inventory ?? 0) < -10;
  const valUp = (yoy.home_value ?? 0) > 0;

  out.push({
    heading: 'Where this market stands',
    body: `${read.label}. ${read.summary}` +
      (read.confidence === 'low'
        ? ' Only one indicator was available for this area this month, so treat ' +
          'this as a first impression rather than a firm read.'
        : ''),
  });

  out.push({
    heading: 'Which way it is moving',
    body: [
      domUp
        ? 'Homes are taking noticeably longer to sell than a year ago, which is ' +
          'the earliest sign that demand is cooling.'
        : (yoy.dom_median ?? 0) < -10
          ? 'Homes are selling faster than a year ago — demand is picking up.'
          : 'Time on market is close to where it was a year ago.',
      invUp
        ? 'There are more homes for sale than a year ago, so buyers have more choice.'
        : invDown
          ? 'There are fewer homes for sale than a year ago, which keeps pressure on buyers.'
          : 'Inventory is roughly flat year over year.',
      yoy.home_value != null
        ? `Typical home values are ${valUp ? 'up' : 'down'} ${Math.abs(yoy.home_value).toFixed(1)}% over the year.`
        : '',
    ].filter(Boolean).join(' '),
  });

  if (persona === 'seller') {
    out.push({
      heading: 'What this means for pricing your home',
      body: sellerSide
        ? 'You can price at or slightly above recent comparable sales and expect ' +
          'activity in the first two weeks. The risk here is over-reaching: in ' +
          'this market the homes that sit are almost always the ones priced ' +
          'above what the last few sales support, and a home that sits ends up ' +
          'selling for less than one priced right from day one.'
        : buyerSide
          ? 'Price at or slightly below the most recent comparable sales. With ' +
            `${formatMetric('price_cut_share', latest.price_cut_share)} of listings ` +
            'already cutting, buyers are waiting for reductions rather than ' +
            'competing. Coming out at the right number beats starting high and ' +
            'chasing the market down.'
          : 'Price in line with recent comparable sales. Neither side has the ' +
            'upper hand, so presentation, condition and photography do more work ' +
            'than the market does.',
    });
    out.push({
      heading: 'What to expect on timing',
      body: latest.dom_median != null
        ? `Plan on roughly ${formatMetric('dom_median', latest.dom_median)} from ` +
          'listing to accepted offer for a typical home, then about another 30 ' +
          'days to close. Half of homes beat that; homes needing work take longer.'
        : 'Time-on-market data is not published for this area this month.',
    });
  }

  if (persona === 'buyer') {
    out.push({
      heading: 'What this means for making an offer',
      body: buyerSide
        ? 'You have room. Offering below asking is reasonable, and asking for ' +
          'closing-cost help or repairs is realistic — especially on anything ' +
          'that has been listed longer than the typical time above.'
        : sellerSide
          ? 'Expect competition on well-presented homes. Be ready to move in the ' +
            'first weekend and to offer at or above asking on the good ones. The ' +
            'opportunity is in homes that have already sat past the typical ' +
            'marketing time — those sellers negotiate.'
          : 'You have some negotiating room without needing to rush. Offering ' +
            'near asking on a well-priced home is normal here.',
    });
    if (mortgageRate) {
      out.push({
        heading: 'The rate side of the decision',
        body: `The 30-year fixed is around ${mortgageRate.toFixed(2)}%. Rates move ` +
          'your monthly payment more than small price changes do: on a $1M loan, ' +
          'a half-point drop is worth roughly $300 a month, which is more than a ' +
          '3% price cut. Waiting for a lower price in a market where rates may ' +
          'fall is a bet on two things at once, and lower rates usually bring ' +
          'competing buyers back with them.',
      });
    }
  }

  if (persona === 'investor') {
    out.push({
      heading: 'What this means for acquisition',
      body: buyerSide
        ? 'This is when negotiating leverage is real. Listings past the typical ' +
          'marketing time, and those that have already cut once, are where the ' +
          'discounts are. Underwrite to today\'s rent and today\'s rate, not to ' +
          'an assumed refinance.'
        : sellerSide
          ? 'Competition is high, so deals come from off-market sourcing or from ' +
            'homes others will not touch, rather than from negotiating on well-' +
            'presented listings. Be disciplined about walking away.'
          : 'A balanced market rewards patience. There is enough inventory to be ' +
            'selective without needing to overpay to win.',
    });
    out.push({
      heading: 'Supply and absorption',
      body: [
        latest.pending_ratio != null
          ? `The pending ratio is ${formatMetric('pending_ratio', latest.pending_ratio)} — ` +
            'homes going under contract per home still available.'
          : '',
        latest.new_listings != null && latest.inventory != null
          ? `${formatMetric('new_listings', latest.new_listings)} homes came to ` +
            `market against ${formatMetric('inventory', latest.inventory)} already ` +
            'listed. When new listings outrun what is selling, inventory builds and ' +
            'prices follow it down a few months later.'
          : '',
      ].filter(Boolean).join(' ') || 'Absorption data is thin for this area this month.',
    });
  }

  return out;
}
