import { describe, it, expect } from 'vitest';
import { amortize, compute, defaultDealState, monthlyPI } from '../src/index';

describe('amortize — the whole loan stack, year by year', () => {
  it('a plain 30-year loan pays itself off and matches the textbook total interest', () => {
    const s = { ...defaultDealState(), price: 250000, downPct: 20, rate: 7, term: 30 };
    const a = amortize(s);
    expect(a.startBalance).toBe(200000);
    expect(a.years).toHaveLength(30);
    expect(a.years[29].balance).toBeCloseTo(0, 2);
    expect(a.years.reduce((t, y) => t + y.principal, 0)).toBeCloseTo(200000, 2);
    expect(a.totalInterest).toBeCloseTo(monthlyPI(200000, 7, 30) * 360 - 200000, 2);
    expect(a.balloon).toBe(0);
  });

  it('agrees with compute() on the first five year-end balances, with every note switched on', () => {
    const s = {
      ...defaultDealState(), price: 600000, downPct: 10, rate: 6.5, term: 30,
      ioOn: true, ioYears: 3, armOn: true, armFixed: 5, armFreq: 6, armRate: 8,
      sellerOn: true, sellerAmt: 80000, sellerRate: 5, sellerTerm: 10, sellerType: 'am' as const,
      subtoOn: true, subtoBal: 150000, subtoRate: 3.25, subtoTerm: 24,
    };
    const a = amortize(s);
    const r = compute(s);
    r.years.forEach((y, i) => expect(a.years[i].balance).toBeCloseTo(y.bal, 2));
    expect(a.years).toHaveLength(30);
    expect(a.years[29].balance).toBeCloseTo(0, 2);
  });

  it('an interest-only seller note ends in a balloon', () => {
    const s = {
      ...defaultDealState(), price: 300000, downPct: 20, rate: 7, term: 30,
      sellerOn: true, sellerAmt: 60000, sellerRate: 6, sellerTerm: 5, sellerType: 'io' as const,
    };
    const a = amortize(s);
    expect(a.balloon).toBeCloseTo(60000, 2);
    expect(a.years[4].principal).toBeGreaterThan(60000);
    expect(a.years[29].balance).toBeCloseTo(0, 2);
  });

  it('an all-cash deal has nothing to amortize', () => {
    const a = amortize({ ...defaultDealState(), downPct: 100 });
    expect(a.years).toHaveLength(0);
    expect(a.startBalance).toBe(0);
  });
});
