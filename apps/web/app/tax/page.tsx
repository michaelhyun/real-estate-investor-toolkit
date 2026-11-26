'use client';

/* Income Tax Calculator, federal and California. Built from components/calc.

   One page: what you type on the left, what it costs on the right. The tool
   exists to answer three questions a bracket table cannot:

   · what a rental loss is actually worth to you this year, which depends
     entirely on whether you qualify as a real estate professional;
   · what a sale will cost, which depends on where the gain lands once it is
     stacked on everything else you earn;
   · what your NEXT dollar pays, which is not the bracket you are in.

   Every row's explanation sits behind its info icon, so the columns stay short.

   Everything stays on this device. Tax inputs are the most sensitive numbers
   in the toolkit, so unlike saved deals they are never synced to an account. */

import { useEffect, useMemo, useState } from 'react';
import {
  defaultTaxState, computeTax, gainsImpact, repsComparison, tablesFor,
  FILING_STATUSES, TAX_YEARS,
  money, money0, pct,
  type TaxState, type FilingStatus, type TaxYear, type Bracket,
} from '@reit/core';
import { loadJSON, saveJSON } from '../../components/ui';
import { Panel, Field, Line, SectionLabel, NumberField, Segmented, Stepper, Stat, Note, Toggle, InfoTip } from '../../components/calc';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Icon } from '../../components/Icon';
import { PaymentPie } from '../../components/PaymentPie';
import { cn } from '@/lib/utils';

const DRAFT_KEY = 'taxCalc.draft.v1';

/* Ring colours, checked for colour-blind separation between every pair. */
const TAX_PIE = { fed: '#3c5bf6', ca: '#b8651a', keep: '#1f9d6b' };
type SliceKey = keyof typeof TAX_PIE;

/* Where each tip's "Learn more" goes: the IRS, FTB or EDD page on that topic. */
const IRS = 'https://www.irs.gov', FTB = 'https://www.ftb.ca.gov/file/personal';
const U = {
  filing: `${IRS}/publications/p501`,
  ctc: `${IRS}/credits-deductions/individuals/child-tax-credit`,
  payroll: `${IRS}/taxtopics/tc751`,
  schedC: `${IRS}/forms-pubs/about-schedule-c-form-1040`,
  seTax: `${IRS}/taxtopics/tc554`,
  rental: `${IRS}/taxtopics/tc414`,
  passive: `${IRS}/taxtopics/tc425`,
  reps: `${IRS}/publications/p925`,
  f8582: `${IRS}/forms-pubs/about-form-8582`,
  qbi: `${IRS}/newsroom/qualified-business-income-deduction`,
  ebl: `${IRS}/newsroom/excess-business-losses`,
  interest: `${IRS}/taxtopics/tc403`,
  dividends: `${IRS}/taxtopics/tc404`,
  gains: `${IRS}/taxtopics/tc409`,
  home: `${IRS}/taxtopics/tc701`,
  x1031: `${IRS}/businesses/small-businesses-self-employed/like-kind-exchanges-real-estate-tax-tips`,
  k401: `${IRS}/retirement-plans/plan-participant-employee/retirement-topics-401k-and-profit-sharing-plan-contribution-limits`,
  solo401k: `${IRS}/retirement-plans/one-participant-401k-plans`,
  hsa: `${IRS}/publications/p969`,
  ira: `${IRS}/retirement-plans/ira-deduction-limits`,
  iraLimits: `${IRS}/retirement-plans/plan-participant-employee/retirement-topics-ira-contribution-limits`,
  seHealth: `${IRS}/forms-pubs/about-form-7206`,
  studentLoan: `${IRS}/taxtopics/tc456`,
  itemize: `${IRS}/taxtopics/tc501`,
  std: `${IRS}/taxtopics/tc551`,
  mortgage: `${IRS}/publications/p936`,
  salt: `${IRS}/taxtopics/tc503`,
  charity: `${IRS}/taxtopics/tc506`,
  medical: `${IRS}/taxtopics/tc502`,
  intExp: `${IRS}/taxtopics/tc505`,
  niit: `${IRS}/individuals/net-investment-income-tax`,
  addlMed: `${IRS}/businesses/small-businesses-self-employed/questions-and-answers-for-the-additional-medicare-tax`,
  brackets: `${IRS}/filing/federal-income-tax-rates-and-brackets`,
  caRates: `${FTB}/tax-calculator-tables-rates.asp`,
  caDed: `${FTB}/deductions/index.html`,
  caCredits: `${FTB}/credits/index.html`,
  caGains: `${FTB}/income-types/capital-gains-and-losses.html`,
  caPassive: 'https://www.ftb.ca.gov/forms/2024/2024-3801-instructions.html',
  sdi: 'https://edd.ca.gov/en/payroll_taxes/rates_and_withholding/',
};

type ModalId = 'reps' | 'sale' | 'brackets' | 'limits';

/* Panels that start folded. Their headline figure stays in the title bar. */
const SHUT_BY_DEFAULT: Record<string, boolean> = {
  portfolio: true, adjust: true, itemized: true, qbi: true,
};

function normalize(d: any): TaxState {
  const base = defaultTaxState();
  if (!d || typeof d !== 'object') return base;
  const year = TAX_YEARS.includes(d.year) ? d.year : base.year;
  const status = FILING_STATUSES.some(f => f.id === d.status) ? d.status : base.status;
  const out: any = { ...base, ...d, year, status };
  for (const k of Object.keys(base)) {
    const v = (base as any)[k];
    if (typeof v === 'number' && !isFinite(out[k])) out[k] = v;
  }
  return out as TaxState;
}

/* ------------------------------------------------------------------ helpers */

/** Accounting style: a subtraction reads in parentheses, the way it does on paper. */
const less = (n: number) => n === 0 ? '—' : `(${money0(n)})`;
const eq = (v: number) => `= ${money0(v)}`;

const rateOf = (b: Bracket) => pct(b.rate * 100, b.rate * 100 % 1 ? 1 : 0);
/** Where an income stands on a ladder: its step, and that step's edges. */
function standing(brackets: Bracket[], taxable: number) {
  const i = Math.max(0, brackets.findIndex(b => taxable < b.upTo));
  const from = i === 0 ? 0 : brackets[i - 1].upTo, to = brackets[i].upTo;
  return { i, from, to, above: Math.max(0, taxable - from), room: to - taxable, next: brackets[i + 1] };
}

/** A ladder as a table, with the step you are standing on marked. Not a chart:
    the reading task is looking up one row, and a table does that better than
    any bar. */
function Ladder({ brackets, taxable, label, info, more }: {
  brackets: Bracket[]; taxable: number; label: string; info?: React.ReactNode; more?: string;
}) {
  const here = standing(brackets, taxable).i;
  const th = 'px-3 py-1.5 text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground';
  return (
    <section className="mb-3 overflow-hidden rounded-lg border border-line">
      <h3 className="border-b border-line bg-page px-3 py-2 text-sm font-bold text-ink-strong">
        {label}{info ? <InfoTip more={more}>{info}</InfoTip> : null}
      </h3>
      <table className="w-full text-sm tabular-nums">
        <thead>
          <tr className="border-b border-line/60">
            <th scope="col" className={cn(th, 'text-left')}>Rate</th>
            <th scope="col" className={cn(th, 'text-right')}>From</th>
            <th scope="col" className={cn(th, 'text-right')}>To</th>
          </tr>
        </thead>
        <tbody>
          {brackets.map((b, i) => {
            const from = i === 0 ? 0 : brackets[i - 1].upTo;
            const on = i === here;
            return (
              <tr key={i} className={cn('border-b border-line/60 last:border-b-0', on ? 'bg-primary-tint font-bold text-ink-strong shadow-[inset_3px_0_0_var(--primary)]' : 'text-[#3a4352]')}>
                <th scope="row" className="whitespace-nowrap px-3 py-1.5 text-left font-bold text-ink-strong">
                  <span className="inline-block w-12">{rateOf(b)}</span>
                  {on && <span className="rounded-full bg-primary px-1.5 py-px text-[0.6875rem] font-bold uppercase tracking-wide text-primary-foreground">You</span>}
                </th>
                <td className="whitespace-nowrap px-3 py-1.5 text-right">{money0(from)}</td>
                <td className="whitespace-nowrap px-3 py-1.5 text-right">{isFinite(b.upTo) ? money0(b.upTo) : 'and up'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

/** One ladder's answer to "where am I in my bracket": the rate, a bar of the
    position, and the two distances: above the bottom, and to the next step. */
function BracketSpot({ brackets, taxable, label }: { brackets: Bracket[]; taxable: number; label: string }) {
  const p = standing(brackets, taxable);
  const open = !isFinite(p.to);
  const at = open ? 100 : Math.min(100, Math.max(0, p.above / (p.to - p.from) * 100));
  return (
    <div className="min-w-0 rounded-lg bg-page p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">{label}</span>
        <span className="text-lg font-extrabold leading-none tabular-nums text-ink-strong">{rateOf(brackets[p.i])}</span>
      </div>
      <div aria-hidden className="relative mb-2 mt-3 h-1.5 rounded-full bg-line">
        <span className="absolute inset-y-0 left-0 rounded-full bg-primary" style={{ width: `${at}%` }} />
        {!open && <span className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-primary" style={{ left: `${at}%` }} />}
      </div>
      <div className="flex justify-between gap-2 text-[0.8125rem] leading-snug text-muted-foreground">
        <span><b className="tabular-nums text-ink-strong">{money0(p.above)}</b> above bottom</span>
        <span className="text-right">{p.next ? <><b className="tabular-nums text-ink-strong">{money0(p.room)}</b> to {rateOf(p.next)}</> : 'top bracket'}</span>
      </div>
    </div>
  );
}

/* ================================================================== the page */

export default function TaxPage() {
  const [s, setS] = useState<TaxState>(defaultTaxState);
  const [shut, setShut] = useState<Record<string, boolean>>({});
  const [hydrated, setHydrated] = useState(false);
  /* reference material and what-ifs open as popups, off the page */
  const [modal, setModal] = useState<ModalId | null>(null);
  /* the ring slice being pointed at, shared with the cards beside the ring */
  const [slice, setSliceRaw] = useState<string | null>(null);
  const setSlice = (k: string | null) => setSliceRaw(k);
  /* the sale panel models a sale that is not in your base return */
  const [gLong, setGLong] = useState(500000);
  const [gShort, setGShort] = useState(0);
  const [gRecapture, setGRecapture] = useState(0);
  const [gExclusion, setGExclusion] = useState(0);

  const set = <K extends keyof TaxState>(k: K, v: TaxState[K]) => setS(p => ({ ...p, [k]: v }));

  useEffect(() => {
    const d = loadJSON<any>(DRAFT_KEY);
    if (d) setS(normalize(d));
    setHydrated(true);
  }, []);
  useEffect(() => { if (hydrated) saveJSON(DRAFT_KEY, s); }, [s, hydrated]);

  const isOpen = (id: string) => !(shut[id] ?? SHUT_BY_DEFAULT[id] ?? false);
  const fold = (id: string) => ({ open: isOpen(id), onOpenChange: (o: boolean) => setShut(p => ({ ...p, [id]: !o })) });

  /* ---------- derived ---------- */
  const { fed, ca } = tablesFor(s.year);
  const r = useMemo(() => computeTax(s), [s]);
  const reps = useMemo(() => repsComparison(s), [s]);
  /* the sale is layered on the base return, never mixed into it */
  const sale = useMemo(
    () => gainsImpact(s, Math.max(0, gLong - gExclusion), gShort, gRecapture),
    [s, gLong, gShort, gRecapture, gExclusion]);

  const st = s.status;
  const statusLabel = FILING_STATUSES.find(f => f.id === st)!;
  const earned = s.wages + s.spouseWages + s.seNetProfit;
  const portfolio = s.interest + s.ordinaryDividends + s.shortTermGains +
    s.longTermGains + s.unrecaptured1250 + s.otherIncome;
  const slices: { key: SliceKey; label: string; value: number }[] = [
    { key: 'fed', label: 'Federal tax', value: r.federalTotal },
    { key: 'ca', label: 'California tax', value: r.caTotal },
    { key: 'keep', label: 'You keep', value: Math.max(0, r.afterTax) },
  ];
  const share = (n: number) => pct(r.grossIncome > 0 ? n / r.grossIncome * 100 : 0);

  /* Screening context. A benchmark, not a rule: it says whether the measured
     marginal rate is what a bracket table would have told you. */
  const bracketSum = r.fedBracketRate + r.caBracketRate;
  const marginalNote = r.marginalCombined > bracketSum + 1
    ? { tone: 'text-warning', text: `above your ${pct(bracketSum)} brackets: a phase-out` }
    : r.marginalCombined < bracketSum - 1
      ? { tone: 'text-success', text: `below your ${pct(bracketSum)} brackets: a deduction is still growing` }
      : { tone: 'text-success', text: 'matches your brackets' };

  const reset = () => { if (confirm('Clear every figure and start over?')) setS(defaultTaxState()); };

  /* small shorthands so a row reads as one line */
  const $ = (value: number, onChange: (n: number) => void) => <NumberField value={value} onChange={onChange} />;
  const f = <K extends keyof TaxState>(k: K) => $(s[k] as number, v => set(k, v as TaxState[K]));
  const count = (k: 'childrenUnder17' | 'otherDependents') => (
    <div className="flex items-center gap-1.5">
      <Stepper value={s[k]} onChange={v => set(k, v)} step={1} min={0} max={8} />
      <NumberField value={s[k]} onChange={v => set(k, Math.max(0, Math.min(8, Math.round(v))))} fmt="raw" step={1} min={0} max={8} />
    </div>
  );

  /* professional status popup: one figure, without and with the election */
  const cmpTh = 'w-28 py-2 pl-3 text-right text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground';
  const cmpRow = (label: string, off: number, on: number) => (
    <tr key={label} className="border-b border-line/60 last:border-b-0">
      <th scope="row" className="py-2 pr-3 text-left font-normal text-[#3a4352]">{label}</th>
      <td className="py-2 pl-3 text-right text-muted-foreground">{money0(off)}</td>
      <td className={cn('py-2 pl-3 text-right font-bold', Math.round(on) === Math.round(off) ? 'text-muted-foreground' : 'text-ink-strong')}>{money0(on)}</td>
    </tr>
  );
  /* sale popup */
  const saltLost = Math.max(0, sale.without.saltAllowed - sale.with.saltAllowed);
  /* the federal share split by what caused it; the rows add up to it exactly */
  const dGains = (sale.with.fedGainsTax + sale.with.fed1250Tax) - (sale.without.fedGainsTax + sale.without.fed1250Tax);
  const dOrdinary = sale.with.fedOrdinaryTax - sale.without.fedOrdinaryTax;
  const dOther = sale.fedDelta - dGains - dOrdinary - sale.niitDelta;
  const cgRate = (r: { taxableIncome: number }) => rateOf(fed.capGains[st][standing(fed.capGains[st], r.taxableIncome).i]);
  /* a ladder the sale climbed: the new rate, and how far past its line */
  const bump = (who: string, brackets: Bracket[], before: number, after: number) => {
    const a = standing(brackets, before), b = standing(brackets, after);
    return b.i > a.i ? [{ who, rate: rateOf(brackets[b.i]), over: after - b.from, line: b.from }] : [];
  };
  const bumps = [
    ...bump('federal gains', fed.capGains[st], sale.without.taxableIncome, sale.with.taxableIncome),
    ...bump('California', ca.brackets[st], sale.without.caTaxableIncome, sale.with.caTaxableIncome),
  ];
  const saleRows: { label: string; v: number; info: React.ReactNode; more: string }[] = [
    { label: 'Capital gains tax', v: dGains,
      info: 'Long-term gains pay 0, 15 or 20%. The rate is set by your total taxable income with the gain stacked on top. Depreciation recapture pays up to 25%.', more: U.gains },
    { label: '3.8% investment surtax', v: sale.niitDelta,
      info: <>The net investment income tax: 3.8% on investment income, this gain included, once your income passes {money0(fed.niitFrom[st])}.</>, more: U.niit },
    { label: 'Tax on other income', v: dOrdinary,
      info: <>The gain raises your income, which shrinks deductions tied to income{saltLost > 0 ? <> (here, {money0(saltLost)} less state and local tax deduction)</> : null}. Your other income then pays more tax. A short-term gain is taxed here too.</>, more: U.salt },
    { label: 'Other effects', v: dOther,
      info: 'Credits that shrink as income rises, mainly the child tax credit. The gain pushes your income into their phase-out.', more: U.ctc },
  ];

  /* a popup; a plain function, not a component, so typing in one keeps focus */
  const modalEl = (id: ModalId, title: string, desc: string, width: string, body: React.ReactNode) => (
    <Dialog open={modal === id} onOpenChange={o => setModal(o ? id : null)}>
      <DialogContent className={width}>
        <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{desc}</DialogDescription></DialogHeader>
        <div className="min-w-0">{body}</div>
      </DialogContent>
    </Dialog>
  );

  /* ================================================================= render */
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[1.75rem] font-extrabold leading-tight tracking-[-0.015em] text-ink-strong">Income Tax Calculator</h1>
          <p className="text-[0.9375rem] text-muted-foreground">Federal and California, {s.year}. Everything stays on this device.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <Segmented aria-label="Tax year" options={TAX_YEARS.map(y => ({ u: String(y), label: String(y) }))}
            value={String(s.year)} onChange={u => set('year', Number(u) as TaxYear)} />
          <Button variant="ghost" onClick={reset}>Reset</Button>
        </div>
      </div>

      <div className="grid items-start gap-4 min-[1100px]:grid-cols-[360px_minmax(0,1fr)]">
        {/* ============================================ LEFT: INPUTS */}
        <div className="flex min-w-0 flex-col gap-3">
          <Panel dense title="Filing" tag={`${s.year} · ${statusLabel.short}`} {...fold('filing')}>
            <Field label="Filing status" info="Sets your brackets, standard deduction and phase-outs. Filing separately usually forfeits the rental loss allowance." more={U.filing}>
              <NativeSelect size="sm" className="w-44 shrink-0" value={st} aria-label="Filing status"
                onChange={ev => set('status', ev.target.value as FilingStatus)}>
                {FILING_STATUSES.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
              </NativeSelect>
            </Field>
            <Field label="Children under 17" hint={`${eq(s.childrenUnder17 * fed.childCredit)} credit`}
              info={`${money0(fed.childCredit)} each, phasing out above ${money0(fed.creditPhaseoutFrom[st])} of income.`} more={U.ctc}>
              {count('childrenUnder17')}</Field>
            <Field label="Other dependents" hint={`${eq(s.otherDependents * fed.otherDependentCredit)} credit`}
              info={`${money0(fed.otherDependentCredit)} each for older children or parents you support.`} more={U.ctc}>
              {count('otherDependents')}</Field>
          </Panel>

          <Panel dense title="Earned income" tag={money0(earned)} {...fold('earned')}>
            <Field label="Your wages" hint="gross, before 401(k)"
              info={<>Enter <b>gross</b> pay, before your 401(k). The deferral comes off under Adjustments.</>} more={U.payroll}>
              {f('wages')}</Field>
            <Field label="Spouse wages" hint="gross, before 401(k)" info="Gross, before 401(k). Has its own Social Security wage base." more={U.payroll}>
              {f('spouseWages')}</Field>
            <Field label="Self-employment net profit" info="Schedule C profit: commissions after business expenses." more={U.schedC}>
              {f('seNetProfit')}</Field>
            <Line total label="Self-employment tax" value={money0(r.seTax)}
              hint={s.seNetProfit > 0 ? `${pct(r.seTax / s.seNetProfit * 100)} of profit` : undefined}
              info={<>15.3% up to {money0(fed.ssWageBase)} of earnings, 2.9% above. Half is deductible.</>} more={U.seTax} />
          </Panel>

          <Panel dense title="Real estate" tag={`${money(s.rentalNet)} · ${money0(r.rentalAllowed)} used`} {...fold('realestate')}>
            <Field label="Net rental income or loss" hint="a loss is a negative number"
              info="After depreciation. Enter a loss as a negative number." more={U.rental}>
              {f('rentalNet')}</Field>
            <Field label="Real estate professional"
              info={<>750+ hours in real property work and more than half your working time. Makes rental losses <b>non-passive</b>. Federal only: California ignores it.</>} more={U.reps}>
              <Toggle checked={s.reps} onChange={v => set('reps', v)} /></Field>
            <Field label="Prior suspended losses" info="Passive losses carried in from earlier years. They release against passive income or on sale." more={U.f8582}>
              {f('passiveCarryforward')}</Field>
            <Field label="Rentals qualify for §199A" info="On if the rentals are a trade or business, or meet the 250-hour safe harbor." more={U.qbi}>
              <Toggle checked={s.rentalQualifiesQbi} onChange={v => set('rentalQualifiesQbi', v)} /></Field>
            <Line label="Special allowance available" value={money0(r.specialAllowance)}
              info={<>Up to $25,000 of rental loss, phased out between $100k and $150k of income.{r.specialAllowance > 0 ? '' : ' Yours is fully phased out.'}</>} more={U.passive} />
            <Line total label="Loss deducted this year" value={money0(r.rentalAllowed)} tone={r.rentalSuspended > 0 ? 'warn' : undefined}
              hint={r.rentalSuspended > 0 ? `${money0(r.rentalSuspended)} suspended` : s.rentalNet < 0 ? 'all of it' : undefined}
              info={r.rentalSuspended > 0 ? <><b>{money0(r.rentalSuspended)} suspended</b> and carried forward, not lost.</> : 'All of it is deductible this year.'} more={U.passive} />
            {r.eblDisallowed > 0 && (
              <Line label="Blocked by the excess business loss cap" value={money0(r.eblDisallowed)} tone="warn"
                info={<>A business loss over {money0(fed.excessBusinessLoss[st])} carries forward instead.</>} more={U.ebl} />
            )}
          </Panel>

          <Panel dense title="Portfolio income" tag={money0(portfolio)} {...fold('portfolio')}>
            <Field label="Interest" info={<>Ordinary rates. Over {money0(fed.niitFrom[st])} of income it also pays the 3.8% surtax.</>} more={U.interest}>
              {f('interest')}</Field>
            <Field label="Ordinary dividends" info="Form 1099-DIV box 1a. Includes the qualified part below." more={U.dividends}>
              {f('ordinaryDividends')}</Field>
            <Field label="Of which qualified" className="pl-3" info="Box 1b. Taxed at the 0/15/20% gains rates." more={U.dividends}>
              {f('qualifiedDividends')}</Field>
            <Field label="Short-term gains" info="Held a year or less. Taxed as ordinary income." more={U.gains}>
              {f('shortTermGains')}</Field>
            <Field label="Long-term gains" info="Held over a year. To test one sale, use Sell an asset instead." more={U.gains}>
              {f('longTermGains')}</Field>
            <Field label="Depreciation recapture" info="Unrecaptured §1250 gain from a rental sale. Taxed at up to 25%." more={U.gains}>
              {f('unrecaptured1250')}</Field>
            <Field label="Other income" info="Flip profit, K-1 income, anything else at ordinary rates.">
              {f('otherIncome')}</Field>
          </Panel>

          <Panel dense title="Adjustments" tag={money0(r.adjustments)} {...fold('adjust')}>
            <Field label="401(k) elective deferral"
              info={`${money0(fed.elective401k)} limit for ${s.year}. Catch-up: ${money0(fed.catchUp401k)} at 50, ${money0(fed.superCatchUp401k)} at 60 to 63.`} more={U.k401}>
              {f('deferral401k')}</Field>
            <Field label="Employer / solo 401(k) or SEP" info="The employer side of a solo 401(k) or SEP. Often your biggest lever on Schedule C income." more={U.solo401k}>
              {f('employer401k')}</Field>
            <Field label="HSA contribution" info={`${money0(fed.hsaSelf)} self, ${money0(fed.hsaFamily)} family. California does not allow it.`} more={U.hsa}>
              {f('hsa')}</Field>
            <Field label="Traditional IRA" info={`${money0(fed.iraLimit)} limit. If a workplace plan covers you, deductible only under an income limit.`} more={U.ira}>
              {f('tradIra')}</Field>
            <Field label="Self-employed health insurance" info="Premiums for you and family, up to your net self-employment profit." more={U.seHealth}>
              {f('seHealthIns')}</Field>
            <Field label="Other adjustments" info="Student loan interest, educator expenses and similar." more={U.studentLoan}>
              {f('otherAdjust')}</Field>
            <Line label="Half of self-employment tax" value={money0(r.halfSeTax)} info="Automatic: the employer-equivalent half." more={U.seTax} />
            <Line total label="Total adjustments" value={money0(r.adjustments)}
              info={<>Taken before AGI, so they also lower every threshold tied to it. {money0(r.totalIncome)} becomes {money0(r.agi)}.</>} />
          </Panel>

          <Panel dense title="Deductions" tag={`${money0(r.deductionUsed)} · ${r.deductionKind}`} {...fold('itemized')}>
            <Field label="Mortgage interest" info="On up to $750,000 of home debt. Rental interest goes in the rental figure." more={U.mortgage}>
              {f('mortgageInterest')}</Field>
            <Field label="Property tax" info="Your residence only. Rental property tax goes in the rental figure." more={U.salt}>
              {f('propertyTax')}</Field>
            <Field label="Charitable gifts" hint={r.charitableAllowed !== s.charitable ? `${money0(r.charitableAllowed)} counts` : undefined}
              info={fed.charitableAgiFloor > 0 ? `From ${s.year}, the first ${pct(fed.charitableAgiFloor * 100, 1)} of AGI (${money0(fed.charitableAgiFloor * r.agi)}) does not count.` : 'Cash gifts to public charities, up to 60% of AGI.'} more={U.charity}>
              {f('charitable')}</Field>
            <Field label="Medical expenses" hint={s.medical > 0 ? `${money0(r.medicalAllowed)} counts` : undefined}
              info={<>Only the part above 7.5% of AGI ({money0(0.075 * r.agi)}) counts.</>} more={U.medical}>
              {f('medical')}</Field>
            <Field label="Other itemized" info="Investment interest, disaster casualty losses." more={U.intExp}>
              {f('otherItemized')}</Field>
            <SectionLabel>State and local tax</SectionLabel>
            <Line label="Paid" value={money0(r.saltPaid)}
              info={<>{money0(s.propertyTax)} property tax plus {money0(r.caTotal)} California income tax.</>} more={U.salt} />
            <Line label="Your cap this year" value={money0(r.saltCapUsed)}
              info={<>{money0(fed.saltCap[st])} cap, shrinking 30¢ per dollar of income over {money0(fed.saltPhasedownFrom[st])}, down to {money0(fed.saltFloor[st])}.</>} more={U.salt} />
            <Line label="Deductible" value={money0(r.saltAllowed)} tone={r.saltPaid > r.saltAllowed ? 'warn' : undefined}
              hint={r.saltPaid > r.saltAllowed ? `${money0(r.saltPaid - r.saltAllowed)} gets no deduction` : 'all of it counts'} />
            <SectionLabel>Which deduction wins</SectionLabel>
            <Line label="Standard" value={money0(r.standardTotal)} strong={r.deductionKind === 'standard'}
              info={fed.charitableNonItemizer[st] > 0 ? `${money0(fed.standardDeduction[st])} plus up to ${money0(fed.charitableNonItemizer[st])} of charitable gifts.` : 'A flat amount, no receipts.'} more={U.std} />
            <Line label="Itemized" value={money0(r.itemizedTotal)} strong={r.deductionKind === 'itemized'}
              info="Mortgage interest, capped state and local tax, charity, medical." more={U.itemize} />
            <Line total label={`You take the ${r.deductionKind}`} value={money0(r.deductionUsed)}
              hint={`${money0(Math.abs(r.itemizedTotal - r.standardTotal))} better than the alternative`}
              info="You get whichever is larger, automatically." more={U.itemize} />
          </Panel>

          <Panel dense title="Business income deduction" tag={money0(r.qbiDeduction)} {...fold('qbi')}>
            <Line label="Qualified business income" value={money0(r.qbi)}
              info="Schedule C profit less its share of SE tax, health insurance and retirement deductions." more={U.qbi} />
            <Field label="W-2 wages your business paid"
              info={`Over ${money0(fed.qbiThreshold[st])} of taxable income, the deduction is capped at half of this.`} more={U.qbi}>
              {f('qbiWages')}</Field>
            <Field label="Business property basis" info="Original cost of depreciable property. Feeds the other cap: 25% of wages plus 2.5% of this." more={U.qbi}>
              {f('qbiProperty')}</Field>
            <Line total label="§199A deduction" value={money0(r.qbiDeduction)} tone={r.qbiWageLimited ? 'warn' : undefined}
              hint={r.qbiWageLimited ? 'cut by the wage limit' : r.qbi > 0 ? `${pct(r.qbiDeduction / r.qbi * 100)} of business income` : undefined}
              info={<>20% of business income. Real estate brokerage is <b>not</b> a restricted service trade. {r.qbiWageLimited ? 'Yours is cut by the wage limit. ' : ''}California does not allow it.</>} more={U.qbi} />
          </Panel>
        </div>

        {/* ============================================ RIGHT: RESULTS */}
        <div className="flex min-w-0 flex-col gap-4">
          {/* where the income goes: a ring, and a card per slice that lights up with it */}
          <div className="grid gap-3 md:grid-cols-[auto_minmax(0,1fr)]">
            <div className="flex min-w-0 flex-col rounded-lg bg-card p-4 shadow-tight">
              <div className="mb-3 text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">Where your {money0(r.grossIncome)} goes</div>
              <div className="flex flex-1 items-center justify-center md:px-2">
                <PaymentPie soft list={false} size={184} colors={TAX_PIE} centerLabel="Total tax" centerNote={`${pct(r.effectiveRate)} of income`}
                  title="Total tax" total={r.totalTax} parts={slices} active={slice} onActive={setSlice} />
              </div>
            </div>
            <div className="grid min-w-0 grid-cols-6 gap-3">
              {slices.map(p => {
                const on = slice === p.key;
                return (
                  <div key={p.key} onPointerEnter={() => setSlice(p.key)} onPointerLeave={() => setSlice(null)}
                    style={on ? { boxShadow: `inset 0 0 0 2px ${TAX_PIE[p.key]}, var(--shadow-tight)` } : undefined}
                    className={cn('flex min-w-0 flex-col gap-1 rounded-lg bg-card p-4 shadow-tight transition-[opacity,box-shadow] duration-200',
                      p.key === 'keep' ? 'col-span-6 sm:col-span-2' : 'col-span-3 sm:col-span-2', slice && !on && 'opacity-50')}>
                    <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">
                      <span className="size-2.5 shrink-0 rounded-full" style={{ background: TAX_PIE[p.key] }} />{p.label}
                    </div>
                    <div className="text-[1.5rem] font-extrabold leading-tight tracking-[-0.015em] tabular-nums text-ink-strong min-[1500px]:text-[1.75rem]">{money0(p.value)}</div>
                    <div className="text-[0.8125rem] leading-snug text-muted-foreground">{share(p.value)} of income</div>
                  </div>
                );
              })}
              <div className="col-span-3 grid sm:col-span-2"><Stat label="Effective Rate" value={pct(r.effectiveRate)} note={`of all income · ${pct(r.effectiveOnAgi)} of AGI`}
                info={<>{money0(r.totalTax)} of tax on {money0(r.grossIncome)}. The AGI rate is after retirement and health contributions.</>} more={U.brackets} /></div>
              <div className="col-span-3 grid sm:col-span-2"><Stat label="Marginal Rate" value={pct(r.marginalCombined)}
                note={<>on your next dollar<span className={cn('block', marginalNote.tone)}>{marginalNote.text}</span></>}
                info={<><b>Measured</b> by adding $1,000 of income and rerunning the return, so phase-outs show up.
                  <span className="mt-1.5 block">Federal {pct(r.marginalFederal)} measured, {pct(r.fedBracketRate, 0)} bracket.</span>
                  <span className="block">California {pct(r.marginalCa)} measured, {pct(r.caBracketRate)} bracket.</span>
                  <span className="block">On a long-term gain: {pct(r.marginalGains)}.</span></>} more={U.brackets} /></div>
              <div className="col-span-6 grid sm:col-span-2"><Stat label="CA Rate" value={share(r.caTotal)}
                note={<>of all income<span className="block">{pct(r.caBracketRate)} California bracket</span></>}
                info={<>{money0(r.caTotal)} of California tax on {money0(r.grossIncome)}. Your next dollar pays {pct(r.marginalCa)}.</>} more={U.caRates} /></div>
            </div>
          </div>

          {/* what-ifs and reference tables: each opens a popup */}
          <div className="grid gap-3 sm:grid-cols-2 min-[1700px]:grid-cols-4 print:hidden">
            {([
              ['reps', 'badge', 'Professional status', reps.saving > 0 ? `Worth ${money0(reps.saving)} this year` : 'Worth nothing on these numbers'],
              ['sale', 'sell', 'Sell an asset', `${money0(sale.totalDelta)} tax on a ${money0(sale.gainTotal)} gain`],
              ['brackets', 'stacked_bar_chart', 'Brackets', `${pct(r.fedBracketRate, 0)} federal · ${pct(r.caBracketRate)} California`],
              ['limits', 'rule', 'Thresholds and limits', 'Caps, phase-outs and contribution limits'],
            ] as const).map(([id, icon, label, sub]) => (
              <button key={id} type="button" aria-haspopup="dialog" onClick={() => setModal(id)}
                className="group flex min-w-0 items-center gap-3 rounded-lg bg-card p-3 text-left shadow-tight outline-none transition-shadow hover:shadow-fluffy focus-visible:ring-2 focus-visible:ring-ring/50">
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary-tint text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                  <Icon name={icon} size={20} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.9375rem] font-bold leading-snug text-ink-strong">{label}</span>
                  <span className="block truncate text-[0.8125rem] leading-snug tabular-nums text-muted-foreground">{sub}</span>
                </span>
                <Icon name="chevron_right" size={20} className="shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
              </button>
            ))}
          </div>

          {ca.provenance === 'carried' && (
            <Note tone="warn" icon="warning" title={`California thresholds are the ${ca.scheduleYear} schedule`}>
              The rates themselves are statute and have not moved. Only the thresholds index, at roughly 3% a year,
              so the drift is worth a few hundred dollars to you, not a few thousand. Confirm at ftb.ca.gov before you file.
            </Note>
          )}
          {r.rentalSuspended > 0 && !s.reps && (
            <Note icon="home_work" title={`${money0(r.rentalSuspended)} of rental loss is suspended this year`}>
              Qualifying as a real estate professional would free it and save {money0(reps.saving)}. The loss is not gone
              either way: it carries forward until you have passive income or sell.
            </Note>
          )}

          <div className="grid items-start gap-4 min-[1400px]:grid-cols-2">
            <Panel dense title="Federal" tag={money0(r.federalTotal)} {...fold('fed')}>
              <Line label="Total income" value={money0(r.totalIncome)} info="Everything taxable, after the rental loss rules." />
              <Line label="Less adjustments" value={less(r.adjustments)} info="Retirement, health savings, half of SE tax." />
              <Line strong label="Adjusted gross income" value={money0(r.agi)} info="The number every threshold and phase-out measures against." />
              <Line label={`Less the ${r.deductionKind} deduction`} value={less(r.deductionUsed)}
                info={r.deductionKind === 'itemized' ? 'Itemizing beat the standard deduction.' : 'The standard deduction beat itemizing.'} more={U.itemize} />
              <Line label="Less §199A" value={less(r.qbiDeduction)} info="20% of qualified business income, within the wage and income limits." more={U.qbi} />
              <Line strong label="Taxable income" value={money0(r.taxableIncome)}
                hint={`${money0(r.ordinaryTaxable)} ordinary · ${money0(r.preferentialIncome)} at gains rates`} />
              <SectionLabel>The tax itself</SectionLabel>
              <Line label="Tax on ordinary income" value={money0(r.fedOrdinaryTax)} info={<>Through the brackets, up to {pct(r.fedBracketRate, 0)}.</>} more={U.brackets} />
              {r.fed1250Tax > 0 && <Line label="Depreciation recapture" value={money0(r.fed1250Tax)} info="Ordinary rates, capped at 25%." more={U.gains} />}
              <Line label="Tax on gains and qualified dividends" value={money0(r.fedGainsTax)}
                info="Stacked on top of ordinary income, at 0, 15 or 20%." more={U.gains} />
              <Line label="Less credits" value={less(r.credits)}
                info={r.credits > 0 ? 'Child and dependent credits, after phase-out.' : 'Phased out at this income.'} more={U.ctc} />
              <Line label="Self-employment tax" value={money0(r.seTax)}
                info="Both halves of Social Security and Medicare." more={U.seTax} />
              <Line label="Net investment income tax" value={money0(r.niit)}
                info={r.niit > 0
                  ? <>3.8% on {money0(Math.min(r.netInvestmentIncome, Math.max(0, r.agi - fed.niitFrom[st])))} of investment income.</>
                  : `None. Income is under ${money0(fed.niitFrom[st])}.`} more={U.niit} />
              <Line label="Additional Medicare tax" value={money0(r.addlMedicare)} info={`0.9% on earnings over ${money0(fed.addlMedicareFrom[st])}.`} more={U.addlMed} />
              <Line total label="Total federal" value={money0(r.federalTotal)} hint={`${share(r.federalTotal)} of what you made`} />
            </Panel>

            <div className="flex min-w-0 flex-col gap-4">
              <Panel dense title="California" tag={money0(r.caTotal)} {...fold('ca')}>
                <Line label="California AGI" value={money0(r.caAgi)}
                  info={r.caAgi !== r.agi ? <>{money0(r.caAgi - r.agi)} above federal: California adds back the HSA{r.caRentalAllowed < r.rentalAllowed ? ` and does not let professional status free the rental loss (${money0(r.rentalAllowed - r.caRentalAllowed)})` : ''}.</> : 'Same as federal here.'} more={U.caDed} />
                <Line label={`Less the ${r.caDeductionKind} deduction`} value={less(r.caDeduction)}
                  info={r.caItemizedPhaseout > 0
                    ? <>Itemized deductions cut by {money0(r.caItemizedPhaseout)} at high income.</>
                    : `California's standard deduction is ${money0(r.caStandard)}.`} more={U.caDed} />
                <Line strong label="California taxable income" value={money0(r.caTaxableIncome)}
                  hint={`${money0(r.caTaxableIncome - r.taxableIncome)} more than federal`}
                  info="Wider than federal: gains taxed as ordinary income, no §199A, no HSA, no deduction for state tax." more={U.caGains} />
                <Line label="Tax on the ladder" value={money0(r.caBaseTax)} info={<>Through California's brackets, 1% to {pct(r.caBracketRate)}.</>} more={U.caRates} />
                {r.caMentalHealth > 0 && <Line label="Mental health services tax" value={money0(r.caMentalHealth)}
                  info="An extra 1% on taxable income over $1,000,000." more={U.caRates} />}
                <Line label="Less exemption credits" value={less(r.caExemptionCredits)}
                  info={r.caExemptionCredits > 0 ? 'Comes off the tax itself.' : 'Phased out at this income.'} more={U.caCredits} />
                <Line total label="Total California" value={money0(r.caTotal)} hint={`${share(r.caTotal)} of what you made`} />
                <Line label="State disability insurance" value={money0(r.caSdi)}
                  info="A payroll tax on wages, outside the totals above." more={U.sdi} />
              </Panel>
            </div>
          </div>
        </div>
      </div>

      <p className="mt-4 text-[0.8125rem] leading-snug text-muted-foreground">
        A planning model, not a tax return. It does not compute the alternative minimum tax, which
        can matter between $500,000 and $1,000,000 of income now that the state and local cap is
        larger again. Ask your CPA whether it reaches you. It also leaves out refundable credits,
        the qualified small business stock exclusion, foreign income, education credits and
        estimated payment penalties. State income tax deducted federally is this year&apos;s
        California liability rather than what you actually paid in cash during the year.
        Verify every figure before filing or before making a decision worth more than it.
      </p>
      {/* ============================================ POPUPS */}
      {modalEl('reps', 'Real estate professional status', 'What the election is worth on this year\u2019s return.', 'max-w-md', <>
        <div className={cn('rounded-lg px-4 py-3', reps.saving > 0 ? 'bg-success-soft' : 'bg-page')}>
          <div className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">{reps.saving > 0 ? 'Saves you' : 'Saves you nothing'}</div>
          <div className={cn('text-[2rem] font-extrabold leading-tight tracking-[-0.02em] tabular-nums', reps.saving > 0 ? 'text-success' : 'text-ink-strong')}>{money0(reps.saving)}</div>
          {reps.saving <= 0 && <div className="text-[0.8125rem] text-muted-foreground">There is no rental loss for it to free.</div>}
        </div>
        <table className="mt-3 w-full text-sm tabular-nums">
          <thead>
            <tr className="border-b border-line">
              <th scope="col"><span className="sr-only">Figure</span></th>
              <th scope="col" className={cmpTh}>Without</th>
              <th scope="col" className={cmpTh}>With</th>
            </tr>
          </thead>
          <tbody>
            {cmpRow('Rental loss deducted', reps.off.rentalAllowed, reps.on.rentalAllowed)}
            {cmpRow('Federal tax', reps.off.federalTotal, reps.on.federalTotal)}
            {cmpRow('California tax', reps.off.caTotal, reps.on.caTotal)}
          </tbody>
        </table>
        <p className="mt-3 text-[0.8125rem] leading-snug text-muted-foreground">
          California ignores the election. <a href={U.caPassive} target="_blank" rel="noopener noreferrer" className="font-semibold text-primary hover:underline">ftb.ca.gov</a>
          <span className="mt-1 block">To qualify: 750+ hours in real property work and more than half your working time. <a href={U.reps} target="_blank" rel="noopener noreferrer" className="font-semibold text-primary hover:underline">irs.gov</a></span>
        </p>
      </>)}
      {modalEl('sale', 'Sell an asset', 'What a sale adds to your tax. It sits on top of your return and is not added to the figures on the page.', 'max-w-3xl', <>
        <div className="grid items-start gap-x-8 gap-y-4 md:grid-cols-[280px_minmax(0,1fr)]">
          <div>
            <SectionLabel>The sale</SectionLabel>
            <Field label="Long-term gain" info="Sale price less basis, held over a year." more={U.gains}>
              {$(gLong, setGLong)}</Field>
            <Field label="Short-term gain" info="Held a year or less. Ordinary rates. A flip usually lands here." more={U.gains}>
              {$(gShort, setGShort)}</Field>
            <Field label="Depreciation recapture" info="Rental depreciation, taxed at up to 25% on sale." more={U.gains}>
              {$(gRecapture, setGRecapture)}</Field>
            <Field label="§121 home exclusion" info="$250,000 single, $500,000 married, if you lived there 2 of the last 5 years." more={U.home}>
              {$(gExclusion, setGExclusion)}</Field>
            <Line total label="Taxable gain" value={money0(sale.gainTotal)}
              info="The gain that lands on your return, on top of your other income." more={U.gains} />
          </div>

          <div className="min-w-0">
            {/* the answer: the total on the left, who gets it on the right */}
            <div className="mb-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 rounded-lg bg-page px-4 py-3">
              <div>
                <div className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">Total tax on this sale</div>
                <div className="text-[1.75rem] font-extrabold leading-tight tracking-[-0.015em] tabular-nums text-ink-strong">{money0(sale.totalDelta)}</div>
                <div className="text-[0.8125rem] tabular-nums text-muted-foreground">
                  {pct(sale.effectiveOnGain)} of the gain · you keep <b className="text-success">{money0(sale.netProceeds)}</b>
                </div>
              </div>
              <dl className="grid grid-cols-[auto_auto] items-baseline gap-x-4 gap-y-1 text-sm tabular-nums">
                <dt className="text-[#3a4352]">Federal</dt><dd className="text-right text-base font-extrabold text-ink-strong">{money0(sale.fedDelta)}</dd>
                <dt className="text-[#3a4352]">California</dt><dd className="text-right text-base font-extrabold text-ink-strong">{money0(sale.caDelta)}</dd>
              </dl>
            </div>
            {/* a banner per ladder, only when the sale crosses into a new bracket */}
            {bumps.map(x => (
              <p key={x.who} role="status" className="mb-2 flex items-start gap-2 rounded-md bg-warning-soft px-3 py-2 text-sm leading-snug text-ink-strong">
                <Icon name="trending_up" size={18} className="mt-px shrink-0 text-warning" />
                <span>Pushed into the <b>{x.rate} {x.who}</b> bracket, <b className="tabular-nums">{money0(x.over)}</b> past the {money0(x.line)} line.</span>
              </p>
            ))}

            <section className="rounded-lg border border-line px-3 pb-1 pt-2.5">
              <h3 className="border-b border-line pb-1.5 text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">Federal</h3>
              {saleRows.map(x => Math.abs(x.v) >= 1 && (
                <Line key={x.label} label={x.label} value={money0(x.v)} info={x.info} more={x.more} />
              ))}
              <h3 className="mt-2 border-b border-line pb-1.5 text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">California</h3>
              <Line label="Taxed like wages" value={`${pct(sale.gainTotal > 0 ? sale.caDelta / sale.gainTotal * 100 : 0)} of the gain`}
                info="California has no lower rate for long-term gains. The whole gain is taxed at its regular brackets." more={U.caGains} />
            </section>

            <p className="mt-3 text-[0.8125rem] leading-snug text-muted-foreground">
              A §1031 exchange into another investment property defers this tax.{' '}
              <a href={U.x1031} target="_blank" rel="noopener noreferrer" className="font-semibold text-primary hover:underline">irs.gov</a>
            </p>
          </div>
        </div>
      </>)}
      {modalEl('brackets', 'Brackets', `${s.year} tables, ${statusLabel.label.toLowerCase()}. The highlighted step is where you stand.`, 'max-w-4xl', <>
            <div className="mb-4 grid gap-3 sm:grid-cols-3">
              <BracketSpot brackets={fed.ordinary[st]} taxable={r.taxableIncome} label="Federal" />
              <BracketSpot brackets={ca.brackets[st]} taxable={r.caTaxableIncome} label="California" />
              <BracketSpot brackets={fed.capGains[st]} taxable={r.taxableIncome} label="Long-term gains" />
            </div>
            <div className="grid items-start gap-x-4 md:grid-cols-2">
              <div>
                <Ladder brackets={fed.ordinary[st]} taxable={r.taxableIncome} label="Federal ordinary income"
                  info="Wages, business profit, interest, short-term gains, rental income." more={U.brackets} />
                <Ladder brackets={fed.capGains[st]} taxable={r.taxableIncome} label="Federal long-term gains and qualified dividends"
                  info="Stacked above ordinary income, so the rate depends on your whole return." more={U.gains} />
              </div>
              <Ladder brackets={ca.brackets[st]} taxable={r.caTaxableIncome} label="California, all income, gains included"
                info="No lower rate for gains. The 1% surcharge over $1,000,000 is not shown." more={U.caRates} />
            </div>
            <p className="text-[0.8125rem] leading-snug text-muted-foreground">
              {statusLabel.label}. Federal from {fed.source}. California from {ca.source}. Entered {fed.verifiedOn}.
              Rates change by act of Congress and by ballot measure, and thresholds index every year, so check both before you file.
            </p>
      </>)}
      {modalEl('limits', 'Thresholds and limits', `${s.year}, ${statusLabel.label.toLowerCase()}.`, 'max-w-4xl', <>
            <div className="grid gap-x-8 md:grid-cols-2">
              <div>
                <SectionLabel>Where extra tax starts</SectionLabel>
                <Line label="Net investment income tax" value={money0(fed.niitFrom[st])}
                  info="3.8% on investment income above this. Not indexed for inflation." more={U.niit} />
                <Line label="Additional Medicare tax" value={money0(fed.addlMedicareFrom[st])} info="0.9% on earnings above this. Not indexed." more={U.addlMed} />
                <Line label="California mental health surcharge" value={money0(ca.mentalHealthFrom)}
                  info="1% on taxable income above this." more={U.caRates} />
                <SectionLabel>Where deductions start disappearing</SectionLabel>
                <Line label="State and local tax cap" value={money0(fed.saltCap[st])}
                  info={<>Shrinks 30¢ per dollar of income over {money0(fed.saltPhasedownFrom[st])}, down to {money0(fed.saltFloor[st])}.</>} more={U.salt} />
                <Line label="§199A threshold" value={money0(fed.qbiThreshold[st])}
                  info={<>Above this, the wage limit phases in over {money0(fed.qbiPhaseIn[st])}.</>} more={U.qbi} />
                <Line label="Child credit phase-out" value={money0(fed.creditPhaseoutFrom[st])}
                  info={<>{money0(fed.childCredit)} per child, less $50 per $1,000 of income above this.</>} more={U.ctc} />
                <Line label="Passive loss allowance" value={money0(st === 'mfs' ? 12500 : 25000)}
                  info={<>Phases out from {money0(st === 'mfs' ? 50000 : 100000)} of income, gone at {money0(st === 'mfs' ? 75000 : 150000)}.</>} more={U.passive} />
                <Line label="Excess business loss cap" value={money0(fed.excessBusinessLoss[st])}
                  info="The most business loss one year can absorb. The rest carries forward." more={U.ebl} />
              </div>
              <div>
                <SectionLabel>What you can put away</SectionLabel>
                <Line label="401(k) elective deferral" value={money0(fed.elective401k)}
                  info={<>Plus {money0(fed.catchUp401k)} from age 50, or {money0(fed.superCatchUp401k)} at 60 to 63.</>} more={U.k401} />
                <Line label="IRA" value={money0(fed.iraLimit)} info={<>Plus {money0(fed.iraCatchUp)} from age 50.</>} more={U.iraLimits} />
                <Line label="Health savings account" value={money0(fed.hsaFamily)}
                  info={<>Family coverage. {money0(fed.hsaSelf)} self-only, plus {money0(fed.hsaCatchUp)} from 55.</>} more={U.hsa} />
                <Line label="Social Security wage base" value={money0(fed.ssWageBase)} info="Earnings above it pay Medicare but not Social Security." more={U.payroll} />
                <SectionLabel>Standard deductions</SectionLabel>
                <Line label="Federal" value={money0(fed.standardDeduction[st])}
                  info={fed.charitableNonItemizer[st] > 0
                    ? <>Plus up to {money0(fed.charitableNonItemizer[st])} of charitable gifts if you do not itemize.</>
                    : 'A flat amount, no receipts.'} more={U.std} />
                <Line label="California" value={money0(ca.standardDeduction[st])}
                  info="Much smaller than federal, so Californians itemize sooner." more={U.caDed} />
              </div>
            </div>
      </>)}
    </>
  );
}
