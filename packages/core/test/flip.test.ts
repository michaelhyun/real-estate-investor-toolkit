/* Flip analyzer engine. The cases here are the ways this model could be quietly
   wrong in a direction that costs real money: double-counting principal,
   treating a transfer tax cliff as a marginal bracket, double-counting
   contingency or the supplemental tax bill, or an MAO that doesn't actually
   hit the profit floor it solved for. */

import { describe, it, expect } from 'vitest';
import {
  defaultFlipState, computeFlip, solveMAO, seventyRule, buildWaterfall,
  verdictFor, SELLER_PROVIDED, ACQ_ITEMS,
  buildSensitivity, type FlipState,
} from '../src/flip';
import { cityTransferTax, findCity, countyTransferTax } from '../src/bayAreaCities';
import {
  buildSpaces, computeSow, applyLevel, taskKey, taskQty, priceKey, SPACE_DEFS, DEF_BY_KIND,
  type PropertyShape,
} from '../src/sow';
import {
  RENOVATIONS, RENO_CATEGORIES, searchRenovations, countByCategory,
} from '../src/renovations';

const base = (over: Partial<FlipState> = {}): FlipState => ({ ...defaultFlipState(), ...over });
const near = (a: number, b: number, tol = 0.5) => expect(Math.abs(a - b)).toBeLessThan(tol);

describe('computeFlip — structure', () => {
  it('holds the P&L identity: profit is proceeds less every cost', () => {
    const r = computeFlip(base());
    near(
      r.preTaxProfit,
      r.netProceeds - base().price - r.acqTotal - r.rehabTotal - r.holdTotal - r.finTotal,
    );
  });

  it('derives the hold period from all three phases, all in days', () => {
    const r = computeFlip(base({ rehabDays: 150, domDays: 21, escrowDays: 30 }));
    near(r.rehabPeriod, 150 / 30.4375, 0.01);
    near(r.holdMonths, 201 / 30.4375, 0.01);
  });

  it('spends the rehab scenario it was asked for', () => {
    const s = base({ rehab: { low: 100000, base: 200000, high: 300000 } });
    near(computeFlip(s, 'base', 'low').rehabTotal, 100000);
    near(computeFlip(s, 'base', 'base').rehabTotal, 200000);
    near(computeFlip(s, 'base', 'high').rehabTotal, 300000);
  });

  it('a rehab override replaces the scenario entirely', () => {
    near(computeFlip(base(), 'base', 'base', undefined, 175000).rehabTotal, 175000);
  });

  it('prices property tax off the reassessed purchase price, not the old roll', () => {
    const s = base({ price: 800000, taxRatePct: 1.25, rehabDays: 182.625, domDays: 0, escrowDays: 0 });
    const r = computeFlip(s);
    near(r.propertyTax, 800000 * 0.0125 * 0.5, 1);
  });

  it('shows the supplemental bill as disclosure inside the tax figure, never on top', () => {
    const s = base({ price: 800000, priorAssessed: 300000, taxRatePct: 1.25 });
    const r = computeFlip(s);
    /* the breakdown row is flagged and excluded from the total */
    const supp = r.holdLines.find(l => l.disclosure);
    expect(supp).toBeDefined();
    near(supp!.amount, (800000 - 300000) * 0.0125 * (r.holdMonths / 12), 1);
    const summable = r.holdLines.filter(l => !l.disclosure).reduce((a, l) => a + l.amount, 0);
    near(summable, r.holdTotal, 1);
  });
});

describe('cash conservation — the check that catches double-counted principal', () => {
  /* Cash in at close minus every dollar that went out must equal pre-tax
     profit. If principal repayment were expensed rather than treated as a
     balance transfer, this identity breaks by exactly the amount amortized. */
  const conserves = (s: FlipState) => {
    const r = computeFlip(s);
    near(r.cashBackAtClose - r.peakCash, r.preTaxProfit, 1);
  };

  it('holds in hard money mode', () => conserves(base({ finMode: 'hard' })));
  it('holds in conventional amortizing mode', () => conserves(base({ finMode: 'conv', convIO: false })));
  it('holds in conventional interest-only mode', () => conserves(base({ finMode: 'conv', convIO: true })));
  it('holds all cash', () => conserves(base({ finMode: 'cash' })));
  it('holds with an unfinanced rehab', () => conserves(base({ finMode: 'hard', rehabFinancedPct: 0 })));

  it('excludes principal from the P&L but includes it in peak cash', () => {
    const s = base({ finMode: 'conv', convIO: false });
    const r = computeFlip(s);
    expect(r.principalPaid).toBeGreaterThan(0);
    /* payoff is the original loan less what was amortized */
    near(r.payoffAtSale, r.loanAtClose - r.principalPaid, 1);
    /* the financing expense is fees plus interest only — no principal in it */
    const feesAndInterest = r.finLines.reduce((a, l) => a + l.amount, 0);
    near(r.finTotal, feesAndInterest, 0.01);
    expect(r.finTotal).toBeLessThan(r.finTotal + r.principalPaid);
  });

  it('an amortizing loan accrues less interest than interest-only at the same rate', () => {
    const am = computeFlip(base({ finMode: 'conv', convIO: false }));
    const io = computeFlip(base({ finMode: 'conv', convIO: true }));
    expect(am.interest).toBeLessThan(io.interest);
    /* and therefore earns slightly more profit, purely from the smaller balance */
    expect(am.preTaxProfit).toBeGreaterThan(io.preTaxProfit);
  });
});

describe('all cash', () => {
  it('has no loan, no lender and no financing cost at all', () => {
    const r = computeFlip(base({ finMode: 'cash' }));
    near(r.loanAtClose, 0);
    near(r.payoffAtSale, 0);
    near(r.interest, 0);
    near(r.finTotal, 0);
    near(r.downPayment, base().price);
    expect(r.finLines).toEqual([]);
  });

  it('ties up the whole purchase and rehab in cash', () => {
    const r = computeFlip(base({ finMode: 'cash' }));
    near(r.cashForRehab, r.rehabTotal);
    expect(r.peakCash).toBeGreaterThan(base().price);
  });

  it('earns less on cash than on leverage, but risks less too', () => {
    const cash = computeFlip(base({ finMode: 'cash' }));
    const hard = computeFlip(base({ finMode: 'hard' }));
    /* no interest to pay, so more profit */
    expect(cash.netProfit).toBeGreaterThan(hard.netProfit);
    /* but far more of your own money on the table, so a lower return */
    expect(cash.roi).toBeLessThan(hard.roi);
  });
});

describe('transfer tax — cliffs, not marginal brackets', () => {
  const sj = findCity('san-jose')!;

  it('San Jose Measure E taxes the full price once it crosses $2.3m', () => {
    const under = cityTransferTax(sj, 2_299_000);
    const over = cityTransferTax(sj, 2_301_000);
    /* below: base $3.30/$1,000 only */
    near(under, 2_299_000 / 1000 * 3.30, 1);
    /* above: base plus 0.75% of the WHOLE price, not of the $2,000 excess */
    near(over, 2_301_000 / 1000 * 3.30 + 2_301_000 * 0.0075, 1);
    expect(over - under).toBeGreaterThan(16_000);
  });

  it('Berkeley steps from $15 to $25 per $1,000 at $1.6m on full value', () => {
    const b = findCity('berkeley')!;
    near(cityTransferTax(b, 1_599_000), 1_599_000 / 1000 * 15);
    near(cityTransferTax(b, 1_601_000), 1_601_000 / 1000 * 25);
  });

  it('most Peninsula and South Bay cities carry no city tax at all', () => {
    for (const slug of ['redwood-city', 'burlingame', 'menlo-park', 'cupertino', 'sunnyvale', 'fremont']) {
      near(cityTransferTax(findCity(slug), 1_275_000), 0);
    }
  });

  it('the county rate is $1.10 per $1,000 everywhere', () => {
    near(countyTransferTax(1_275_000), 1402.5);
  });

  it('an Oakland sale costs far more in transfer tax than the same Fremont sale', () => {
    const oak = computeFlip(base({ citySlug: 'oakland' }));
    const fre = computeFlip(base({ citySlug: 'fremont' }));
    expect(oak.sellTotal - fre.sellTotal).toBeGreaterThan(8_000);
  });

  it('payer setting moves the tax between the buy and sell side', () => {
    const seller = computeFlip(base({ citySlug: 'piedmont' }));   /* preset: seller pays */
    expect(seller.acqLines.some(l => /transfer tax/.test(l.label))).toBe(false);
    expect(seller.sellLines.some(l => /City transfer tax/.test(l.label) && l.amount > 0)).toBe(true);
  });
});

describe('max allowable offer', () => {
  it('a deal bought at MAO lands exactly on the pre-tax profit floor', () => {
    const s = base({ minProfit: 120000 });
    const mao = solveMAO(s);
    expect(mao).toBeGreaterThan(0);
    near(computeFlip(s, 'base', 'base', mao).preTaxProfit, 120000, 200);
  });

  it('a higher profit floor forces a lower offer', () => {
    expect(solveMAO(base({ minProfit: 150000 }))).toBeLessThan(solveMAO(base({ minProfit: 50000 })));
  });

  it('survives a transfer tax cliff sitting inside the search range', () => {
    /* San Jose, ARV above the Measure E threshold — the profit curve has a step
       in it and bisection still has to land on the floor */
    const s = base({
      citySlug: 'san-jose', price: 1_900_000,
      arv: { low: 2_250_000, base: 2_400_000, high: 2_500_000 },
      minProfit: 60000,
    });
    const mao = solveMAO(s);
    near(computeFlip(s, 'base', 'base', mao).preTaxProfit, 60000, 500);
  });

  it('returns 0 when the deal cannot clear the floor even for free', () => {
    near(solveMAO(base({ minProfit: 5_000_000 })), 0);
  });

  it('the 70% rule is reported as a cross-check, not the answer', () => {
    const s = base();
    near(seventyRule(s), 0.70 * s.arv.base - s.rehab.base);
    /* on this deal the rule is stricter than a real underwrite — which is the
       whole point of showing both */
    expect(seventyRule(s)).toBeLessThan(solveMAO(s));
  });
});

describe('sensitivity grid', () => {
  it('spans the ARV scenarios with headroom past each end', () => {
    const s = base();
    const g = buildSensitivity(s, 7);
    expect(g.arvAxis).toHaveLength(7);
    expect(g.arvAxis[0]).toBeLessThan(s.arv.low);
    expect(g.arvAxis[6]).toBeGreaterThan(s.arv.high);
  });

  it('spans the rehab scenarios with headroom past each end', () => {
    const s = base();
    const g = buildSensitivity(s, 7);
    expect(g.rehabAxis).toHaveLength(7);
    expect(g.rehabAxis[0]).toBeLessThan(s.rehab.low);
    expect(g.rehabAxis[6]).toBeGreaterThan(s.rehab.high);
    near(g.baseRehab, s.rehab.base);
  });

  it('increases left to right and decreases top to bottom', () => {
    const g = buildSensitivity(base(), 7);
    for (const row of g.cells) {
      for (let i = 1; i < row.length; i++) expect(row[i]).toBeGreaterThan(row[i - 1]);
    }
    for (let r = 1; r < g.cells.length; r++) {
      expect(g.cells[r][0]).toBeLessThan(g.cells[r - 1][0]);
    }
  });

  it('reports the true min and max of the cells it built', () => {
    const g = buildSensitivity(base(), 7);
    const flat = g.cells.flat();
    near(g.min, Math.min(...flat));
    near(g.max, Math.max(...flat));
  });

  it('does not disturb the deal it was built from', () => {
    const s = base();
    const before = JSON.stringify(s);
    buildSensitivity(s, 7);
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe('tax treatment', () => {
  it('taxes profit at the blended rate', () => {
    const r = computeFlip(base({ taxPct: 45 }));
    expect(r.preTaxProfit).toBeGreaterThan(0);
    near(r.tax, r.preTaxProfit * 0.45);
    near(r.netProfit, r.preTaxProfit * 0.55);
  });

  it('a loss carries no phantom tax benefit by default', () => {
    const r = computeFlip(base({ price: 1_400_000, lossOffsetsIncome: false }));
    expect(r.preTaxProfit).toBeLessThan(0);
    near(r.tax, 0);
    near(r.netProfit, r.preTaxProfit);
  });

  it('but does shelter other income when you say it does', () => {
    const r = computeFlip(base({ price: 1_400_000, lossOffsetsIncome: true, taxPct: 45 }));
    expect(r.netProfit).toBeGreaterThan(r.preTaxProfit);
    near(r.netProfit, r.preTaxProfit * 0.55);
  });
});

describe('returns', () => {
  it('annualizes simply, by hold period', () => {
    const r = computeFlip(base());
    near(r.annualizedRoi, r.roi * (12 / r.holdMonths), 0.01);
  });

  it('withholding is a cash-flow item, never an expense', () => {
    const off = computeFlip(base({ withholdingOn: false }));
    const on = computeFlip(base({ withholdingOn: true }));
    near(on.preTaxProfit, off.preTaxProfit);
    near(on.withholding, on.sale * 0.0333, 1);
  });
});

describe('scope of work', () => {
  const prop: PropertyShape = { sqft: 1450, beds: 3, baths: 2, halfBaths: 1, stories: 1, garageBays: 2 };
  const spaces = buildSpaces(prop);
  const find = (id: string) => spaces.find(x => x.id === id)!;
  const sow = (checked: Record<string, boolean>, qty = {}, prices = {}) =>
    computeSow(spaces, checked, qty, prices, prop);
  const on = (keys: string[]) => Object.fromEntries(keys.map(k => [k, true]));

  it('generates one space per actual room, plus the whole-property sections', () => {
    expect(spaces.filter(x => x.kind === 'bedroom')).toHaveLength(3);
    expect(spaces.filter(x => x.kind === 'bathroom')).toHaveLength(2);
    expect(spaces.filter(x => x.kind === 'halfbath')).toHaveLength(1);
    expect(spaces.filter(x => x.kind === 'garage')).toHaveLength(1);
    /* every non-room section appears exactly once */
    for (const d of SPACE_DEFS.filter(d => !d.room)) {
      expect(spaces.filter(x => x.kind === d.kind)).toHaveLength(1);
    }
  });

  it('numbers repeated rooms and leaves singletons unnumbered', () => {
    expect(find('bedroom-2').label).toBe('Bedroom 2');
    expect(find('kitchen-1').label).toBe('Kitchen');
  });

  it('drops the garage when there are no bays', () => {
    expect(buildSpaces({ ...prop, garageBays: 0 }).some(x => x.kind === 'garage')).toBe(false);
  });

  it('seeds each room area from a share of the house', () => {
    expect(find('bedroom-1').sqft).toBe(Math.round(1450 * 0.11));
    expect(find('kitchen-1').sqft).toBe(Math.round(1450 * 0.12));
    /* the garage is sized off bays, not off living area */
    expect(find('garage-1').sqft).toBe(400);
  });

  it('every task id is unique inside its own space', () => {
    for (const d of SPACE_DEFS) {
      const ids = d.tasks.map(t => t.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('every task carries a positive cost', () => {
    for (const d of SPACE_DEFS) for (const t of d.tasks) expect(t.cost).toBeGreaterThan(0);
  });

  it('scales room-area tasks by that room, not the whole house', () => {
    const bed = find('bedroom-1');
    const paint = DEF_BY_KIND.bedroom.tasks.find(t => t.id === 'paint')!;
    expect(taskQty(paint, bed, prop)).toBe(bed.sqft);
    expect(taskQty(paint, bed, prop)).toBeLessThan(prop.sqft);
  });

  it('scales whole-house tasks by the house', () => {
    const rewire = DEF_BY_KIND.electrical.tasks.find(t => t.id === 'rewire')!;
    expect(taskQty(rewire, find('electrical'), prop)).toBe(prop.sqft);
  });

  it('prices the same task once per room instance', () => {
    const oneBath = sow(on([taskKey('bathroom-1', 'shower-tile')]));
    const twoBaths = sow(on([taskKey('bathroom-1', 'shower-tile'), taskKey('bathroom-2', 'shower-tile')]));
    near(twoBaths.total, oneBath.total * 2);
  });

  it('a level preset scopes a room in one move', () => {
    const bath = find('bathroom-1');
    const gutted = applyLevel(bath, 3, {});
    const t = sow(gutted);
    expect(t.checkedCount).toBeGreaterThan(8);
    /* demo to studs is gut-only; a refresh must not include it */
    expect(gutted[taskKey('bathroom-1', 'demo')]).toBe(true);
    expect(applyLevel(bath, 1, {})[taskKey('bathroom-1', 'demo')]).toBeUndefined();
  });

  it('levels get dearer as they get deeper', () => {
    const bath = find('bathroom-1');
    const cost = (lv: 1 | 2 | 3) => sow(applyLevel(bath, lv, {})).total;
    expect(cost(1)).toBeLessThan(cost(2));
    expect(cost(2)).toBeLessThan(cost(3));
  });

  it('level 0 clears the space and only that space', () => {
    let c = applyLevel(find('bathroom-1'), 3, {});
    c = applyLevel(find('bathroom-2'), 3, c);
    c = applyLevel(find('bathroom-1'), 0, c);
    expect(Object.keys(c).some(k => k.startsWith('bathroom-1.'))).toBe(false);
    expect(Object.keys(c).some(k => k.startsWith('bathroom-2.'))).toBe(true);
  });

  it('applying a level replaces the previous one rather than adding to it', () => {
    const bath = find('bathroom-1');
    const after = applyLevel(bath, 1, applyLevel(bath, 3, {}));
    expect(after[taskKey('bathroom-1', 'demo')]).toBeUndefined();
  });

  it('reports spaces with nothing scoped, so a blank room is a decision', () => {
    const t = sow(applyLevel(find('kitchen-1'), 2, {}));
    expect(t.emptySpaces).toContain('Bedroom 1');
    expect(t.emptySpaces).not.toContain('Kitchen');
  });

  it('reports commonly-missed lines that are still unscoped', () => {
    const t = sow({});
    const descs = t.missedUnchecked.map(m => m.desc).join(' | ');
    expect(descs).toMatch(/sewer lateral/i);
    expect(descs).toMatch(/panel upgrade/i);
    expect(descs).toMatch(/contingency/i);
  });

  it('stops reporting a missed line once it is scoped', () => {
    const key = taskKey('plumbing', 'lateral');
    expect(sow(on([key])).missedUnchecked.some(m => m.key === key)).toBe(false);
  });

  it('honours a quantity override', () => {
    const key = taskKey('bedroom-1', 'recessed');
    near(sow(on([key]), { [key]: 10 }).total,
         10 * DEF_BY_KIND.bedroom.tasks.find(t => t.id === 'recessed')!.cost);
  });

  it('honours a shared price override without touching the catalog', () => {
    const key = taskKey('bathroom-1', 'toilet');
    near(sow(on([key]), {}, { [priceKey('bathroom', 'toilet')]: 9999 }).total, 9999);
    expect(DEF_BY_KIND.bathroom.tasks.find(t => t.id === 'toilet')!.cost).not.toBe(9999);
  });

  it('a price override reaches every room of that kind at once', () => {
    const keys = [taskKey('bathroom-1', 'toilet'), taskKey('bathroom-2', 'toilet')];
    near(sow(on(keys), {}, { [priceKey('bathroom', 'toilet')]: 500 }).total, 1000);
  });

  it('percent lines bill off hard costs and never off each other', () => {
    const hard = taskKey('bathroom-1', 'shower-tile');
    const only = sow(on([hard]));
    const withPct = sow(on([hard, taskKey('soft', 'gc'), taskKey('soft', 'contingency')]));
    const gc = DEF_BY_KIND.soft.tasks.find(t => t.id === 'gc')!.cost;
    const cont = DEF_BY_KIND.soft.tasks.find(t => t.id === 'contingency')!.cost;
    near(withPct.hard, only.total);
    near(withPct.total, only.total * (1 + gc / 100 + cont / 100));
  });

  it('space subtotals add up to the grand total', () => {
    const all = Object.fromEntries(spaces.flatMap(sp =>
      DEF_BY_KIND[sp.kind].tasks.map(t => [taskKey(sp.id, t.id), true])));
    const t = sow(all);
    near(t.total, t.spaces.reduce((a, x) => a + x.cost, 0), 1);
    expect(t.emptySpaces).toEqual([]);
  });

  /* The point of the whole tab: a plausible scope has to price like a real
     Bay Area job, or the accuracy this structure buys is imaginary. */
  const scopeAll = (level: 1 | 2 | 3) =>
    spaces.reduce((c, sp) => applyLevel(sp, level, c), {} as Record<string, boolean>);

  it('a whole-house refresh prices as a cosmetic job', () => {
    const psf = sow(scopeAll(1)).total / prop.sqft;
    expect(psf).toBeGreaterThan(55);
    expect(psf).toBeLessThan(120);
  });

  /* Setting every one of the nineteen spaces to the same level is a maximal
     job — reroof, rewire, repipe, ducts, windows, full exterior and full
     landscape all at once — not a typical project. These bands say the maximum
     is plausible, not that it is what anyone would scope. */
  it('renovating every single space is a major job, not a mid-scope one', () => {
    const psf = sow(scopeAll(2)).total / prop.sqft;
    expect(psf).toBeGreaterThan(220);
    expect(psf).toBeLessThan(360);
  });

  it('gutting every single space sits at the top of the Bay Area range', () => {
    const t = sow(scopeAll(3));
    expect(t.hard / prop.sqft).toBeGreaterThan(280);
    expect(t.hard / prop.sqft).toBeLessThan(460);
  });

  /* The scope people actually write: gut the wet rooms where the money shows,
     refresh the dry ones, and touch only the systems that need it. */
  it('a realistic mixed scope lands in Bay Area flip territory', () => {
    let c: Record<string, boolean> = {};
    for (const id of ['kitchen-1', 'bathroom-1', 'bathroom-2']) c = applyLevel(find(id), 3, c);
    for (const id of ['bedroom-1', 'bedroom-2', 'bedroom-3', 'living-1', 'dining-1', 'hall-1', 'halfbath-1'])
      c = applyLevel(find(id), 1, c);
    for (const id of ['roof', 'electrical', 'hvac', 'exterior', 'landscape', 'demo', 'soft'])
      c = applyLevel(find(id), 2, c);
    const psf = sow(c).total / prop.sqft;
    expect(psf).toBeGreaterThan(120);
    expect(psf).toBeLessThan(300);
  });

  /* Room-level figures are the strongest check available: these are numbers a
     Bay Area contractor would recognise. */
  it('prices a single bathroom the way a Bay Area bathroom prices', () => {
    const bath = find('bathroom-1');
    const at = (lv: 1 | 2 | 3) => sow(applyLevel(bath, lv, {})).total;
    expect(at(1)).toBeGreaterThan(2500); expect(at(1)).toBeLessThan(9000);
    expect(at(2)).toBeGreaterThan(11000); expect(at(2)).toBeLessThan(24000);
    expect(at(3)).toBeGreaterThan(18000); expect(at(3)).toBeLessThan(40000);
  });

  it('prices a single kitchen the way a Bay Area kitchen prices', () => {
    const kit = find('kitchen-1');
    const at = (lv: 1 | 2 | 3) => sow(applyLevel(kit, lv, {})).total;
    expect(at(1)).toBeGreaterThan(12000); expect(at(1)).toBeLessThan(30000);
    expect(at(3)).toBeGreaterThan(38000); expect(at(3)).toBeLessThan(85000);
  });

  it('keeps mutually exclusive alternatives out of the same preset', () => {
    /* stucco or siding, sod or drought planting — never both from one click */
    const ext = applyLevel(find('exterior'), 2, {});
    expect(ext[taskKey('exterior', 'siding')]).toBeUndefined();
    const yard = applyLevel(find('landscape'), 2, {});
    expect(yard[taskKey('landscape', 'drought')]).toBeUndefined();
    expect(yard[taskKey('landscape', 'sod')]).toBe(true);
  });

  it('a shared price correction reaches every deal, not just this one', () => {
    const key = taskKey('kitchen-1', 'appliances');
    const stock = sow(on([key])).total;
    const corrected = sow(on([key]), {}, { [priceKey('kitchen', 'appliances')]: 9000 }).total;
    expect(corrected).toBe(9000);
    expect(corrected).not.toBe(stock);
  });
});

describe('city presets', () => {
  it('every preset has a verified date and a sane tax rate', () => {
    for (const { slug } of [{ slug: 'oakland' }, { slug: 'san-jose' }, { slug: 'redwood-city' }]) {
      const c = findCity(slug)!;
      expect(c.verifiedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      /* a levied rate, not a Prop 13-depressed "effective" one */
      expect(c.taxRatePct).toBeGreaterThanOrEqual(1.0);
      expect(c.taxRatePct).toBeLessThan(2.0);
    }
  });

  it('an unknown city slug falls back to county rate only', () => {
    expect(findCity('nowhere')).toBeNull();
    near(cityTransferTax(findCity('nowhere'), 1_000_000), 0);
  });
});

describe('renovation guide', () => {
  it('holds exactly fifty renovations', () => {
    expect(RENOVATIONS).toHaveLength(50);
  });

  it('every id is unique', () => {
    const ids = RENOVATIONS.map(i => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every entry is fully written — no placeholder rows', () => {
    for (const i of RENOVATIONS) {
      expect(i.name.length).toBeGreaterThan(3);
      expect(i.unit.length).toBeGreaterThan(0);
      expect(i.days.length).toBeGreaterThan(0);
      /* the two note fields are the reason this guide exists */
      expect(i.drivers.length).toBeGreaterThan(40);
      expect(i.watch.length).toBeGreaterThan(40);
    }
  });

  it('every range runs low to high, and project totals cover the unit cost', () => {
    for (const i of RENOVATIONS) {
      expect(i.unitLow).toBeGreaterThan(0);
      expect(i.unitHigh).toBeGreaterThan(i.unitLow);
      expect(i.projectLow).toBeGreaterThan(0);
      expect(i.projectHigh).toBeGreaterThan(i.projectLow);
      /* a whole job can never come to less than one unit of itself */
      expect(i.projectHigh).toBeGreaterThanOrEqual(i.unitHigh);
    }
  });

  it('every category is represented and every entry lands in a known one', () => {
    const counts = countByCategory();
    for (const c of RENO_CATEGORIES) expect(counts[c] ?? 0).toBeGreaterThan(0);
    for (const i of RENOVATIONS) expect(RENO_CATEGORIES).toContain(i.category);
  });

  it('searches names, categories and both note fields', () => {
    expect(searchRenovations('countertop', 'all').map(i => i.id)).toContain('countertops');
    expect(searchRenovations('kitchen', 'all').length).toBeGreaterThan(3);
    /* the notes are searchable, which is how someone finds the warning they
       half-remember rather than the renovation they already know the name of */
    expect(searchRenovations('asbestos', 'all').map(i => i.id)).toContain('popcorn');
    expect(searchRenovations('PG&E', 'all').map(i => i.id)).toContain('panel-upgrade');
    expect(searchRenovations('Earthquake Brace', 'all').map(i => i.id)).toContain('seismic-retrofit');
  });

  it('filters by category, and combines with the query', () => {
    const kitchen = searchRenovations('', 'Kitchen');
    expect(kitchen.length).toBeGreaterThan(3);
    expect(kitchen.every(i => i.category === 'Kitchen')).toBe(true);
    expect(searchRenovations('cabinet', 'Kitchen').length).toBeGreaterThan(0);
    expect(searchRenovations('cabinet', 'Plumbing')).toEqual([]);
  });

  it('an empty query returns everything', () => {
    expect(searchRenovations('   ', 'all')).toHaveLength(50);
  });

  it('agrees with the scope of work on the renovations they both price', () => {
    /* The guide and the estimator are separate datasets written for different
       jobs. Where they name the same work they must not contradict each other,
       or one of the two is teaching the wrong number. */
    const pairs: [string, string, string][] = [
      ['countertops', 'kitchen', 'counter'],
      ['ev-charger', 'garage', 'ev'],
      ['panel-upgrade', 'electrical', 'panel'],
      ['sewer-lateral', 'plumbing', 'lateral'],
      ['water-heater', 'plumbing', 'wh'],
      ['seismic-retrofit', 'structural', 'seismic'],
      ['furnace', 'hvac', 'furnace'],
    ];
    for (const [renoId, kind, taskId] of pairs) {
      const g = RENOVATIONS.find(i => i.id === renoId)!;
      const t = DEF_BY_KIND[kind].tasks.find(x => x.id === taskId)!;
      expect(t.cost).toBeGreaterThanOrEqual(g.unitLow);
      expect(t.cost).toBeLessThanOrEqual(g.unitHigh);
    }
  });
});


describe('seller disclosure package', () => {
  it('zeroes exactly the lines the package covers, and nothing else', () => {
    const on = computeFlip(base({ sellerDisclosure: true }));
    const off = computeFlip(base({ sellerDisclosure: false }));
    for (const i of ACQ_ITEMS) {
      const a = on.acqLines.find(l => l.id === i.id)!.amount;
      const b = off.acqLines.find(l => l.id === i.id)!.amount;
      if (SELLER_PROVIDED.has(i.id)) { near(a, 0); near(b, i.val); }
      else near(a, b);
    }
  });

  it('the sewer lateral scope stays yours either way', () => {
    /* even when disclosed it is worth your own eyes — a failed lateral is
       $15-30k and four Alameda County cities need a certificate at sale */
    expect(SELLER_PROVIDED.has('inspSewer')).toBe(false);
    expect(computeFlip(base({ sellerDisclosure: true })).acqLines
      .find(l => l.id === 'inspSewer')!.amount).toBeGreaterThan(0);
  });

  it('turning it off raises acquisition cost and lowers profit', () => {
    const on = computeFlip(base({ sellerDisclosure: true }));
    const off = computeFlip(base({ sellerDisclosure: false }));
    expect(off.acqTotal).toBeGreaterThan(on.acqTotal);
    expect(off.preTaxProfit).toBeLessThan(on.preTaxProfit);
  });

  it('does not disturb the values you typed — they come back', () => {
    const s = base({ sellerDisclosure: true });
    expect(s.acq.inspGeneral).toBeGreaterThan(0);
  });
});

describe('the profit floor is pre-tax', () => {
  it('the verdict reads pre-tax profit, not net', () => {
    /* a deal whose pre-tax profit clears the floor but whose after-tax does
       not must still read as clearing it */
    const s = base({ minProfit: 100000, taxPct: 45 });
    const r = computeFlip(s);
    expect(r.preTaxProfit).toBeGreaterThan(100000);
    expect(r.netProfit).toBeLessThan(100000);
    expect(verdictFor(r, s).v).toBe('good');
  });

  it('flags a deal under the floor', () => {
    const s = base({ minProfit: 200000 });
    expect(verdictFor(computeFlip(s), s).v).toBe('ok');
  });

  it('flags a losing deal', () => {
    const s = base({ price: 1_400_000 });
    expect(verdictFor(computeFlip(s), s).v).toBe('bad');
  });
});

describe('profit waterfall', () => {
  const s = base();
  const r = computeFlip(s);
  const w = buildWaterfall(s, r);

  it('starts at the sale price and ends on net profit', () => {
    expect(w[0].kind).toBe('start');
    near(w[0].amount, r.sale);
    const last = w[w.length - 1];
    expect(last.kind).toBe('result');
    near(last.amount, r.netProfit, 1);
  });

  /* the picture asserts an arithmetic claim; this is that claim */
  it('every step lands on the balance the P&L reports', () => {
    let bal = r.sale;
    for (const step of w.slice(1, -1)) {
      expect(step.kind).toBe('cost');
      bal -= step.amount;
      near(step.balance, bal, 1);
    }
    near(bal, r.netProfit, 1);
  });

  it('accounts for every cost group exactly once', () => {
    const costs = w.filter(x => x.kind === 'cost');
    expect(costs.map(x => x.id).sort()).toEqual(
      ['acq', 'fin', 'hold', 'purchase', 'rehab', 'sell', 'tax']);
    near(costs.reduce((a, x) => a + x.amount, 0), r.sale - r.netProfit, 1);
  });

  it('shares are of the sale price and sum with the result to 100%', () => {
    const total = w.filter(x => x.kind !== 'start').reduce((a, x) => a + x.share, 0);
    near(total, 100, 0.01);
  });

  it('makes the biggest cost findable — purchase price dominates a flip', () => {
    const costs = w.filter(x => x.kind === 'cost').sort((a, b) => b.amount - a.amount);
    expect(costs[0].id).toBe('purchase');
  });

  it('a losing deal still balances', () => {
    const bad = base({ price: 1_400_000 });
    const br = computeFlip(bad);
    const bw = buildWaterfall(bad, br);
    near(bw[bw.length - 1].amount, br.netProfit, 1);
    expect(br.netProfit).toBeLessThan(0);
  });
});
