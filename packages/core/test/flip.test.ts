/* Flip analyzer engine. The cases here are the ways this model could be quietly
   wrong in a direction that costs real money: double-counting principal,
   treating a transfer tax cliff as a marginal bracket, double-counting
   contingency or the supplemental tax bill, or an MAO that doesn't actually
   hit the profit floor it solved for. */

import { describe, it, expect } from 'vitest';
import {
  defaultFlipState, computeFlip, solveMAO, seventyRule,
  buildSensitivity, type FlipState,
} from '../src/flip';
import { cityTransferTax, findCity, countyTransferTax } from '../src/bayAreaCities';
import { computeChecklist, CATALOG, ITEM_BY_ID, seededQty, type QtyContext } from '../src/flipCatalog';

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

  it('derives the hold period from all three phases', () => {
    const r = computeFlip(base({ rehabMonths: 5, domDays: 21, escrowDays: 30 }));
    near(r.rehabPeriod, 5);
    near(r.holdMonths, 5 + 51 / 30.4375, 0.01);
  });

  it('spends the estimate plus its buffer, and counts the buffer once', () => {
    const r = computeFlip(base({ rehabEst: 200000, rehabBuffer: 20000 }));
    near(r.rehabEst, 200000);
    near(r.rehabBuffer, 20000);
    near(r.rehabTotal, 220000);
  });

  it('a rehab override replaces the whole budget, buffer included', () => {
    const r = computeFlip(base({ rehabEst: 200000, rehabBuffer: 20000 }), 'base', 175000);
    near(r.rehabTotal, 175000);
  });

  it('prices property tax off the reassessed purchase price, not the old roll', () => {
    const s = base({ price: 800000, taxRatePct: 1.25, rehabMonths: 6, domDays: 0, escrowDays: 0 });
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
  it('holds all cash', () => conserves(base({ finMode: 'conv', ltvPct: 0 })));
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
  it('zero LTV means no loan, no financing cost, and peak cash carries the deal', () => {
    const r = computeFlip(base({ finMode: 'conv', ltvPct: 0, originationPct: 1, convFees: 1800 }));
    near(r.loanAtClose, 0);
    near(r.payoffAtSale, 0);
    near(r.interest, 0);
    near(r.downPayment, base().price);
    /* only the flat lender fee survives with no loan to originate against */
    near(r.finTotal, 1800);
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
  it('a deal bought at MAO lands exactly on the profit floor', () => {
    const s = base({ minProfit: 75000, minProfitBasis: 'after' });
    const mao = solveMAO(s);
    expect(mao).toBeGreaterThan(0);
    near(computeFlip(s, 'base', undefined, mao).netProfit, 75000, 200);
  });

  it('solves against pre-tax profit when that is the basis', () => {
    const s = base({ minProfit: 120000, minProfitBasis: 'pre' });
    near(computeFlip(s, 'base', undefined, solveMAO(s)).preTaxProfit, 120000, 200);
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
    near(computeFlip(s, 'base', undefined, mao).netProfit, 60000, 500);
  });

  it('returns 0 when the deal cannot clear the floor even for free', () => {
    near(solveMAO(base({ minProfit: 5_000_000 })), 0);
  });

  it('the 70% rule is reported as a cross-check, not the answer', () => {
    const s = base();
    near(seventyRule(s), 0.70 * s.arv.base - (s.rehabEst + s.rehabBuffer));
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

  it('runs the rehab axis from the estimate to twice the buffer, budget centred', () => {
    const s = base({ rehabEst: 200000, rehabBuffer: 30000 });
    const g = buildSensitivity(s, 7);
    expect(g.rehabAxis).toHaveLength(7);
    near(g.rehabAxis[0], 200000);          /* spend exactly the estimate */
    near(g.rehabAxis[3], 230000);          /* the budget you underwrite */
    near(g.rehabAxis[6], 260000);          /* burn twice the buffer */
    near(g.baseRehab, 230000);
  });

  it('falls back to a sane axis when the buffer is zero', () => {
    const g = buildSensitivity(base({ rehabEst: 200000, rehabBuffer: 0 }), 7);
    expect(new Set(g.rehabAxis).size).toBe(7);
    expect(g.rehabAxis[6]).toBeGreaterThan(g.rehabAxis[0]);
  });

  it('increases left to right and decreases top to bottom', () => {
    const g = buildSensitivity(base({ rehabBuffer: 40000 }), 7);
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

describe('cost checklist', () => {
  const ctx: QtyContext = { sqft: 1450, beds: 3, baths: 2, halfBaths: 1, stories: 1, garageBays: 2 };

  it('every item id is unique across the whole catalog', () => {
    const ids = CATALOG.flatMap(s => s.items.map(i => i.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every item prices low <= base <= high', () => {
    for (const i of CATALOG.flatMap(s => s.items)) {
      expect(i.low).toBeLessThanOrEqual(i.base);
      expect(i.base).toBeLessThanOrEqual(i.high);
    }
  });

  it('seeds room-driven quantities from the property', () => {
    /* one check on "tile shower surround" prices all the bathrooms */
    near(seededQty(ITEM_BY_ID['tile-shower'], ctx), 2);
    near(seededQty(ITEM_BY_ID['tile-shower'], { ...ctx, baths: 4 }), 4);
    /* half-bath items follow their own driver */
    near(seededQty(ITEM_BY_ID['plumb-halfbath'], ctx), 1);
    /* sqft-driven items scale with area */
    near(seededQty(ITEM_BY_ID['paint-int-walls'], ctx), 1450);
  });

  it('unchecked items contribute nothing', () => {
    const t = computeChecklist({}, {}, {}, ctx);
    near(t.base, 0);
    expect(t.checkedCount).toBe(0);
  });

  it('totals a checked item as quantity times unit cost', () => {
    const t = computeChecklist({ 'tile-shower': true }, {}, {}, ctx);
    const i = ITEM_BY_ID['tile-shower'];
    near(t.base, 2 * i.base);
    near(t.low, 2 * i.low);
    near(t.high, 2 * i.high);
  });

  it('honours a quantity override', () => {
    const t = computeChecklist({ 'tile-shower': true }, { 'tile-shower': 5 }, {}, ctx);
    near(t.base, 5 * ITEM_BY_ID['tile-shower'].base);
  });

  it('honours a per-deal price override without touching the catalog', () => {
    const t = computeChecklist({ 'tile-shower': true }, {}, { 'tile-shower.base': 9999 }, ctx);
    near(t.base, 2 * 9999);
    /* the shared catalog is untouched, so other deals are unaffected */
    expect(ITEM_BY_ID['tile-shower'].base).not.toBe(9999);
  });

  it('applies GC fee against hard costs and never against itself', () => {
    const hardOnly = computeChecklist({ 'tile-shower': true }, {}, {}, ctx);
    const withGc = computeChecklist({ 'tile-shower': true, 'soft-gc': true }, {}, {}, ctx);
    const gcPct = ITEM_BY_ID['soft-gc'].base;
    near(withGc.hardBase, hardOnly.base);
    near(withGc.base, hardOnly.base * (1 + gcPct / 100));
  });

  it('two percent items both bill off hard costs, not off each other', () => {
    const t = computeChecklist(
      { 'tile-shower': true, 'soft-gc': true, 'soft-genconditions': true }, {}, {}, ctx);
    const hard = t.hardBase;
    const gc = ITEM_BY_ID['soft-gc'].base, gen = ITEM_BY_ID['soft-genconditions'].base;
    near(t.base, hard * (1 + gc / 100 + gen / 100));
  });

  it('section subtotals add up to the grand total', () => {
    const checked = Object.fromEntries(CATALOG.flatMap(s => s.items.map(i => [i.id, true])));
    const t = computeChecklist(checked, {}, {}, ctx);
    near(t.base, t.sections.reduce((a, s) => a + s.base, 0), 1);
    expect(t.checkedCount).toBe(CATALOG.flatMap(s => s.items).length);
  });

  /* Seeded prices are only useful if a realistic scope lands where a Bay Area
     scope actually lands. These two bracket the range this tool gets used on. */
  const COSMETIC = ['demo-int', 'demo-dumpster', 'demo-haul', 'dry-patch',
    'paint-int-walls', 'paint-int-trim', 'paint-ext-body',
    'floor-lvp', 'floor-shoe', 'floor-level',
    'cab-kitchen-stock', 'cab-counter-quartz', 'cab-sink-kitchen', 'cab-appliance', 'cab-hardware',
    'cab-vanity', 'tile-bathfloor', 'tile-shower', 'tile-backsplash', 'tile-waterproof', 'tile-pan',
    'elec-fixture', 'elec-devices', 'elec-recessed', 'plumb-trim-bath',
    'land-front', 'soft-permit-build', 'soft-gc', 'soft-clean'];

  const GUT = [...COSMETIC, 'frame-dryrot', 'frame-subfloor', 'frame-trim-base',
    'win-retrofit', 'win-interior', 'win-entry', 'roof-comp', 'roof-gutter',
    'elec-panel', 'elec-rewire-full', 'elec-smoke', 'plumb-repipe', 'plumb-wh',
    'hvac-furnace', 'hvac-duct-new', 'hvac-bathfan', 'hvac-range',
    'dry-hang', 'dry-attic', 'soft-architect', 'soft-plancheck', 'soft-genconditions'];

  const on = (ids: string[]) => Object.fromEntries(ids.map(i => [i, true]));

  it('prices a cosmetic refresh in the Bay Area cosmetic range', () => {
    const psf = computeChecklist(on(COSMETIC), {}, {}, ctx).base / ctx.sqft;
    expect(psf).toBeGreaterThan(70);
    expect(psf).toBeLessThan(160);
  });

  it('prices a full gut in the Bay Area gut range', () => {
    const psf = computeChecklist(on(GUT), {}, {}, ctx).base / ctx.sqft;
    expect(psf).toBeGreaterThan(190);
    expect(psf).toBeLessThan(380);
  });

  it('a gut costs more than a cosmetic refresh at every price level', () => {
    const c = computeChecklist(on(COSMETIC), {}, {}, ctx);
    const g = computeChecklist(on(GUT), {}, {}, ctx);
    expect(g.low).toBeGreaterThan(c.low);
    expect(g.base).toBeGreaterThan(c.base);
    expect(g.high).toBeGreaterThan(c.high);
  });

  it('low < base < high on any non-trivial scope', () => {
    const t = computeChecklist(on(GUT), {}, {}, ctx);
    expect(t.low).toBeLessThan(t.base);
    expect(t.base).toBeLessThan(t.high);
  });

  it('checking literally everything is absurd but not off by an order of magnitude', () => {
    /* not a real scope — it buys two kitchens' worth of cabinets, four floor
       types and three roofs — so this only guards against a stray zero */
    const checked = Object.fromEntries(CATALOG.flatMap(s => s.items.map(i => [i.id, true])));
    const psf = computeChecklist(checked, {}, {}, ctx).base / ctx.sqft;
    expect(psf).toBeGreaterThan(400);
    expect(psf).toBeLessThan(1500);
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
