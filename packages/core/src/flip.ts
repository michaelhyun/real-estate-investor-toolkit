/* Fix-and-flip analyzer engine — pure math, no React, no DOM, like the rest of
   @reit/core. `computeFlip` returns one complete underwrite; everything else in
   here (the 3x3 grid, the sensitivity heatmap, the max-allowable-offer solve)
   is built from repeated calls to it, so there is exactly one place where the
   P&L is defined and one place a bug can live.

   Three things in here are easy to get wrong and are therefore load-bearing:

   1. Transfer tax tiers are CLIFFS. Crossing a threshold taxes the whole
      consideration, so the profit curve genuinely has steps in it. Every solver
      here is bisection rather than Newton for that reason.

   2. On a conventional loan, PRINCIPAL IS NOT AN EXPENSE. The monthly payment
      splits: interest hits the P&L, principal is cash out of pocket during the
      hold that comes back as a smaller payoff at close. Expensing the whole
      payment would understate profit by the amount amortized.

   3. Property tax runs off the REASSESSED value. Prop 13 resets assessed value
      to the purchase price at close, so a flip's tax bill has nothing to do
      with the seller's old one, and published "average effective rates" (which
      are dragged below 1% by long-held basis) are the wrong number entirely. */

import { money0 } from './format';
import { monthlyPI, loanBalance } from './mortgage';
import {
  cityTransferTax, countyTransferTax, findCity, payerShare, type CityPreset,
} from './bayAreaCities';

const DAYS_PER_MONTH = 30.4375;

export type ScenarioKey = 'low' | 'base' | 'high';
export const SCENARIO_KEYS: ScenarioKey[] = ['low', 'base', 'high'];
export type FinanceMode = 'hard' | 'conv' | 'cash';

export interface Triple { low: number; base: number; high: number; }

/* ---------------------------------------------------------------- line items */

export interface LineDef {
  id: string; label: string; val: number;
  /** short clarification under the label */
  hint?: string;
  /** guidance for the notes column — where the number comes from, what range is
      normal, and when to move it. Written for someone doing their first flip. */
  note?: string;
  /** a cost that exists *because* the house is empty. On a live-in flip those
      months are not vacant, so the line simply does not happen. */
  vacantOnly?: boolean;
}

/** Acquisition costs. Loan points and lender fees are deliberately absent —
    they belong to financing, so changing leverage moves one number, not two. */
export const ACQ_ITEMS: LineDef[] = [
  { id: 'escrow', label: 'Escrow fee — buy side', val: 1800,
    note: 'About $2 per $1,000 plus a base fee. Each side pays its own.' },
  { id: 'titleLender', label: "Lender's title policy", val: 1400,
    note: 'Lender-required and buyer-paid. Drops to $0 all cash.' },
  { id: 'recording', label: 'County recording', val: 225,
    note: 'Fixed county charge. Barely moves with price.' },
  { id: 'inspGeneral', label: 'General home inspection', val: 650,
    note: '$500\u2013800 for your own. Seller\u2019s package normally covers it.' },
  { id: 'inspPest', label: 'Pest / termite inspection', val: 400,
    note: '$350\u2013500, almost always in the seller\u2019s package.' },
  { id: 'inspSewer', label: 'Sewer lateral video scope', val: 350,
    note: 'Worth it anyway \u2014 a failed lateral is $15\u201330k and four cities demand a certificate.' },
  { id: 'inspFoundation', label: 'Foundation / structural', val: 800,
    note: '$600\u20131,000. Order on pre-1950 or any visible cracking.' },
  { id: 'inspRoof', label: 'Roof inspection', val: 350,
    note: '$300\u2013450, usually in the seller\u2019s package.' },
  { id: 'appraisal', label: 'Appraisal / BPO', val: 900,
    note: '$700\u20131,100, lender-required and buyer-paid. $0 all cash.' },
  { id: 'miscAcq', label: 'Wire, notary, courier, misc', val: 250,
    note: 'Small fixed escrow charges.' },
];

/** The acquisition lines a California seller's disclosure package normally
    already covers. The sewer lateral scope is deliberately NOT here: even when
    the seller discloses one, a failed lateral is $15-30k and four Alameda
    County cities need a certificate at sale, so it is worth your own eyes. */
export const SELLER_PROVIDED = new Set(['inspGeneral', 'inspPest', 'inspFoundation', 'inspRoof']);

/** Holding costs, all $/month over the months the house is carried. */
export const HOLD_ITEMS: LineDef[] = [
  { id: 'insVacant', label: 'Vacant dwelling insurance', val: 350, vacantOnly: true,
    note: '$250\u2013450/mo and not optional \u2014 an HO-3 voids once unoccupied.' },
  { id: 'electric', label: 'Electricity', val: 90, note: 'Construction power runs well above a lived-in bill.' },
  { id: 'water', label: 'Water', val: 60, note: 'Keep it on for the trades and for landscaping.' },
  { id: 'gas', label: 'Gas', val: 40, note: 'Often off during a gut, back on for staging.' },
  { id: 'trash', label: 'Trash', val: 30, note: 'Separate from demo dumpsters, which sit in rehab.' },
  { id: 'landscape', label: 'Landscaping & site upkeep', val: 150, vacantOnly: true,
    note: 'An overgrown yard reads as distressed. Cheap insurance.' },
  { id: 'security', label: 'Security — alarm & cameras', val: 85, vacantOnly: true,
    note: 'Copper theft and squatting are real on a vacant house.' },
  { id: 'hoa', label: 'HOA dues', val: 0, note: 'Condos and PUDs only. Check for a special assessment first.' },
  { id: 'entity', label: 'Entity, bookkeeping, misc', val: 100,
    note: 'LLC franchise tax, bookkeeping, bank fees.' },
];

/** Selling costs charged as a flat dollar amount. */
export const SELL_FLAT_ITEMS: LineDef[] = [
  { id: 'escrowSell', label: 'Escrow fee — sell side', val: 2200,
    note: 'Your half of escrow on the way out.' },
  { id: 'titleOwner', label: "Owner's title policy", val: 3400,
    note: 'Seller-paid by custom. About $2.50\u20133 per $1,000 of sale.' },
  { id: 'recordingSell', label: 'County recording — sell side', val: 225, note: 'Fixed county charge.' },
  { id: 'nhd', label: 'Natural hazard disclosure report', val: 150,
    note: 'Required on every CA residential sale. Fixed vendor fee.' },
  { id: 'warranty', label: 'Home warranty', val: 600,
    note: 'Optional one-year buyer policy. Cheap objection remover.' },
  { id: 'stagingSetup', label: 'Staging — setup', val: 4500,
    note: '$4\u20136k to install. Highest-return line in the selling budget.' },
];

/* ---------------------------------------------------------------- the state */

export interface FlipUrl { label: string; url: string; }

export interface FlipState {
  name: string;
  savedAt?: string;

  prop: {
    address: string;
    beds: number; baths: number; halfBaths: number;
    sqft: number; lotSqft: string; year: string; stories: number; garageBays: number;
    urls: FlipUrl[];
  };
  citySlug: string;

  price: number;
  arv: Triple;

  rehabSource: 'manual' | 'checklist';
  rehab: Triple;

  /* A live-in flip: you move in, hold past the two-year mark, then sell. The
     months you live there are not vacant, so the costs of an empty house are
     not incurred, and the housing you would have paid for anyway is not a
     cost of the project. */
  liveIn: boolean;
  occupancyMonths: number;
  /** what housing would have cost you regardless, $/mo */
  avoidedHousing: number;

  /* timeline — every phase in days, because that is how they are quoted */
  rehabDays: number;
  domDays: number;
  escrowDays: number;
  overrunDays: number;

  acq: Record<string, number>;

  hold: Record<string, number>;
  taxRatePct: number;
  priorAssessed: number;
  builderRisk: number;
  builderRiskUnit: '$' | '%';

  sell: Record<string, number>;
  listCommPct: number;
  buyerCommPct: number;
  /** what you pay a buyer's agent when you acquire */
  buySideCommPct: number;
  concessionsPct: number;
  stagingMo: number;
  retrofit: number;
  transferPayer: 'seller' | 'buyer' | 'split';
  withholdingOn: boolean;

  finMode: FinanceMode;
  /* hard money */
  ltcPct: number;
  rehabFinancedPct: number;
  hardRate: number;
  pointsPct: number;
  hardFees: number;
  drawCount: number;
  drawFee: number;
  minInterestMonths: number;
  extensionFeePct: number;
  /* conventional */
  ltvPct: number;
  convRate: number;
  convTerm: number;
  convIO: boolean;
  originationPct: number;
  convFees: number;
  prepayPct: number;

  /** the walk-away floor: what the deal has to clear for you to do it */
  minProfit: number;
  /** California sellers normally deliver a disclosure package before offers */
  sellerDisclosure: boolean;

  /* Scope-of-work selections only, keyed `<spaceId>.<taskId>`. Prices are NOT
     here: the catalog is shared across every deal so a corrected price
     propagates instead of needing to be re-fixed forever. A deal owns what is
     specific to it — what is scoped, room areas and quantity overrides. */
  checked: Record<string, boolean>;
  qty: Record<string, number>;
  /** per-room area overrides, keyed by space id */
  spaceSqft: Record<string, number>;
  /** the level preset last applied to each space, keyed by space id */
  spaceLevel: Record<string, number>;
}

const seed = (items: LineDef[]): Record<string, number> =>
  Object.fromEntries(items.map(i => [i.id, i.val]));

export function defaultFlipState(): FlipState {
  return {
    name: '',
    prop: {
      address: '', beds: 3, baths: 2, halfBaths: 0,
      sqft: 1450, lotSqft: '', year: '', stories: 1, garageBays: 2, urls: [],
    },
    citySlug: '',

    price: 720000,
    arv: { low: 1200000, base: 1275000, high: 1340000 },

    rehabSource: 'manual',
    rehab: { low: 180000, base: 220000, high: 285000 },

    liveIn: false,
    occupancyMonths: 24,
    avoidedHousing: 3800,

    rehabDays: 150,
    domDays: 21,
    escrowDays: 30,
    overrunDays: 0,

    acq: seed(ACQ_ITEMS),

    hold: seed(HOLD_ITEMS),
    taxRatePct: 1.25,
    priorAssessed: 0,
    builderRisk: 180,
    builderRiskUnit: '$',

    sell: seed(SELL_FLAT_ITEMS),
    listCommPct: 2.5,
    buyerCommPct: 2.5,
    buySideCommPct: 2.5,
    concessionsPct: 0.5,
    stagingMo: 1200,
    retrofit: 3250,
    transferPayer: 'seller',
    withholdingOn: false,

    finMode: 'hard',
    ltcPct: 88,
    rehabFinancedPct: 100,
    hardRate: 10.5,
    pointsPct: 2,
    hardFees: 1500,
    drawCount: 4,
    drawFee: 350,
    minInterestMonths: 3,
    extensionFeePct: 1,
    ltvPct: 75,
    convRate: 7,
    convTerm: 30,
    convIO: false,
    originationPct: 1,
    convFees: 1800,
    prepayPct: 0,

    minProfit: 75000,
    sellerDisclosure: true,

    checked: {},
    qty: {},
    spaceSqft: {},
    spaceLevel: {},
  };
}

/* --------------------------------------------------------------- the result */

export interface CostLine {
  /** stable key so the UI can show a computed amount on its own input row
      rather than repeating the label in a derived block below */
  id?: string;
  label: string;
  amount: number;
  hint?: string;
  /** when the cash actually leaves — drives peak-cash without parsing labels */
  phase?: 'close' | 'hold';
  /** a breakdown row already contained in the line above it; never summed */
  disclosure?: boolean;
  /** computed here rather than typed by the user — the UI shows these back,
      and skips the ones that would only echo an input field verbatim */
  derived?: boolean;
}

export interface FlipResult {
  sale: number;
  rehabTotal: number;

  rehabPeriod: number;
  marketMonths: number;
  /** months lived in — zero unless this is a live-in flip */
  occupancyMonths: number;
  /** months the house stands empty, which is what a vacancy cost accrues over */
  vacantMonths: number;
  holdMonths: number;
  /** housing you would have paid for anyway, credited back against the carry */
  housingCredit: number;

  acqLines: CostLine[];
  acqTotal: number;

  holdLines: CostLine[];
  holdTotal: number;
  holdMonthly: number;
  propertyTax: number;
  supplementalTax: number;

  sellLines: CostLine[];
  sellTotal: number;
  sellPctOfSale: number;

  finLines: CostLine[];
  finTotal: number;
  loanAtClose: number;
  peakLoan: number;
  downPayment: number;
  interest: number;
  principalPaid: number;
  payoffAtSale: number;
  cashForRehab: number;

  netProceeds: number;
  profit: number;

  cashToClose: number;
  cashDuringHold: number;
  peakCash: number;
  cashBackAtClose: number;
  withholding: number;

  roi: number;
  annualizedRoi: number;
  margin: number;
  grossSpread: number;
  arvPsf: number;
  rehabPsf: number;
  pricePsf: number;
}

/* ------------------------------------------------------------------ compute */

export function computeFlip(
  s: FlipState, arvKey: ScenarioKey = 'base', rehabKey: ScenarioKey = 'base',
  priceOverride?: number, rehabOverride?: number,
): FlipResult {
  const city = findCity(s.citySlug);
  const price = priceOverride ?? s.price;
  const sale = s.arv[arvKey] || 0;

  /* the sensitivity grid probes a rehab number directly; everything else takes
     the scenario it was asked for */
  const rehabTotal = rehabOverride ?? (s.rehab[rehabKey] || 0);

  const rehabPeriod = Math.max(0, (s.rehabDays + s.overrunDays) / DAYS_PER_MONTH);
  const marketMonths = Math.max(0, (s.domDays + s.escrowDays) / DAYS_PER_MONTH);
  const occupancyMonths = s.liveIn ? Math.max(0, s.occupancyMonths) : 0;
  /* Empty during the work and again while it is on the market; lived in for
     the stretch between. Only the empty months carry a vacant house's costs. */
  const vacantMonths = rehabPeriod + marketMonths;
  const holdMonths = vacantMonths + occupancyMonths;

  /* ---------- acquisition ----------
     `transferPayer` is seeded from the city preset when a city is picked, but
     the deal's own value is what applies — local custom is a starting point,
     not a rule, and on a large Oakland or Berkeley bill it is negotiable. */
  const buyShare = payerShare(s.transferPayer, 'buy');
  const buyCityTax = cityTransferTax(city, price) * buyShare;
  const buyCountyTax = countyTransferTax(price) * buyShare;
  const acqValue = (id: string) =>
    s.sellerDisclosure && SELLER_PROVIDED.has(id) ? 0 : (s.acq[id] ?? 0);
  const acqLines: CostLine[] = ACQ_ITEMS.map(i => ({
    id: i.id, label: i.label, amount: acqValue(i.id), hint: i.hint,
  }));
  const buySideComm = price * (s.buySideCommPct / 100);
  if (buySideComm > 0) acqLines.push({ id: 'buySideComm', label: `Buy-side commission — ${s.buySideCommPct}%`, amount: buySideComm, derived: true });
  if (buyCityTax > 0) acqLines.push({ id: 'buyCityTax', label: 'City transfer tax — buy-side share', amount: buyCityTax, derived: true });
  if (buyCountyTax > 0) acqLines.push({ id: 'buyCountyTax', label: 'County transfer tax — buy-side share', amount: buyCountyTax, derived: true });
  const acqTotal = acqLines.reduce((a, l) => a + l.amount, 0);

  /* ---------- holding ----------
     Prop 13 resets assessed value to the purchase price at close, so the tax
     is the levied rate on what we paid. When the prior assessed value is known
     we break out the supplemental portion — the separate bill for the gap
     between the seller's roll value and ours — purely as disclosure; the two
     lines sum to the same total either way, so it can never double-count. */
  const propertyTax = price * (s.taxRatePct / 100) * (holdMonths / 12);
  const supplementalTax = s.priorAssessed > 0
    ? Math.max(0, price - s.priorAssessed) * (s.taxRatePct / 100) * (holdMonths / 12)
    : 0;

  const holdMonthly = HOLD_ITEMS.reduce((a, i) => a + (s.hold[i.id] ?? 0), 0);
  /* Builder's risk covers an open structure, not a household, so it runs over
     the empty months only. On an ordinary flip every month is empty and this
     is the figure it always was. */
  const builderRiskTotal = s.builderRiskUnit === '%'
    ? rehabTotal * (s.builderRisk / 100)
    : s.builderRisk * vacantMonths;

  const monthsFor = (i: LineDef) => i.vacantOnly ? vacantMonths : holdMonths;
  const holdItemsTotal = HOLD_ITEMS.reduce((a, i) => a + (s.hold[i.id] ?? 0) * monthsFor(i), 0);

  /* What the occupied months cost in holding terms. The interest over those
     months belongs in the comparison too, but it is not computed until the
     financing block below, so the credit itself is settled there. */
  const occupiedHolding = propertyTax * (holdMonths > 0 ? occupancyMonths / holdMonths : 0)
    + HOLD_ITEMS.reduce((a, i) => a + (i.vacantOnly ? 0 : (s.hold[i.id] ?? 0)), 0) * occupancyMonths;

  const holdLines: CostLine[] = [
    { id: 'propertyTax', label: 'Property tax — reassessed at purchase price', amount: propertyTax,
      hint: supplementalTax > 0 ? 'Includes the supplemental bill below' : undefined },
    ...(supplementalTax > 0
      ? [{ id: 'supplemental', label: 'of which supplemental bill', amount: supplementalTax, disclosure: true,
           hint: 'The separate bill for the gap between the seller’s roll value and yours' }]
      : []),
    { id: 'builderRisk', label: "Builder's risk insurance", amount: builderRiskTotal },
    ...HOLD_ITEMS.map(i => ({
      id: i.id, label: i.label, amount: (s.hold[i.id] ?? 0) * monthsFor(i),
      hint: s.liveIn && i.vacantOnly ? 'Empty months only — nobody is living there to need it' : i.hint,
    })),
  ];
  /* the supplemental row is disclosure inside the property-tax figure, so it is
     shown but never added again */
  const holdGross = propertyTax + builderRiskTotal + holdItemsTotal;

  /* ---------- selling ---------- */
  const sellShare = payerShare(s.transferPayer, 'sell');
  const sellCityTax = cityTransferTax(city, sale) * sellShare;
  const sellCountyTax = countyTransferTax(sale) * sellShare;
  const listComm = sale * (s.listCommPct / 100);
  const buyerComm = sale * (s.buyerCommPct / 100);
  const concessions = sale * (s.concessionsPct / 100);
  const stagingHold = s.stagingMo * marketMonths;

  const sellLines: CostLine[] = [
    { id: 'listComm', label: `Listing commission — ${s.listCommPct}%`, amount: listComm, derived: true },
    { id: 'buyerComm', label: `Buyer agent commission — ${s.buyerCommPct}%`, amount: buyerComm, derived: true },
    { id: 'sellCityTax', label: 'City transfer tax — sell-side share', amount: sellCityTax, derived: true },
    { id: 'sellCountyTax', label: 'County transfer tax — sell-side share', amount: sellCountyTax, derived: true },
    ...SELL_FLAT_ITEMS.map(i => ({ id: i.id, label: i.label, amount: s.sell[i.id] ?? 0 })),
    { id: 'stagingHold', label: `Staging — ${money0(s.stagingMo)}/mo over DOM + escrow`, amount: stagingHold, derived: true },
    { id: 'retrofit', label: 'Retrofit compliance', amount: s.retrofit },
    { id: 'concessions', label: `Seller concessions — ${s.concessionsPct}%`, amount: concessions, derived: true },
  ];
  const sellTotal = sellLines.reduce((a, l) => a + l.amount, 0);

  /* ---------- financing ---------- */
  let loanAtClose = 0, peakLoan = 0, downPayment = price;
  let interest = 0, principalPaid = 0, payoffAtSale = 0;
  let cashForRehab = rehabTotal;
  const finLines: CostLine[] = [];

  if (s.finMode === 'hard') {
    loanAtClose = price * (s.ltcPct / 100);
    downPayment = price - loanAtClose;
    const holdback = rehabTotal * (s.rehabFinancedPct / 100);
    cashForRehab = rehabTotal - holdback;
    const commitment = loanAtClose + holdback;
    peakLoan = commitment;
    payoffAtSale = commitment;

    const points = commitment * (s.pointsPct / 100);
    /* Draws release evenly across the rehab, so the rehab balance averages half
       the holdback while work is underway and sits at full through DOM and
       escrow. This is why a slipped schedule costs twice: holding AND interest. */
    const rehabInterestMonths = rehabPeriod / 2 + marketMonths;
    const rawInterest =
      loanAtClose * (s.hardRate / 100) * (holdMonths / 12) +
      holdback * (s.hardRate / 100) * (rehabInterestMonths / 12);
    const floor = loanAtClose * (s.hardRate / 100) * (s.minInterestMonths / 12);
    interest = Math.max(rawInterest, floor);
    const drawFees = s.drawCount * s.drawFee;
    const extension = s.overrunDays > 0 ? commitment * (s.extensionFeePct / 100) : 0;

    const purchaseInterest = loanAtClose * (s.hardRate / 100) * (holdMonths / 12);
    finLines.push(
      { id: 'points', label: `Origination — ${s.pointsPct} points on commitment`, amount: points, phase: 'close', derived: true },
      { id: 'lenderFees', label: 'Lender fees', amount: s.hardFees, phase: 'close', derived: true },
      { id: 'interestPurchase', label: 'Interest — purchase loan', amount: purchaseInterest, phase: 'hold', derived: true },
      { id: 'interestRehab', label: 'Interest — rehab draws', amount: interest - purchaseInterest, phase: 'hold', derived: true },
      { id: 'drawFees', label: `Draw fees — ${s.drawCount} draws`, amount: drawFees, phase: 'hold', derived: true },
    );
    if (extension > 0) finLines.push({ id: 'extension', label: 'Extension fee', amount: extension, phase: 'hold', derived: true });
  } else if (s.finMode === 'cash') {
    /* All cash: no loan, no lender, no interest. Every dollar is yours, which
       is why peak cash and profit converge in this mode. */
    loanAtClose = 0; peakLoan = 0; payoffAtSale = 0;
    downPayment = price;
    cashForRehab = rehabTotal;
  } else {
    loanAtClose = price * (s.ltvPct / 100);
    downPayment = price - loanAtClose;
    peakLoan = loanAtClose;
    /* A conventional purchase loan funds no rehab — the whole budget is cash,
       which is the real reason this mode changes the deal. */
    cashForRehab = rehabTotal;

    /* Both branches bill in whole months — a mortgage does not prorate a
       payment — and critically they must use the SAME month count, or the
       comparison between them measures rounding rather than amortization. */
    const months = Math.max(0, Math.round(holdMonths));
    if (s.convIO || s.convRate <= 0 || s.convTerm <= 0) {
      interest = loanAtClose * (s.convRate / 100) * (months / 12);
      principalPaid = 0;
      payoffAtSale = loanAtClose;
    } else {
      const pmt = monthlyPI(loanAtClose, s.convRate, s.convTerm);
      const bal = loanBalance(loanAtClose, s.convRate, s.convTerm, months);
      principalPaid = Math.max(0, loanAtClose - bal);
      interest = Math.max(0, pmt * months - principalPaid);
      payoffAtSale = bal;
    }
    const origination = loanAtClose * (s.originationPct / 100);
    const prepay = payoffAtSale * (s.prepayPct / 100);

    finLines.push(
      { id: 'origination', label: `Origination — ${s.originationPct}%`, amount: origination, phase: 'close', derived: true },
      { id: 'lenderFees', label: 'Lender fees', amount: s.convFees, phase: 'close', derived: true },
      { id: 'interest', label: s.convIO ? 'Interest — interest-only' : 'Interest portion of payments', amount: interest, phase: 'hold', derived: true,
        hint: s.convIO ? undefined : 'Principal is a balance transfer, not an expense — it is not in this figure' },
    );
    if (prepay > 0) finLines.push({ id: 'prepay', label: 'Prepayment penalty', amount: prepay, phase: 'hold', derived: true });
  }
  const finGross = finLines.reduce((a, l) => a + l.amount, 0);

  /* ---------- the live-in credit ----------
     Housing you would have paid for anyway is not a cost of the project. The
     credit stops at what those months actually cost to live in — the holding
     costs plus the interest over them — because renting somewhere cheaper is
     a saving on your household budget, not profit the deal earned. Interest
     is apportioned evenly, which understates an amortizing loan's front-loaded
     years and so errs toward the conservative side.

     It is then split across the two blocks it offsets rather than dumped on
     one, so neither subtotal goes negative and each line says what it paid
     for: you were buying shelter with both the carry and the interest. */
  const occupiedInterest = interest * (holdMonths > 0 ? occupancyMonths / holdMonths : 0);
  const housingCredit = Math.min(
    Math.max(0, s.avoidedHousing) * occupancyMonths, occupiedHolding + occupiedInterest);
  const holdCredit = Math.min(housingCredit, occupiedHolding);
  const finCredit = housingCredit - holdCredit;
  const monthsLabel = `${Math.round(occupancyMonths)} months living there instead of renting`;
  if (holdCredit > 0) {
    holdLines.push({
      id: 'housingCredit', label: 'Housing you would have paid for anyway',
      amount: -holdCredit, phase: 'hold', derived: true, hint: monthsLabel,
    });
  }
  if (finCredit > 0) {
    finLines.push({
      id: 'housingCreditInterest', label: 'Interest you would have paid as rent',
      amount: -finCredit, phase: 'hold', derived: true, hint: monthsLabel,
    });
  }
  const holdTotal = holdGross - holdCredit;
  const finTotal = finGross - finCredit;

  /* ---------- the P&L ---------- */
  const netProceeds = sale - sellTotal;
  /* Deliberately pre-tax and nothing else. What a flip costs in income tax
     depends on your other income, your entity and whether the IRS treats you
     as a dealer — none of which a screening model knows. Applying one blended
     rate here would put a confident-looking number on a guess. */
  const profit = netProceeds - price - acqTotal - rehabTotal - holdTotal - finTotal;

  /* ---------- capital ----------
     A flip throws off no interim income, so cumulative cash out IS peak cash.
     Principal repaid on a conventional loan is cash out during the hold that
     returns as a smaller payoff — it moves peak cash and nothing else. */
  const finAt = (phase: 'close' | 'hold') =>
    finLines.filter(l => l.phase === phase).reduce((a, l) => a + l.amount, 0);
  const cashToClose = downPayment + acqTotal + finAt('close');
  const cashDuringHold = holdTotal + cashForRehab + principalPaid + finAt('hold');
  const peakCash = cashToClose + cashDuringHold;
  const cashBackAtClose = netProceeds - payoffAtSale;
  /* CA withholds 3 1/3% of the sale price at close and credits it against the
     tax you later owe. It moves cash timing at the closing table; it is not a
     cost, and it never touches profit. */
  const withholding = s.withholdingOn ? sale * 0.0333 : 0;

  const sqft = s.prop.sqft || 0;
  return {
    sale, rehabTotal,
    rehabPeriod, marketMonths, occupancyMonths, vacantMonths, holdMonths, housingCredit,
    acqLines, acqTotal,
    holdLines, holdTotal, holdMonthly, propertyTax, supplementalTax,
    sellLines, sellTotal, sellPctOfSale: sale > 0 ? sellTotal / sale * 100 : 0,
    finLines, finTotal, loanAtClose, peakLoan, downPayment,
    interest, principalPaid, payoffAtSale, cashForRehab,
    netProceeds, profit,
    cashToClose, cashDuringHold, peakCash, cashBackAtClose, withholding,
    roi: peakCash > 0 ? profit / peakCash * 100 : 0,
    annualizedRoi: peakCash > 0 && holdMonths > 0
      ? (profit / peakCash * 100) * (12 / holdMonths) : 0,
    margin: sale > 0 ? profit / sale * 100 : 0,
    grossSpread: sale > 0 ? (sale - price) / sale * 100 : 0,
    arvPsf: sqft > 0 ? sale / sqft : 0,
    rehabPsf: sqft > 0 ? rehabTotal / sqft : 0,
    pricePsf: sqft > 0 ? price / sqft : 0,
  };
}

/* ------------------------------------------------------------------- solvers */

/** Profit is monotonically decreasing in price but genuinely steps at transfer
    tax cliffs, so bisection rather than anything gradient-based. */
export function solveMAO(s: FlipState): number {
  const target = s.minProfit;
  const profitAt = (p: number) => computeFlip(s, 'base', 'base', p).profit - target;
  let lo = 0, hi = Math.max(s.arv.base, 1);
  if (profitAt(lo) < 0) return 0;          /* the deal fails even at a $0 basis */
  if (profitAt(hi) > 0) return hi;         /* would clear the bar paying full ARV */
  for (let i = 0; i < 100 && hi - lo > 1; i++) {
    const mid = (lo + hi) / 2;
    if (profitAt(mid) > 0) lo = mid; else hi = mid;
  }
  return lo;
}

/** The 70% rule, as a cross-check rather than a verdict. */
export function seventyRule(s: FlipState): number {
  return 0.70 * s.arv.base - s.rehab.base;
}

/* --------------------------------------------------------------- sensitivity */

export interface Sensitivity {
  arvAxis: number[];
  rehabAxis: number[];
  cells: number[][];      /* [rehabIndex][arvIndex] → net profit after tax */
  min: number;
  max: number;
  baseArv: number;
  baseRehab: number;
}

/** n evenly spaced points spanning low..high with 10% headroom past each end,
    so the break-even boundary is visible instead of clipped off the edge. */
function axis(t: Triple, n: number): number[] {
  const lo = Math.min(t.low, t.base, t.high);
  const hi = Math.max(t.low, t.base, t.high);
  const spread = hi - lo || Math.abs(t.base) * 0.2 || 1;
  const from = lo - spread * 0.1;
  const to = hi + spread * 0.1;
  const step = (to - from) / (n - 1);
  return Array.from({ length: n }, (_, i) => from + step * i);
}

export function buildSensitivity(s: FlipState, n = 7): Sensitivity {
  const arvAxis = axis(s.arv, n);
  const rehabAxis = axis(s.rehab, n);
  let min = Infinity, max = -Infinity;
  const cells = rehabAxis.map(rehab => arvAxis.map(arv => {
    const probe: FlipState = { ...s, arv: { low: arv, base: arv, high: arv } };
    const v = computeFlip(probe, 'base', 'base', undefined, rehab).profit;
    if (v < min) min = v;
    if (v > max) max = v;
    return v;
  }));
  return { arvAxis, rehabAxis, cells, min, max, baseArv: s.arv.base, baseRehab: s.rehab.base };
}

/* ------------------------------------------------------------------ verdicts */

export type Verdict = 'good' | 'ok' | 'bad';

export function verdictFor(r: FlipResult, s: FlipState): { v: Verdict; title: string; sub: string } {
  if (r.profit <= 0) {
    return { v: 'bad', title: 'Loses money', sub: 'This deal is under water at the base case. Re-trade the price or walk.' };
  }
  if (r.profit < s.minProfit) {
    return {
      v: 'ok', title: 'Below your profit floor',
      sub: `Clears break-even but lands under your ${Math.round(s.minProfit / 1000)}k minimum. Thin margin for the risk.`,
    };
  }
  return { v: 'good', title: 'Clears your floor', sub: 'Base case beats your minimum profit with room for the ARV to slip.' };
}

/** Cities helper re-exported so the UI has one import for flip concerns. */
export type { CityPreset };
