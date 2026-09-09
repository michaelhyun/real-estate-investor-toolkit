/* Federal and California tax tables.

   Every table carries the date its figures were entered and whether the
   authority had actually published them. A rate table without a provenance
   date is a trap: statutory rates move by act of Congress or ballot measure,
   and the thresholds between them index every year. Anything marked
   'carried' is last year's schedule standing in for one not yet posted —
   the UI says so out loud rather than letting a stale figure pass as current.

   What moved recently and matters here: the One Big Beautiful Bill Act of
   July 2025 made the TCJA rate ladder permanent, raised the standard
   deduction, lifted the SALT cap to $40,000 with a phase-down over $500,000
   of income, took the child credit to $2,200, and made the §199A qualified
   business income deduction and the §461(l) excess business loss limit
   permanent. All of that is reflected below. */

export type FilingStatus = 'single' | 'mfj' | 'mfs' | 'hoh';
export type TaxYear = 2025 | 2026;
/** 'published' — the authority posted it. 'carried' — last posted schedule, standing in. */
export type Provenance = 'published' | 'carried';

export const FILING_STATUSES: { id: FilingStatus; label: string; short: string }[] = [
  { id: 'single', label: 'Single', short: 'Single' },
  { id: 'mfj', label: 'Married filing jointly', short: 'MFJ' },
  { id: 'mfs', label: 'Married filing separately', short: 'MFS' },
  { id: 'hoh', label: 'Head of household', short: 'HoH' },
];

export const TAX_YEARS: TaxYear[] = [2025, 2026];

/** A rate step. `upTo` is the top of the step; the last one is Infinity. */
export interface Bracket { upTo: number; rate: number }

type ByStatus<T> = Record<FilingStatus, T>;

/* ------------------------------------------------------------- bracket math */

/** Tax on `taxable` stepping through the ladder. Brackets are marginal: only
    the slice inside each step pays that step's rate. */
export function bracketTax(taxable: number, brackets: Bracket[]): number {
  if (taxable <= 0) return 0;
  let tax = 0, floor = 0;
  for (const b of brackets) {
    if (taxable <= floor) break;
    tax += (Math.min(taxable, b.upTo) - floor) * b.rate;
    floor = b.upTo;
  }
  return tax;
}

/** The rate the NEXT dollar pays. At a boundary that is the step above. */
export function bracketRate(taxable: number, brackets: Bracket[]): number {
  for (const b of brackets) if (taxable < b.upTo) return b.rate;
  return brackets[brackets.length - 1].rate;
}

/* ------------------------------------------------------------------ federal */

export interface FederalTable {
  year: TaxYear;
  provenance: Provenance;
  verifiedOn: string;
  source: string;
  ordinary: ByStatus<Bracket[]>;
  /** the 0/15/20 ladder long-term gains and qualified dividends ride on */
  capGains: ByStatus<Bracket[]>;
  standardDeduction: ByStatus<number>;
  saltCap: ByStatus<number>;
  /** SALT is cut by 30% of income above here, never below saltFloor */
  saltPhasedownFrom: ByStatus<number>;
  saltFloor: ByStatus<number>;
  /** net investment income tax — 3.8%, and never indexed since 2013 */
  niitFrom: ByStatus<number>;
  addlMedicareFrom: ByStatus<number>;
  ssWageBase: number;
  childCredit: number;
  otherDependentCredit: number;
  creditPhaseoutFrom: ByStatus<number>;
  /** §199A qualified business income */
  qbiThreshold: ByStatus<number>;
  qbiPhaseIn: ByStatus<number>;
  /** §461(l) — business losses above this become a carryforward, not a deduction */
  excessBusinessLoss: ByStatus<number>;
  elective401k: number;
  catchUp401k: number;
  /** the 60-to-63 window added by SECURE 2.0 */
  superCatchUp401k: number;
  iraLimit: number;
  iraCatchUp: number;
  hsaSelf: number;
  hsaFamily: number;
  hsaCatchUp: number;
  /** OBBBA's above-the-line charitable deduction for people who take the standard */
  charitableNonItemizer: ByStatus<number>;
  /** OBBBA's 0.5%-of-AGI floor on itemized charitable gifts */
  charitableAgiFloor: number;
}

const FED_2025: FederalTable = {
  year: 2025,
  provenance: 'published',
  verifiedOn: '2026-09-09',
  source: 'IRS Rev. Proc. 2024-40, as amended by P.L. 119-21 (OBBBA)',
  ordinary: {
    single: [
      { upTo: 11925, rate: 0.10 }, { upTo: 48475, rate: 0.12 }, { upTo: 103350, rate: 0.22 },
      { upTo: 197300, rate: 0.24 }, { upTo: 250525, rate: 0.32 }, { upTo: 626350, rate: 0.35 },
      { upTo: Infinity, rate: 0.37 }],
    mfj: [
      { upTo: 23850, rate: 0.10 }, { upTo: 96950, rate: 0.12 }, { upTo: 206700, rate: 0.22 },
      { upTo: 394600, rate: 0.24 }, { upTo: 501050, rate: 0.32 }, { upTo: 751600, rate: 0.35 },
      { upTo: Infinity, rate: 0.37 }],
    mfs: [
      { upTo: 11925, rate: 0.10 }, { upTo: 48475, rate: 0.12 }, { upTo: 103350, rate: 0.22 },
      { upTo: 197300, rate: 0.24 }, { upTo: 250525, rate: 0.32 }, { upTo: 375800, rate: 0.35 },
      { upTo: Infinity, rate: 0.37 }],
    hoh: [
      { upTo: 17000, rate: 0.10 }, { upTo: 64850, rate: 0.12 }, { upTo: 103350, rate: 0.22 },
      { upTo: 197300, rate: 0.24 }, { upTo: 250500, rate: 0.32 }, { upTo: 626350, rate: 0.35 },
      { upTo: Infinity, rate: 0.37 }],
  },
  capGains: {
    single: [{ upTo: 48350, rate: 0 }, { upTo: 533400, rate: 0.15 }, { upTo: Infinity, rate: 0.20 }],
    mfj: [{ upTo: 96700, rate: 0 }, { upTo: 600050, rate: 0.15 }, { upTo: Infinity, rate: 0.20 }],
    mfs: [{ upTo: 48350, rate: 0 }, { upTo: 300000, rate: 0.15 }, { upTo: Infinity, rate: 0.20 }],
    hoh: [{ upTo: 64750, rate: 0 }, { upTo: 566700, rate: 0.15 }, { upTo: Infinity, rate: 0.20 }],
  },
  standardDeduction: { single: 15750, mfj: 31500, mfs: 15750, hoh: 23625 },
  saltCap: { single: 40000, mfj: 40000, mfs: 20000, hoh: 40000 },
  saltPhasedownFrom: { single: 500000, mfj: 500000, mfs: 250000, hoh: 500000 },
  saltFloor: { single: 10000, mfj: 10000, mfs: 5000, hoh: 10000 },
  niitFrom: { single: 200000, mfj: 250000, mfs: 125000, hoh: 200000 },
  addlMedicareFrom: { single: 200000, mfj: 250000, mfs: 125000, hoh: 200000 },
  ssWageBase: 176100,
  childCredit: 2200,
  otherDependentCredit: 500,
  creditPhaseoutFrom: { single: 200000, mfj: 400000, mfs: 200000, hoh: 200000 },
  qbiThreshold: { single: 197300, mfj: 394600, mfs: 197300, hoh: 197300 },
  qbiPhaseIn: { single: 50000, mfj: 100000, mfs: 50000, hoh: 50000 },
  excessBusinessLoss: { single: 313000, mfj: 626000, mfs: 313000, hoh: 313000 },
  elective401k: 23500,
  catchUp401k: 7500,
  superCatchUp401k: 11250,
  iraLimit: 7000,
  iraCatchUp: 1000,
  hsaSelf: 4300,
  hsaFamily: 8550,
  hsaCatchUp: 1000,
  charitableNonItemizer: { single: 0, mfj: 0, mfs: 0, hoh: 0 },
  charitableAgiFloor: 0,
};

const FED_2026: FederalTable = {
  year: 2026,
  provenance: 'published',
  verifiedOn: '2026-09-09',
  source: 'IRS Rev. Proc. 2025-32',
  ordinary: {
    single: [
      { upTo: 12400, rate: 0.10 }, { upTo: 50400, rate: 0.12 }, { upTo: 105700, rate: 0.22 },
      { upTo: 201775, rate: 0.24 }, { upTo: 256225, rate: 0.32 }, { upTo: 640600, rate: 0.35 },
      { upTo: Infinity, rate: 0.37 }],
    mfj: [
      { upTo: 24800, rate: 0.10 }, { upTo: 100800, rate: 0.12 }, { upTo: 211400, rate: 0.22 },
      { upTo: 403550, rate: 0.24 }, { upTo: 512450, rate: 0.32 }, { upTo: 768700, rate: 0.35 },
      { upTo: Infinity, rate: 0.37 }],
    mfs: [
      { upTo: 12400, rate: 0.10 }, { upTo: 50400, rate: 0.12 }, { upTo: 105700, rate: 0.22 },
      { upTo: 201775, rate: 0.24 }, { upTo: 256225, rate: 0.32 }, { upTo: 384350, rate: 0.35 },
      { upTo: Infinity, rate: 0.37 }],
    hoh: [
      { upTo: 17700, rate: 0.10 }, { upTo: 67450, rate: 0.12 }, { upTo: 105700, rate: 0.22 },
      { upTo: 201750, rate: 0.24 }, { upTo: 256200, rate: 0.32 }, { upTo: 640600, rate: 0.35 },
      { upTo: Infinity, rate: 0.37 }],
  },
  capGains: {
    single: [{ upTo: 49450, rate: 0 }, { upTo: 545500, rate: 0.15 }, { upTo: Infinity, rate: 0.20 }],
    mfj: [{ upTo: 98900, rate: 0 }, { upTo: 613700, rate: 0.15 }, { upTo: Infinity, rate: 0.20 }],
    mfs: [{ upTo: 49450, rate: 0 }, { upTo: 306850, rate: 0.15 }, { upTo: Infinity, rate: 0.20 }],
    hoh: [{ upTo: 66200, rate: 0 }, { upTo: 579600, rate: 0.15 }, { upTo: Infinity, rate: 0.20 }],
  },
  standardDeduction: { single: 16100, mfj: 32200, mfs: 16100, hoh: 24150 },
  saltCap: { single: 40400, mfj: 40400, mfs: 20200, hoh: 40400 },
  saltPhasedownFrom: { single: 505000, mfj: 505000, mfs: 252500, hoh: 505000 },
  saltFloor: { single: 10000, mfj: 10000, mfs: 5000, hoh: 10000 },
  niitFrom: { single: 200000, mfj: 250000, mfs: 125000, hoh: 200000 },
  addlMedicareFrom: { single: 200000, mfj: 250000, mfs: 125000, hoh: 200000 },
  ssWageBase: 184500,
  childCredit: 2200,
  otherDependentCredit: 500,
  creditPhaseoutFrom: { single: 200000, mfj: 400000, mfs: 200000, hoh: 200000 },
  qbiThreshold: { single: 201775, mfj: 403550, mfs: 201775, hoh: 201775 },
  /* OBBBA widened the phase-in window from 50k/100k starting in 2026, which
     softens the cliff for anyone just over the threshold */
  qbiPhaseIn: { single: 75000, mfj: 150000, mfs: 75000, hoh: 75000 },
  excessBusinessLoss: { single: 320000, mfj: 640000, mfs: 320000, hoh: 320000 },
  elective401k: 24500,
  catchUp401k: 8000,
  superCatchUp401k: 11250,
  iraLimit: 7500,
  iraCatchUp: 1100,
  hsaSelf: 4400,
  hsaFamily: 8750,
  hsaCatchUp: 1000,
  charitableNonItemizer: { single: 1000, mfj: 2000, mfs: 1000, hoh: 1000 },
  charitableAgiFloor: 0.005,
};

/* --------------------------------------------------------------- california */

export interface CaTable {
  year: TaxYear;
  provenance: Provenance;
  verifiedOn: string;
  source: string;
  /** the schedule year these thresholds actually come from */
  scheduleYear: number;
  brackets: ByStatus<Bracket[]>;
  standardDeduction: ByStatus<number>;
  personalExemption: number;
  dependentExemption: number;
  /** exemption credits shrink by $6 per $2,500 of AGI above here */
  exemptionPhaseoutFrom: ByStatus<number>;
  /** itemized deductions shrink by 6% of AGI above here, capped at 80% of them */
  itemizedPhaseoutFrom: ByStatus<number>;
  /** Prop 63 mental health services tax, 1% over $1M, never indexed */
  mentalHealthFrom: number;
  mentalHealthRate: number;
  /** state disability insurance — a payroll tax on wages, shown apart from income tax */
  sdiRate: number;
}

/* The rate ladder itself is statute and does not move: 1 / 2 / 4 / 6 / 8 /
   9.3 / 10.3 / 11.3 / 12.3, plus the Prop 63 point over $1M. Only the
   thresholds index, at roughly 3% a year. Above about $70k of taxable income
   every threshold below is a fixed dollar amount, so indexing drift changes a
   six-figure filer's bill by a few hundred dollars, not a few thousand. */
const CA_SINGLE: Bracket[] = [
  { upTo: 10756, rate: 0.01 }, { upTo: 25499, rate: 0.02 }, { upTo: 40245, rate: 0.04 },
  { upTo: 55866, rate: 0.06 }, { upTo: 70606, rate: 0.08 }, { upTo: 360659, rate: 0.093 },
  { upTo: 432787, rate: 0.103 }, { upTo: 721314, rate: 0.113 }, { upTo: Infinity, rate: 0.123 },
];
const CA_MFJ: Bracket[] = CA_SINGLE.map(b => ({ ...b, upTo: b.upTo * 2 }));
const CA_HOH: Bracket[] = [
  { upTo: 21527, rate: 0.01 }, { upTo: 51000, rate: 0.02 }, { upTo: 65744, rate: 0.04 },
  { upTo: 81364, rate: 0.06 }, { upTo: 96107, rate: 0.08 }, { upTo: 490493, rate: 0.093 },
  { upTo: 588593, rate: 0.103 }, { upTo: 980987, rate: 0.113 }, { upTo: Infinity, rate: 0.123 },
];

const caTable = (year: TaxYear, provenance: Provenance): CaTable => ({
  year,
  provenance,
  verifiedOn: '2026-09-09',
  source: 'California FTB rate schedules — confirm at ftb.ca.gov before filing',
  scheduleYear: 2024,
  brackets: { single: CA_SINGLE, mfj: CA_MFJ, mfs: CA_SINGLE, hoh: CA_HOH },
  standardDeduction: { single: 5540, mfj: 11080, mfs: 5540, hoh: 11080 },
  personalExemption: 149,
  dependentExemption: 461,
  exemptionPhaseoutFrom: { single: 244857, mfj: 489719, mfs: 244857, hoh: 367291 },
  itemizedPhaseoutFrom: { single: 244857, mfj: 489719, mfs: 244857, hoh: 367291 },
  mentalHealthFrom: 1000000,
  mentalHealthRate: 0.01,
  sdiRate: 0.012,
});

/* ------------------------------------------------------------------ bundles */

export interface YearTables { year: TaxYear; fed: FederalTable; ca: CaTable }

const BUNDLES: Record<TaxYear, YearTables> = {
  2025: { year: 2025, fed: FED_2025, ca: caTable(2025, 'carried') },
  2026: { year: 2026, fed: FED_2026, ca: caTable(2026, 'carried') },
};

export function tablesFor(year: TaxYear): YearTables {
  return BUNDLES[year] ?? BUNDLES[2026];
}
