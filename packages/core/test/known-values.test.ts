/* Hand-checked anchors — independent of the legacy code, so a bug shared by
   both implementations would still be caught here. */

import { describe, it, expect } from 'vitest';
import { monthlyPI, loanBalance, simulate } from '../src/mortgage';
import { compute, defaultDealState } from '../src/rental';
import { metrics } from '../src/portfolio';

describe('mortgage anchors', () => {
  it('standard 30-yr P&I formula', () => {
    /* $200,000 at 7% / 30 yrs → $1,330.60 (textbook value) */
    expect(monthlyPI(200000, 7, 30)).toBeCloseTo(1330.6, 1);
    /* zero-rate loan is straight-line */
    expect(monthlyPI(120000, 0, 10)).toBeCloseTo(1000, 6);
  });

  it('loan balance endpoints', () => {
    expect(loanBalance(200000, 7, 30, 0)).toBeCloseTo(200000, 4);
    expect(loanBalance(200000, 7, 30, 360)).toBeCloseTo(0, 4);
  });

  it('full-term interest-only leaves the whole balance as a balloon', () => {
    const s = {
      price: 400000, down: 25, downUnit: '%' as const, io: true, ioYears: 30,
      rate: 6, term: 30, tax: 0, ins: 0, hoa: 0, pmiRate: 0, extra: 0,
      armOn: false, armFixed: 7, armFreq: 6, armRate: 8.5,
    };
    const r = simulate(s, 0);
    expect(r.loan).toBe(300000);
    expect(r.basePI).toBeCloseTo(300000 * 0.06 / 12, 6);   /* $1,500 IO payment */
    expect(r.balloon).toBeCloseTo(300000, 2);
    expect(r.totalInterest).toBeCloseTo(1500 * 360, 2);
  });

  it('PMI applies under 20% down and stops at 78% LTV', () => {
    const s = {
      price: 300000, down: 10, downUnit: '%' as const, io: false, ioYears: 10,
      rate: 6.5, term: 30, tax: 0, ins: 0, hoa: 0, pmiRate: 0.6, extra: 0,
      armOn: false, armFixed: 7, armFreq: 6, armRate: 8.5,
    };
    const r = simulate(s, 0);
    expect(r.pmiMonthly).toBeCloseTo(270000 * 0.006 / 12, 6);
    /* balance must be ≤ 78% of price the month PMI ends */
    const cutoffBal = 300000 * 0.78;
    expect(r.pmiEndMonth).toBeGreaterThan(0);
    const yearRow = r.years[Math.ceil(r.pmiEndMonth / 12) - 1];
    expect(yearRow.balance).toBeLessThanOrEqual(cutoffBal + r.basePI);
  });
});

describe('rental anchors', () => {
  it('default deal: hand-computed year-1 cash flow', () => {
    const s = defaultDealState();
    const r = compute(s);
    /* price 250k, 20% down → loan 200k at 7%/30 = 1330.60 P&I */
    expect(r.downAmt).toBe(50000);
    expect(r.newLoan).toBe(200000);
    expect(r.piBank).toBeCloseTo(1330.6, 1);
    /* cash invested = 50,000 + 10,000 rehab + 6,000 closing */
    expect(r.cashInvested).toBe(66000);
    /* income: rent 2000, vacancy 5% → 1900 effective */
    expect(r.effIncome).toBeCloseTo(1900, 6);
    /* opex: tax 250 + ins 120 + mgmt 10% (200) + maint 8% (160) + capex 8% (160) = 890 */
    expect(r.opEx).toBeCloseTo(890, 6);
    expect(r.noi).toBeCloseTo(1010, 6);
    expect(r.cashFlow).toBeCloseTo(1010 - r.piBank, 6);
    /* 1% rule: 2000 / 260000 = 0.769% → fail */
    expect(r.onePct).toBeCloseTo(0.7692, 3);
    /* GRM: 250000 / 24000 = 10.42 */
    expect(r.grm).toBeCloseTo(10.4167, 3);
    /* DSCR = NOI / debt */
    expect(r.dscr).toBeCloseTo(1010 / r.piBank, 6);
  });

  it('financing stack: seller + subto reduce the bank loan', () => {
    const s = defaultDealState();
    s.sellerOn = true; s.sellerAmt = 50000; s.sellerType = 'io'; s.sellerRate = 6;
    s.subtoOn = true; s.subtoBal = 100000; s.subtoRate = 4; s.subtoTerm = 26;
    const r = compute(s);
    expect(r.newLoan).toBe(250000 - 50000 - 50000 - 100000);
    expect(r.piSeller).toBeCloseTo(50000 * 0.06 / 12, 6);   /* IO carry: $250/mo */
    expect(r.piSub).toBeCloseTo(monthlyPI(100000, 4, 26), 6);
  });

  it('over-financing is flagged, never negative loan', () => {
    const s = defaultDealState();
    s.downPct = 50; s.sellerOn = true; s.sellerAmt = 200000;
    const r = compute(s);
    expect(r.newLoan).toBe(0);
    expect(r.overBy).toBe(125000 + 200000 - 250000);
  });

  it('5-year pro-forma growth compounding', () => {
    const s = defaultDealState();
    const r = compute(s);
    /* year-5 rent = 2000*12 * 1.03^4 */
    expect(r.years[4].yRent).toBeCloseTo(24000 * Math.pow(1.03, 4), 6);
    /* year-5 value = 250000 * 1.03^5 */
    expect(r.years[4].value).toBeCloseTo(250000 * Math.pow(1.03, 5), 6);
    /* exit: net sale minus balance, profit reconciles */
    expect(r.netSale).toBeCloseTo(r.years[4].value * 0.93, 6);
    expect(r.totalProfit).toBeCloseTo(r.proceeds + r.years[4].cumCF - r.cashInvested, 6);
  });
});

describe('portfolio anchors', () => {
  it('CoC and ROE definitions', () => {
    const p = {
      name: 'Test', dateAcq: '', ownPct: 100,
      price: 400000, down: 80000, other: 20000,
      value: 500000, loan: 300000, rate: 5, pay: 2000,
      income: { v: 3500, unit: 'mo' as const }, opex: { v: 500, unit: 'mo' as const },
      taxes: { v: 6000, unit: 'yr' as const }, ins: { v: 1200, unit: 'yr' as const },
      cfOverride: null,
    };
    const m = metrics(p, Date.now());
    /* cf = 3500 − (500 + 500 + 100) − 2000 = 400/mo */
    expect(m.cfAuto).toBeCloseTo(400, 6);
    /* CoC = 4800 / 100000 = 4.8% */
    expect(m.coc).toBeCloseTo(4.8, 6);
    /* paydown = 24000 − 300000*5% = 9000/yr */
    expect(m.paydownY).toBeCloseTo(9000, 6);
    /* ROE = (4800 + 9000) / 200000 = 6.9% */
    expect(m.roe).toBeCloseTo(6.9, 6);
    expect(m.appr).toBeCloseTo(25, 6);
  });

  it('ownership share scales equity and cash flow only', () => {
    const p = {
      name: 'Half', dateAcq: '', ownPct: 50,
      price: 0, down: 50000, other: 0,
      value: 400000, loan: 200000, rate: 0, pay: 0,
      income: { v: 2000, unit: 'mo' as const }, opex: { v: 0, unit: 'mo' as const },
      taxes: { v: 0, unit: 'mo' as const }, ins: { v: 0, unit: 'mo' as const },
      cfOverride: null,
    };
    const m = metrics(p, Date.now());
    expect(m.equityFull).toBe(200000);
    expect(m.equityShare).toBe(100000);
    expect(m.cfShare).toBe(1000);
    /* ROE stays a full-property ratio */
    expect(m.roe).toBeCloseTo(2000 * 12 / 200000 * 100, 6);
  });
});
