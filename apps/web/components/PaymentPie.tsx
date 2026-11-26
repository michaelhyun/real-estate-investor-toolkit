'use client';

/* What a total is made of, as a ring. On the Mortgage page: one monthly
   payment as principal, interest, taxes, insurance, and PMI or HOA when the
   loan has them. On the Income Tax page: income as federal tax, state tax and
   what is kept. The total sits in the middle, and the list beside it carries
   every amount, so the chart is never the only place a number lives. Pointing
   at a slice (or its row) lifts it and swaps the middle to that part's amount
   and share.

   Slice colours are fixed per part, never by position, so a part keeps its
   colour when another drops out. Principal and interest match the amortization
   charts. Each colour set was checked for colour-blind separation between
   neighbours; slices are also separated by a gap and named in the list.

   `soft` is the finer drawing: a slimmer ring on a faint track, segments with
   rounded ends, and list rows whose divider doubles as a share bar. */

import { useState } from 'react';
import { money0 } from '@reit/core';
import { cn } from '@/lib/utils';
import { PRINCIPAL, INTEREST } from './AmortizationCharts';

export const PIE_COLORS = {
  principal: PRINCIPAL, interest: INTEREST,
  tax: '#9a4bd0', ins: '#6a9a1f', pmi: '#d6417c', hoa: '#0b93b5',
} as const satisfies Record<string, string>;

export interface PiePart { key: string; label: string; value: number; note?: string }

const SIZE = 136, C = SIZE / 2, R_OUT = 66, R_IN = 45;
/* soft look: corner radius of a segment, and the clear gap between two */
const ROUND = 2.5, GAP = 3;

/* rounded, so the server and the browser print the same path */
const pt = (r: number, a: number) => `${(C + r * Math.cos(a)).toFixed(2)},${(C + r * Math.sin(a)).toFixed(2)}`;
function ring(a0: number, a1: number, ro: number, ri: number) {
  const big = a1 - a0 > Math.PI ? 1 : 0;
  return `M${pt(ro, a0)}A${ro},${ro} 0 ${big} 1 ${pt(ro, a1)}L${pt(ri, a1)}A${ri},${ri} 0 ${big} 0 ${pt(ri, a0)}Z`;
}
const fullRing = (ro: number, ri: number) =>
  `M${C - ro},${C}a${ro},${ro} 0 1 0 ${ro * 2},0a${ro},${ro} 0 1 0 ${-ro * 2},0ZM${C - ri},${C}a${ri},${ri} 0 1 0 ${ri * 2},0a${ri},${ri} 0 1 0 ${-ri * 2},0Z`;

export function PaymentPie({
  parts, total, caption, colors = PIE_COLORS, centerLabel = 'per month', centerNote, title = 'Monthly payment',
  size = SIZE, soft = false, list = true, active, onActive,
}: {
  parts: PiePart[]; total: number; caption?: string;
  /** A colour per part key. Other pages pass their own validated set. */
  colors?: Record<string, string>;
  /** What the figure in the middle is, and what the chart is called aloud. */
  centerLabel?: string; title?: string;
  /** Soft look only: a line under the middle figure when nothing is pointed at. */
  centerNote?: string;
  /** Drawn width of the ring in px. Above the default, the list grows with it. */
  size?: number;
  /** The finer drawing described at the top of this file. */
  soft?: boolean;
  /** false draws the ring alone, for a page that shows the parts itself. */
  list?: boolean;
  /** The pointed-at part, when the page owns it so its own cards can follow. */
  active?: string | null; onActive?: (key: string | null) => void;
}) {
  const big = size > SIZE;
  const rIn = soft ? R_OUT - 14 : R_IN;
  const shown = parts.filter(p => p.value > 0);
  const sum = shown.reduce((t, p) => t + p.value, 0);
  const [own, setOwn] = useState<{ key: string } | null>(null);
  const hover = active !== undefined ? (active ? { key: active } : null) : own;
  const setHover = (h: { key: string } | null) => { setOwn(h); onActive?.(h ? h.key : null); };
  const hp = hover ? shown.find(p => p.key === hover.key) : null;
  const frac = (v: number) => sum > 0 ? v / sum : 0;
  const share = (v: number) => {
    const s = frac(v) * 100;
    return s > 0 && s < 1 ? '<1%' : `${Math.round(s)}%`;
  };

  let a = -Math.PI / 2;
  const slices = shown.map(p => {
    const a0 = a, a1 = a + frac(p.value) * Math.PI * 2;
    a = a1;
    return { p, a0, a1 };
  });

  /* soft segments are drawn inset and then stroked in their own colour, which
     rounds the corners; the angle is trimmed so a clear gap is left between */
  const softPath = (a0: number, a1: number, grow: number) => {
    const ro = R_OUT + grow - ROUND, ri = rIn + ROUND;
    const pad = (GAP / 2 + ROUND) / ((ro + ri) / 2);
    const mid = (a0 + a1) / 2;
    const b0 = a1 - a0 > pad * 2 + 0.02 ? a0 + pad : mid - 0.01;
    const b1 = a1 - a0 > pad * 2 + 0.02 ? a1 - pad : mid + 0.01;
    return ring(b0, b1, ro, ri);
  };

  return (
    <div className={cn('flex flex-wrap items-center justify-center gap-y-3', big ? 'gap-x-8' : 'gap-x-6')}>
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`-4 -4 ${SIZE + 8} ${SIZE + 8}`} role="img" className="block overflow-visible"
          aria-label={`${title} of ${money0(total)}: ${shown.map(p => `${p.label} ${money0(p.value)}`).join(', ')}.`}
          onPointerLeave={() => setHover(null)}>
          {(soft || sum <= 0) && <circle cx={C} cy={C} r={(R_OUT + rIn) / 2} fill="none" stroke="var(--line)" strokeOpacity={soft && sum > 0 ? 0.55 : 1} strokeWidth={R_OUT - rIn} />}
          {slices.map(({ p, a0, a1 }) => {
            const on = hover?.key === p.key;
            const move = () => setHover({ key: p.key });
            const lone = a1 - a0 >= Math.PI * 2 - 1e-6;
            const props = {
              fill: colors[p.key], strokeLinejoin: 'round' as const,
              ...(soft && !lone ? { stroke: colors[p.key], strokeWidth: ROUND * 2 } : { stroke: 'var(--card)', strokeWidth: 2 }),
              opacity: hover && !on ? (soft ? 0.3 : 0.4) : 1, className: 'transition-opacity duration-200',
              onPointerMove: move, onPointerDown: move,
            };
            /* a lone slice is a full ring, which an arc path cannot close on itself */
            return lone
              ? <path key={p.key} {...props} fillRule="evenodd" d={fullRing(R_OUT, rIn)} />
              : <path key={p.key} {...props} d={soft ? softPath(a0, a1, on ? 2 : 0) : ring(a0, a1, R_OUT + (on ? 2 : 0), rIn)} />;
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          {soft && (
            <div className="mb-1 max-w-[110px] text-[0.6875rem] font-bold uppercase leading-tight tracking-[0.08em] text-muted-foreground">
              {hp ? hp.label : centerLabel}
            </div>
          )}
          <div className={cn('font-extrabold leading-none tracking-[-0.02em] tabular-nums text-ink-strong', big ? 'text-[1.625rem]' : 'text-xl')}>{money0(hp ? hp.value : total)}</div>
          <div aria-live="polite" className={cn('font-semibold leading-tight text-muted-foreground', big ? 'mt-1 max-w-[104px] text-[0.8125rem]' : 'mt-0.5 max-w-[84px] text-[0.6875rem]')}>
            {soft
              ? (hp ? `${share(hp.value)} of the total` : centerNote)
              : hp ? <>{hp.label}<br />{share(hp.value)}</> : centerLabel}
          </div>
        </div>
      </div>

      {list && <div className={cn('min-w-[220px] flex-1', big ? 'max-w-[340px]' : 'max-w-[400px]')}>
        <ul onPointerLeave={() => setHover(null)}>
          {shown.map(p => (
            <li key={p.key}
              onPointerEnter={() => setHover({ key: p.key })}
              className={cn('relative flex items-center gap-2 transition-opacity duration-200',
                !soft && 'border-b border-line/60 last:border-b-0',
                soft ? 'min-h-11 pb-1.5 pt-1 text-[0.9375rem]' : big ? 'min-h-10 py-1 text-[0.9375rem]' : 'min-h-7 py-0.5 text-sm',
                hover && hover.key !== p.key && (soft ? 'opacity-40' : 'opacity-50'))}>
              <span className={cn('shrink-0', soft ? 'size-2.5 rounded-full' : 'size-2.5 rounded-[2px]')} style={{ background: colors[p.key] }} />
              <span className={cn('min-w-0 flex-1 leading-snug', soft ? 'font-semibold text-ink-strong' : 'text-[#3a4352]')}>{p.label}
                {p.note ? <span className="block text-xs font-normal text-muted-foreground">{p.note}</span> : null}
              </span>
              <span className="w-9 text-right text-[0.8125rem] tabular-nums text-muted-foreground">{share(p.value)}</span>
              <span className={cn('text-right font-semibold tabular-nums text-ink-strong', big ? 'w-[5.5rem] text-base font-bold' : 'w-[4.5rem]')}>{money0(p.value)}</span>
              {/* the divider doubles as a bar of this part's share */}
              {soft && (
                <span aria-hidden className="absolute inset-x-0 bottom-0 h-[3px] overflow-hidden rounded-full bg-line/60">
                  <span className="block h-full rounded-full" style={{ width: `${Math.max(1.5, frac(p.value) * 100)}%`, background: colors[p.key] }} />
                </span>
              )}
            </li>
          ))}
        </ul>
        {caption ? <p className="mt-1.5 text-xs leading-snug text-muted-foreground">{caption}</p> : null}
      </div>}
    </div>
  );
}
