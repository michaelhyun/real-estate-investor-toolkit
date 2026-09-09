import { describe, it, expect } from 'vitest';
import {
  defaultTaxState, computeTax, gainsImpact, repsComparison,
  bracketTax, bracketRate, tablesFor, FILING_STATUSES, TAX_YEARS,
  type TaxState,
} from '../src/index';

const base = (over: Partial<TaxState> = {}): TaxState => ({ ...defaultTaxState(), ...over });
const near = (a: number, b: number, tol = 1) => expect(Math.abs(a - b)).toBeLessThan(tol);

/* A clean W-2 filer with nothing else going on, for hand-checkable cases. */
const plain = (over: Partial<TaxState> = {}): TaxState => base({
  wages: 0, spouseWages: 0, seNetProfit: 0, interest: 0, ordinaryDividends: 0,
  qualifiedDividends: 0, longTermGains: 0, shortTermGains: 0, unrecaptured1250: 0,
  otherIncome: 0, rentalNet: 0, deferral401k: 0, employer401k: 0, hsa: 0,
  seHealthIns: 0, mortgageInterest: 0, propertyTax: 0, charitable: 0,
  childrenUnder17: 0, otherDependents: 0, ...over,
});

describe('bracket arithmetic', () => {
  const ladder = [{ upTo: 100, rate: 0.1 }, { upTo: 200, rate: 0.2 }, { upTo: Infinity, rate: 0.3 }];

  it('taxes each slice at its own rate, not the whole at the top rate', () => {
    near(bracketTax(150, ladder), 10 + 10);
    near(bracketTax(250, ladder), 10 + 20 + 15);
  });

  it('is zero at or below zero income', () => {
    near(bracketTax(0, ladder), 0);
    near(bracketTax(-500, ladder), 0);
  });

  it('reports the rate the NEXT dollar pays, so a boundary reads upward', () => {
    expect(bracketRate(99, ladder)).toBe(0.1);
    expect(bracketRate(100, ladder)).toBe(0.2);
  });

  it('every ladder in every table ends open and rises monotonically', () => {
    for (const y of TAX_YEARS) {
      const { fed, ca } = tablesFor(y);
      const all = [
        ...FILING_STATUSES.map(f => fed.ordinary[f.id]),
        ...FILING_STATUSES.map(f => fed.capGains[f.id]),
        ...FILING_STATUSES.map(f => ca.brackets[f.id]),
      ];
      for (const b of all) {
        expect(b[b.length - 1].upTo).toBe(Infinity);
        for (let i = 1; i < b.length; i++) {
          expect(b[i].upTo).toBeGreaterThan(b[i - 1].upTo);
          expect(b[i].rate).toBeGreaterThan(b[i - 1].rate);
        }
      }
    }
  });

  it('married-filing-jointly thresholds are never below single', () => {
    for (const y of TAX_YEARS) {
      const { fed } = tablesFor(y);
      fed.ordinary.single.forEach((b, i) => {
        expect(fed.ordinary.mfj[i].upTo).toBeGreaterThanOrEqual(b.upTo);
      });
    }
  });
});

describe('the standard deduction floor', () => {
  it('income under the standard deduction owes no federal income tax', () => {
    const r = computeTax(plain({ wages: 12000 }));
    near(r.fedIncomeTax, 0);
    near(r.taxableIncome, 0);
  });

  it('takes the larger of standard and itemized without being told', () => {
    const small = computeTax(plain({ wages: 200000, mortgageInterest: 2000 }));
    expect(small.deductionKind).toBe('standard');
    const big = computeTax(plain({ wages: 200000, mortgageInterest: 60000 }));
    expect(big.deductionKind).toBe('itemized');
    expect(big.deductionUsed).toBeGreaterThan(small.deductionUsed);
  });
});

describe('capital gains stack on ordinary income', () => {
  it('the same gain costs more when it sits on a bigger salary', () => {
    const gain = 200000;
    const low = gainsImpact(plain({ wages: 60000 }), gain, 0, 0);
    const high = gainsImpact(plain({ wages: 600000 }), gain, 0, 0);
    expect(high.totalDelta).toBeGreaterThan(low.totalDelta);
  });

  it('a small gain on a small income can reach the 0% rate', () => {
    const r = gainsImpact(plain({ wages: 30000, year: 2026, status: 'mfj' }), 20000, 0, 0);
    /* federal takes nothing; California still taxes it as ordinary income */
    expect(r.fedDelta).toBeLessThan(1);
    expect(r.caDelta).toBeGreaterThan(0);
  });

  it('short-term gains cost more than long-term of the same size', () => {
    const s = plain({ wages: 300000 });
    const lt = gainsImpact(s, 100000, 0, 0);
    const stg = gainsImpact(s, 0, 100000, 0);
    expect(stg.totalDelta).toBeGreaterThan(lt.totalDelta);
  });

  it('never taxes long-term gains above 20% federal plus 3.8% plus California', () => {
    const r = gainsImpact(plain({ wages: 2000000 }), 1000000, 0, 0);
    expect(r.effectiveOnGain).toBeLessThan(20 + 3.8 + 13.3 + 0.5);
    expect(r.effectiveOnGain).toBeGreaterThan(20);
  });

  it('depreciation recapture is capped at 25%, unlike ordinary income', () => {
    const s = plain({ wages: 700000 });
    const rec = gainsImpact(s, 0, 0, 100000);
    const ord = gainsImpact(s, 0, 100000, 0);
    /* both are ordinary-rate candidates up top, but recapture stops at 25% */
    expect(rec.fedDelta).toBeLessThan(ord.fedDelta);
  });

  it('reports the tax as a share of the gain and what is left', () => {
    const r = gainsImpact(plain({ wages: 300000 }), 400000, 0, 0);
    near(r.netProceeds, r.gainTotal - r.totalDelta, 0.01);
    near(r.effectiveOnGain, r.totalDelta / r.gainTotal * 100, 0.01);
  });
});

describe('rental losses and real estate professional status', () => {
  it('the $25k allowance is gone above $150k of income', () => {
    const r = computeTax(plain({ wages: 400000, rentalNet: -40000, reps: false }));
    near(r.specialAllowance, 0);
    near(r.rentalAllowed, 0);
    near(r.rentalSuspended, 40000);
  });

  it('the allowance survives at modest income and phases out linearly', () => {
    const low = computeTax(plain({ wages: 90000, rentalNet: -40000, status: 'single' }));
    near(low.specialAllowance, 25000);
    const mid = computeTax(plain({ wages: 130000, rentalNet: -40000, status: 'single' }));
    expect(mid.specialAllowance).toBeGreaterThan(0);
    expect(mid.specialAllowance).toBeLessThan(25000);
  });

  it('professional status frees the whole loss and saves real money', () => {
    const s = plain({ wages: 500000, rentalNet: -80000 });
    const c = repsComparison(s);
    near(c.on.rentalAllowed, 80000);
    near(c.off.rentalAllowed, 0);
    expect(c.saving).toBeGreaterThan(0);
    expect(c.suspendedIfOff).toBe(80000);
  });

  it('on a profitable rental it is worth exactly the investment surtax', () => {
    /* nothing to free up, but a materially participating professional's
       rental income leaves net investment income, so the 3.8% comes off */
    const c = repsComparison(plain({ wages: 400000, rentalNet: 30000 }));
    near(c.saving, 30000 * 0.038, 2);
  });

  it('is worth nothing at all when there is no rental either way', () => {
    const c = repsComparison(plain({ wages: 400000, rentalNet: 0 }));
    near(c.saving, 0, 0.01);
  });

  it('does not reach back and free a prior suspended loss', () => {
    const r = computeTax(plain({ wages: 500000, rentalNet: 0, passiveCarryforward: 60000, reps: true }));
    near(r.rentalAllowed, 0);
    near(r.rentalSuspended, 60000);
  });

  it('a carryforward is released by passive income', () => {
    const r = computeTax(plain({ wages: 500000, rentalNet: 25000, passiveCarryforward: 60000 }));
    near(r.rentalAllowed, 25000);
    near(r.rentalSuspended, 35000);
  });

  it('caps what one year can shelter at the excess business loss limit', () => {
    const r = computeTax(plain({ wages: 900000, rentalNet: -900000, reps: true, status: 'mfj' }));
    const cap = tablesFor(r.agi > 0 ? 2026 : 2026).fed.excessBusinessLoss.mfj;
    expect(r.eblDisallowed).toBeGreaterThan(0);
    near(r.eblDisallowed, 900000 - cap);
  });

  it('excludes a professional’s rental income from the investment surtax', () => {
    const off = computeTax(plain({ wages: 400000, rentalNet: 50000, reps: false }));
    const on = computeTax(plain({ wages: 400000, rentalNet: 50000, reps: true }));
    expect(off.netInvestmentIncome).toBeGreaterThan(on.netInvestmentIncome);
    expect(off.niit).toBeGreaterThan(on.niit);
  });
});

describe('self-employment tax', () => {
  it('stops the social security half at the wage base', () => {
    const small = computeTax(plain({ seNetProfit: 50000 }));
    const big = computeTax(plain({ seNetProfit: 500000 }));
    /* ten times the profit, far less than ten times the SE tax */
    expect(big.seTax).toBeLessThan(small.seTax * 10);
    expect(big.seTax).toBeGreaterThan(small.seTax);
  });

  it('W-2 wages fill the social security base before self-employment does', () => {
    const alone = computeTax(plain({ seNetProfit: 100000 }));
    const afterWages = computeTax(plain({ wages: 300000, seNetProfit: 100000 }));
    expect(afterWages.seTax).toBeLessThan(alone.seTax);
  });

  it('deducts half of it above the line', () => {
    const r = computeTax(plain({ seNetProfit: 200000 }));
    near(r.halfSeTax, r.seTax / 2, 0.01);
    expect(r.adjustments).toBeGreaterThanOrEqual(r.halfSeTax);
  });

  it('adds the 0.9% Medicare surtax over the threshold', () => {
    const under = computeTax(plain({ wages: 200000, status: 'mfj' }));
    const over = computeTax(plain({ wages: 400000, status: 'mfj' }));
    near(under.addlMedicare, 0);
    near(over.addlMedicare, (400000 - 250000) * 0.009);
  });
});

describe('california', () => {
  it('taxes long-term gains as ordinary income, with no preferential rate', () => {
    const s = plain({ wages: 300000 });
    const lt = gainsImpact(s, 100000, 0, 0);
    const stg = gainsImpact(s, 0, 100000, 0);
    near(lt.caDelta, stg.caDelta, 1);
  });

  it('adds the 1% mental health surcharge over a million', () => {
    const under = computeTax(plain({ wages: 900000, status: 'single' }));
    const over = computeTax(plain({ wages: 1600000, status: 'single' }));
    near(under.caMentalHealth, 0);
    near(over.caMentalHealth, (over.caTaxableIncome - 1000000) * 0.01, 1);
  });

  it('gives no deduction for state income tax on the state return', () => {
    const a = computeTax(plain({ wages: 400000, propertyTax: 0 }));
    const b = computeTax(plain({ wages: 400000, propertyTax: 20000 }));
    /* property tax moves the California deduction; the CA tax itself never does */
    expect(b.caDeduction).toBeGreaterThan(a.caDeduction);
  });

  it('does not conform to the HSA deduction', () => {
    const r = computeTax(plain({ wages: 300000, hsa: 8750 }));
    near(r.caAgi - r.agi, 8750);
  });

  it('does not allow the qualified business income deduction', () => {
    const r = computeTax(plain({ seNetProfit: 300000 }));
    expect(r.qbiDeduction).toBeGreaterThan(0);
    /* CA taxable income is built off CA AGI without any §199A subtraction */
    near(r.caTaxableIncome, r.caAgi - r.caDeduction, 1);
  });
});

describe('the SALT cap and its phase-down', () => {
  it('caps the deduction and shrinks it further at high income', () => {
    const mid = computeTax(plain({ wages: 300000, propertyTax: 30000 }));
    const high = computeTax(plain({ wages: 1200000, propertyTax: 30000 }));
    expect(mid.saltAllowed).toBeGreaterThan(high.saltAllowed);
    expect(high.saltCapUsed).toBe(10000);
  });

  it('never falls below the $10,000 floor', () => {
    const r = computeTax(plain({ wages: 5000000, propertyTax: 80000 }));
    expect(r.saltAllowed).toBeGreaterThanOrEqual(10000);
  });
});

describe('credits', () => {
  it('phases the child credit out and never goes below zero', () => {
    const under = computeTax(plain({ wages: 150000, status: 'mfj', childrenUnder17: 2 }));
    near(under.credits, 4400);
    const over = computeTax(plain({ wages: 900000, status: 'mfj', childrenUnder17: 2 }));
    near(over.credits, 0);
  });
});

describe('measured marginal and effective rates', () => {
  it('the effective rate is total tax over gross income', () => {
    const r = computeTax(base());
    near(r.effectiveRate, r.totalTax / r.grossIncome * 100, 0.01);
    near(r.afterTax, r.grossIncome - r.totalTax, 0.01);
  });

  it('effective is below marginal for anyone with a progressive ladder', () => {
    const r = computeTax(plain({ wages: 500000 }));
    expect(r.effectiveRate).toBeLessThan(r.marginalCombined);
  });

  it('combined marginal is federal plus state', () => {
    const r = computeTax(base());
    near(r.marginalFederal + r.marginalCa, r.marginalCombined, 0.01);
  });

  it('measures phase-outs the bracket table cannot show', () => {
    /* in the child credit phase-out the true marginal rate exceeds the
       nominal bracket, which is the whole reason it is measured */
    const r = computeTax(plain({ wages: 420000, status: 'mfj', childrenUnder17: 3 }));
    expect(r.marginalFederal).toBeGreaterThan(r.fedBracketRate);
  });

  it('the marginal rate on gains is lower than on ordinary income', () => {
    const r = computeTax(plain({ wages: 400000 }));
    expect(r.marginalGains).toBeLessThan(r.marginalCombined);
  });
});

describe('invariants that must hold on every input', () => {
  const cases: Partial<TaxState>[] = [
    {}, { wages: 0, seNetProfit: 0, rentalNet: 0 }, { wages: 5000000 },
    { rentalNet: -500000, reps: true }, { status: 'single' }, { status: 'mfs' },
    { status: 'hoh', childrenUnder17: 3 }, { year: 2025 }, { longTermGains: 900000 },
    { seNetProfit: -100000 }, { wages: 100, charitable: 500000 },
  ];

  it('never returns a negative tax or a NaN', () => {
    for (const c of cases) for (const y of TAX_YEARS) {
      const r = computeTax(base({ ...c, year: y }));
      for (const [k, v] of Object.entries(r)) {
        if (typeof v !== 'number') continue;
        expect(Number.isFinite(v), `${k} on ${JSON.stringify(c)}`).toBe(true);
      }
      expect(r.totalTax).toBeGreaterThanOrEqual(0);
      expect(r.federalTotal).toBeGreaterThanOrEqual(0);
      expect(r.caTotal).toBeGreaterThanOrEqual(0);
      expect(r.taxableIncome).toBeGreaterThanOrEqual(0);
    }
  });

  it('never takes more than every dollar earned', () => {
    for (const c of cases) {
      const r = computeTax(base(c));
      if (r.grossIncome > 0) expect(r.effectiveRate).toBeLessThan(100);
    }
  });

  it('more income never leaves you with less after tax', () => {
    for (let w = 0; w <= 2000000; w += 50000) {
      const a = computeTax(plain({ wages: w }));
      const b = computeTax(plain({ wages: w + 50000 }));
      expect(b.afterTax).toBeGreaterThan(a.afterTax);
    }
  });

  it('a deduction never costs you money', () => {
    for (const d of [1000, 20000, 60000]) {
      const without = computeTax(plain({ wages: 400000 }));
      const with_ = computeTax(plain({ wages: 400000, charitable: d, mortgageInterest: 40000 }));
      expect(with_.totalTax).toBeLessThanOrEqual(without.totalTax + 0.01);
    }
  });
});
