/* ============================================================================
   Deal report — the print-ready document behind the "⬇ PDF" button.

   The report opens in a blank window with no network access, so everything is
   self-contained: all CSS is inlined and every chart is hand-built SVG. No
   canvas, no chart library, no web fonts.

   Chart colors are role-based and fixed across the whole document so the same
   thing is always the same color: your cash is aqua, bank/lender debt is blue,
   operating expenses are orange, vacancy is yellow, rehab is violet. The four
   stacking orders used here were checked for colorblind separation against a
   white surface; every segment is also direct-labeled and repeated in a table,
   so color never carries meaning alone.
============================================================================ */

import {
  money, money0, pct, stripZeros, SOW_SECTIONS, UTIL_LABELS, UTILS,
  OTHER_INC, OTHER_INC_LABELS,
  type DealState, type DealResult,
} from '@reit/core';

/* ---------------------------------------------------------------- palette */

const CLR = {
  cash: '#1baf7a',   /* your money — down payment, equity, cash flow */
  debt: '#2a78d6',   /* lender debt — new loan, balances, debt service */
  opex: '#eb6834',   /* operating expenses */
  vac: '#eda100',    /* vacancy loss */
  rehab: '#4a3aa7',  /* rehab / scope of work */
  extra: '#e87ba4',  /* creative financing — seller carry, subject-to */
  bad: '#d03b3b',    /* shortfall / negative */
  good: '#0ca30c',
  warn: '#fab219',
  ink: '#0b0b0b',
  ink2: '#52514e',
  muted: '#898781',
  grid: '#e1e0d9',
  axis: '#c3c2b7',
  surface: '#ffffff',
};

/* ------------------------------------------------------------ primitives */

const VW = 700;                       /* every chart shares one viewBox width */
let uid = 0;
const nextId = () => `g${++uid}`;

export function escapeHtml(str: unknown): string {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* compact money for axis ticks and tight labels: $840 · $12.4k · $1.2M */
function kMoney(n: number): string {
  const a = Math.abs(n), sign = n < 0 ? '−' : '';
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e4) return `${sign}$${Math.round(a / 1e3)}k`;
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(1)}k`;
  return `${sign}$${Math.round(a)}`;
}

/* horizontal bar anchored at the left, 4px rounded data-end */
function hBar(x: number, y: number, w: number, h: number, r = 4): string {
  const rr = Math.max(0, Math.min(r, w, h / 2));
  if (rr < 1) return `M${x},${y}h${w}v${h}h${-w}Z`;
  return `M${x},${y}H${x + w - rr}A${rr},${rr} 0 0 1 ${x + w},${y + rr}` +
    `V${y + h - rr}A${rr},${rr} 0 0 1 ${x + w - rr},${y + h}H${x}Z`;
}

/* vertical bar anchored at a baseline, 4px rounded data-end */
function vBar(x: number, w: number, base: number, val: number, r = 4): string {
  const h = Math.abs(val);
  if (h < 0.6) return `M${x},${base - 0.6}h${w}v1.2h${-w}Z`;
  const rr = Math.max(0, Math.min(r, w / 2, h));
  const up = val >= 0;
  const top = up ? base - h : base;
  if (rr < 1) return `M${x},${top}h${w}v${h}h${-w}Z`;
  return up
    ? `M${x},${base}V${top + rr}A${rr},${rr} 0 0 1 ${x + rr},${top}` +
      `H${x + w - rr}A${rr},${rr} 0 0 1 ${x + w},${top + rr}V${base}Z`
    : `M${x},${base}V${base + h - rr}A${rr},${rr} 0 0 0 ${x + rr},${base + h}` +
      `H${x + w - rr}A${rr},${rr} 0 0 0 ${x + w},${base + h - rr}V${base}Z`;
}

const txt = (x: number, y: number, s: string, cls: string, anchor = 'middle') =>
  `<text x="${x}" y="${y}" class="${cls}" text-anchor="${anchor}">${escapeHtml(s)}</text>`;

/* wrap a label into at most two lines that fit roughly `chars` per line */
function wrap2(label: string, chars: number): string[] {
  if (label.length <= chars) return [label];
  const words = label.split(' ');
  let a = '', b = '';
  for (const w of words) {
    if (!a || (a.length + 1 + w.length) <= chars) a = a ? `${a} ${w}` : w;
    else b = b ? `${b} ${w}` : w;
  }
  if (b.length > chars + 3) b = b.slice(0, chars + 1) + '…';
  return b ? [a, b] : [a];
}

/* "nice" rounded step for gridlines */
function niceStep(range: number, target = 4): number {
  if (!(range > 0)) return 1;
  const raw = range / target;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
}

/* --------------------------------------------------- chart: stacked H bar */

export interface Seg { label: string; value: number; color: string; note?: string }

/* One horizontal bar split into segments, with 2px surface gaps and an
   optional dashed marker (used to show where 100% of gross income falls when
   the costs run past it). */
function stackedHBar(segs: Seg[], opts: { barH?: number; markerAt?: number; markerLabel?: string; pctOf?: number } = {}): string {
  const live = segs.filter(s => s.value > 0);
  const total = live.reduce((t, s) => t + s.value, 0);
  if (!(total > 0)) return '';
  const denom = opts.pctOf && opts.pctOf > 0 ? opts.pctOf : total;
  const barH = opts.barH ?? 40;
  const headroom = opts.markerAt ? 20 : 0;
  const H = headroom + barH;
  const id = nextId();
  const sc = VW / total;

  let acc = 0;
  const rects = live.map((s, i) => {
    const x0 = acc * sc, w = s.value * sc;
    acc += s.value;
    const x = x0 + (i > 0 ? 1 : 0);
    const wd = (x0 + w) - x - (i < live.length - 1 ? 1 : 0);
    if (wd < 0.4) return '';
    const label = wd >= 46 ? txt(x + wd / 2, headroom + barH / 2 + 4.5, `${Math.round(s.value / denom * 100)}%`, 'seg-pct') : '';
    return `<rect x="${x.toFixed(1)}" y="${headroom}" width="${wd.toFixed(1)}" height="${barH}" fill="${s.color}"/>${label}`;
  }).join('');

  let marker = '';
  if (opts.markerAt && opts.markerAt > 0 && opts.markerAt < total) {
    const mx = opts.markerAt * sc;
    marker = `<line x1="${mx.toFixed(1)}" y1="${headroom - 6}" x2="${mx.toFixed(1)}" y2="${H}" class="marker-line"/>` +
      txt(Math.min(mx, VW - 4), headroom - 10, opts.markerLabel || '', 'marker-lbl', mx > VW - 120 ? 'end' : 'start');
  }

  return `<svg viewBox="0 0 ${VW} ${H}" class="chart" role="img" preserveAspectRatio="xMidYMid meet">
    <defs><clipPath id="${id}"><rect x="0" y="${headroom}" width="${VW}" height="${barH}" rx="5"/></clipPath></defs>
    <g clip-path="url(#${id})">${rects}</g>${marker}
  </svg>`;
}

/* ------------------------------------------------------ chart: ranked bars */

/* Single-series magnitude comparison — one hue, sorted, label left, value right. */
function rankedHBars(rows: { label: string; value: number }[], color: string): string {
  const live = rows.filter(r => Math.abs(r.value) > 0.5);
  if (!live.length) return '';
  const max = Math.max(...live.map(r => r.value));
  const rowH = 25, barH = 13, labelW = 176, valueW = 82;
  const x0 = labelW, plotW = VW - labelW - valueW - 14;
  const H = live.length * rowH + 6;
  /* the label column is fixed-width, so long section names are clipped rather
     than allowed to spill past the left edge of the sheet */
  const trim = (l: string) => l.length > 30 ? l.slice(0, 29).replace(/[\s·—-]+$/, '') + '…' : l;
  const body = live.map((r, i) => {
    const y = i * rowH + 4;
    const w = max > 0 ? Math.max(2, r.value / max * plotW) : 2;
    return `<path d="${hBar(x0, y, w, barH)}" fill="${color}"/>` +
      `<text x="${labelW - 12}" y="${y + barH - 2}" class="ax-lbl" text-anchor="end">${escapeHtml(trim(r.label))}</text>` +
      `<text x="${VW}" y="${y + barH - 2}" class="val-lbl" text-anchor="end">${escapeHtml(money0(r.value))}</text>`;
  }).join('');
  return `<svg viewBox="0 0 ${VW} ${H}" class="chart" role="img" preserveAspectRatio="xMidYMid meet">
    <line x1="${x0}" y1="0" x2="${x0}" y2="${H - 4}" class="axis-line"/>${body}
  </svg>`;
}

/* ---------------------------------------------------- chart: columns */

/* Single-series columns over time; handles negative values below the baseline. */
function columnChart(cols: { label: string; value: number }[], opts: { pos: string; neg: string; height?: number } = { pos: CLR.cash, neg: CLR.bad }): string {
  if (!cols.length) return '';
  const plotH = opts.height ?? 150;
  const padT = 22, padB = 26;
  const H = padT + plotH + padB;
  const vals = cols.map(c => c.value);
  const hi = Math.max(0, ...vals), lo = Math.min(0, ...vals);
  const span = (hi - lo) || 1;
  const y = (v: number) => padT + (hi - v) / span * plotH;
  const base = y(0);
  const step = niceStep(span, 4);
  const grid: string[] = [];
  for (let g = Math.ceil(lo / step) * step; g <= hi + 1e-6; g += step) {
    const gy = y(g);
    grid.push(`<line x1="0" y1="${gy.toFixed(1)}" x2="${VW}" y2="${gy.toFixed(1)}" class="${Math.abs(g) < 1e-6 ? 'zero-line' : 'grid-line'}"/>`);
  }
  const slot = VW / cols.length, bw = Math.min(64, slot * 0.52);
  const floor = padT + plotH;
  const body = cols.map((c, i) => {
    const cx = slot * (i + 0.5);
    const h = Math.abs(y(c.value) - base);
    const up = c.value >= 0;
    /* labels sit just past the data end — unless that would land in the
       x-axis band, in which case they move to the free side of the baseline */
    let ly = up ? base - h - 7 : base + h + 15;
    if (ly > floor + 4) ly = base - 7;
    if (ly < 10) ly = base + 15;
    return `<path d="${vBar(cx - bw / 2, bw, base, up ? h : -h)}" fill="${up ? opts.pos : opts.neg}"/>` +
      txt(cx, ly, kMoney(c.value), 'val-lbl-c') +
      txt(cx, H - 8, c.label, 'ax-lbl-c');
  }).join('');
  return `<svg viewBox="0 0 ${VW} ${H}" class="chart" role="img" preserveAspectRatio="xMidYMid meet">${grid.join('')}${body}</svg>`;
}

/* ------------------------------------------- chart: stacked columns */

/* Two-series stacked columns (loan balance + equity = property value). */
function stackedColumns(cols: { label: string; segs: { value: number; color: string }[]; cap?: string }[], height = 165): string {
  if (!cols.length) return '';
  const padT = 24, padB = 26, H = padT + height + padB;
  const max = Math.max(...cols.map(c => c.segs.reduce((t, s) => t + s.value, 0))) || 1;
  const step = niceStep(max, 4);
  const y = (v: number) => padT + (1 - v / max) * height;
  const grid: string[] = [];
  for (let g = 0; g <= max + 1e-6; g += step)
    grid.push(`<line x1="0" y1="${y(g).toFixed(1)}" x2="${VW}" y2="${y(g).toFixed(1)}" class="${g === 0 ? 'zero-line' : 'grid-line'}"/>`);
  const slot = VW / cols.length, bw = Math.min(62, slot * 0.5);
  const body = cols.map((c, i) => {
    const cx = slot * (i + 0.5), x = cx - bw / 2;
    const total = c.segs.reduce((t, s) => t + s.value, 0);
    const segs = c.segs.filter(s => s.value > 0);   /* no debt → no debt band */
    let acc = 0;
    const parts = segs.map((s, j) => {
      const top = y(acc + s.value), yBot = y(acc);
      acc += s.value;
      const h = Math.max(0, (yBot - top) - 1);   /* 1px surface gap between bands */
      if (h < 0.5) return '';
      /* the topmost segment gets the rounded data-end */
      return j === segs.length - 1
        ? `<path d="${vBar(x, bw, top + h, h)}" fill="${s.color}"/>`
        : `<rect x="${x}" y="${top}" width="${bw}" height="${h.toFixed(1)}" fill="${s.color}"/>`;
    }).join('');
    return parts +
      txt(cx, y(total) - 7, c.cap ?? kMoney(total), 'val-lbl-c') +
      txt(cx, H - 8, c.label, 'ax-lbl-c');
  }).join('');
  return `<svg viewBox="0 0 ${VW} ${H}" class="chart" role="img" preserveAspectRatio="xMidYMid meet">${grid.join('')}${body}</svg>`;
}

/* ------------------------------------------------------ chart: waterfall */

export interface WfStep { label: string; value: number; kind: 'total' | 'delta' }

/* Running-total waterfall: 'total' bars sit on the baseline, 'delta' bars float. */
function waterfall(input: WfStep[], height = 165): string {
  /* a zero-value step is a hairline with a "+$0" label — drop it */
  const steps = input.filter(st => st.kind === 'total' || Math.abs(st.value) > 0.5);
  if (!steps.length) return '';
  const padT = 24, padB = 34, H = padT + height + padB;
  let run = 0;
  const bars = steps.map(st => {
    const from = st.kind === 'total' ? 0 : run;
    const to = st.kind === 'total' ? st.value : run + st.value;
    run = to;
    return { ...st, from, to };
  });
  const hi = Math.max(0, ...bars.map(b => Math.max(b.from, b.to)));
  const lo = Math.min(0, ...bars.map(b => Math.min(b.from, b.to)));
  const span = (hi - lo) || 1;
  const y = (v: number) => padT + (hi - v) / span * height;
  const step = niceStep(span, 4);
  const grid: string[] = [];
  for (let g = Math.ceil(lo / step) * step; g <= hi + 1e-6; g += step)
    grid.push(`<line x1="0" y1="${y(g).toFixed(1)}" x2="${VW}" y2="${y(g).toFixed(1)}" class="${Math.abs(g) < 1e-6 ? 'zero-line' : 'grid-line'}"/>`);

  const slot = VW / bars.length, bw = Math.min(72, slot * 0.56);
  const body = bars.map((b, i) => {
    const cx = slot * (i + 0.5), x = cx - bw / 2;
    const yFrom = y(b.from), yTo = y(b.to);
    const color = b.kind === 'total'
      ? (b.to >= 0 ? CLR.debt : CLR.bad)
      : (b.value >= 0 ? CLR.cash : CLR.opex);
    const top = Math.min(yFrom, yTo), h = Math.max(1.5, Math.abs(yTo - yFrom));
    const r = b.kind === 'total' ? 4 : 3;
    const shape = b.kind === 'total'
      ? `<path d="${vBar(x, bw, y(0), b.to >= 0 ? Math.abs(yTo - y(0)) : -Math.abs(yTo - y(0)), r)}" fill="${color}"/>`
      : `<rect x="${x}" y="${top.toFixed(1)}" width="${bw}" height="${h.toFixed(1)}" rx="${r}" fill="${color}"/>`;
    const connector = i < bars.length - 1
      ? `<line x1="${x + bw}" y1="${yTo.toFixed(1)}" x2="${cx + slot - bw / 2}" y2="${yTo.toFixed(1)}" class="wf-link"/>`
      : '';
    /* keep value labels out of the x-axis band when a bar reaches the floor */
    let lblY = b.to >= b.from ? top - 7 : top + h + 14;
    if (lblY > padT + height + 4) lblY = top - 7;
    if (lblY < 10) lblY = top + h + 14;
    const amt = b.kind === 'total' ? kMoney(b.to) : (b.value >= 0 ? '+' : '−') + kMoney(Math.abs(b.value));
    const lines = wrap2(b.label, 15);
    const cap = lines.map((l, k) => txt(cx, padT + height + 16 + k * 12, l, 'ax-lbl-c')).join('');
    return `${connector}${shape}${txt(cx, lblY, amt, 'val-lbl-c')}${cap}`;
  }).join('');

  return `<svg viewBox="0 0 ${VW} ${H}" class="chart" role="img" preserveAspectRatio="xMidYMid meet">${grid.join('')}${body}</svg>`;
}

/* -------------------------------------------------------------- fragments */

function legend(items: { label: string; value: string; color: string; note?: string }[]): string {
  return `<div class="lgnd">${items.map(i => `
    <div class="lg-row">
      <span class="sw" style="background:${i.color}"></span>
      <span class="lg-l">${escapeHtml(i.label)}${i.note ? `<em>${escapeHtml(i.note)}</em>` : ''}</span>
      <span class="lg-v">${escapeHtml(i.value)}</span>
    </div>`).join('')}</div>`;
}

function fig(title: string, kicker: string, chart: string, extra = '', caption = ''): string {
  if (!chart) return '';
  return `<figure class="fig">
    <figcaption><h3>${escapeHtml(title)}</h3><span class="kick">${escapeHtml(kicker)}</span></figcaption>
    ${chart}${extra}
    ${caption ? `<p class="cap">${caption}</p>` : ''}
  </figure>`;
}

const kvTable = (rows: [string, string][], cls = '') =>
  `<table class="kv ${cls}"><tbody>${rows.map(([k, v]) =>
    `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`).join('')}</tbody></table>`;

/* ------------------------------------------------------------- stylesheet */

export const REPORT_STYLES = `
:root {
  --ink:${CLR.ink}; --ink2:${CLR.ink2}; --muted:${CLR.muted};
  --rule:#e6e5df; --rule-2:#cfcec7; --panel:#f7f7f4;
  --sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  --serif: 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, 'Times New Roman', serif;
  --good:${CLR.good}; --warn:${CLR.warn}; --bad:${CLR.bad};
}
* { box-sizing:border-box; margin:0; padding:0; }
html { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
body {
  font-family:var(--sans); color:var(--ink); background:#eceae5;
  font-size:13px; line-height:1.5; padding:24px 16px 64px;
  -webkit-print-color-adjust:exact; print-color-adjust:exact;
}
.sheet { max-width:760px; margin:0 auto; background:#fff; padding:38px 44px 48px;
  box-shadow:0 1px 3px rgba(0,0,0,.08), 0 12px 40px rgba(0,0,0,.10); border-radius:4px; }

/* ---- toolbar (screen only) ---- */
.bar { max-width:760px; margin:0 auto 16px; display:flex; gap:10px; align-items:center; justify-content:flex-end; }
.bar .hint { margin-right:auto; font-size:12px; color:#6a6862; }
.bar button { font:600 13px var(--sans); padding:9px 18px; border-radius:8px; border:1px solid #1d6a5a;
  background:#1d6a5a; color:#fff; cursor:pointer; }
.bar button:hover { background:#145144; }

/* ---- masthead ---- */
.mast { border-bottom:2px solid var(--ink); padding-bottom:14px; }
.mast .brand { font:600 10px var(--sans); letter-spacing:.16em; text-transform:uppercase; color:var(--muted); }
.mast h1 { font-family:var(--serif); font-size:31px; line-height:1.15; font-weight:600; margin:7px 0 5px; letter-spacing:-.01em; }
.mast .sub { font-size:12.5px; color:var(--ink2); }
.mast .sub b { color:var(--ink); font-weight:600; }

/* ---- verdict banner ---- */
.verdict { display:flex; gap:14px; align-items:flex-start; margin:20px 0 22px;
  padding:14px 16px; border-radius:10px; border:1px solid var(--rule-2); background:var(--panel); }
.verdict .pill { flex:none; font:700 10.5px var(--sans); letter-spacing:.08em; text-transform:uppercase;
  color:#fff; padding:5px 10px; border-radius:99px; white-space:nowrap; }
.v-good .pill { background:var(--good); } .v-good { border-color:#bfe4bf; background:#f2faf2; }
.v-ok   .pill { background:#b8860b; }     .v-ok   { border-color:#ecdcae; background:#fdf9ef; }
.v-bad  .pill { background:var(--bad); }  .v-bad  { border-color:#f0c6c6; background:#fdf4f4; }
.verdict .v-t { font-weight:700; font-size:14px; }
.verdict .v-s { font-size:12.5px; color:var(--ink2); margin-top:2px; }

/* ---- KPI tiles ---- */
.kpis { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; margin-bottom:12px; }
.kpi { border:1px solid var(--rule); border-radius:10px; padding:11px 12px 12px; background:#fff; }
.kpi .k-l { font:600 9.5px var(--sans); letter-spacing:.09em; text-transform:uppercase; color:var(--muted); }
.kpi .k-v { font-size:24px; font-weight:650; letter-spacing:-.02em; margin:4px 0 1px; }
.kpi .k-n { font-size:10.5px; color:var(--ink2); line-height:1.35; }
.kpi.hero { background:var(--panel); border-color:var(--rule-2); }
.k-v.pos { color:#0d6b4f; } .k-v.neg { color:var(--bad); }
.k-flag { display:inline-block; width:7px; height:7px; border-radius:50%; margin-right:5px; vertical-align:middle; }

/* ---- fact strip ---- */
.facts { display:grid; grid-template-columns:repeat(4,1fr); gap:0; border:1px solid var(--rule);
  border-radius:10px; overflow:hidden; margin-bottom:26px; }
.facts div { padding:9px 12px; border-right:1px solid var(--rule); border-bottom:1px solid var(--rule);
  display:flex; flex-direction:column; justify-content:space-between; }
.facts div:nth-child(4n) { border-right:none; }
.facts div:nth-last-child(-n+4) { border-bottom:none; }
.facts .f-l { font-size:10px; color:var(--muted); text-transform:uppercase; letter-spacing:.07em; font-weight:600; }
.facts .f-v { font-size:14px; font-weight:600; margin-top:1px; font-variant-numeric:tabular-nums; }

/* ---- section headings ---- */
h2.sec { font-family:var(--serif); font-size:18px; font-weight:600; margin:30px 0 4px;
  padding-bottom:6px; border-bottom:1px solid var(--rule-2); }
h2.sec .n { font:600 10px var(--sans); letter-spacing:.14em; text-transform:uppercase; color:var(--muted);
  display:block; margin-bottom:3px; }

/* ---- figures & charts ---- */
.fig { margin:18px 0 22px; break-inside:avoid; page-break-inside:avoid; }
.fig figcaption { display:flex; align-items:baseline; justify-content:space-between; gap:12px; margin-bottom:10px; }
.fig h3 { font-size:13.5px; font-weight:650; }
.fig .kick { font-size:11px; color:var(--muted); text-align:right; }
.chart { display:block; width:100%; height:auto; overflow:visible; }
.grid-line { stroke:${CLR.grid}; stroke-width:1; }
.zero-line { stroke:${CLR.axis}; stroke-width:1.25; }
.axis-line { stroke:${CLR.axis}; stroke-width:1; }
.wf-link { stroke:${CLR.axis}; stroke-width:1; stroke-dasharray:2 2.5; }
.marker-line { stroke:${CLR.ink2}; stroke-width:1.25; stroke-dasharray:3 2.5; }
text { font-family:var(--sans); }
.seg-pct { font-size:11px; font-weight:650; fill:#fff; }
.ax-lbl { font-size:11px; fill:${CLR.ink2}; }
.ax-lbl-c { font-size:10.5px; fill:${CLR.ink2}; }
.val-lbl { font-size:11px; font-weight:600; fill:${CLR.ink}; font-variant-numeric:tabular-nums; }
.val-lbl-c { font-size:10.5px; font-weight:650; fill:${CLR.ink}; font-variant-numeric:tabular-nums; }
.marker-lbl { font-size:9.5px; font-weight:600; fill:${CLR.ink2}; }

/* ---- legend ---- */
.lgnd { display:grid; grid-template-columns:1fr 1fr; gap:1px 22px; margin-top:12px; }
.lg-row { display:flex; align-items:baseline; gap:8px; padding:3.5px 0; border-bottom:1px solid #f2f1ec; }
.sw { flex:none; width:10px; height:10px; border-radius:3px; transform:translateY(1px); }
.lg-l { flex:1; font-size:11.5px; color:var(--ink2); }
.lg-l em { font-style:normal; color:var(--muted); font-size:10.5px; display:block; }
.lg-v { font-size:11.5px; font-weight:650; font-variant-numeric:tabular-nums; white-space:nowrap; }

/* ---- tables ---- */
table { width:100%; border-collapse:collapse; font-size:12px; font-variant-numeric:tabular-nums; }
.kv th { text-align:left; font-weight:500; color:var(--ink2); padding:5.5px 0; border-bottom:1px solid #f2f1ec; }
.kv td { text-align:right; font-weight:600; padding:5.5px 0; border-bottom:1px solid #f2f1ec; white-space:nowrap; }
.kv.two { display:grid; grid-template-columns:1fr 1fr; gap:0 26px; }
.kv.two tbody { display:contents; }
.kv.two tr { display:flex; justify-content:space-between; gap:12px; border-bottom:1px solid #f2f1ec; }
.kv.two th, .kv.two td { border:none; }
.data { margin-top:12px; }
.data th, .data td { padding:6px 6px; border-bottom:1px solid #f2f1ec; }
.data thead th { font:600 9.5px var(--sans); letter-spacing:.07em; text-transform:uppercase; color:var(--muted);
  border-bottom:1px solid var(--rule-2); text-align:right; }
.data thead th:first-child, .data td:first-child { text-align:left; }
.data td { text-align:right; }
.data tr.em td, .data tr.em th { font-weight:700; }
.data tr.em td:first-child { font-weight:700; }
.data tr.rule td { border-top:1px solid var(--rule-2); }
.data td.neg { color:var(--bad); }
.data tbody tr:nth-child(even) { background:#fafaf8; }

.cap { font-size:11px; color:var(--muted); margin-top:10px; line-height:1.45; }
.note { margin-top:30px; padding-top:10px; border-top:1px solid var(--rule); font-size:10.5px; color:var(--muted); }
.two-col { display:grid; grid-template-columns:1fr 1fr; gap:22px; align-items:start; }
.panel { border:1px solid var(--rule); border-radius:10px; padding:12px 14px; background:#fdfdfc; }
.panel h4 { font-size:11px; text-transform:uppercase; letter-spacing:.08em; color:var(--muted); margin-bottom:7px; }
.prose { font-size:12px; color:var(--ink2); white-space:pre-wrap; }
.pb { break-before:page; page-break-before:always; }

@media print {
  body { background:#fff; padding:0; font-size:11.5px; }
  .sheet { box-shadow:none; max-width:none; padding:0; border-radius:0; }
  .noprint { display:none !important; }
  .fig, .kpis, .facts, .panel, table { break-inside:avoid; page-break-inside:avoid; }
  h2.sec { break-after:avoid; page-break-after:avoid; }
}
@page { size:letter; margin:14mm 13mm; }
@media (max-width:720px) {
  .sheet { padding:24px 20px 32px; }
  .kpis, .facts { grid-template-columns:repeat(2,1fr); }
  .facts div:nth-child(4n) { border-right:1px solid var(--rule); }
  .facts div:nth-child(2n) { border-right:none; }
  .lgnd, .two-col, .kv.two { grid-template-columns:1fr; }
}
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
  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const gross = r.gross;
  const capRate = (s.price + s.rehab) > 0 ? r.noi * 12 / (s.price + s.rehab) * 100 : NaN;
  const sqft = parseFloat(String(s.prop.sqft).replace(/[^0-9.]/g, ''));
  const shortfall = r.cashFlow < 0 ? -r.cashFlow : 0;

  /* ------------------------------------------------- 1 · rent dollar split */
  const rentSegs: Seg[] = [
    { label: 'Vacancy loss', value: r.vacLoss, color: CLR.vac },
    { label: 'Operating expenses', value: r.opEx, color: CLR.opex },
    { label: 'Debt service', value: r.pi, color: CLR.debt },
    shortfall > 0
      ? { label: 'Monthly shortfall', value: shortfall, color: CLR.bad, note: 'costs exceed income' }
      : { label: 'Cash flow to you', value: r.cashFlow, color: CLR.cash },
  ];
  const rentChart = fig(
    'Where every rent dollar goes', `${money0(gross)}/mo gross income`,
    stackedHBar(rentSegs, { pctOf: gross, ...(shortfall > 0 ? { markerAt: gross, markerLabel: '100% of gross income' } : {}) }),
    legend(rentSegs.filter(x => x.value > 0).map(x => ({
      label: x.label, color: x.color, note: x.note,
      value: `${money0(x.value)}/mo · ${pct(x.value / gross * 100, 0)}`,
    }))),
    shortfall > 0
      ? `Costs run <b>${money0(shortfall)}/mo past</b> the gross income line — this property needs cash from you every month.`
      : `Percentages are shares of ${money0(gross)}/mo gross scheduled income (rent${r.otherIncTotal ? ' plus other income' : ''}).`,
  );

  /* -------------------------------------------------- 2 · cash flow waterfall */
  const hasDebt = r.pi > 0.5;
  const wfSteps: WfStep[] = [
    { label: 'Gross rent', value: s.rent, kind: 'total' },
    ...(r.otherIncTotal ? [{ label: 'Other income', value: r.otherIncTotal, kind: 'delta' as const }] : []),
    { label: `Vacancy ${stripZeros(pct(s.vacancy, 1))}`, value: -r.vacLoss, kind: 'delta' },
    { label: 'Operating expenses', value: -r.opEx, kind: 'delta' },
    /* with no loan, NOI *is* the cash flow — one bar says it better than two */
    ...(hasDebt ? [
      { label: 'Net operating income', value: r.noi, kind: 'total' as const },
      { label: 'Debt service', value: -r.pi, kind: 'delta' as const },
    ] : []),
    { label: hasDebt ? 'Monthly cash flow' : 'Cash flow = NOI', value: r.cashFlow, kind: 'total' },
  ];
  const wfChart = fig(
    'How the monthly cash flow is built', 'Year 1 · per month',
    waterfall(wfSteps),
    '',
    hasDebt
      ? 'Blue bars are running totals; green steps add, orange steps subtract. Net operating income is what the property earns before any loan payment — it is the number a lender underwrites.'
      : 'Blue bars are running totals; green steps add, orange steps subtract. With no loan on the property, net operating income and cash flow are the same number.',
  );

  /* ------------------------------------------------ 3 · operating expenses */
  const expRows = [
    ...r.expLines.filter(e => e.monthly > 0).map(e => ({ label: e.label, value: e.monthly })),
    ...(r.utilTotal > 0 ? [{ label: 'Utilities (owner-paid)', value: r.utilTotal }] : []),
  ].sort((a, b) => b.value - a.value);
  const utilDetail = UTILS.filter(k => (s.utils[k] || 0) > 0)
    .map(k => `${UTIL_LABELS[k]} ${money0(s.utilUnits?.[k] === 'yr' ? s.utils[k] / 12 : s.utils[k])}`).join(' · ');
  const expChart = fig(
    'Operating expenses', `${money0(r.opEx)}/mo · ${pct(gross > 0 ? r.opEx / gross * 100 : 0, 0)} of gross income`,
    rankedHBars(expRows, CLR.opex),
    '',
    `Debt service is excluded — these are the costs of running the property regardless of how it is financed.${utilDetail ? ` Utilities: ${escapeHtml(utilDetail)}.` : ''}`,
  );

  /* -------------------------------------------------------- 4 · financing */
  const finSegs: Seg[] = [
    { label: 'Down payment (cash)', value: r.downAmt, color: CLR.cash },
    { label: 'New loan (bank)', value: r.newLoan, color: CLR.debt, note: `${stripZeros(pct(s.rate, 3))} · ${+s.term} yr${s.ioOn ? ' · interest-only' : ''}` },
    { label: 'Seller financing', value: r.sellerAmt, color: CLR.rehab, note: r.sellerAmt > 0 ? `${stripZeros(pct(s.sellerRate, 3))} · ${+s.sellerTerm} yr · ${s.sellerType === 'io' ? 'interest-only' : 'amortizing'}` : undefined },
    { label: 'Subject-to (assumed)', value: r.subtoBal, color: CLR.extra, note: r.subtoBal > 0 ? `${stripZeros(pct(s.subtoRate, 3))} · ${+s.subtoTerm} yr remaining` : undefined },
  ];
  const allCash = r.newLoan <= 0 && r.sellerAmt <= 0 && r.subtoBal <= 0;
  const finChart = fig(
    allCash ? 'All-cash purchase' : 'How the purchase is financed',
    `${money0(s.price)} purchase price`,
    stackedHBar(finSegs),
    legend(finSegs.filter(x => x.value > 0).map(x => ({
      label: x.label, color: x.color, note: x.note,
      value: `${money0(x.value)} · ${pct(s.price > 0 ? x.value / s.price * 100 : 0, 0)}`,
    }))),
    allCash
      ? 'No debt on this property — every dollar of net operating income is cash flow, and the cash-on-cash return equals the cap rate.'
      : `Total monthly debt service is <b>${money0(r.pi)}</b>${r.overBy > 0 ? ` — note the financing stack currently exceeds the purchase price by ${money0(r.overBy)}.` : '.'}`,
  );

  /* ---------------------------------------------------- 5 · cash to close */
  const cashSegs: Seg[] = [
    { label: 'Down payment', value: r.downAmt, color: CLR.cash },
    { label: 'Rehab / initial repairs', value: s.rehab, color: CLR.rehab },
    { label: 'Closing costs', value: r.closingAmt, color: CLR.debt },
  ];
  const cashChart = fig(
    'Cash you need to close', `${money0(r.cashInvested)} out of pocket`,
    stackedHBar(cashSegs, { barH: 30 }),
    legend(cashSegs.filter(x => x.value > 0).map(x => ({
      label: x.label, color: x.color,
      value: `${money0(x.value)} · ${pct(r.cashInvested > 0 ? x.value / r.cashInvested * 100 : 0, 0)}`,
    }))),
    'Every return figure in this report is measured against this number.',
  );

  /* ----------------------------------------------------- 6 · 5-year charts */
  const cfCols = r.years.map(y => ({ label: `Year ${y.y}`, value: y.yCF }));
  const cfChart = fig(
    'Annual cash flow', `${stripZeros(pct(s.rentGrowth, 2))} rent growth · ${stripZeros(pct(s.expGrowth, 2))} expense growth`,
    columnChart(cfCols, { pos: CLR.cash, neg: CLR.bad }),
    '',
    `Cumulative cash flow over five years: <b>${money(r.years[4].cumCF)}</b>.`,
  );

  const eqCols = [
    { label: 'Today', segs: [{ value: Math.max(0, s.price - r.downAmt), color: CLR.debt }, { value: r.downAmt, color: CLR.cash }], cap: kMoney(s.price) },
    ...r.years.map(y => ({
      label: `Year ${y.y}`,
      segs: [{ value: Math.max(0, y.bal), color: CLR.debt }, { value: Math.max(0, y.equity), color: CLR.cash }],
      cap: kMoney(y.value),
    })),
  ];
  const eqChart = fig(
    'Equity build-up', `${stripZeros(pct(s.appr, 2))} annual appreciation`,
    stackedColumns(eqCols),
    legend([
      { label: 'Your equity', color: CLR.cash, value: `${money0(r.years[4].equity)} at year 5` },
      ...(r.years[4].bal > 0.5 || (s.price - r.downAmt) > 0.5
        ? [{ label: 'Loan balances', color: CLR.debt, value: `${money0(r.years[4].bal)} at year 5` }] : []),
    ]),
    hasDebt || (s.price - r.downAmt) > 0.5
      ? 'Column height is the projected property value; the split shows how much of it is yours as the loans amortize and the value grows.'
      : 'With no debt on the property, the whole projected value is your equity — it grows with appreciation alone.',
  );

  /* ------------------------------------------------------- 7 · exit profit */
  const exitChart = fig(
    'If you sold at the end of year 5', `${stripZeros(pct(s.sellCost, 1))} selling costs`,
    waterfall([
      { label: 'Sale price', value: r.years[4].value, kind: 'total' },
      { label: 'Selling costs', value: -(r.years[4].value - r.netSale), kind: 'delta' },
      { label: 'Loan payoff', value: -r.years[4].bal, kind: 'delta' },
      { label: 'Net proceeds', value: r.proceeds, kind: 'total' },
      { label: '5 yrs cash flow', value: r.years[4].cumCF, kind: 'delta' },
      { label: 'Cash invested', value: -r.cashInvested, kind: 'delta' },
      { label: 'Total profit', value: r.totalProfit, kind: 'total' },
    ], 175),
    kvTable([
      ['Total profit', money(r.totalProfit)],
      ['Total return on cash invested', isFinite(r.roi5) ? pct(r.roi5, 0) : '—'],
      ['Annualized return (IRR-style)', isFinite(r.annualized) ? pct(r.annualized, 1) : '—'],
    ], 'two'),
    'Profit is measured against the cash you put in, not the purchase price — the loan does the rest of the work.',
  );

  /* ------------------------------------------------------ pro-forma table */
  const pfRows: [string, (y: any) => number, string][] = [
    ['Gross rent', y => y.yRent, ''],
    ['Other income', y => y.yOther, ''],
    ['Vacancy loss', y => -y.yVac, ''],
    ['Operating expenses', y => -y.yOpEx, ''],
    ['Net operating income', y => y.yNOI, 'em'],
    ['Debt service', y => -y.yDebt, ''],
    ['Cash flow', y => y.yCF, 'em'],
    ['Cumulative cash flow', y => y.cumCF, ''],
    ['Property value', y => y.value, 'rule'],
    ['Loan balances', y => y.bal, ''],
    ['Equity', y => y.equity, 'em'],
  ];
  const proForma = `<table class="data">
    <thead><tr><th>Annual</th>${r.years.map(y => `<th>Year ${y.y}</th>`).join('')}</tr></thead>
    <tbody>${pfRows.filter(([lbl]) => lbl !== 'Other income' || r.otherIncTotal > 0).map(([lbl, fn, cls]) =>
      `<tr class="${cls}"><td>${lbl}</td>${r.years.map(y => {
        const v = fn(y);
        return `<td class="${v < 0 ? 'neg' : ''}">${money(v)}</td>`;
      }).join('')}</tr>`).join('')}</tbody>
  </table>`;

  /* --------------------------------------------------------- scope of work */
  const sowRows = SOW_SECTIONS
    .map(sec => ({ label: sec.label, value: s.sow.filter(i => i.sec === sec.id).reduce((t, i) => t + (i.cost || 0), 0) }))
    .filter(x => x.value > 0);
  const sowBlock = sowRows.length ? `
    <div class="pb"></div>
    <h2 class="sec"><span class="n">Section 4</span>Rehab — Scope of Work</h2>
    ${fig('Rehab budget by area', `${money0(sowTotal)} total`, rankedHBars(sowRows, CLR.rehab), '',
      `${s.sow.length} line item${s.sow.length === 1 ? '' : 's'} across ${sowRows.length} area${sowRows.length === 1 ? '' : 's'}. The analyzer's rehab figure is locked to this total.`)}
    <table class="data">
      <thead><tr><th>Area / item</th><th>Est. cost</th></tr></thead>
      <tbody>${SOW_SECTIONS.map(sec => {
        const items = s.sow.filter(i => i.sec === sec.id && (i.desc.trim() || i.cost));
        if (!items.length) return '';
        const sub = items.reduce((t, i) => t + (i.cost || 0), 0);
        return `<tr class="em rule"><td>${sec.label}</td><td>${money0(sub)}</td></tr>` +
          items.map(i => `<tr><td>&nbsp;&nbsp;&nbsp;${escapeHtml(i.desc || '—')}</td><td>${money0(i.cost || 0)}</td></tr>`).join('');
      }).join('')}
      <tr class="em rule"><td>Total rehab budget</td><td>${money0(sowTotal)}</td></tr></tbody>
    </table>` : '';

  /* ------------------------------------------------------ capex & hood */
  const capexRows = (s.capex || []).filter((c: any) => (c.name || '').trim());
  const hood = s.hood || { crime: '', schools: '', notes: '' };
  const hasHood = !!(hood.crime || hood.schools || hood.notes);
  const appendix = (capexRows.length || hasHood) ? `
    <h2 class="sec"><span class="n">Appendix</span>Property condition &amp; neighborhood</h2>
    ${capexRows.length ? `<table class="data">
      <thead><tr><th>System / component</th><th>Installed</th><th>Condition</th><th style="text-align:left">Notes</th></tr></thead>
      <tbody>${capexRows.map((c: any) => `<tr><td>${escapeHtml(c.name)}</td><td>${escapeHtml(String(c.year || '—'))}</td><td>${escapeHtml(c.cond || '—')}</td><td style="text-align:left">${escapeHtml(c.notes || '')}</td></tr>`).join('')}</tbody>
    </table>` : ''}
    ${hasHood ? `<div class="panel" style="margin-top:16px">
      <h4>Neighborhood</h4>
      ${hood.crime ? `<p class="prose"><b>Crime:</b> ${escapeHtml(hood.crime)}</p>` : ''}
      ${hood.schools ? `<p class="prose"><b>Schools:</b> ${escapeHtml(hood.schools)}</p>` : ''}
      ${hood.notes ? `<p class="prose" style="margin-top:6px">${escapeHtml(hood.notes)}</p>` : ''}
    </div>` : ''}` : '';

  /* -------------------------------------------------------------- KPI tiles */
  const flag = (state: 'good' | 'ok' | 'bad') =>
    `<span class="k-flag" style="background:${state === 'good' ? CLR.good : state === 'ok' ? CLR.warn : CLR.bad}"></span>`;
  const cocState = r.coc >= 8 ? 'good' : r.coc >= 4 ? 'ok' : 'bad';
  const dscrState = !isFinite(r.dscr) || r.dscr >= 1.25 ? 'good' : r.dscr >= 1 ? 'ok' : 'bad';

  const kpis = `<div class="kpis">
    <div class="kpi hero"><div class="k-l">Cash-on-cash</div>
      <div class="k-v ${r.coc >= 0 ? 'pos' : 'neg'}">${flag(cocState)}${isFinite(r.coc) ? pct(r.coc, 1) : '—'}</div>
      <div class="k-n">year-1 cash flow ÷ ${money0(r.cashInvested)} invested</div></div>
    <div class="kpi"><div class="k-l">Monthly cash flow</div>
      <div class="k-v ${r.cashFlow >= 0 ? 'pos' : 'neg'}">${money(r.cashFlow)}</div>
      <div class="k-n">after all expenses &amp; debt</div></div>
    <div class="kpi"><div class="k-l">DSCR</div>
      <div class="k-v">${flag(dscrState)}${isFinite(r.dscr) ? r.dscr.toFixed(2) : '∞'}</div>
      <div class="k-n">lenders typically want ≥ 1.25</div></div>
    <div class="kpi"><div class="k-l">5-year total ROI</div>
      <div class="k-v ${r.roi5 >= 0 ? 'pos' : 'neg'}">${isFinite(r.roi5) ? pct(r.roi5, 0) : '—'}</div>
      <div class="k-n">cash flow + equity + appreciation</div></div>
  </div>`;

  const facts = `<div class="facts">
    <div><div class="f-l">Purchase price</div><div class="f-v">${money0(s.price)}</div></div>
    <div><div class="f-l">Cash to close</div><div class="f-v">${money0(r.cashInvested)}</div></div>
    <div><div class="f-l">Gross rent</div><div class="f-v">${money0(s.rent)}/mo</div></div>
    <div><div class="f-l">Cap rate</div><div class="f-v">${isFinite(capRate) ? pct(capRate, 2) : '—'}</div></div>
    <div><div class="f-l">1% rule</div><div class="f-v">${pct(r.onePct, 2)}</div></div>
    <div><div class="f-l">Gross rent multiplier</div><div class="f-v">${isFinite(r.grm) ? r.grm.toFixed(1) + '×' : '—'}</div></div>
    <div><div class="f-l">Debt service</div><div class="f-v">${money0(r.pi)}/mo</div></div>
    <div><div class="f-l">${sqft > 0 ? 'Price per sq ft' : 'Net operating income'}</div><div class="f-v">${sqft > 0 ? '$' + Math.round(s.price / sqft).toLocaleString('en-US') : money(r.noi) + '/mo'}</div></div>
  </div>`;

  const assumptions = kvTable([
    ['Purchase price', money0(s.price)],
    ['Down payment', `${money0(r.downAmt)} (${stripZeros(pct(s.downPct, 1))})`],
    ['Rehab budget', money0(s.rehab)],
    ['Closing costs', money0(r.closingAmt)],
    ['Gross monthly rent', money0(s.rent)],
    ...(r.otherIncTotal ? [['Other monthly income', money0(r.otherIncTotal)] as [string, string]] : []),
    ['Vacancy', stripZeros(pct(s.vacancy, 1))],
    ['Annual rent growth', stripZeros(pct(s.rentGrowth, 2))],
    ['Annual expense growth', stripZeros(pct(s.expGrowth, 2))],
    ['Annual appreciation', stripZeros(pct(s.appr, 2))],
    ['Selling costs at exit', stripZeros(pct(s.sellCost, 1))],
    ['Loan terms', r.newLoan > 0 ? `${stripZeros(pct(s.rate, 3))} · ${+s.term} yr${s.ioOn ? ` · IO ${+s.ioYears} yr` : ''}${s.armOn ? ` · ${+s.armFixed}/${s.armFreq === 6 ? 6 : 1} ARM → ${stripZeros(pct(s.armRate, 3))}` : ''}` : 'none — all cash'],
  ], 'two');

  const otherIncRows = OTHER_INC.filter(k => (s.otherInc[k] || 0) > 0)
    .map(k => `${OTHER_INC_LABELS[k]} ${money0(s.otherInc[k])}`).join(' · ');

  /* --------------------------------------------------------------- assemble */
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Deal Report — ${escapeHtml(name)}</title>
<style>${REPORT_STYLES}</style></head>
<body>
<div class="bar noprint">
  <span class="hint">Choose <b>“Save as PDF”</b> as the destination in the print dialog.</span>
  <button onclick="window.print()">🖨 Print / Save as PDF</button>
</div>

<div class="sheet">
  <header class="mast">
    <div class="brand">Rental Property Analysis · Real Estate Investor Toolkit</div>
    <h1>${escapeHtml(name)}</h1>
    <div class="sub">${s.prop.address ? `<b>${escapeHtml(s.prop.address)}</b> · ` : ''}${[
      s.prop.beds && `${escapeHtml(s.prop.beds)} bd`,
      s.prop.baths && `${escapeHtml(s.prop.baths)} ba`,
      sqft > 0 && `${Math.round(sqft).toLocaleString('en-US')} sqft`,
      s.prop.year && `built ${escapeHtml(s.prop.year)}`,
    ].filter(Boolean).join(' · ')}${s.prop.address || s.prop.beds || sqft > 0 ? ' · ' : ''}Prepared ${date}</div>
  </header>

  <div class="verdict v-${verdict.cls}">
    <span class="pill">${verdict.cls === 'good' ? 'Strong' : verdict.cls === 'ok' ? 'Marginal' : 'Do not proceed'}</span>
    <div><div class="v-t">${escapeHtml(verdict.title)}</div><div class="v-s">${escapeHtml(verdict.sub)}</div></div>
  </div>

  ${kpis}
  ${facts}

  <h2 class="sec"><span class="n">Section 1</span>Where the money goes each month</h2>
  ${rentChart}
  ${wfChart}
  ${expChart}

  <div class="pb"></div>
  <h2 class="sec"><span class="n">Section 2</span>The capital stack</h2>
  ${finChart}
  ${cashChart}

  <div class="pb"></div>
  <h2 class="sec"><span class="n">Section 3</span>Five-year projection</h2>
  ${cfChart}
  ${eqChart}
  ${proForma}
  ${exitChart}

  ${sowBlock}

  <div class="pb"></div>
  <h2 class="sec"><span class="n">Reference</span>Assumptions behind these numbers</h2>
  ${assumptions}
  ${otherIncRows ? `<p class="cap">Other income: ${escapeHtml(otherIncRows)} per month.</p>` : ''}

  ${appendix}

  <p class="note">Estimates for screening purposes only — verify taxes, insurance, rents and rehab costs locally before making an offer.
  Percentage-based expenses are calculated on gross scheduled rent. Net operating income here includes the CapEx reserve as an operating
  cost, so the DSCR shown is the conservative view; many lenders exclude CapEx, which would produce a higher ratio.
  Generated ${date} by the Real Estate Investor Toolkit.</p>
</div>
</body></html>`;
}
