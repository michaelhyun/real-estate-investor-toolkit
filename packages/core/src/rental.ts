/* Rental Property Analyzer engine — direct port of the original rental.html
   compute(). The saved-deal schema (rentalDeals.v3) is preserved exactly,
   including fields whose editing UI is not yet ported (comps, capex, hood):
   they pass through save/load untouched. */

import { monthlyPI, loanBalance } from './mortgage';

export interface ExpenseDef {
  id: string;
  label: string;
  mode: 'time' | 'rent';   /* time: $/mo vs $/yr · rent: $/mo vs % of rent */
  unit: 'mo' | 'yr' | '$' | '%';
  val: number;
}

export const EXPENSES: ExpenseDef[] = [
  { id: 'tax',       label: 'Property tax',          mode: 'time', unit: 'mo', val: 250 },
  { id: 'ins',       label: 'Insurance',             mode: 'time', unit: 'mo', val: 120 },
  { id: 'hoa',       label: 'HOA fees',              mode: 'time', unit: 'mo', val: 0 },
  { id: 'mgmt',      label: 'Property management',   mode: 'rent', unit: '%',  val: 10 },
  { id: 'maint',     label: 'Maintenance & repairs', mode: 'rent', unit: '%',  val: 8 },
  { id: 'capex',     label: 'CapEx reserve',         mode: 'rent', unit: '%',  val: 8 },
  { id: 'landscape', label: 'Landscaping',           mode: 'time', unit: 'mo', val: 0 },
  { id: 'cleaning',  label: 'Cleaning',              mode: 'time', unit: 'mo', val: 0 },
  { id: 'pest',      label: 'Pest control',          mode: 'time', unit: 'mo', val: 0 },
  { id: 'misc',      label: 'Miscellaneous',         mode: 'time', unit: 'mo', val: 0 },
];

export const UTIL_LABELS: Record<string, string> = {
  electric: 'Electricity', water: 'Water', sewer: 'Sewer',
  trash: 'Trash', gas: 'Gas', internet: 'Internet',
};
export const UNIT_LABELS: Record<string, string> = { mo: '$/mo', yr: '$/yr', $: '$/mo', '%': '% rent' };
export const UTILS = ['electric', 'water', 'sewer', 'trash', 'gas', 'internet'] as const;
export const OTHER_INC = ['laundry', 'parking', 'storage', 'pet', 'other'] as const;
export const OTHER_INC_LABELS: Record<string, string> = {
  laundry: 'Laundry', parking: 'Parking', storage: 'Storage', pet: 'Pet rent', other: 'Other',
};

export const SOW_SECTIONS = [
  { id: 'kitchen',     label: 'Kitchen' },
  { id: 'bathrooms',   label: 'Bathrooms' },
  { id: 'bedrooms',    label: 'Bedrooms' },
  { id: 'living',      label: 'Living Areas' },
  { id: 'exterior',    label: 'Exterior & Roof' },
  { id: 'systems',     label: 'Systems — HVAC · Plumbing · Electrical' },
  { id: 'landscaping', label: 'Landscaping' },
  { id: 'other',       label: 'Other' },
] as const;

export interface SowItem { sec: string; desc: string; cost: number; }
export interface CompItem { addr: string; amt: number; sqft: number; beds: string; baths: string; }
export interface CapexItem { type: string; name: string; year: string; cond: string; notes: string; }
export interface UrlItem { label: string; url: string; }

export interface DealState {
  name: string;
  price: number;
  downPct: number;
  rehab: number;
  closing: number;
  closingUnit: '$' | '%';
  utilUnits: Record<string, 'mo' | 'yr'>;
  rate: number;
  term: number;
  ioOn: boolean;
  ioYears: number;
  armOn: boolean;
  armFixed: number;
  armFreq: number;
  armRate: number;
  sellerOn: boolean;
  sellerAmt: number;
  sellerRate: number;
  sellerTerm: number;
  sellerType: 'am' | 'io';
  subtoOn: boolean;
  subtoBal: number;
  subtoRate: number;
  subtoTerm: number;
  rent: number;
  vacancy: number;
  rentGrowth: number;
  expGrowth: number;
  appr: number;
  sellCost: number;
  expenses: Record<string, number>;
  units: Record<string, string>;
  otherInc: Record<string, number>;
  utils: Record<string, number>;
  sow: SowItem[];
  salesComps: CompItem[];
  rentComps: CompItem[];
  capex: CapexItem[];
  hood: { crime: string; schools: string; notes: string };
  prop: {
    address: string; beds: string; baths: string; sqft: string; year: string;
    list: number; video: string; urls: UrlItem[];
  };
  savedAt?: string;
}

export function defaultDealState(): DealState {
  return {
    name: '',
    price: 250000,
    downPct: 20,
    rehab: 10000,
    closing: 6000,
    closingUnit: '$',
    utilUnits: Object.fromEntries(UTILS.map(k => [k, 'mo'])) as Record<string, 'mo' | 'yr'>,
    rate: 7,
    term: 30,
    ioOn: false,
    ioYears: 10,
    armOn: false,
    armFixed: 7,
    armFreq: 6,
    armRate: 8.5,
    sellerOn: false,
    sellerAmt: 0,
    sellerRate: 6,
    sellerTerm: 30,
    sellerType: 'am',
    subtoOn: false,
    subtoBal: 0,
    subtoRate: 4,
    subtoTerm: 26,
    rent: 2000,
    vacancy: 5,
    rentGrowth: 3,
    expGrowth: 2.5,
    appr: 3,
    sellCost: 7,
    expenses: Object.fromEntries(EXPENSES.map(e => [e.id, e.val])),
    units: Object.fromEntries(EXPENSES.map(e => [e.id, e.unit])),
    otherInc: Object.fromEntries(OTHER_INC.map(k => [k, 0])),
    utils: Object.fromEntries(UTILS.map(k => [k, 0])),
    sow: [],
    salesComps: [],
    rentComps: [],
    capex: [],
    hood: { crime: '', schools: '', notes: '' },
    prop: { address: '', beds: '', baths: '', sqft: '', year: '', list: 0, video: '', urls: [] },
  };
}

/* monthly cost of one expense line */
export function expMonthly(unit: string, v: number, rent: number): number {
  if (unit === '%') return rent * v / 100;
  if (unit === 'yr') return v / 12;
  return v; /* 'mo' or '$' */
}

export interface ExpLine extends ExpenseDef { raw: number; monthly: number; }

export interface ProFormaYear {
  y: number; yRent: number; yOther: number; yVac: number; yEff: number;
  yOpEx: number; yNOI: number; yDebt: number; yCF: number; cumCF: number;
  value: number; bal: number; equity: number;
}

export interface DealResult {
  downAmt: number; sellerAmt: number; subtoBal: number; newLoan: number; overBy: number;
  piBank: number; piSeller: number; piSub: number; pi: number;
  payAfterArm: number; payAfterIO: number;
  closingAmt: number; cashInvested: number; otherIncTotal: number; utilTotal: number;
  gross: number; vacLoss: number; effIncome: number; expLines: ExpLine[]; opEx: number;
  noi: number; cashFlow: number; annualCF: number; coc: number; dscr: number;
  onePct: number; grm: number; years: ProFormaYear[];
  netSale: number; proceeds: number; totalProfit: number; roi5: number; annualized: number;
}

export function compute(s: DealState): DealResult {
  const downAmt = s.price * s.downPct / 100;
  const sellerAmt = s.sellerOn ? s.sellerAmt : 0;
  const subtoBal = s.subtoOn ? s.subtoBal : 0;
  const financedOther = sellerAmt + subtoBal;
  const newLoan = Math.max(0, s.price - downAmt - financedOther);
  const overBy = (downAmt + financedOther) - s.price;

  /* bank-loan schedule: supports an interest-only period and an ARM adjustment */
  const termM = Math.round(s.term * 12);
  const ioEndM = s.ioOn ? Math.round(Math.min((s.ioYears > 0 ? s.ioYears : s.term), s.term) * 12) : 0;
  const armStartM = s.armOn ? Math.min(Math.round((s.armFixed || 0) * 12), termM) : Infinity;
  const bank = (() => {
    const res = { pay1: 0, payAfterArm: 0, payAfterIO: 0, yearDebt: [0, 0, 0, 0, 0], balYear: [0, 0, 0, 0, 0] };
    if (newLoan <= 0) return res;
    let bal = newLoan, pay = 0;
    const end = Math.min(termM, 60);
    for (let m = 1; m <= end; m++) {
      const annual = (s.armOn && m > armStartM) ? s.armRate : s.rate;
      const rm = annual / 100 / 12;
      const isIO = m <= ioEndM;
      if (isIO) pay = bal * rm;
      else if (m === 1 || m === ioEndM + 1 || m === armStartM + 1)
        pay = monthlyPI(bal, annual, (termM - m + 1) / 12);
      if (m === 1) res.pay1 = pay;
      if (m === armStartM + 1) res.payAfterArm = pay;
      if (ioEndM > 0 && m === ioEndM + 1) res.payAfterIO = pay;
      const interest = bal * rm;
      const principal = isIO ? 0 : Math.min(bal, pay - interest);
      bal -= principal;
      res.yearDebt[Math.ceil(m / 12) - 1] += pay;
      if (m % 12 === 0) res.balYear[m / 12 - 1] = bal;
    }
    return res;
  })();
  const piBank = bank.pay1;
  const piSeller = !s.sellerOn ? 0 :
    (s.sellerType === 'io' ? sellerAmt * s.sellerRate / 100 / 12 : monthlyPI(sellerAmt, s.sellerRate, s.sellerTerm));
  const piSub = s.subtoOn ? monthlyPI(subtoBal, s.subtoRate, s.subtoTerm) : 0;
  const pi = piBank + piSeller + piSub;

  const closingAmt = (s.closingUnit === '%') ? s.price * (s.closing || 0) / 100 : (s.closing || 0);
  const cashInvested = downAmt + s.rehab + closingAmt;

  const otherIncTotal = OTHER_INC.reduce((t, k) => t + (s.otherInc[k] || 0), 0);
  const utilTotal = UTILS.reduce((t, k) => {
    const v = s.utils[k] || 0;
    return t + (s.utilUnits?.[k] === 'yr' ? v / 12 : v);
  }, 0);

  const gross = s.rent + otherIncTotal;
  const vacLoss = s.rent * s.vacancy / 100;
  const effIncome = gross - vacLoss;

  const expLines: ExpLine[] = EXPENSES.map(e => ({
    ...e, unit: (s.units[e.id] || e.unit) as ExpenseDef['unit'], raw: s.expenses[e.id] || 0,
    monthly: expMonthly(s.units[e.id] || e.unit, s.expenses[e.id] || 0, s.rent),
  }));
  const opEx = expLines.reduce((t, e) => t + e.monthly, 0) + utilTotal;
  const noi = effIncome - opEx;
  const cashFlow = noi - pi;
  const annualCF = cashFlow * 12;
  const coc = cashInvested > 0 ? annualCF / cashInvested * 100 : NaN;
  const dscr = pi > 0 ? (noi / pi) : NaN;

  const basis = s.price + s.rehab;
  const onePct = basis > 0 ? s.rent / basis * 100 : 0;
  const grm = s.rent > 0 ? s.price / (s.rent * 12) : NaN;

  /* balances across all three notes at m months (m is always a year boundary) */
  const balancesAt = (m: number): number => {
    const bankBal = newLoan > 0 ? bank.balYear[m / 12 - 1] : 0;
    const seller = !s.sellerOn ? 0 :
      (s.sellerType === 'io' ? sellerAmt : loanBalance(sellerAmt, s.sellerRate, s.sellerTerm, m));
    const sub = s.subtoOn ? loanBalance(subtoBal, s.subtoRate, s.subtoTerm, m) : 0;
    return bankBal + seller + sub;
  };

  const years: ProFormaYear[] = [];
  let cumCF = 0;
  for (let y = 1; y <= 5; y++) {
    const g = Math.pow(1 + s.rentGrowth / 100, y - 1);
    const eg = Math.pow(1 + s.expGrowth / 100, y - 1);
    const yRent = s.rent * 12 * g, yOther = otherIncTotal * 12 * g;
    const yVac = yRent * s.vacancy / 100;
    const yEff = yRent + yOther - yVac;
    const yOpEx = expLines.reduce((t, e) => {
      if (e.unit === '%') return t + yRent * e.raw / 100;
      if (e.unit === 'yr') return t + e.raw * eg;
      return t + e.raw * 12 * eg;
    }, 0) + utilTotal * 12 * eg;
    const yNOI = yEff - yOpEx;
    const yDebt = bank.yearDebt[y - 1] + (piSeller + piSub) * 12;
    const yCF = yNOI - yDebt;
    cumCF += yCF;
    const value = s.price * Math.pow(1 + s.appr / 100, y);
    const bal = balancesAt(y * 12);
    years.push({ y, yRent, yOther, yVac, yEff, yOpEx, yNOI, yDebt, yCF, cumCF, value, bal, equity: value - bal });
  }
  const y5 = years[4];
  const netSale = y5.value * (1 - s.sellCost / 100);
  const proceeds = netSale - y5.bal;
  const totalProfit = proceeds + y5.cumCF - cashInvested;
  const roi5 = cashInvested > 0 ? totalProfit / cashInvested * 100 : NaN;
  const annualized = cashInvested > 0 && (totalProfit + cashInvested) > 0
    ? (Math.pow((totalProfit + cashInvested) / cashInvested, 1 / 5) - 1) * 100 : NaN;

  return {
    downAmt, sellerAmt, subtoBal, newLoan, overBy, piBank, piSeller, piSub, pi,
    payAfterArm: bank.payAfterArm, payAfterIO: bank.payAfterIO,
    closingAmt, cashInvested, otherIncTotal, utilTotal, gross, vacLoss, effIncome, expLines, opEx,
    noi, cashFlow, annualCF, coc, dscr, onePct, grm, years, netSale, proceeds, totalProfit, roi5, annualized,
  };
}
