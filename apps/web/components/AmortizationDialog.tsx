'use client';

/* Loan amortization at a glance, opened from the Rental Analyzer's financing
   panel. Two small charts share one hovered year:

     - the remaining balance across every note in the deal, and
     - what each year's payments went to, principal against interest.

   Two charts rather than one because the balance and a year's payments are on
   very different scales, and one chart never gets two y-axes. Colours: blue is
   principal (money that builds equity), amber is interest (cost). The pair is
   checked for colour-blind separation; a legend and the readout name them, so
   colour is never the only cue. A table of the same numbers sits underneath. */

import { useEffect, useMemo, useState } from 'react';
import { money0, type AmortResult } from '@reit/core';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const PRINCIPAL = 'var(--primary)';
const INTEREST = '#b8651a';
const GRID = 'var(--line)';
const INK = 'var(--muted-foreground)';

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

/* Width of an element that may mount late (the dialog renders in a portal, so
   a plain ref is still empty when the first effect runs). */
function useWidth<T extends HTMLElement>() {
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

export function AmortizationDialog({
  open, onOpenChange, data, notes,
}: {
  open: boolean; onOpenChange: (o: boolean) => void; data: AmortResult;
  /** One line per note, e.g. "Bank loan $200,000 at 7% for 30 yrs". */
  notes: string[];
}) {
  const { years, startBalance, totalInterest, balloon } = data;
  const n = years.length;
  const [hover, setHover] = useState<number | null>(null);   /* 1-based year */
  const [wrapRef, width] = useWidth<HTMLDivElement>();

  useEffect(() => { if (!open) setHover(null); }, [open]);

  const halfYear = useMemo(() => years.find(y => y.balance <= startBalance / 2)?.year ?? null, [years, startBalance]);
  /* the year principal first outweighs interest — where the loan "tips" */
  const tipYear = useMemo(() => years.find(y => y.principal > y.interest)?.year ?? null, [years]);

  const iw = Math.max(0, width - M.left - M.right);
  const ih = H - M.top - M.bottom;
  const balTicks = ticks(startBalance);
  const balMax = balTicks[balTicks.length - 1] || 1;
  /* a balloon year would flatten every other bar, so the payment axis is scaled
     to ordinary years and a balloon bar is drawn capped, with its value in the readout */
  const ordinary = years.map(y => y.interest + y.principal).sort((a, b) => a - b);
  const typical = ordinary.length ? ordinary[Math.floor((ordinary.length - 1) * 0.9)] : 0;
  const payTicks = ticks(balloon > 0 ? typical * 1.15 : Math.max(0, ...ordinary));
  const payMax = payTicks[payTicks.length - 1] || 1;

  const band = n ? iw / n : 0;
  const xMid = (year: number) => M.left + (year - 0.5) * band;        /* bars: centre of the year */
  const xEnd = (year: number) => M.left + (n ? year / n * iw : 0);    /* balance: end of the year */
  const yBal = (v: number) => M.top + ih - v / balMax * ih;
  const yPay = (v: number) => M.top + ih - Math.min(v, payMax) / payMax * ih;

  const xLabels = useMemo(() => {
    const step = n <= 10 ? 1 : n <= 20 ? 5 : n <= 40 ? 5 : 10;
    const out: number[] = [];
    for (let y = step; y <= n; y += step) out.push(y);
    return out;
  }, [n]);

  const onMove = (ev: React.PointerEvent<SVGSVGElement>) => {
    const rect = ev.currentTarget.getBoundingClientRect();
    const x = ev.clientX - rect.left - M.left;
    if (!band) return;
    setHover(Math.min(n, Math.max(1, Math.ceil(x / band))));
  };
  const onKey = (ev: React.KeyboardEvent) => {
    if (!n) return;
    if (ev.key === 'ArrowRight') { ev.preventDefault(); setHover(h => Math.min(n, (h ?? 0) + 1)); }
    else if (ev.key === 'ArrowLeft') { ev.preventDefault(); setHover(h => Math.max(1, (h ?? n + 1) - 1)); }
    else if (ev.key === 'Home') { ev.preventDefault(); setHover(1); }
    else if (ev.key === 'End') { ev.preventDefault(); setHover(n); }
  };

  const hy = hover ? years[hover - 1] : null;
  const balPath = n && iw
    ? `M${xEnd(0)},${yBal(startBalance)}` + years.map(y => `L${xEnd(y.year)},${yBal(y.balance)}`).join('')
    : '';
  const barW = Math.max(2, Math.min(18, band * 0.7));
  const axisText = { fontSize: 11, fill: INK } as const;

  const chartProps = {
    width, height: H, role: 'img' as const, tabIndex: 0,
    className: 'block touch-none rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
    onPointerMove: onMove, onPointerDown: onMove, onPointerLeave: () => setHover(null), onKeyDown: onKey,
  };
  /* year labels sit under the bar on the bar chart, and under the year-end point on the line */
  const xAxis = (at: (y: number) => number) => (
    <g>
      {xLabels.map(y => (
        <text key={y} x={at(y)} y={H - 6} textAnchor={y === n ? 'end' : 'middle'} style={axisText}>{y === xLabels[0] ? `Year ${y}` : y}</text>
      ))}
    </g>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Loan amortization</DialogTitle>
          <DialogDescription>{notes.join(' · ')}</DialogDescription>
        </DialogHeader>

        {n === 0 ? <p className="text-muted-foreground">There is no loan in this deal to amortize.</p> : (
          <>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {([
                ['Borrowed', money0(startBalance)],
                ['Total interest', money0(totalInterest)],
                ['Half paid off', halfYear ? `Year ${halfYear}` : '—'],
                balloon > 0 ? ['Balloon due', money0(balloon)] : ['Paid off', `Year ${n}`],
              ] as [string, string][]).map(([k, v]) => (
                <div key={k} className="rounded-md bg-page px-3 py-2.5">
                  <dt className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">{k}</dt>
                  <dd className="mt-0.5 text-lg font-extrabold leading-tight tracking-[-0.015em] tabular-nums text-ink-strong">{v}</dd>
                </div>
              ))}
            </dl>

            {/* one readout for both charts: the hovered year, or how to get one */}
            <p aria-live="polite" className="flex min-h-10 flex-wrap items-center gap-x-4 gap-y-0.5 rounded-md border border-line px-3 py-2 text-sm tabular-nums">
              {hy ? (
                <>
                  <span className="font-bold text-ink-strong">Year {hy.year}</span>
                  <span className="text-[#3a4352]">Balance <b className="font-bold text-ink-strong">{money0(hy.balance)}</b></span>
                  <span className="text-[#3a4352]">Principal <b className="font-bold text-ink-strong">{money0(hy.principal)}</b></span>
                  <span className="text-[#3a4352]">Interest <b className="font-bold text-ink-strong">{money0(hy.interest)}</b></span>
                </>
              ) : (
                <span className="text-muted-foreground">
                  {tipYear && tipYear > 1
                    ? `Interest takes most of each payment until year ${tipYear}. Point at a year to see its numbers.`
                    : 'Point at a year to see its numbers.'}
                </span>
              )}
            </p>

            <div ref={wrapRef} className="flex flex-col gap-4">
              <section>
                <h3 className="mb-1 text-sm font-bold text-ink-strong">Remaining balance</h3>
                {width > 0 && (
                  <svg {...chartProps} aria-label={`Remaining loan balance by year, from ${money0(startBalance)} to zero over ${n} years. Use the arrow keys to step through the years.`}>
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
              </section>

              <section>
                <div className="mb-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                  <h3 className="text-sm font-bold text-ink-strong">Where each year&apos;s payments go</h3>
                  <ul className="flex items-center gap-4 text-[0.8125rem] text-[#3a4352]">
                    <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-[2px]" style={{ background: PRINCIPAL }} />Principal</li>
                    <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-[2px]" style={{ background: INTEREST }} />Interest</li>
                  </ul>
                </div>
                {width > 0 && (
                  <svg {...chartProps} aria-label={`Each year's payments split into principal and interest over ${n} years. Use the arrow keys to step through the years.`}>
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
                      const dim = hover != null && hover !== y.year ? 0.45 : 1;
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
                {balloon > 0 && <p className="mt-1 text-xs text-muted-foreground">A bar with an arrow above it holds a balloon payoff and runs off the scale. Point at it for the amount.</p>}
              </section>
            </div>

            <details className="group text-sm">
              <summary className="cursor-pointer list-none font-semibold text-primary hover:underline [&::-webkit-details-marker]:hidden">
                <span className="group-open:hidden">Show the year-by-year table</span>
                <span className="hidden group-open:inline">Hide the table</span>
              </summary>
              <div className="mt-2 max-h-64 overflow-auto rounded-md border border-line">
                <table className="w-full text-right text-[0.8125rem]">
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
                      <tr key={y.year} className="border-b border-line/60 last:border-0">
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
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
