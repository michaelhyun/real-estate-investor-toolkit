/* Federal and California income tax — a planning model, not a return.

   Three things here are easy to get wrong and are the reason this exists
   rather than a spreadsheet:

   1. Long-term gains and qualified dividends do not have their own separate
      tax. They stack on top of ordinary income and pay the 0/15/20 ladder
      from wherever that stack lands. Two people with identical gains and
      different salaries owe different amounts.

   2. Rental losses are passive by default. The $25,000 special allowance
      phases out between $100k and $150k of income and is simply gone above
      that, so for most Bay Area earners an unelected rental loss deducts
      nothing at all this year. Real estate professional status is what
      changes that, and §461(l) still caps what a big loss can shelter.

   3. The bracket you are "in" is not the rate your next dollar pays.
      Phase-outs of the SALT cap, the child credit, the QBI deduction and
      the passive allowance all stack extra cost onto marginal income. So
      the marginal rate here is measured, not read off a table: it adds a
      thousand dollars of income and re-runs the whole return. */

import {
  type FilingStatus, type TaxYear, type Bracket,
  bracketTax, bracketRate, tablesFor,
} from './taxTables';

export interface TaxState {
  year: TaxYear;
  status: FilingStatus;

  /* earned income — wages are GROSS, before any 401(k) deferral, because
     that is the number on an offer letter rather than on a W-2 */
  wages: number;
  spouseWages: number;
  /** Schedule C net profit. A Compass commission after business expenses. */
  seNetProfit: number;

  /* portfolio */
  interest: number;
  ordinaryDividends: number;
  /** a subset of ordinaryDividends, taxed on the gains ladder */
  qualifiedDividends: number;
  shortTermGains: number;
  longTermGains: number;
  /** §1250 depreciation recapture on a rental sale — its own 25% ceiling */
  unrecaptured1250: number;
  otherIncome: number;

  /* real estate */
  rentalNet: number;
  /** §469(c)(7): 750 hours, more than half your working time, and material
      participation. Turns rental losses from passive into ordinary. */
  reps: boolean;
  /** prior-year suspended passive losses. REPS does not free these. */
  passiveCarryforward: number;

  /* above the line */
  deferral401k: number;
  /** solo 401(k) or SEP employer side, deductible against self-employment */
  employer401k: number;
  hsa: number;
  tradIra: number;
  seHealthIns: number;
  otherAdjust: number;

  /* itemized */
  mortgageInterest: number;
  propertyTax: number;
  charitable: number;
  medical: number;
  otherItemized: number;

  /* household */
  childrenUnder17: number;
  otherDependents: number;

  /* §199A inputs */
  rentalQualifiesQbi: boolean;
  /** W-2 wages the business paid — the limit that bites above the threshold */
  qbiWages: number;
  /** unadjusted basis of business property, for the 2.5% alternative limit */
  qbiProperty: number;
}

export function defaultTaxState(): TaxState {
  return {
    year: 2026,
    status: 'mfj',
    wages: 0,
    spouseWages: 0,
    seNetProfit: 320000,
    interest: 4000,
    ordinaryDividends: 9000,
    qualifiedDividends: 7500,
    shortTermGains: 0,
    longTermGains: 0,
    unrecaptured1250: 0,
    otherIncome: 0,
    rentalNet: -28000,
    reps: false,
    passiveCarryforward: 0,
    deferral401k: 24500,
    employer401k: 46000,
    hsa: 8750,
    tradIra: 0,
    seHealthIns: 24000,
    otherAdjust: 0,
    mortgageInterest: 38000,
    propertyTax: 16500,
    charitable: 8000,
    medical: 0,
    otherItemized: 0,
    childrenUnder17: 2,
    otherDependents: 0,
    rentalQualifiesQbi: true,
    qbiWages: 0,
    qbiProperty: 0,
  };
}

/* ------------------------------------------------------------------ results */

export interface TaxResult {
  /* income */
  grossIncome: number;
  rentalAllowed: number;
  rentalSuspended: number;
  specialAllowance: number;
  eblDisallowed: number;
  totalIncome: number;
  halfSeTax: number;
  adjustments: number;
  agi: number;

  /* deduction */
  standardTotal: number;
  itemizedTotal: number;
  saltPaid: number;
  saltAllowed: number;
  saltCapUsed: number;
  charitableAllowed: number;
  medicalAllowed: number;
  deductionUsed: number;
  deductionKind: 'standard' | 'itemized';
  qbi: number;
  qbiDeduction: number;
  qbiWageLimited: boolean;
  taxableIncome: number;

  /* federal */
  ordinaryTaxable: number;
  preferentialIncome: number;
  fedOrdinaryTax: number;
  fedGainsTax: number;
  fed1250Tax: number;
  fedIncomeTax: number;
  credits: number;
  seTax: number;
  niit: number;
  netInvestmentIncome: number;
  addlMedicare: number;
  federalTotal: number;

  /* california */
  caAgi: number;
  caStandard: number;
  caItemized: number;
  caItemizedPhaseout: number;
  caDeduction: number;
  caDeductionKind: 'standard' | 'itemized';
  caTaxableIncome: number;
  caBaseTax: number;
  caMentalHealth: number;
  caExemptionCredits: number;
  caTotal: number;
  caSdi: number;

  /* headline */
  totalTax: number;
  afterTax: number;
  effectiveRate: number;
  effectiveOnAgi: number;
  fedBracketRate: number;
  caBracketRate: number;
  marginalFederal: number;
  marginalCa: number;
  marginalCombined: number;
  marginalGains: number;
}

/* --------------------------------------------------------------- the engine */

/** Tax on `amount` sitting on top of `base` — how a stacked slice is priced. */
const stacked = (base: number, amount: number, b: Bracket[]) =>
  bracketTax(base + amount, b) - bracketTax(base, b);

const MARGIN_PROBE = 1000;

export function computeTax(s: TaxState, probe = false): TaxResult {
  const { fed, ca } = tablesFor(s.year);
  const st = s.status;
  const pos = (n: number) => Math.max(0, n);

  /* ---------- self-employment tax ----------
     Only the first ssWageBase of combined earnings pays the 12.4% social
     security half, and W-2 wages fill that base first. */
  const netEarnings = pos(s.seNetProfit) * 0.9235;
  const ssRoom = pos(fed.ssWageBase - s.wages);
  const seSocial = Math.min(netEarnings, ssRoom) * 0.124;
  const seMedicare = netEarnings * 0.029;
  const seTax = seSocial + seMedicare;
  const halfSeTax = seTax / 2;

  /* ---------- rental losses ----------
     The special allowance is measured against income computed WITHOUT the
     rental loss, which is why this runs before AGI is final. */
  const rentalIncome = pos(s.rentalNet);
  const currentLoss = pos(-s.rentalNet);
  const incomeBeforeRental =
    s.wages + s.spouseWages + s.seNetProfit + s.interest + s.ordinaryDividends +
    s.shortTermGains + s.longTermGains + s.unrecaptured1250 + s.otherIncome;
  const magi469 = incomeBeforeRental - (s.deferral401k + s.employer401k + s.hsa + halfSeTax + s.seHealthIns);

  /* A carryforward stays passive whatever you elect: prior suspended losses
     are released by passive income or by disposing of the activity, and
     electing professional status this year does not reach back. */
  const carryUsed = Math.min(s.passiveCarryforward, rentalIncome);
  const carryLeft = s.passiveCarryforward - carryUsed;

  let currentAllowed: number;
  let specialAllowance = 0;
  if (s.reps) {
    currentAllowed = currentLoss;
  } else {
    const cap = st === 'mfs' ? 12500 : 25000;
    const from = st === 'mfs' ? 50000 : 100000;
    specialAllowance = pos(Math.min(cap, cap - pos(magi469 - from) * 0.5));
    currentAllowed = Math.min(currentLoss, specialAllowance);
  }
  const rentalSuspended = (currentLoss - currentAllowed) + carryLeft;
  const rentalContribution = rentalIncome - carryUsed - currentAllowed;

  /* §461(l): a business loss bigger than the cap is not deductible this year.
     It becomes an NOL carryforward — the ceiling on what professional status
     can shelter in any single year. */
  const businessNet = s.seNetProfit + (s.reps ? -currentAllowed + rentalIncome : 0);
  const eblCap = fed.excessBusinessLoss[st];
  const eblDisallowed = businessNet < -eblCap ? -businessNet - eblCap : 0;

  const totalIncome =
    s.wages + s.spouseWages + s.seNetProfit + s.interest + s.ordinaryDividends +
    s.shortTermGains + s.longTermGains + s.unrecaptured1250 + s.otherIncome +
    rentalContribution + eblDisallowed;

  const grossIncome =
    s.wages + s.spouseWages + pos(s.seNetProfit) + s.interest + s.ordinaryDividends +
    pos(s.shortTermGains) + pos(s.longTermGains) + s.unrecaptured1250 + s.otherIncome + rentalIncome;

  const adjustments =
    s.deferral401k + s.employer401k + s.hsa + s.tradIra + s.seHealthIns + halfSeTax + s.otherAdjust;
  const agi = totalIncome - adjustments;
  const magi = agi;

  /* ---------- california ----------
     Runs first because the tax it produces is the state income tax the
     federal SALT deduction claims. */
  const caAgi = agi + s.hsa;   /* California never conformed to HSAs */
  const caMedical = pos(s.medical - 0.075 * caAgi);
  /* No deduction for state income tax on a state return, and property tax
     is not capped the way the federal cap caps it. */
  const caItemizedRaw = s.mortgageInterest + s.propertyTax + s.charitable + caMedical + s.otherItemized;
  const caItemizedPhaseout = Math.min(
    0.06 * pos(caAgi - ca.itemizedPhaseoutFrom[st]), 0.8 * caItemizedRaw);
  const caItemized = caItemizedRaw - caItemizedPhaseout;
  const caStandard = ca.standardDeduction[st];
  const caDeductionKind: 'standard' | 'itemized' = caItemized > caStandard ? 'itemized' : 'standard';
  const caDeduction = Math.max(caStandard, caItemized);
  const caTaxableIncome = pos(caAgi - caDeduction);
  const caBaseTax = bracketTax(caTaxableIncome, ca.brackets[st]);
  const caMentalHealth = pos(caTaxableIncome - ca.mentalHealthFrom) * ca.mentalHealthRate;

  const exemptionCount = (st === 'mfj' ? 2 : 1);
  const dependents = s.childrenUnder17 + s.otherDependents;
  const rawExemptions = exemptionCount * ca.personalExemption + dependents * ca.dependentExemption;
  const phaseStep = st === 'mfs' ? 1250 : 2500;
  const phaseUnits = Math.ceil(pos(caAgi - ca.exemptionPhaseoutFrom[st]) / phaseStep);
  const caExemptionCredits = pos(rawExemptions - phaseUnits * 6 * (exemptionCount + dependents));
  const caTotal = pos(caBaseTax + caMentalHealth - caExemptionCredits);
  const caSdi = (s.wages + s.spouseWages) * ca.sdiRate;

  /* ---------- federal deduction ---------- */
  const saltPaid = s.propertyTax + caTotal;
  const saltCapUsed = Math.max(
    fed.saltFloor[st], fed.saltCap[st] - 0.30 * pos(magi - fed.saltPhasedownFrom[st]));
  const saltAllowed = Math.min(saltPaid, saltCapUsed);
  const charitableAllowed = pos(s.charitable - fed.charitableAgiFloor * agi);
  const medicalAllowed = pos(s.medical - 0.075 * agi);
  const itemizedTotal =
    s.mortgageInterest + saltAllowed + charitableAllowed + medicalAllowed + s.otherItemized;
  /* the above-the-line charitable deduction only exists for people who do
     NOT itemize, so it belongs to the standard-deduction side of this choice */
  const standardTotal = fed.standardDeduction[st] +
    Math.min(s.charitable, fed.charitableNonItemizer[st]);
  const deductionKind: 'standard' | 'itemized' = itemizedTotal > standardTotal ? 'itemized' : 'standard';
  const deductionUsed = Math.max(standardTotal, itemizedTotal);

  /* ---------- §199A ----------
     A real estate agent or broker is NOT a specified service trade or
     business — Reg. §1.199A-5(b)(2)(x) carves brokerage of real property out
     of the "brokerage services" that get phased out. So commission income
     keeps the deduction where a lawyer's or consultant's would lose it.
     The W-2 wage limit still applies, and for a sole proprietor with no
     payroll that limit is zero. */
  const seQbi = pos(s.seNetProfit - halfSeTax - s.seHealthIns - s.employer401k - s.deferral401k);
  const qbi = seQbi + (s.rentalQualifiesQbi ? pos(s.rentalNet) : 0);
  const netCapitalGain = pos(s.longTermGains) + s.qualifiedDividends;
  const taxableBeforeQbi = pos(agi - deductionUsed);
  const qbiFull = 0.20 * qbi;
  const wageLimit = Math.max(0.5 * s.qbiWages, 0.25 * s.qbiWages + 0.025 * s.qbiProperty);
  const qbiExcess = pos(taxableBeforeQbi - fed.qbiThreshold[st]);
  const phaseFrac = Math.min(1, fed.qbiPhaseIn[st] > 0 ? qbiExcess / fed.qbiPhaseIn[st] : 1);
  const limited = Math.min(qbiFull, wageLimit);
  const component = phaseFrac <= 0 ? qbiFull : qbiFull - (qbiFull - limited) * phaseFrac;
  const qbiDeduction = pos(Math.min(component, 0.20 * pos(taxableBeforeQbi - netCapitalGain)));
  const qbiWageLimited = qbiFull > 0 && component < qbiFull - 0.5;

  const taxableIncome = pos(taxableBeforeQbi - qbiDeduction);

  /* ---------- federal tax, stacked ----------
     Ordinary income sits at the bottom, unrecaptured §1250 above it with a
     25% ceiling, then long-term gains and qualified dividends on top. */
  const preferentialIncome = Math.min(netCapitalGain, taxableIncome);
  const unrec = Math.min(s.unrecaptured1250, pos(taxableIncome - preferentialIncome));
  const ordinaryTaxable = pos(taxableIncome - preferentialIncome - unrec);
  const fedOrdinaryTax = bracketTax(ordinaryTaxable, fed.ordinary[st]);
  const fed1250Tax = Math.min(
    stacked(ordinaryTaxable, unrec, fed.ordinary[st]), unrec * 0.25);
  const fedGainsTax = stacked(ordinaryTaxable + unrec, preferentialIncome, fed.capGains[st]);
  const fedIncomeTax = fedOrdinaryTax + fed1250Tax + fedGainsTax;

  /* ---------- credits ---------- */
  const rawCredits = s.childrenUnder17 * fed.childCredit + s.otherDependents * fed.otherDependentCredit;
  const creditReduction = Math.ceil(pos(magi - fed.creditPhaseoutFrom[st]) / 1000) * 50;
  const credits = Math.min(rawCredits, pos(rawCredits - creditReduction));

  /* ---------- surtaxes ----------
     Rental income of a professional who materially participates is carved
     out of net investment income by the §1411 regulations. */
  const netInvestmentIncome = pos(
    s.interest + s.ordinaryDividends + s.shortTermGains + s.longTermGains +
    s.unrecaptured1250 + (s.reps ? 0 : rentalIncome));
  const niit = 0.038 * Math.min(netInvestmentIncome, pos(magi - fed.niitFrom[st]));
  const medicareWages = s.wages + s.spouseWages + netEarnings;
  const addlMedicare = 0.009 * pos(medicareWages - fed.addlMedicareFrom[st]);

  const federalTotal = pos(fedIncomeTax - credits) + seTax + niit + addlMedicare;
  const totalTax = federalTotal + caTotal;

  const base: TaxResult = {
    grossIncome,
    rentalAllowed: currentAllowed + carryUsed,
    rentalSuspended,
    specialAllowance,
    eblDisallowed,
    totalIncome,
    halfSeTax,
    adjustments,
    agi,
    standardTotal,
    itemizedTotal,
    saltPaid,
    saltAllowed,
    saltCapUsed,
    charitableAllowed,
    medicalAllowed,
    deductionUsed,
    deductionKind,
    qbi,
    qbiDeduction,
    qbiWageLimited,
    taxableIncome,
    ordinaryTaxable,
    preferentialIncome,
    fedOrdinaryTax,
    fedGainsTax,
    fed1250Tax,
    fedIncomeTax,
    credits,
    seTax,
    niit,
    netInvestmentIncome,
    addlMedicare,
    federalTotal,
    caAgi,
    caStandard,
    caItemized,
    caItemizedPhaseout,
    caDeduction,
    caDeductionKind,
    caTaxableIncome,
    caBaseTax,
    caMentalHealth,
    caExemptionCredits,
    caTotal,
    caSdi,
    totalTax,
    afterTax: grossIncome - totalTax,
    effectiveRate: grossIncome > 0 ? totalTax / grossIncome * 100 : 0,
    effectiveOnAgi: agi > 0 ? totalTax / agi * 100 : 0,
    fedBracketRate: bracketRate(taxableIncome, fed.ordinary[st]) * 100,
    caBracketRate: bracketRate(caTaxableIncome, ca.brackets[st]) * 100,
    marginalFederal: 0,
    marginalCa: 0,
    marginalCombined: 0,
    marginalGains: 0,
  };

  if (probe) return base;

  /* Measured, not looked up. A thousand more dollars of ordinary income runs
     the whole return again, so every phase-out it crosses shows up in the
     rate — which is the only reason the number is worth printing. */
  const bumpOrdinary = computeTax({ ...s, otherIncome: s.otherIncome + MARGIN_PROBE }, true);
  const bumpGains = computeTax({ ...s, longTermGains: s.longTermGains + MARGIN_PROBE }, true);
  base.marginalFederal = (bumpOrdinary.federalTotal - federalTotal) / MARGIN_PROBE * 100;
  base.marginalCa = (bumpOrdinary.caTotal - caTotal) / MARGIN_PROBE * 100;
  base.marginalCombined = (bumpOrdinary.totalTax - totalTax) / MARGIN_PROBE * 100;
  base.marginalGains = (bumpGains.totalTax - totalTax) / MARGIN_PROBE * 100;
  return base;
}

/* -------------------------------------------------------------- capital gains

   A gain has no tax of its own — it has the tax it adds. This runs the return
   with and without the gain and reports the difference, which is the only
   figure that answers "what will this sale cost me". */

export interface GainsImpact {
  without: TaxResult;
  with: TaxResult;
  fedDelta: number;
  caDelta: number;
  niitDelta: number;
  totalDelta: number;
  /** what share of the gain the tax takes */
  effectiveOnGain: number;
  /** what the next dollar of gain would cost */
  marginalNext: number;
  netProceeds: number;
  gainTotal: number;
}

export function gainsImpact(
  s: TaxState, longTerm: number, shortTerm: number, unrecaptured: number,
): GainsImpact {
  const without = computeTax(
    { ...s, longTermGains: 0, shortTermGains: 0, unrecaptured1250: 0 }, true);
  const withGain = computeTax(
    { ...s, longTermGains: longTerm, shortTermGains: shortTerm, unrecaptured1250: unrecaptured });
  const gainTotal = longTerm + shortTerm + unrecaptured;
  const totalDelta = withGain.totalTax - without.totalTax;
  return {
    without,
    with: withGain,
    fedDelta: withGain.federalTotal - without.federalTotal,
    caDelta: withGain.caTotal - without.caTotal,
    niitDelta: withGain.niit - without.niit,
    totalDelta,
    effectiveOnGain: gainTotal > 0 ? totalDelta / gainTotal * 100 : 0,
    marginalNext: withGain.marginalGains,
    netProceeds: gainTotal - totalDelta,
    gainTotal,
  };
}

/* ------------------------------------------------------------------ verdicts */

export interface RepsComparison {
  off: TaxResult;
  on: TaxResult;
  saving: number;
  suspendedIfOff: number;
}

/** What professional status is actually worth on these numbers. */
export function repsComparison(s: TaxState): RepsComparison {
  const off = computeTax({ ...s, reps: false }, true);
  const on = computeTax({ ...s, reps: true }, true);
  return {
    off, on,
    saving: off.totalTax - on.totalTax,
    suspendedIfOff: off.rentalSuspended,
  };
}

/** Where taxable income sits in a ladder — for the reference tab's marker. */
export function bracketPosition(taxable: number, brackets: Bracket[]): number {
  for (let i = 0; i < brackets.length; i++) if (taxable < brackets[i].upTo) return i;
  return brackets.length - 1;
}
