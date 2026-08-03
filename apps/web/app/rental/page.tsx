'use client';

/* Rental Property Analyzer — React port of rental.html. Math in @reit/core;
   storage keys unchanged (rentalDeals.v3, rentalCalc.draft.v3). The Sales
   Comps / Rental Comps / CapEx / Neighborhood tabs are "coming soon": their
   data still round-trips through save/load untouched, so nothing saved in the
   old tool is lost. RentCast plumbing dropped entirely. */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  compute, defaultDealState, EXPENSES, UTILS, UTIL_LABELS, OTHER_INC, OTHER_INC_LABELS,
  SOW_SECTIONS, money, money0, pct, stripZeros, parseNum, fmtMoneyInput,
  type DealState, type SowItem,
} from '@reit/core';
import { Card, NumInput, Switch, UnitToggle, Tile, SliderRow, loadJSON, saveJSON, openReportWindow, escapeHtml } from '../../components/ui';
import { buildRentalReport } from '../../components/report';
import { toast } from '../../components/toast';

const STORE_KEY = 'rentalDeals.v3';
const DRAFT_KEY = 'rentalCalc.draft.v3';

const SLIDER_BOUNDS: Record<string, [number, number]> = {
  downPct: [0, 100], vacancy: [0, 20], rentGrowth: [0, 10],
  expGrowth: [0, 10], appr: [0, 10], sellCost: [0, 12],
};

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
    sow: (d.sow || []).map((i: any) => ({ sec: i.sec || 'other', desc: i.desc || '', cost: i.cost || 0 })),
    salesComps: d.salesComps || [],
    rentComps: d.rentComps || [],
    capex: Array.isArray(d.capex) ? d.capex : [],
    hood: { crime: d.hood?.crime || '', schools: d.hood?.schools || '', notes: d.hood?.notes || '' },
    prop: {
      address: d.prop?.address || '', beds: d.prop?.beds || '', baths: d.prop?.baths || '',
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

type TabId = 'analyzer' | 'salescomps' | 'rentcomps' | 'capex' | 'hood' | 'sow';
const SOON_TABS: Record<string, { ic: string; title: string; body: string }> = {
  salescomps: { ic: '🏷️', title: 'Sales Comps — coming soon', body: 'Track recently sold comparables and estimate ARV from $/sqft. Any comps saved with your deals in the previous version are preserved and will reappear when this ships.' },
  rentcomps: { ic: '🔑', title: 'Rental Comps — coming soon', body: 'Track nearby rentals and estimate market rent. Any comps saved with your deals in the previous version are preserved and will reappear when this ships.' },
  capex: { ic: '🧰', title: 'CapEx Tracker — coming soon', body: 'Log big-ticket systems (roof, HVAC, water heater…) with install year and condition, and get lifespan flags. Saved CapEx data is preserved and will reappear when this ships.' },
  hood: { ic: '🗺️', title: 'Neighborhood — coming soon', body: 'Research links plus crime, schools and notes that save with the deal. Saved neighborhood notes are preserved and will reappear when this ships.' },
};

export default function RentalPage() {
  const [s, setS] = useState<DealState>(defaultDealState);
  const [tab, setTab] = useState<TabId>('analyzer');
  const [oiOpen, setOiOpen] = useState(false);
  const [utilOpen, setUtilOpen] = useState(false);
  const [creativeOpen, setCreativeOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [savedDeals, setSavedDeals] = useState<DealState[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const nameRef = useRef<HTMLSpanElement>(null);
  const menuWrapRef = useRef<HTMLDivElement>(null);

  /* ---------- hydrate: draft + saved deals ---------- */
  useEffect(() => {
    const draft = loadJSON<any>(DRAFT_KEY);
    if (draft && isFinite(draft.price)) {
      const d = normalizeDeal(draft);
      setS(d);
      setCreativeOpen(!!(d.sellerOn || d.subtoOn));
      syncName(d.name);
    }
    setSavedDeals((loadJSON<any[]>(STORE_KEY) || []).map(normalizeDeal));
    setHydrated(true);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, []);

  /* close deal menu on outside click */
  useEffect(() => {
    const onDoc = (ev: MouseEvent) => {
      if (!menuWrapRef.current?.contains(ev.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('click', onDoc);
    return () => document.removeEventListener('click', onDoc);
  }, []);

  /* rehab locks to the Scope of Work total while items exist */
  const sowTotal = s.sow.reduce((t, i) => t + (i.cost || 0), 0);
  const sowLocked = s.sow.length > 0;

  /* 100% down is an all-cash purchase: there is no loan to describe, so the
     whole financing section switches off. The toggles are neutralized in the
     computed state only — `s` keeps every setting, so easing the slider back
     below 100% restores the stack exactly as it was. */
  const allCash = s.downPct >= 100;
  const eff = useMemo<DealState>(() => {
    const base = sowLocked ? { ...s, rehab: sowTotal } : s;
    return allCash ? { ...base, ioOn: false, armOn: false, sellerOn: false, subtoOn: false } : base;
  }, [s, sowLocked, sowTotal, allCash]);
  const r = useMemo(() => compute(eff), [eff]);

  /* draft persists on every change, like the original calc() */
  useEffect(() => { if (hydrated) saveJSON(DRAFT_KEY, eff); }, [eff, hydrated]);

  const set = <K extends keyof DealState>(k: K, v: DealState[K]) => setS(prev => ({ ...prev, [k]: v }));
  const setProp = (k: keyof DealState['prop'], v: any) => setS(prev => ({ ...prev, prop: { ...prev.prop, [k]: v } }));

  /* contentEditable deal name — sync DOM only when not focused (no caret jumps) */
  function syncName(name: string) {
    requestAnimationFrame(() => {
      if (nameRef.current && document.activeElement !== nameRef.current)
        nameRef.current.textContent = name;
    });
  }

  function applyDeal(d: DealState) {
    setS(d);
    setCreativeOpen(!!(d.sellerOn || d.subtoOn));
    syncName(d.name);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function newDeal() {
    localStorage.removeItem(DRAFT_KEY);
    applyDeal(defaultDealState());
    setMenuOpen(false);
    toast('Fresh sheet — name it and start underwriting');
  }

  function saveDeal() {
    if (!s.name.trim()) {
      setTab('analyzer');
      nameRef.current?.focus();
      toast('Give the deal a name first — tap the title to edit it');
      return;
    }
    const deal: DealState = { ...eff, savedAt: new Date().toISOString() };
    const deals = [...savedDeals];
    const i = deals.findIndex(d => d.name === deal.name);
    if (i >= 0) deals[i] = deal; else deals.push(deal);
    setSavedDeals(deals);
    saveJSON(STORE_KEY, deals);
    toast(i >= 0 ? 'Deal updated' : 'Deal saved');
  }

  function deleteDeal(name: string) {
    if (!confirm(`Delete "${name}"?`)) return;
    const deals = savedDeals.filter(d => d.name !== name);
    setSavedDeals(deals);
    saveJSON(STORE_KEY, deals);
  }

  function reset() {
    if (!confirm('Reset all inputs to defaults? Saved deals are kept.')) return;
    localStorage.removeItem(DRAFT_KEY);
    applyDeal(defaultDealState());
  }

  /* ---------- property chips ---------- */
  const chips: { html: React.ReactNode; href?: string; link?: boolean }[] = [];
  {
    const p = s.prop;
    const enc = encodeURIComponent(p.address);
    if (p.address) {
      chips.push({ html: 'Google Maps ↗', href: 'https://www.google.com/maps/search/?api=1&query=' + enc });
      chips.push({ html: 'Zillow ↗', href: 'https://www.zillow.com/homes/' + enc + '_rb/' });
      chips.push({ html: 'Realtor ↗', href: 'https://www.realtor.com/search?query=' + enc });
    }
    const beds = parseNum(p.beds), baths = parseNum(p.baths);
    if (beds || baths) chips.push({ html: <><b>{beds || '—'}</b> bd · <b>{baths || '—'}</b> ba</> });
    const sqft = parseNum(p.sqft);
    if (sqft) chips.push({ html: <><b>{Math.round(sqft).toLocaleString('en-US')}</b> sqft</> });
    if (parseNum(p.year)) chips.push({ html: <>built <b>{Math.round(parseNum(p.year))}</b></> });
    if (p.list > 0) {
      chips.push({ html: <>listed <b>{money0(p.list)}</b></> });
      if (sqft) chips.push({ html: <><b>${Math.round(p.list / sqft)}</b>/sqft</> });
    }
    if (p.video.trim()) chips.push({ html: '▶ Video tour', href: normUrl(p.video), link: true });
    p.urls.forEach(u => {
      if (!u.url.trim()) return;
      let name = u.label.trim();
      if (!name) { try { name = new URL(normUrl(u.url)).hostname.replace(/^www\./, ''); } catch { name = 'link'; } }
      chips.push({ html: name + ' ↗', href: normUrl(u.url), link: true });
    });
  }
  const linkCount = (s.prop.video.trim() ? 1 : 0) + s.prop.urls.filter(u => u.url.trim()).length;

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

  /* ---------- voice fill (Web Speech API) ---------- */
  const [voiceMode, setVoiceMode] = useState<'closed' | 'listening' | 'done'>('closed');
  const [voiceFinal, setVoiceFinal] = useState('');
  const [voiceInterim, setVoiceInterim] = useState('');
  const [voiceApplied, setVoiceApplied] = useState<[string, string][]>([]);
  const recogRef = useRef<any>(null);
  const cancelledRef = useRef(false);
  const finalRef = useRef('');

  function grabNum(text: string, fromIdx: number) {
    const win = text.slice(fromIdx, fromIdx + 52);
    const m = win.match(/\$?\s*(\d[\d,]*(?:\.\d+)?)\s*(thousand|grand|million|mil\b|k\b)?/);
    if (!m) return null;
    let v = parseFloat(m[1].replace(/,/g, ''));
    if (m[2]) v *= /million|mil/.test(m[2]) ? 1e6 : 1e3;
    const tail = win.slice((m.index || 0) + m[0].length, (m.index || 0) + m[0].length + 26);
    return {
      v,
      pct: /^\s*(?:percent|%)/.test(tail),
      annual: /(?:\b(?:a|per)\s+year\b|annually|yearly)/.test(tail),
      monthly: /(?:\b(?:a|per)\s+month\b|monthly)/.test(tail),
    };
  }

  function parseVoice(text: string): [string, string][] {
    type Num = { v: number; pct: boolean; annual: boolean; monthly: boolean };
    const next: DealState = JSON.parse(JSON.stringify(s));
    const clampSet = (id: keyof DealState, v: number) => {
      const [lo, hi] = SLIDER_BOUNDS[id as string];
      const cv = Math.min(hi, Math.max(lo, v));
      (next as any)[id] = cv;
      return cv;
    };
    const timeExp = (id: string) => (n: Num) => {
      const unit = n.annual ? 'yr' : (n.monthly ? 'mo' : next.units[id]);
      next.units[id] = unit;
      next.expenses[id] = Math.round(n.v);
      return `${money0(n.v)}${unit === 'yr' ? '/yr' : '/mo'}`;
    };
    const rentExp = (id: string) => (n: Num) => {
      const unit = n.pct ? '%' : '$';
      next.units[id] = unit;
      next.expenses[id] = n.pct ? n.v : Math.round(n.v);
      return n.pct ? `${n.v}% of rent` : `${money0(n.v)}/mo`;
    };
    const utilSet = (id: string) => (n: Num) => {
      const unit = n.annual ? 'yr' : 'mo';
      next.utilUnits[id] = unit;
      next.utils[id] = Math.round(n.v);
      return `${money0(n.v)}${unit === 'yr' ? '/yr' : '/mo'}`;
    };
    const oiSet = (id: string) => (n: Num) => { next.otherInc[id] = Math.round(n.v); return `${money0(n.v)}/mo`; };

    const FIELDS: { label: string; re: RegExp; apply: (n: Num) => string | null }[] = [
      { label: 'Purchase price', re: /purchase price|asking price|sale price|\bprice\b/,
        apply: n => { next.price = Math.round(n.v); return money0(n.v); } },
      { label: 'Down payment', re: /down payment|\bdown\b/,
        apply: n => {
          if (n.pct) return clampSet('downPct', Math.round(n.v)) + '%';
          if (next.price <= 0) return null;
          const p = clampSet('downPct', Math.round(n.v / next.price * 100));
          return `${money0(n.v)} (${p}%)`;
        } },
      { label: 'Rehab budget', re: /rehab|renovation/,
        apply: n => {
          if (sowLocked) return 'skipped — locked to Scope of Work';
          next.rehab = Math.round(n.v); return money0(n.v);
        } },
      { label: 'Closing costs', re: /closing/,
        apply: n => {
          if (n.pct) { next.closingUnit = '%'; next.closing = n.v; return n.v + '% of price'; }
          next.closingUnit = '$'; next.closing = Math.round(n.v); return money0(n.v);
        } },
      { label: 'Interest rate', re: /interest(?:\s+rate)?/,
        apply: n => { next.rate = n.v; return n.v + '%'; } },
      { label: 'Loan term', re: /loan term|amortization|\bterm\b/,
        apply: n => { next.term = Math.round(n.v); return Math.round(n.v) + ' yrs'; } },
      { label: 'Vacancy', re: /vacancy/, apply: n => clampSet('vacancy', n.v) + '%' },
      { label: 'Rent growth', re: /rent (?:growth|increase)/, apply: n => clampSet('rentGrowth', n.v) + '%/yr' },
      { label: 'Expense growth', re: /expense (?:growth|inflation)/, apply: n => clampSet('expGrowth', n.v) + '%/yr' },
      { label: 'Appreciation', re: /appreciation/, apply: n => clampSet('appr', n.v) + '%/yr' },
      { label: 'Selling costs', re: /selling costs?/, apply: n => clampSet('sellCost', n.v) + '%' },
      { label: 'Pet rent', re: /pet (?:rent|fees?)/, apply: oiSet('pet') },
      { label: 'Laundry income', re: /laundry/, apply: oiSet('laundry') },
      { label: 'Parking income', re: /parking/, apply: oiSet('parking') },
      { label: 'Storage income', re: /storage/, apply: oiSet('storage') },
      { label: 'Other income', re: /other income/, apply: oiSet('other') },
      { label: 'Gross monthly rent', re: /(?<!pet )(?:gross |monthly )?rents?\b(?!\s*(?:growth|increase))/,
        apply: n => { next.rent = Math.round(n.v); return money0(n.v) + '/mo'; } },
      { label: 'Property tax', re: /(?:property )?tax(?:es)?/, apply: timeExp('tax') },
      { label: 'Insurance', re: /insurance/, apply: timeExp('ins') },
      { label: 'HOA', re: /\bhoa\b|h\.?o\.?a\.?/, apply: timeExp('hoa') },
      { label: 'Property management', re: /management/, apply: rentExp('mgmt') },
      { label: 'Maintenance', re: /maintenance/, apply: rentExp('maint') },
      { label: 'CapEx reserve', re: /cap ?ex|capital expend\w*/, apply: rentExp('capex') },
      { label: 'Landscaping', re: /landscap\w*/, apply: rentExp('landscape') },
      { label: 'Cleaning', re: /cleaning/, apply: rentExp('cleaning') },
      { label: 'Pest control', re: /pest/, apply: rentExp('pest') },
      { label: 'Miscellaneous', re: /miscellaneous|misc\b/, apply: rentExp('misc') },
      { label: 'Electricity', re: /electric\w*/, apply: utilSet('electric') },
      { label: 'Water', re: /water/, apply: utilSet('water') },
      { label: 'Sewer', re: /sewer/, apply: utilSet('sewer') },
      { label: 'Trash', re: /trash|garbage/, apply: utilSet('trash') },
      { label: 'Gas', re: /\bgas\b/, apply: utilSet('gas') },
      { label: 'Internet', re: /internet|wi-?fi/, apply: utilSet('internet') },
    ];

    const t = ' ' + text.toLowerCase() + ' ';
    const applied: [string, string][] = [];
    for (const f of FIELDS) {
      const mt = t.match(f.re);
      if (!mt) continue;
      const n = grabNum(t, (mt.index || 0) + mt[0].length);
      if (!n) continue;
      const res = f.apply(n);
      if (res) applied.push([f.label, res]);
    }
    if (applied.length) setS(next);
    return applied;
  }

  function startVoice() {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { toast('Voice input needs Chrome, Edge or Safari'); return; }
    if (voiceMode === 'listening') { recogRef.current?.stop(); return; }
    finalRef.current = ''; cancelledRef.current = false;
    setVoiceFinal(''); setVoiceInterim(''); setVoiceApplied([]);
    const recog = new SR();
    recogRef.current = recog;
    recog.lang = 'en-US';
    recog.continuous = true;
    recog.interimResults = true;
    recog.onresult = (ev: any) => {
      let interim = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        if (ev.results[i].isFinal) finalRef.current += ev.results[i][0].transcript + ' ';
        else interim += ev.results[i][0].transcript;
      }
      setVoiceFinal(finalRef.current);
      setVoiceInterim(interim);
    };
    recog.onerror = (ev: any) => {
      if (ev.error === 'not-allowed')
        setVoiceInterim('Microphone access was blocked — allow the mic for this page and try again.');
    };
    recog.onend = () => {
      if (cancelledRef.current) { setVoiceMode('closed'); return; }
      const applied = parseVoice(finalRef.current);
      setVoiceApplied(applied);
      setVoiceFinal(finalRef.current.trim() || '(nothing heard)');
      setVoiceInterim('');
      setVoiceMode('done');
    };
    setVoiceMode('listening');
    recog.start();
  }

  /* ---------- PDF & email ---------- */
  function snapshotKV(): [string, string][] {
    return [
      ['Purchase price', money0(eff.price)],
      ['Down payment', `${money0(r.downAmt)} (${s.downPct}%)`],
      ['Rehab budget', money0(eff.rehab)],
      ['Total cash invested', money0(r.cashInvested)],
      ['Gross rent', `${money0(s.rent)}/mo`],
      ['Net operating income', `${money(r.noi)}/mo`],
      ['Debt service', `${money0(r.pi)}/mo`],
      ['Cash flow', `${money(r.cashFlow)}/mo`],
      ['Cash-on-cash return', isFinite(r.coc) ? pct(r.coc, 1) : '—'],
      ['DSCR', isFinite(r.dscr) ? r.dscr.toFixed(2) : '—'],
      ['5-year total ROI', isFinite(r.roi5) ? pct(r.roi5, 0) : '—'],
      ['Year-5 exit profit', money(r.totalProfit)],
    ];
  }

  function pdf() {
    const doc = buildRentalReport({
      s: eff, r, sowTotal,
      verdict: { cls: vCls, title: vTitle, sub: vSub },
    });
    openReportWindow(doc, '', () => toast('Pop-up blocked — allow pop-ups to open the report'));
  }

  function email() {
    const name = s.name || 'Untitled deal';
    const body = `${name}${s.prop.address ? ' — ' + s.prop.address : ''}\n${vTitle}\n\n` +
      snapshotKV().map(([k, v]) => `${k}: ${v}`).join('\n') +
      '\n\n— Generated by Real Estate Investor Toolkit';
    location.href = `mailto:?subject=${encodeURIComponent('Deal report — ' + name)}&body=${encodeURIComponent(body)}`;
  }

  /* ---------- scope of work: contractor download ---------- */
  function downloadSow() {
    const name = s.name || 'Property';
    const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const secHtml = SOW_SECTIONS.map(sec => {
      const items = s.sow.filter(i => i.sec === sec.id && (i.desc.trim() || i.cost));
      if (!items.length) return '';
      const sub = items.reduce((a, i) => a + (i.cost || 0), 0);
      return `
      <h2>${sec.label}</h2>
      <table>
        <thead><tr><th>Item</th><th class="c">Est. Cost</th></tr></thead>
        <tbody>
          ${items.map(i => `<tr><td>${escapeHtml(i.desc || '—')}</td><td class="c">${money0(i.cost || 0)}</td></tr>`).join('')}
          <tr class="sub"><td>Subtotal — ${sec.label}</td><td class="c">${money0(sub)}</td></tr>
        </tbody>
      </table>`;
    }).join('');
    const doc = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Scope of Work — ${escapeHtml(name)}</title>
<style>
  body { font-family: Georgia, 'Times New Roman', serif; color:#222; max-width:720px; margin:40px auto; padding:0 24px; line-height:1.5; }
  header { border-bottom:3px double #222; padding-bottom:14px; margin-bottom:24px; }
  h1 { font-size:26px; margin:0; }
  .meta { color:#666; font-size:14px; margin-top:4px; }
  h2 { font-size:16px; text-transform:uppercase; letter-spacing:.06em; border-bottom:1px solid #999; padding-bottom:4px; margin:28px 0 8px; }
  table { width:100%; border-collapse:collapse; font-size:14px; }
  th { text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:#666; padding:6px 4px; border-bottom:1px solid #ccc; }
  td { padding:7px 4px; border-bottom:1px solid #eee; vertical-align:top; }
  .c { text-align:right; white-space:nowrap; width:110px; }
  tr.sub td { font-weight:bold; border-top:1px solid #999; border-bottom:none; }
  .grand { margin-top:30px; border-top:3px double #222; padding-top:12px; display:flex; justify-content:space-between; font-size:18px; font-weight:bold; }
  .note { margin-top:36px; font-size:12px; color:#777; border-top:1px solid #ddd; padding-top:10px; }
  .sign { margin-top:48px; display:flex; gap:40px; }
  .sign div { flex:1; border-top:1px solid #222; padding-top:6px; font-size:13px; color:#444; }
  @media print { body { margin:0 auto; } }
</style></head>
<body>
<header>
  <h1>Scope of Work</h1>
  <div class="meta">${escapeHtml(name)} &nbsp;·&nbsp; Prepared ${date}</div>
</header>
${secHtml || '<p><em>No line items entered.</em></p>'}
<div class="grand"><span>Total Rehab Budget</span><span>${money0(sowTotal)}</span></div>
<p class="note">Costs are owner estimates for bidding purposes. Contractor to confirm quantities, materials and pricing. Please itemize any exclusions in your bid.</p>
<div class="sign"><div>Owner — Date</div><div>Contractor — Date</div></div>
</body></html>`;
    const blob = new Blob([doc], { type: 'text/html' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `Scope of Work - ${name.replace(/[^\w\- ]+/g, '')}.html`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast('Scope of Work downloaded — open it and print to PDF if needed');
  }

  const setSowItem = (item: SowItem, patch: Partial<SowItem>) =>
    setS(prev => ({ ...prev, sow: prev.sow.map(i => i === item ? { ...i, ...patch } : i) }));

  /* ================================================================ render */
  return (
    <>
      {/* ---------- deal header ---------- */}
      <div className="deal-head">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div className="deal-title-wrap" ref={menuWrapRef}>
            <span className="deal-name" ref={nameRef} contentEditable suppressContentEditableWarning
              spellCheck={false} data-placeholder="Untitled deal — tap to name"
              onInput={ev => set('name', (ev.target as HTMLElement).textContent?.trim() || '')}
              onKeyDown={ev => { if (ev.key === 'Enter') { ev.preventDefault(); (ev.target as HTMLElement).blur(); } }}
              onPaste={ev => {
                ev.preventDefault();
                document.execCommand('insertText', false, ev.clipboardData.getData('text/plain').replace(/\n/g, ' '));
              }} />
            <button className="caret-btn" title="Switch deal"
              onClick={ev => { ev.stopPropagation(); setMenuOpen(o => !o); }}>▾</button>
            <div className={`deal-menu${menuOpen ? ' open' : ''}`}>
              <div className="dm-item new" onClick={newDeal}>＋ New deal</div>
              {!savedDeals.length && <div className="dm-empty">No saved deals yet — hit “Save deal” to keep one here.</div>}
              {[...savedDeals].sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || '')).map(d => {
                const dr = compute(d);
                return (
                  <div className="dm-item" key={d.name}
                    onClick={() => { applyDeal(d); setMenuOpen(false); }}>
                    <div>
                      <div className="dm-n">{d.name}</div>
                      <div className="dm-m">{money0(d.price)} · {money(dr.cashFlow)}/mo · {isFinite(dr.coc) ? dr.coc.toFixed(1) : '—'}% CoC</div>
                    </div>
                    <button className="dm-del" title="Delete"
                      onClick={ev => { ev.stopPropagation(); deleteDeal(d.name); }}>✕</button>
                  </div>
                );
              })}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className={`btn voice-btn${voiceMode === 'listening' ? ' listening' : ''}`} onClick={startVoice} title="Fill inputs by speaking">🎤 Voice fill</button>
            <button className="btn" onClick={pdf} title="Open a print-ready deal report — choose “Save as PDF” in the print dialog">⬇ PDF</button>
            <button className="btn" onClick={email} title="Send a text snapshot via your email app">✉ Email</button>
            <button className="btn primary" onClick={saveDeal}>Save deal</button>
            <button className="btn ghost" onClick={reset}>Reset</button>
          </div>
        </div>
        {chips.length > 0 && (
          <div className="prop-chips" style={{ marginTop: 8 }}>
            {chips.map((c, i) => c.href
              ? <a key={i} className={`p-chip${c.link ? ' link' : ''}`} href={c.href} target="_blank" rel="noopener noreferrer">{c.html}</a>
              : <span key={i} className="p-chip">{c.html}</span>)}
          </div>
        )}
        <details className="collapse" style={{ marginTop: 8, background: 'var(--card)' }}>
          <summary><span><span className="chev">▶</span>&nbsp; Property details &amp; links</span>
            <span className="sum-val">{linkCount ? `${linkCount} link${linkCount > 1 ? 's' : ''}` : ''}</span></summary>
          <div className="inner">
            <div className="prop-addr-row" style={{ marginTop: 8 }}>
              <input type="text" placeholder="Property address (e.g. 123 Main St, Springfield, IL 62704)"
                value={s.prop.address} autoComplete="off"
                onChange={ev => setProp('address', ev.target.value)} />
            </div>
            <div className="prop-facts" style={{ marginTop: 10 }}>
              {([['beds', 'Beds'], ['baths', 'Baths'], ['sqft', 'Sq ft'], ['year', 'Year built']] as const).map(([k, label]) => (
                <div className="pf-item" key={k}><label>{label}</label>
                  <input className="num small" value={s.prop[k]} autoComplete="off"
                    onChange={ev => setProp(k, ev.target.value)} /></div>
              ))}
              <div className="pf-item"><label>List price</label>
                <NumInput small value={s.prop.list} onChange={v => setProp('list', v)} /></div>
            </div>
            <div className="row" style={{ marginTop: 6 }}><label>Video tour URL</label></div>
            <div className="url-row" style={{ gridTemplateColumns: '1fr 30px' }}>
              <input type="text" placeholder="https://youtu.be/… or Matterport, etc." value={s.prop.video}
                autoComplete="off" onChange={ev => setProp('video', ev.target.value)} />
              <button className="del" title="Open" onClick={() => { const u = normUrl(s.prop.video); if (u) window.open(u, '_blank', 'noopener'); }}>↗</button>
            </div>
            <div className="row" style={{ marginTop: 6 }}>
              <label>Other links <span className="sub">pictures, county records, listing pages…</span></label>
              <button className="btn" style={{ fontSize: 11.5, padding: '6px 10px' }}
                onClick={() => setProp('urls', [...s.prop.urls, { label: '', url: '' }])}>+ Add link</button>
            </div>
            <div>
              {s.prop.urls.map((u, i) => (
                <div className="url-row" key={i}>
                  <input type="text" placeholder="Label (Photos…)" value={u.label} autoComplete="off"
                    onChange={ev => setProp('urls', s.prop.urls.map((x, j) => j === i ? { ...x, label: ev.target.value } : x))} />
                  <input type="text" placeholder="https://…" value={u.url} autoComplete="off"
                    onChange={ev => setProp('urls', s.prop.urls.map((x, j) => j === i ? { ...x, url: ev.target.value } : x))} />
                  <button className="del" title="Remove"
                    onClick={() => setProp('urls', s.prop.urls.filter((_, j) => j !== i))}>✕</button>
                </div>
              ))}
            </div>
          </div>
        </details>
      </div>

      {/* ---------- tabs ---------- */}
      <nav className="tabs">
        <button className={`tab${tab === 'analyzer' ? ' on' : ''}`} onClick={() => setTab('analyzer')}>Deal Analyzer</button>
        <button className={`tab${tab === 'salescomps' ? ' on' : ''}`} onClick={() => setTab('salescomps')}>Sales Comps <span className="badge soon">Soon</span></button>
        <button className={`tab${tab === 'rentcomps' ? ' on' : ''}`} onClick={() => setTab('rentcomps')}>Rental Comps <span className="badge soon">Soon</span></button>
        <button className={`tab${tab === 'capex' ? ' on' : ''}`} onClick={() => setTab('capex')}>CapEx <span className="badge soon">Soon</span></button>
        <button className={`tab${tab === 'hood' ? ' on' : ''}`} onClick={() => setTab('hood')}>Neighborhood <span className="badge soon">Soon</span></button>
        <button className={`tab${tab === 'sow' ? ' on' : ''}`} onClick={() => setTab('sow')}>Scope of Work <span className="badge">{money0(sowTotal)}</span></button>
      </nav>

      {/* ---------- coming-soon panes ---------- */}
      {SOON_TABS[tab] && (
        <section className="pane on">
          <div className="soon-pane">
            <div className="sp-ic">{SOON_TABS[tab].ic}</div>
            <h3>{SOON_TABS[tab].title}</h3>
            <p>{SOON_TABS[tab].body}</p>
          </div>
        </section>
      )}

      {/* ---------- analyzer ---------- */}
      <section className={`pane${tab === 'analyzer' ? ' on' : ''}`}>
        <div className="grid">
          {/* LEFT: INPUTS */}
          <div>
            <Card dense title="Acquisition" tag="Purchase">
              <div className="row"><label>Purchase price</label>
                <NumInput value={s.price} onChange={v => set('price', v)} /></div>
              <SliderRow label="Down payment" min={0} max={100} step={1} value={s.downPct}
                onChange={v => set('downPct', v)}
                output={allCash ? `100% · ${money0(r.downAmt)} — all cash` : `${s.downPct}% · ${money0(r.downAmt)}`} />
              <div className="row"><label>Rehab / initial repairs <span className="sub">{sowLocked ? 'synced from Scope of Work' : 'enter manually, or build a Scope of Work'}</span></label>
                <NumInput value={eff.rehab} onChange={v => set('rehab', v)} readOnly={sowLocked} /></div>
              <div className="row"><label>Closing costs <span className="sub">{s.closingUnit === '%' ? `= ${money0(r.closingAmt)}` : ''}</span></label>
                <div className="inline-input">
                  <NumInput value={s.closing} onChange={v => set('closing', v)} fmt="raw" small />
                  <UnitToggle options={[{ u: '$', label: '$' }, { u: '%', label: '% price' }]} value={s.closingUnit}
                    onChange={u => {
                      if (u !== s.closingUnit) {
                        const v = u === '%'
                          ? (s.price > 0 ? +(s.closing / s.price * 100).toFixed(2) : 0)
                          : Math.round(s.price * s.closing / 100);
                        setS(prev => ({ ...prev, closing: v, closingUnit: u as '$' | '%' }));
                      }
                    }} />
                </div>
              </div>
            </Card>

            <Card dense title="Financing" tag={allCash ? 'All cash' : 'Stack'}>
              {allCash && (
                <div className="fin-note">
                  <span className="ic" aria-hidden="true">💵</span>
                  <span><b>All-cash purchase — financing is off</b>
                    <span>You&apos;re covering the full {money0(s.price)} with your own money, so there is no loan to
                      describe. Drag the down payment below 100% to bring the loan, ARM and creative-financing
                      options back — your settings are kept exactly as they were.</span></span>
                </div>
              )}
              <fieldset className={`fin-fields${allCash ? ' locked' : ''}`} disabled={allCash}>
              <div className="row"><label>New loan — interest rate</label>
                <div className="inline-input">
                  <NumInput value={s.rate} onChange={v => set('rate', v)} fmt="raw" small disabled={allCash} />
                  <span className="unit-suffix">%</span>
                </div>
              </div>
              <div className="row"><label>New loan — term</label>
                <div className="inline-input">
                  <NumInput value={s.term} onChange={v => set('term', v)} fmt="raw" small disabled={allCash} />
                  <span className="unit-suffix">yrs</span>
                </div>
              </div>
              <div className="row">
                <label>Interest-only <span className="sub">pay only interest for a set period</span></label>
                <Switch checked={eff.ioOn} onChange={v => set('ioOn', v)} disabled={allCash} />
              </div>
              <div className={`fin-sub${eff.ioOn ? ' on' : ''}`}>
                <div className="row"><label>Interest-only period <span className="sub">set equal to the term for full-term IO (balloon)</span></label>
                  <div className="inline-input">
                    <NumInput value={s.ioYears} onChange={v => set('ioYears', v)} fmt="raw" small disabled={allCash} />
                    <span className="unit-suffix">yrs</span>
                  </div>
                </div>
              </div>
              <div className="row">
                <label>ARM <span className="sub">adjustable rate — fixed intro period, then adjusts</span></label>
                <Switch checked={eff.armOn} onChange={v => set('armOn', v)} disabled={allCash} />
              </div>
              <div className={`fin-sub${eff.armOn ? ' on' : ''}`}>
                <div className="row"><label>Fixed period</label>
                  <div className="inline-input">
                    <NumInput value={s.armFixed} onChange={v => set('armFixed', v)} fmt="raw" small disabled={allCash} />
                    <span className="unit-suffix">yrs</span>
                  </div>
                </div>
                <div className="row"><label>Adjusts every</label>
                  <select value={s.armFreq} disabled={allCash} onChange={ev => set('armFreq', +ev.target.value)}>
                    <option value={6}>6 months</option>
                    <option value={12}>12 months</option>
                  </select>
                </div>
                <div className="row"><label>Expected rate after adjustment</label>
                  <div className="inline-input">
                    <NumInput value={s.armRate} onChange={v => set('armRate', v)} fmt="raw" small disabled={allCash} />
                    <span className="unit-suffix">%</span>
                  </div>
                </div>
                <div className="row"><label>Structure</label><span style={{ fontFamily: 'var(--mono)', fontWeight: 600, fontSize: 13 }}>{armTag}</span></div>
              </div>

              <details className="collapse" open={allCash ? false : creativeOpen}
                onToggle={ev => { if (!allCash) setCreativeOpen((ev.target as HTMLDetailsElement).open); }}>
                <summary><span><span className="chev">▶</span>&nbsp; Creative financing</span>
                  <span className="sum-val">{allCash ? 'n/a — all cash' : (s.sellerOn || s.subtoOn) ? money0(r.sellerAmt + r.subtoBal) + ' carried' : 'off'}</span></summary>
                <div className="inner">
                  <div className="row" style={{ paddingBottom: 2 }}>
                    <label><strong style={{ color: 'var(--ink)' }}>Seller financing</strong></label>
                    <Switch checked={eff.sellerOn} onChange={v => set('sellerOn', v)} disabled={allCash} />
                  </div>
                  <div className={`fin-sub${eff.sellerOn ? ' on' : ''}`}>
                    <div className="row"><label>Amount carried</label>
                      <NumInput value={s.sellerAmt} onChange={v => set('sellerAmt', v)} disabled={allCash} /></div>
                    <div className="row"><label>Interest rate</label>
                      <div className="inline-input">
                        <NumInput value={s.sellerRate} onChange={v => set('sellerRate', v)} fmt="raw" small disabled={allCash} />
                        <span className="unit-suffix">%</span>
                      </div>
                    </div>
                    <div className="row"><label>Term</label>
                      <div className="inline-input">
                        <NumInput value={s.sellerTerm} onChange={v => set('sellerTerm', v)} fmt="raw" small disabled={allCash} />
                        <span className="unit-suffix">yrs</span>
                      </div>
                    </div>
                    <div className="row"><label>Payment type</label>
                      <select value={s.sellerType} disabled={allCash} onChange={ev => set('sellerType', ev.target.value as 'am' | 'io')}>
                        <option value="am">Amortizing</option>
                        <option value="io">Interest-only</option>
                      </select>
                    </div>
                  </div>
                  <div className="row" style={{ paddingBottom: 2 }}>
                    <label><strong style={{ color: 'var(--ink)' }}>Subject-to <span className="sub">take over existing mortgage</span></strong></label>
                    <Switch checked={eff.subtoOn} onChange={v => set('subtoOn', v)} disabled={allCash} />
                  </div>
                  <div className={`fin-sub${eff.subtoOn ? ' on' : ''}`}>
                    <div className="row"><label>Existing balance</label>
                      <NumInput value={s.subtoBal} onChange={v => set('subtoBal', v)} disabled={allCash} /></div>
                    <div className="row"><label>Interest rate</label>
                      <div className="inline-input">
                        <NumInput value={s.subtoRate} onChange={v => set('subtoRate', v)} fmt="raw" small disabled={allCash} />
                        <span className="unit-suffix">%</span>
                      </div>
                    </div>
                    <div className="row"><label>Remaining term</label>
                      <div className="inline-input">
                        <NumInput value={s.subtoTerm} onChange={v => set('subtoTerm', v)} fmt="raw" small disabled={allCash} />
                        <span className="unit-suffix">yrs</span>
                      </div>
                    </div>
                  </div>
                </div>
              </details>
              </fieldset>

              <div className="fin-summary">
                {finParts.map(([l, v]) => <div className="row" key={l}><label>{l}</label><span className="val">{money0(v)}</span></div>)}
                <div className="row total"><label>Total = purchase price</label>
                  <span className={`val${r.overBy <= 0 ? ' fin-ok' : ''}`}>{money0(r.downAmt + r.subtoBal + r.sellerAmt + r.newLoan)}{r.overBy <= 0 ? ' ✓' : ''}</span></div>
                <div className="row debt-total"><label>Total monthly debt service</label>
                  <span className="val">{allCash ? '$0/mo — debt-free' : `${money0(r.pi)}/mo`}</span></div>
                {piParts.length > 1 && piParts.map(([l, v]) =>
                  <div className="row" key={l}><label style={{ paddingLeft: 10 }}>↳ {l}</label><span className="val">{money0(v)}</span></div>)}
                {eff.armOn && r.payAfterArm > 0 &&
                  <div className="row"><label style={{ paddingLeft: 10, color: 'var(--warn)' }}>↳ {armTag} — adjusts in year {Math.floor(s.armFixed) + 1}</label>
                    <span className="val" style={{ color: 'var(--warn)' }}>≈ {money0(r.payAfterArm + r.piSeller + r.piSub)}/mo</span></div>}
                {eff.ioOn && s.ioYears > 0 && s.ioYears < s.term && r.payAfterIO > 0 &&
                  <div className="row"><label style={{ paddingLeft: 10, color: 'var(--warn)' }}>↳ IO ends year {+s.ioYears} — payment steps up</label>
                    <span className="val" style={{ color: 'var(--warn)' }}>≈ {money0(r.payAfterIO + r.piSeller + r.piSub)}/mo</span></div>}
              </div>
              <div className={`fin-warn${r.overBy > 0 ? ' show' : ''}`}>
                {r.overBy > 0 && `Financing exceeds the purchase price by ${money0(r.overBy)}. Reduce the down payment, seller carry, or subject-to balance.`}
              </div>
            </Card>

            <Card title="Monthly Cash Flow — Year 1" tag="Income · Expenses · Debt">
              <div className="row"><label className="sec-label">Income</label></div>
              <div className="row"><label>Gross monthly rent</label>
                <NumInput value={s.rent} onChange={v => set('rent', v)} /></div>
              <div className={`row util-head${oiOpen ? ' open' : ''}`} onClick={() => setOiOpen(o => !o)}>
                <label><span className="chev">▶</span>Other income</label>
                <span className="util-total">{money0(r.otherIncTotal)}/mo</span>
              </div>
              <div className={`util-body${oiOpen ? ' open' : ''}`}>
                {OTHER_INC.map(k => (
                  <div className="row" key={k}><label>{OTHER_INC_LABELS[k]}</label>
                    <NumInput small value={s.otherInc[k]} onChange={v => set('otherInc', { ...s.otherInc, [k]: v })} /></div>
                ))}
              </div>
              <div className="row comp"><label>Vacancy ({s.vacancy}%)</label><span className="comp-val amt-neg">−{money0(r.vacLoss)}</span></div>
              <div className="row comp subtotal"><label>Effective income</label><span className="comp-val">{money(r.effIncome)}</span></div>

              <div className="row"><label className="sec-label">Operating expenses</label></div>
              {EXPENSES.map(e => {
                const unit = s.units[e.id];
                const line = r.expLines.find(x => x.id === e.id)!;
                const units = e.mode === 'time'
                  ? [{ u: 'mo', label: '$/mo' }, { u: 'yr', label: '$/yr' }]
                  : [{ u: '$', label: '$/mo' }, { u: '%', label: '% rent' }];
                return (
                  <div className="row" key={e.id}>
                    <label>{e.label} <span className="exp-hint">{((unit === '%' || unit === 'yr') && line.monthly) ? `= ${money0(line.monthly)}/mo` : ''}</span></label>
                    <div className="inline-input">
                      <NumInput small fmt="raw" value={s.expenses[e.id]}
                        onChange={v => set('expenses', { ...s.expenses, [e.id]: v })} />
                      <UnitToggle options={units} value={unit}
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
                    </div>
                  </div>
                );
              })}
              <div className={`row util-head${utilOpen ? ' open' : ''}`} onClick={() => setUtilOpen(o => !o)}>
                <label><span className="chev">▶</span>Utilities</label>
                <span className="util-total">{money0(r.utilTotal)}/mo</span>
              </div>
              <div className={`util-body${utilOpen ? ' open' : ''}`}>
                {UTILS.map(k => (
                  <div className="row" key={k}><label>{UTIL_LABELS[k]}</label>
                    <div className="inline-input">
                      <NumInput small fmt="raw" value={s.utils[k]}
                        onChange={v => set('utils', { ...s.utils, [k]: v })} />
                      <UnitToggle options={[{ u: 'mo', label: '$/mo' }, { u: 'yr', label: '$/yr' }]} value={s.utilUnits[k]}
                        onChange={u => {
                          if (u === s.utilUnits[k]) return;
                          const v = u === 'yr' ? Math.round(s.utils[k] * 12) : Math.round(s.utils[k] / 12);
                          setS(prev => ({
                            ...prev,
                            utils: { ...prev.utils, [k]: v },
                            utilUnits: { ...prev.utilUnits, [k]: u as 'mo' | 'yr' },
                          }));
                        }} />
                    </div>
                  </div>
                ))}
                <div className="row" style={{ borderTop: '1px dashed var(--line)', marginTop: 4 }}>
                  <label style={{ fontWeight: 700, color: 'var(--ink)' }}>Utilities — monthly total</label>
                  <span className="util-total" style={{ fontWeight: 600 }}>{money0(r.utilTotal)}/mo</span>
                </div>
              </div>
              <div className="row comp subtotal"><label>Total operating expenses</label><span className="comp-val amt-neg">−{money0(r.opEx)}</span></div>
              <div className="row comp"><label style={{ fontWeight: 700, color: 'var(--ink)' }}>Net operating income</label><span className="comp-val">{money(r.noi)}</span></div>

              <div className="row"><label className="sec-label">Debt service</label></div>
              {debtRows.length
                ? debtRows.map(([l, v]) => <div className="row comp" key={l}><label>{l}</label><span className="comp-val amt-neg">−{money0(v)}</span></div>)
                : <div className="row comp"><label>No financing</label><span className="comp-val">$0</span></div>}
              <div className="row comp subtotal"><label>Cash flow</label>
                <span className={`comp-val ${r.cashFlow >= 0 ? 'amt-pos' : 'amt-neg'}`}>{money(r.cashFlow)}</span></div>
            </Card>
          </div>

          {/* RIGHT: RESULTS */}
          <div>
            <div className={`verdict ${vCls}`}>
              <div className="dot" />
              <div>
                <div className="v-title">{vTitle}</div>
                <div className="v-sub">{vSub}</div>
              </div>
            </div>

            <Card className="assume" title="Variable Assumptions" tag="Watch the numbers react" style={{ marginBottom: 16 }}>
              <SliderRow label="Vacancy" min={0} max={20} step={0.5} value={s.vacancy}
                onChange={v => set('vacancy', v)} output={stripZeros(pct(s.vacancy, 1))} />
              <SliderRow label="Annual rent growth" min={0} max={10} step={0.25} value={s.rentGrowth}
                onChange={v => set('rentGrowth', v)} output={stripZeros(pct(s.rentGrowth, 2))} />
              <SliderRow label="Annual expense growth" min={0} max={10} step={0.25} value={s.expGrowth}
                onChange={v => set('expGrowth', v)} output={stripZeros(pct(s.expGrowth, 2))} />
              <SliderRow label="Annual appreciation" min={0} max={10} step={0.25} value={s.appr}
                onChange={v => set('appr', v)} output={stripZeros(pct(s.appr, 2))} />
              <SliderRow label="Selling costs at exit" min={0} max={12} step={0.5} value={s.sellCost}
                onChange={v => set('sellCost', v)} output={stripZeros(pct(s.sellCost, 1))} />
            </Card>

            <div className="tiles">
              <Tile hero label="Cash-on-Cash Return" value={isFinite(r.coc) ? pct(r.coc, 1) : '—'}
                note="year-1 cash flow ÷ cash invested" valueClass={r.coc >= 0 ? 'pos' : 'neg'} />
              <Tile label="Monthly Cash Flow" value={money(r.cashFlow)} negative={r.cashFlow < 0}
                note="after all expenses & debt" valueClass={r.cashFlow >= 0 ? 'pos' : 'neg'} />
              <Tile label="DSCR" value={isFinite(r.dscr) ? r.dscr.toFixed(2) : '∞'}
                note="NOI ÷ debt service · lenders want ≥ 1.25"
                valueClass={r.dscr >= 1.25 || !isFinite(r.dscr) ? 'pos' : r.dscr >= 1 ? '' : 'neg'} />
              <Tile label="5-Year Total ROI" value={isFinite(r.roi5) ? pct(r.roi5, 0) : '—'}
                note="cash flow + equity + appreciation" valueClass={r.roi5 >= 0 ? 'pos' : 'neg'} />
            </div>

            <div className="checks">
              <div className={`check ${r.onePct >= 1 ? 'pass' : 'fail'}`}>
                <span className="mark">{r.onePct >= 1 ? '✓' : '✗'}</span>1% Rule <span className="val">{pct(r.onePct, 2)}</span></div>
              <div className={`check ${r.grm <= 12 ? 'pass' : 'fail'}`}>
                <span className="mark">{r.grm <= 12 ? '✓' : '✗'}</span>GRM <span className="val">{isFinite(r.grm) ? r.grm.toFixed(1) + '×' : '—'}</span></div>
              <div className="check pass"><span className="mark">$</span>Cash Needed <span className="val">{money0(r.cashInvested)}</span></div>
            </div>

            <Card title="5-Year Pro-Forma" tag="Annual" className="pf-card">
              <div className="pf-scroll">
                <table className="pf">
                  <thead><tr><th></th>{r.years.map(y => <th key={y.y}>Year {y.y}</th>)}</tr></thead>
                  <tbody>
                    <tr className="section"><td colSpan={6}>Operations</td></tr>
                    {([
                      ['Gross rent', (y: any) => y.yRent, ''],
                      ['Vacancy loss', (y: any) => -y.yVac, ''],
                      ['Operating expenses', (y: any) => -y.yOpEx, ''],
                      ['NOI', (y: any) => y.yNOI, 'strong'],
                      ['Debt service', (y: any) => -y.yDebt, ''],
                      ['Cash flow', (y: any) => y.yCF, 'strong'],
                      ['Cumulative cash flow', (y: any) => y.cumCF, ''],
                    ] as [string, (y: any) => number, string][]).map(([label, fn, cls]) => (
                      <tr key={label} className={cls}><td>{label}</td>
                        {r.years.map(y => { const v = fn(y); return <td key={y.y} className={v < 0 ? 'amt-neg' : ''}>{money(v)}</td>; })}</tr>
                    ))}
                    <tr className="section"><td colSpan={6}>Equity</td></tr>
                    {([
                      ['Property value', (y: any) => y.value, ''],
                      ['Total loan balances', (y: any) => y.bal, ''],
                      ['Equity', (y: any) => y.equity, 'strong'],
                    ] as [string, (y: any) => number, string][]).map(([label, fn, cls]) => (
                      <tr key={label} className={cls}><td>{label}</td>
                        {r.years.map(y => { const v = fn(y); return <td key={y.y} className={v < 0 ? 'amt-neg' : ''}>{money(v)}</td>; })}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card title="If You Sold in Year 5" tag="Exit Analysis">
              <div className="exit-grid">
                <div className="exit-box"><div className="e-label">Net Sale Proceeds</div><div className="e-value">{money(r.proceeds)}</div></div>
                <div className="exit-box"><div className="e-label">Total Profit</div>
                  <div className="e-value" style={{ color: r.totalProfit >= 0 ? 'var(--accent-strong)' : 'var(--neg)' }}>{money(r.totalProfit)}</div></div>
                <div className="exit-box"><div className="e-label">Annualized Return</div><div className="e-value">{isFinite(r.annualized) ? pct(r.annualized, 1) : '—'}</div></div>
              </div>
              <p className="footnote" style={{ marginTop: 12 }}>Net sale proceeds = year-5 value, less selling costs of {stripZeros(pct(s.sellCost, 1))}, less payoff of all remaining loan balances. Total profit = net proceeds + 5 years of accumulated cash flow − cash invested.</p>
            </Card>

            <p className="footnote">Estimates for screening purposes only — verify taxes, insurance and rents locally before making offers. Percentage-based expenses are calculated on gross scheduled rent. NOI here includes the capex reserve as an operating cost, so the DSCR shown is the conservative view (many lenders exclude capex, which would show a higher ratio).</p>
          </div>
        </div>
      </section>

      {/* ---------- scope of work ---------- */}
      <section className={`pane${tab === 'sow' ? ' on' : ''}`}>
        <div className="sow-toolbar">
          <div className="left">
            <button className="btn primary" onClick={downloadSow}>⬇ Download for contractor</button>
          </div>
          <div className="sow-total-chip"><span className="lbl">Rehab total</span><span className="val">{money0(sowTotal)}</span></div>
        </div>
        <div>
          {SOW_SECTIONS.map(sec => {
            const items = s.sow.filter(i => i.sec === sec.id);
            const subtotal = items.reduce((t, i) => t + (i.cost || 0), 0);
            return (
              <div className="card sow-section" key={sec.id}>
                <details style={{ border: 'none', margin: 0, background: 'none' }} className="collapse" open={items.length > 0 || undefined}>
                  <summary style={{ padding: '13px 18px' }}>
                    <span><span className="chev">▶</span>&nbsp; <span style={{ fontFamily: 'var(--display)', fontSize: 14.5, color: 'var(--ink)' }}>{sec.label}</span></span>
                    <span className="sum-val">{money0(subtotal)}</span></summary>
                  <div className="inner" style={{ padding: '4px 18px 14px' }}>
                    <div className="sow-items">
                      {items.map((item, i) => (
                        <div className="sow-item" key={i}>
                          <input type="text" placeholder="Description (e.g. replace cabinets & counters)" value={item.desc}
                            autoComplete="off" onChange={ev => setSowItem(item, { desc: ev.target.value })} />
                          <NumInput value={item.cost} onChange={v => setSowItem(item, { cost: v })} placeholder="Cost" className="num" />
                          <button className="del" title="Remove"
                            onClick={() => setS(prev => ({ ...prev, sow: prev.sow.filter(x => x !== item) }))}>✕</button>
                        </div>
                      ))}
                    </div>
                    <button className="btn sow-add-btn"
                      onClick={() => setS(prev => ({ ...prev, sow: [...prev.sow, { sec: sec.id, desc: '', cost: 0 }] }))}>+ Add item</button>
                  </div>
                </details>
              </div>
            );
          })}
        </div>
        <div className="card sow-cat-summary">
          <h2>Totals by Section <span className="tag">Summary</span></h2>
          <div className="body">
            <table>
              <tbody>
                {SOW_SECTIONS
                  .map(sec => [sec.label, s.sow.filter(i => i.sec === sec.id).reduce((t, i) => t + (i.cost || 0), 0)] as [string, number])
                  .filter(([, v]) => v > 0)
                  .map(([l, v]) => <tr key={l}><td>{l}</td><td>{money0(v)}</td></tr>)}
                <tr><td>Total rehab budget</td><td>{money0(sowTotal)}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
        <p className="footnote">The Scope of Work saves with the deal. While it has line items, the analyzer&apos;s rehab field is locked to this total; delete all items to enter rehab manually again. The download produces a clean document you can email or print for contractor bids.</p>
      </section>

      {/* ---------- voice modal ---------- */}
      <div className={`voice-modal${voiceMode !== 'closed' ? ' show' : ''}`}>
        <div className="voice-card">
          <h3>{voiceMode === 'listening' ? <><span className="rec-dot" />Listening…</> : 'Voice fill — applied'}</h3>
          {voiceMode === 'listening' &&
            <p className="voice-hint">Say your numbers naturally, e.g. “purchase price 320,000 … rent 2,800 … down payment 20 percent … property tax 4,200 a year … insurance 150 a month … vacancy 7 percent”. Tap <strong>Stop &amp; apply</strong> when you&apos;re done.</p>}
          <div className="voice-transcript">
            {voiceFinal}<span className="interim">{voiceInterim || (voiceMode === 'listening' && !voiceFinal ? '…' : '')}</span>
          </div>
          {voiceMode === 'done' && (
            <div className="voice-results">
              {voiceApplied.length
                ? voiceApplied.map(([f, v], i) => <div className="vr" key={i}><span className="f">{f}</span><span className="v">{v}</span></div>)
                : <div className="empty-note">No fields recognized — try naming the field then the number, e.g. “rent 2,500”.</div>}
            </div>
          )}
          <div className="voice-actions">
            {voiceMode === 'listening' &&
              <button className="btn primary" onClick={() => recogRef.current?.stop()}>■ Stop &amp; apply</button>}
            <button className="btn ghost" onClick={() => {
              if (voiceMode === 'listening') { cancelledRef.current = true; recogRef.current?.stop(); }
              else setVoiceMode('closed');
            }}>{voiceMode === 'listening' ? 'Cancel' : 'Close'}</button>
          </div>
        </div>
      </div>
    </>
  );
}
