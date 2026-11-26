/* Investor Toolkit MCP server.

   Exposes the toolkit's calculators to any MCP client over stdio. Every tool
   is a thin wrapper around the same engine the website runs (@reit/core), so
   an agent and the site always agree. Each tool takes only the inputs you
   give it; everything else falls back to the calculator's own defaults, and
   the reply says which defaults were used where it matters.

   Nothing here reads or writes files, calls the network, or keeps state. */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  defaultDealState, compute as computeRental,
  simulate, deriveDown, type MortgageState,
  defaultFlipState, computeFlip, solveMAO, seventyRule, verdictFor, SCENARIO_KEYS, type FlipState,
  CITY_PRESETS, findCity,
  defaultTaxState, computeTax, gainsImpact, repsComparison, tablesFor, type TaxState, type TaxResult,
  metrics, type PropertyState,
} from '@reit/core';

const server = new McpServer({ name: 'investor-toolkit', version: '0.1.0' });

/* ---------------------------------------------------------------- helpers */
const r0 = (n: number) => Math.round(n);
const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;
const fin = (n: number) => (isFinite(n) ? n : null);
const reply = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] });
const num = (d: string) => z.number().describe(d).optional();
const DISCLAIMER = 'Screening estimate from tools.michaelhyunn.com. Not tax, legal or lending advice.';

/* ================================================================= rental */
server.registerTool('analyze_rental', {
  title: 'Analyze a rental property',
  description: 'Underwrite a buy-and-hold rental: cash needed, monthly cash flow, cash-on-cash return, cap rate, DSCR and a 5-year outlook. All amounts in US dollars. Omitted inputs use the calculator defaults (20% down, 7% for 30 years, 5% vacancy, 10% management, 8% maintenance, 8% CapEx reserve).',
  inputSchema: {
    price: z.number().describe('Purchase price'),
    monthly_rent: z.number().describe('Gross monthly rent'),
    down_payment_pct: num('Down payment as a percent of price. Default 20'),
    rehab: num('Up-front repair budget. Default 10000'),
    closing_costs: num('Closing costs in dollars. Default 6000'),
    interest_rate: num('Loan rate, percent per year. Default 7'),
    term_years: num('Loan term in years. Default 30'),
    interest_only_years: num('Years of interest-only payments, if any'),
    vacancy_pct: num('Vacancy as a percent of rent. Default 5'),
    property_tax_monthly: num('Property tax per month. Default 250'),
    insurance_monthly: num('Insurance per month. Default 120'),
    hoa_monthly: num('HOA dues per month. Default 0'),
    management_pct: num('Property management, percent of rent. Default 10'),
    maintenance_pct: num('Maintenance, percent of rent. Default 8'),
    capex_pct: num('CapEx reserve, percent of rent. Default 8'),
    other_expenses_monthly: num('Any other owner-paid costs per month (utilities, landscaping, pest)'),
    other_income_monthly: num('Laundry, parking, storage, pet rent per month'),
    rent_growth_pct: num('Rent growth per year. Default 3'),
    expense_growth_pct: num('Expense growth per year. Default 2.5'),
    appreciation_pct: num('Appreciation per year. Default 3'),
    selling_cost_pct: num('Cost to sell at year 5, percent of sale price. Default 7'),
    seller_financing: z.object({
      amount: z.number(), rate: z.number(), term_years: z.number(), interest_only: z.boolean().optional(),
    }).describe('A seller-carried note, if any').optional(),
    subject_to: z.object({ balance: z.number(), rate: z.number(), term_years_left: z.number() })
      .describe("An existing loan taken over 'subject to', if any").optional(),
  },
}, async a => {
  const s = defaultDealState();
  s.price = a.price; s.rent = a.monthly_rent;
  if (a.down_payment_pct != null) s.downPct = a.down_payment_pct;
  if (a.rehab != null) s.rehab = a.rehab;
  if (a.closing_costs != null) { s.closing = a.closing_costs; s.closingUnit = '$'; }
  if (a.interest_rate != null) s.rate = a.interest_rate;
  if (a.term_years != null) s.term = a.term_years;
  if (a.interest_only_years) { s.ioOn = true; s.ioYears = a.interest_only_years; }
  if (a.vacancy_pct != null) s.vacancy = a.vacancy_pct;
  const exp = (id: string, v: number | undefined) => { if (v != null) s.expenses[id] = v; };
  exp('tax', a.property_tax_monthly); exp('ins', a.insurance_monthly);
  /* these two inputs are monthly figures; the sheet's own default for them is yearly */
  if (a.property_tax_monthly != null) s.units.tax = 'mo';
  if (a.insurance_monthly != null) s.units.ins = 'mo'; exp('hoa', a.hoa_monthly);
  exp('mgmt', a.management_pct); exp('maint', a.maintenance_pct); exp('capex', a.capex_pct);
  exp('misc', a.other_expenses_monthly);
  if (a.other_income_monthly != null) s.otherInc.other = a.other_income_monthly;
  if (a.rent_growth_pct != null) s.rentGrowth = a.rent_growth_pct;
  if (a.expense_growth_pct != null) s.expGrowth = a.expense_growth_pct;
  if (a.appreciation_pct != null) s.appr = a.appreciation_pct;
  if (a.selling_cost_pct != null) s.sellCost = a.selling_cost_pct;
  if (a.seller_financing) {
    s.sellerOn = true; s.sellerAmt = a.seller_financing.amount; s.sellerRate = a.seller_financing.rate;
    s.sellerTerm = a.seller_financing.term_years; s.sellerType = a.seller_financing.interest_only ? 'io' : 'am';
  }
  if (a.subject_to) {
    s.subtoOn = true; s.subtoBal = a.subject_to.balance; s.subtoRate = a.subject_to.rate; s.subtoTerm = a.subject_to.term_years_left;
  }
  const r = computeRental(s);
  return reply({
    cash_needed: { down_payment: r0(r.downAmt), closing: r0(r.closingAmt), rehab: r0(s.rehab), total: r0(r.cashInvested) },
    financing: {
      new_loan: r0(r.newLoan), seller_note: r0(r.sellerAmt), subject_to_balance: r0(r.subtoBal),
      monthly_debt_payment: r0(r.pi), payment_after_interest_only: r.payAfterIO ? r0(r.payAfterIO) : undefined,
      warning: r.overBy > 0 ? `Down payment plus other financing exceeds the price by ${r0(r.overBy)}` : undefined,
    },
    monthly: {
      gross_income: r0(r.gross), vacancy_loss: r0(r.vacLoss), effective_income: r0(r.effIncome),
      operating_expenses: r0(r.opEx), net_operating_income: r0(r.noi), debt_payment: r0(r.pi), cash_flow: r0(r.cashFlow),
      expense_lines: r.expLines.filter(l => l.monthly).map(l => ({ item: l.label, monthly: r0(l.monthly) })),
    },
    returns: {
      annual_cash_flow: r0(r.annualCF), cash_on_cash_pct: fin(r1(r.coc)),
      cap_rate_pct: s.price > 0 ? r1(r.noi * 12 / s.price * 100) : null,
      dscr: fin(r2(r.dscr)), rent_to_price_pct: fin(r2(r.onePct)), gross_rent_multiplier: fin(r1(r.grm)),
    },
    five_year: {
      net_sale_proceeds: r0(r.proceeds), total_profit: r0(r.totalProfit), total_return_pct: fin(r1(r.roi5)),
      annualized_return_pct: fin(r1(r.annualized)),
      by_year: r.years.map(y => y),
    },
    note: DISCLAIMER,
  });
});

/* =============================================================== mortgage */
server.registerTool('mortgage_payment', {
  title: 'Mortgage payment and payoff',
  description: 'Monthly payment split into principal, interest, taxes, insurance, PMI and HOA; total interest; payoff date; and what extra principal saves. Supports interest-only periods and ARMs.',
  inputSchema: {
    price: z.number().describe('Home price'),
    down_payment: num('Down payment. A percent of price unless down_payment_is_dollars is true. Default 20'),
    down_payment_is_dollars: z.boolean().optional(),
    interest_rate: num('Rate, percent per year. Default 7'),
    term_years: num('Loan term in years. Default 30'),
    property_tax_yearly: num('Property tax per year. Default 0'),
    insurance_yearly: num('Homeowners insurance per year. Default 0'),
    hoa_monthly: num('HOA dues per month. Default 0'),
    pmi_rate_pct: num('PMI, percent of the loan per year, charged while equity is under 20%. Default 0.5'),
    extra_principal_monthly: num('Extra principal paid each month'),
    interest_only_years: num('Years of interest-only payments, if any'),
    arm: z.object({
      fixed_years: z.number(), adjusted_rate: z.number().describe('Rate you expect after the fixed period'),
      adjusts_every_months: z.number().optional(),
    }).describe('Adjustable-rate terms, if any').optional(),
    include_yearly_schedule: z.boolean().describe('Also return principal, interest and balance for every year').optional(),
  },
}, async a => {
  const s: MortgageState = {
    price: a.price, down: a.down_payment ?? 20, downUnit: a.down_payment_is_dollars ? '$' : '%',
    io: !!a.interest_only_years, ioYears: a.interest_only_years || 10,
    rate: a.interest_rate ?? 7, term: a.term_years ?? 30,
    tax: a.property_tax_yearly ?? 0, ins: a.insurance_yearly ?? 0, hoa: a.hoa_monthly ?? 0,
    pmiRate: a.pmi_rate_pct ?? 0.5, extra: a.extra_principal_monthly ?? 0,
    armOn: !!a.arm, armFixed: a.arm?.fixed_years ?? 7, armFreq: a.arm?.adjusts_every_months ?? 6, armRate: a.arm?.adjusted_rate ?? 8.5,
  };
  const { downAmt, downPct } = deriveDown(s);
  const base = simulate(s, 0);
  const withExtra = s.extra > 0 ? simulate(s, s.extra) : base;
  const firstInterest = Math.min(base.basePI, base.loan * s.rate / 1200);
  const escrow = s.tax / 12 + s.ins / 12 + s.hoa;
  return reply({
    loan_amount: r0(base.loan), down_payment: r0(downAmt), down_payment_pct: r1(downPct),
    monthly_payment: {
      principal: r0(base.basePI - firstInterest + s.extra), interest: r0(firstInterest),
      property_tax: r0(s.tax / 12), insurance: r0(s.ins / 12), hoa: r0(s.hoa), pmi: r0(base.pmiMonthly),
      total: r0(base.basePI + escrow + base.pmiMonthly + s.extra),
    },
    payment_after_arm_adjusts: withExtra.adjustedPI ? r0(withExtra.adjustedPI + escrow) : undefined,
    payment_after_interest_only: withExtra.postIOPI ? r0(withExtra.postIOPI + escrow) : undefined,
    balloon_due_at_end: withExtra.balloon ? r0(withExtra.balloon) : undefined,
    total_interest: r0(withExtra.totalInterest), total_pmi: r0(withExtra.totalPMI),
    pmi_drops_after_months: withExtra.pmiEndMonth || undefined,
    payoff_months: withExtra.months,
    extra_principal: s.extra > 0 ? {
      interest_saved: r0(base.totalInterest - withExtra.totalInterest), months_sooner: base.months - withExtra.months,
    } : undefined,
    yearly_schedule: a.include_yearly_schedule
      ? withExtra.years.map(y => ({ year: y.y, principal: r0(y.principal), interest: r0(y.interest), balance: r0(y.balance) })) : undefined,
    note: DISCLAIMER,
  });
});

/* =================================================================== flip */
const cityBy = (q: string) => {
  const k = q.trim().toLowerCase();
  return findCity(k) ?? CITY_PRESETS.find(c => c.name.toLowerCase() === k) ?? null;
};

server.registerTool('analyze_flip', {
  title: 'Analyze a fix-and-flip',
  description: 'Underwrite a Bay Area fix-and-flip: profit, return on cash, peak cash, the maximum offer that still clears your minimum profit, and the 70% rule. Runs low, base and high resale scenarios. Acquisition, holding and selling costs come pre-filled with Bay Area defaults; pass a city to apply its transfer tax, property tax rate and retrofit costs.',
  inputSchema: {
    purchase_price: z.number(),
    arv: z.number().describe('After-repair value, base case'),
    rehab_budget: z.number().describe('Rehab budget, base case'),
    arv_low: num('Low resale case. Default 5% under base'),
    arv_high: num('High resale case. Default 5% over base'),
    rehab_low: num('Low rehab case. Default 15% under base'),
    rehab_high: num('High rehab case. Default 25% over base'),
    square_feet: num('Living area, for per-foot figures'),
    city: z.string().describe('Bay Area city name or slug, e.g. "San Jose". See list_bay_area_cities').optional(),
    rehab_days: num('Days of construction, permits included. Default 120'),
    days_on_market: num('List to accepted offer. Default 21'),
    escrow_days: num('Accepted offer to close. Default 30'),
    overrun_days: num('Schedule slip to stress-test'),
    financing: z.enum(['hard_money', 'conventional', 'cash']).describe('Default hard_money').optional(),
    loan_to_cost_pct: num('Hard money: share of purchase financed. Default 85'),
    rehab_financed_pct: num('Hard money: share of rehab financed. Default 100'),
    interest_rate: num('Loan rate, percent per year'),
    points_pct: num('Hard money points at close'),
    loan_to_value_pct: num('Conventional: share of purchase financed'),
    min_profit: num('Profit the deal must clear. Sets the verdict and the max offer. Default 50000'),
    listing_commission_pct: num('Default 2.5'),
    buyer_agent_commission_pct: num('Default 2.5'),
    live_in_months: num('Months you live in the house before selling, for a live-in flip'),
    housing_you_would_pay_monthly: num('Live-in flip: rent you avoid while living there'),
  },
}, async a => {
  const s: FlipState = defaultFlipState();
  s.price = a.purchase_price;
  s.arv = { low: a.arv_low ?? Math.round(a.arv * 0.95), base: a.arv, high: a.arv_high ?? Math.round(a.arv * 1.05) };
  s.rehabSource = 'manual';
  s.rehab = { low: a.rehab_low ?? Math.round(a.rehab_budget * 0.85), base: a.rehab_budget, high: a.rehab_high ?? Math.round(a.rehab_budget * 1.25) };
  if (a.square_feet != null) s.prop.sqft = a.square_feet;
  let cityNote: string | undefined;
  if (a.city) {
    const c = cityBy(a.city);
    if (c) {
      s.citySlug = c.slug; s.taxRatePct = c.taxRatePct; s.transferPayer = c.payer;
      s.retrofit = c.retrofit.reduce((t, x) => t + x.cost, 0);
      cityNote = `${c.name} preset applied (property tax ${c.taxRatePct}%, transfer tax paid by ${c.payer}).`;
    } else cityNote = `No preset for "${a.city}"; county transfer tax only. Call list_bay_area_cities for the supported names.`;
  }
  if (a.rehab_days != null) s.rehabDays = a.rehab_days;
  if (a.days_on_market != null) s.domDays = a.days_on_market;
  if (a.escrow_days != null) s.escrowDays = a.escrow_days;
  if (a.overrun_days != null) s.overrunDays = a.overrun_days;
  if (a.financing) s.finMode = a.financing === 'hard_money' ? 'hard' : a.financing === 'conventional' ? 'conv' : 'cash';
  if (a.loan_to_cost_pct != null) s.ltcPct = a.loan_to_cost_pct;
  if (a.rehab_financed_pct != null) s.rehabFinancedPct = a.rehab_financed_pct;
  if (a.interest_rate != null) { s.hardRate = a.interest_rate; s.convRate = a.interest_rate; }
  if (a.points_pct != null) s.pointsPct = a.points_pct;
  if (a.loan_to_value_pct != null) s.ltvPct = a.loan_to_value_pct;
  if (a.min_profit != null) s.minProfit = a.min_profit;
  if (a.listing_commission_pct != null) s.listCommPct = a.listing_commission_pct;
  if (a.buyer_agent_commission_pct != null) s.buyerCommPct = a.buyer_agent_commission_pct;
  if (a.live_in_months) { s.liveIn = true; s.occupancyMonths = a.live_in_months; s.avoidedHousing = a.housing_you_would_pay_monthly ?? s.avoidedHousing; }

  const base = computeFlip(s, 'base');
  const v = verdictFor(base, s);
  return reply({
    verdict: { call: v.v, headline: v.title, detail: v.sub },
    max_offer_for_min_profit: r0(solveMAO(s)), seventy_percent_rule_offer: r0(seventyRule(s)), min_profit: s.minProfit,
    base_case: {
      sale_price: r0(base.sale), net_profit: r0(base.profit), return_on_cash_pct: fin(r1(base.roi)),
      annualized_return_pct: fin(r1(base.annualizedRoi)), margin_pct_of_arv: fin(r1(base.margin)),
      peak_cash_out_of_pocket: r0(base.peakCash), cash_to_close: r0(base.cashToClose),
      hold_months: r1(base.holdMonths),
      costs: {
        purchase: r0(s.price), acquisition: r0(base.acqTotal), rehab: r0(base.rehabTotal), holding: r0(base.holdTotal),
        financing: r0(base.finTotal), selling: r0(base.sellTotal), selling_pct_of_sale: r1(base.sellPctOfSale),
      },
      loan: { at_close: r0(base.loanAtClose), down_payment: r0(base.downPayment), interest: r0(base.interest) },
      gross_spread_pct_of_arv: r1(base.grossSpread),
    },
    scenarios: SCENARIO_KEYS.map(k => {
      const x = computeFlip(s, k);
      return { arv_case: k, sale_price: r0(x.sale), net_profit: r0(x.profit), return_on_cash_pct: fin(r1(x.roi)) };
    }),
    city: cityNote,
    note: `Profit is before income tax. ${DISCLAIMER}`,
  });
});

server.registerTool('list_bay_area_cities', {
  title: 'Bay Area city presets',
  description: 'The Bay Area cities analyze_flip has presets for, with each city\'s property tax rate, who customarily pays the city transfer tax, and retrofit-on-sale costs.',
  inputSchema: { county: z.string().describe('Filter to one county, e.g. "Alameda"').optional() },
}, async a => reply(CITY_PRESETS
  .filter(c => !a.county || c.county.toLowerCase() === a.county.trim().toLowerCase())
  .map(c => ({
    name: c.name, slug: c.slug, county: c.county, property_tax_rate_pct: c.taxRatePct,
    city_transfer_tax_paid_by: c.payer, has_city_transfer_tax: c.tiers.length > 0,
    retrofit_on_sale: r0(c.retrofit.reduce((t, x) => t + x.cost, 0)),
  }))));

/* ==================================================================== tax */
const taxShape = {
  year: z.union([z.literal(2025), z.literal(2026)]).describe('Tax year. Default 2026').optional(),
  filing_status: z.enum(['single', 'mfj', 'mfs', 'hoh']).describe('single, mfj (married filing jointly), mfs (married filing separately) or hoh (head of household). Default mfj').optional(),
  wages: num('Your W-2 wages, gross, before 401(k)'),
  spouse_wages: num('Spouse W-2 wages, gross'),
  self_employment_profit: num('Schedule C net profit, e.g. commission income after expenses'),
  interest: num('Taxable interest'),
  ordinary_dividends: num('Total ordinary dividends (1099-DIV box 1a)'),
  qualified_dividends: num('Qualified part of those dividends (box 1b)'),
  short_term_gains: num('Capital gains held a year or less'),
  long_term_gains: num('Capital gains held over a year'),
  depreciation_recapture: num('Unrecaptured section 1250 gain from a rental sale'),
  other_income: num('Other ordinary income, e.g. flip profit'),
  rental_net: num('Net rental income after depreciation. A loss is negative'),
  real_estate_professional: z.boolean().describe('Qualifies under IRC 469(c)(7). Federal only: California ignores it').optional(),
  prior_suspended_losses: num('Passive losses carried in from earlier years'),
  deferral_401k: num('Your 401(k) elective deferral'),
  employer_401k: num('Employer or solo 401(k) / SEP contribution'),
  hsa: num('HSA contribution'),
  traditional_ira: num('Deductible traditional IRA contribution'),
  self_employed_health_insurance: num('Self-employed health insurance premiums'),
  other_adjustments: num('Other above-the-line adjustments'),
  mortgage_interest: num('Home mortgage interest (not rentals)'),
  property_tax: num('Property tax on your residence'),
  charitable: num('Charitable gifts'),
  medical: num('Medical expenses'),
  other_itemized: num('Other itemized deductions'),
  children_under_17: num('Children under 17'),
  other_dependents: num('Other dependents'),
  rentals_qualify_for_199a: z.boolean().describe('Rentals count as a trade or business for the 20% deduction. Default true').optional(),
  qbi_w2_wages: num('W-2 wages your business paid'),
  qbi_property_basis: num('Unadjusted basis of business property'),
};
type TaxArgs = { [K in keyof typeof taxShape]?: any };

/** Tax inputs start from zero, not from the website's sample household. */
function taxState(a: TaxArgs): TaxState {
  const d = defaultTaxState();
  const s: TaxState = { ...d };
  for (const k of Object.keys(d) as (keyof TaxState)[]) if (typeof d[k] === 'number' && k !== 'year') (s as any)[k] = 0;
  s.reps = false; s.rentalQualifiesQbi = a.rentals_qualify_for_199a ?? true;
  s.year = a.year ?? 2026; s.status = a.filing_status ?? 'mfj';
  const map: [keyof typeof taxShape, keyof TaxState][] = [
    ['wages', 'wages'], ['spouse_wages', 'spouseWages'], ['self_employment_profit', 'seNetProfit'], ['interest', 'interest'],
    ['ordinary_dividends', 'ordinaryDividends'], ['qualified_dividends', 'qualifiedDividends'],
    ['short_term_gains', 'shortTermGains'], ['long_term_gains', 'longTermGains'], ['depreciation_recapture', 'unrecaptured1250'],
    ['other_income', 'otherIncome'], ['rental_net', 'rentalNet'], ['prior_suspended_losses', 'passiveCarryforward'],
    ['deferral_401k', 'deferral401k'], ['employer_401k', 'employer401k'], ['hsa', 'hsa'], ['traditional_ira', 'tradIra'],
    ['self_employed_health_insurance', 'seHealthIns'], ['other_adjustments', 'otherAdjust'],
    ['mortgage_interest', 'mortgageInterest'], ['property_tax', 'propertyTax'], ['charitable', 'charitable'],
    ['medical', 'medical'], ['other_itemized', 'otherItemized'], ['children_under_17', 'childrenUnder17'],
    ['other_dependents', 'otherDependents'], ['qbi_w2_wages', 'qbiWages'], ['qbi_property_basis', 'qbiProperty'],
  ];
  for (const [from, to] of map) if (a[from] != null) (s as any)[to] = a[from];
  if (a.real_estate_professional != null) s.reps = a.real_estate_professional;
  return s;
}
const taxSummary = (r: TaxResult) => ({
  total_tax: r0(r.totalTax), federal_tax: r0(r.federalTotal), california_tax: r0(r.caTotal), after_tax_income: r0(r.afterTax),
  effective_rate_pct: r1(r.effectiveRate), marginal_rate_pct: r1(r.marginalCombined),
  gross_income: r0(r.grossIncome), adjusted_gross_income: r0(r.agi), federal_taxable_income: r0(r.taxableIncome),
  california_taxable_income: r0(r.caTaxableIncome),
});

server.registerTool('income_tax', {
  title: 'Federal and California income tax',
  description: 'Estimate federal and California income tax for a California resident, for tax year 2025 or 2026: total tax, effective and marginal rates, and the line-by-line build-up, including self-employment tax, the 3.8% investment surtax, the SALT cap, the 20% business income deduction and rental loss limits. Inputs you leave out are zero. Does not compute AMT.',
  inputSchema: taxShape,
}, async a => {
  const s = taxState(a);
  const r = computeTax(s);
  return reply({
    ...taxSummary(r),
    federal: {
      total_income: r0(r.totalIncome), adjustments: r0(r.adjustments), deduction: { kind: r.deductionKind, amount: r0(r.deductionUsed) },
      business_income_deduction_199a: r0(r.qbiDeduction), tax_on_ordinary_income: r0(r.fedOrdinaryTax),
      tax_on_gains_and_qualified_dividends: r0(r.fedGainsTax + r.fed1250Tax), credits: r0(r.credits),
      self_employment_tax: r0(r.seTax), net_investment_income_tax: r0(r.niit), additional_medicare_tax: r0(r.addlMedicare),
      bracket_pct: r.fedBracketRate, marginal_rate_measured_pct: r1(r.marginalFederal),
      salt: { paid: r0(r.saltPaid), cap: r0(r.saltCapUsed), deducted: r0(r.saltAllowed) },
    },
    california: {
      agi: r0(r.caAgi), deduction: { kind: r.caDeductionKind, amount: r0(r.caDeduction) }, tax_on_brackets: r0(r.caBaseTax),
      mental_health_tax: r0(r.caMentalHealth), exemption_credits: r0(r.caExemptionCredits),
      bracket_pct: r.caBracketRate, marginal_rate_measured_pct: r1(r.marginalCa), state_disability_insurance: r0(r.caSdi),
    },
    rental_loss: s.rentalNet < 0 ? {
      deducted_federal: r0(r.rentalAllowed), suspended_federal: r0(r.rentalSuspended),
      deducted_california: r0(r.caRentalAllowed), suspended_california: r0(r.caRentalSuspended),
      special_allowance: r0(r.specialAllowance),
    } : undefined,
    marginal_rate_on_long_term_gain_pct: r1(r.marginalGains),
    note: `Planning model, not a return. No AMT. ${DISCLAIMER}`,
  });
});

server.registerTool('tax_on_sale', {
  title: 'Tax added by selling an asset',
  description: 'What a sale adds to federal and California tax, on top of the household\'s other income: the total, the share of the gain it takes, what is kept, and whether the gain pushes the household into a higher capital gains bracket. Give the household\'s other income with the same fields as income_tax.',
  inputSchema: {
    long_term_gain: z.number().describe('Gain on an asset held over a year (sale price less basis)'),
    short_term_gain: num('Gain on an asset held a year or less'),
    recapture: num('Depreciation taken on a rental, recaptured at up to 25%'),
    home_sale_exclusion: num('Section 121 exclusion on a primary residence: up to 250000 single, 500000 married'),
    ...taxShape,
  },
}, async a => {
  const s = taxState(a);
  const long = Math.max(0, a.long_term_gain - (a.home_sale_exclusion ?? 0));
  const g = gainsImpact(s, long, a.short_term_gain ?? 0, a.recapture ?? 0);
  const { fed } = tablesFor(s.year);
  const ladder = fed.capGains[s.status];
  const step = (t: number) => Math.max(0, ladder.findIndex(b => t < b.upTo));
  const i0 = step(g.without.taxableIncome), i1 = step(g.with.taxableIncome);
  const line = i1 > 0 ? ladder[i1 - 1].upTo : 0;
  return reply({
    taxable_gain: r0(g.gainTotal), total_tax_on_sale: r0(g.totalDelta), share_of_gain_pct: r1(g.effectiveOnGain), you_keep: r0(g.netProceeds),
    federal: {
      total: r0(g.fedDelta),
      capital_gains_tax: r0((g.with.fedGainsTax + g.with.fed1250Tax) - (g.without.fedGainsTax + g.without.fed1250Tax)),
      investment_surtax_3_8_pct: r0(g.niitDelta),
      tax_on_other_income: r0(g.with.fedOrdinaryTax - g.without.fedOrdinaryTax),
      gains_bracket_before_pct: ladder[i0].rate * 100, gains_bracket_after_pct: ladder[i1].rate * 100,
      pushed_into_higher_bracket: i1 > i0 ? { new_bracket_pct: ladder[i1].rate * 100, income_past_the_line: r0(g.with.taxableIncome - line), bracket_starts_at: r0(line) } : false,
    },
    california: { total: r0(g.caDelta), bracket_before_pct: g.without.caBracketRate, bracket_after_pct: g.with.caBracketRate, note: 'California taxes capital gains as ordinary income.' },
    total_tax_before_sale: r0(g.without.totalTax), total_tax_after_sale: r0(g.with.totalTax),
    marginal_rate_on_next_dollar_of_gain_pct: r1(g.marginalNext),
    note: `A 1031 exchange into another investment property would defer this. ${DISCLAIMER}`,
  });
});

server.registerTool('real_estate_professional_value', {
  title: 'What real estate professional status is worth',
  description: 'Compare this year\'s tax with and without the real estate professional election (IRC 469(c)(7)), which lets rental losses offset other income. Federal only: California treats every rental as passive. Give the household with the same fields as income_tax, including a negative rental_net.',
  inputSchema: taxShape,
}, async a => {
  const c = repsComparison(taxState(a));
  return reply({
    saving_this_year: r0(c.saving),
    without_election: { ...taxSummary(c.off), rental_loss_deducted: r0(c.off.rentalAllowed), rental_loss_suspended: r0(c.off.rentalSuspended) },
    with_election: { ...taxSummary(c.on), rental_loss_deducted: r0(c.on.rentalAllowed), blocked_by_business_loss_cap: r0(c.on.eblDisallowed) },
    california_changes: false,
    requirements: 'Over 750 hours a year in real property trades, more than half of all working time, and material participation in the rentals. Keep a contemporaneous log.',
    note: DISCLAIMER,
  });
});

server.registerTool('tax_brackets', {
  title: 'Tax brackets and thresholds',
  description: 'Federal ordinary and long-term capital gains brackets, California brackets, standard deductions and the main thresholds (investment surtax, SALT cap, 199A, contribution limits) for a tax year and filing status.',
  inputSchema: { year: taxShape.year, filing_status: taxShape.filing_status },
}, async a => {
  const year = a.year ?? 2026, st = a.filing_status ?? 'mfj';
  const { fed, ca } = tablesFor(year);
  const ladder = (bs: { upTo: number; rate: number }[]) => bs.map((b, i) => ({
    rate_pct: r2(b.rate * 100), from: i === 0 ? 0 : bs[i - 1].upTo, to: isFinite(b.upTo) ? b.upTo : null,
  }));
  return reply({
    year, filing_status: st,
    federal_ordinary: ladder(fed.ordinary[st]), federal_long_term_gains: ladder(fed.capGains[st]), california: ladder(ca.brackets[st]),
    standard_deduction: { federal: fed.standardDeduction[st], california: ca.standardDeduction[st] },
    thresholds: {
      net_investment_income_tax_from: fed.niitFrom[st], additional_medicare_tax_from: fed.addlMedicareFrom[st],
      salt_cap: fed.saltCap[st], salt_cap_phases_down_from: fed.saltPhasedownFrom[st], salt_cap_floor: fed.saltFloor[st],
      section_199a_threshold: fed.qbiThreshold[st], child_credit_phase_out_from: fed.creditPhaseoutFrom[st],
      excess_business_loss_cap: fed.excessBusinessLoss[st], california_mental_health_tax_from: ca.mentalHealthFrom,
      social_security_wage_base: fed.ssWageBase,
    },
    contribution_limits: { elective_401k: fed.elective401k, catch_up_401k_age_50: fed.catchUp401k, ira: fed.iraLimit, hsa_self: fed.hsaSelf, hsa_family: fed.hsaFamily },
    sources: { federal: fed.source, california: ca.source },
  });
});

/* ============================================================== portfolio */
server.registerTool('portfolio_summary', {
  title: 'Portfolio equity and returns',
  description: 'For a set of rentals you own: equity, monthly cash flow, cash-on-cash and return on equity per property, ranked by return on equity, with portfolio totals and a flag on "lazy equity" (under 6% return on more than $25,000 of equity).',
  inputSchema: {
    properties: z.array(z.object({
      name: z.string(),
      current_value: z.number(),
      loan_balance: z.number().optional(),
      interest_rate: z.number().describe('Percent per year').optional(),
      monthly_payment: z.number().describe('Principal and interest only').optional(),
      monthly_income: z.number().describe('Gross rent per month'),
      monthly_operating_expenses: z.number().describe('Everything except property tax, insurance and the loan').optional(),
      yearly_property_tax: z.number().optional(),
      yearly_insurance: z.number().optional(),
      purchase_price: z.number().optional(),
      down_payment: z.number().optional(),
      additional_cash_in: z.number().describe('Rehab, closing and other cash put in').optional(),
      ownership_pct: z.number().describe('Your share. Default 100').optional(),
      date_acquired: z.string().describe('YYYY-MM-DD').optional(),
    })).min(1),
  },
}, async a => {
  const now = Date.now();
  const rows = a.properties.map(p => {
    const s: PropertyState = {
      name: p.name, dateAcq: p.date_acquired ?? '', ownPct: p.ownership_pct ?? 100,
      price: p.purchase_price ?? 0, down: p.down_payment ?? 0, other: p.additional_cash_in ?? 0,
      value: p.current_value, loan: p.loan_balance ?? 0, rate: p.interest_rate ?? 0, pay: p.monthly_payment ?? 0,
      income: { v: p.monthly_income, unit: 'mo' }, opex: { v: p.monthly_operating_expenses ?? 0, unit: 'mo' },
      taxes: { v: p.yearly_property_tax ?? 0, unit: 'yr' }, ins: { v: p.yearly_insurance ?? 0, unit: 'yr' }, cfOverride: null,
    };
    return { s, m: metrics(s, now) };
  }).sort((x, y) => (isFinite(y.m.roe) ? y.m.roe : -1e9) - (isFinite(x.m.roe) ? x.m.roe : -1e9));
  let value = 0, equity = 0, cf = 0, invested = 0, ret = 0;
  for (const { s, m } of rows) {
    value += s.value * m.own; equity += m.equityShare; cf += m.cfShare;
    invested += (s.down + s.other) * m.own; ret += (m.cfY + m.paydownY) * m.own;
  }
  const lazy = rows.filter(x => isFinite(x.m.roe) && x.m.roe < 6 && x.m.equityShare > 25000);
  return reply({
    totals: {
      portfolio_value: r0(value), your_equity: r0(equity), monthly_cash_flow: r0(cf),
      blended_return_on_equity_pct: equity > 0 ? r1(ret / equity * 100) : null,
      blended_cash_on_cash_pct: invested > 0 ? r1(cf * 12 / invested * 100) : null,
    },
    properties: rows.map(({ s, m }, i) => ({
      rank: i + 1, name: s.name, your_equity: r0(m.equityShare), monthly_cash_flow: r0(m.cfShare),
      cash_on_cash_pct: fin(r1(m.coc)), return_on_equity_pct: fin(r1(m.roe)), yearly_principal_paydown: r0(m.paydownY),
      appreciation_since_purchase_pct: fin(r1(m.appr)), years_held: fin(r1(m.holdYrs)),
    })),
    lazy_equity: lazy.length ? {
      properties: lazy.map(x => x.s.name), equity: r0(lazy.reduce((t, x) => t + x.m.equityShare, 0)),
      suggestion: 'Model a cash-out refinance, a HELOC, or a 1031 exchange into a stronger deal.',
    } : null,
    definitions: {
      cash_on_cash: 'A year of cash flow divided by the cash you put in.',
      return_on_equity: 'A year of cash flow plus loan paydown, divided by the equity in the property today.',
    },
    note: DISCLAIMER,
  });
});

await server.connect(new StdioServerTransport());
