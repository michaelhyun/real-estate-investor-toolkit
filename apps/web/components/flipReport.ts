/* Print-ready documents for the flip analyzer — a one-page deal report and a
   contractor-ready scope of work. Same shape as report.ts: build a whole HTML
   document as a string and hand it to openReportWindow to print. */

import {
  money, money0, pct, computeFlip, solveMAO, seventyRule, verdictFor,
  SCENARIO_KEYS, findCity,
  buildSpaces, computeSow, taskQty, taskKey, taskCost, DEF_BY_KIND,
  type FlipState, type PropertyShape,
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
  const r = computeFlip(s, 'base');
  const cols = SCENARIO_KEYS.map(k => computeFlip(s, k));
  const v = verdictFor(r, s);
  const mao = solveMAO(s);
  const city = findCity(s.citySlug);

  const scenarioRow = (label: string, pick: (x: typeof cols[number]) => string) =>
    `<tr><td>${label}</td>` + cols.map(c => `<td class="r">${pick(c)}</td>`).join('') + '</tr>';

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

<div class="verdict">${escapeHtml(v.title)} — ${money(r.profit)} net profit · ${r.roi.toFixed(1)}% ROI · ${r.annualizedRoi.toFixed(1)}% annualized</div>

<h2>The deal</h2>
<table>
  <tr><td>Purchase price</td><td class="r">${money0(s.price)}</td>
      <td>ARV — base</td><td class="r">${money0(s.arv.base)}</td></tr>
  <tr><td>Purchase $/sqft</td><td class="r">${money0(r.pricePsf)}</td>
      <td>ARV $/sqft</td><td class="r">${money0(r.arvPsf)}</td></tr>
  <tr><td>Rehab — base</td><td class="r">${money0(r.rehabTotal)}</td>
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
  <tr><td>Less rehab budget</td><td class="r">(${money0(r.rehabTotal)})</td></tr>
  <tr><td>Less holding costs</td><td class="r">(${money0(r.holdTotal)})</td></tr>
  <tr><td>Less financing</td><td class="r">(${money0(r.finTotal)})</td></tr>
  <tr class="total"><td>Net profit</td><td class="r">${money(r.profit)}</td></tr>
</table>

<h2>Scenarios — the three ARV cases</h2>
<table class="grid-tbl">
  <tr><th></th>${SCENARIO_KEYS.map(k =>
    `<th>ARV ${k}<br><span class="s">${money0(s.arv[k])}</span></th>`).join('')}</tr>
  ${scenarioRow('Net profit', c => money(c.profit))}
  ${scenarioRow('Return on cash', c => c.roi.toFixed(1) + '%')}
  ${scenarioRow('Annualized', c => c.annualizedRoi.toFixed(1) + '%')}
  ${scenarioRow('Peak cash', c => money0(c.peakCash))}
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
Property tax assumes Prop 13 reassessment to the purchase price. Every profit figure here is before income tax.</p>
</body></html>`;
}

export function buildScopeOfWork(
  s: FlipState, catalogPrices: Record<string, number>,
): string {
  const p: PropertyShape = {
    sqft: s.prop.sqft, beds: s.prop.beds, baths: s.prop.baths,
    halfBaths: s.prop.halfBaths, stories: s.prop.stories, garageBays: s.prop.garageBays,
  };
  const spaces = buildSpaces(p).map(sp => ({ ...sp, sqft: s.spaceSqft[sp.id] ?? sp.sqft }));
  const totals = computeSow(spaces, s.checked, s.qty, catalogPrices, p);


  const secHtml = spaces.map(sp => {
    const def = DEF_BY_KIND[sp.kind];
    const tasks = def.tasks.filter(t => s.checked[taskKey(sp.id, t.id)]);
    if (!tasks.length) return '';
    const tot = totals.spaces.find(x => x.id === sp.id)!;
    return `<h2>${escapeHtml(sp.label)}${sp.room && sp.sqft ? ` <span class="s">${sp.sqft} sf</span>` : ''}</h2>
<table>
  <tr><th>Task</th><th class="c">Qty</th><th class="c">Unit</th><th class="c">Est. cost</th></tr>
  ${tasks.map(t => {
    const key = taskKey(sp.id, t.id);
    const q = s.qty[key] !== undefined ? s.qty[key] : taskQty(t, sp, p);
    const price = taskCost(sp.kind, t, catalogPrices);
    const cost = t.pctOfHard ? totals.hard * price / 100 : q * price;
    return `<tr><td>${escapeHtml(t.desc)}${t.note ? `<br><span class="s">${escapeHtml(t.note)}</span>` : ''}</td>` +
      `<td class="c">${t.pctOfHard ? '—' : q}</td>` +
      `<td class="c">${t.pctOfHard ? `${price}% of hard` : escapeHtml(t.unit)}</td>` +
      `<td class="c">${money0(cost)}</td></tr>`;
  }).join('')}
  <tr class="sub"><td colspan="3">${escapeHtml(sp.label)} subtotal</td><td class="c">${money0(tot.cost)}</td></tr>
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
${secHtml || '<p><em>Nothing scoped yet.</em></p>'}
<div class="range">
  <table>
    <tr><td><b>Total estimate</b></td><td class="c">${money0(totals.total)}</td><td class="c">${s.prop.sqft > 0 ? money0(totals.total / s.prop.sqft) + '/sf' : ''}</td></tr>
  </table>
</div>
<p class="note">Owner estimates for bidding purposes, not a quote. Contractor to verify all quantities, field conditions, materials and pricing, and to itemise any exclusions in the bid. Permits, general conditions and contingency appear under their own heading where scoped.</p>
<div class="sign"><div>Owner — Date</div><div>Contractor — Date</div></div>
</body></html>`;
}
