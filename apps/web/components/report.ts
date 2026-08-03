/* ============================================================================
   Deal report — the print-ready document behind the "⬇ PDF" button.

   Hard constraint: the whole report is ONE letter page. Everything the deal was
   underwritten on has to fit — every input as it was entered, the monthly
   operating statement, the financing, and a five-year pro-forma — so the layout
   is dense by design and the type is sized to fill the page rather than spill
   onto a second. `measureReportHeight` in the render harness checks this.

   The report opens in a blank window with no network access, so everything is
   self-contained: all CSS is inlined and the three diagrams are hand-built SVG.
   No canvas, no chart library, no web fonts.

   Chart colors are role-based and fixed across the sheet so the same thing is
   always the same color: your cash is aqua, lender debt is blue, operating
   expenses are orange, vacancy is yellow. The stacking orders were checked for
   colorblind separation against a white surface; every segment is also labeled
   and repeated in a table, so color never carries meaning alone.
============================================================================ */

import {
  money, money0, pct, stripZeros, UTIL_LABELS, UTILS,
  OTHER_INC, OTHER_INC_LABELS,
  type DealState, type DealResult,
} from '@reit/core';

/* ---------------------------------------------------------------- palette */

const CLR = {
  cash: '#1baf7a',   /* your money — down payment, equity, cash flow */
  debt: '#2a78d6',   /* lender debt — new loan, balances, debt service */
  opex: '#eb6834',   /* operating expenses */
  vac: '#eda100',    /* vacancy loss */
  extra: '#4a3aa7',  /* seller carry */
  extra2: '#e87ba4', /* subject-to */
  bad: '#d03b3b',
  good: '#0ca30c',
  warn: '#fab219',
  ink: '#0b0b0b',
  ink2: '#52514e',
  muted: '#898781',
  grid: '#e1e0d9',
  axis: '#c3c2b7',
};

/* ------------------------------------------------------------ primitives */

const VW = 700;                       /* both diagrams share one viewBox width */
let uid = 0;
const nextId = () => `g${++uid}`;

export function escapeHtml(str: unknown): string {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* compact money for chart labels: $840 · $12.4k · $1.2M */
function kMoney(n: number): string {
  const a = Math.abs(n), sign = n < 0 ? '−' : '';
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e4) return `${sign}$${Math.round(a / 1e3)}k`;
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(1)}k`;
  return `${sign}$${Math.round(a)}`;
}

/* vertical bar anchored at a baseline, rounded data-end */
function vBar(x: number, w: number, base: number, h: number, r = 3): string {
  if (h < 0.6) return `M${x},${base - 0.6}h${w}v1.2h${-w}Z`;
  const rr = Math.max(0, Math.min(r, w / 2, h));
  const top = base - h;
  if (rr < 1) return `M${x},${top}h${w}v${h}h${-w}Z`;
  return `M${x},${base}V${top + rr}A${rr},${rr} 0 0 1 ${x + rr},${top}` +
    `H${x + w - rr}A${rr},${rr} 0 0 1 ${x + w},${top + rr}V${base}Z`;
}

const txt = (x: number, y: number, s: string, cls: string, anchor = 'middle') =>
  `<text x="${x}" y="${y}" class="${cls}" text-anchor="${anchor}">${escapeHtml(s)}</text>`;

function niceStep(range: number, target = 3): number {
  if (!(range > 0)) return 1;
  const raw = range / target;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
}

/* -------------------------------------------------- diagram: stacked H bar */

interface Seg { label: string; value: number; color: string; note?: string }

/* One horizontal bar split into segments, 2px surface gaps, optional dashed
   marker for where 100% of gross income falls when costs run past it. */
function stackedHBar(segs: Seg[], opts: { barH?: number; markerAt?: number; pctOf?: number } = {}): string {
  const live = segs.filter(s => s.value > 0);
  const total = live.reduce((t, s) => t + s.value, 0);
  if (!(total > 0)) return '';
  const denom = opts.pctOf && opts.pctOf > 0 ? opts.pctOf : total;
  const barH = opts.barH ?? 26;
  const head = opts.markerAt ? 13 : 0;
  const H = head + barH;
  const id = nextId();
  const sc = VW / total;

  let acc = 0;
  const rects = live.map((s, i) => {
    const x0 = acc * sc, w = s.value * sc;
    acc += s.value;
    const x = x0 + (i > 0 ? 1 : 0);
    const wd = (x0 + w) - x - (i < live.length - 1 ? 1 : 0);
    if (wd < 0.4) return '';
    const label = wd >= 40 ? txt(x + wd / 2, head + barH / 2 + 3.5, `${Math.round(s.value / denom * 100)}%`, 'seg-pct') : '';
    return `<rect x="${x.toFixed(1)}" y="${head}" width="${wd.toFixed(1)}" height="${barH}" fill="${s.color}"/>${label}`;
  }).join('');

  let marker = '';
  if (opts.markerAt && opts.markerAt > 0 && opts.markerAt < total) {
    const mx = opts.markerAt * sc;
    marker = `<line x1="${mx.toFixed(1)}" y1="${head - 5}" x2="${mx.toFixed(1)}" y2="${H}" class="marker-line"/>` +
      txt(Math.min(mx, VW - 2), head - 7, 'gross income', 'marker-lbl', mx > VW - 110 ? 'end' : 'start');
  }

  return `<svg viewBox="0 0 ${VW} ${H}" class="chart" role="img" preserveAspectRatio="none">
    <defs><clipPath id="${id}"><rect x="0" y="${head}" width="${VW}" height="${barH}" rx="4"/></clipPath></defs>
    <g clip-path="url(#${id})">${rects}</g>${marker}
  </svg>`;
}

/* ------------------------------------------- diagram: stacked columns */

/* Loan balance + equity = projected property value, year by year. */
function equityColumns(cols: { label: string; bal: number; eq: number; cap: string }[], height = 58): string {
  if (!cols.length) return '';
  const padT = 16, padB = 15, H = padT + height + padB;
  const max = Math.max(...cols.map(c => c.bal + c.eq)) || 1;
  const step = niceStep(max, 3);
  const y = (v: number) => padT + (1 - v / max) * height;
  const grid: string[] = [];
  for (let g = 0; g <= max + 1e-6; g += step)
    grid.push(`<line x1="0" y1="${y(g).toFixed(1)}" x2="${VW}" y2="${y(g).toFixed(1)}" class="${g === 0 ? 'zero-line' : 'grid-line'}"/>`);
  const slot = VW / cols.length, bw = Math.min(58, slot * 0.46);
  const body = cols.map((c, i) => {
    const cx = slot * (i + 0.5), x = cx - bw / 2;
    const total = c.bal + c.eq;
    const base = y(0);
    let out = '';
    if (c.bal > 0) out += `<rect x="${x}" y="${y(c.bal).toFixed(1)}" width="${bw}" height="${(base - y(c.bal)).toFixed(1)}" fill="${CLR.debt}"/>`;
    if (c.eq > 0) out += `<path d="${vBar(x, bw, y(c.bal) - 1, Math.max(0, y(c.bal) - 1 - y(total)))}" fill="${CLR.cash}"/>`;
    return out + txt(cx, y(total) - 5, c.cap, 'val-lbl-c') + txt(cx, H - 4, c.label, 'ax-lbl-c');
  }).join('');
  return `<svg viewBox="0 0 ${VW} ${H}" class="chart" role="img" preserveAspectRatio="xMidYMid meet">${grid.join('')}${body}</svg>`;
}

/* -------------------------------------------------------------- fragments */

const swatches = (items: { label: string; value: string; color: string }[]) =>
  `<div class="keys">${items.map(i =>
    `<span class="key"><i style="background:${i.color}"></i>${escapeHtml(i.label)}<b>${escapeHtml(i.value)}</b></span>`).join('')}</div>`;

/* a row in one of the dense figure tables: label · as-entered · amount */
type Row = [label: string, entered: string, amount: string, cls?: string];
const rows = (rs: (Row | null)[]) => rs.filter(Boolean).map(r => {
  const [l, e, a, cls] = r as Row;
  return `<tr class="${cls || ''}"><th>${escapeHtml(l)}</th><td class="en">${escapeHtml(e)}</td><td class="am">${escapeHtml(a)}</td></tr>`;
}).join('');

/* ------------------------------------------------------------- stylesheet */

export const REPORT_STYLES = `
:root {
  --ink:${CLR.ink}; --ink2:${CLR.ink2}; --muted:${CLR.muted};
  --rule:#e8e7e1; --rule-2:#c9c8c1; --panel:#f7f7f4;
  --sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  --serif: 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, 'Times New Roman', serif;
}
* { box-sizing:border-box; margin:0; padding:0; }
html { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
body {
  font-family:var(--sans); color:var(--ink); background:#eceae5;
  font-size:10.5px; line-height:1.35; padding:20px 12px 48px;
  -webkit-print-color-adjust:exact; print-color-adjust:exact;
}
/* 8.5in page less 12mm side margins ≈ 725px of live width */
.sheet { width:725px; margin:0 auto; background:#fff; padding:22px 24px 18px;
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
   line — a long deal name or address is clipped rather than allowed to push the
   pro-forma onto page two */
.mast > div { min-width:0; }
.mast .brand, .mast h1, .mast .sub { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.mast .brand { font:600 8px var(--sans); letter-spacing:.15em; text-transform:uppercase; color:var(--muted); }
.mast h1 { font-family:var(--serif); font-size:20px; line-height:1.1; font-weight:600; margin:3px 0 2px; }
.mast .sub { font-size:9.5px; color:var(--ink2); }
.mast .sub b { color:var(--ink); font-weight:600; }
.pill { flex:none; font:700 8.5px var(--sans); letter-spacing:.07em; text-transform:uppercase;
  color:#fff; padding:4px 9px; border-radius:99px; white-space:nowrap; margin-top:2px; }
.p-good { background:${CLR.good}; } .p-ok { background:#b8860b; } .p-bad { background:${CLR.bad}; }

/* ---- KPI strip ---- */
.kpis { display:grid; grid-template-columns:repeat(6,1fr); gap:6px; margin:9px 0 10px; }
.kpi { border:1px solid var(--rule); border-radius:7px; padding:6px 7px 7px; }
.kpi.hero { background:var(--panel); border-color:var(--rule-2); }
.kpi .k-l { font:600 7.5px var(--sans); letter-spacing:.07em; text-transform:uppercase; color:var(--muted); }
.kpi .k-v { font-size:16px; font-weight:650; letter-spacing:-.02em; margin-top:2px; white-space:nowrap; }
.kpi .k-n { font-size:7.5px; color:var(--muted); margin-top:1px; }
.k-v.pos { color:#0d6b4f; } .k-v.neg { color:${CLR.bad}; }
.flag { display:inline-block; width:5px; height:5px; border-radius:50%; margin-right:3px; vertical-align:middle; }

/* ---- figure blocks ---- */
/* the operating statement carries the most text, so it gets the wider column */
.cols { display:grid; grid-template-columns:0.92fr 1.08fr; gap:14px; align-items:start; }
.blk { break-inside:avoid; }
.blk + .blk { margin-top:9px; }
h2 { font:600 8px var(--sans); letter-spacing:.13em; text-transform:uppercase; color:var(--muted);
  border-bottom:1px solid var(--rule-2); padding-bottom:2.5px; margin-bottom:3px;
  display:flex; justify-content:space-between; align-items:baseline; }
h2 span { font-weight:500; letter-spacing:.03em; text-transform:none; font-size:8.5px; }

/* ---- dense tables ---- */
table { width:100%; border-collapse:collapse; font-variant-numeric:tabular-nums; }
tbody th { text-align:left; font-weight:400; color:var(--ink); padding:2px 0; white-space:nowrap; }
td.en { text-align:right; color:var(--muted); font-size:9px; padding:2px 8px 2.2px 6px; white-space:nowrap;
  overflow:hidden; text-overflow:ellipsis; max-width:150px; }
td.am { text-align:right; font-weight:600; padding:2px 0; white-space:nowrap; width:74px; }
tr.sub th, tr.sub td { border-top:1px solid var(--rule-2); font-weight:700; padding-top:3px; }
tr.sub th { font-weight:700; }
tr.tot th, tr.tot td { border-top:1.5px solid var(--ink); font-weight:800; font-size:11.5px; padding-top:3.5px; }
tr.neg td.am { color:${CLR.bad}; }
tr.dim th, tr.dim td { color:var(--muted); }
/* loan terms (rate · term · interest-only · ARM) are the one "as entered" value
   that must never be clipped — it is the financing assumption itself */
.terms td.en { white-space:normal; overflow:visible; text-overflow:clip; max-width:none; }

/* ---- pro-forma ---- */
.pf th, .pf td { padding:2.4px 0; }
.pf thead th { font:600 7.5px var(--sans); letter-spacing:.07em; text-transform:uppercase; color:var(--muted);
  border-bottom:1px solid var(--rule-2); text-align:right; padding-bottom:2.5px; }
.pf thead th:first-child { text-align:left; }
.pf tbody th { font-weight:400; }
.pf tbody td { text-align:right; font-weight:600; width:17%; }
.pf tbody tr:nth-child(even) { background:#fafaf8; }
.pf tr.em th, .pf tr.em td { font-weight:800; }
.pf tr.rule th, .pf tr.rule td { border-top:1px solid var(--rule-2); }
.pf td.neg { color:${CLR.bad}; }

/* ---- assumptions strip ---- */
.assume { display:flex; flex-wrap:wrap; gap:0; border:1px solid var(--rule); border-radius:7px; overflow:hidden; }
.assume div { flex:1 1 0; padding:5px 8px; border-right:1px solid var(--rule); min-width:0; }
.assume div:last-child { border-right:none; }
.assume .a-l { font:600 7.5px var(--sans); letter-spacing:.06em; text-transform:uppercase; color:var(--muted); white-space:nowrap; }
.assume .a-v { font-size:11.5px; font-weight:650; margin-top:1px; }

/* ---- diagrams ---- */
.chart { display:block; width:100%; height:auto; overflow:visible; }
.grid-line { stroke:${CLR.grid}; stroke-width:1; }
.zero-line { stroke:${CLR.axis}; stroke-width:1; }
.marker-line { stroke:${CLR.ink2}; stroke-width:1; stroke-dasharray:2.5 2; }
text { font-family:var(--sans); }
.seg-pct { font-size:10px; font-weight:650; fill:#fff; }
.ax-lbl-c { font-size:9px; fill:${CLR.ink2}; }
.val-lbl-c { font-size:9px; font-weight:650; fill:${CLR.ink}; }
.marker-lbl { font-size:8px; font-weight:600; fill:${CLR.ink2}; }
.keys { display:flex; flex-wrap:wrap; gap:3px 12px; margin-top:4px; }
.key { display:inline-flex; align-items:baseline; gap:4px; font-size:9px; color:var(--ink2); white-space:nowrap; }
.key i { width:7px; height:7px; border-radius:2px; flex:none; transform:translateY(1px); }
.key b { font-weight:650; color:var(--ink); font-variant-numeric:tabular-nums; }

.note { margin-top:8px; padding-top:5px; border-top:1px solid var(--rule); font-size:7.5px; color:var(--muted); line-height:1.4; }

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

export function buildRentalReport({ s, r, verdict, sowTotal }: ReportInput): string {
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
    ['Down payment', stripZeros(pct(s.downPct, 1)) + ' of price', money0(r.downAmt)],
    ['Rehab / repairs', s.sow.length ? `Scope of Work · ${s.sow.length} items` : 'entered manually', money0(s.rehab)],
    ['Closing costs', s.closingUnit === '%' ? `${stripZeros(pct(s.closing, 2))} of price` : 'entered as a dollar amount', money0(r.closingAmt)],
    ['Total cash to close', '', money0(r.cashInvested), 'tot'],
  ]);

  /* ----------------------------------------------------------- financing */
  const loanTerms = [
    stripZeros(pct(s.rate, 3)),
    `${+s.term} yr`,
    s.ioOn ? `interest-only ${+s.ioYears} yr` : null,
    s.armOn ? `${+s.armFixed}/${s.armFreq === 6 ? 6 : 1} ARM → ${stripZeros(pct(s.armRate, 3))}` : null,
  ].filter(Boolean).join(' · ');

  const finRows = rows(hasDebt || r.newLoan > 0 ? [
    r.newLoan > 0 ? ['New loan (bank)', loanTerms, money0(r.newLoan)] : null,
    r.sellerAmt > 0 ? ['Seller financing', `${stripZeros(pct(s.sellerRate, 3))} · ${+s.sellerTerm} yr · ${s.sellerType === 'io' ? 'interest-only' : 'amortizing'}`, money0(r.sellerAmt)] : null,
    r.subtoBal > 0 ? ['Subject-to (assumed)', `${stripZeros(pct(s.subtoRate, 3))} · ${+s.subtoTerm} yr left`, money0(r.subtoBal)] : null,
    ['Monthly debt service', hasDebt ? `DSCR ${isFinite(r.dscr) ? r.dscr.toFixed(2) : '—'}` : '', `${money0(r.pi)}/mo`, 'tot'],
  ] : [
    ['All cash — no financing', 'down payment covers the full price', money0(s.price)],
    ['Monthly debt service', 'debt-free', '$0/mo', 'tot'],
  ]);

  const finSegs: Seg[] = [
    { label: 'Down payment', value: r.downAmt, color: CLR.cash },
    { label: 'New loan', value: r.newLoan, color: CLR.debt },
    { label: 'Seller carry', value: r.sellerAmt, color: CLR.extra },
    { label: 'Subject-to', value: r.subtoBal, color: CLR.extra2 },
  ];

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
    ['Total operating expenses', `${pct(gross > 0 ? r.opEx / gross * 100 : 0, 0)} of gross`, neg(r.opEx), 'sub neg'],
    ['Net operating income', `cap rate ${isFinite(capRate) ? pct(capRate, 2) : '—'}`, money(r.noi), 'sub'],
    hasDebt ? ['Debt service', '', neg(r.pi), 'neg'] : null,
    ['Monthly cash flow', '', money(r.cashFlow), 'tot'],
  ]);

  /* -------------------------------------------- where each rent dollar goes */
  const shortfall = r.cashFlow < 0 ? -r.cashFlow : 0;
  const splitSegs: Seg[] = [
    { label: 'Vacancy', value: r.vacLoss, color: CLR.vac },
    { label: 'Operating expenses', value: r.opEx, color: CLR.opex },
    { label: 'Debt service', value: r.pi, color: CLR.debt },
    shortfall > 0
      ? { label: 'Shortfall', value: shortfall, color: CLR.bad }
      : { label: 'Cash flow', value: r.cashFlow, color: CLR.cash },
  ];

  /* ------------------------------------------------------------ pro-forma */
  const yDscr = (y: typeof r.years[0]) => y.yDebt > 0.5 ? (y.yNOI / y.yDebt).toFixed(2) : '∞';
  const pf = `<table class="pf">
    <thead><tr><th>Annual pro-forma</th>${r.years.map(y => `<th>Year ${y.y}</th>`).join('')}</tr></thead>
    <tbody>
      <tr><th>Gross rent</th>${r.years.map(y => `<td>${money0(y.yRent + y.yOther)}</td>`).join('')}</tr>
      <tr><th>Operating expenses</th>${r.years.map(y => `<td class="neg">−${money0(y.yVac + y.yOpEx)}</td>`).join('')}</tr>
      <tr class="em"><th>Net operating income</th>${r.years.map(y => `<td>${money0(y.yNOI)}</td>`).join('')}</tr>
      <tr><th>Debt service</th>${r.years.map(y => `<td class="${y.yDebt > 0 ? 'neg' : ''}">${y.yDebt > 0.5 ? '−' + money0(y.yDebt) : '$0'}</td>`).join('')}</tr>
      <tr class="em"><th>Cash flow</th>${r.years.map(y => `<td class="${y.yCF < 0 ? 'neg' : ''}">${money(y.yCF)}</td>`).join('')}</tr>
      <tr class="em"><th>DSCR</th>${r.years.map(y => `<td>${yDscr(y)}</td>`).join('')}</tr>
      <tr class="rule"><th>Property value</th>${r.years.map(y => `<td>${money0(y.value)}</td>`).join('')}</tr>
      <tr><th>Loan balances</th>${r.years.map(y => `<td>${money0(y.bal)}</td>`).join('')}</tr>
      <tr class="em"><th>Equity</th>${r.years.map(y => `<td>${money0(y.equity)}</td>`).join('')}</tr>
    </tbody></table>`;

  const eqCols = [
    { label: 'Now', bal: Math.max(0, s.price - r.downAmt), eq: r.downAmt, cap: kMoney(s.price) },
    ...r.years.map(y => ({ label: `Yr ${y.y}`, bal: Math.max(0, y.bal), eq: Math.max(0, y.equity), cap: kMoney(y.value) })),
  ];

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

  const assume = `<div class="assume">
    <div><div class="a-l">Vacancy</div><div class="a-v">${stripZeros(pct(s.vacancy, 1))}</div></div>
    <div><div class="a-l">Rent growth</div><div class="a-v">${stripZeros(pct(s.rentGrowth, 2))}/yr</div></div>
    <div><div class="a-l">Expense growth</div><div class="a-v">${stripZeros(pct(s.expGrowth, 2))}/yr</div></div>
    <div><div class="a-l">Appreciation</div><div class="a-v">${stripZeros(pct(s.appr, 2))}/yr</div></div>
    <div><div class="a-l">Selling costs</div><div class="a-v">${stripZeros(pct(s.sellCost, 1))}</div></div>
    <div><div class="a-l">Yr-5 exit profit</div><div class="a-v">${money(r.totalProfit)}</div></div>
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
        <table class="terms"><tbody>${finRows}</tbody></table>
        ${stackedHBar(finSegs, { barH: 20, pctOf: s.price })}
        ${swatches(finSegs.filter(x => x.value > 0).map(x => ({ label: x.label, color: x.color, value: money0(x.value) })))}
      </div>
      <div class="blk">
        <h2>Where each rent dollar goes <span>${money0(gross)}/mo gross</span></h2>
        ${stackedHBar(splitSegs, { barH: 22, pctOf: gross, ...(shortfall > 0 ? { markerAt: gross } : {}) })}
        ${swatches(splitSegs.filter(x => x.value > 0).map(x => ({
          label: x.label, color: x.color, value: `${money0(x.value)} · ${pct(x.value / gross * 100, 0)}`,
        })))}
      </div>
    </div>
    <div class="blk">
      <h2>Monthly operating statement <span>year 1 · as entered</span></h2>
      <table><tbody>${opsRows}</tbody></table>
    </div>
  </div>

  <div class="blk"><h2>Growth &amp; exit assumptions <span>applied to every year below</span></h2>${assume}</div>

  <div class="blk">
    <h2>Five-year pro-forma <span>rent +${stripZeros(pct(s.rentGrowth, 2))} · expenses +${stripZeros(pct(s.expGrowth, 2))} · value +${stripZeros(pct(s.appr, 2))} per year</span></h2>
    ${pf}
    ${equityColumns(eqCols)}
    ${swatches([
      { label: 'Equity', color: CLR.cash, value: money0(r.years[4].equity) },
      ...(r.years[4].bal > 0.5 ? [{ label: 'Loan balances', color: CLR.debt, value: money0(r.years[4].bal) }] : []),
    ])}
  </div>

  <p class="note"><b>${escapeHtml(verdict.title)}</b> — ${escapeHtml(verdict.sub)}
  Screening estimates only: verify taxes, insurance, rents and rehab costs locally before offering. Percentage-based expenses apply to gross
  scheduled rent, and NOI includes the CapEx reserve, so this DSCR is the conservative view. Generated ${date} · Real Estate Investor Toolkit.</p>
</div>
</body></html>`;
}
