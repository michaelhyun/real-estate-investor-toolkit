'use client';

/* The two amortization charts every loan view shares: the Rental Analyzer's
   dialog and the Mortgage Calculator's panel.

     - the remaining balance, year by year, and
     - what each year's payments went to, principal against interest.

   Two charts rather than one because the balance and a year's payments are on
   very different scales, and one chart never gets two y-axes. They share one
   hovered year: pointing at either marks that year on both, and a small popup
   beside the pointer gives the year's numbers.

   Colours: blue is principal (money that builds equity), amber is interest
   (cost). The pair is checked for colour-blind separation; the legend and the
   popup name them, so colour is never the only cue. AmortTable carries the same
   numbers as a table. */

import { useEffect, useMemo, useState } from 'react';
import { money0 } from '@reit/core';
import { cn } from '@/lib/utils';

export const PRINCIPAL = 'var(--primary)';
export const INTEREST = '#b8651a';
const GRID = 'var(--line)';
const INK = 'var(--muted-foreground)';

export interface AmortRow { year: number; principal: number; interest: number; balance: number }

const compact = (n: number) =>
  n >= 1e6 ? `$${+(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}k` : `$${Math.round(n)}`;

/* 3–4 round gridline values that cover max */
function ticks(max: number): number[] {
  if (max <= 0) return [0];
  const raw = max / 3;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(v => v >= raw) || raw;
  const out: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) out.push(v);
  if (out[out.length - 1] < max) out.push(out[out.length - 1] + step);
  return out;
}

/* Width of an element that may mount late (a dialog renders in a portal, so a
   plain ref is still empty when the first effect runs). */
export function useWidth<T extends HTMLElement>() {
  const [el, setEl] = useState<T | null>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!el) return;
    setW(Math.floor(el.getBoundingClientRect().width));
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, w] as const;
}

const M = { top: 8, right: 8, bottom: 22, left: 44 };
const H = 148;
const TIP_W = 176;

type Which = 'bal' | 'pay';

export function AmortizationCharts({ years, startBalance }: { years: AmortRow[]; startBalance: number }) {
  const n = years.length;
  /* the hovered year (1-based), which chart the pointer or focus is on, and how
     far down that chart the pointer is */
  const [hover, setHover] = useState<{ year: number; on: Which; y: number | null } | null>(null);
  const [wrapRef, width] = useWidth<HTMLDivElement>();

  useEffect(() => { setHover(null); }, [n]);

  /* the year principal first outweighs interest — where the loan "tips" */
  const tipYear = useMemo(() => years.find(y => y.principal > y.interest)?.year ?? null, [years]);

  const iw = Math.max(0, width - M.left - M.right);
  const ih = H - M.top - M.bottom;
  const balTicks = ticks(startBalance);
  const balMax = balTicks[balTicks.length - 1] || 1;
  /* a balloon payoff year would flatten every other bar, so when one year towers
     over the rest the payment axis is scaled to ordinary years and that bar is
     drawn capped, with its value in the popup */
  const totals = years.map(y => y.interest + y.principal);
  const sorted = [...totals].sort((a, b) => a - b);
  const typical = sorted.length ? sorted[Math.floor((sorted.length - 1) * 0.9)] : 0;
  const peak = Math.max(0, ...totals);
  const hasOutlier = typical > 0 && peak > typical * 2;
  const payTicks = ticks(hasOutlier ? typical * 1.15 : peak);
  const payMax = payTicks[payTicks.length - 1] || 1;

  const band = n ? iw / n : 0;
  const xMid = (year: number) => M.left + (year - 0.5) * band;        /* bars: centre of the year */
  const xEnd = (year: number) => M.left + (n ? year / n * iw : 0);    /* balance: end of the year */
  const yBal = (v: number) => M.top + ih - v / balMax * ih;
  const yPay = (v: number) => M.top + ih - Math.min(v, payMax) / payMax * ih;

  const xLabels = useMemo(() => {
    const step = n <= 10 ? 1 : n <= 40 ? 5 : 10;
    const out: number[] = [];
    for (let y = step; y <= n; y += step) out.push(y);
    return out;
  }, [n]);

  const handlers = (on: Which) => {
    const move = (ev: React.PointerEvent<SVGSVGElement>) => {
      if (!band) return;
      const rect = ev.currentTarget.getBoundingClientRect();
      const x = ev.clientX - rect.left - M.left;
      /* the line chart's points sit at year ends, so snap to the nearest one;
         bars own the whole width of their year */
      const year = on === 'bal' ? Math.round(x / band) : Math.ceil(x / band);
      setHover({ year: Math.min(n, Math.max(1, year)), on, y: ev.clientY - rect.top });
    };
    const step = (to: (cur: number | null) => number) => (ev: React.KeyboardEvent) => {
      ev.preventDefault();
      setHover(h => ({ year: to(h?.year ?? null), on, y: null }));
    };
    return {
      onPointerMove: move, onPointerDown: move,
      onPointerLeave: () => setHover(null),
      onBlur: () => setHover(null),
      onKeyDown: (ev: React.KeyboardEvent) => {
        if (!n) return;
        if (ev.key === 'ArrowRight') step(c => Math.min(n, (c ?? 0) + 1))(ev);
        else if (ev.key === 'ArrowLeft') step(c => Math.max(1, (c ?? n + 1) - 1))(ev);
        else if (ev.key === 'Home') step(() => 1)(ev);
        else if (ev.key === 'End') step(() => n)(ev);
        else if (ev.key === 'Escape') setHover(null);
      },
    };
  };

  const hy = hover ? years[hover.year - 1] : null;
  const balPath = n && iw
    ? `M${xEnd(0)},${yBal(startBalance)}` + years.map(y => `L${xEnd(y.year)},${yBal(y.balance)}`).join('')
    : '';
  const barW = Math.max(2, Math.min(18, band * 0.7));
  const axisText = { fontSize: 11, fill: INK } as const;
  const svgClass = 'block touch-none rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

  /* year labels sit under the bar on the bar chart, and under the year-end point on the line */
  const xAxis = (at: (y: number) => number) => (
    <g>
      {xLabels.map(y => (
        <text key={y} x={at(y)} y={H - 6} textAnchor={y === n ? 'end' : 'middle'} style={axisText}>{y === xLabels[0] ? `Year ${y}` : y}</text>
      ))}
    </g>
  );

  /* The popup: beside the hovered year, on whichever side has room, and level
     with the pointer (or near the top when stepping with the keyboard). */
  const popup = (on: Which) => {
    if (!hy || hover?.on !== on) return null;
    const px = on === 'bal' ? xEnd(hy.year) : xMid(hy.year);
    const gap = on === 'bal' ? 12 : barW / 2 + 10;
    const right = px + gap + TIP_W <= width;
    const left = right ? px + gap : Math.max(0, px - gap - TIP_W);
    const top = Math.max(0, Math.min(H - 118, (hover.y ?? 24) - 40));
    return (
      <div role="status" aria-live="polite"
        className="pointer-events-none absolute z-10 rounded-md bg-popover px-3 py-2 text-[0.8125rem] leading-snug shadow-fluffy ring-1 ring-line"
        style={{ left, top, width: TIP_W }}>
        <div className="mb-1 font-bold text-ink-strong">Year {hy.year}</div>
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-0.5 tabular-nums">
          <dt className="flex items-center gap-1.5 text-[#3a4352]"><span className="size-2 rounded-[2px]" style={{ background: PRINCIPAL }} />Principal</dt>
          <dd className="text-right font-semibold text-ink-strong">{money0(hy.principal)}</dd>
          <dt className="flex items-center gap-1.5 text-[#3a4352]"><span className="size-2 rounded-[2px]" style={{ background: INTEREST }} />Interest</dt>
          <dd className="text-right font-semibold text-ink-strong">{money0(hy.interest)}</dd>
          <dt className="mt-1 border-t border-line pt-1 text-[#3a4352]">Balance left</dt>
          <dd className="mt-1 border-t border-line pt-1 text-right font-bold text-ink-strong">{money0(hy.balance)}</dd>
        </dl>
      </div>
    );
  };

  if (n === 0) return null;

  return (
    <div ref={wrapRef} className="flex flex-col gap-4">
      <section>
        <h3 className="mb-1 text-sm font-bold text-ink-strong">Remaining balance</h3>
        <div className="relative">
          {width > 0 && (
            <svg width={width} height={H} role="img" tabIndex={0} className={svgClass} {...handlers('bal')}
              aria-label={`Remaining loan balance by year, starting at ${money0(startBalance)}, over ${n} years. Use the arrow keys to step through the years.`}>
              {balTicks.map(t => (
                <g key={t}>
                  <line x1={M.left} x2={M.left + iw} y1={yBal(t)} y2={yBal(t)} stroke={GRID} strokeWidth={1} />
                  <text x={M.left - 6} y={yBal(t) + 4} textAnchor="end" style={axisText}>{compact(t)}</text>
                </g>
              ))}
              <path d={`${balPath}L${xEnd(n)},${yBal(0)}L${xEnd(0)},${yBal(0)}Z`} fill={PRINCIPAL} opacity={0.1} />
              <path d={balPath} fill="none" stroke={PRINCIPAL} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              {hy && (
                <g>
                  <line x1={xEnd(hy.year)} x2={xEnd(hy.year)} y1={M.top} y2={M.top + ih} stroke="var(--line-strong)" strokeWidth={1} />
                  <circle cx={xEnd(hy.year)} cy={yBal(hy.balance)} r={5} fill={PRINCIPAL} stroke="var(--popover)" strokeWidth={2} />
                </g>
              )}
              {xAxis(xEnd)}
            </svg>
          )}
          {popup('bal')}
        </div>
      </section>

      <section>
        <div className="mb-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <h3 className="text-sm font-bold text-ink-strong">Where each year&apos;s payments go</h3>
          <ul className="flex items-center gap-4 text-[0.8125rem] text-[#3a4352]">
            <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-[2px]" style={{ background: PRINCIPAL }} />Principal</li>
            <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-[2px]" style={{ background: INTEREST }} />Interest</li>
          </ul>
        </div>
        <div className="relative">
          {width > 0 && (
            <svg width={width} height={H} role="img" tabIndex={0} className={svgClass} {...handlers('pay')}
              aria-label={`Each year's payments split into principal and interest over ${n} years. Use the arrow keys to step through the years.`}>
              {payTicks.map(t => (
                <g key={t}>
                  <line x1={M.left} x2={M.left + iw} y1={yPay(t)} y2={yPay(t)} stroke={GRID} strokeWidth={1} />
                  <text x={M.left - 6} y={yPay(t) + 4} textAnchor="end" style={axisText}>{compact(t)}</text>
                </g>
              ))}
              {years.map(y => {
                const total = y.principal + y.interest;
                const capped = total > payMax;
                /* principal sits on the baseline, interest on top, a 2px gap between */
                const pH = Math.min(y.principal, payMax) / payMax * ih;
                const iH = Math.max(0, (Math.min(total, payMax) - Math.min(y.principal, payMax)) / payMax * ih);
                const gap = pH > 3 && iH > 3 ? 2 : 0;
                const x = xMid(y.year) - barW / 2;
                const base = M.top + ih;
                const dim = hover != null && hover.year !== y.year ? 0.45 : 1;
                const r = Math.min(3, barW / 2);
                return (
                  <g key={y.year} opacity={dim}>
                    {pH > 0 && <rect x={x} y={base - pH} width={barW} height={pH} fill={PRINCIPAL} rx={iH > 0 ? 0 : r} />}
                    {iH > gap && <rect x={x} y={base - pH - iH} width={barW} height={iH - gap} fill={INTEREST} rx={r} />}
                    {capped && <path d={`M${x - 1},${M.top + 5}l${barW / 2 + 1},-5l${barW / 2 + 1},5`} fill="none" stroke="var(--ink-strong)" strokeWidth={1.5} />}
                  </g>
                );
              })}
              {xAxis(xMid)}
            </svg>
          )}
          {popup('pay')}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {hasOutlier
            ? 'A bar with an arrow above it holds a balloon payoff and runs off the scale. Point at it for the amount.'
            : tipYear && tipYear > 1
              ? `Interest takes most of each payment until year ${tipYear}. Point at a year for its numbers.`
              : 'Point at a year for its numbers.'}
        </p>
      </section>
    </div>
  );
}

/* The same numbers as a table, folded away under the charts. */
export function AmortTable({ years, markYear, className }: { years: AmortRow[]; markYear?: number; className?: string }) {
  return (
    <details className={cn('group text-sm', className)}>
      <summary className="cursor-pointer list-none font-semibold text-primary hover:underline [&::-webkit-details-marker]:hidden">
        <span className="group-open:hidden">Show the year-by-year table</span>
        <span className="hidden group-open:inline">Hide the table</span>
      </summary>
      <div className="mt-2 max-h-64 overflow-auto rounded-md border border-line">
        <table className="w-full text-right text-[0.8125rem] tabular-nums">
          <thead className="sticky top-0 bg-card">
            <tr className="border-b border-line text-xs uppercase tracking-[0.08em] text-muted-foreground">
              <th scope="col" className="px-3 py-1.5 text-left font-bold">Year</th>
              <th scope="col" className="px-3 py-1.5 font-bold">Principal</th>
              <th scope="col" className="px-3 py-1.5 font-bold">Interest</th>
              <th scope="col" className="px-3 py-1.5 font-bold">Balance</th>
            </tr>
          </thead>
          <tbody>
            {years.map(y => (
              <tr key={y.year} className={cn('border-b border-line/60 last:border-0', y.year === markYear && 'bg-primary-tint')}>
                <th scope="row" className="px-3 py-1 text-left font-semibold text-ink-strong">{y.year}</th>
                <td className="px-3 py-1">{money0(y.principal)}</td>
                <td className="px-3 py-1">{money0(y.interest)}</td>
                <td className="px-3 py-1 font-semibold text-ink-strong">{money0(y.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
