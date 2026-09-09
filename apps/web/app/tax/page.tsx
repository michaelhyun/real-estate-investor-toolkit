'use client';

/* Income Tax Calculator — federal and California, laid out as a sheet.

   Four tabs over one TaxState. Tab 1 is the only one you type into; the rest
   are derivations of it. The tool exists to answer three questions a bracket
   table cannot:

   · what a rental loss is actually worth to you this year, which depends
     entirely on whether you qualify as a real estate professional;
   · what a sale will cost, which depends on where the gain lands once it is
     stacked on everything else you earn;
   · what your NEXT dollar pays, which is not the bracket you are in.

   Everything stays on this device. Tax inputs are the most sensitive numbers
   in the toolkit, so unlike saved deals they are never synced to an account. */

import { useEffect, useMemo, useState } from 'react';
import {
  defaultTaxState, computeTax, gainsImpact, repsComparison, tablesFor,
  bracketRate, FILING_STATUSES, TAX_YEARS,
  money, money0, pct,
  type TaxState, type FilingStatus, type TaxYear, type Bracket, type TaxResult,
} from '@reit/core';
import { NumInput, Switch, UnitToggle, loadJSON, saveJSON } from '../../components/ui';
import { Band, Sec, G, R, V, Money, Num, Count } from '../../components/sheet';

const DRAFT_KEY = 'taxCalc.draft.v1';

type TabId = 'income' | 'summary' | 'gains' | 'brackets';

/* the foldable sections of the input sheet, in the order they appear */
const INPUT_SECS = ['filing', 'earned', 'portfolio', 'realestate', 'adjust', 'itemized', 'qbi'];

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

const rate = (n: number) => `${n.toFixed(1)}%`;
/** Accounting style: a subtraction reads in parentheses, the way it does on paper. */
const less = (n: number) => n === 0 ? '—' : `(${money0(n)})`;

/** A ladder rendered as a table, with the step you are standing on marked.
    Not a chart: the reading task is looking up one row, and a table does that
    better than any bar. */
function Ladder({ brackets, taxable, label, note }: {
  brackets: Bracket[]; taxable: number; label: string; note?: React.ReactNode;
}) {
  const here = brackets.findIndex(b => taxable < b.upTo);
  return (
    <div className="sheet"><table className="ss with-notes ladder">
      <colgroup><col className="c-lb" /><col className="c-n" /><col className="c-u" />
        <col className="c-amt" /><col className="c-note" /></colgroup>
      <tbody>
        <Band span={5} tag={`you are at ${money0(taxable)}`}>{label}</Band>
        {note && <G>{note}</G>}
        {brackets.map((b, i) => {
          const from = i === 0 ? 0 : brackets[i - 1].upTo;
          const on = i === here;
          return (
            <tr key={i} className={on ? 'tot' : undefined}>
              <td className="lb">{pct(b.rate * 100, b.rate * 100 % 1 ? 1 : 0)}{on && <span className="cov">you</span>}</td>
              <td className="n" />
              <td className="u" />
              <td className="amt">{money0(from)} –&nbsp;{isFinite(b.upTo) ? money0(b.upTo) : 'up'}</td>
              <td className="note">
                {on ? <b>Your next dollar of this kind pays {pct(b.rate * 100)} here.</b>
                  : isFinite(b.upTo)
                    ? `${money0(b.upTo - from)} of income sits in this step.`
                    : 'Everything above the step below.'}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table></div>
  );
}

/* ================================================================== the page */

export default function TaxPage() {
  const [s, setS] = useState<TaxState>(defaultTaxState);
  const [tab, setTab] = useState<TabId>('income');
  const [shutSecs, setShutSecs] = useState<Record<string, boolean>>({});
  const [hydrated, setHydrated] = useState(false);
  /* the capital gains tab models a sale that is not in your base return */
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

  const secOpen = (id: string) => !shutSecs[id];
  const fold = (id: string) => ({
    open: secOpen(id),
    onToggle: () => setShutSecs(p => ({ ...p, [id]: !p[id] })),
  });
  const allShut = INPUT_SECS.every(id => shutSecs[id]);

  /* ---------- derived ---------- */
  const { fed, ca } = tablesFor(s.year);
  const r = useMemo(() => computeTax(s), [s]);
  const reps = useMemo(() => repsComparison(s), [s]);
  /* the sale on tab 3 is layered on the base return, never mixed into it */
  const sale = useMemo(
    () => gainsImpact(s, Math.max(0, gLong - gExclusion), gShort, gRecapture),
    [s, gLong, gShort, gRecapture, gExclusion]);

  const statusLabel = FILING_STATUSES.find(f => f.id === s.status)!.short;
  const earned = s.wages + s.spouseWages + s.seNetProfit;
  const portfolio = s.interest + s.ordinaryDividends + s.shortTermGains +
    s.longTermGains + s.unrecaptured1250 + s.otherIncome;

  /* Screening context. These are benchmarks, not rules — they exist so a
     number on screen carries a sense of whether it is normal. */
  const marginalNote = r.marginalCombined > r.fedBracketRate + r.caBracketRate + 1
    ? <span className="warn">higher, because you are standing inside a phase-out</span>
    : r.marginalCombined < r.fedBracketRate + r.caBracketRate - 1
      ? <span className="ok">lower, because a deduction is still growing with your income</span>
      : <span className="ok">the same, so nothing is phasing in or out on you</span>;

  const reset = () => { if (confirm('Clear every figure and start over?')) setS(defaultTaxState()); };

  /* ---------------------------------------------------------------- summary */
  const Summary = () => (
    <div className="sumry">
      <div className="hero"><div className="k">Total tax</div>
        <div className="v">{money0(r.totalTax)}</div>
        <div className="s">on {money0(r.grossIncome)} of income</div></div>
      <div><div className="k">Federal</div><div className="v">{money0(r.federalTotal)}</div>
        <div className="s">{money0(r.seTax)} of it self-employment</div></div>
      <div><div className="k">California</div><div className="v">{money0(r.caTotal)}</div>
        <div className="s">{pct(r.grossIncome > 0 ? r.caTotal / r.grossIncome * 100 : 0)} of income</div></div>
      <div><div className="k">Effective rate</div><div className="v">{pct(r.effectiveRate)}</div>
        <div className="s">{pct(r.effectiveOnAgi)} of AGI</div></div>
      <div><div className="k">Marginal rate</div><div className="v">{pct(r.marginalCombined)}</div>
        <div className="s">on your next dollar</div></div>

      <div><div className="k">You keep</div><div className="v pos">{money0(r.afterTax)}</div>
        <div className="s">after federal and state</div></div>
      <div><div className="k">AGI</div><div className="v">{money0(r.agi)}</div>
        <div className="s">{money0(r.adjustments)} adjusted out</div></div>
      <div><div className="k">Taxable income</div><div className="v">{money0(r.taxableIncome)}</div>
        <div className="s">after {money0(r.deductionUsed + r.qbiDeduction)} deducted</div></div>
      <div><div className="k">Rental loss used</div>
        <div className={`v ${r.rentalSuspended > 0 ? 'warn' : ''}`}>{money0(r.rentalAllowed)}</div>
        <div className="s">{r.rentalSuspended > 0 ? `${money0(r.rentalSuspended)} suspended` : 'nothing trapped'}</div></div>
      <div><div className="k">Professional status</div>
        <div className={`v ${reps.saving > 0 ? 'pos' : ''}`}>{money0(reps.saving)}</div>
        <div className="s">{s.reps ? 'saved by electing it' : 'if you qualify'}</div></div>
    </div>
  );

  return (
    <>
      <div className="wrap">
        <div className="hero">
          <h1>Income Tax Calculator</h1>
          <p>Federal and California, {s.year}. Everything stays on this device.</p>
        </div>
        <div className="deal-actions">
          <UnitToggle options={TAX_YEARS.map(y => ({ u: String(y), label: String(y) }))}
            value={String(s.year)} onChange={u => set('year', Number(u) as TaxYear)} />
          <button className="btn ghost" onClick={reset}>Reset</button>
        </div>
      </div>

      <nav className="tabs">
        <button className={`tab${tab === 'income' ? ' on' : ''}`} onClick={() => setTab('income')}>
          Income &amp; deductions</button>
        <button className={`tab${tab === 'summary' ? ' on' : ''}`} onClick={() => setTab('summary')}>
          Tax Summary <span className="badge">{money0(r.totalTax)}</span></button>
        <button className={`tab${tab === 'gains' ? ' on' : ''}`} onClick={() => setTab('gains')}>
          Capital Gains <span className="badge">{money0(sale.totalDelta)}</span></button>
        <button className={`tab${tab === 'brackets' ? ' on' : ''}`} onClick={() => setTab('brackets')}>
          Brackets</button>
      </nav>

      {ca.provenance === 'carried' && (
        <div className="notice warn">
          <div><b>California thresholds are the {ca.scheduleYear} schedule</b>
            The rate ladder itself is statute and has not moved: 1 to 12.3% plus the 1% surcharge
            over $1M. Only the thresholds index, at roughly 3% a year, and above about $70,000 of
            taxable income they are fixed dollar amounts — so the drift is worth a few hundred
            dollars to you, not a few thousand. Confirm at ftb.ca.gov before you file.</div>
        </div>
      )}

      {/* ====================================== TAB 1 — INCOME & DEDUCTIONS */}
      <section className={`pane${tab === 'income' ? ' on' : ''}`}>
        <Summary />

        <div className="sow-bar">
          <button className="btn" onClick={() => setShutSecs(
            allShut ? {} : Object.fromEntries(INPUT_SECS.map(id => [id, true])))}>
            {allShut ? 'Expand all' : 'Collapse all'}</button>
          <span className="bar-note">Each section keeps its headline figure when shut.</span>
        </div>

        <div className="sheet one"><table className="ss with-notes">
          <colgroup>
            <col className="c-lb" /><col className="c-n" /><col className="c-u" />
            <col className="c-amt" /><col className="c-note" />
          </colgroup>
          <tbody>

          <Band span={5} {...fold('filing')} tag={`${s.year} · ${statusLabel}`}>Filing</Band>
          {secOpen('filing') && <>
          <R label="Filing status" note="Married filing separately loses the passive loss allowance entirely if you lived together at any point in the year." ctl={
            <select className="sel-city" value={s.status}
              onChange={ev => set('status', ev.target.value as FilingStatus)}>
              {FILING_STATUSES.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>} />
          <V label="Tax year" value={String(s.year)}
            note={<>Switch it in the header. Federal figures from {fed.source}.</>} />
          <R label="Children under 17" amount={money0(s.childrenUnder17 * fed.childCredit)}
            note={`${money0(fed.childCredit)} credit each, phasing out above ${money0(fed.creditPhaseoutFrom[s.status])} of income.`} ctl={
            <Count value={s.childrenUnder17} onChange={v => set('childrenUnder17', v)} max={8} />} />
          <R label="Other dependents" amount={money0(s.otherDependents * fed.otherDependentCredit)}
            note={`${money0(fed.otherDependentCredit)} each. Older children, parents you support.`} ctl={
            <Count value={s.otherDependents} onChange={v => set('otherDependents', v)} max={8} />} />
          </>}

          <Band span={5} {...fold('earned')} tag={money0(earned)}>Earned income</Band>
          {secOpen('earned') && <>
          <G>Enter wages <b>gross</b>, before your 401(k) comes out — the deferral is subtracted below, so entering the W-2 box 1 figure would take it twice.</G>
          <R label="Your wages" amount={money0(s.wages)}
            note="Before any deferral. Fills the Social Security wage base before self-employment does.">
            <Money value={s.wages} onChange={v => set('wages', v)} /></R>
          <R label="Spouse wages" amount={money0(s.spouseWages)}
            note="Has its own Social Security base, so it does not crowd out yours.">
            <Money value={s.spouseWages} onChange={v => set('spouseWages', v)} /></R>
          <R label="Self-employment net profit" amount={money0(s.seNetProfit)}
            note="Schedule C. Commission income after business expenses — this is what pays self-employment tax.">
            <Money value={s.seNetProfit} onChange={v => set('seNetProfit', v)} /></R>
          <V cls="tot" label="Self-employment tax" value={money0(r.seTax)}
            unit={pct(s.seNetProfit > 0 ? r.seTax / s.seNetProfit * 100 : 0)}
            note={<>15.3% until earnings pass {money0(fed.ssWageBase)}, then 2.9% plus surtax. Half of it, {money0(r.halfSeTax)}, comes back as a deduction.</>} />
          </>}

          <Band span={5} {...fold('portfolio')} tag={money0(portfolio)}>Portfolio income</Band>
          {secOpen('portfolio') && <>
          <G>Qualified dividends and long-term gains ride the 0/15/20 ladder; everything else here is ordinary. Above {money0(fed.niitFrom[s.status])} of income all of it also picks up the 3.8% investment surtax.</G>
          <R label="Interest" amount={money0(s.interest)} note="Ordinary rates, and inside net investment income.">
            <Money value={s.interest} onChange={v => set('interest', v)} /></R>
          <R label="Ordinary dividends" amount={money0(s.ordinaryDividends)}
            note="The total from box 1a. The qualified part below is a slice of this, not an addition.">
            <Money value={s.ordinaryDividends} onChange={v => set('ordinaryDividends', v)} /></R>
          <R label="— of which qualified" amount={money0(s.qualifiedDividends)}
            note="Box 1b. Taxed on the gains ladder instead of at ordinary rates.">
            <Money value={s.qualifiedDividends} onChange={v => set('qualifiedDividends', v)} /></R>
          <R label="Short-term gains" amount={money0(s.shortTermGains)}
            note="Held a year or less. No rate break at all — these are ordinary income.">
            <Money value={s.shortTermGains} onChange={v => set('shortTermGains', v)} /></R>
          <R label="Long-term gains" amount={money0(s.longTermGains)}
            note="Held over a year. Model a specific sale on the Capital Gains tab instead of here.">
            <Money value={s.longTermGains} onChange={v => set('longTermGains', v)} /></R>
          <R label="Depreciation recapture" amount={money0(s.unrecaptured1250)}
            note="Unrecaptured §1250 gain on a rental sale. Its own ceiling of 25%, above the gains rates.">
            <Money value={s.unrecaptured1250} onChange={v => set('unrecaptured1250', v)} /></R>
          <R label="Other income" amount={money0(s.otherIncome)}
            note="Flip profit, K-1 ordinary income, anything else taxed at ordinary rates.">
            <Money value={s.otherIncome} onChange={v => set('otherIncome', v)} /></R>
          </>}

          <Band span={5} {...fold('realestate')}
            tag={`${money(s.rentalNet)} · ${money0(r.rentalAllowed)} used`}>Real estate</Band>
          {secOpen('realestate') && <>
          <G>A rental loss is <b>passive</b> unless you qualify as a professional. The $25,000 allowance phases out between $100k and $150k of income and is gone above it, so at Bay Area incomes an unelected loss usually deducts <b>nothing</b> this year.</G>
          <R label="Net rental income or loss" amount={money(s.rentalNet)}
            note="After depreciation. A negative number is the loss the rules below decide what to do with.">
            <Money value={s.rentalNet} onChange={v => set('rentalNet', v)} /></R>
          <R label="Real estate professional" note="§469(c)(7): over 750 hours in real property trades, more than half your working time, and material participation in the rentals. An agent's hours count; a passive investor's do not." ctl={
            <Switch checked={s.reps} onChange={v => set('reps', v)} />} />
          <R label="Prior suspended losses" amount={money0(s.passiveCarryforward)}
            note="Losses trapped in earlier years. Electing professional status now does not free these — only passive income or selling the property does.">
            <Money value={s.passiveCarryforward} onChange={v => set('passiveCarryforward', v)} /></R>
          <R label="Rentals qualify for §199A" note="A rental rises to a trade or business, or meets the 250-hour safe harbor. Adds rental profit to the deduction below." ctl={
            <Switch checked={s.rentalQualifiesQbi} onChange={v => set('rentalQualifiesQbi', v)} />} />
          <V label="Special allowance available" value={money0(r.specialAllowance)}
            note={r.specialAllowance > 0 ? 'Still partly intact at this income.'
              : 'Fully phased out at this income — the toggle above is the only thing that unlocks the loss.'} />
          <V cls="tot" label="Loss deducted this year" value={money0(r.rentalAllowed)}
            unit={s.rentalNet < 0 ? pct(r.rentalAllowed / Math.max(1, -s.rentalNet) * 100) : undefined}
            note={r.rentalSuspended > 0
              ? <><b>{money0(r.rentalSuspended)} suspended</b> and carried forward. Not lost — it releases against passive income or when you sell.</>
              : 'Everything is deductible this year.'} />
          {r.eblDisallowed > 0 && (
            <V cls="tot" label="Blocked by the excess business loss cap" value={money0(r.eblDisallowed)}
              note={<>§461(l) stops a business loss at {money0(fed.excessBusinessLoss[s.status])} in one year. The rest becomes an operating loss carryforward.</>} />
          )}
          </>}

          <Band span={5} {...fold('adjust')} tag={money0(r.adjustments)}>Adjustments to income</Band>
          {secOpen('adjust') && <>
          <G>These come off before AGI, so they beat an itemized deduction of the same size — AGI drives the surtax thresholds, the SALT phase-down and the credit phase-outs all at once.</G>
          <R label="401(k) elective deferral" amount={money0(s.deferral401k)}
            note={`${money0(fed.elective401k)} limit for ${s.year}, plus ${money0(fed.catchUp401k)} at 50 and ${money0(fed.superCatchUp401k)} from 60 to 63.`}>
            <Money value={s.deferral401k} onChange={v => set('deferral401k', v)} /></R>
          <R label="Employer / solo 401(k) or SEP" amount={money0(s.employer401k)}
            note="The employer side of a solo plan. On Schedule C income this is the largest single lever you control.">
            <Money value={s.employer401k} onChange={v => set('employer401k', v)} /></R>
          <R label="HSA contribution" amount={money0(s.hsa)}
            note={`${money0(fed.hsaSelf)} self, ${money0(fed.hsaFamily)} family. California never conformed — it is federal-only.`}>
            <Money value={s.hsa} onChange={v => set('hsa', v)} /></R>
          <R label="Traditional IRA" amount={money0(s.tradIra)}
            note={`${money0(fed.iraLimit)} limit, and deductible only if a workplace plan does not cover you at this income.`}>
            <Money value={s.tradIra} onChange={v => set('tradIra', v)} /></R>
          <R label="Self-employed health insurance" amount={money0(s.seHealthIns)}
            note="Premiums for you and your family, limited to your net self-employment profit.">
            <Money value={s.seHealthIns} onChange={v => set('seHealthIns', v)} /></R>
          <V label="Half of self-employment tax" value={money0(r.halfSeTax)}
            note="Automatic. The employer half of what a salaried person never sees." />
          <R label="Other adjustments" amount={money0(s.otherAdjust)}
            note="Student loan interest, educator expenses, alimony under a pre-2019 decree.">
            <Money value={s.otherAdjust} onChange={v => set('otherAdjust', v)} /></R>
          <V cls="tot" label="Total adjustments" value={money0(r.adjustments)}
            note={<>Brings you from {money0(r.totalIncome)} of income to {money0(r.agi)} of AGI.</>} />
          </>}

          <Band span={5} {...fold('itemized')}
            tag={`${money0(r.deductionUsed)} · ${r.deductionKind}`}>Deductions</Band>
          {secOpen('itemized') && <>
          <G>You take the larger of the two automatically. The standard deduction is {money0(fed.standardDeduction[s.status])} this year, so itemizing only pays once these clear it.</G>
          <R label="Mortgage interest" amount={money0(s.mortgageInterest)}
            note="On up to $750,000 of debt used to buy or improve the home. Not a rental's interest — that is already in the rental figure.">
            <Money value={s.mortgageInterest} onChange={v => set('mortgageInterest', v)} /></R>
          <R label="Property tax" amount={money0(s.propertyTax)}
            note="Your residence. Rental property tax belongs in the rental figure, not here.">
            <Money value={s.propertyTax} onChange={v => set('propertyTax', v)} /></R>
          <R label="Charitable gifts" amount={money0(r.charitableAllowed)}
            note={fed.charitableAgiFloor > 0
              ? `From ${s.year} the first ${pct(fed.charitableAgiFloor * 100, 1)} of AGI does not count — ${money0(fed.charitableAgiFloor * r.agi)} of yours.`
              : 'Cash gifts to public charities, up to 60% of AGI.'}>
            <Money value={s.charitable} onChange={v => set('charitable', v)} /></R>
          <R label="Medical expenses" amount={money0(r.medicalAllowed)}
            note={<>Only the part above 7.5% of AGI counts — everything over the first {money0(0.075 * r.agi)}.</>}>
            <Money value={s.medical} onChange={v => set('medical', v)} /></R>
          <R label="Other itemized" amount={money0(s.otherItemized)}
            note="Investment interest, casualty losses in a declared disaster.">
            <Money value={s.otherItemized} onChange={v => set('otherItemized', v)} /></R>
          <Sec span={5}>State and local tax — the cap and its phase-down</Sec>
          <V label="State and local tax paid" value={money0(r.saltPaid)}
            note={<>{money0(s.propertyTax)} property tax plus {money0(r.caTotal)} of California income tax.</>} />
          <V label="Your cap this year" value={money0(r.saltCapUsed)}
            note={r.saltCapUsed <= fed.saltFloor[s.status]
              ? <><b>Phased all the way down.</b> The {money0(fed.saltCap[s.status])} cap sheds 30% of every dollar of income over {money0(fed.saltPhasedownFrom[s.status])} and floors at {money0(fed.saltFloor[s.status])}.</>
              : <>Starts at {money0(fed.saltCap[s.status])} and sheds 30¢ per dollar of income over {money0(fed.saltPhasedownFrom[s.status])}.</>} />
          <V label="Deductible" value={money0(r.saltAllowed)}
            note={r.saltPaid > r.saltAllowed
              ? <><b>{money0(r.saltPaid - r.saltAllowed)} of real tax gets no deduction.</b></>
              : 'All of it counts.'} />
          <Sec span={5}>Which deduction wins</Sec>
          <V label="Standard deduction" value={money0(r.standardTotal)}
            cls={r.deductionKind === 'standard' ? 'tot' : undefined}
            note={fed.charitableNonItemizer[s.status] > 0
              ? `${money0(fed.standardDeduction[s.status])} plus up to ${money0(fed.charitableNonItemizer[s.status])} of charitable gifts, which only people taking the standard may add.`
              : 'A flat figure, no receipts.'} />
          <V label="Itemized total" value={money0(r.itemizedTotal)}
            cls={r.deductionKind === 'itemized' ? 'tot' : undefined}
            note="Mortgage interest, capped state and local tax, charity and medical." />
          <V cls="grand" label={`You take the ${r.deductionKind}`} value={money0(r.deductionUsed)}
            note={<>{money0(Math.abs(r.itemizedTotal - r.standardTotal))} better than the alternative.</>} />
          </>}

          <Band span={5} {...fold('qbi')} tag={money0(r.qbiDeduction)}>Qualified business income</Band>
          {secOpen('qbi') && <>
          <G>A real estate agent or broker is <b>not</b> a specified service business — the regulations carve real property brokerage out of the trades that lose this deduction. Your commission keeps it where a lawyer&apos;s would not. The wage limit still applies.</G>
          <V label="Qualified business income" value={money0(r.qbi)}
            note="Schedule C profit less the self-employment tax deduction, health insurance and retirement contributions attributable to it." />
          <R label="W-2 wages your business paid" amount={money0(s.qbiWages)}
            note={`Above ${money0(fed.qbiThreshold[s.status])} of taxable income the deduction is capped at half of this. A sole proprietor with no payroll has zero here.`}>
            <Money value={s.qbiWages} onChange={v => set('qbiWages', v)} /></R>
          <R label="Business property basis" amount={money0(s.qbiProperty)}
            note="Unadjusted basis of depreciable property. Feeds the alternative limit of 25% of wages plus 2.5% of this.">
            <Money value={s.qbiProperty} onChange={v => set('qbiProperty', v)} /></R>
          <V cls="tot" label="§199A deduction" value={money0(r.qbiDeduction)}
            unit={r.qbi > 0 ? pct(r.qbiDeduction / r.qbi * 100) : undefined}
            note={r.qbiWageLimited
              ? <><b>Cut by the wage limit.</b> Paying yourself W-2 wages through an S corporation is the usual fix, and it has its own costs.</>
              : 'Full 20%, or the taxable income ceiling, whichever binds first.'} />
          <V label="California allows none of this" value={money0(0)}
            note="The state never conformed to §199A, so your California taxable income is higher than your federal by this amount." />
          </>}

          </tbody>
        </table></div>
      </section>

      {/* ============================================== TAB 2 — TAX SUMMARY */}
      <section className={`pane${tab === 'summary' ? ' on' : ''}`}>
        <Summary />

        <div className="sheet"><table className="ss with-notes">
          <colgroup><col className="c-lb" /><col className="c-n" /><col className="c-u" />
            <col className="c-amt" /><col className="c-note" /></colgroup>
          <tbody>
          <Band span={5} tag={money0(r.federalTotal)}>Federal</Band>
          <V label="Total income" value={money0(r.totalIncome)}
            note="Everything taxable, after the rental rules decide what counts." />
          <V label="Less adjustments" value={less(r.adjustments)}
            note="Retirement, health savings, half the self-employment tax." />
          <V cls="tot" label="Adjusted gross income" value={money0(r.agi)}
            note="The figure every threshold and phase-out on this page measures against." />
          <V label={`Less the ${r.deductionKind} deduction`} value={less(r.deductionUsed)}
            note={r.deductionKind === 'itemized' ? 'Itemizing beat the standard deduction.' : 'The standard deduction beat itemizing.'} />
          <V label="Less §199A" value={less(r.qbiDeduction)}
            note="Twenty percent of qualified business income, subject to the wage and taxable income limits." />
          <V cls="tot" label="Taxable income" value={money0(r.taxableIncome)}
            note={<>{money0(r.ordinaryTaxable)} ordinary, {money0(r.preferentialIncome)} at gains rates.</>} />
          <Sec span={5}>The tax itself</Sec>
          <V label="Tax on ordinary income" value={money0(r.fedOrdinaryTax)}
            note={<>Stepped through the ladder to {pct(r.fedBracketRate, 0)}.</>} />
          {r.fed1250Tax > 0 && <V label="Depreciation recapture" value={money0(r.fed1250Tax)}
            note="Ordinary rates, but stopped at 25%." />}
          <V label="Tax on gains and qualified dividends" value={money0(r.fedGainsTax)}
            note="Stacked on top of ordinary income, so its rate depends on everything below it." />
          <V label="Less credits" value={less(r.credits)}
            note={r.credits > 0 ? 'Child and dependent credits, after phase-out.' : 'Phased out at this income.'} />
          <V label="Self-employment tax" value={money0(r.seTax)}
            note="Both halves of Social Security and Medicare, which a salaried person splits with an employer." />
          <V label="Net investment income tax" value={money0(r.niit)}
            note={r.niit > 0
              ? <>3.8% on {money0(Math.min(r.netInvestmentIncome, Math.max(0, r.agi - fed.niitFrom[s.status])))} — the lesser of investment income and income over {money0(fed.niitFrom[s.status])}.</>
              : `Nothing — your income is under ${money0(fed.niitFrom[s.status])}.`} />
          <V label="Additional Medicare tax" value={money0(r.addlMedicare)}
            note={`0.9% on earnings over ${money0(fed.addlMedicareFrom[s.status])}.`} />
          <V cls="grand" label="Total federal" value={money0(r.federalTotal)}
            note={<>{pct(r.grossIncome > 0 ? r.federalTotal / r.grossIncome * 100 : 0)} of what you made.</>} />
          </tbody>
        </table></div>

        <div className="sheet"><table className="ss with-notes">
          <colgroup><col className="c-lb" /><col className="c-n" /><col className="c-u" />
            <col className="c-amt" /><col className="c-note" /></colgroup>
          <tbody>
          <Band span={5} tag={money0(r.caTotal)}>California</Band>
          <G>California taxes capital gains as ordinary income, allows no §199A deduction, never conformed to health savings accounts, and does not let you deduct its own tax. Every one of those makes the state base wider than the federal one.</G>
          <V label="California AGI" value={money0(r.caAgi)}
            note={r.caAgi !== r.agi ? <>{money0(r.caAgi - r.agi)} above federal, from the health savings account add-back.</> : 'Same as federal here.'} />
          <V label={`Less the ${r.caDeductionKind} deduction`} value={less(r.caDeduction)}
            note={r.caItemizedPhaseout > 0
              ? <>Itemized deductions cut by {money0(r.caItemizedPhaseout)} — California kept the high-income phase-out the federal government dropped.</>
              : `California's standard deduction is ${money0(r.caStandard)}, a fraction of the federal one.`} />
          <V cls="tot" label="California taxable income" value={money0(r.caTaxableIncome)}
            note={<>{money0(r.caTaxableIncome - r.taxableIncome)} more than the federal figure.</>} />
          <V label="Tax on the ladder" value={money0(r.caBaseTax)}
            note={<>Stepped from 1% to {pct(r.caBracketRate)}.</>} />
          {r.caMentalHealth > 0 && <V label="Mental health services tax" value={money0(r.caMentalHealth)}
            note="Proposition 63 — one point on everything over $1,000,000, and never indexed." />}
          <V label="Less exemption credits" value={less(r.caExemptionCredits)}
            note={r.caExemptionCredits > 0 ? 'A credit, not a deduction — it comes off the tax itself.' : 'Phased out at this income.'} />
          <V cls="grand" label="Total California" value={money0(r.caTotal)}
            note={<>{pct(r.grossIncome > 0 ? r.caTotal / r.grossIncome * 100 : 0)} of what you made.</>} />
          <V label="State disability insurance" value={money0(r.caSdi)}
            note="A payroll tax on wages, not income tax, so it sits outside the totals above. No wage ceiling since 2024." />
          </tbody>
        </table></div>

        <div className="sheet"><table className="ss with-notes">
          <colgroup><col className="c-lb" /><col className="c-n" /><col className="c-u" />
            <col className="c-amt" /><col className="c-note" /></colgroup>
          <tbody>
          <Band span={5} tag={`${pct(r.effectiveRate)} effective · ${pct(r.marginalCombined)} marginal`}>Your rates</Band>
          <G>The bracket you are in is not the rate your next dollar pays. The marginal figures here are <b>measured</b>: they add a thousand dollars of income and run the whole return again, so every phase-out you are standing in shows up.</G>
          <V label="Effective rate on income" value={pct(r.effectiveRate)}
            note={<>{money0(r.totalTax)} of tax on {money0(r.grossIncome)} earned.</>} />
          <V label="Effective rate on AGI" value={pct(r.effectiveOnAgi)}
            note="Higher, because retirement and health contributions came out first. Both are true; this is the one most people mean." />
          <Sec span={5}>What the next dollar costs</Sec>
          <V label="Federal bracket" value={pct(r.fedBracketRate, 0)} note="What a bracket table would tell you." />
          <V label="Federal marginal, measured" value={pct(r.marginalFederal)}
            note="Includes the surtaxes, the SALT phase-down and every credit phase-out you are inside." />
          <V label="California bracket" value={pct(r.caBracketRate)} note="The state ladder at your taxable income." />
          <V label="California marginal, measured" value={pct(r.marginalCa)} note="California has few phase-outs, so this rarely diverges." />
          <V cls="grand" label="Combined marginal" value={pct(r.marginalCombined)}
            note={<>Your brackets sum to {pct(r.fedBracketRate + r.caBracketRate)}. This is {marginalNote}.</>} />
          <V label="Marginal on a long-term gain" value={pct(r.marginalGains)}
            note="What one more dollar of capital gain would cost, all in. Model a whole sale on the next tab." />
          </tbody>
        </table></div>

        <div className="sheet"><table className="ss with-notes">
          <colgroup><col className="c-lb" /><col className="c-n" /><col className="c-u" />
            <col className="c-amt" /><col className="c-note" /></colgroup>
          <tbody>
          <Band span={5} tag={money0(reps.saving)}>What professional status is worth</Band>
          <G>Not a checkbox you tick because it helps. §469(c)(7) wants over 750 hours in real property trades, more than half of all your working time, and material participation in the rentals — documented contemporaneously, because it is among the most audited elections there is.</G>
          <V label="Tax without the election" value={money0(reps.off.totalTax)}
            note={reps.off.rentalSuspended > 0
              ? <>{money0(reps.off.rentalSuspended)} of loss suspended and carried forward.</>
              : 'Nothing suspended either way.'} />
          <V label="Tax with the election" value={money0(reps.on.totalTax)}
            note="The loss becomes ordinary and offsets everything else you earn." />
          <V cls="grand" label="Worth to you this year" value={money0(reps.saving)}
            note={reps.saving > 0
              ? <>{pct(s.rentalNet < 0 ? reps.saving / Math.max(1, -s.rentalNet) * 100 : 0)} of the loss, which is roughly your combined marginal rate.</>
              : 'Nothing on these numbers — there is no loss for it to free.'} />
          {reps.on.eblDisallowed > 0 && (
            <V label="Still blocked by §461(l)" value={money0(reps.on.eblDisallowed)}
              note="Even with the election, a single year can only absorb so much. The rest carries forward." />
          )}
          </tbody>
        </table></div>
      </section>

      {/* ============================================ TAB 3 — CAPITAL GAINS */}
      <section className={`pane${tab === 'gains' ? ' on' : ''}`}>
        <div className="sumry">
          <div className="hero"><div className="k">Tax on this sale</div>
            <div className="v">{money0(sale.totalDelta)}</div>
            <div className="s">{pct(sale.effectiveOnGain)} of the gain</div></div>
          <div><div className="k">You keep</div><div className="v pos">{money0(sale.netProceeds)}</div>
            <div className="s">of {money0(sale.gainTotal)}</div></div>
          <div><div className="k">Federal</div><div className="v">{money0(sale.fedDelta)}</div>
            <div className="s">{money0(sale.niitDelta)} of it surtax</div></div>
          <div><div className="k">California</div><div className="v">{money0(sale.caDelta)}</div>
            <div className="s">taxed as ordinary income</div></div>
          <div><div className="k">Next dollar</div><div className="v">{pct(sale.marginalNext)}</div>
            <div className="s">if the gain were larger</div></div>
        </div>

        <div className="sheet one"><table className="ss with-notes">
          <colgroup><col className="c-lb" /><col className="c-n" /><col className="c-u" />
            <col className="c-amt" /><col className="c-note" /></colgroup>
          <tbody>
          <Band span={5} tag={money0(sale.gainTotal)}>The sale</Band>
          <G>A gain has no tax of its own — it has the tax it <b>adds</b>. This runs your whole return with and without it, which is why the answer moves when your other income does.</G>
          <R label="Long-term gain" amount={money0(gLong)}
            note="Sale price less basis, held over a year. Basis is what you paid plus improvements, less depreciation taken.">
            <Money value={gLong} onChange={setGLong} /></R>
          <R label="Short-term gain" amount={money0(gShort)}
            note="Held a year or less. Ordinary rates — a flip is usually here, and also owes self-employment tax.">
            <Money value={gShort} onChange={setGShort} /></R>
          <R label="Depreciation recapture" amount={money0(gRecapture)}
            note="Unrecaptured §1250. Every year of rental depreciation comes back at up to 25%, whether or not you claimed it.">
            <Money value={gRecapture} onChange={setGRecapture} /></R>
          <R label="§121 primary residence exclusion" amount={less(Math.min(gExclusion, gLong))}
            note="$250,000 single, $500,000 married, if you lived there two of the last five years. Nothing for a rental you never occupied.">
            <Money value={gExclusion} onChange={setGExclusion} /></R>
          <V cls="tot" label="Taxable gain" value={money0(sale.gainTotal)}
            note="What actually lands on the return, stacked on top of everything on the first tab." />
          </tbody>
        </table></div>

        <div className="sheet"><table className="ss with-notes">
          <colgroup><col className="c-lb" /><col className="c-n" /><col className="c-u" />
            <col className="c-amt" /><col className="c-note" /></colgroup>
          <tbody>
          <Band span={5} tag={money0(sale.totalDelta)}>What it costs</Band>
          <V label="Your tax without the sale" value={money0(sale.without.totalTax)}
            note={<>Effective {pct(sale.without.effectiveRate)} on {money0(sale.without.grossIncome)}.</>} />
          <V label="Your tax with it" value={money0(sale.with.totalTax)}
            note={<>Effective {pct(sale.with.effectiveRate)}. The sale also pushes your other income into worse territory.</>} />
          <V cls="tot" label="Federal share" value={money0(sale.fedDelta)}
            note={<>Includes {money0(sale.niitDelta)} of investment surtax, which the sale can trigger on interest and dividends that escaped it before.</>} />
          <V cls="tot" label="California share" value={money0(sale.caDelta)}
            note="No preferential rate at all — the state treats a long-term gain exactly like salary." />
          <V cls="grand" label="Total tax on the sale" value={money0(sale.totalDelta)}
            note={<><b>{pct(sale.effectiveOnGain)} of the gain.</b> You keep {money0(sale.netProceeds)}.</>} />
          {sale.with.saltCapUsed < sale.without.saltCapUsed && (
            <V label="Of that, lost SALT deduction" value={money0(sale.without.saltAllowed - sale.with.saltAllowed)}
              note={<><b>Already inside the federal share above.</b> Income over {money0(fed.saltPhasedownFrom[s.status])} sheds 30¢ of cap per dollar, so a big gain quietly costs more than its own rate.</>} />
          )}
          <V label="If you exchanged instead" value={money0(0)}
            note="A §1031 exchange into another investment property defers all of this. It does not erase it — basis carries over, and California claws back deferred gain if you later sell out of state." />
          </tbody>
        </table></div>

        <Ladder brackets={fed.capGains[s.status]} taxable={sale.with.taxableIncome}
          label="Federal long-term gains ladder"
          note={<>These steps are measured against your <b>whole</b> taxable income, not the gain alone. That is why the same sale costs different people different amounts.</>} />
      </section>

      {/* ================================================= TAB 4 — BRACKETS */}
      <section className={`pane${tab === 'brackets' ? ' on' : ''}`}>
        <div className="notice">
          <div><b>{s.year} tables · {FILING_STATUSES.find(f => f.id === s.status)!.label}</b>
            Federal from {fed.source}. California from {ca.source}. Entered {fed.verifiedOn}.
            Rates change by act of Congress and by ballot measure, and thresholds index every year —
            check both before you file rather than before you plan.</div>
        </div>

        <Ladder brackets={fed.ordinary[s.status]} taxable={r.taxableIncome}
          label="Federal ordinary income"
          note="Wages, self-employment profit, interest, short-term gains, rental income. Each step taxes only the slice inside it." />

        <Ladder brackets={fed.capGains[s.status]} taxable={r.taxableIncome}
          label="Federal long-term gains and qualified dividends"
          note="Stacked above ordinary income, so where you land depends on your whole return, not just the gain." />

        <Ladder brackets={ca.brackets[s.status]} taxable={r.caTaxableIncome}
          label="California — all income, gains included"
          note="No preferential rate for capital gains. The 1% mental health surcharge over $1,000,000 sits on top of the ladder and is not shown as a step." />

        <div className="sheet"><table className="ss with-notes">
          <colgroup><col className="c-lb" /><col className="c-n" /><col className="c-u" />
            <col className="c-amt" /><col className="c-note" /></colgroup>
          <tbody>
          <Band span={5} tag={`${s.year} · ${statusLabel}`}>Thresholds and limits</Band>
          <Sec span={5}>Where extra tax starts</Sec>
          <V label="Net investment income tax" value={money0(fed.niitFrom[s.status])}
            note="3.8% above this, on the lesser of investment income and the excess. Never indexed since 2013, so it catches more people every year." />
          <V label="Additional Medicare tax" value={money0(fed.addlMedicareFrom[s.status])}
            note="0.9% on earnings above it. Also never indexed." />
          <V label="California mental health surcharge" value={money0(ca.mentalHealthFrom)}
            note="One point on taxable income above a million. Fixed by Proposition 63." />
          <Sec span={5}>Where deductions start disappearing</Sec>
          <V label="State and local tax cap" value={money0(fed.saltCap[s.status])}
            note={<>Sheds 30% of income over {money0(fed.saltPhasedownFrom[s.status])}, flooring at {money0(fed.saltFloor[s.status])}. Reverts to {money0(10000)} in 2030 unless Congress acts again.</>} />
          <V label="§199A threshold" value={money0(fed.qbiThreshold[s.status])}
            note={<>Above this the wage limit phases in over {money0(fed.qbiPhaseIn[s.status])} of income.</>} />
          <V label="Child credit phase-out" value={money0(fed.creditPhaseoutFrom[s.status])}
            note={<>{money0(fed.childCredit)} per child, losing $50 per $1,000 of income above this.</>} />
          <V label="Passive loss allowance" value={money0(s.status === 'mfs' ? 12500 : 25000)}
            note={<>Phases out from {money0(s.status === 'mfs' ? 50000 : 100000)} and is gone {money0(s.status === 'mfs' ? 75000 : 150000)} later. Professional status is the only way past it.</>} />
          <V label="Excess business loss cap" value={money0(fed.excessBusinessLoss[s.status])}
            note="The most a business loss can shelter in one year. The rest becomes a carryforward." />
          <Sec span={5}>What you can put away</Sec>
          <V label="401(k) elective deferral" value={money0(fed.elective401k)}
            note={<>Plus {money0(fed.catchUp401k)} from 50, and {money0(fed.superCatchUp401k)} instead from 60 through 63.</>} />
          <V label="IRA" value={money0(fed.iraLimit)} note={<>Plus {money0(fed.iraCatchUp)} from 50.</>} />
          <V label="Health savings account" value={money0(fed.hsaFamily)}
            note={<>{money0(fed.hsaSelf)} for self-only coverage, plus {money0(fed.hsaCatchUp)} from 55. California taxes all of it.</>} />
          <V label="Social Security wage base" value={money0(fed.ssWageBase)}
            note="Earnings above it pay Medicare but no Social Security." />
          <Sec span={5}>Standard deductions</Sec>
          <V label="Federal" value={money0(fed.standardDeduction[s.status])}
            note={fed.charitableNonItemizer[s.status] > 0
              ? <>Plus up to {money0(fed.charitableNonItemizer[s.status])} of charitable gifts, new for people who do not itemize.</>
              : 'Flat, no receipts required.'} />
          <V label="California" value={money0(ca.standardDeduction[s.status])}
            note="A fraction of the federal figure, which is why Californians itemize at incomes where other states do not." />
          </tbody>
        </table></div>
      </section>

      <p className="footnote">
        A planning model, not a tax return. It does not compute the alternative minimum tax, which
        can matter between $500,000 and $1,000,000 of income now that the state and local cap is
        larger again — ask your CPA whether it reaches you. It also leaves out refundable credits,
        the qualified small business stock exclusion, foreign income, education credits and
        estimated payment penalties. State income tax deducted federally is this year&apos;s
        California liability rather than what you actually paid in cash during the year.
        Verify every figure before filing or before making a decision worth more than it.
      </p>
    </>
  );
}
