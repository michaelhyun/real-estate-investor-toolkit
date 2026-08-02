/* Parity proof: extract the ORIGINAL calculation code from the legacy HTML
   files, eval it, and fuzz-compare against the TS port across randomized
   states. If these pass, the port's math is the original's math. */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { simulate, deriveDown, type MortgageState } from '../src/mortgage';
import { compute, defaultDealState, type DealState } from '../src/rental';
import { metrics, migrate, type PropertyState } from '../src/portfolio';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');

function slice(src: string, from: string, to: string): string {
  const a = src.indexOf(from);
  const b = src.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error(`slice markers not found: ${from} … ${to}`);
  return src.slice(a, b);
}

/* deterministic PRNG so failures reproduce */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

const close = (a: number, b: number, label: string) => {
  if (Number.isNaN(a) && Number.isNaN(b)) return;
  const tol = Math.max(1e-6, Math.abs(a) * 1e-9);
  expect(Math.abs(a - b), `${label}: ${a} vs ${b}`).toBeLessThanOrEqual(tol);
};

/* ---------------- rental.html ---------------- */
describe('rental compute parity', () => {
  const html = read('rental.html');
  const defs = slice(html, 'const EXPENSES = [', 'const STORE_KEY');
  const expMonthlyFn = slice(html, '/* monthly cost of one expense line */', '/* ---------------- scope of work');
  const mathFns = slice(html, 'function monthlyPI(loan', 'function calc(){');
  const legacyCompute = new Function(
    's',
    `${defs}\n${expMonthlyFn}\n${mathFns}\nreturn compute(s);`
  ) as (s: DealState) => any;

  function randomDeal(r: () => number): DealState {
    const s = defaultDealState();
    s.price = Math.round(50000 + r() * 950000);
    s.downPct = Math.round(r() * 100);
    s.rehab = Math.round(r() * 80000);
    s.closing = r() < 0.5 ? Math.round(r() * 20000) : +(r() * 5).toFixed(2);
    s.closingUnit = r() < 0.5 ? '$' : '%';
    s.rate = +(2 + r() * 9).toFixed(2);
    s.term = [15, 20, 30][Math.floor(r() * 3)];
    s.ioOn = r() < 0.3;
    s.ioYears = Math.round(r() * 30);
    s.armOn = r() < 0.3;
    s.armFixed = [3, 5, 7, 10][Math.floor(r() * 4)];
    s.armFreq = r() < 0.5 ? 6 : 12;
    s.armRate = +(3 + r() * 9).toFixed(2);
    s.sellerOn = r() < 0.3;
    s.sellerAmt = Math.round(r() * 200000);
    s.sellerRate = +(2 + r() * 8).toFixed(2);
    s.sellerTerm = Math.round(5 + r() * 25);
    s.sellerType = r() < 0.5 ? 'am' : 'io';
    s.subtoOn = r() < 0.3;
    s.subtoBal = Math.round(r() * 300000);
    s.subtoRate = +(2 + r() * 6).toFixed(2);
    s.subtoTerm = Math.round(5 + r() * 25);
    s.rent = Math.round(500 + r() * 7500);
    s.vacancy = +(r() * 20).toFixed(1);
    s.rentGrowth = +(r() * 10).toFixed(2);
    s.expGrowth = +(r() * 10).toFixed(2);
    s.appr = +(r() * 10).toFixed(2);
    s.sellCost = +(r() * 12).toFixed(1);
    for (const k of Object.keys(s.expenses)) {
      s.expenses[k] = Math.round(r() * 500);
      const timeMode = ['tax', 'ins', 'hoa', 'landscape', 'cleaning', 'pest', 'misc'].includes(k);
      s.units[k] = timeMode ? (r() < 0.5 ? 'mo' : 'yr') : (r() < 0.5 ? '$' : '%');
      if (s.units[k] === '%') s.expenses[k] = Math.round(r() * 20);
    }
    for (const k of Object.keys(s.otherInc)) s.otherInc[k] = Math.round(r() * 200);
    for (const k of Object.keys(s.utils)) {
      s.utils[k] = Math.round(r() * 200);
      s.utilUnits[k] = r() < 0.5 ? 'mo' : 'yr';
    }
    return s;
  }

  it('matches original compute() across 500 randomized deals', () => {
    const r = rng(20260802);
    for (let i = 0; i < 500; i++) {
      const s = randomDeal(r);
      const a = legacyCompute(s);
      const b = compute(s);
      for (const k of ['downAmt', 'sellerAmt', 'subtoBal', 'newLoan', 'overBy', 'piBank', 'piSeller',
        'piSub', 'pi', 'payAfterArm', 'payAfterIO', 'closingAmt', 'cashInvested', 'otherIncTotal',
        'utilTotal', 'gross', 'vacLoss', 'effIncome', 'opEx', 'noi', 'cashFlow', 'annualCF', 'coc',
        'dscr', 'onePct', 'grm', 'netSale', 'proceeds', 'totalProfit', 'roi5', 'annualized'] as const) {
        close(a[k], (b as any)[k], `deal ${i} .${k}`);
      }
      for (let y = 0; y < 5; y++) {
        for (const k of ['yRent', 'yOther', 'yVac', 'yEff', 'yOpEx', 'yNOI', 'yDebt', 'yCF',
          'cumCF', 'value', 'bal', 'equity'] as const) {
          close(a.years[y][k], b.years[y][k], `deal ${i} year ${y + 1} .${k}`);
        }
      }
    }
  });
});

/* ---------------- mortgage.html ---------------- */
describe('mortgage simulate parity', () => {
  const html = read('mortgage.html');
  const fns = slice(html, 'function monthlyPI(loan', 'function fmtYears');
  const legacySimulate = new Function('s', 'extra', `${fns}\nreturn simulate(s, extra);`) as
    (s: MortgageState & { downAmt: number; downPct: number }, extra: number) => any;

  function randomMortgage(r: () => number): MortgageState {
    return {
      price: Math.round(100000 + r() * 1400000),
      down: r() < 0.6 ? Math.round(r() * 40) : Math.round(r() * 300000),
      downUnit: r() < 0.6 ? '%' : '$',
      io: r() < 0.3,
      ioYears: Math.round(r() * 30),
      rate: +(2 + r() * 9).toFixed(2),
      term: [15, 20, 30][Math.floor(r() * 3)],
      tax: Math.round(r() * 15000),
      ins: Math.round(r() * 4000),
      hoa: Math.round(r() * 600),
      pmiRate: +(r() * 1.5).toFixed(2),
      extra: r() < 0.5 ? 0 : Math.round(r() * 1000),
      armOn: r() < 0.3,
      armFixed: [3, 5, 7, 10][Math.floor(r() * 4)],
      armFreq: r() < 0.5 ? 6 : 12,
      armRate: +(3 + r() * 9).toFixed(2),
    };
  }

  it('matches original simulate() across 500 randomized loans', () => {
    const r = rng(19970113);
    for (let i = 0; i < 500; i++) {
      const s = randomMortgage(r);
      const d = deriveDown(s);
      const legacyState = { ...s, ...d };
      for (const extra of [0, s.extra]) {
        const a = legacySimulate(legacyState, extra);
        const b = simulate(s, extra);
        for (const k of ['loan', 'basePI', 'adjustedPI', 'postIOPI', 'pmiMonthly', 'months',
          'totalInterest', 'totalPMI', 'pmiEndMonth', 'balloon'] as const) {
          close(a[k], (b as any)[k], `loan ${i} extra=${extra} .${k}`);
        }
        expect(a.years.length, `loan ${i} years len`).toBe(b.years.length);
        for (let y = 0; y < a.years.length; y++) {
          for (const k of ['y', 'interest', 'principal', 'balance'] as const) {
            close(a.years[y][k], b.years[y][k], `loan ${i} year ${y} .${k}`);
          }
        }
      }
    }
  });
});

/* ---------------- portfolio.html ---------------- */
describe('portfolio metrics parity', () => {
  const html = read('portfolio.html');
  const fns = slice(html, 'function migrate(p)', 'function sortKey');
  const legacy = new Function('p', 'mode', `
    const localStorage = { getItem: () => null, setItem: () => {} };
    ${fns}
    return mode === 'migrate' ? migrate(p) : metrics(p);
  `) as (p: any, mode: 'migrate' | 'metrics') => any;

  function randomProp(r: () => number): PropertyState {
    return {
      name: 'P', dateAcq: r() < 0.5 ? '' : '2021-10-15',
      ownPct: r() < 0.7 ? 100 : Math.round(r() * 100),
      price: Math.round(r() * 900000), down: Math.round(r() * 200000),
      other: Math.round(r() * 50000), value: Math.round(r() * 1200000),
      loan: Math.round(r() * 700000), rate: +(r() * 8).toFixed(2),
      pay: Math.round(r() * 5000),
      income: { v: Math.round(r() * 5000), unit: r() < 0.5 ? 'mo' : 'yr' },
      opex: { v: Math.round(r() * 1000), unit: r() < 0.5 ? 'mo' : 'yr' },
      taxes: { v: Math.round(r() * 12000), unit: r() < 0.5 ? 'mo' : 'yr' },
      ins: { v: Math.round(r() * 3000), unit: r() < 0.5 ? 'mo' : 'yr' },
      cfOverride: r() < 0.7 ? null : Math.round(r() * 2000 - 500),
    };
  }

  it('matches original metrics() across 500 randomized properties', () => {
    const r = rng(45060);
    for (let i = 0; i < 500; i++) {
      const p = randomProp(r);
      const a = legacy(p, 'metrics');
      const b = metrics(p, Date.now());
      for (const k of ['cfAuto', 'cfM', 'cfY', 'coc', 'equityFull', 'equityShare', 'cfShare',
        'paydownY', 'roe', 'appr', 'own'] as const) {
        close(a[k], (b as any)[k], `prop ${i} .${k}`);
      }
      /* holdYrs uses the wall clock in both — equal to within a millisecond of drift */
      if (!(Number.isNaN(a.holdYrs) && Number.isNaN(b.holdYrs)))
        expect(Math.abs(a.holdYrs - b.holdYrs)).toBeLessThan(1e-4);
    }
  });

  it('migrates v1 rows identically', () => {
    const v1 = { name: 'Old', invested: 60000, value: 500000, loan: 300000, rate: 4.5, pay: 1800, rent: 2600, opex: 400 };
    expect(migrate(v1)).toEqual(legacy(v1, 'migrate'));
  });
});
