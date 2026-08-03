/* ============================================================================
   Deal report — the print-ready document behind the "⬇ PDF" button.

   Numbers only, one letter page. There are deliberately no charts: everything
   the deal was underwritten on is a figure, and figures read faster in a table
   than in a diagram at this density. Every input appears next to the value it
   was entered as, so the report is a complete record of the assumptions.

   The page budget is 725 x 965 css px (letter at 12mm margins). The worst case
   is a deal with all ten expense lines, all six utilities and all five other-
   income sources filled in; the render harness measures it against the budget.

   The report opens in a blank window with no network access, so all CSS is
   inlined and no fonts, scripts or images are fetched.
============================================================================ */

import {
  money, money0, pct, stripZeros, UTIL_LABELS, UTILS,
  OTHER_INC, OTHER_INC_LABELS,
  type DealState, type DealResult,
} from '@reit/core';

const CLR = {
  good: '#0ca30c',
  warn: '#c98500',
  bad: '#c0392b',
  ink: '#111',
  ink2: '#4a4a46',
  muted: '#83817b',
};

export function escapeHtml(str: unknown): string {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* a row in one of the figure tables: label · as-entered · amount */
type Row = [label: string, entered: string, amount: string, cls?: string];
const rows = (rs: (Row | null)[]) => rs.filter(Boolean).map(r => {
  const [l, e, a, cls] = r as Row;
  return `<tr class="${cls || ''}"><th>${escapeHtml(l)}</th><td class="en">${escapeHtml(e)}</td><td class="am">${escapeHtml(a)}</td></tr>`;
}).join('');

/* ------------------------------------------------------------- stylesheet */

export const REPORT_STYLES = `
:root {
  --ink:${CLR.ink}; --ink2:${CLR.ink2}; --muted:${CLR.muted};
  --rule:#e8e7e1; --rule-2:#c6c5be; --panel:#f7f7f4;
  --sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  --serif: 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, 'Times New Roman', serif;
}
* { box-sizing:border-box; margin:0; padding:0; }
html { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
body {
  font-family:var(--sans); color:var(--ink); background:#eceae5;
  font-size:11.5px; line-height:1.34; padding:20px 12px 48px;
  -webkit-print-color-adjust:exact; print-color-adjust:exact;
}
/* 8.5in page less 12mm side margins ≈ 725px of live width */
.sheet { width:725px; margin:0 auto; background:#fff; padding:22px 26px 18px;
  box-shadow:0 1px 3px rgba(0,0,0,.08), 0 12px 40px rgba(0,0,0,.10); }

.bar { width:725px; margin:0 auto 12px; display:flex; gap:10px; align-items:center; justify-content:flex-end; }
.bar .hint { margin-right:auto; font-size:11px; color:#6a6862; }
.bar button { font:600 12px var(--sans); padding:8px 16px; border-radius:7px; border:1px solid #1d6a5a;
  background:#1d6a5a; color:#fff; cursor:pointer; }
.bar button:hover { background:#145144; }

/* ---- masthead ---- */
.mast { display:flex; align-items:flex-start; justify-content:space-between; gap:16px;
  border-bottom:1.5px solid var(--ink); padding-bottom:8px; }
/* the sheet is a fixed one-page budget, so the masthead may never grow a second
   line — a long deal name or address is clipped rather than wrapped */
.mast > div { min-width:0; }
.mast .brand, .mast h1, .mast .sub { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.mast .brand { font:600 8.5px var(--sans); letter-spacing:.15em; text-transform:uppercase; color:var(--muted); }
.mast h1 { font-family:var(--serif); font-size:22px; line-height:1.1; font-weight:600; margin:3px 0 2px; }
.mast .sub { font-size:10.5px; color:var(--ink2); }
.mast .sub b { color:var(--ink); font-weight:600; }
.pill { flex:none; font:700 9px var(--sans); letter-spacing:.07em; text-transform:uppercase;
  color:#fff; padding:5px 11px; border-radius:99px; white-space:nowrap; margin-top:3px; }
.p-good { background:${CLR.good}; } .p-ok { background:#b8860b; } .p-bad { background:${CLR.bad}; }

/* ---- KPI strip ---- */
.kpis { display:grid; grid-template-columns:repeat(6,1fr); gap:6px; margin:10px 0 11px; }
.kpi { border:1px solid var(--rule); border-radius:7px; padding:7px 8px 8px; }
.kpi.hero { background:var(--panel); border-color:var(--rule-2); }
.kpi .k-l { font:600 8px var(--sans); letter-spacing:.07em; text-transform:uppercase; color:var(--muted); }
.kpi .k-v { font-size:17.5px; font-weight:650; letter-spacing:-.02em; margin-top:3px; white-space:nowrap; }
.kpi .k-n { font-size:8px; color:var(--muted); margin-top:2px; }
.k-v.pos { color:#0d6b4f; } .k-v.neg { color:${CLR.bad}; }
.flag { display:inline-block; width:6px; height:6px; border-radius:50%; margin-right:4px; vertical-align:middle; }

/* ---- blocks ---- */
.cols { display:grid; grid-template-columns:0.94fr 1.06fr; gap:16px; align-items:start; }
.blk { break-inside:avoid; }
.blk + .blk { margin-top:10px; }
h2 { font:600 8.5px var(--sans); letter-spacing:.13em; text-transform:uppercase; color:var(--muted);
  border-bottom:1px solid var(--rule-2); padding-bottom:3px; margin-bottom:4px;
  display:flex; justify-content:space-between; align-items:baseline; gap:10px; }
h2 span { font-weight:500; letter-spacing:.03em; text-transform:none; font-size:9.5px;
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }

/* ---- tables ---- */
table { width:100%; border-collapse:collapse; font-variant-numeric:tabular-nums; }
tbody th { text-align:left; font-weight:400; color:var(--ink); padding:2.6px 0; white-space:nowrap; }
td.en { text-align:right; color:var(--muted); font-size:10px; padding:2.6px 9px 2.6px 7px;
  white-space:normal; }
td.am { text-align:right; font-weight:600; padding:2.6px 0; white-space:nowrap; width:82px; }
tr.sub th, tr.sub td { border-top:1px solid var(--rule-2); font-weight:700; padding-top:3.8px; }
tr.sub th { font-weight:700; }
tr.tot th, tr.tot td { border-top:1.5px solid var(--ink); font-weight:800; font-size:12.5px; padding-top:4.2px; }
tr.neg td.am { color:${CLR.bad}; }

/* ---- pro-forma ---- */
.pf th, .pf td { padding:2.8px 0; }
.pf thead th { font:600 8px var(--sans); letter-spacing:.07em; text-transform:uppercase; color:var(--muted);
  border-bottom:1px solid var(--rule-2); text-align:right; padding-bottom:3px; }
.pf thead th:first-child { text-align:left; }
.pf tbody th { font-weight:400; }
.pf tbody td { text-align:right; font-weight:600; width:16.5%; }
.pf tbody tr:nth-child(even) { background:#fafaf8; }
.pf tr.em th, .pf tr.em td { font-weight:800; }
.pf tr.rule th, .pf tr.rule td { border-top:1px solid var(--rule-2); }
.pf td.neg { color:${CLR.bad}; }

/* ---- assumptions, two across ---- */
.agrid { display:grid; grid-template-columns:1fr 1fr; gap:0 18px; }
.agrid div { display:flex; justify-content:space-between; align-items:baseline; gap:8px;
  padding:2.6px 0; border-bottom:1px solid #f3f2ed; min-width:0; }
.agrid span { color:var(--ink); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.agrid b { font-weight:600; white-space:nowrap; font-variant-numeric:tabular-nums; }

.note { margin-top:11px; padding-top:6px; border-top:1px solid var(--rule); font-size:8.5px;
  color:var(--muted); line-height:1.45; }

@media print {
  body { background:#fff; padding:0; }
  .sheet { box-shadow:none; width:auto; padding:0; }
  .noprint { display:none !important; }
}
@page { size:letter; margin:12mm; }
`;

/* ============================================================ the document */

export interface ReportInput {
  s: DealState;                 /* effective state — rehab already synced to the SoW */
  r: DealResult;
  verdict: { cls: 'good' | 'ok' | 'bad'; title: string; sub: string };
  sowTotal: number;
}

export function buildRentalReport({ s, r, verdict }: ReportInput): string {
  const name = s.name?.trim() || 'Untitled deal';
  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  const gross = r.gross;
  const capRate = (s.price + s.rehab) > 0 ? r.noi * 12 / (s.price + s.rehab) * 100 : NaN;
  const sqft = parseFloat(String(s.prop.sqft).replace(/[^0-9.]/g, ''));
  const hasDebt = r.pi > 0.5;
  const neg = (v: number) => `−${money0(v)}`;

  /* ------------------------------------------------- acquisition & closing */
  const acqRows = rows([
    ['Purchase price', sqft > 0 ? `$${Math.round(s.price / sqft)}/sqft` : '', money0(s.price)],
    ['Down payment', `${stripZeros(pct(s.downPct, 1))} of price`, money0(r.downAmt)],
    ['Rehab / repairs', s.sow.length ? `Scope of Work · ${s.sow.length} items` : '', money0(s.rehab)],
    /* the middle column carries the assumption behind the figure — when a value
       was typed in dollars there is nothing to add, so it stays empty */
    ['Closing costs', s.closingUnit === '%' ? `${stripZeros(pct(s.closing, 2))} of price` : '', money0(r.closingAmt)],
    ['Total cash to close', '', money0(r.cashInvested), 'tot'],
  ]);

  /* ----------------------------------------------------------- financing */
  const loanTerms = [
    stripZeros(pct(s.rate, 3)),
    `${+s.term} yr`,
    s.ioOn ? `interest-only ${+s.ioYears} yr` : null,
    s.armOn ? `${+s.armFixed}/${s.armFreq === 6 ? 6 : 1} ARM → ${stripZeros(pct(s.armRate, 3))}` : null,
  ].filter(Boolean).join(' · ');

  /* the down payment lives in Acquisition — this block is only the borrowed money */
  const finRows = rows(r.newLoan > 0 || r.sellerAmt > 0 || r.subtoBal > 0 ? [
    r.newLoan > 0 ? ['New loan (bank)', loanTerms, money0(r.newLoan)] : null,
    r.sellerAmt > 0 ? ['Seller financing', `${stripZeros(pct(s.sellerRate, 3))} · ${+s.sellerTerm} yr · ${s.sellerType === 'io' ? 'interest-only' : 'amortizing'}`, money0(r.sellerAmt)] : null,
    r.subtoBal > 0 ? ['Subject-to (assumed)', `${stripZeros(pct(s.subtoRate, 3))} · ${+s.subtoTerm} yr left`, money0(r.subtoBal)] : null,
    ['Monthly debt service', `DSCR ${isFinite(r.dscr) ? r.dscr.toFixed(2) : '—'}`, `${money0(r.pi)}/mo`, 'tot'],
  ] : [
    ['All cash — no financing', 'the down payment covers the full price', money0(s.price)],
    ['Monthly debt service', 'debt-free', '$0/mo', 'tot'],
  ]);

  /* ---------------------------------------------- growth & exit assumptions
     Two across rather than one per row: these are short label/value pairs, and
     the left column would otherwise drive the page height on deals with few
     expense lines. */
  const assumeGrid = `<div class="agrid">${([
    ['Vacancy', stripZeros(pct(s.vacancy, 1))],
    ['Rent growth', stripZeros(pct(s.rentGrowth, 2)) + '/yr'],
    ['Expense growth', stripZeros(pct(s.expGrowth, 2)) + '/yr'],
    ['Appreciation', stripZeros(pct(s.appr, 2)) + '/yr'],
    ['Selling costs at exit', stripZeros(pct(s.sellCost, 1))],
    ['Year-5 exit profit', money(r.totalProfit)],
  ] as [string, string][]).map(([l, v]) =>
    `<div><span>${escapeHtml(l)}</span><b>${escapeHtml(v)}</b></div>`).join('')}</div>`;

  /* ------------------------------------------- monthly operating statement */
  const enteredExp = (unit: string, raw: number) =>
    unit === '%' ? `${stripZeros(pct(raw, 2))} of rent`
      : unit === 'yr' ? `${money0(raw)}/yr`
        : `${money0(raw)}/mo`;
  const otherIncNote = OTHER_INC.filter(k => (s.otherInc[k] || 0) > 0)
    .map(k => `${OTHER_INC_LABELS[k]} ${money0(s.otherInc[k])}`).join(' · ');
  const utilNote = UTILS.filter(k => (s.utils[k] || 0) > 0)
    .map(k => `${UTIL_LABELS[k]} ${money0(s.utilUnits?.[k] === 'yr' ? s.utils[k] / 12 : s.utils[k])}`).join(' · ');

  const opsRows = rows([
    ['Gross monthly rent', `${money0(s.rent)}/mo entered`, money0(s.rent)],
    r.otherIncTotal > 0 ? ['Other income', otherIncNote, money0(r.otherIncTotal)] : null,
    ['Vacancy loss', `${stripZeros(pct(s.vacancy, 1))} of rent`, neg(r.vacLoss), 'neg'],
    ['Effective gross income', '', money0(r.effIncome), 'sub'],
    ...r.expLines.filter(e => e.monthly > 0)
      .map(e => [e.label, enteredExp(e.unit, e.raw), neg(e.monthly), 'neg'] as Row),
    r.utilTotal > 0 ? ['Utilities (owner-paid)', utilNote, neg(r.utilTotal), 'neg'] : null,
    ['Total operating expenses', `${pct(gross > 0 ? r.opEx / gross * 100 : 0, 0)} of gross income`, neg(r.opEx), 'sub neg'],
    ['Net operating income', `cap rate ${isFinite(capRate) ? pct(capRate, 2) : '—'}`, money(r.noi), 'sub'],
    hasDebt ? ['Debt service', '', neg(r.pi), 'neg'] : null,
    ['Monthly cash flow', `annual ${money(r.annualCF)}`, money(r.cashFlow), 'tot'],
  ]);

  /* ------------------------------------------------------------ pro-forma */
  const yDscr = (y: typeof r.years[0]) => y.yDebt > 0.5 ? (y.yNOI / y.yDebt).toFixed(2) : '∞';
  const pf = `<table class="pf">
    <thead><tr><th>Annual pro-forma</th>${r.years.map(y => `<th>Year ${y.y}</th>`).join('')}</tr></thead>
    <tbody>
      <tr><th>Gross rent &amp; other income</th>${r.years.map(y => `<td>${money0(y.yRent + y.yOther)}</td>`).join('')}</tr>
      <tr><th>Vacancy &amp; operating expenses</th>${r.years.map(y => `<td class="neg">−${money0(y.yVac + y.yOpEx)}</td>`).join('')}</tr>
      <tr class="em"><th>Net operating income</th>${r.years.map(y => `<td>${money0(y.yNOI)}</td>`).join('')}</tr>
      <tr><th>Debt service</th>${r.years.map(y => `<td class="${y.yDebt > 0.5 ? 'neg' : ''}">${y.yDebt > 0.5 ? '−' + money0(y.yDebt) : '$0'}</td>`).join('')}</tr>
      <tr class="em"><th>Cash flow</th>${r.years.map(y => `<td class="${y.yCF < 0 ? 'neg' : ''}">${money(y.yCF)}</td>`).join('')}</tr>
      <tr><th>Cumulative cash flow</th>${r.years.map(y => `<td class="${y.cumCF < 0 ? 'neg' : ''}">${money(y.cumCF)}</td>`).join('')}</tr>
      <tr class="em"><th>DSCR</th>${r.years.map(y => `<td>${yDscr(y)}</td>`).join('')}</tr>
      <tr class="rule"><th>Property value</th>${r.years.map(y => `<td>${money0(y.value)}</td>`).join('')}</tr>
      <tr><th>Loan balances</th>${r.years.map(y => `<td>${money0(y.bal)}</td>`).join('')}</tr>
      <tr class="em"><th>Equity</th>${r.years.map(y => `<td>${money0(y.equity)}</td>`).join('')}</tr>
    </tbody></table>`;

  /* ------------------------------------------------------------ KPI strip */
  const flag = (st: 'good' | 'ok' | 'bad') =>
    `<span class="flag" style="background:${st === 'good' ? CLR.good : st === 'ok' ? CLR.warn : CLR.bad}"></span>`;
  const cocSt = r.coc >= 8 ? 'good' : r.coc >= 4 ? 'ok' : 'bad';
  const dscrSt = !isFinite(r.dscr) || r.dscr >= 1.25 ? 'good' : r.dscr >= 1 ? 'ok' : 'bad';

  const kpis = `<div class="kpis">
    <div class="kpi hero"><div class="k-l">Cash-on-cash</div>
      <div class="k-v ${r.coc >= 0 ? 'pos' : 'neg'}">${flag(cocSt)}${isFinite(r.coc) ? pct(r.coc, 1) : '—'}</div>
      <div class="k-n">yr-1 CF ÷ cash in</div></div>
    <div class="kpi"><div class="k-l">Cash flow</div>
      <div class="k-v ${r.cashFlow >= 0 ? 'pos' : 'neg'}">${money(r.cashFlow)}</div>
      <div class="k-n">per month</div></div>
    <div class="kpi"><div class="k-l">DSCR</div>
      <div class="k-v">${flag(dscrSt)}${isFinite(r.dscr) ? r.dscr.toFixed(2) : '∞'}</div>
      <div class="k-n">lenders want ≥ 1.25</div></div>
    <div class="kpi"><div class="k-l">Cap rate</div>
      <div class="k-v">${isFinite(capRate) ? pct(capRate, 2) : '—'}</div>
      <div class="k-n">NOI ÷ price + rehab</div></div>
    <div class="kpi"><div class="k-l">5-yr ROI</div>
      <div class="k-v ${r.roi5 >= 0 ? 'pos' : 'neg'}">${isFinite(r.roi5) ? pct(r.roi5, 0) : '—'}</div>
      <div class="k-n">CF + equity + appr.</div></div>
    <div class="kpi"><div class="k-l">Cash to close</div>
      <div class="k-v">${money0(r.cashInvested)}</div>
      <div class="k-n">out of pocket</div></div>
  </div>`;

  const facts = [
    s.prop.beds && `${escapeHtml(s.prop.beds)} bd`,
    s.prop.baths && `${escapeHtml(s.prop.baths)} ba`,
    sqft > 0 && `${Math.round(sqft).toLocaleString('en-US')} sqft`,
    s.prop.year && `built ${escapeHtml(s.prop.year)}`,
  ].filter(Boolean).join(' · ');

  /* --------------------------------------------------------------- assemble */
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Deal Report — ${escapeHtml(name)}</title>
<style>${REPORT_STYLES}</style></head>
<body>
<div class="bar noprint">
  <span class="hint">One page — choose <b>“Save as PDF”</b> in the print dialog.</span>
  <button onclick="window.print()">🖨 Print / Save as PDF</button>
</div>

<div class="sheet">
  <header class="mast">
    <div>
      <div class="brand">Rental Property Analysis · Real Estate Investor Toolkit</div>
      <h1>${escapeHtml(name)}</h1>
      <div class="sub">${s.prop.address ? `<b>${escapeHtml(s.prop.address)}</b>` : ''}${s.prop.address && facts ? ' · ' : ''}${facts}${(s.prop.address || facts) ? ' · ' : ''}Prepared ${date}</div>
    </div>
    <span class="pill p-${verdict.cls}">${verdict.cls === 'good' ? 'Strong' : verdict.cls === 'ok' ? 'Marginal' : 'Negative'}</span>
  </header>

  ${kpis}

  <div class="cols">
    <div>
      <div class="blk">
        <h2>Acquisition <span>what you pay</span></h2>
        <table><tbody>${acqRows}</tbody></table>
      </div>
      <div class="blk">
        <h2>Financing <span>${hasDebt ? 'as assumed' : 'all cash'}</span></h2>
        <table><tbody>${finRows}</tbody></table>
      </div>
      <div class="blk">
        <h2>Growth &amp; exit assumptions <span>applied to every year below</span></h2>
        ${assumeGrid}
      </div>
    </div>
    <div class="blk">
      <h2>Monthly operating statement <span>year 1 · as entered</span></h2>
      <table><tbody>${opsRows}</tbody></table>
    </div>
  </div>

  <div class="blk" style="margin-top:12px">
    <h2>Five-year pro-forma <span>rent +${stripZeros(pct(s.rentGrowth, 2))} · expenses +${stripZeros(pct(s.expGrowth, 2))} · value +${stripZeros(pct(s.appr, 2))} per year</span></h2>
    ${pf}
  </div>

  <p class="note"><b>${escapeHtml(verdict.title)}</b> — ${escapeHtml(verdict.sub)}
  Screening estimates only: verify taxes, insurance, rents and rehab costs locally before offering. Percentage-based expenses apply to gross
  scheduled rent, and NOI includes the CapEx reserve, so this DSCR is the conservative view. Generated ${date} · Real Estate Investor Toolkit.</p>
</div>
</body></html>`;
}
