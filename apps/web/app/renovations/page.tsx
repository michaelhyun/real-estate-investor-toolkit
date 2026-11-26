'use client';

/* Renovation Guide: a reference, not a calculator. Built from shadcn pieces.

   Fifty renovations and what they cost in the Bay Area. The page is one
   scannable list: a row per renovation with its costs, time on site, permit
   and resale. A row opens to the two notes a cost table normally leaves out:
   what moves the price within the range, and what catches people out.

   Search covers those notes too. When a search matched a row through its
   notes rather than its name, the row opens by itself, so the reason it
   matched is on screen. */

import { useMemo, useState } from 'react';
import {
  RENOVATIONS, RENO_CATEGORIES, PERMIT_LABEL, RESALE_LABEL,
  searchRenovations, countByCategory, money0,
  type RenoCategory, type RenoItem,
} from '@reit/core';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Icon } from '../../components/Icon';
import { InfoTip } from '../../components/calc';
import { cn } from '@/lib/utils';

/** $35,000 to $120,000 reads as $35k–$120k in a list; small sums stay exact. */
const short = (n: number) => n >= 10000 ? `$${+(n / 1000).toFixed(n % 1000 ? 1 : 0)}k` : money0(n);
const range = (lo: number, hi: number) => lo === hi ? short(lo) : `${short(lo)}–${short(hi)}`;

const PERMIT_TONE = { none: 'bg-muted text-muted-foreground', sometimes: 'bg-muted text-[#3a4352]', yes: 'bg-warning-soft text-warning' } as const;
const RESALE_TONE = { high: 'bg-success-soft text-success', medium: 'bg-muted text-[#3a4352]', low: 'bg-destructive-soft text-destructive' } as const;
const tag = 'inline-flex h-5 items-center whitespace-nowrap rounded-full px-2 text-xs font-semibold';

/* one grid for the header and every row, so the columns line up */
const COLS = 'md:grid md:grid-cols-[minmax(0,1fr)_8.5rem_8.5rem_6.5rem_15rem] md:items-center md:gap-x-4';

function Row({ i, open, onToggle }: { i: RenoItem; open: boolean; onToggle: () => void }) {
  const wholeJob = i.unitLow === i.projectLow && i.unitHigh === i.projectHigh;
  const id = `reno-${i.id}`;
  return (
    <li className="border-b border-line/60 last:border-b-0">
      <button type="button" aria-expanded={open} aria-controls={id} onClick={onToggle}
        className={cn('w-full px-4 py-2.5 text-left outline-none hover:bg-muted/50 focus-visible:bg-muted/50', COLS, open && 'bg-muted/40')}>
        <span className="flex min-w-0 items-start gap-1">
          <Icon name="chevron_right" size={18} className={cn('-ml-1.5 mt-0.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
          <span className="min-w-0">
            <span className="block text-[0.9375rem] font-bold leading-snug text-ink-strong">{i.name}</span>
            <span className="block text-[0.8125rem] text-muted-foreground">{i.category}</span>
          </span>
        </span>
        {/* phone: the figures as one line under the name */}
        <span className="mt-1 block pl-4 text-[0.8125rem] tabular-nums text-[#3a4352] md:hidden">
          <b className="text-ink-strong">{range(i.projectLow, i.projectHigh)}</b> typical job · {i.days}
        </span>
        <span className="hidden text-sm tabular-nums md:block">
          {wholeJob ? <span className="text-muted-foreground">priced per job</span>
            : <><b className="font-semibold text-ink-strong">{range(i.unitLow, i.unitHigh)}</b><span className="block text-xs text-muted-foreground">per {i.unit}</span></>}
        </span>
        <span className="hidden text-sm font-bold tabular-nums text-ink-strong md:block">{range(i.projectLow, i.projectHigh)}</span>
        <span className="hidden text-sm text-[#3a4352] md:block">{i.days}</span>
        <span className="mt-1.5 flex flex-wrap gap-1.5 pl-4 md:mt-0 md:pl-0">
          <span className={cn(tag, PERMIT_TONE[i.permit])}>{i.permit === 'sometimes' ? 'Permit sometimes' : PERMIT_LABEL[i.permit]}</span>
          <span className={cn(tag, RESALE_TONE[i.resale])}>{RESALE_LABEL[i.resale]}</span>
        </span>
      </button>
      <div id={id} hidden={!open} className="grid gap-x-8 gap-y-2 bg-muted/40 px-4 pb-3.5 pl-8 pt-1 text-sm leading-snug text-[#3a4352] md:grid-cols-2">
        {!wholeJob && (
          <p className="tabular-nums md:hidden"><b className="text-ink-strong">{range(i.unitLow, i.unitHigh)}</b> per {i.unit}</p>
        )}
        <p><b className="mb-0.5 block text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">What moves the price</b>{i.drivers}</p>
        <p><b className="mb-0.5 flex items-center gap-1 text-xs font-bold uppercase tracking-[0.08em] text-warning"><Icon name="warning" size={14} />Watch out</b>{i.watch}</p>
      </div>
    </li>
  );
}

export default function RenovationsPage() {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<RenoCategory | 'all'>('all');
  /* rows the reader opened or shut by hand; anything else follows the search */
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const counts = useMemo(() => countByCategory(), []);
  const results = useMemo(() => searchRenovations(q, cat), [q, cat]);

  const term = q.trim().toLowerCase();
  const byNote = (i: RenoItem) => term.length > 1 && !i.name.toLowerCase().includes(term) && !i.category.toLowerCase().includes(term);
  const isOpen = (i: RenoItem) => toggled[i.id] ?? byNote(i);
  const allOpen = results.length > 0 && results.every(isOpen);
  const setAll = (open: boolean) => setToggled(p => ({ ...p, ...Object.fromEntries(results.map(i => [i.id, open])) }));

  const chip = (on: boolean) => cn(
    'inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-sm font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50',
    on ? 'bg-primary text-primary-foreground' : 'bg-card text-[#3a4352] shadow-tight hover:text-primary');
  const th = 'text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground';

  return (
    <>
      <div className="mb-4">
        <h1 className="text-[1.75rem] font-extrabold leading-tight tracking-[-0.015em] text-ink-strong">Renovation Guide</h1>
        <p className="text-[0.9375rem] text-muted-foreground">
          What {RENOVATIONS.length} common renovations cost in the Bay Area. Open a row for what moves the price and what to watch for.
        </p>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[240px] flex-1 sm:max-w-sm">
          <Icon name="search" size={18} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input type="search" value={q} aria-label="Search renovations" autoComplete="off"
            placeholder="Search work, materials or warnings" className="h-9 bg-card pl-8"
            onChange={ev => { setQ(ev.target.value); setToggled({}); }} />
        </div>
        <span className="text-sm tabular-nums text-muted-foreground">{results.length} of {RENOVATIONS.length}</span>
        <Button variant="ghost" size="sm" className="ml-auto" disabled={!results.length} onClick={() => setAll(!allOpen)}>
          <Icon name={allOpen ? 'unfold_less' : 'unfold_more'} size={18} />{allOpen ? 'Collapse all' : 'Expand all'}
        </Button>
      </div>

      <div role="group" aria-label="Category" className="mb-4 flex flex-wrap gap-1.5">
        <button type="button" aria-pressed={cat === 'all'} className={chip(cat === 'all')} onClick={() => setCat('all')}>
          All<span className="text-xs font-normal opacity-70">{RENOVATIONS.length}</span></button>
        {RENO_CATEGORIES.map(c => (
          <button type="button" key={c} aria-pressed={cat === c} className={chip(cat === c)} onClick={() => setCat(c)}>
            {c}<span className="text-xs font-normal opacity-70">{counts[c] ?? 0}</span></button>
        ))}
      </div>

      {results.length === 0 ? (
        <Card className="items-center gap-2 px-4 py-10 text-center">
          <Icon name="search_off" size={28} className="text-muted-foreground" />
          <p className="text-[0.9375rem] text-[#3a4352]">Nothing matches <b>{q}</b>{cat !== 'all' && <> in {cat}</>}.</p>
          <Button variant="outline" size="sm" onClick={() => { setQ(''); setCat('all'); }}>Clear the filters</Button>
        </Card>
      ) : (
        <Card className="gap-0 overflow-hidden py-0">
          <div className={cn('hidden border-b border-line bg-page px-4 py-2', COLS)}>
            <span className={cn(th, 'pl-4')}>Renovation</span>
            <span className={th}>Unit cost<InfoTip>What a contractor quotes, per the unit shown.</InfoTip></span>
            <span className={th}>Typical job<InfoTip>The whole job on a typical 1,500 sqft single-family home.</InfoTip></span>
            <span className={th}>Time on site</span>
            <span className={th}>Permit · resale<InfoTip>Resale is directional. Bay Area buyers pay for kitchens, baths and curb appeal far more than for mechanical work.</InfoTip></span>
          </div>
          <ul>
            {results.map(i => <Row key={i.id} i={i} open={isOpen(i)} onToggle={() => setToggled(p => ({ ...p, [i.id]: !isOpen(i) }))} />)}
          </ul>
        </Card>
      )}

      <p className="mt-4 text-[0.8125rem] leading-snug text-muted-foreground">
        Current-market estimates for budgeting and screening, not quotes. Costs move with materials,
        labour availability and the city you are in. Get three bids before committing, and treat any
        bid far below the range here as a question, not a bargain.
      </p>
    </>
  );
}
