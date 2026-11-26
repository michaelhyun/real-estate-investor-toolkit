'use client';

/* Rental Property Analyzer, shown on the Deal Analyzer page — React port of rental.html. Math in @reit/core;
   storage keys unchanged (rentalDeals.v3, rentalCalc.draft.v3). The Sales
   Comps / Rental Comps / CapEx / Neighborhood tabs are "coming soon": their
   data still round-trips through save/load untouched, so nothing saved in the
   old tool is lost. RentCast plumbing dropped entirely. */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  compute, defaultDealState, EXPENSES, UTILS, UTIL_LABELS, OTHER_INC, OTHER_INC_LABELS,
  amortize, money, money0, pct, stripZeros, parseNum,
  type DealState,
} from '@reit/core';
import { loadJSON, saveJSON, openReportWindow } from './ui';
import { Panel, Field, Line, SectionLabel, NumberField, Segmented, SliderField, Stat, Verdict, Note, Fold, Sub, Toggle, Choice } from './calc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { buildRentalReport } from './report';
import { AddressInput } from './AddressInput';
import { AmortizationDialog } from './AmortizationDialog';
import { toast } from './toast';
import { Icon } from './Icon';
import { useAuth } from './auth';
import { dealStore, mergeDeals } from '../lib/dealsync';

const STORE_KEY = 'rentalDeals.v3';
const DRAFT_KEY = 'rentalCalc.draft.v3';

/* the account-side store for this tool — 'rental' is named once, here */
const cloud = dealStore<DealState>('rental');

const sowSum = (d: any): number => (d?.sow || []).reduce((t: number, i: any) => t + (i.cost || 0), 0);

/* merge a stored deal/draft into a full DealState with the original fallbacks */
function normalizeDeal(d: any): DealState {
  const base = defaultDealState();
  if (!d || typeof d !== 'object') return base;
  return {
    ...base,
    ...d,
    name: d.name || '',
    closingUnit: d.closingUnit || '$',
    ioYears: d.ioYears ?? 10,
    armFixed: d.armFixed ?? 7,
    armFreq: d.armFreq ?? 6,
    armRate: d.armRate ?? 8.5,
    sellerAmt: d.sellerAmt || 0,
    sellerRate: d.sellerRate ?? 6,
    sellerTerm: d.sellerTerm ?? 30,
    sellerType: d.sellerType || 'am',
    subtoBal: d.subtoBal || 0,
    subtoRate: d.subtoRate ?? 4,
    subtoTerm: d.subtoTerm ?? 26,
    expenses: { ...base.expenses, ...(d.expenses || {}) },
    units: Object.fromEntries(EXPENSES.map(e => {
      const fallback = e.mode === 'time' ? 'mo' : '$';
      return [e.id, d.units?.[e.id] || fallback];
    })),
    otherInc: { ...base.otherInc, ...(d.otherInc || {}) },
    utils: { ...base.utils, ...(d.utils || {}) },
    utilUnits: { ...base.utilUnits, ...(d.utilUnits || {}) },
    /* The Scope of Work tab is gone. A deal saved with line items had its
       rehab figure locked to their total, so carry that total over as the
       rehab number and drop the items — the deal's numbers do not move. */
    sow: [],
    ...(sowSum(d) > 0 ? { rehab: sowSum(d) } : {}),
    salesComps: d.salesComps || [],
    rentComps: d.rentComps || [],
    capex: Array.isArray(d.capex) ? d.capex : [],
    hood: { crime: d.hood?.crime || '', schools: d.hood?.schools || '', notes: d.hood?.notes || '' },
    prop: {
      /* the address is the deal title now — deals saved under the old model had
         a separate free-text name, so fall back to it rather than show nothing */
      address: d.prop?.address || d.name || '', beds: d.prop?.beds || '', baths: d.prop?.baths || '',
      sqft: d.prop?.sqft || '', year: d.prop?.year || '', list: d.prop?.list || 0,
      video: d.prop?.video || '', urls: (d.prop?.urls || []).map((u: any) => ({ label: u.label || '', url: u.url || '' })),
    },
  };
}

const normUrl = (u: string) => {
  u = String(u || '').trim();
  if (!u) return '';
  return /^https?:\/\//i.test(u) ? u : 'https://' + u;
};

/* Property facts come from RentCast when a key is saved in this browser. The
   key lives in localStorage only (same name the original tool used) — it is
   never written to a deal, synced, or put in the repo. */
/* Expense lines most deals leave at zero. They sit behind an "Other expenses"
   fold, which opens by itself when a deal uses any of them. */
const RARE_EXPENSES = ['landscape', 'cleaning', 'pest', 'misc'];

const RENTCAST_KEY = 'rentcastKey';
/* Down payment is a choice, not a dial (Michael, 2026-11-25). A saved deal
   with any other percentage keeps it and shows it as one more choice. */
const DOWN_CHOICES = [0, 10, 15, 20, 25, 30, 100];   /* 100 is an all-cash purchase */

export function RentalAnalyzer({ modeSwitch }: { modeSwitch?: React.ReactNode }) {
  const [s, setS] = useState<DealState>(defaultDealState);
  const [amortOpen, setAmortOpen] = useState(false);
  const [rcKey, setRcKey] = useState('');
  const [factsBusy, setFactsBusy] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  /* Folds in the input column. null means "follow the deal" — open when the
     deal uses what is inside — until the user opens or shuts one by hand. */
  const [optsOpen, setOptsOpen] = useState<boolean | null>(null);
  const [creativeOpen, setCreativeOpen] = useState<boolean | null>(null);
  const [moreExpOpen, setMoreExpOpen] = useState<boolean | null>(null);
  const [oiOpen, setOiOpen] = useState(false);
  const [utilOpen, setUtilOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [savedDeals, setSavedDeals] = useState<DealState[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const menuWrapRef = useRef<HTMLDivElement>(null);
  const addrRef = useRef<HTMLDivElement>(null);
  const { user } = useAuth();
  const syncedFor = useRef<string | null>(null);

  /* ---------- hydrate: draft + saved deals ---------- */
  useEffect(() => {
    const draft = loadJSON<any>(DRAFT_KEY);
    if (draft && isFinite(draft.price)) {
      const d = normalizeDeal(draft);
      setS(d);
      }
    setSavedDeals((loadJSON<any[]>(STORE_KEY) || []).map(normalizeDeal));
    setHydrated(true);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, []);

  /* ---------- cloud sync ----------
     Once per sign-in, pull the account's deals and merge with local — newest
     savedAt wins per deal, one-sided deals are kept on both sides (see
     dealsync.ts). After that, saves and deletes mirror up individually. */
  useEffect(() => { if (!user) syncedFor.current = null; }, [user]);
  useEffect(() => {
    if (!hydrated || !user || syncedFor.current === user.id) return;
    syncedFor.current = user.id;
    (async () => {
      try {
        const remote = await cloud.fetch();
        const { merged, toPush } = mergeDeals(savedDeals, remote);
        const deals = merged.map(normalizeDeal);
        setSavedDeals(deals);
        saveJSON(STORE_KEY, deals);
        if (toPush.length) await cloud.push(user.id, toPush);
        if (remote.length || toPush.length) toast('Deals synced with your account');
      } catch {
        syncedFor.current = null;
        toast('Cloud sync failed — your deals are safe on this device');
      }
    })();
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [hydrated, user]);

  /* close deal menu on outside click */
  useEffect(() => {
    const onDoc = (ev: MouseEvent) => {
      if (!menuWrapRef.current?.contains(ev.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('click', onDoc);
    return () => document.removeEventListener('click', onDoc);
  }, []);

  /* 100% down is an all-cash purchase: there is no loan to describe, so the
     whole financing section switches off. The toggles are neutralized in the
     computed state only — `s` keeps every setting, so easing the slider back
     below 100% restores the stack exactly as it was. */
  const allCash = s.downPct >= 100;
  const eff = useMemo<DealState>(() => {
    return allCash ? { ...s, ioOn: false, armOn: false, sellerOn: false, subtoOn: false } : s;
  }, [s, allCash]);
  const r = useMemo(() => compute(eff), [eff]);
  /* only worked out while the dialog is open */
  const amort = useMemo(() => amortOpen ? amortize(eff) : null, [eff, amortOpen]);
  const loanNotes = [
    r.newLoan > 0 ? `Bank loan ${money0(r.newLoan)} at ${+eff.rate}% for ${+eff.term} yrs` : null,
    r.sellerAmt > 0 ? `Seller financing ${money0(r.sellerAmt)} at ${+eff.sellerRate}% for ${+eff.sellerTerm} yrs` : null,
    r.subtoBal > 0 ? `Subject-to ${money0(r.subtoBal)} at ${+eff.subtoRate}% for ${+eff.subtoTerm} yrs` : null,
  ].filter(Boolean) as string[];

  /* draft persists on every change, like the original calc() */
  useEffect(() => { if (hydrated) saveJSON(DRAFT_KEY, eff); }, [eff, hydrated]);

  const set = <K extends keyof DealState>(k: K, v: DealState[K]) => setS(prev => ({ ...prev, [k]: v }));
  const setProp = (k: keyof DealState['prop'], v: any) => setS(prev => ({ ...prev, prop: { ...prev.prop, [k]: v } }));

  /* The address IS the title, so it doubles as the key a deal saves under. */
  const setAddress = (v: string) =>
    setS(prev => ({ ...prev, name: v.trim(), prop: { ...prev.prop, address: v } }));

  useEffect(() => { try { setRcKey(localStorage.getItem(RENTCAST_KEY) || ''); } catch { } }, []);
  const saveRcKey = (v: string) => {
    setRcKey(v);
    try { v.trim() ? localStorage.setItem(RENTCAST_KEY, v.trim()) : localStorage.removeItem(RENTCAST_KEY); } catch { }
  };

  /* Picking a suggested address looks the property up and fills beds, baths,
     square footage and year built. Typing an address by hand does not call
     out — only an explicit pick does. */
  async function pickAddress(full: string) {
    setAddress(full);
    const key = rcKey.trim();
    if (!key) { toast('Add a RentCast key in the property details to fill beds, baths, size and year automatically'); return; }
    setFactsBusy(true);
    try {
      const res = await fetch('https://api.rentcast.io/v1/properties?address=' + encodeURIComponent(full),
        { headers: { 'X-Api-Key': key, Accept: 'application/json' } });
      if (!res.ok) { toast(res.status === 401 ? 'RentCast rejected the API key' : 'No property record found for that address'); return; }
      const d = (await res.json())?.[0];
      const got: string[] = [];
      const patch: Partial<DealState['prop']> = {};
      if (d?.bedrooms) { patch.beds = String(d.bedrooms); got.push('beds'); }
      if (d?.bathrooms) { patch.baths = String(d.bathrooms); got.push('baths'); }
      if (d?.squareFootage) { patch.sqft = String(d.squareFootage); got.push('square footage'); }
      if (d?.yearBuilt) { patch.year = String(d.yearBuilt); got.push('year built'); }
      if (!got.length) { toast('No property record found for that address'); return; }
      /* only if the address is still the one that was looked up */
      setS(prev => prev.prop.address === full ? { ...prev, prop: { ...prev.prop, ...patch } } : prev);
      toast('Filled in ' + got.join(', '));
    } catch {
      toast('Could not reach RentCast — enter the details by hand');
    } finally {
      setFactsBusy(false);
    }
  }

  const dealTitle = (d: DealState) => d.prop.address?.trim() || d.name || 'Untitled';

  function applyDeal(d: DealState) {
    setS(d);
    setOptsOpen(null); setCreativeOpen(null); setMoreExpOpen(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function newDeal() {
    localStorage.removeItem(DRAFT_KEY);
    applyDeal(defaultDealState());
    setMenuOpen(false);
    toast('Fresh sheet — enter the property address to start');
  }

  function saveDeal() {
    if (!s.name.trim()) {
      addrRef.current?.querySelector('input')?.focus();
      toast('Enter the property address first — it names the deal');
      return;
    }
    const deal: DealState = { ...eff, savedAt: new Date().toISOString() };
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

  function reset() {
    if (!confirm('Reset all inputs to defaults? Saved deals are kept.')) return;
    localStorage.removeItem(DRAFT_KEY);
    applyDeal(defaultDealState());
  }

  /* ---------- property summary: facts and research links ---------- */
  const p = s.prop;
  const sqftN = parseNum(p.sqft);
  const basis = p.list > 0 ? p.list : s.price;
  const facts: { icon: string; text: string }[] = ([
    p.beds ? { icon: 'bed', text: `${p.beds} bd` } : null,
    p.baths ? { icon: 'bathtub', text: `${p.baths} ba` } : null,
    sqftN ? { icon: 'square_foot', text: `${sqftN.toLocaleString('en-US')} sq ft` } : null,
    p.year ? { icon: 'calendar_today', text: `Built ${p.year}` } : null,
    p.list > 0 ? { icon: 'sell', text: `Listed ${money0(p.list)}` } : null,
    sqftN && basis > 0 ? { icon: 'straighten', text: `$${Math.round(basis / sqftN).toLocaleString('en-US')}/sq ft` } : null,
  ].filter(Boolean)) as { icon: string; text: string }[];
  const links: { label: string; href: string }[] = [];
  if (p.address) {
    const enc = encodeURIComponent(p.address);
    links.push({ label: 'Google Maps', href: 'https://www.google.com/maps/search/?api=1&query=' + enc });
    links.push({ label: 'Zillow', href: 'https://www.zillow.com/homes/' + enc + '_rb/' });
    links.push({ label: 'Realtor', href: 'https://www.realtor.com/search?query=' + enc });
  }
  p.urls.forEach(u => {
    if (!u.url.trim()) return;
    let name = u.label.trim();
    if (!name) { try { name = new URL(normUrl(u.url)).hostname.replace(/^www\./, ''); } catch { name = 'link'; } }
    links.push({ label: name, href: normUrl(u.url) });
  });

  /* ---------- verdict ---------- */
  let vCls: 'good' | 'ok' | 'bad', vTitle: string, vSub: string;
  if (r.cashFlow >= 0 && r.coc >= 8) {
    vCls = 'good'; vTitle = 'Strong deal by your numbers';
    vSub = `${pct(r.coc, 1)} cash-on-cash with ${money(r.cashFlow)}/mo cash flow — above the common 8% CoC target.`;
  } else if (r.cashFlow >= 0 && r.coc >= 4) {
    vCls = 'ok'; vTitle = 'Workable, but negotiate';
    vSub = `Positive cash flow but ${pct(r.coc, 1)} CoC is modest. A lower price or higher rent moves this to strong.`;
  } else if (r.cashFlow >= 0) {
    vCls = 'ok'; vTitle = 'Thin margins';
    vSub = `Cash flow is barely positive and CoC is ${isFinite(r.coc) ? pct(r.coc, 1) : '—'}. Little cushion for surprises.`;
  } else {
    vCls = 'bad'; vTitle = 'Negative cash flow — walk or renegotiate';
    vSub = `This deal loses ${money0(r.cashFlow)} every month at these assumptions.`;
  }

  /* ---------- financing summary rows ---------- */
  const finParts: [string, number][] = ([
    [allCash ? 'Down payment — all cash' : 'Down payment', r.downAmt],
    eff.subtoOn ? ['Subject-to mortgage', r.subtoBal] : null,
    eff.sellerOn ? ['Seller financing', r.sellerAmt] : null,
    allCash ? null : ['New loan (bank)', r.newLoan],
  ].filter(Boolean)) as [string, number][];
  const piParts: [string, number][] = ([
    r.piBank > 0 ? [`New loan ${eff.ioOn ? '(interest-only)' : 'P&I'}`, r.piBank] : null,
    r.piSeller > 0 ? [`Seller ${s.sellerType === 'io' ? '(interest-only)' : 'P&I'}`, r.piSeller] : null,
    r.piSub > 0 ? ['Subject-to P&I', r.piSub] : null,
  ].filter(Boolean)) as [string, number][];
  const armTag = `${+s.armFixed}/${s.armFreq === 6 ? 6 : 1} ARM`;

  const debtRows: [string, number][] = ([
    r.piBank > 0 ? [`New loan ${eff.ioOn ? '(interest-only)' : 'P&I'}`, r.piBank] : null,
    r.piSeller > 0 ? [`Seller financing ${s.sellerType === 'io' ? '(interest-only)' : ''}`, r.piSeller] : null,
    r.piSub > 0 ? ['Subject-to payment', r.piSub] : null,
  ].filter(Boolean)) as [string, number][];

  /* ---------- PDF report ---------- */
  function pdf() {
    const doc = buildRentalReport({
      s: eff, r, sowTotal: 0,
      verdict: { cls: vCls, title: vTitle, sub: vSub },
    });
    openReportWindow(doc, '', () => toast('Pop-up blocked — allow pop-ups to open the report'));
  }

  const rareTotal = r.expLines.filter(x => RARE_EXPENSES.includes(x.id)).reduce((t, x) => t + (x.monthly || 0), 0);

  /* one operating-expense row: amount plus its unit toggle */
  const expenseRow = (e: (typeof EXPENSES)[number]) => {
                  const unit = s.units[e.id];
                  const line = r.expLines.find(x => x.id === e.id)!;
                  const units = e.mode === 'time'
                    ? [{ u: 'mo', label: 'mo' }, { u: 'yr', label: 'yr' }]
                    : [{ u: '$', label: '$' }, { u: '%', label: '%' }];
                  return (
                    <Field key={e.id} label={e.label}
                      hint={((unit === '%' || unit === 'yr') && line.monthly) ? `= ${money0(line.monthly)}/mo` : undefined}>
                      <div className="flex items-center gap-1.5">
                        <Segmented options={units} value={unit}
                          onChange={u => {
                            if (u === unit) return;
                            let v = s.expenses[e.id];
                            if (unit === 'mo' && u === 'yr') v = Math.round(v * 12);
                            if (unit === 'yr' && u === 'mo') v = Math.round(v / 12);
                            setS(prev => ({
                              ...prev,
                              expenses: { ...prev.expenses, [e.id]: v },
                              units: { ...prev.units, [e.id]: u },
                            }));
                          }} />
                        <NumberField fmt="raw" value={s.expenses[e.id]}
                          onChange={v => set('expenses', { ...s.expenses, [e.id]: v })} />
                      </div>
                    </Field>
                  );
                };

  /* ================================================================ render */
  const proRows = (rows: [string, (y: any) => number, boolean][]) => rows.map(([label, fn, strong]) => (
    <TableRow key={label} className="border-line/60 hover:bg-transparent">
      <TableCell className={`py-1.5 pl-0 ${strong ? 'font-bold text-ink-strong' : 'text-[#3a4352]'}`}>{label}</TableCell>
      {r.years.map(y => {
        const v = fn(y);
        return <TableCell key={y.y} className={`py-1.5 text-right tabular-nums last:pr-0 ${strong ? 'font-bold' : ''} ${v < 0 ? 'text-destructive' : 'text-ink-strong'}`}>{money(v)}</TableCell>;
      })}
    </TableRow>
  ));

  return (
    <>
      {/* ---------- deal header ---------- */}
      <div className="mb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-[240px] max-w-[620px] flex-[1_1_340px] items-center gap-1" ref={menuWrapRef}>
            <div className="min-w-0 flex-1" ref={addrRef}>
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
                {!savedDeals.length && <p className="px-2.5 py-2 text-[0.8125rem] text-muted-foreground">No saved deals yet. Use “Save deal” to keep one here.</p>}
                {[...savedDeals].sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || '')).map(d => {
                  const dr = compute(d);
                  return (
                    <div className="flex items-center gap-1 rounded-md hover:bg-muted" key={d.name}>
                      <button type="button" className="min-w-0 flex-1 rounded-md px-2.5 py-2 text-left"
                        onClick={() => { applyDeal(d); setMenuOpen(false); }}>
                        <span className="block truncate text-sm font-semibold text-ink-strong">{dealTitle(d)}</span>
                        <span className="block text-[0.8125rem] tabular-nums text-muted-foreground">{money0(d.price)} · {money(dr.cashFlow)}/mo · {isFinite(dr.coc) ? dr.coc.toFixed(1) : '—'}% CoC</span>
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
            <Button variant="outline" onClick={pdf} title="Open a print-ready deal report — choose “Save as PDF” in the print dialog"><Icon name="download" size={18} />PDF</Button>
            <Button onClick={saveDeal}>Save deal</Button>
            <Button variant="ghost" onClick={reset}>Reset</Button>
          </div>
        </div>

        {/* One line of facts, read like a listing. Editing lives behind one button. */}
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
          {factsBusy
            ? <span role="status" className="text-[0.9375rem] text-muted-foreground">Looking up the property…</span>
            : facts.length > 0
              ? (
                <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.9375rem] font-semibold tabular-nums text-ink-strong">
                  {facts.map(f => (
                    <li key={f.icon} className="flex items-center gap-1.5">
                      <Icon name={f.icon} size={18} className="text-muted-foreground" />{f.text}
                    </li>
                  ))}
                </ul>
              )
              : <span className="text-[0.9375rem] text-muted-foreground">{rcKey ? 'Pick an address to fill in beds, baths, size and year built.' : 'No property details yet.'}</span>}

          <Popover open={detailsOpen} onOpenChange={setDetailsOpen}>
            <PopoverTrigger render={<Button variant="outline" size="sm" />}>
              <Icon name="edit" size={16} />{facts.length ? 'Edit details' : 'Add details'}
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[min(24rem,calc(100vw-2rem))] gap-4 p-4">
              <div className="grid grid-cols-2 gap-3">
                {([['beds', 'Beds'], ['baths', 'Baths'], ['sqft', 'Square feet'], ['year', 'Year built']] as const).map(([k, label]) => (
                  <label key={k} className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">{label}
                    <Input className="font-medium tabular-nums text-ink-strong" inputMode="numeric" value={s.prop[k]} autoComplete="off"
                      onChange={ev => setProp(k, ev.target.value)} />
                  </label>
                ))}
                <label className="col-span-2 flex flex-col gap-1 text-xs font-semibold text-muted-foreground">List price
                  <NumberField width="w-full" className="h-8 text-left" aria-label="List price" value={s.prop.list} onChange={v => setProp('list', v)} />
                </label>
              </div>

              <div className="flex flex-col gap-2">
                <div className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">Links</div>
                {s.prop.urls.map((u, i) => (
                  <div className="flex items-center gap-2" key={i}>
                    <Input className="w-28 shrink-0" type="text" placeholder="Label" aria-label="Link label" value={u.label} autoComplete="off"
                      onChange={ev => setProp('urls', s.prop.urls.map((x, j) => j === i ? { ...x, label: ev.target.value } : x))} />
                    <Input className="min-w-0 flex-1" type="text" placeholder="https://…" aria-label="Link address" value={u.url} autoComplete="off"
                      onChange={ev => setProp('urls', s.prop.urls.map((x, j) => j === i ? { ...x, url: ev.target.value } : x))} />
                    <Button variant="ghost" size="icon-sm" aria-label="Remove link" title="Remove"
                      className="text-muted-foreground hover:bg-destructive-soft hover:text-destructive"
                      onClick={() => setProp('urls', s.prop.urls.filter((_, j) => j !== i))}><Icon name="close" size={16} /></Button>
                  </div>
                ))}
                <Button variant="outline" size="sm" className="self-start"
                  onClick={() => setProp('urls', [...s.prop.urls, { label: '', url: '' }])}><Icon name="add" size={16} />Add a link</Button>
              </div>

              <label className="flex flex-col gap-1 border-t border-line pt-3 text-xs font-semibold text-muted-foreground">RentCast API key
                <Input type="password" autoComplete="off" spellCheck={false} placeholder="Paste a key to turn on auto-fill" value={rcKey}
                  onChange={ev => saveRcKey(ev.target.value)} />
                <span className="font-normal leading-snug">With a key saved, picking a suggested address fills in beds, baths, square feet and year built. The key stays in this browser.</span>
              </label>
            </PopoverContent>
          </Popover>

          {links.length > 0 && (
            <nav aria-label="Research links" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.9375rem] font-semibold">
              {links.map(l => (
                <a key={l.href} href={l.href} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-0.5 text-primary hover:text-primary-hover hover:underline">
                  {l.label}<Icon name="open_in_new" size={14} />
                </a>
              ))}
            </nav>
          )}
        </div>
      </div>

      <div className="grid items-start gap-4 min-[1100px]:grid-cols-[360px_minmax(0,1fr)]">
            {/* LEFT: INPUTS */}
            <div className="flex min-w-0 flex-col gap-3">
              <Panel dense title="Acquisition" tag="Purchase">
                <Field label="Purchase price"><NumberField value={s.price} onChange={v => set('price', v)} /></Field>
                <Field label="Down payment" hint={money0(r.downAmt)}>
                  <Choice value={s.downPct} onChange={v => set('downPct', +v)}>
                    {[...new Set([...DOWN_CHOICES, s.downPct])].sort((a, b) => a - b).map(v => (
                      <option key={v} value={v}>{v >= 100 ? 'All cash' : `${v}%`}</option>
                    ))}
                  </Choice>
                </Field>
                <Field label="Rehab / initial repairs">
                  <NumberField value={eff.rehab} onChange={v => set('rehab', v)} />
                </Field>
                <Field label="Closing costs" hint={s.closingUnit === '%' ? `= ${money0(r.closingAmt)}` : undefined}>
                  <div className="flex items-center gap-1.5">
                    <Segmented options={[{ u: '$', label: '$' }, { u: '%', label: '%' }]} value={s.closingUnit}
                      onChange={u => {
                        if (u !== s.closingUnit) {
                          const v = u === '%'
                            ? (s.price > 0 ? +(s.closing / s.price * 100).toFixed(2) : 0)
                            : Math.round(s.price * s.closing / 100);
                          setS(prev => ({ ...prev, closing: v, closingUnit: u as '$' | '%' }));
                        }
                      }} />
                    <NumberField value={s.closing} onChange={v => set('closing', v)} fmt="raw" />
                  </div>
                </Field>
              </Panel>

              <Panel dense title="Financing" tag={allCash ? 'All cash' : 'Stack'}>
                {allCash && (
                  <Note icon="payments" title="All-cash purchase — financing is off">
                    You&apos;re covering the full {money0(s.price)} with your own money, so there is no loan to
                    describe. Drag the down payment below 100% to bring the loan, ARM and creative-financing
                    options back. Your settings are kept exactly as they were.
                  </Note>
                )}
                {/* Three groups, in the order the money is arranged: the bank loan and
                    its options, any creative financing layered on top, then how
                    the whole purchase adds up. */}
                <fieldset className={allCash ? 'opacity-50' : undefined} disabled={allCash}>
                  <Field label="Interest rate">
                    <NumberField value={s.rate} onChange={v => set('rate', v)} fmt="raw" disabled={allCash} suffix="%" />
                  </Field>
                  <Field label="Term">
                    <NumberField value={s.term} onChange={v => set('term', v)} fmt="raw" disabled={allCash} suffix="yrs" />
                  </Field>
                  <Fold label="Loan options" open={!allCash && (optsOpen ?? (eff.ioOn || eff.armOn))}
                    onOpenChange={o => { if (!allCash) setOptsOpen(o); }}
                    summary={allCash ? 'n/a' : [eff.ioOn ? 'Interest-only' : null, eff.armOn ? armTag : null].filter(Boolean).join(' · ') || 'Fixed rate'}>
                  <Field label="Interest-only" hint="pay only interest for a set period">
                    <Toggle checked={eff.ioOn} onChange={v => set('ioOn', v)} disabled={allCash} />
                  </Field>
                  {eff.ioOn && (
                    <Sub>
                      <Field label="Interest-only period" hint="set equal to the term for full-term IO (balloon)">
                        <NumberField value={s.ioYears} onChange={v => set('ioYears', v)} fmt="raw" disabled={allCash} suffix="yrs" />
                      </Field>
                    </Sub>
                  )}
                  <Field label="Adjustable rate (ARM)" hint="fixed intro period, then the rate adjusts">
                    <Toggle checked={eff.armOn} onChange={v => set('armOn', v)} disabled={allCash} />
                  </Field>
                  {eff.armOn && (
                    <Sub>
                      <Field label="Fixed period">
                        <NumberField value={s.armFixed} onChange={v => set('armFixed', v)} fmt="raw" disabled={allCash} suffix="yrs" />
                      </Field>
                      <Field label="Adjusts every">
                        <Choice value={s.armFreq} disabled={allCash} onChange={v => set('armFreq', +v)}>
                          <option value={6}>6 months</option>
                          <option value={12}>12 months</option>
                        </Choice>
                      </Field>
                      <Field label="Expected rate after adjustment">
                        <NumberField value={s.armRate} onChange={v => set('armRate', v)} fmt="raw" disabled={allCash} suffix="%" />
                      </Field>
                    </Sub>
                  )}
                  </Fold>

                  <Fold label="Creative financing" open={!allCash && (creativeOpen ?? (eff.sellerOn || eff.subtoOn))}
                    onOpenChange={o => { if (!allCash) setCreativeOpen(o); }}
                    summary={allCash ? 'n/a' : (eff.sellerOn || eff.subtoOn) ? money0(r.sellerAmt + r.subtoBal) + ' carried' : 'Off'}>
                  <Field label="Seller financing" hint="the seller carries part of the price">
                    <Toggle checked={eff.sellerOn} onChange={v => set('sellerOn', v)} disabled={allCash} />
                  </Field>
                  {eff.sellerOn && (
                    <Sub>
                      <Field label="Amount carried"><NumberField value={s.sellerAmt} onChange={v => set('sellerAmt', v)} disabled={allCash} /></Field>
                      <Field label="Interest rate">
                        <NumberField value={s.sellerRate} onChange={v => set('sellerRate', v)} fmt="raw" disabled={allCash} suffix="%" />
                      </Field>
                      <Field label="Term">
                        <NumberField value={s.sellerTerm} onChange={v => set('sellerTerm', v)} fmt="raw" disabled={allCash} suffix="yrs" />
                      </Field>
                      <Field label="Payment type">
                        <Choice value={s.sellerType} disabled={allCash} onChange={v => set('sellerType', v as 'am' | 'io')}>
                          <option value="am">Amortizing</option>
                          <option value="io">Interest-only</option>
                        </Choice>
                      </Field>
                    </Sub>
                  )}
                  <Field label="Subject-to" hint="take over the existing mortgage">
                    <Toggle checked={eff.subtoOn} onChange={v => set('subtoOn', v)} disabled={allCash} />
                  </Field>
                  {eff.subtoOn && (
                    <Sub>
                      <Field label="Existing balance"><NumberField value={s.subtoBal} onChange={v => set('subtoBal', v)} disabled={allCash} /></Field>
                      <Field label="Interest rate">
                        <NumberField value={s.subtoRate} onChange={v => set('subtoRate', v)} fmt="raw" disabled={allCash} suffix="%" />
                      </Field>
                      <Field label="Remaining term">
                        <NumberField value={s.subtoTerm} onChange={v => set('subtoTerm', v)} fmt="raw" disabled={allCash} suffix="yrs" />
                      </Field>
                    </Sub>
                  )}
                  </Fold>
                </fieldset>

                <div className="mt-1 border-t border-line-strong pt-1">
                  {finParts.map(([l, v]) => <Line key={l} label={l} value={money0(v)} />)}
                  <Line strong label="Total = purchase price" tone={r.overBy <= 0 ? 'pos' : undefined}
                    value={<span className="inline-flex items-center gap-1">{money0(r.downAmt + r.subtoBal + r.sellerAmt + r.newLoan)}{r.overBy <= 0 && <Icon name="check" size={16} label="matches the purchase price" />}</span>} />
                  <Line strong label="Total monthly debt service" value={allCash ? '$0/mo — debt-free' : `${money0(r.pi)}/mo`} />
                  {piParts.length > 1 && piParts.map(([l, v]) => <Line key={l} indent label={l} value={money0(v)} />)}
                  {eff.armOn && r.payAfterArm > 0 &&
                    <Line indent tone="warn" label={`${armTag} — adjusts in year ${Math.floor(s.armFixed) + 1}`} value={`≈ ${money0(r.payAfterArm + r.piSeller + r.piSub)}/mo`} />}
                  {eff.ioOn && s.ioYears > 0 && s.ioYears < s.term && r.payAfterIO > 0 &&
                    <Line indent tone="warn" label={`IO ends year ${+s.ioYears} — payment steps up`} value={`≈ ${money0(r.payAfterIO + r.piSeller + r.piSub)}/mo`} />}
                </div>
                {loanNotes.length > 0 && (
                  <div className="mt-1 flex justify-end">
                    <Button variant="link" size="sm" className="h-7 gap-1 px-0 font-semibold" onClick={() => setAmortOpen(true)}>
                      <Icon name="show_chart" size={16} />View amortization
                    </Button>
                  </div>
                )}
                {r.overBy > 0 && (
                  <Note tone="bad" icon="error">
                    Financing exceeds the purchase price by {money0(r.overBy)}. Reduce the down payment, seller carry, or subject-to balance.
                  </Note>
                )}
              </Panel>

              <Panel title="Monthly Cash Flow" tag="Year 1">
                <SectionLabel>Income</SectionLabel>
                <Field label="Gross monthly rent"><NumberField value={s.rent} onChange={v => set('rent', v)} /></Field>
                <Fold label="Other income" open={oiOpen} onOpenChange={setOiOpen} summary={`${money0(r.otherIncTotal)}/mo`}>
                  {OTHER_INC.map(k => (
                    <Field key={k} label={OTHER_INC_LABELS[k]}>
                      <NumberField value={s.otherInc[k]} onChange={v => set('otherInc', { ...s.otherInc, [k]: v })} />
                    </Field>
                  ))}
                </Fold>
                <Line label={`Vacancy (${s.vacancy}%)`} tone="neg" value={`−${money0(r.vacLoss)}`} />
                <Line total label="Effective income" value={money(r.effIncome)} />

                <SectionLabel>Operating expenses</SectionLabel>
                {EXPENSES.filter(e => !RARE_EXPENSES.includes(e.id)).map(expenseRow)}
                <Fold label="Other expenses" open={moreExpOpen ?? rareTotal > 0} onOpenChange={setMoreExpOpen} summary={`${money0(rareTotal)}/mo`}>
                  {EXPENSES.filter(e => RARE_EXPENSES.includes(e.id)).map(expenseRow)}
                </Fold>
                <Fold label="Utilities" open={utilOpen} onOpenChange={setUtilOpen} summary={`${money0(r.utilTotal)}/mo`}>
                  {UTILS.map(k => (
                    <Field key={k} label={UTIL_LABELS[k]}>
                      <div className="flex items-center gap-1.5">
                        <Segmented options={[{ u: 'mo', label: 'mo' }, { u: 'yr', label: 'yr' }]} value={s.utilUnits[k]}
                          onChange={u => {
                            if (u === s.utilUnits[k]) return;
                            const v = u === 'yr' ? Math.round(s.utils[k] * 12) : Math.round(s.utils[k] / 12);
                            setS(prev => ({
                              ...prev,
                              utils: { ...prev.utils, [k]: v },
                              utilUnits: { ...prev.utilUnits, [k]: u as 'mo' | 'yr' },
                            }));
                          }} />
                        <NumberField fmt="raw" value={s.utils[k]}
                          onChange={v => set('utils', { ...s.utils, [k]: v })} />
                      </div>
                    </Field>
                  ))}
                  <Line strong label="Utilities — monthly total" value={`${money0(r.utilTotal)}/mo`} />
                </Fold>
                <Line total label="Total operating expenses" tone="neg" value={`−${money0(r.opEx)}`} />
                <Line strong label="Net operating income" value={money(r.noi)} />

                <SectionLabel>Debt service</SectionLabel>
                {debtRows.length
                  ? debtRows.map(([l, v]) => <Line key={l} label={l} tone="neg" value={`−${money0(v)}`} />)
                  : <Line label="No financing" value="$0" />}
                <Line total label="Cash flow" tone={r.cashFlow >= 0 ? 'pos' : 'neg'} value={money(r.cashFlow)} />
              </Panel>
            </div>

            {/* RIGHT: RESULTS */}
            <div className="flex min-w-0 flex-col gap-4">
              <Verdict tone={vCls} title={vTitle}>{vSub}</Verdict>

              {/* headline numbers first, then the sliders that move them */}
              <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">
                <Stat label="Cash-on-Cash Return" value={isFinite(r.coc) ? pct(r.coc, 1) : '—'}
                  note="year-1 cash flow ÷ cash invested" tone={r.coc >= 0 ? 'pos' : 'neg'} />
                <Stat label="Monthly Cash Flow" value={money(r.cashFlow)}
                  note="after all expenses & debt" tone={r.cashFlow >= 0 ? 'pos' : 'neg'} />
                <Stat label="DSCR" value={isFinite(r.dscr) ? r.dscr.toFixed(2) : '∞'}
                  note="NOI ÷ debt service · lenders want ≥ 1.25"
                  tone={r.dscr >= 1.25 || !isFinite(r.dscr) ? 'pos' : r.dscr >= 1 ? undefined : 'neg'} />
                <Stat label="5-Year Total ROI" value={isFinite(r.roi5) ? pct(r.roi5, 0) : '—'}
                  note="cash flow + equity + appreciation" tone={r.roi5 >= 0 ? 'pos' : 'neg'} />
              </div>

              <Panel dense title="Variable Assumptions" tag="Watch the numbers react">
                <div className="grid gap-x-8 sm:grid-cols-2">
                <SliderField label="Vacancy" min={0} max={20} step={0.5} value={s.vacancy}
                  onChange={v => set('vacancy', v)} output={stripZeros(pct(s.vacancy, 1))} />
                <SliderField label="Annual rent growth" min={0} max={10} step={0.25} value={s.rentGrowth}
                  onChange={v => set('rentGrowth', v)} output={stripZeros(pct(s.rentGrowth, 2))} />
                <SliderField label="Annual expense growth" min={0} max={10} step={0.25} value={s.expGrowth}
                  onChange={v => set('expGrowth', v)} output={stripZeros(pct(s.expGrowth, 2))} />
                <SliderField label="Annual appreciation" min={0} max={10} step={0.25} value={s.appr}
                  onChange={v => set('appr', v)} output={stripZeros(pct(s.appr, 2))} />
                <SliderField label="Selling costs at exit" min={0} max={12} step={0.5} value={s.sellCost}
                  onChange={v => set('sellCost', v)} output={stripZeros(pct(s.sellCost, 1))} />
                </div>
              </Panel>

              <div className="flex flex-wrap gap-2">
                {([
                  ['1% Rule', pct(r.onePct, 2), r.onePct >= 1],
                  ['GRM', isFinite(r.grm) ? r.grm.toFixed(1) + '×' : '—', r.grm <= 12],
                ] as [string, string, boolean][]).map(([label, val, pass]) => (
                  <div key={label} className="flex items-center gap-2 rounded-full bg-card py-1.5 pl-2 pr-3.5 text-sm font-semibold text-[#3a4352] shadow-tight">
                    <span className={`grid size-5 place-items-center rounded-full text-white ${pass ? 'bg-success' : 'bg-destructive'}`}>
                      <Icon name={pass ? 'check' : 'close'} size={14} label={pass ? 'Passes' : 'Fails'} />
                    </span>
                    {label} <span className="font-bold tabular-nums text-ink-strong">{val}</span>
                  </div>
                ))}
                <div className="flex items-center gap-2 rounded-full bg-card py-1.5 pl-2 pr-3.5 text-sm font-semibold text-[#3a4352] shadow-tight">
                  <span className="grid size-5 place-items-center rounded-full bg-primary-soft text-primary-deep"><Icon name="attach_money" size={14} /></span>
                  Cash Needed <span className="font-bold tabular-nums text-ink-strong">{money0(r.cashInvested)}</span>
                </div>
              </div>

              <Panel title="5-Year Pro-Forma" tag="Annual">
                <Table className="text-sm">
                  <TableHeader>
                    <TableRow className="border-line hover:bg-transparent">
                      <TableHead className="h-8 pl-0"><span className="sr-only">Line</span></TableHead>
                      {r.years.map(y => <TableHead key={y.y} className="h-8 text-right text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground last:pr-0">Year {y.y}</TableHead>)}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow className="border-0 hover:bg-transparent"><TableHead scope="colgroup" colSpan={6} className="h-8 pl-0 pt-3 text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">Operations</TableHead></TableRow>
                    {proRows([
                      ['Gross rent', y => y.yRent, false],
                      ['Vacancy loss', y => -y.yVac, false],
                      ['Operating expenses', y => -y.yOpEx, false],
                      ['NOI', y => y.yNOI, true],
                      ['Debt service', y => -y.yDebt, false],
                      ['Cash flow', y => y.yCF, true],
                      ['Cumulative cash flow', y => y.cumCF, false],
                    ])}
                    <TableRow className="border-0 hover:bg-transparent"><TableHead scope="colgroup" colSpan={6} className="h-8 pl-0 pt-3 text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">Equity</TableHead></TableRow>
                    {proRows([
                      ['Property value', y => y.value, false],
                      ['Total loan balances', y => y.bal, false],
                      ['Equity', y => y.equity, true],
                    ])}
                  </TableBody>
                </Table>
              </Panel>

              <Panel title="If You Sold in Year 5" tag="Exit Analysis">
                <div className="grid gap-3 sm:grid-cols-3">
                  {([
                    ['Net Sale Proceeds', money(r.proceeds), undefined],
                    ['Total Profit', money(r.totalProfit), r.totalProfit >= 0 ? 'text-success' : 'text-destructive'],
                    ['Annualized Return', isFinite(r.annualized) ? pct(r.annualized, 1) : '—', undefined],
                  ] as [string, string, string | undefined][]).map(([label, val, color]) => (
                    <div key={label} className="rounded-md bg-page p-3">
                      <div className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">{label}</div>
                      <div className={`mt-0.5 text-[1.375rem] font-extrabold leading-tight tracking-[-0.015em] tabular-nums ${color ?? 'text-ink-strong'}`}>{val}</div>
                    </div>
                  ))}
                </div>
                <p className="mt-3 max-w-[75ch] text-[0.8125rem] leading-normal text-muted-foreground">Net sale proceeds = year-5 value, less selling costs of {stripZeros(pct(s.sellCost, 1))}, less payoff of all remaining loan balances. Total profit = net proceeds + 5 years of accumulated cash flow − cash invested.</p>
              </Panel>

              <p className="max-w-[75ch] text-[0.8125rem] leading-normal text-muted-foreground">Estimates for screening purposes only — verify taxes, insurance and rents locally before making offers. Percentage-based expenses are calculated on gross scheduled rent. NOI here includes the capex reserve as an operating cost, so the DSCR shown is the conservative view (many lenders exclude capex, which would show a higher ratio).</p>
            </div>
          </div>
      {amort && <AmortizationDialog open={amortOpen} onOpenChange={setAmortOpen} data={amort} notes={loanNotes} />}
    </>
  );
}
