'use client';

/* Mortgage Calculator — React port of mortgage.html. Math lives in @reit/core;
   storage keys unchanged (mortgage.draft.v1, reads rentalDeals.v3). */

import { useEffect, useMemo, useState } from 'react';
import {
  simulate, deriveDown, fmtYears, money0,
  type MortgageState, type DealState,
} from '@reit/core';
import { Card, NumInput, Switch, UnitToggle, Tile, loadJSON, saveJSON, openReportWindow, REPORT_CSS, escapeHtml } from '../../components/ui';
import { toast } from '../../components/toast';

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
    notes.push(<span key="arm">{armTag}: payment shown is the intro rate ({+s.rate}%). At your expected {+s.armRate}% it adjusts to <b>≈ {money0(withExtra.adjustedPI + escrowM)}/mo</b> starting year {Math.floor(s.armFixed) + 1} — thereafter it can move every {s.armFreq} months.</span>);
  else if (s.armOn)
    notes.push(<span key="arm2">{armTag}: rate adjusts after year {+s.armFixed} — set an expected adjusted rate to model it.</span>);
  if (s.io && withExtra.postIOPI > 0)
    notes.push(<span key="io">Interest-only for {+s.ioYears} yrs — then the payment steps up to <b>≈ {money0(withExtra.postIOPI + escrowM)}/mo</b> as principal paydown begins.</span>);
  else if (s.io && withExtra.balloon > 0)
    notes.push(<span key="io2">Interest-only for the full term — the entire <b>{money0(withExtra.balloon)}</b> balance is due as a balloon at term end.</span>);

  const parts: [string, number, string][] = ([
    [s.io ? 'Interest' : 'P&I', base.basePI + (s.extra || 0), 'c-pi'],
    ['Taxes', taxM, 'c-tax'],
    ['Insurance', insM, 'c-ins'],
    pmiM > 0 ? ['PMI', pmiM, 'c-pmi'] : null,
    hoaM > 0 ? ['HOA', hoaM, 'c-hoa'] : null,
  ].filter(Boolean)) as [string, number, string][];
  const sum = parts.reduce((t, p) => t + p[1], 0) || 1;

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
      <div class="noprint"><button onclick="print()">🖨 Print / Save as PDF</button></div>
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
      <div className="tool-title">
        <h1>Mortgage Calculator</h1>
        <div className="deal-import">
          <select value="" onChange={ev => importDeal(ev.target.value)}>
            <option value="">Load from a saved deal…</option>
            {deals.map((d, i) => <option key={i} value={i}>{d.name} — {money0(d.price)}</option>)}
          </select>
          <button className="btn" onClick={pdf} title="Open a print-ready snapshot — choose “Save as PDF” in the print dialog">⬇ PDF</button>
          <button className="btn" onClick={email} title="Send a text snapshot via your email app">✉ Email</button>
        </div>
      </div>

      <div className="grid">
        {/* LEFT: INPUTS */}
        <div>
          <Card title="Loan" tag="Purchase & terms">
            <div className="row"><label>Home price</label>
              <NumInput value={s.price} onChange={v => set('price', v)} /></div>
            <div className="row"><label>Down payment <span className="sub">{s.downUnit === '%' ? `= ${money0(downAmt)}` : `= ${+downPct.toFixed(1)}%`}</span></label>
              <div className="inline-input">
                <NumInput value={s.down} onChange={v => set('down', v)} fmt="raw" small />
                <UnitToggle options={[{ u: '%', label: '%' }, { u: '$', label: '$' }]} value={s.downUnit} onChange={toggleDownUnit} />
              </div>
            </div>
            <div className="row"><label>Interest rate</label>
              <div className="inline-input">
                <NumInput value={s.rate} onChange={v => set('rate', v)} fmt="raw" small />
                <span className="unit-suffix">%</span>
              </div>
            </div>
            <div className="row"><label>Loan term</label>
              <div className="inline-input">
                <NumInput value={s.term} onChange={v => set('term', v)} fmt="raw" small />
                <span className="unit-suffix">yrs</span>
              </div>
            </div>
            <div className="row">
              <label>Interest-only <span className="sub">pay only interest for a set period</span></label>
              <Switch checked={s.io} onChange={v => set('io', v)} />
            </div>
            <div className={`fin-sub${s.io ? ' on' : ''}`}>
              <div className="row"><label>Interest-only period <span className="sub">set equal to the term for a full-term IO loan (balloon at end)</span></label>
                <div className="inline-input">
                  <NumInput value={s.ioYears} onChange={v => set('ioYears', v)} fmt="raw" small />
                  <span className="unit-suffix">yrs</span>
                </div>
              </div>
            </div>
            <div className="row">
              <label>ARM <span className="sub">adjustable rate — fixed intro period, then adjusts</span></label>
              <Switch checked={s.armOn} onChange={v => set('armOn', v)} />
            </div>
            <div className={`fin-sub${s.armOn ? ' on' : ''}`}>
              <div className="row"><label>Fixed period</label>
                <div className="inline-input">
                  <NumInput value={s.armFixed} onChange={v => set('armFixed', v)} fmt="raw" small />
                  <span className="unit-suffix">yrs</span>
                </div>
              </div>
              <div className="row"><label>Adjusts every</label>
                <select value={s.armFreq} onChange={ev => set('armFreq', +ev.target.value)}>
                  <option value={6}>6 months</option>
                  <option value={12}>12 months</option>
                </select>
              </div>
              <div className="row"><label>Expected rate after adjustment <span className="sub">your estimate of the fully-indexed rate</span></label>
                <div className="inline-input">
                  <NumInput value={s.armRate} onChange={v => set('armRate', v)} fmt="raw" small />
                  <span className="unit-suffix">%</span>
                </div>
              </div>
              <div className="row"><label>Structure</label><span style={{ fontFamily: 'var(--mono)', fontWeight: 600, fontSize: 13 }}>{armTag}</span></div>
            </div>
            <div className="row" style={{ borderTop: '1px dashed var(--line)', marginTop: 6, paddingTop: 11 }}>
              <label>Loan amount</label>
              <span style={{ fontFamily: 'var(--mono)', fontWeight: 600, fontSize: 14 }}>{money0(base.loan)}{s.io ? ' · interest-only' : ''}</span>
            </div>
          </Card>

          <Card title="Monthly Extras" tag="Escrow & fees">
            <div className="row"><label>Property tax <span className="sub">per year</span></label>
              <NumInput value={s.tax} onChange={v => set('tax', v)} /></div>
            <div className="row"><label>Home insurance <span className="sub">per year</span></label>
              <NumInput value={s.ins} onChange={v => set('ins', v)} /></div>
            <div className="row"><label>HOA fees <span className="sub">per month</span></label>
              <NumInput value={s.hoa} onChange={v => set('hoa', v)} /></div>
            <div className="row"><label>PMI rate <span className="sub">annual % of loan · applies under 20% down, drops at 78% LTV</span></label>
              <div className="inline-input">
                <NumInput value={s.pmiRate} onChange={v => set('pmiRate', v)} fmt="raw" small />
                <span className="unit-suffix">%</span>
              </div>
            </div>
          </Card>

          <Card title="Payoff Faster" tag="Optional">
            <div className="row"><label>Extra payment <span className="sub">added to principal every month</span></label>
              <NumInput value={s.extra} onChange={v => set('extra', v)} /></div>
            <div className={`savings-box${s.extra > 0 ? ' show' : ''}`}>
              {s.extra > 0 && <>Paying <b>{money0(s.extra)}/mo</b> extra saves <b>{money0(base.totalInterest - withExtra.totalInterest)}</b> in interest and pays the loan off <b>{fmtYears(base.months - withExtra.months)}</b> sooner.</>}
            </div>
          </Card>
        </div>

        {/* RIGHT: RESULTS */}
        <div>
          <Card title="Monthly Payment" tag="Breakdown">
            <div className="pay-hero">
              <div className="ph-num">{money0(total)}/mo</div>
              <div className="ph-sub">{s.extra > 0
                ? `includes ${money0(s.extra)} extra toward principal`
                : (s.io ? 'interest-only + escrow' : 'principal & interest + escrow')}</div>
            </div>
            <div className="comp-bar">
              {parts.map(p => <div key={p[2]} className={p[2]} style={{ width: `${(p[1] / sum * 100).toFixed(2)}%` }} />)}
            </div>
            <div className="legend">
              {parts.map(p => <span key={p[2]} className="li"><span className={`sw ${p[2]}`} />{p[0]} <b>{money0(p[1])}</b></span>)}
            </div>
            <div className={`arm-note${notes.length ? ' show' : ''}`}>
              {notes.map((n, i) => <div key={i} style={i ? { marginTop: 10 } : undefined}>{n}</div>)}
            </div>
          </Card>

          <div className="tiles" style={{ marginTop: 18 }}>
            <Tile hero label="Total Interest" value={money0(withExtra.totalInterest)}
              note={s.extra > 0 ? 'with extra payments' : 'over the life of the loan'} />
            <Tile label="Total Cost" value={money0(base.loan + withExtra.totalInterest)} note="principal + interest" />
            <Tile label="Payoff Time" value={fmtYears(withExtra.months)}
              note={withExtra.balloon > 0
                ? `balloon of ${money0(withExtra.balloon)} due at term end`
                : s.extra > 0 ? `vs ${fmtYears(base.months)} without extra` : 'with current payments'} />
            <Tile label="PMI" value={pmiM > 0 ? money0(pmiM) : 'None'}
              note={pmiM > 0
                ? `≈ ${money0(withExtra.totalPMI)} total, drops ~year ${Math.max(1, Math.ceil(withExtra.pmiEndMonth / 12))}`
                : downPct >= 20 ? '20%+ down — no PMI' : 'set a PMI rate to include it'} />
          </div>

          <div className="card">
            <h2>Amortization <span className="tag">Year by year</span></h2>
            <div className="body am-scroll">
              <table className="am">
                <thead><tr><th>Year</th><th>Principal Paid</th><th>Interest Paid</th><th>Balance</th></tr></thead>
                <tbody>
                  {withExtra.years.map(y => (
                    <tr key={y.y} className={y.y === pmiDropYear ? 'milestone' : ''}>
                      <td>Year {y.y}</td><td>{money0(y.principal)}</td><td>{money0(y.interest)}</td><td>{money0(y.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="footnote" style={{ padding: '0 18px 14px', marginTop: 0 }}>Highlighted row = the year PMI drops off (loan balance reaches 78% of the home price).</p>
          </div>
        </div>
      </div>

      <p className="footnote">Estimates only. Taxes, insurance and PMI vary by property, credit and lender — confirm with your loan officer before committing.</p>
    </>
  );
}
