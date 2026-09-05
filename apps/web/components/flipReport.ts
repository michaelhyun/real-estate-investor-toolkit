/* Print-ready documents for the flip analyzer — a one-page deal report and a
   contractor-ready scope of work. Same shape as report.ts: build a whole HTML
   document as a string and hand it to openReportWindow to print. */

import {
  money, money0, pct, computeFlip, computeGrid, solveMAO, seventyRule, verdictFor,
  SCENARIO_KEYS, findCity, CATALOG, seededQty, computeChecklist,
  type FlipState, type ScenarioKey, type QtyContext,
} from '@reit/core';
import { REPORT_CSS, escapeHtml } from './ui';

const today = () =>
  new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

const title = (s: FlipState) => s.prop.address || s.name || 'Untitled deal';

const rows = (list: { label: string; amount: number; disclosure?: boolean }[]) =>
  list.filter(l => l.amount !== 0 || !l.disclosure).map(l =>
    `<tr><td>${l.disclosure ? '&nbsp;&nbsp;&nbsp;' : ''}${escapeHtml(l.label)}</td>` +
    `<td class="r">${money0(l.amount)}</td></tr>`).join('');

export function buildFlipReport(s: FlipState): string {
  const r = computeFlip(s, 'base', 'base');
  const grid = computeGrid(s);
  const v = verdictFor(r, s);
  const mao = solveMAO(s);
  const city = findCity(s.citySlug);

  const gridRows = grid.map((row, ri) => {
    const rk = SCENARIO_KEYS[ri];
    return `<tr><td><b>Rehab ${rk}</b><br><span class="s">${money0(s.rehab[rk])}</span></td>` +
      row.map(c => `<td class="r">${money(c.result.netProfit)}<br>` +
        `<span class="s">${c.result.roi.toFixed(1)}% ROI</span></td>`).join('') + '</tr>';
  }).join('');

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Flip Analysis — ${escapeHtml(title(s))}</title>
<style>${REPORT_CSS}
  td.r { text-align:right; }
  span.s { color:#777; font-size:11px; }
  .grid-tbl td { border:1px solid #ccc; }
  .grid-tbl th { border:1px solid #ccc; background:#f4f2ee; font-size:11px; text-align:right; }
  .two { display:flex; gap:26px; }
  .two > div { flex:1; }
</style></head>
<body>
<div class="noprint"><button onclick="window.print()">Print / Save as PDF</button></div>
<header>
  <h1>Fix &amp; Flip Analysis</h1>
  <div class="meta">${escapeHtml(title(s))}${city ? ' &nbsp;·&nbsp; ' + escapeHtml(city.name) : ''} &nbsp;·&nbsp; Prepared ${today()}</div>
</header>

<div class="verdict">${escapeHtml(v.title)} — ${money(r.netProfit)} net profit · ${r.roi.toFixed(1)}% ROI · ${r.annualizedRoi.toFixed(1)}% annualized</div>

<h2>The deal</h2>
<table>
  <tr><td>Purchase price</td><td class="r">${money0(s.price)}</td>
      <td>ARV — base</td><td class="r">${money0(s.arv.base)}</td></tr>
  <tr><td>Purchase $/sqft</td><td class="r">${money0(r.pricePsf)}</td>
      <td>ARV $/sqft</td><td class="r">${money0(r.arvPsf)}</td></tr>
  <tr><td>Rehab incl. ${s.contingencyPct}% contingency</td><td class="r">${money0(r.rehabTotal)}</td>
      <td>Gross spread</td><td class="r">${pct(r.grossSpread)}</td></tr>
  <tr><td>Hold period</td><td class="r">${r.holdMonths.toFixed(1)} mo</td>
      <td>Max allowable offer</td><td class="r">${money0(mao)}</td></tr>
  <tr><td>Financing</td><td class="r">${s.finMode === 'hard' ? 'Hard money' : (s.ltvPct > 0 ? 'Conventional' : 'All cash')}</td>
      <td>70% rule cross-check</td><td class="r">${money(seventyRule(s))}</td></tr>
</table>

<h2>Base case profit &amp; loss</h2>
<table>
  <tr><td>Sale price (ARV base)</td><td class="r">${money0(r.sale)}</td></tr>
  <tr><td>Less selling costs (${pct(r.sellPctOfSale)} of sale)</td><td class="r">(${money0(r.sellTotal)})</td></tr>
  <tr class="total"><td>Net sale proceeds</td><td class="r">${money(r.netProceeds)}</td></tr>
  <tr><td>Less purchase price</td><td class="r">(${money0(s.price)})</td></tr>
  <tr><td>Less acquisition costs</td><td class="r">(${money0(r.acqTotal)})</td></tr>
  <tr><td>Less rehab incl. contingency</td><td class="r">(${money0(r.rehabTotal)})</td></tr>
  <tr><td>Less holding costs</td><td class="r">(${money0(r.holdTotal)})</td></tr>
  <tr><td>Less financing</td><td class="r">(${money0(r.finTotal)})</td></tr>
  <tr class="total"><td>Pre-tax profit</td><td class="r">${money(r.preTaxProfit)}</td></tr>
  <tr><td>Less income tax at ${s.taxPct}%</td><td class="r">(${money0(r.tax)})</td></tr>
  <tr class="total"><td>Net profit after tax</td><td class="r">${money(r.netProfit)}</td></tr>
</table>

<h2>Scenarios — rehab against ARV</h2>
<table class="grid-tbl">
  <tr><th></th>${SCENARIO_KEYS.map(k =>
    `<th>ARV ${k}<br><span class="s">${money0(s.arv[k])}</span></th>`).join('')}</tr>
  ${gridRows}
</table>

<h2>Capital</h2>
<table>
  <tr><td>Cash to close</td><td class="r">${money0(r.cashToClose)}</td></tr>
  <tr><td>Cash during hold</td><td class="r">${money0(r.cashDuringHold)}</td></tr>
  <tr class="total"><td>Peak cash out of pocket</td><td class="r">${money0(r.peakCash)}</td></tr>
  <tr><td>Loan payoff at sale</td><td class="r">${money0(r.payoffAtSale)}</td></tr>
  <tr><td>Cash back at close</td><td class="r">${money(r.cashBackAtClose)}</td></tr>
</table>

<div class="two">
  <div>
    <h2>Acquisition</h2>
    <table>${rows(r.acqLines)}<tr class="total"><td>Total</td><td class="r">${money0(r.acqTotal)}</td></tr></table>
    <h2>Holding — ${r.holdMonths.toFixed(1)} months</h2>
    <table>${rows(r.holdLines)}<tr class="total"><td>Total</td><td class="r">${money0(r.holdTotal)}</td></tr></table>
  </div>
  <div>
    <h2>Selling</h2>
    <table>${rows(r.sellLines)}<tr class="total"><td>Total</td><td class="r">${money0(r.sellTotal)}</td></tr></table>
    <h2>Financing</h2>
    <table>${rows(r.finLines)}<tr class="total"><td>Total</td><td class="r">${money0(r.finTotal)}</td></tr></table>
  </div>
</div>

<p class="note">Screening estimate only — verify every figure locally before making an offer.
${city ? `Transfer tax and property tax rates for ${escapeHtml(city.name)} as verified ${escapeHtml(city.verifiedOn)}; rates change by ballot measure, so confirm before relying on them. ` : ''}
Property tax assumes Prop 13 reassessment to the purchase price. Flip profit is treated as ordinary income at a single blended rate, not capital gains.</p>
</body></html>`;
}

export function buildScopeOfWork(
  s: FlipState, catalogPrices: Record<string, number>,
): string {
  const ctx: QtyContext = {
    sqft: s.prop.sqft, beds: s.prop.beds, baths: s.prop.baths,
    halfBaths: s.prop.halfBaths, stories: s.prop.stories, garageBays: s.prop.garageBays,
  };
  const totals = computeChecklist(s.checked, s.qty, catalogPrices, ctx);
  const priceOf = (id: string, k: 'low' | 'base' | 'high', fallback: number) =>
    catalogPrices[`${id}.${k}`] !== undefined ? catalogPrices[`${id}.${k}`] : fallback;

  const secHtml = CATALOG.map(sec => {
    const items = sec.items.filter(i => s.checked[i.id]);
    if (!items.length) return '';
    const t = totals.sections.find(x => x.id === sec.id)!;
    return `<h2>${escapeHtml(sec.label)}</h2>
<table>
  <tr><th>Item</th><th class="c">Qty</th><th class="c">Unit</th><th class="c">Est. cost</th></tr>
  ${items.map(i => {
    const q = s.qty[i.id] !== undefined ? s.qty[i.id] : seededQty(i, ctx);
    const cost = i.pctOfHard
      ? totals.hardBase * priceOf(i.id, 'base', i.base) / 100
      : q * priceOf(i.id, 'base', i.base);
    return `<tr><td>${escapeHtml(i.desc)}${i.note ? `<br><span class="s">${escapeHtml(i.note)}</span>` : ''}</td>` +
      `<td class="c">${i.pctOfHard ? '—' : q}</td>` +
      `<td class="c">${i.pctOfHard ? `${priceOf(i.id, 'base', i.base)}% of hard` : escapeHtml(i.unit)}</td>` +
      `<td class="c">${money0(cost)}</td></tr>`;
  }).join('')}
  <tr class="sub"><td colspan="3">${escapeHtml(sec.label)} subtotal</td><td class="c">${money0(t.base)}</td></tr>
</table>`;
  }).join('');

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Scope of Work — ${escapeHtml(title(s))}</title>
<style>
  body { font-family: Georgia, 'Times New Roman', serif; color:#222; max-width:760px; margin:40px auto; padding:0 24px; line-height:1.5; }
  header { border-bottom:3px double #222; padding-bottom:14px; margin-bottom:24px; }
  h1 { font-size:26px; margin:0; }
  .meta { color:#666; font-size:14px; margin-top:4px; }
  h2 { font-size:15px; text-transform:uppercase; letter-spacing:.06em; border-bottom:1px solid #999; padding-bottom:4px; margin:26px 0 8px; }
  table { width:100%; border-collapse:collapse; font-size:13.5px; }
  th { text-align:left; font-size:10.5px; text-transform:uppercase; letter-spacing:.05em; color:#666; padding:6px 4px; border-bottom:1px solid #ccc; }
  td { padding:7px 4px; border-bottom:1px solid #eee; vertical-align:top; }
  .c { text-align:right; white-space:nowrap; }
  th.c { text-align:right; }
  span.s { color:#777; font-size:11px; font-style:italic; }
  tr.sub td { font-weight:bold; border-top:1px solid #999; border-bottom:none; }
  .range { margin-top:28px; border-top:3px double #222; padding-top:12px; }
  .range table { font-size:15px; }
  .range td { border:none; padding:5px 4px; }
  .range td.c { font-weight:bold; }
  .note { margin-top:32px; font-size:11.5px; color:#777; border-top:1px solid #ddd; padding-top:10px; }
  .sign { margin-top:44px; display:flex; gap:40px; }
  .sign div { flex:1; border-top:1px solid #222; padding-top:6px; font-size:12.5px; color:#444; }
  @media print { body { margin:0 auto; } .noprint { display:none; } }
</style></head>
<body>
<div class="noprint" style="margin:0 0 18px"><button style="font-size:14px;padding:8px 16px" onclick="window.print()">Print / Save as PDF</button></div>
<header>
  <h1>Scope of Work</h1>
  <div class="meta">${escapeHtml(title(s))} &nbsp;·&nbsp; ${s.prop.beds} bd / ${s.prop.baths} ba${s.prop.halfBaths ? ` + ${s.prop.halfBaths} half` : ''} &nbsp;·&nbsp; ${s.prop.sqft.toLocaleString()} sqft &nbsp;·&nbsp; Prepared ${today()}</div>
</header>
${secHtml || '<p><em>No items selected.</em></p>'}
<div class="range">
  <table>
    <tr><td>Low estimate</td><td class="c">${money0(totals.low)}</td><td class="c">${s.prop.sqft > 0 ? money0(totals.low / s.prop.sqft) + '/sf' : ''}</td></tr>
    <tr><td>Base estimate</td><td class="c">${money0(totals.base)}</td><td class="c">${s.prop.sqft > 0 ? money0(totals.base / s.prop.sqft) + '/sf' : ''}</td></tr>
    <tr><td>High estimate</td><td class="c">${money0(totals.high)}</td><td class="c">${s.prop.sqft > 0 ? money0(totals.high / s.prop.sqft) + '/sf' : ''}</td></tr>
  </table>
</div>
<p class="note">Owner estimates for bidding purposes, not a quote. Contractor to verify all quantities, field conditions, materials and pricing, and to itemize any exclusions in the bid. Costs shown are the base estimate; the low and high figures bracket the expected range. Permits and general conditions are listed where they appear in the scope above.</p>
<div class="sign"><div>Owner — Date</div><div>Contractor — Date</div></div>
</body></html>`;
}
