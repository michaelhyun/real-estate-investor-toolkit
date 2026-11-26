'use client';

/* Mortgage Calculator. Math lives in @reit/core; storage keys unchanged
   (mortgage.draft.v1, reads rentalDeals.v3). Built from components/calc. */

import { useEffect, useMemo, useState } from 'react';
import {
  simulate, deriveDown, fmtYears, money0,
  type MortgageState, type DealState,
} from '@reit/core';
import { loadJSON, saveJSON, openReportWindow, REPORT_CSS, escapeHtml } from '../../components/ui';
import { Panel, Field, Line, NumberField, Segmented, Stepper, Stat, Note, Fold, Sub, Toggle, Choice } from '../../components/calc';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { AmortizationCharts, AmortTable } from '../../components/AmortizationCharts';
import { PaymentPie, type PiePart } from '../../components/PaymentPie';
import { toast } from '../../components/toast';
import { Icon } from '../../components/Icon';

const DRAFT_KEY = 'mortgage.draft.v1';
const RENTAL_DEALS_KEY = 'rentalDeals.v3';

const DEFAULTS: MortgageState = {
  price: 350000, down: 20, downUnit: '%', io: false, ioYears: 10,
  rate: 7, term: 30, tax: 4200, ins: 1600, hoa: 0, pmiRate: 0.5, extra: 0,
  armOn: false, armFixed: 7, armFreq: 6, armRate: 8.5,
};

export default function MortgagePage() {
  const [s, setS] = useState<MortgageState>(DEFAULTS);
  const [deals, setDeals] = useState<DealState[]>([]);
  const [hydrated, setHydrated] = useState(false);
  /* null = the fold follows the loan: open when an option inside it is on */
  const [optsOpen, setOptsOpen] = useState<boolean | null>(null);

  /* load draft + saved analyzer deals once on mount */
  useEffect(() => {
    const d = loadJSON<any>(DRAFT_KEY);
    if (d && isFinite(d.price)) {
      setS({
        price: d.price, down: d.down ?? d.downPct ?? 20, downUnit: d.downUnit || '%',
        io: !!d.io, ioYears: d.ioYears ?? 10, rate: d.rate, term: d.term,
        tax: d.tax, ins: d.ins, hoa: d.hoa, pmiRate: d.pmiRate, extra: d.extra,
        armOn: !!d.armOn, armFixed: d.armFixed ?? 7, armFreq: d.armFreq ?? 6, armRate: d.armRate ?? 8.5,
      });
    }
    setDeals(loadJSON<DealState[]>(RENTAL_DEALS_KEY) || []);
    setHydrated(true);
  }, []);

  /* persist the draft exactly like the original readState() did */
  useEffect(() => {
    if (!hydrated) return;
    saveJSON(DRAFT_KEY, { ...s, ...deriveDown(s) });
  }, [s, hydrated]);

  const set = <K extends keyof MortgageState>(k: K, v: MortgageState[K]) =>
    setS(prev => ({ ...prev, [k]: v }));

  const { downAmt, downPct } = deriveDown(s);
  const base = useMemo(() => simulate(s, 0), [s]);
  const withExtra = useMemo(() => s.extra > 0 ? simulate(s, s.extra) : base, [s, base]);

  const taxM = s.tax / 12, insM = s.ins / 12, hoaM = s.hoa;
  const escrowM = taxM + insM + hoaM;
  const pmiM = base.pmiMonthly;
  const total = base.basePI + taxM + insM + hoaM + pmiM + (s.extra || 0);
  const armTag = `${+s.armFixed}/${s.armFreq === 6 ? 6 : 1} ARM`;

  const notes: React.ReactNode[] = [];
  if (s.armOn && withExtra.adjustedPI > 0)
    notes.push(<span key="arm">{armTag}: payment shown is the intro rate ({+s.rate}%). At your expected {+s.armRate}% it adjusts to <b>≈ {money0(withExtra.adjustedPI + escrowM)}/mo</b> starting in year {Math.floor(s.armFixed) + 1}. After that it can move every {s.armFreq} months.</span>);
  else if (s.armOn)
    notes.push(<span key="arm2">{armTag}: rate adjusts after year {+s.armFixed}. Set an expected adjusted rate to model it.</span>);
  if (s.io && withExtra.postIOPI > 0)
    notes.push(<span key="io">Interest-only for {+s.ioYears} yrs, then the payment steps up to <b>≈ {money0(withExtra.postIOPI + escrowM)}/mo</b> as principal paydown begins.</span>);
  else if (s.io && withExtra.balloon > 0)
    notes.push(<span key="io2">Interest-only for the full term. The entire <b>{money0(withExtra.balloon)}</b> balance is due as a balloon at term end.</span>);

  /* The first payment, split the way a statement would show it. Extra principal
     counts as principal; an interest-only loan pays none unless there is extra. */
  const interestM = Math.min(base.basePI, base.loan * s.rate / 100 / 12);
  const principalM = Math.max(0, base.basePI - interestM) + (s.extra || 0);
  const parts: PiePart[] = [
    { key: 'principal', label: 'Principal', value: principalM, note: s.extra > 0 ? `includes ${money0(s.extra)} extra` : undefined },
    { key: 'interest', label: 'Interest', value: interestM },
    { key: 'tax', label: 'Property tax', value: taxM },
    { key: 'ins', label: 'Insurance', value: insM },
    { key: 'pmi', label: 'PMI', value: pmiM },
    { key: 'hoa', label: 'HOA', value: hoaM },
  ];
  const rows = useMemo(() => withExtra.years.map(y => ({ year: y.y, principal: y.principal, interest: y.interest, balance: y.balance })), [withExtra]);

  const pmiDropYear = withExtra.pmiMonthly > 0 ? Math.ceil(withExtra.pmiEndMonth / 12) : 0;

  const toggleDownUnit = (u: string) => {
    if (u !== s.downUnit) {
      const v = u === '$'
        ? Math.round(s.price * s.down / 100)
        : (s.price > 0 ? +(s.down / s.price * 100).toFixed(1) : 0);
      setS(prev => ({ ...prev, down: v, downUnit: u as '%' | '$' }));
    }
  };

  const importDeal = (idx: string) => {
    const d = deals[+idx];
    if (!d) return;
    setS(prev => ({
      ...prev, price: d.price, down: d.downPct, downUnit: '%',
      rate: d.rate, term: d.term, io: !!d.ioOn,
    }));
    toast(`Loaded "${d.name}" from the Rental Analyzer`);
  };

  function snapshot() {
    const lines = [
      `Home price: ${money0(s.price)}`,
      `Down payment: ${money0(downAmt)} (${+downPct.toFixed(1)}%)`,
      `Loan: ${money0(base.loan)} at ${s.rate}% for ${s.term} yrs${s.io ? ' · interest-only' : ''}${s.armOn ? ' · ' + armTag : ''}`,
      s.armOn ? `Expected after adjustment: ${s.armRate}% → ≈ ${money0(withExtra.adjustedPI + escrowM)}/mo` : null,
      `Monthly payment: ${money0(total)} (P&I ${money0(base.basePI)} · tax ${money0(taxM)} · ins ${money0(insM)}${base.pmiMonthly ? ` · PMI ${money0(base.pmiMonthly)}` : ''}${s.hoa ? ` · HOA ${money0(s.hoa)}` : ''})`,
      `Total interest: ${money0(withExtra.totalInterest)} · Payoff: ${fmtYears(withExtra.months)}${withExtra.balloon ? ` · Balloon due: ${money0(withExtra.balloon)}` : ''}`,
      s.extra > 0 ? `Extra ${money0(s.extra)}/mo saves ${money0(base.totalInterest - withExtra.totalInterest)} and ${fmtYears(base.months - withExtra.months)}` : null,
    ].filter(Boolean) as string[];
    return { lines, title: `Mortgage Snapshot — ${money0(s.price)}${s.armOn ? ' · ' + armTag : ''}` };
  }

  const pdf = () => {
    const snap = snapshot();
    const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const doc = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(snap.title)}</title><style>${REPORT_CSS}</style></head><body>
      <header><h1>Mortgage Snapshot</h1><div class="meta">Prepared ${date} · Real Estate Investor Toolkit</div></header>
      <div class="noprint"><button onclick="print()">Print / Save as PDF</button></div>
      <h2>Summary</h2>
      <div class="big">${money0(total)}/mo</div>
      <table>${snap.lines.map(l => { const i = l.indexOf(':'); return `<tr><td>${l.slice(0, i)}</td><td class="r">${l.slice(i + 1).trim()}</td></tr>`; }).join('')}</table>
      <h2>Amortization — Year by Year</h2>
      <table><tr><th>Year</th><th class="r">Principal</th><th class="r">Interest</th><th class="r">Balance</th></tr>
        ${withExtra.years.map(y => `<tr><td>Year ${y.y}</td><td class="r">${money0(y.principal)}</td><td class="r">${money0(y.interest)}</td><td class="r">${money0(y.balance)}</td></tr>`).join('')}
      </table>
      <p class="note">Estimates only — confirm taxes, insurance, PMI and rate terms with your lender. Generated by Real Estate Investor Toolkit.</p>
    </body></html>`;
    openReportWindow(doc, '', () => toast('Pop-up blocked — allow pop-ups to download the snapshot'));
  };

  const email = () => {
    const snap = snapshot();
    const body = snap.lines.join('\n') + '\n\n— Generated by Real Estate Investor Toolkit';
    location.href = `mailto:?subject=${encodeURIComponent(snap.title)}&body=${encodeURIComponent(body)}`;
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[1.75rem] font-extrabold leading-tight tracking-[-0.015em] text-ink-strong">Mortgage Calculator</h1>
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          {deals.length > 0 && (
            <NativeSelect className="w-60" value="" aria-label="Load from a saved deal" onChange={ev => importDeal(ev.target.value)}>
              <option value="">Load from a saved deal…</option>
              {deals.map((d, i) => <option key={i} value={i}>{d.name} · {money0(d.price)}</option>)}
            </NativeSelect>
          )}
          <Button variant="outline" onClick={pdf} title="Open a print-ready snapshot — choose “Save as PDF” in the print dialog"><Icon name="download" size={18} />PDF</Button>
          <Button variant="outline" onClick={email} title="Send a text snapshot from your email app"><Icon name="mail" size={18} />Email</Button>
        </div>
      </div>

      <div className="grid items-start gap-4 min-[1100px]:grid-cols-[360px_minmax(0,1fr)]">
        {/* LEFT: INPUTS */}
        <div className="flex min-w-0 flex-col gap-3">
          <Panel dense title="Loan" tag={money0(base.loan)}>
            <Field label="Home price"><NumberField value={s.price} onChange={v => set('price', v)} /></Field>
            <Field label="Down payment" hint={s.downUnit === '%' ? money0(downAmt) : `${+downPct.toFixed(1)}%`}>
              <div className="flex items-center gap-1.5">
                <Segmented options={[{ u: '%', label: '%' }, { u: '$', label: '$' }]} value={s.downUnit} onChange={toggleDownUnit} />
                <NumberField value={s.down} onChange={v => set('down', v)} fmt={s.downUnit === '$' ? 'money' : 'raw'} suffix={s.downUnit === '%' ? '%' : undefined} />
              </div>
            </Field>
            <Field label="Interest rate">
              <div className="flex items-center gap-1.5">
                <Stepper value={s.rate} onChange={v => set('rate', v)} step={0.125} min={0} max={25} unit="%" />
                <NumberField value={s.rate} onChange={v => set('rate', v)} fmt="raw" suffix="%" step={0.125} min={0} max={25} />
              </div>
            </Field>
            <Field label="Loan term"><NumberField value={s.term} onChange={v => set('term', v)} fmt="raw" suffix="yrs" /></Field>
            <Fold label="Loan options" open={optsOpen ?? (s.io || s.armOn)} onOpenChange={setOptsOpen}
              summary={[s.io ? 'Interest-only' : null, s.armOn ? armTag : null].filter(Boolean).join(' · ') || 'Fixed rate'}>
              <Field label="Interest-only" hint="pay only interest for a set period">
                <Toggle checked={s.io} onChange={v => set('io', v)} />
              </Field>
              {s.io && (
                <Sub>
                  <Field label="Interest-only period" hint="set equal to the term for full-term IO (balloon)">
                    <NumberField value={s.ioYears} onChange={v => set('ioYears', v)} fmt="raw" suffix="yrs" />
                  </Field>
                </Sub>
              )}
              <Field label="ARM" hint="fixed intro period, then the rate adjusts">
                <Toggle checked={s.armOn} onChange={v => set('armOn', v)} />
              </Field>
              {s.armOn && (
                <Sub>
                  <Field label="Fixed period">
                    <NumberField value={s.armFixed} onChange={v => set('armFixed', v)} fmt="raw" suffix="yrs" />
                  </Field>
                  <Field label="Adjusts every">
                    <Choice value={s.armFreq} onChange={v => set('armFreq', +v)}>
                      <option value={6}>6 months</option>
                      <option value={12}>12 months</option>
                    </Choice>
                  </Field>
                  <Field label="Rate after adjustment" hint="your estimate of the fully indexed rate">
                    <NumberField value={s.armRate} onChange={v => set('armRate', v)} fmt="raw" suffix="%" />
                  </Field>
                </Sub>
              )}
            </Fold>
            <Line total label="Loan amount" value={money0(base.loan)} />
          </Panel>

          <Panel dense title="Taxes &amp; fees" tag={`${money0(escrowM + pmiM)}/mo`}>
            <Field label="Property tax" hint="per year"><NumberField value={s.tax} onChange={v => set('tax', v)} /></Field>
            <Field label="Home insurance" hint="per year"><NumberField value={s.ins} onChange={v => set('ins', v)} /></Field>
            <Field label="HOA fees" hint="per month"><NumberField value={s.hoa} onChange={v => set('hoa', v)} /></Field>
            <Field label="PMI rate" hint="yearly, under 20% down; drops at 78% loan-to-value">
              <NumberField value={s.pmiRate} onChange={v => set('pmiRate', v)} fmt="raw" suffix="%" />
            </Field>
          </Panel>

          <Panel dense title="Pay off faster" tag="Optional">
            <Field label="Extra payment" hint="added to principal every month"><NumberField value={s.extra} onChange={v => set('extra', v)} /></Field>
            {s.extra > 0 && (
              <Note icon="savings">
                Saves <b className="font-bold text-ink-strong">{money0(base.totalInterest - withExtra.totalInterest)}</b> in interest and pays the loan off <b className="font-bold text-ink-strong">{fmtYears(base.months - withExtra.months)}</b> sooner.
              </Note>
            )}
          </Panel>
        </div>

        {/* RIGHT: RESULTS */}
        <div className="flex min-w-0 flex-col gap-4">
          <Panel dense title="Monthly payment" tag={s.io ? 'Interest-only' : s.armOn ? armTag : `${+s.term}-year fixed`}>
            <PaymentPie parts={parts} total={total}
              caption={s.io ? (s.extra > 0 ? 'Interest-only: only your extra goes to principal for now.' : 'Interest-only: nothing goes to principal yet.') : undefined} />
            {notes.map((n, i) => <Note key={i} tone="warn" icon="info">{n}</Note>)}
          </Panel>

          <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">
            <Stat label="Total Interest" value={money0(withExtra.totalInterest)}
              note={s.extra > 0 ? 'with extra payments' : 'over the life of the loan'} />
            <Stat label="Total Cost" value={money0(base.loan + withExtra.totalInterest)} note="principal + interest" />
            <Stat label="Payoff Time" value={fmtYears(withExtra.months)}
              note={withExtra.balloon > 0
                ? `balloon of ${money0(withExtra.balloon)} due at term end`
                : s.extra > 0 ? `vs ${fmtYears(base.months)} without extra` : 'with current payments'} />
            <Stat label="PMI" value={pmiM > 0 ? `${money0(pmiM)}/mo` : 'None'}
              note={pmiM > 0
                ? `about ${money0(withExtra.totalPMI)} total, drops around year ${Math.max(1, Math.ceil(withExtra.pmiEndMonth / 12))}`
                : downPct >= 20 ? '20%+ down, so no PMI' : 'set a PMI rate to include it'} />
          </div>

          <Panel title="Amortization" tag="Year by year">
            {rows.length === 0
              ? <p className="py-2 text-sm text-muted-foreground">There is no loan to amortize. Lower the down payment to see the schedule.</p>
              : (
                <div className="flex flex-col gap-3 py-2">
                  <AmortizationCharts years={rows} startBalance={base.loan} />
                  <AmortTable years={rows} markYear={pmiDropYear || undefined} />
                  {pmiDropYear > 0 && <p className="text-xs text-muted-foreground">PMI drops off in year {pmiDropYear}, when the balance reaches 78% of the home price. That row is tinted in the table.</p>}
                </div>
              )}
          </Panel>
        </div>
      </div>

      <p className="mt-4 text-[0.8125rem] leading-snug text-muted-foreground">Estimates only. Taxes, insurance and PMI vary by property, credit and lender. Confirm with your loan officer before committing.</p>
    </>
  );
}
