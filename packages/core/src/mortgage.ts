/* Mortgage calculator engine — direct port of the original mortgage.html math.
   Phase-aware loan simulation: optional interest-only period, optional ARM
   adjustment (re-amortized over the remaining term), extra payments, PMI. */

export interface MortgageState {
  price: number;
  down: number;            /* value in the active unit */
  downUnit: '%' | '$';
  io: boolean;
  ioYears: number;
  rate: number;
  term: number;
  tax: number;             /* per year */
  ins: number;             /* per year */
  hoa: number;             /* per month */
  pmiRate: number;         /* annual % of loan */
  extra: number;           /* monthly extra principal */
  armOn: boolean;
  armFixed: number;
  armFreq: number;         /* 6 | 12 */
  armRate: number;
}

export interface MortgageDerived {
  downAmt: number;
  downPct: number;
}

export interface YearRow {
  y: number;
  interest: number;
  principal: number;
  balance: number;
}

export interface SimResult {
  loan: number;
  basePI: number;
  adjustedPI: number;
  postIOPI: number;
  pmiMonthly: number;
  months: number;
  totalInterest: number;
  totalPMI: number;
  pmiEndMonth: number;
  years: YearRow[];
  balloon: number;
}

export function monthlyPI(loan: number, ratePct: number, years: number): number {
  if (loan <= 0 || years <= 0) return 0;
  const r = ratePct / 100 / 12, n = years * 12;
  if (r === 0) return loan / n;
  return loan * r / (1 - Math.pow(1 + r, -n));
}

/* Remaining balance of an amortizing loan after monthsPaid payments. */
export function loanBalance(loan: number, ratePct: number, years: number, monthsPaid: number): number {
  if (loan <= 0) return 0;
  const r = ratePct / 100 / 12, n = years * 12, m = Math.min(monthsPaid, n);
  if (r === 0) return loan * (1 - m / n);
  const pay = monthlyPI(loan, ratePct, years);
  return Math.max(0, loan * Math.pow(1 + r, m) - pay * (Math.pow(1 + r, m) - 1) / r);
}

export function deriveDown(s: MortgageState): MortgageDerived {
  const downAmt = s.downUnit === '$' ? s.down : s.price * s.down / 100;
  const downPct = s.price > 0 ? downAmt / s.price * 100 : 0;
  return { downAmt, downPct };
}

export function simulate(s: MortgageState, extra: number): SimResult {
  const { downAmt, downPct } = deriveDown(s);
  const loan = Math.max(0, s.price - downAmt);
  const termMonths = Math.round(s.term * 12);
  const ioEnd = s.io ? Math.round(Math.min(s.ioYears > 0 ? s.ioYears : s.term, s.term) * 12) : 0;
  const armStart = s.armOn ? Math.min(Math.round(s.armFixed * 12), termMonths) : Infinity;
  const pmiMonthly = (downPct < 20 && s.pmiRate > 0) ? loan * s.pmiRate / 100 / 12 : 0;
  const pmiCutoff = s.price * 0.78;

  let bal = loan, m = 0, pay = 0, totalInterest = 0, totalPMI = 0, pmiEndMonth = 0;
  let initialPI = 0, adjustedPI = 0, postIOPI = 0;
  const years: YearRow[] = [];
  let yInt = 0, yPrin = 0;

  while (bal > 0.005 && m < termMonths) {
    m++;
    const annual = (s.armOn && m > armStart) ? s.armRate : s.rate;
    const rm = annual / 100 / 12;
    const isIO = m <= ioEnd;
    if (isIO) pay = bal * rm;                            /* IO payment tracks balance & current rate */
    else if (m === 1 || m === ioEnd + 1 || m === armStart + 1)
      pay = monthlyPI(bal, annual, (termMonths - m + 1) / 12);
    if (m === 1) initialPI = pay;
    if (m === armStart + 1) adjustedPI = pay;
    if (ioEnd > 0 && m === ioEnd + 1) postIOPI = pay;
    const interest = bal * rm;
    let principal = isIO ? extra : pay - interest + extra;
    if (!isIO && principal <= 0 && rm > 0) { break; }    /* payment doesn't cover interest */
    if (principal > bal) principal = bal;
    bal -= principal;
    totalInterest += interest;
    yInt += interest; yPrin += principal;
    if (pmiMonthly > 0 && bal > pmiCutoff) { totalPMI += pmiMonthly; pmiEndMonth = m; }
    if (m % 12 === 0 || bal <= 0.005 || m === termMonths) {
      years.push({ y: Math.ceil(m / 12), interest: yInt, principal: yPrin, balance: Math.max(0, bal) });
      yInt = 0; yPrin = 0;
    }
  }
  return {
    loan, basePI: initialPI, adjustedPI, postIOPI, pmiMonthly, months: m,
    totalInterest, totalPMI, pmiEndMonth, years, balloon: bal > 0.005 ? bal : 0,
  };
}
