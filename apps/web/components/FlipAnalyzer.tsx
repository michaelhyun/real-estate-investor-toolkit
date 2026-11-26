'use client';

/* Bay Area Flip Analyzer. One page: what you type on the left, what it means on
   the right, the same shape as the Rental Analyzer.

   Built to be quick to fill in. The first three panels are the deal itself and
   open by default; acquisition, holding and selling costs come pre-filled (and
   re-filled by the city preset), so they start shut and show their totals.
   Each row's guidance sits behind a small info icon rather than on the page.

   The Scope of Work checklist is off the page for now. Its data (what is
   checked, quantities, room sizes, the shared price catalog) still round-trips
   through save and load untouched, so nothing saved earlier is lost.

   Storage: flipDeals.v1 holds saved deals, synced per account under kind
   'flip'; flipCalc.draft.v1 is the working draft. */

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  defaultFlipState, computeFlip, solveMAO, seventyRule, buildSensitivity,
  verdictFor, SELLER_PROVIDED, SCENARIO_KEYS, ACQ_ITEMS, HOLD_ITEMS, SELL_FLAT_ITEMS,
  citiesByCounty, findCity, listingLinks,
  money, money0, pct,
  type FlipState, type ScenarioKey, type CostLine, type FlipResult,
} from '@reit/core';
import { loadJSON, saveJSON, openReportWindow } from './ui';
import { Panel, Field, Line, SectionLabel, NumberField, Segmented, Stat, Verdict, Note, Toggle, InfoTip, CONTROL_W } from './calc';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { buildFlipReport } from './flipReport';
import { AddressInput } from './AddressInput';
import { toast } from './toast';
import { Icon } from './Icon';
import { useAuth } from './auth';
import { dealStore, mergeDeals } from '../lib/dealsync';
import { lookupProperty } from '../lib/rentcast';
import { cn } from '@/lib/utils';

const STORE_KEY = 'flipDeals.v1';
const DRAFT_KEY = 'flipCalc.draft.v1';

/* the account-side store for this tool — 'flip' is named once, here */
const cloud = dealStore<FlipState>('flip');

/* Panels that start shut: their rows come pre-filled, so most deals never
   need them opened. A panel absent from the map follows this default. */
const SHUT_BY_DEFAULT: Record<string, boolean> = { acq: true, hold: true, sell: true };

/* ------------------------------------------------------------ normalization */

function normalizeFlip(d: any): FlipState {
  const base = defaultFlipState();
  if (!d || typeof d !== 'object') return base;
  return {
    ...base, ...d,
    name: d.name || '',
    prop: { ...base.prop, ...(d.prop || {}), urls: (d.prop?.urls || []).map((u: any) => ({ label: u.label || '', url: u.url || '' })) },
    arv: { ...base.arv, ...(d.arv || {}) },
    /* Deals saved under the estimate-plus-buffer shape fold back into a
       triple; ones saved with rehab in months convert to days. */
    rehab: d.rehab ?? (d.rehabEst !== undefined
      ? { low: d.rehabEst, base: d.rehabEst + (d.rehabBuffer ?? 0), high: d.rehabEst + 2 * (d.rehabBuffer ?? 0) }
      : base.rehab),
    rehabDays: d.rehabDays ?? (d.rehabMonths !== undefined ? Math.round(d.rehabMonths * 30.4375) : base.rehabDays),
    overrunDays: d.overrunDays ?? (d.overrunMonths !== undefined ? Math.round(d.overrunMonths * 30.4375) : base.overrunDays),
    buyerCommPct: d.buyerCommPct ?? d.buyCommPct ?? base.buyerCommPct,
    /* The floor is a plain pre-tax number now. A deal saved back when the
       floor could be stated after tax is grossed up at the rate that deal
       carried, so it still means what it meant when it was typed. */
    minProfit: d.minProfitBasis === 'after' && d.minProfit
      ? Math.round(d.minProfit / (1 - (d.taxPct ?? 45) / 100))
      : (d.minProfit ?? base.minProfit),
    sellerDisclosure: d.sellerDisclosure ?? base.sellerDisclosure,
    liveIn: d.liveIn ?? base.liveIn,
    occupancyMonths: d.occupancyMonths ?? base.occupancyMonths,
    avoidedHousing: d.avoidedHousing ?? base.avoidedHousing,
    buySideCommPct: d.buySideCommPct ?? base.buySideCommPct,
    acq: { ...base.acq, ...(d.acq || {}) },
    hold: { ...base.hold, ...(d.hold || {}) },
    sell: { ...base.sell, ...(d.sell || {}) },
    /* Scope keys changed shape when the checklist became room-based, so old
       trade-catalog selections cannot be mapped and are dropped rather than
       silently mis-assigned. Prices, which live outside the deal, survive. */
    checked: Object.fromEntries(
      Object.entries(d.checked || {}).filter(([k]) => k.includes('.'))) as Record<string, boolean>,
    qty: Object.fromEntries(
      Object.entries(d.qty || {}).filter(([k]) => k.includes('.'))) as Record<string, number>,
    spaceSqft: d.spaceSqft || {},
    spaceLevel: d.spaceLevel || {},
  };
}

/* ------------------------------------------------------------------ helpers */

/* Three colour bands with a hard step at the profit floor, because that is the
   boundary that decides anything: a loss reads rust, a profit that misses your
   floor reads amber, and clearing the floor jumps straight to green. The step
   is deliberately abrupt — a smooth ramp through the floor would hide the one
   line you actually care about. */
const LOSS_0 = [246, 232, 224], LOSS_1 = [166, 71, 36];
const WARN_0 = [253, 246, 218], WARN_1 = [238, 208, 94];
const GOOD_0 = [176, 212, 197], GOOD_1 = [21, 86, 72];

const mix = (a: number[], b: number[], t: number) =>
  a.map((x, i) => Math.round(x + (b[i] - x) * Math.max(0, Math.min(1, t))));

function heatColor(v: number, floor: number, min: number, max: number) {
  let c: number[];
  if (v < 0) c = mix(LOSS_0, LOSS_1, min < 0 ? v / min : 0);
  else if (v < floor) c = mix(WARN_0, WARN_1, floor > 0 ? v / floor : 0);
  else c = mix(GOOD_0, GOOD_1, max > floor ? (v - floor) / (max - floor) : 0);
  const lum = (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;
  return { background: `rgb(${c.join(',')})`, color: lum > 0.58 ? '#21252b' : '#fff' };
}

const compact = (n: number) => {
  const a = Math.abs(n);
  const t = a >= 1000 ? `$${(a / 1000).toFixed(a >= 100000 ? 0 : 1)}k` : `$${Math.round(a)}`;
  return n < 0 ? `(${t})` : t;
};
/** Accounting style: a cost reads in parentheses, the way it does on paper. */
const paren = (n: number) => n === 0 ? '—' : `(${money0(n)})`;
const psf = (v: number, sqft: number) => sqft > 0 ? `${money0(v / sqft)}/sf` : '';
/** Days read naturally up to about a year; past that nobody counts in days. */
const holdLabel = (months: number) =>
  months >= 18 ? `${(months / 12).toFixed(1)} yrs` : `${Math.round(months * 30.4375)} days`;

/* ================================================================== the page */

type Tone = 'ok' | 'warn' | 'bad';
const TONE: Record<Tone, string> = { ok: 'text-success', warn: 'text-warning', bad: 'text-destructive' };
const say = (tone: Tone, text: string) => <span className={cn('font-semibold', TONE[tone])}>{text}</span>;

export function FlipAnalyzer({ modeSwitch }: { modeSwitch?: React.ReactNode }) {
  const [s, setS] = useState<FlipState>(defaultFlipState);
  const [shut, setShut] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [savedDeals, setSavedDeals] = useState<FlipState[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const { user } = useAuth();
  const syncedFor = useRef<string | null>(null);

  const set = <K extends keyof FlipState>(k: K, v: FlipState[K]) => setS(p => ({ ...p, [k]: v }));
  const setProp = <K extends keyof FlipState['prop']>(k: K, v: FlipState['prop'][K]) =>
    setS(p => ({ ...p, prop: { ...p.prop, [k]: v } }));
  const setMap = (group: 'acq' | 'hold' | 'sell', id: string, v: number) =>
    setS(p => ({ ...p, [group]: { ...p[group], [id]: v } }));
  const setArv = (k: ScenarioKey, v: number) => setS(p => ({ ...p, arv: { ...p.arv, [k]: v } }));
  const setRehab = (k: ScenarioKey, v: number) =>
    setS(p => ({ ...p, rehabSource: 'manual', rehab: { ...p.rehab, [k]: v } }));

  /* ---------- hydrate ---------- */
  useEffect(() => {
    const draft = loadJSON<any>(DRAFT_KEY);
    if (draft && isFinite(draft.price)) setS(normalizeFlip(draft));
    setSavedDeals((loadJSON<any[]>(STORE_KEY) || []).map(normalizeFlip));
    setHydrated(true);
  }, []);

  useEffect(() => { if (hydrated) saveJSON(DRAFT_KEY, s); }, [s, hydrated]);

  /* ---------- cloud sync — same rule as the rental analyzer ---------- */
  useEffect(() => { if (!user) syncedFor.current = null; }, [user]);
  useEffect(() => {
    if (!hydrated || !user || syncedFor.current === user.id) return;
    syncedFor.current = user.id;
    (async () => {
      try {
        const remote = await cloud.fetch();
        const { merged, toPush } = mergeDeals(savedDeals, remote);
        const deals = merged.map(normalizeFlip);
        setSavedDeals(deals);
        saveJSON(STORE_KEY, deals);
        if (toPush.length) await cloud.push(user.id, toPush);
        if (remote.length || toPush.length) toast('Flip deals synced with your account');
      } catch {
        syncedFor.current = null;
        toast('Cloud sync failed — your deals are safe on this device');
      }
    })();
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [hydrated, user]);

  /* ---------- derived ---------- */
  const city = findCity(s.citySlug);
  const sqft = s.prop.sqft;
  const links = useMemo(() => listingLinks(s.prop.address), [s.prop.address]);

  const rBase = useMemo(() => computeFlip(s, 'base'), [s]);
  const cols = useMemo(() => SCENARIO_KEYS.map(k => computeFlip(s, k)), [s]);
  const sens = useMemo(() => buildSensitivity(s, 7), [s]);
  const mao = useMemo(() => solveMAO(s), [s]);
  const seventy = seventyRule(s);
  const verdict = verdictFor(rBase, s);

  /* Screening benchmarks. Rules of thumb, not rules: they give a number on
     screen a sense of whether it is normal for the Bay Area. */
  const spreadVerdict = rBase.grossSpread >= 25 ? say('ok', 'comfortably in range')
    : rBase.grossSpread >= 20 ? say('warn', 'thin, but workable') : say('bad', 'too thin for the risk');
  const rehabVerdict = rBase.rehabPsf <= 160 ? say('ok', 'cosmetic territory')
    : rBase.rehabPsf <= 350 ? say('ok', 'gut territory') : say('warn', 'above a normal gut');
  const holdVerdict = s.liveIn
    ? (rBase.occupancyMonths >= 24 ? say('ok', 'past the two-year mark') : say('bad', 'under two years'))
    : rBase.holdMonths <= 8 ? say('ok', 'normal')
      : rBase.holdMonths <= 11 ? say('warn', 'long, carry costs compound') : say('bad', 'very long for a flip');
  const sellVerdict = rBase.sellPctOfSale <= 9 ? say('ok', 'in range') : say('warn', 'above the usual 7–9%');
  const selIdx = 1;                       /* base ARV is the column to beat */
  const amt = (lines: CostLine[], id: string) => lines.find(l => l.id === id)?.amount ?? 0;
  const allIn = s.price + rBase.acqTotal + rBase.rehabTotal + rBase.holdTotal + rBase.finTotal;
  const finLabel = s.finMode === 'cash' ? 'All cash' : s.finMode === 'hard' ? 'Hard money' : 'Conventional';
  const mo = (days: number) => `${(days / 30.4375).toFixed(1)} mo`;

  const isOpen = (id: string) => !(shut[id] ?? SHUT_BY_DEFAULT[id] ?? false);
  const fold = (id: string) => ({ open: isOpen(id), onOpenChange: (o: boolean) => setShut(p => ({ ...p, [id]: !o })) });

  /* ---------- actions ---------- */
  const setAddress = (v: string) =>
    setS(p => ({ ...p, name: v.trim(), prop: { ...p.prop, address: v } }));
  const dealTitle = (d: FlipState) => d.prop.address?.trim() || d.name || 'Untitled';

  function cityPatch(slug: string): Partial<FlipState> {
    const c = findCity(slug);
    return {
      citySlug: slug,
      ...(c ? { taxRatePct: c.taxRatePct, transferPayer: c.payer, retrofit: c.retrofit.reduce((a, x) => a + x.cost, 0) } : {}),
    };
  }
  function applyCity(slug: string) {
    setS(p => ({ ...p, ...cityPatch(slug) }));
    const c = findCity(slug);
    if (c) toast(`${c.name} preset applied. Every value stays editable`);
  }

  /* Picking a suggested address does the typing for you: the city preset is
     read off the address, and with a RentCast key saved, so are the size and
     year built. */
  async function pickAddress(full: string) {
    const lower = full.toLowerCase();
    const hit = citiesByCounty().flatMap(g => g.cities).find(c => lower.includes(`, ${c.name.toLowerCase()},`));
    setS(p => ({ ...p, name: full.trim(), prop: { ...p.prop, address: full }, ...(hit && hit.slug !== p.citySlug ? cityPatch(hit.slug) : {}) }));
    const filled: string[] = hit && hit.slug !== s.citySlug ? [`${hit.name} preset`] : [];
    try {
      const f = await lookupProperty(full);
      if (f) {
        setS(p => p.prop.address !== full ? p : {
          ...p, prop: {
            ...p.prop,
            ...(f.sqft ? { sqft: f.sqft } : {}), ...(f.beds ? { beds: f.beds } : {}),
            ...(f.baths ? { baths: Math.floor(f.baths), halfBaths: f.baths % 1 ? 1 : p.prop.halfBaths } : {}),
            ...(f.year ? { year: String(f.year) } : {}),
          },
        });
        if (f.sqft) filled.push('square feet');
        if (f.year) filled.push('year built');
      }
    } catch { /* the lookup is a convenience; the fields stay editable */ }
    if (filled.length) toast('Filled in ' + filled.join(', '));
  }

  function saveDeal() {
    if (!s.prop.address.trim()) { toast('Enter the property address first. It names the deal'); return; }
    const deal: FlipState = { ...s, savedAt: new Date().toISOString() };
    const deals = [...savedDeals];
    const i = deals.findIndex(d => d.name === deal.name);
    if (i >= 0) deals[i] = deal; else deals.push(deal);
    setSavedDeals(deals);
    saveJSON(STORE_KEY, deals);
    toast(i >= 0 ? 'Deal updated' : 'Deal saved');
    if (user) cloud.push(user.id, [deal]).catch(() => toast('Saved on this device — cloud sync failed'));
  }

  function deleteDeal(name: string) {
    if (!confirm(`Delete "${name}"?`)) return;
    const deals = savedDeals.filter(d => d.name !== name);
    setSavedDeals(deals);
    saveJSON(STORE_KEY, deals);
    if (user) cloud.remove(name).catch(() => toast('Removed on this device — cloud delete failed'));
  }

  const loadDeal = (d: FlipState) => { setS(normalizeFlip(d)); setShut({}); setMenuOpen(false); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const newDeal = () => { setS(defaultFlipState()); setShut({}); setMenuOpen(false); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const reset = () => { if (confirm('Reset every input to defaults?')) setS(defaultFlipState()); };
  const report = () => openReportWindow(buildFlipReport(s), '', () => toast('Allow pop-ups to open the report'));

  /* ---------- the P&L table's rows ---------- */
  const shareOf = (n: number) => (rBase.sale > 0 ? (n / rBase.sale) * 100 : 0);
  const cell = 'px-3 py-1.5 text-right tabular-nums whitespace-nowrap';
  const onCol = (i: number) => i === selIdx && 'bg-primary-tint font-semibold text-ink-strong';

  const head = (label: string) => (
    <tr key={`h-${label}`}><th colSpan={5} scope="colgroup" className="px-3 pb-1 pt-3 text-left text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">{label}</th></tr>
  );
  const pl = (label: string, pick: (r: FlipResult) => number, o: { fmt?: (n: number) => string; kind?: 'tot' | 'grand'; share?: boolean } = {}) => {
    const fmt = o.fmt ?? paren, share = o.share ?? true;
    return (
      <tr key={label} className={cn('border-b border-line/60', o.kind && 'border-t border-b-0 border-line-strong font-bold text-ink-strong', o.kind === 'grand' && 'text-[0.9375rem]')}>
        <th scope="row" className="px-3 py-1.5 text-left font-[inherit] text-[#3a4352]">{label}</th>
        {cols.map((c, i) => {
          const v = pick(c);
          return <td key={i} className={cn(cell, onCol(i), o.kind === 'grand' && (v < 0 ? 'text-destructive' : v >= s.minProfit ? 'text-success' : 'text-warning'))}>{fmt(v)}</td>;
        })}
        <td className={cn(cell, 'text-muted-foreground')}>{share ? pct(shareOf(Math.abs(pick(cols[selIdx])))) : ''}</td>
      </tr>
    );
  };
  /* a cost group that opens to its lines; detail comes from the base column */
  const group = (id: string, label: string, pick: (r: FlipResult) => number, lines: CostLine[]) => {
    const open = !!expanded[id];
    return [
      <tr key={id} className="border-b border-line/60">
        <th scope="row" className="px-3 py-1.5 text-left font-normal text-[#3a4352]">
          <button type="button" aria-expanded={open} onClick={() => setExpanded(p => ({ ...p, [id]: !p[id] }))}
            className="-ml-1.5 inline-flex items-center gap-0.5 rounded-sm hover:text-ink-strong">
            <Icon name="chevron_right" size={18} className={cn('text-muted-foreground transition-transform', open && 'rotate-90')} />{label}
          </button>
        </th>
        {cols.map((c, i) => <td key={i} className={cn(cell, onCol(i))}>{paren(pick(c))}</td>)}
        <td className={cn(cell, 'text-muted-foreground')}>{pct(shareOf(pick(cols[selIdx])))}</td>
      </tr>,
      ...(open ? lines.filter(l => l.amount !== 0).map((l, i) => (
        <tr key={`${id}-${i}`} className="border-b border-line/40 text-[0.8125rem] text-muted-foreground">
          <th scope="row" className="py-1 pl-8 pr-3 text-left font-normal">{l.label}</th>
          <td /><td className={cn(cell, 'py-1', onCol(1), 'font-normal text-muted-foreground')}>{money0(l.amount)}</td><td />
          <td className={cn(cell, 'py-1')}>{pct(shareOf(l.amount))}</td>
        </tr>
      )) : []),
    ];
  };

  /* small shorthands so a row reads as one line */
  const $ = (value: number, onChange: (n: number) => void, suffix?: string) =>
    <NumberField value={value} onChange={onChange} suffix={suffix} />;
  const n = (value: number, onChange: (n: number) => void, suffix?: string) =>
    <NumberField value={value} onChange={onChange} fmt="raw" suffix={suffix} />;
  const eq = (v: number) => `= ${money0(v)}`;

  /* ================================================================= render */
  return (
    <>
      {/* ---------- deal header ---------- */}
      <div className="mb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-[240px] max-w-[620px] flex-[1_1_340px] items-center gap-1">
            <div className="min-w-0 flex-1">
              <AddressInput value={s.prop.address} onChange={setAddress} onPick={pickAddress}
                placeholder="Property address — start typing to search" />
            </div>
            <Popover open={menuOpen} onOpenChange={setMenuOpen}>
              <PopoverTrigger render={<Button variant="ghost" size="icon" aria-label="Switch deal" title="Switch deal" />}>
                <Icon name="expand_more" size={22} />
              </PopoverTrigger>
              <PopoverContent align="end" className="max-h-[60vh] w-[min(22rem,calc(100vw-2rem))] gap-0.5 overflow-auto p-1.5">
                <button type="button" onClick={newDeal}
                  className="flex w-full items-center gap-1.5 rounded-md px-2.5 py-2 text-left text-sm font-bold text-primary hover:bg-primary-tint">
                  <Icon name="add" size={18} />New deal
                </button>
                {!savedDeals.length && <p className="px-2.5 py-2 text-[0.8125rem] text-muted-foreground">No saved flips yet. Use “Save deal” to keep one here.</p>}
                {[...savedDeals].sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || '')).map(d => {
                  const dr = computeFlip(d, 'base');
                  return (
                    <div className="flex items-center gap-1 rounded-md hover:bg-muted" key={d.name}>
                      <button type="button" className="min-w-0 flex-1 rounded-md px-2.5 py-2 text-left" onClick={() => loadDeal(d)}>
                        <span className="block truncate text-sm font-semibold text-ink-strong">{dealTitle(d)}</span>
                        <span className="block text-[0.8125rem] tabular-nums text-muted-foreground">{money0(d.price)} · {money(dr.profit)} profit · {dr.roi.toFixed(0)}% ROI</span>
                      </button>
                      <Button variant="ghost" size="icon-sm" aria-label={`Delete ${dealTitle(d)}`} title="Delete"
                        className="mr-1 text-muted-foreground hover:bg-destructive-soft hover:text-destructive"
                        onClick={ev => { ev.stopPropagation(); deleteDeal(d.name); }}>
                        <Icon name="close" size={16} />
                      </Button>
                    </div>
                  );
                })}
              </PopoverContent>
            </Popover>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2 print:hidden">
            {modeSwitch}
            <Button variant="outline" onClick={report} title="Open a print-ready deal report"><Icon name="download" size={18} />PDF</Button>
            <Button onClick={saveDeal}>Save deal</Button>
            <Button variant="ghost" onClick={reset}>Reset</Button>
          </div>
        </div>

        {/* Plain anchors, so the address goes nowhere until you click one. */}
        {links.length > 0 && (
          <nav aria-label="Look the property up" className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.9375rem] font-semibold">
            {links.map(l => (
              <a key={l.id} href={l.href} target="_blank" rel="noopener noreferrer" title={l.title}
                className="inline-flex items-center gap-0.5 text-primary hover:text-primary-hover hover:underline">
                {l.label}<Icon name="open_in_new" size={14} />
              </a>
            ))}
          </nav>
        )}
      </div>

      <div className="grid items-start gap-4 min-[1100px]:grid-cols-[360px_minmax(0,1fr)]">
        {/* ============================================ LEFT: INPUTS */}
        <div className="flex min-w-0 flex-col gap-3">
          <Panel dense title="The deal" tag={`${money0(s.arv.base - s.price)} spread`} {...fold('deal')}>
            <Field label="City" info="Sets the property tax rate, who pays transfer tax and the retrofit cost. These swing hugely by city: most of San Mateo and Santa Clara sit at the county floor; Oakland and Berkeley do not.">
              <NativeSelect size="sm" className="w-40 shrink-0" value={s.citySlug} aria-label="City" onChange={ev => applyCity(ev.target.value)}>
                <option value="">Not listed</option>
                {citiesByCounty().map(g => (
                  <optgroup key={g.county} label={`${g.county} County`}>
                    {g.cities.map(c => <option key={c.slug} value={c.slug}>{c.name}</option>)}
                  </optgroup>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Square feet" info="Living area from the tax record. Every per-foot figure divides by it.">
              {n(sqft, v => setProp('sqft', v), 'sf')}</Field>
            <Field label="Purchase price" hint={psf(s.price, sqft)}
              info={<>The 70% rule says {money0(seventy)}. Your own numbers say {money0(mao)}.</>}>
              {$(s.price, v => set('price', v))}</Field>
            <SectionLabel>After-repair value</SectionLabel>
            <Field label="Low" hint={psf(s.arv.low, sqft)} info="What it sells for in a slow month with a picky appraiser.">
              {$(s.arv.low, v => setArv('low', v))}</Field>
            <Field label="Base" hint={psf(s.arv.base, sqft)} info="Closed comps within half a mile and 90 days, adjusted to your finish.">
              {$(s.arv.base, v => setArv('base', v))}</Field>
            <Field label="High" hint={psf(s.arv.high, sqft)} info="Top of the range if the finish lands. Never underwrite to it.">
              {$(s.arv.high, v => setArv('high', v))}</Field>
            <Line total label="Gross spread" value={`${money0(s.arv.base - s.price)} · ${pct(rBase.grossSpread)}`}
              hint={spreadVerdict} info={<><b>Target 25–30% of ARV.</b> Base ARV less the purchase price, before any cost.</>} />
            <Field label="Minimum profit" info="What the deal has to clear for you to do it. Sets the verdict, the max offer, and where the profit grid turns green.">
              {$(s.minProfit, v => set('minProfit', v))}</Field>
          </Panel>

          <Panel dense title="Rehab &amp; timeline" tag={`${money0(s.rehab.base)} · ${holdLabel(rBase.holdMonths)}`} {...fold('rehab')}>
            <SectionLabel>Rehab budget</SectionLabel>
            <Field label="Low" hint={psf(s.rehab.low, sqft)} info="Everything goes right: no dry rot, no surprises behind the walls.">
              {$(s.rehab.low, v => setRehab('low', v))}</Field>
            <Field label="Base" hint={<>{psf(s.rehab.base, sqft)} · {rehabVerdict}</>}
              info={<>What you would tell a partner the job costs. The deal lives on it. Bay Area pricing: cosmetic <b>$90–160/sf</b>, full gut <b>$200–350/sf</b>.</>}>
              {$(s.rehab.base, v => setRehab('base', v))}</Field>
            <Field label="High" hint={psf(s.rehab.high, sqft)} info="You open the walls and find why it was cheap. The honest case for a pre-1950 house.">
              {$(s.rehab.high, v => setRehab('high', v))}</Field>
            <SectionLabel>Timeline</SectionLabel>
            <Field label="Rehab duration" hint={mo(s.rehabDays)} info="Fold permits in. Bay Area plan check adds 60–120 days before a shovel moves.">
              {n(s.rehabDays, v => set('rehabDays', v), 'days')}</Field>
            <Field label="Days on market" hint={mo(s.domDays)} info="List to accepted offer. The Bay Area ran 15–25 days through 2026.">
              {n(s.domDays, v => set('domDays', v), 'days')}</Field>
            <Field label="Escrow period" hint={mo(s.escrowDays)} info="Accepted offer to close. 21–30 days is standard; a cash buyer can do 14.">
              {n(s.escrowDays, v => set('escrowDays', v), 'days')}</Field>
            <Field label="Schedule overrun" hint={mo(s.overrunDays)} info="Add days to see what a slip costs. The cheapest stress test here.">
              {n(s.overrunDays, v => set('overrunDays', v), 'days')}</Field>
            <Field label="Live-in flip" hint={s.liveIn ? `${rBase.occupancyMonths.toFixed(0)} months occupied` : undefined}
              info="You move in, hold past two years, then sell. The months you live there are not vacant, so an empty house's costs never happen, and the housing you would have paid for anyway is not a cost of the deal.">
              <Toggle checked={s.liveIn} onChange={v => set('liveIn', v)} /></Field>
            {s.liveIn && <>
              <Field label="Months you live there" hint={`${(s.occupancyMonths / 12).toFixed(1)} yrs`}
                info="Between finishing the work and listing. Days on market and escrow also count toward the two years, so 22 here already clears it.">
                {n(s.occupancyMonths, v => set('occupancyMonths', v), 'mo')}</Field>
              <Field label="Housing you would pay anyway" hint={`${money0(rBase.housingCredit)} credited back`}
                info="Rent on the place you would otherwise live. It is credited against the deal, capped at what those months actually cost you.">
                {$(s.avoidedHousing, v => set('avoidedHousing', v), '/mo')}</Field>
            </>}
            <Line total label="Total hold" value={`${holdLabel(rBase.holdMonths)} · ${rBase.holdMonths.toFixed(1)} mo`} hint={holdVerdict}
              info={s.liveIn
                ? <>{rBase.vacantMonths.toFixed(1)} months empty, {rBase.occupancyMonths.toFixed(0)} lived in. Only the empty months carry a vacant house. The clock is set by the <b>two-year</b> residency rather than by carry.</>
                : <>Bay Area flips run <b>150–240 days</b> door to door. Every extra day costs holding and interest at once: a 30-day slip costs roughly {money0(rBase.holdMonthly + rBase.interest / Math.max(1, rBase.holdMonths))}.</>} />
          </Panel>

          <Panel dense title="Financing" tag={`${money0(rBase.finTotal)} · ${finLabel}`} {...fold('fin')}>
            <Field label="Loan type" info="Hard money funds the rehab in draws. Conventional funds only the purchase. All cash ties up every dollar but pays no interest.">
              <Segmented options={[{ u: 'hard', label: 'Hard' }, { u: 'conv', label: 'Conv.' }, { u: 'cash', label: 'Cash' }]}
                value={s.finMode} onChange={u => set('finMode', u as FlipState['finMode'])} />
            </Field>
            {s.finMode === 'hard' && <>
              <Field label="Loan-to-cost" hint={eq(rBase.loanAtClose)} info="Share of the purchase the lender funds. Bay Area hard money runs 85–90%.">
                {n(s.ltcPct, v => set('ltcPct', v), '%')}</Field>
              <Field label="Rehab financed" hint={eq(rBase.rehabTotal - rBase.cashForRehab)} info="Usually 100%, released in draws as work is inspected.">
                {n(s.rehabFinancedPct, v => set('rehabFinancedPct', v), '%')}</Field>
              <Field label="Interest rate" hint={eq(rBase.interest)} info="9.5–12% in 2026. Interest-only on the drawn balance.">
                {n(s.hardRate, v => set('hardRate', v), '%')}</Field>
              <Field label="Points" hint={eq(amt(rBase.finLines, 'points'))} info="1.5–3 points at close, on the purchase loan plus the rehab holdback.">
                {n(s.pointsPct, v => set('pointsPct', v), '%')}</Field>
              <Field label="Lender fees" info="Underwriting, doc prep, legal. $1–2k is typical.">
                {$(s.hardFees, v => set('hardFees', v))}</Field>
              <Field label="Number of draws" info="Fewer, larger draws cost less. Each one also waits on an inspection.">
                {n(s.drawCount, v => set('drawCount', v))}</Field>
              <Field label="Fee per draw" hint={eq(amt(rBase.finLines, 'drawFees'))} info="$250–500 each.">
                {$(s.drawFee, v => set('drawFee', v))}</Field>
              <Field label="Minimum interest" info="Most lenders guarantee 3–6 months of interest even if you pay off early.">
                {n(s.minInterestMonths, v => set('minInterestMonths', v), 'mo')}</Field>
              <Field label="Extension fee" hint={eq(amt(rBase.finLines, 'extension'))} info="Charged when the schedule overrun is more than zero. 0.5–1 point.">
                {n(s.extensionFeePct, v => set('extensionFeePct', v), '%')}</Field>
            </>}
            {s.finMode === 'conv' && <>
              <Field label="Loan-to-value" hint={eq(rBase.loanAtClose)} info="Against the purchase price, not total cost. A conventional loan funds no rehab.">
                {n(s.ltvPct, v => set('ltvPct', v), '%')}</Field>
              <Field label="Interest rate" hint={eq(rBase.interest)} info="Investment property prices 50–75bp over owner-occupied.">
                {n(s.convRate, v => set('convRate', v), '%')}</Field>
              <Field label="Term" info="Sets the payment. The loan is paid off at sale regardless.">
                {n(s.convTerm, v => set('convTerm', v), 'yrs')}</Field>
              <Field label="Interest only" info="Take it on a flip. Amortising parks cash in principal you get back anyway.">
                <Toggle checked={s.convIO} onChange={v => set('convIO', v)} /></Field>
              <Field label="Origination" hint={eq(amt(rBase.finLines, 'origination'))} info="On the loan amount only. There is no rehab commitment to charge against.">
                {n(s.originationPct, v => set('originationPct', v), '%')}</Field>
              <Field label="Lender fees" info="Underwriting, appraisal review, doc prep.">
                {$(s.convFees, v => set('convFees', v))}</Field>
              <Field label="Prepayment penalty" hint={eq(amt(rBase.finLines, 'prepay'))} info="Some investor products carry one, and a flip pays off inside the window.">
                {n(s.prepayPct, v => set('prepayPct', v), '%')}</Field>
            </>}
            <Line total label="Financing cost" value={money0(rBase.finTotal)}
              info={s.finMode === 'cash' ? 'No loan, no lender, no interest. Every dollar of purchase and rehab is yours.'
                : `${pct(s.arv.base > 0 ? rBase.finTotal / s.arv.base * 100 : 0)} of ARV. After rehab, usually the second-largest cost.`} />
            <Line label="Loan at close" value={money0(rBase.loanAtClose)} info="Funded at close, before any rehab draw." />
            <Line label="Down payment" value={money0(rBase.downPayment)} info="Purchase price less the loan." />
            <Line label="Cash needed for rehab" value={money0(rBase.cashForRehab)}
              info={s.finMode === 'hard' ? 'Only the unfinanced share. The lender reimburses the rest by draw.' : 'The whole rehab. No lender is funding any of it.'} />
            <Line strong label="Peak cash out of pocket" value={money0(rBase.peakCash)} info="The number that decides whether you can do this deal at all." />
          </Panel>

          <Panel dense title="Acquisition costs" tag={money0(rBase.acqTotal)} {...fold('acq')}>
            <Field label="Seller disclosure package" info="California sellers normally deliver TDS, SPQ, NHD and the pest, home and roof reports before offers. Switching this on zeroes the lines it covers.">
              <Toggle checked={s.sellerDisclosure} onChange={v => set('sellerDisclosure', v)} /></Field>
            <Field label="Buy-side commission" hint={eq(amt(rBase.acqLines, 'buySideComm'))} info="What you pay a buyer's agent to acquire. If you represent yourself it is income, not a cost.">
              {n(s.buySideCommPct, v => set('buySideCommPct', v), '%')}</Field>
            {ACQ_ITEMS.map(i => {
              /* covered by the package: the value you typed is kept, greyed out,
                 and excluded from the total until you switch the package off */
              const covered = s.sellerDisclosure && SELLER_PROVIDED.has(i.id);
              return (
                <Field key={i.id} label={i.label} hint={covered ? 'covered by the seller' : undefined} info={i.note}>
                  <NumberField value={s.acq[i.id] ?? 0} disabled={covered} className={covered ? 'line-through' : undefined}
                    onChange={v => setMap('acq', i.id, v)} /></Field>
              );
            })}
            {rBase.acqLines.filter(l => l.derived && l.id !== 'buySideComm' && l.amount !== 0).map((l, i) => (
              <Line key={i} label={l.label} value={money0(l.amount)} info="Computed from the city preset and who pays." />
            ))}
            <Line total label="Total acquisition" value={money0(rBase.acqTotal)}
              hint={`${pct(s.price > 0 ? rBase.acqTotal / s.price * 100 : 0)} of price`} info="Loan points are not here. They live under Financing." />
          </Panel>

          <Panel dense title="Holding costs" tag={`${money0(rBase.holdTotal)}${s.liveIn ? '' : ` · ${money0(rBase.holdMonthly)}/mo`}`} {...fold('hold')}>
            <Field label="Property tax rate" hint={eq(rBase.propertyTax)} info="The levied rate: 1% Prop 13 base plus local bonds. A published “effective rate” understates this by a third.">
              {n(s.taxRatePct, v => set('taxRatePct', v), '%')}</Field>
            <Field label="Prior assessed value" hint={rBase.supplementalTax > 0 ? `supplemental ${money0(rBase.supplementalTax)}` : undefined}
              info="From the county assessor. Only used to break out the supplemental tax bill.">
              {$(s.priorAssessed, v => set('priorAssessed', v))}</Field>
            <Field label="Builder's risk insurance" hint={eq(amt(rBase.holdLines, 'builderRisk'))} info="Covers the structure while it is open. 1–3% of rehab, or $150–300 a month.">
              <div className="flex items-center gap-1.5">
                <Segmented options={[{ u: '$', label: '$/mo' }, { u: '%', label: '%' }]}
                  value={s.builderRiskUnit} onChange={u => set('builderRiskUnit', u as '$' | '%')} />
                {n(s.builderRisk, v => set('builderRisk', v))}
              </div>
            </Field>
            <SectionLabel>Monthly operating</SectionLabel>
            {HOLD_ITEMS.map(i => (
              <Field key={i.id} label={i.label} hint={eq(amt(rBase.holdLines, i.id))}
                info={s.liveIn && i.vacantOnly ? <>Empty months only, since nobody needs it while you live there. {i.note}</> : i.note}>
                {$(s.hold[i.id] ?? 0, v => setMap('hold', i.id, v), '/mo')}</Field>
            ))}
            {rBase.housingCredit > 0 && (() => {
              /* only the share that lands in this panel, so the column adds up;
                 the rest offsets interest under Financing */
              const here = Math.abs(amt(rBase.holdLines, 'housingCredit'));
              const elsewhere = rBase.housingCredit - here;
              return <Line tone="pos" label="Housing you would pay anyway" value={`(${money0(here)})`}
                info={elsewhere > 0 ? <>Covers this carry in full. The other {money0(elsewhere)} offsets interest, under Financing.</>
                  : <>{rBase.occupancyMonths.toFixed(0)} months at {money0(s.avoidedHousing)} a month.</>} />;
            })()}
            <Line total label={`Total over ${rBase.holdMonths.toFixed(1)} months`} value={money0(rBase.holdTotal)}
              hint={`${pct(s.arv.base > 0 ? rBase.holdTotal / s.arv.base * 100 : 0)} of ARV`} info="Runs whether or not anyone is working on the house." />
          </Panel>

          <Panel dense title="Selling costs" tag={`${money0(rBase.sellTotal)} · ${pct(rBase.sellPctOfSale)}`} {...fold('sell')}>
            <Field label="Listing commission" hint={eq(amt(rBase.sellLines, 'listComm'))} info="2.5% is standard. If you list it yourself, that side is income to you, not an expense.">
              {n(s.listCommPct, v => set('listCommPct', v), '%')}</Field>
            <Field label="Buyer agent commission" hint={eq(amt(rBase.sellLines, 'buyerComm'))} info="Negotiable since the NAR settlement, but 2.5% still gets it shown.">
              {n(s.buyerCommPct, v => set('buyerCommPct', v), '%')}</Field>
            <Field label="Transfer tax paid by" hint={eq(amt(rBase.sellLines, 'sellCityTax') + amt(rBase.sellLines, 'sellCountyTax'))}
              info={city ? `${city.name} custom is pre-filled. On a large bill this is negotiable.` : 'Local custom varies. Pick a city to pre-fill it.'}>
              <Segmented options={[{ u: 'seller', label: 'Seller' }, { u: 'split', label: 'Split' }, { u: 'buyer', label: 'Buyer' }]}
                value={s.transferPayer} onChange={u => set('transferPayer', u as FlipState['transferPayer'])} />
            </Field>
            {SELL_FLAT_ITEMS.map(i => (
              <Field key={i.id} label={i.label} info={i.note}>{$(s.sell[i.id] ?? 0, v => setMap('sell', i.id, v))}</Field>
            ))}
            <Field label="Staging" hint={eq(amt(rBase.sellLines, 'stagingHold'))} info="$1–1.5k a month through days on market plus escrow.">
              {$(s.stagingMo, v => set('stagingMo', v), '/mo')}</Field>
            <Field label="Retrofit compliance"
              info={city ? `Required in ${city.name}: ${city.retrofit.map(x => x.label).join(', ')}.` : 'Lateral certificate, water heater strapping, alarms. Varies by city.'}>
              {$(s.retrofit, v => set('retrofit', v))}</Field>
            <Field label="Seller concessions" hint={eq(amt(rBase.sellLines, 'concessions'))} info="Credits after the buyer’s inspection. 0.5% is light; 1% is safer on an older house.">
              {n(s.concessionsPct, v => set('concessionsPct', v), '%')}</Field>
            <Field label="CA 3.33% withholding" hint={rBase.withholding > 0 ? `${money0(rBase.withholding)} held at close` : undefined}
              info="Escrow withholds it at close and credits it on your return. It moves cash timing, never profit.">
              <Toggle checked={s.withholdingOn} onChange={v => set('withholdingOn', v)} /></Field>
            <Line total label="Total selling costs" value={money0(rBase.sellTotal)} hint={<>{pct(rBase.sellPctOfSale)} of sale · {sellVerdict}</>}
              info={<>All-in Bay Area selling costs run <b>7–9% of the sale price</b>. Most of these are percentages of the sale, so they are recomputed for each ARV scenario.</>} />
          </Panel>
        </div>

        {/* ============================================ RIGHT: RESULTS */}
        <div className="flex min-w-0 flex-col gap-4">
          <Verdict tone={verdict.v} title={verdict.title}>{verdict.sub}</Verdict>

          <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">
            <Stat label="Max Offer" value={money0(mao)} note={`for ${money0(s.minProfit)} profit · 70% rule ${money0(seventy)}`} />
            <Stat label="Net Profit" value={money(rBase.profit)} tone={rBase.profit < 0 ? 'neg' : rBase.profit >= s.minProfit ? 'pos' : undefined}
              note={rBase.profit >= s.minProfit ? `${money0(rBase.profit - s.minProfit)} over your floor` : `${money0(s.minProfit - rBase.profit)} short of your floor`} />
            <Stat label="ROI on Cash" value={pct(rBase.roi)} note={`${pct(rBase.annualizedRoi)} annualized`} />
            <Stat label="Peak Cash" value={money0(rBase.peakCash)} note={finLabel.toLowerCase()} />
            <Stat label="All-in Cost" value={money0(allIn)} note={[psf(allIn, sqft), holdLabel(rBase.holdMonths)].filter(Boolean).join(' · ')} />
            <Stat label="Margin" value={pct(rBase.margin)} note="profit as a share of ARV" />
          </div>

          {city?.note && <Note tone="warn" icon="location_city" title={city.name}>{city.note}</Note>}
          {s.liveIn && (
            <Note icon="home" title="Why the two years are the whole point">
              Live there 24 of the last 60 months and the gain stops being ordinary flip income. It becomes a
              long-term capital gain, and §121 excludes the first $250,000 of it, $500,000 if you are married.
              None of that is computed here. The <Link href="/tax" className="font-semibold text-primary hover:underline">Income Tax Calculator</Link> has both.
            </Note>
          )}
          {s.liveIn && s.finMode === 'hard' && (
            <Note tone="warn" icon="warning" title={`Hard money does not stretch to ${holdLabel(rBase.holdMonths)}`}>
              A bridge loan at {s.hardRate}% is priced for months, and most lenders will not extend one past 18.
              Living there makes you owner-occupied, which prices below an investment loan.
              <Button variant="outline" size="sm" className="mt-2 flex" onClick={() => set('finMode', 'conv')}>Switch to conventional</Button>
            </Note>
          )}

          <Panel title="Net profit by ARV and rehab" tag="ARV across · rehab down">
            <div className="overflow-x-auto py-1">
              <table className="w-full min-w-[560px] border-separate border-spacing-[2px] text-center text-[0.8125rem] tabular-nums">
                <thead><tr>
                  <th className="px-1 pb-1 text-left text-xs font-semibold text-muted-foreground">Rehab ↓ · ARV →</th>
                  {sens.arvAxis.map((a, i) => (
                    <th key={i} scope="col" className="px-1 pb-1 font-semibold text-ink-strong">{compact(a)}
                      <span className="block text-[0.6875rem] font-normal text-muted-foreground">{psf(a, sqft)}</span></th>
                  ))}
                </tr></thead>
                <tbody>
                  {sens.cells.map((row, ri) => {
                    const nearest = (arr: number[], v: number) =>
                      arr.reduce((best, x, i) => Math.abs(x - v) < Math.abs(arr[best] - v) ? i : best, 0);
                    const baseR = nearest(sens.rehabAxis, sens.baseRehab);
                    const baseA = nearest(sens.arvAxis, sens.baseArv);
                    return (
                      <tr key={ri}>
                        <th scope="row" className="whitespace-nowrap px-1 text-left font-semibold text-ink-strong">{compact(sens.rehabAxis[ri])}
                          <span className="ml-1 text-[0.6875rem] font-normal text-muted-foreground">{psf(sens.rehabAxis[ri], sqft)}</span></th>
                        {row.map((v, ci) => (
                          <td key={ci} style={heatColor(v, s.minProfit, sens.min, sens.max)}
                            className={cn('rounded-[4px] px-1 py-1.5 font-semibold', ri === baseR && ci === baseA && 'outline outline-2 -outline-offset-2 outline-ink-strong')}
                            title={`ARV ${money0(sens.arvAxis[ci])} · rehab ${money0(sens.rehabAxis[ri])} → ${money(v)}`}>
                            {compact(v)}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <ul className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.8125rem] text-[#3a4352]">
              <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-[2px]" style={{ background: `rgb(${LOSS_1.join(',')})` }} />Loses money</li>
              <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-[2px]" style={{ background: `rgb(${WARN_1.join(',')})` }} />Under your {money0(s.minProfit)} floor</li>
              <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-[2px]" style={{ background: `rgb(${GOOD_1.join(',')})` }} />Clears the floor</li>
              <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-[2px] outline outline-2 -outline-offset-1 outline-ink-strong" />Your base case</li>
              <li><InfoTip label="About this grid">Axes span your low-to-high ARV and rehab with 10% headroom past each end. Purchase price ({money0(s.price)}), timeline ({holdLabel(rBase.holdMonths)}) and financing are held fixed.{city && city.tiers.length > 1 ? ' This city has a transfer tax cliff, so expect a step wherever the ARV range crosses it.' : ''}</InfoTip></li>
            </ul>
          </Panel>

          <Panel title="Deal model" tag={`rehab ${money0(rBase.rehabTotal)}`}>
            <div className="-mx-1 overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="border-b border-line text-xs text-muted-foreground">
                    <th className="px-3 py-1.5 text-left font-bold uppercase tracking-[0.08em]">Scenario</th>
                    {SCENARIO_KEYS.map((k, i) => (
                      <th key={k} scope="col" className={cn(cell, 'font-bold', onCol(i))}>
                        <span className="block uppercase tracking-[0.08em]">ARV {k}</span>{money0(s.arv[k])}</th>
                    ))}
                    <th scope="col" className={cn(cell, 'font-bold uppercase tracking-[0.08em]')}>% of sale</th>
                  </tr>
                </thead>
                <tbody>
                  {head('Sale proceeds')}
                  {pl('Sale price (ARV)', r => r.sale, { fmt: money0 })}
                  {group('sell', 'Less selling costs', r => r.sellTotal, cols[selIdx].sellLines)}
                  {pl('Net sale proceeds', r => r.netProceeds, { fmt: money0, kind: 'tot' })}

                  {head('Cost into the deal')}
                  {pl('Purchase price', () => s.price)}
                  {group('acq', 'Acquisition costs', r => r.acqTotal, cols[selIdx].acqLines)}
                  {pl('Rehab budget', r => r.rehabTotal)}
                  {group('hold', 'Holding costs', r => r.holdTotal, cols[selIdx].holdLines)}
                  {group('fin', 'Financing cost', r => r.finTotal, cols[selIdx].finLines)}
                  {pl('Net profit / (loss)', r => r.profit, { fmt: money, kind: 'grand' })}

                  {head('Returns')}
                  {pl('Return on cash', r => r.roi, { fmt: pct, share: false })}
                  {pl('Annualized return', r => r.annualizedRoi, { fmt: pct, share: false })}
                  {pl('Margin, % of ARV', r => r.margin, { fmt: pct, share: false })}

                  {head('Capital')}
                  {pl('Cash to close', r => r.cashToClose, { fmt: money0, share: false })}
                  {pl('Cash during hold', r => r.cashDuringHold, { fmt: money0, share: false })}
                  {pl('Peak cash out of pocket', r => r.peakCash, { fmt: money0, share: false, kind: 'tot' })}
                  {pl('Loan payoff at sale', r => r.payoffAtSale, { fmt: money0, share: false })}
                  {pl('Cash back at close', r => r.cashBackAtClose, { fmt: money, share: false })}
                  {rBase.principalPaid > 0 && pl('Principal repaid, returns at close', r => r.principalPaid, { fmt: money0, share: false })}
                  {rBase.withholding > 0 && pl('CA withholding at close', r => r.withholding, { fmt: money0, share: false })}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      </div>

      <p className="mt-4 text-[0.8125rem] leading-snug text-muted-foreground">
        Screening estimates only. Verify every figure locally before making an offer. Transfer tax and
        property tax presets change by ballot measure, so confirm them. Property tax assumes Prop 13
        reassessment to the purchase price. Every profit figure is before income tax: a flip is ordinary
        income and also owes self-employment tax, which the <Link href="/tax" className="font-semibold text-primary hover:underline">Income Tax Calculator</Link> models
        separately, along with the §121 exclusion a live-in flip is chasing.
      </p>
    </>
  );
}
