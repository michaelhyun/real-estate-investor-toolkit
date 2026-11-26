'use client';

/* What one monthly payment is made of, as a ring: principal, interest, taxes,
   insurance, and PMI or HOA when the loan has them. The total sits in the
   middle, and the list beside it carries every amount, so the chart is never
   the only place a number lives. Pointing at a slice (or its row) lifts it and
   swaps the middle to that part's amount and share.

   Slice colours are fixed per part, never by position, so a part keeps its
   colour when another drops out. Principal and interest match the amortization
   charts. The order was checked for colour-blind separation between
   neighbours; slices are also separated by a gap and named in the list. */

import { useState } from 'react';
import { money0 } from '@reit/core';
import { cn } from '@/lib/utils';
import { PRINCIPAL, INTEREST } from './AmortizationCharts';

export const PIE_COLORS = {
  principal: PRINCIPAL, interest: INTEREST,
  tax: '#9a4bd0', ins: '#6a9a1f', pmi: '#d6417c', hoa: '#0b93b5',
} as const;

export interface PiePart { key: keyof typeof PIE_COLORS; label: string; value: number; note?: string }

const SIZE = 136, C = SIZE / 2, R_OUT = 66, R_IN = 45;

const pt = (r: number, a: number) => `${C + r * Math.cos(a)},${C + r * Math.sin(a)}`;
function ring(a0: number, a1: number, grow = 0) {
  const ro = R_OUT + grow, big = a1 - a0 > Math.PI ? 1 : 0;
  return `M${pt(ro, a0)}A${ro},${ro} 0 ${big} 1 ${pt(ro, a1)}L${pt(R_IN, a1)}A${R_IN},${R_IN} 0 ${big} 0 ${pt(R_IN, a0)}Z`;
}

export function PaymentPie({ parts, total, caption }: { parts: PiePart[]; total: number; caption?: string }) {
  const shown = parts.filter(p => p.value > 0);
  const sum = shown.reduce((t, p) => t + p.value, 0);
  const [hover, setHover] = useState<{ key: string } | null>(null);
  const hp = hover ? shown.find(p => p.key === hover.key) : null;
  const share = (v: number) => {
    const s = sum > 0 ? v / sum * 100 : 0;
    return s > 0 && s < 1 ? '<1%' : `${Math.round(s)}%`;
  };

  let a = -Math.PI / 2;
  const slices = shown.map(p => {
    const a0 = a, a1 = a + (sum > 0 ? p.value / sum : 0) * Math.PI * 2;
    a = a1;
    return { p, a0, a1 };
  });

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3">
      <div className="relative shrink-0" style={{ width: SIZE, height: SIZE }}>
        <svg width={SIZE} height={SIZE} viewBox={`-4 -4 ${SIZE + 8} ${SIZE + 8}`} role="img" className="block overflow-visible"
          aria-label={`Monthly payment of ${money0(total)}: ${shown.map(p => `${p.label} ${money0(p.value)}`).join(', ')}.`}
          onPointerLeave={() => setHover(null)}>
          {sum <= 0 && <circle cx={C} cy={C} r={(R_OUT + R_IN) / 2} fill="none" stroke="var(--line)" strokeWidth={R_OUT - R_IN} />}
          {slices.map(({ p, a0, a1 }) => {
            const on = hover?.key === p.key;
            const move = () => setHover({ key: p.key });
            const props = {
              fill: PIE_COLORS[p.key], stroke: 'var(--card)', strokeWidth: 2, strokeLinejoin: 'round' as const,
              opacity: hover && !on ? 0.4 : 1, className: 'transition-opacity',
              onPointerMove: move, onPointerDown: move,
            };
            /* a lone slice is a full ring, which an arc path cannot close on itself */
            return a1 - a0 >= Math.PI * 2 - 1e-6
              ? <path key={p.key} {...props} fillRule="evenodd"
                  d={`M${C - R_OUT},${C}a${R_OUT},${R_OUT} 0 1 0 ${R_OUT * 2},0a${R_OUT},${R_OUT} 0 1 0 ${-R_OUT * 2},0ZM${C - R_IN},${C}a${R_IN},${R_IN} 0 1 0 ${R_IN * 2},0a${R_IN},${R_IN} 0 1 0 ${-R_IN * 2},0Z`} />
              : <path key={p.key} {...props} d={ring(a0, a1, on ? 2 : 0)} />;
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <div className="text-xl font-extrabold leading-none tracking-[-0.02em] tabular-nums text-ink-strong">{money0(hp ? hp.value : total)}</div>
          <div aria-live="polite" className="mt-0.5 max-w-[84px] text-[0.6875rem] font-semibold leading-tight text-muted-foreground">
            {hp ? <>{hp.label}<br />{share(hp.value)}</> : 'per month'}
          </div>
        </div>
      </div>

      <div className="min-w-[220px] max-w-[400px] flex-1">
        <ul onPointerLeave={() => setHover(null)}>
          {shown.map(p => (
            <li key={p.key}
              onPointerEnter={() => setHover({ key: p.key })}
              className={cn('flex min-h-7 items-center gap-2 border-b border-line/60 py-0.5 text-sm transition-opacity last:border-b-0',
                hover && hover.key !== p.key && 'opacity-50')}>
              <span className="size-2.5 shrink-0 rounded-[2px]" style={{ background: PIE_COLORS[p.key] }} />
              <span className="min-w-0 flex-1 leading-snug text-[#3a4352]">{p.label}
                {p.note ? <span className="block text-xs text-muted-foreground">{p.note}</span> : null}
              </span>
              <span className="w-9 text-right text-[0.8125rem] tabular-nums text-muted-foreground">{share(p.value)}</span>
              <span className="w-[4.5rem] text-right font-semibold tabular-nums text-ink-strong">{money0(p.value)}</span>
            </li>
          ))}
        </ul>
        {caption ? <p className="mt-1.5 text-xs leading-snug text-muted-foreground">{caption}</p> : null}
      </div>
    </div>
  );
}
