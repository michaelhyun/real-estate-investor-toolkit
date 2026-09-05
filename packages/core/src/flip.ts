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
export type FinanceMode = 'hard' | 'conv';

export interface Triple { low: number; base: number; high: number; }

/* ---------------------------------------------------------------- line items */

export interface LineDef {
  id: string; label: string; val: number;
  /** short clarification under the label */
  hint?: string;
  /** guidance for the notes column — where the number comes from, what range is
      normal, and when to move it. Written for someone doing their first flip. */
  note?: string;
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
  { id: 'inspGeneral', label: 'General home inspection', val: 0,
    note: '$500\u2013800 for your own. Seller\u2019s package normally covers it.' },
  { id: 'inspPest', label: 'Pest / termite inspection', val: 0,
    note: '$350\u2013500, almost always in the seller\u2019s package.' },
  { id: 'inspSewer', label: 'Sewer lateral video scope', val: 350,
    note: 'Worth it anyway \u2014 a failed lateral is $15\u201330k and four cities demand a certificate.' },
  { id: 'inspFoundation', label: 'Foundation / structural', val: 0,
    note: '$600\u20131,000. Order on pre-1950 or any visible cracking.' },
  { id: 'inspRoof', label: 'Roof inspection', val: 0,
    note: '$300\u2013450, usually in the seller\u2019s package.' },
  { id: 'appraisal', label: 'Appraisal / BPO', val: 900,
    note: '$700\u20131,100, lender-required and buyer-paid. $0 all cash.' },
  { id: 'miscAcq', label: 'Wire, notary, courier, misc', val: 250,
    note: 'Small fixed escrow charges.' },
  { id: 'buyComm', label: 'Buy-side commission', val: 0,
    note: '$0 representing yourself. Your own side is income, not a cost.' },
];

/** Holding costs, all $/month over the hold period. */
export const HOLD_ITEMS: LineDef[] = [
  { id: 'insVacant', label: 'Vacant dwelling insurance', val: 350,
    note: '$250\u2013450/mo and not optional \u2014 an HO-3 voids once unoccupied.' },
  { id: 'electric', label: 'Electricity', val: 90, note: 'Construction power runs well above a lived-in bill.' },
  { id: 'water', label: 'Water', val: 60, note: 'Keep it on for the trades and for landscaping.' },
  { id: 'gas', label: 'Gas', val: 40, note: 'Often off during a gut, back on for staging.' },
  { id: 'trash', label: 'Trash', val: 30, note: 'Separate from demo dumpsters, which sit in rehab.' },
  { id: 'landscape', label: 'Landscaping & site upkeep', val: 150,
    note: 'An overgrown yard reads as distressed. Cheap insurance.' },
  { id: 'security', label: 'Security — alarm & cameras', val: 85,
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
  /* One estimate plus a dollar buffer, rather than three scenarios. The budget
     the model spends is est + buffer; the buffer is also what sets the width of
     the rehab axis on the sensitivity grid, so the number you pick for headroom
     is the same number the grid stress-tests you against. */
  rehabEst: number;
  rehabBuffer: number;

  /* timeline — three phases plus an overrun you can dial in */
  rehabMonths: number;
  domDays: number;
  escrowDays: number;
  overrunMonths: number;

  acq: Record<string, number>;

  hold: Record<string, number>;
  taxRatePct: number;
  priorAssessed: number;
  builderRisk: number;
  builderRiskUnit: '$' | '%';

  sell: Record<string, number>;
  listCommPct: number;
  buyCommPct: number;
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

  taxPct: number;
  lossOffsetsIncome: boolean;
  minProfit: number;
  minProfitBasis: 'after' | 'pre';

  /* Checklist selections only. Prices are NOT here: the catalog is shared
     across every deal so a corrected price propagates instead of needing to be
     re-fixed forever. A deal owns what is specific to it — what is checked and
     any quantity override — and nothing else. */
  checked: Record<string, boolean>;
  qty: Record<string, number>;
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
    rehabEst: 220000,
    rehabBuffer: 40000,

    rehabMonths: 5,
    domDays: 21,
    escrowDays: 30,
    overrunMonths: 0,

    acq: seed(ACQ_ITEMS),

    hold: seed(HOLD_ITEMS),
    taxRatePct: 1.25,
    priorAssessed: 0,
    builderRisk: 180,
    builderRiskUnit: '$',

    sell: seed(SELL_FLAT_ITEMS),
    listCommPct: 2.5,
    buyCommPct: 2.5,
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

    taxPct: 45,
    lossOffsetsIncome: false,
    minProfit: 75000,
    minProfitBasis: 'after',

    checked: {},
    qty: {},
  };
}

/* --------------------------------------------------------------- the result */

export interface CostLine {
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
  rehabEst: number;
  rehabBuffer: number;
  rehabTotal: number;

  rehabPeriod: number;
  marketMonths: number;
  holdMonths: number;

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
  preTaxProfit: number;
  tax: number;
  netProfit: number;

  cashToClose: number;
  cashDuringHold: number;
  peakCash: number;
  cashBackAtClose: number;
  withholding: number;

  roi: number;
  annualizedRoi: number;
  marginPreTax: number;
  marginAfterTax: number;
  grossSpread: number;
  arvPsf: number;
  rehabPsf: number;
  pricePsf: number;
}

/* ------------------------------------------------------------------ compute */

export function computeFlip(
  s: FlipState, arvKey: ScenarioKey = 'base',
  rehabOverride?: number, priceOverride?: number,
): FlipResult {
  const city = findCity(s.citySlug);
  const price = priceOverride ?? s.price;
  const sale = s.arv[arvKey] || 0;

  const rehabEst = s.rehabEst || 0;
  const rehabBuffer = s.rehabBuffer || 0;
  /* the sensitivity grid probes a rehab number directly; everything else
     spends the budget, which is the estimate plus its buffer */
  const rehabTotal = rehabOverride ?? (rehabEst + rehabBuffer);

  const rehabPeriod = Math.max(0, s.rehabMonths + s.overrunMonths);
  const marketMonths = Math.max(0, (s.domDays + s.escrowDays) / DAYS_PER_MONTH);
  const holdMonths = rehabPeriod + marketMonths;

  /* ---------- acquisition ----------
     `transferPayer` is seeded from the city preset when a city is picked, but
     the deal's own value is what applies — local custom is a starting point,
     not a rule, and on a large Oakland or Berkeley bill it is negotiable. */
  const buyShare = payerShare(s.transferPayer, 'buy');
  const buyCityTax = cityTransferTax(city, price) * buyShare;
  const buyCountyTax = countyTransferTax(price) * buyShare;
  const acqLines: CostLine[] = ACQ_ITEMS.map(i => ({
    label: i.label, amount: s.acq[i.id] ?? 0, hint: i.hint,
  }));
  if (buyCityTax > 0) acqLines.push({ label: 'City transfer tax — buy-side share', amount: buyCityTax, derived: true });
  if (buyCountyTax > 0) acqLines.push({ label: 'County transfer tax — buy-side share', amount: buyCountyTax, derived: true });
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
  const builderRiskTotal = s.builderRiskUnit === '%'
    ? rehabTotal * (s.builderRisk / 100)
    : s.builderRisk * holdMonths;

  const holdLines: CostLine[] = [
    { label: 'Property tax — reassessed at purchase price', amount: propertyTax,
      hint: supplementalTax > 0 ? 'Includes the supplemental bill below' : undefined },
    ...(supplementalTax > 0
      ? [{ label: 'of which supplemental bill', amount: supplementalTax, disclosure: true,
           hint: 'The separate bill for the gap between the seller’s roll value and yours' }]
      : []),
    { label: "Builder's risk insurance", amount: builderRiskTotal },
    ...HOLD_ITEMS.map(i => ({ label: i.label, amount: (s.hold[i.id] ?? 0) * holdMonths, hint: i.hint })),
  ];
  /* the supplemental row is disclosure inside the property-tax figure, so it is
     shown but never added again */
  const holdTotal = propertyTax + builderRiskTotal + holdMonthly * holdMonths;

  /* ---------- selling ---------- */
  const sellShare = payerShare(s.transferPayer, 'sell');
  const sellCityTax = cityTransferTax(city, sale) * sellShare;
  const sellCountyTax = countyTransferTax(sale) * sellShare;
  const listComm = sale * (s.listCommPct / 100);
  const buyerComm = sale * (s.buyCommPct / 100);
  const concessions = sale * (s.concessionsPct / 100);
  const stagingHold = s.stagingMo * marketMonths;

  const sellLines: CostLine[] = [
    { label: `Listing commission — ${s.listCommPct}%`, amount: listComm, derived: true },
    { label: `Buyer agent commission — ${s.buyCommPct}%`, amount: buyerComm, derived: true },
    { label: 'City transfer tax — sell-side share', amount: sellCityTax, derived: true },
    { label: 'County transfer tax — sell-side share', amount: sellCountyTax, derived: true },
    ...SELL_FLAT_ITEMS.map(i => ({ label: i.label, amount: s.sell[i.id] ?? 0 })),
    { label: `Staging — ${money0(s.stagingMo)}/mo over DOM + escrow`, amount: stagingHold, derived: true },
    { label: 'Retrofit compliance', amount: s.retrofit },
    { label: `Seller concessions — ${s.concessionsPct}%`, amount: concessions, derived: true },
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
    const extension = s.overrunMonths > 0 ? commitment * (s.extensionFeePct / 100) : 0;

    const purchaseInterest = loanAtClose * (s.hardRate / 100) * (holdMonths / 12);
    finLines.push(
      { label: `Origination — ${s.pointsPct} points on commitment`, amount: points, phase: 'close', derived: true },
      { label: 'Lender fees', amount: s.hardFees, phase: 'close', derived: true },
      { label: 'Interest — purchase loan', amount: purchaseInterest, phase: 'hold', derived: true },
      { label: 'Interest — rehab draws', amount: interest - purchaseInterest, phase: 'hold', derived: true },
      { label: `Draw fees — ${s.drawCount} draws`, amount: drawFees, phase: 'hold', derived: true },
    );
    if (extension > 0) finLines.push({ label: 'Extension fee', amount: extension, phase: 'hold', derived: true });
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
      { label: `Origination — ${s.originationPct}%`, amount: origination, phase: 'close', derived: true },
      { label: 'Lender fees', amount: s.convFees, phase: 'close', derived: true },
      { label: s.convIO ? 'Interest — interest-only' : 'Interest portion of payments', amount: interest, phase: 'hold', derived: true,
        hint: s.convIO ? undefined : 'Principal is a balance transfer, not an expense — it is not in this figure' },
    );
    if (prepay > 0) finLines.push({ label: 'Prepayment penalty', amount: prepay, phase: 'hold', derived: true });
  }
  const finTotal = finLines.reduce((a, l) => a + l.amount, 0);

  /* ---------- the P&L ---------- */
  const netProceeds = sale - sellTotal;
  const preTaxProfit = netProceeds - price - acqTotal - rehabTotal - holdTotal - finTotal;
  const tax = preTaxProfit > 0
    ? preTaxProfit * (s.taxPct / 100)
    : (s.lossOffsetsIncome ? preTaxProfit * (s.taxPct / 100) : 0);
  const netProfit = preTaxProfit - tax;

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
  /* CA withholding is a prepayment against the tax already modelled above, so
     it is a cash-flow timing item and never an expense. */
  const withholding = s.withholdingOn ? sale * 0.0333 : 0;

  const sqft = s.prop.sqft || 0;
  return {
    sale, rehabEst, rehabBuffer, rehabTotal,
    rehabPeriod, marketMonths, holdMonths,
    acqLines, acqTotal,
    holdLines, holdTotal, holdMonthly, propertyTax, supplementalTax,
    sellLines, sellTotal, sellPctOfSale: sale > 0 ? sellTotal / sale * 100 : 0,
    finLines, finTotal, loanAtClose, peakLoan, downPayment,
    interest, principalPaid, payoffAtSale, cashForRehab,
    netProceeds, preTaxProfit, tax, netProfit,
    cashToClose, cashDuringHold, peakCash, cashBackAtClose, withholding,
    roi: peakCash > 0 ? netProfit / peakCash * 100 : 0,
    annualizedRoi: peakCash > 0 && holdMonths > 0
      ? (netProfit / peakCash * 100) * (12 / holdMonths) : 0,
    marginPreTax: sale > 0 ? preTaxProfit / sale * 100 : 0,
    marginAfterTax: sale > 0 ? netProfit / sale * 100 : 0,
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
  const profitAt = (p: number) => {
    const r = computeFlip(s, 'base', undefined, p);
    return (s.minProfitBasis === 'pre' ? r.preTaxProfit : r.netProfit) - target;
  };
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
  return 0.70 * s.arv.base - (s.rehabEst + s.rehabBuffer);
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

/** The rehab axis runs from spending exactly your estimate to burning twice
    your buffer, which puts the budget you are actually underwriting — estimate
    plus buffer — dead centre. Coming in under estimate is not a case worth
    reserving grid space for. */
export function buildSensitivity(s: FlipState, n = 7): Sensitivity {
  const est = s.rehabEst || 0;
  const buffer = s.rehabBuffer || Math.abs(est) * 0.1 || 1;
  const step = (2 * buffer) / (n - 1);
  const rehabAxis = Array.from({ length: n }, (_, i) => est + step * i);
  const arvAxis = axis(s.arv, n);

  let min = Infinity, max = -Infinity;
  const cells = rehabAxis.map(rehab => arvAxis.map(arv => {
    const probe: FlipState = { ...s, arv: { low: arv, base: arv, high: arv } };
    const v = computeFlip(probe, 'base', rehab).netProfit;
    if (v < min) min = v;
    if (v > max) max = v;
    return v;
  }));
  return { arvAxis, rehabAxis, cells, min, max, baseArv: s.arv.base, baseRehab: est + buffer };
}

/* ------------------------------------------------------------------ verdicts */

export type Verdict = 'good' | 'ok' | 'bad';

export function verdictFor(r: FlipResult, s: FlipState): { v: Verdict; title: string; sub: string } {
  if (r.netProfit <= 0) {
    return { v: 'bad', title: 'Loses money', sub: 'This deal is under water at the base case. Re-trade the price or walk.' };
  }
  if (r.netProfit < s.minProfit) {
    return {
      v: 'ok', title: 'Below your profit floor',
      sub: `Clears break-even but lands under your ${Math.round(s.minProfit / 1000)}k minimum. Thin margin for the risk.`,
    };
  }
  return { v: 'good', title: 'Clears your floor', sub: 'Base case beats your minimum profit with room for the ARV to slip.' };
}

/** Cities helper re-exported so the UI has one import for flip concerns. */
export type { CityPreset };
