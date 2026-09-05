'use client';

/* Bay Area Flip Analyzer — four tabs over one FlipState, laid out as sheets.

   The reading task here is scanning columns of figures, not filling in a form,
   so every group is a dense ruled table rather than a stack of airy input rows.
   Tab 1 is the only one you type into; tabs 2 and 3 are pure derivations of it.
   Tab 4 writes back into the rehab block on request and flags divergence when
   you later override it by hand.

   Two storage keys, deliberately:
   · flipDeals.v1   — saved deals, synced per-account under kind 'flip'
   · flipCatalog.v1 — the rehab price catalog, SHARED across every deal, so a
                      corrected price propagates instead of needing re-fixing.
   A deal owns what is specific to it (what is checked, quantity overrides) and
   never a copy of the prices. */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  defaultFlipState, computeFlip, computeGrid, solveMAO, seventyRule, buildSensitivity,
  verdictFor, SCENARIO_KEYS, ACQ_ITEMS, HOLD_ITEMS, SELL_FLAT_ITEMS,
  CATALOG, computeChecklist, seededQty, citiesByCounty, findCity,
  money, money0, pct,
  type FlipState, type ScenarioKey, type CostLine, type QtyContext, type CatalogItem,
  type FlipResult,
} from '@reit/core';
import { NumInput, Switch, UnitToggle, loadJSON, saveJSON, openReportWindow } from '../../components/ui';
import { buildFlipReport, buildScopeOfWork } from '../../components/flipReport';
import { AddressInput } from '../../components/AddressInput';
import { toast } from '../../components/toast';
import { useAuth } from '../../components/auth';
import { dealStore, mergeDeals } from '../../lib/dealsync';

const STORE_KEY = 'flipDeals.v1';
const DRAFT_KEY = 'flipCalc.draft.v1';
const CATALOG_KEY = 'flipCatalog.v1';

/* the account-side store for this tool — 'flip' is named once, here */
const cloud = dealStore<FlipState>('flip');

type TabId = 'assumptions' | 'model' | 'sensitivity' | 'checklist';

/* ------------------------------------------------------------ normalization */

function normalizeFlip(d: any): FlipState {
  const base = defaultFlipState();
  if (!d || typeof d !== 'object') return base;
  return {
    ...base, ...d,
    name: d.name || '',
    prop: { ...base.prop, ...(d.prop || {}), urls: (d.prop?.urls || []).map((u: any) => ({ label: u.label || '', url: u.url || '' })) },
    arv: { ...base.arv, ...(d.arv || {}) },
    rehab: { ...base.rehab, ...(d.rehab || {}) },
    acq: { ...base.acq, ...(d.acq || {}) },
    hold: { ...base.hold, ...(d.hold || {}) },
    sell: { ...base.sell, ...(d.sell || {}) },
    checked: d.checked || {},
    qty: d.qty || {},
  };
}

/* ------------------------------------------------------------------ helpers */

/** Diverging heat scale centred on $0 — the sign of a cell reads before the
    number does. Returns a matching text colour so every cell stays legible. */
function heatColor(v: number, min: number, max: number) {
  const MID = [242, 240, 234], POS = [23, 92, 78], NEG = [166, 71, 36];
  const to = v >= 0 ? POS : NEG;
  const span = v >= 0 ? max : min;
  const t = span !== 0 ? Math.min(1, Math.abs(v / span)) : 0;
  const c = MID.map((m, i) => Math.round(m + (to[i] - m) * t));
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

/* ---------------------------------------------------- sheet row primitives */

const Band = ({ children, tag, span = 3 }: { children: React.ReactNode; tag?: string; span?: number }) => (
  <tr className="band"><td colSpan={span}>{children}{tag && <span className="tag">{tag}</span>}</td></tr>
);
const Sec = ({ children, span = 3 }: { children: React.ReactNode; span?: number }) => (
  <tr className="sec"><td colSpan={span}>{children}</td></tr>
);

/** A section-wide guidance row, sitting directly under its band header. */
const G = ({ children }: { children: React.ReactNode }) => (
  <tr className="guide"><td colSpan={4}>{children}</td></tr>
);

/** An editable row: label, the input, a static unit, then guidance. The note
    cell is only shown on tables marked `with-notes`. */
function R({ label, hint, unit, children, ctl, note }: {
  label: React.ReactNode; hint?: string; unit?: React.ReactNode;
  children?: React.ReactNode; ctl?: React.ReactNode; note?: React.ReactNode;
}) {
  return (
    <tr>
      <td className="lb">{label}{hint && <span className="sub">{hint}</span>}</td>
      {ctl ? <td className="ctl" colSpan={2}>{ctl}</td> : <>
        <td className="n">{children}</td>
        <td className="u">{unit}</td>
      </>}
      <td className="note">{note}</td>
    </tr>
  );
}

/** A read-only computed row. */
function V({ label, hint, value, unit, cls, note }: {
  label: React.ReactNode; hint?: string; value: React.ReactNode;
  unit?: React.ReactNode; cls?: string; note?: React.ReactNode;
}) {
  return (
    <tr className={cls}>
      <td className="lb">{label}{hint && <span className="sub">{hint}</span>}</td>
      <td className="n">{value}</td>
      <td className="u">{unit}</td>
      <td className="note">{note}</td>
    </tr>
  );
}

const Money = ({ value, onChange }: { value: number; onChange: (n: number) => void }) =>
  <NumInput value={value} onChange={onChange} />;
const Num = ({ value, onChange }: { value: number; onChange: (n: number) => void }) =>
  <NumInput fmt="raw" value={value} onChange={onChange} />;

/* ================================================================== the page */

export default function FlipPage() {
  const [s, setS] = useState<FlipState>(defaultFlipState);
  const [catalogPrices, setCatalogPrices] = useState<Record<string, number>>({});
  const [tab, setTab] = useState<TabId>('assumptions');
  const [sel, setSel] = useState<{ a: ScenarioKey; r: ScenarioKey }>({ a: 'base', r: 'base' });
  const [openSecs, setOpenSecs] = useState<Record<string, boolean>>({ demo: true });
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [savedDeals, setSavedDeals] = useState<FlipState[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const menuWrapRef = useRef<HTMLDivElement>(null);
  const { user } = useAuth();
  const syncedFor = useRef<string | null>(null);

  const set = <K extends keyof FlipState>(k: K, v: FlipState[K]) => setS(p => ({ ...p, [k]: v }));
  const setProp = <K extends keyof FlipState['prop']>(k: K, v: FlipState['prop'][K]) =>
    setS(p => ({ ...p, prop: { ...p.prop, [k]: v } }));
  const setMap = (group: 'acq' | 'hold' | 'sell', id: string, v: number) =>
    setS(p => ({ ...p, [group]: { ...p[group], [id]: v } }));
  const setArv = (k: ScenarioKey, v: number) => setS(p => ({ ...p, arv: { ...p.arv, [k]: v } }));
  const setRehab = (k: ScenarioKey, v: number) => setS(p => ({ ...p, rehab: { ...p.rehab, [k]: v } }));

  /* ---------- hydrate ---------- */
  useEffect(() => {
    const draft = loadJSON<any>(DRAFT_KEY);
    if (draft && isFinite(draft.price)) setS(normalizeFlip(draft));
    setSavedDeals((loadJSON<any[]>(STORE_KEY) || []).map(normalizeFlip));
    setCatalogPrices(loadJSON<Record<string, number>>(CATALOG_KEY) || {});
    setHydrated(true);
  }, []);

  useEffect(() => { if (hydrated) saveJSON(DRAFT_KEY, s); }, [s, hydrated]);
  useEffect(() => { if (hydrated) saveJSON(CATALOG_KEY, catalogPrices); }, [catalogPrices, hydrated]);

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

  useEffect(() => {
    const onDoc = (ev: MouseEvent) => {
      if (!menuWrapRef.current?.contains(ev.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('click', onDoc);
    return () => document.removeEventListener('click', onDoc);
  }, []);

  /* ---------- derived ---------- */
  const city = findCity(s.citySlug);
  const sqft = s.prop.sqft;
  const ctx: QtyContext = useMemo(() => ({
    sqft: s.prop.sqft, beds: s.prop.beds, baths: s.prop.baths,
    halfBaths: s.prop.halfBaths, stories: s.prop.stories, garageBays: s.prop.garageBays,
  }), [s.prop]);

  const checklist = useMemo(
    () => computeChecklist(s.checked, s.qty, catalogPrices, ctx),
    [s.checked, s.qty, catalogPrices, ctx]);

  const rBase = useMemo(() => computeFlip(s, 'base', 'base'), [s]);
  /* the P&L shows all three rehab scenarios side by side at the selected ARV */
  const cols = useMemo(() => SCENARIO_KEYS.map(rk => computeFlip(s, sel.a, rk)), [s, sel.a]);
  const grid = useMemo(() => computeGrid(s), [s]);
  const sens = useMemo(() => buildSensitivity(s, 7), [s]);
  const mao = useMemo(() => solveMAO(s), [s]);
  const verdict = verdictFor(rBase, s);

  /* Screening benchmarks. These are rules of thumb, not rules — they exist so a
     number on screen carries a sense of whether it is normal for the Bay Area. */
  const band = (v: number, good: number, ok: number, labels: [string, string, string]) =>
    v >= good ? <span className="ok">{labels[0]}</span>
    : v >= ok ? <span className="warn">{labels[1]}</span>
    : <span className="bad">{labels[2]}</span>;
  const spreadVerdict = band(rBase.grossSpread, 25, 20,
    ['comfortably in range', 'thin, but workable', 'too thin for the risk']);
  const rehabVerdict = rBase.rehabPsf <= 160
    ? <span className="ok">cosmetic territory</span>
    : rBase.rehabPsf <= 350
      ? <span className="ok">gut territory</span>
      : <span className="warn">above a normal gut — check the scope</span>;
  const holdVerdict = rBase.holdMonths <= 8
    ? <span className="ok">normal</span>
    : rBase.holdMonths <= 11
      ? <span className="warn">long — carry costs compound</span>
      : <span className="bad">very long for a flip</span>;
  const sellVerdict = rBase.sellPctOfSale <= 9
    ? <span className="ok">in range</span>
    : <span className="warn">above the usual 7–9%</span>;
  const selIdx = SCENARIO_KEYS.indexOf(sel.r);

  const diverged = s.rehabSource === 'checklist' && checklist.checkedCount > 0 &&
    (Math.abs(checklist.base - s.rehab.base) > 1 ||
     Math.abs(checklist.low - s.rehab.low) > 1 ||
     Math.abs(checklist.high - s.rehab.high) > 1);

  /* ---------- actions ---------- */
  const setAddress = (v: string) =>
    setS(p => ({ ...p, name: v.trim(), prop: { ...p.prop, address: v } }));
  const dealTitle = (d: FlipState) => d.prop.address?.trim() || d.name || 'Untitled';

  function applyCity(slug: string) {
    const c = findCity(slug);
    setS(p => ({
      ...p, citySlug: slug,
      ...(c ? {
        taxRatePct: c.taxRatePct,
        transferPayer: c.payer,
        retrofit: c.retrofit.reduce((a, x) => a + x.cost, 0),
      } : {}),
    }));
    if (c) toast(`${c.name} preset applied — every value stays editable`);
  }

  function pushChecklist() {
    setS(p => ({
      ...p, rehabSource: 'checklist',
      rehab: { low: Math.round(checklist.low), base: Math.round(checklist.base), high: Math.round(checklist.high) },
    }));
    toast('Rehab budget updated from the checklist');
  }

  function saveDeal() {
    if (!s.prop.address.trim()) { toast('Enter the property address first — it names the deal'); return; }
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

  const newDeal = () => { setS(defaultFlipState()); setMenuOpen(false); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const reset = () => { if (confirm('Reset every input to defaults?')) setS(defaultFlipState()); };
  const report = () => openReportWindow(buildFlipReport(s), '', () => toast('Allow pop-ups to open the report'));
  const sow = () => openReportWindow(buildScopeOfWork(s, catalogPrices), '', () => toast('Allow pop-ups to open the scope'));

  const setCatalogPrice = (id: string, k: 'low' | 'base' | 'high', v: number) =>
    setCatalogPrices(p => ({ ...p, [`${id}.${k}`]: v }));
  const priceOf = (i: CatalogItem, k: 'low' | 'base' | 'high') =>
    catalogPrices[`${i.id}.${k}`] !== undefined ? catalogPrices[`${i.id}.${k}`] : i[k];
  const qtyOf = (i: CatalogItem) => s.qty[i.id] !== undefined ? s.qty[i.id] : seededQty(i, ctx);

  /* one P&L row across the three scenario columns */
  const PL = ({ label, pick, fmt = paren, cls, hint }: {
    label: React.ReactNode; pick: (r: FlipResult) => number;
    fmt?: (n: number) => string; cls?: string; hint?: string;
  }) => (
    <tr className={cls}>
      <td className="lb">{label}{hint && <span className="sub">{hint}</span>}</td>
      {cols.map((c, i) => (
        <td key={i} className={`n${i === selIdx ? ' on' : ''}${fmt === paren && pick(c) !== 0 ? ' neg' : ''}`}>
          {fmt(pick(c))}
        </td>
      ))}
    </tr>
  );

  /* an expandable cost group — detail rows come from the selected column */
  const Fold = ({ id, label, pick, lines }: {
    id: string; label: string; pick: (r: FlipResult) => number; lines: CostLine[];
  }) => {
    const open = !!expanded[id];
    return (
      <>
        <tr>
          <td className="lb">
            <button className="exp" onClick={() => setExpanded(p => ({ ...p, [id]: !p[id] }))}>
              {open ? '▾' : '▸'}
            </button>{label}
          </td>
          {cols.map((c, i) => (
            <td key={i} className={`n neg${i === selIdx ? ' on' : ''}`}>{paren(pick(c))}</td>
          ))}
        </tr>
        {open && lines.filter(l => l.amount !== 0).map((l, i) => (
          <tr className="detail" key={i}>
            <td className="lb">{l.label}</td>
            <td className="n" colSpan={3}>{money0(l.amount)}</td>
          </tr>
        ))}
      </>
    );
  };

  /* ================================================================= render */
  return (
    <>
      <div className="deal-head">
        <div className="deal-topline">
          <div className="deal-title-wrap" ref={menuWrapRef}>
            <div className="addr-slot">
              <AddressInput value={s.prop.address} onChange={setAddress}
                placeholder="Property address — start typing to search" />
            </div>
            <button className="caret-btn" title="Switch deal"
              onClick={ev => { ev.stopPropagation(); setMenuOpen(o => !o); }}>▾</button>
            <div className={`deal-menu${menuOpen ? ' open' : ''}`}>
              <div className="dm-item new" onClick={newDeal}>＋ New deal</div>
              {!savedDeals.length && <div className="dm-empty">No saved flips yet — hit “Save deal” to keep one here.</div>}
              {[...savedDeals].sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || '')).map(d => {
                const dr = computeFlip(d, 'base', 'base');
                return (
                  <div className="dm-item" key={d.name}
                    onClick={() => { setS(normalizeFlip(d)); setMenuOpen(false); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
                    <div>
                      <div className="dm-n">{dealTitle(d)}</div>
                      <div className="dm-m">{money0(d.price)} · {money(dr.netProfit)} profit · {dr.roi.toFixed(0)}% ROI</div>
                    </div>
                    <button className="dm-del" title="Delete"
                      onClick={ev => { ev.stopPropagation(); deleteDeal(d.name); }}>✕</button>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="deal-actions">
            <button className="btn" onClick={report} title="Open a print-ready deal report">⬇ PDF</button>
            <button className="btn primary" onClick={saveDeal}>Save deal</button>
            <button className="btn ghost" onClick={reset}>Reset</button>
          </div>
        </div>

        <div className="prop-chips">
          <span className="p-chip">Gross spread <b>{pct(rBase.grossSpread)}</b></span>
          <span className="p-chip">ARV <b>{money0(rBase.arvPsf)}/sf</b></span>
          <span className="p-chip">Purchase <b>{money0(rBase.pricePsf)}/sf</b></span>
          <span className="p-chip">Rehab <b>{money0(rBase.rehabPsf)}/sf</b></span>
          <span className="p-chip">Hold <b>{rBase.holdMonths.toFixed(1)} mo</b></span>
          <span className="p-chip">Peak cash <b>{money0(rBase.peakCash)}</b></span>
        </div>
      </div>

      <nav className="tabs">
        <button className={`tab${tab === 'assumptions' ? ' on' : ''}`} onClick={() => setTab('assumptions')}>Assumptions</button>
        <button className={`tab${tab === 'model' ? ' on' : ''}`} onClick={() => setTab('model')}>
          Deal Model <span className="badge">{compact(rBase.netProfit)}</span></button>
        <button className={`tab${tab === 'sensitivity' ? ' on' : ''}`} onClick={() => setTab('sensitivity')}>Sensitivity</button>
        <button className={`tab${tab === 'checklist' ? ' on' : ''}`} onClick={() => setTab('checklist')}>
          Cost Checklist <span className="badge">{checklist.checkedCount || '0'}</span></button>
      </nav>

      {/* ============================================ TAB 1 — ASSUMPTIONS */}
      <section className={`pane${tab === 'assumptions' ? ' on' : ''}`}>
        {city?.note && <div className="notice warn"><div><b>{city.name}</b>{city.note}</div></div>}

        <div className="sheet one"><table className="ss with-notes">
          {/* table-layout is fixed, so the widths have to come from here — the
              first row is a full-width band and would otherwise set them */}
          <colgroup>
            <col style={{ width: 228 }} /><col style={{ width: 104 }} />
            <col style={{ width: 54 }} /><col />
          </colgroup>
          <tbody>

          <Band span={4} tag={`${pct(rBase.grossSpread)} gross spread`}>Property &amp; deal</Band>
          <R label="City" note="Swings hugely by city — most of San Mateo and Santa Clara sit at the county floor; Oakland and Berkeley do not." ctl={
            <select className="sel-city" value={s.citySlug} onChange={ev => applyCity(ev.target.value)}>
              <option value="">Not listed — enter rates manually</option>
              {citiesByCounty().map(g => (
                <optgroup key={g.county} label={`${g.county} County`}>
                  {g.cities.map(c => <option key={c.slug} value={c.slug}>{c.name}</option>)}
                </optgroup>
              ))}
            </select>} />
          <R label="Square feet" note="Living area from the tax record. Every per-foot figure divides by it.">
            <Money value={sqft} onChange={v => setProp('sqft', v)} /></R>
          <R label="Beds / full baths / half" note="Drives checklist quantities — a 4/3 prices three showers, not one." ctl={
            <div className="inline-input" style={{ justifyContent: 'flex-end', gap: 3 }}>
              <NumInput fmt="raw" small value={s.prop.beds} onChange={v => setProp('beds', v)} />
              <NumInput fmt="raw" small value={s.prop.baths} onChange={v => setProp('baths', v)} />
              <NumInput fmt="raw" small value={s.prop.halfBaths} onChange={v => setProp('halfBaths', v)} />
            </div>} />
          <R label="Stories / garage bays" note="Estimates the foundation perimeter for seismic work and gutters." ctl={
            <div className="inline-input" style={{ justifyContent: 'flex-end', gap: 3 }}>
              <NumInput fmt="raw" small value={s.prop.stories} onChange={v => setProp('stories', v)} />
              <NumInput fmt="raw" small value={s.prop.garageBays} onChange={v => setProp('garageBays', v)} />
            </div>} />
          <R label="Year built" note="Pre-1980 assume asbestos and lead; pre-1950 assume knob-and-tube and an unbolted foundation." ctl={
            <input className="num small" value={s.prop.year} autoComplete="off"
              onChange={ev => setProp('year', ev.target.value)} />} />

          <Sec span={4}>Purchase &amp; after-repair value</Sec>
          <R label="Purchase price" unit={psf(s.price, sqft)}
            note={<>70% rule says {money0(seventyRule(s))}; your own underwrite says {money0(mao)}.</>}>
            <Money value={s.price} onChange={v => set('price', v)} /></R>
          <R label="ARV — low" unit={psf(s.arv.low, sqft)}
            note="What it sells for in a slow month with a picky appraiser.">
            <Money value={s.arv.low} onChange={v => setArv('low', v)} /></R>
          <R label="ARV — base" unit={psf(s.arv.base, sqft)}
            note="Closed comps within half a mile and 90 days, adjusted to your finish.">
            <Money value={s.arv.base} onChange={v => setArv('base', v)} /></R>
          <R label="ARV — high" unit={psf(s.arv.high, sqft)}
            note="Top of the range if the finish lands. Never underwrite to it.">
            <Money value={s.arv.high} onChange={v => setArv('high', v)} /></R>
          <V cls="tot" label="Gross spread at base ARV" value={money0(s.arv.base - s.price)}
            unit={pct(rBase.grossSpread)}
            note={<><b>Target 25–30% of ARV.</b> You are at {pct(rBase.grossSpread)} — {spreadVerdict}.</>} />

          <Band span={4} tag={s.rehabSource === 'checklist' ? 'from checklist' : 'manual'}>Rehab budget</Band>
          <G>Bay Area pricing: cosmetic <b>$90–160/sf</b>, full gut <b>$200–350/sf</b>. Yours is {money0(rBase.rehabPsf)}/sf at base — {rehabVerdict}. Build it on the Cost Checklist tab and push it here.</G>
          <R label="Rehab — low" unit={psf(s.rehab.low, sqft)}
            note="Everything goes right: no dry rot, no surprises behind the walls.">
            <Money value={s.rehab.low} onChange={v => setRehab('low', v)} /></R>
          <R label="Rehab — base" unit={psf(s.rehab.base, sqft)}
            note="What you would tell a partner the job costs. The deal lives on it.">
            <Money value={s.rehab.base} onChange={v => setRehab('base', v)} /></R>
          <R label="Rehab — high" unit={psf(s.rehab.high, sqft)}
            note="You open the walls and find why it was cheap. Honest case pre-1950.">
            <Money value={s.rehab.high} onChange={v => setRehab('high', v)} /></R>
          <R label="Contingency" unit="%"
            note="10% on a cosmetic scope, 15–20% on a gut or anything pre-1950.">
            <Num value={s.contingencyPct} onChange={v => set('contingencyPct', v)} /></R>
          <V cls="tot" label="Base rehab incl. contingency" value={money0(rBase.rehabTotal)}
            unit={psf(rBase.rehabTotal, sqft)}
            note={checklist.checkedCount > 0
              ? `Checklist has ${checklist.checkedCount} items at ${money0(checklist.base)} base.`
              : 'Nothing checked on the Cost Checklist yet.'} />

          <Band span={4} tag={`${rBase.holdMonths.toFixed(1)} mo hold`}>Timeline</Band>
          <G>Every extra month costs holding <b>and</b> interest at once. Bay Area flips run <b>5–8 months</b> door to door. Yours is {rBase.holdMonths.toFixed(1)} — {holdVerdict}.</G>
          <R label="Rehab duration" unit="months"
            note="Fold permits in. Bay Area plan check adds 2–4 months before a shovel moves.">
            <Num value={s.rehabMonths} onChange={v => set('rehabMonths', v)} /></R>
          <R label="Days on market" unit="days"
            note="List to accepted offer. Bay Area ran 15–25 days through 2026.">
            <Num value={s.domDays} onChange={v => set('domDays', v)} /></R>
          <R label="Escrow period" unit="days"
            note="Accepted offer to close. 21–30 days standard; a cash buyer can do 14.">
            <Num value={s.escrowDays} onChange={v => set('escrowDays', v)} /></R>
          <R label="Schedule overrun" unit="months"
            note="Add months to see what a slip costs. The cheapest stress test here.">
            <Num value={s.overrunMonths} onChange={v => set('overrunMonths', v)} /></R>
          <V cls="tot" label="Total hold period" value={rBase.holdMonths.toFixed(1)} unit="months"
            note={<>A one-month slip costs roughly {money0(rBase.holdMonthly + rBase.interest / Math.max(1, rBase.holdMonths))} in holding plus interest.</>} />

          <Band span={4} tag={money0(rBase.acqTotal)}>Acquisition costs</Band>
          <G><b>California sellers deliver a disclosure package before offers</b> — TDS, SPQ, NHD and usually pest, home and roof reports — so those lines default to $0. What the reports find belongs in rehab, not here.</G>
          {ACQ_ITEMS.map(i => (
            <R key={i.id} label={i.label} note={i.note}>
              <Money value={s.acq[i.id] ?? 0} onChange={v => setMap('acq', i.id, v)} /></R>
          ))}
          {rBase.acqLines.filter(l => l.derived && l.amount !== 0).map((l, i) => (
            <V key={i} label={l.label} value={money0(l.amount)} unit="auto"
              note="Computed from the city preset and who pays." />
          ))}
          <V cls="tot" label="Total acquisition" value={money0(rBase.acqTotal)}
            unit={pct(s.price > 0 ? rBase.acqTotal / s.price * 100 : 0)}
            note="0.5–1.5% of price in CA once the seller covers reports. Points live under Financing." />

          <Band span={4} tag={`${money0(rBase.holdMonthly)}/mo`}>Holding costs</Band>
          <R label="Levied property tax rate" unit="%"
            note="1% Prop 13 base plus local bonds. A published “effective rate” understates this by a third.">
            <Num value={s.taxRatePct} onChange={v => set('taxRatePct', v)} /></R>
          <R label="Prior assessed value"
            note="From the county assessor. Only used to break out the supplemental bill.">
            <Money value={s.priorAssessed} onChange={v => set('priorAssessed', v)} /></R>
          <R label="Builder's risk insurance"
            note="Covers the structure while it is open. 1–3% of rehab, or $150–300/mo." ctl={
            <div className="inline-input" style={{ justifyContent: 'flex-end', gap: 3 }}>
              <NumInput fmt="raw" small value={s.builderRisk} onChange={v => set('builderRisk', v)} />
              <UnitToggle options={[{ u: '$', label: '$/mo' }, { u: '%', label: '% rehab' }]}
                value={s.builderRiskUnit} onChange={u => set('builderRiskUnit', u as '$' | '%')} />
            </div>} />
          <Sec span={4}>Monthly operating — enter $/mo, total at right</Sec>
          {HOLD_ITEMS.map(i => (
            <R key={i.id} label={i.label} note={i.note} unit={money0((s.hold[i.id] ?? 0) * rBase.holdMonths)}>
              <Money value={s.hold[i.id] ?? 0} onChange={v => setMap('hold', i.id, v)} /></R>
          ))}
          <V label="Property tax — reassessed" value={money0(rBase.propertyTax)} unit="auto"
            note="Prop 13 resets assessed value to your purchase price at close." />
          {rBase.supplementalTax > 0 &&
            <V label="of which supplemental bill" value={money0(rBase.supplementalTax)} unit="incl."
              note="Arrives weeks after close and surprises most first-timers." />}
          <V cls="tot" label={`Total over ${rBase.holdMonths.toFixed(1)} months`} value={money0(rBase.holdTotal)}
            note={<>{pct(s.arv.base > 0 ? rBase.holdTotal / s.arv.base * 100 : 0)} of ARV. Runs whether or not anyone is working on the house.</>} />

          <Band span={4} tag={`${pct(rBase.sellPctOfSale)} of sale`}>Selling costs</Band>
          <G>All-in Bay Area selling costs run <b>7–9% of sale price</b>. Yours are {pct(rBase.sellPctOfSale)} — {sellVerdict}. If you list it yourself, that commission is income to you, not a cost.</G>
          <R label="Listing commission" unit="%"
            note="2.5% standard. Your own listing side is income, not an expense.">
            <Num value={s.listCommPct} onChange={v => set('listCommPct', v)} /></R>
          <R label="Buyer agent commission" unit="%"
            note="Negotiable since the NAR settlement, but 2.5% still gets it shown.">
            <Num value={s.buyCommPct} onChange={v => set('buyCommPct', v)} /></R>
          <R label="City transfer tax paid by"
            note={city ? `${city.name} custom pre-filled — on a large bill this is negotiable.`
                       : 'Local custom varies. Pick a city above to pre-fill it.'} ctl={
            <UnitToggle
              options={[{ u: 'seller', label: 'Seller' }, { u: 'split', label: 'Split' }, { u: 'buyer', label: 'Buyer' }]}
              value={s.transferPayer}
              onChange={u => set('transferPayer', u as FlipState['transferPayer'])} />} />
          {SELL_FLAT_ITEMS.map(i => (
            <R key={i.id} label={i.label} note={i.note}>
              <Money value={s.sell[i.id] ?? 0} onChange={v => setMap('sell', i.id, v)} /></R>
          ))}
          <R label="Staging — per month" note="$1–1.5k/mo through days on market plus escrow.">
            <Money value={s.stagingMo} onChange={v => set('stagingMo', v)} /></R>
          <R label="Retrofit compliance"
            note={city ? `Required in ${city.name}: ${city.retrofit.map(x => x.label).join(', ')}.`
                       : 'Lateral certificate, water heater strapping, alarms — varies by city.'}>
            <Money value={s.retrofit} onChange={v => set('retrofit', v)} /></R>
          <R label="Seller concessions" unit="%"
            note="Credits after the buyer’s inspection. 0.5% is light; 1% safer on an older house.">
            <Num value={s.concessionsPct} onChange={v => set('concessionsPct', v)} /></R>
          <R label="CA 3.33% withholding"
            note="Credited against the tax below. Moves cash timing, never profit." ctl={
            <Switch checked={s.withholdingOn} onChange={v => set('withholdingOn', v)} />} />
          {rBase.sellLines.filter(l => l.derived && l.amount !== 0).map((l, i) => (
            <V key={i} label={l.label} value={money0(l.amount)} note="Computed at base ARV." />
          ))}
          <V cls="tot" label="Total selling costs" value={money0(rBase.sellTotal)} unit={pct(rBase.sellPctOfSale)}
            note="Recomputed per ARV scenario — most of these are percentages of sale." />

          <Band span={4} tag={s.finMode === 'hard' ? 'hard money' : (s.ltvPct > 0 ? 'conventional' : 'all cash')}>Financing</Band>
          <G>Hard money funds the rehab in draws; conventional funds only the purchase and leaves the rehab to your cash. <b>Set conventional LTV to 0 to model an all-cash purchase.</b></G>
          <R label="Instrument" note="Switching swaps the input set rather than reinterpreting it." ctl={
            <UnitToggle options={[{ u: 'hard', label: 'Hard money' }, { u: 'conv', label: 'Conventional' }]}
              value={s.finMode} onChange={u => set('finMode', u as FlipState['finMode'])} />} />
          {s.finMode === 'hard' ? <>
            <R label="Loan-to-cost on purchase" unit="%" note="Bay Area hard money runs 85–90% of purchase.">
              <Num value={s.ltcPct} onChange={v => set('ltcPct', v)} /></R>
            <R label="Rehab financed" unit="%" note="Usually 100%, released in draws as work is inspected.">
              <Num value={s.rehabFinancedPct} onChange={v => set('rehabFinancedPct', v)} /></R>
            <R label="Interest rate" unit="%" note="9.5–12% in 2026. Interest-only on the drawn balance.">
              <Num value={s.hardRate} onChange={v => set('hardRate', v)} /></R>
            <R label="Points" unit="%" note="1.5–3 points at close on purchase loan plus rehab holdback.">
              <Num value={s.pointsPct} onChange={v => set('pointsPct', v)} /></R>
            <R label="Lender fees" note="Underwriting, doc prep, legal. $1–2k typical.">
              <Money value={s.hardFees} onChange={v => set('hardFees', v)} /></R>
            <R label="Draws / fee each" note="$250–500 each plus an inspection delay. Fewer, larger draws cost less." ctl={
              <div className="inline-input" style={{ justifyContent: 'flex-end', gap: 3 }}>
                <NumInput fmt="raw" small value={s.drawCount} onChange={v => set('drawCount', v)} />
                <NumInput small value={s.drawFee} onChange={v => set('drawFee', v)} />
              </div>} />
            <R label="Minimum interest" unit="months" note="Most lenders guarantee 3–6 months even if you pay off early.">
              <Num value={s.minInterestMonths} onChange={v => set('minInterestMonths', v)} /></R>
            <R label="Extension fee" unit="%" note="Charged when the overrun above is more than zero. 0.5–1 point.">
              <Num value={s.extensionFeePct} onChange={v => set('extensionFeePct', v)} /></R>
          </> : <>
            <R label="Loan-to-value on purchase" unit="%" note="Against purchase price, not total cost. Set to 0 for all cash.">
              <Num value={s.ltvPct} onChange={v => set('ltvPct', v)} /></R>
            <R label="Interest rate" unit="%" note="Investment property prices 50–75bp over owner-occupied.">
              <Num value={s.convRate} onChange={v => set('convRate', v)} /></R>
            <R label="Term" unit="years" note="Sets the payment. Paid off at sale regardless.">
              <Num value={s.convTerm} onChange={v => set('convTerm', v)} /></R>
            <R label="Interest only" note="Take it on a flip — amortising parks cash in principal you get back anyway." ctl={
              <Switch checked={s.convIO} onChange={v => set('convIO', v)} />} />
            <R label="Origination" unit="%" note="On the loan amount only. No rehab commitment to charge against.">
              <Num value={s.originationPct} onChange={v => set('originationPct', v)} /></R>
            <R label="Lender fees" note="Underwriting, appraisal review, doc prep.">
              <Money value={s.convFees} onChange={v => set('convFees', v)} /></R>
            <R label="Prepayment penalty" unit="%" note="Some investor products carry one; a flip pays off inside the window.">
              <Num value={s.prepayPct} onChange={v => set('prepayPct', v)} /></R>
          </>}
          {rBase.finLines.filter(l => l.amount !== 0).map((l, i) => (
            <V key={i} label={l.label} value={money0(l.amount)} note={l.hint} />
          ))}
          <V cls="tot" label="Total financing cost" value={money0(rBase.finTotal)}
            note={<>{pct(s.arv.base > 0 ? rBase.finTotal / s.arv.base * 100 : 0)} of ARV — after rehab, usually the second-largest cost.</>} />
          <V label="Loan at close" value={money0(rBase.loanAtClose)} note="Funded at close, before any rehab draw." />
          <V label="Down payment" value={money0(rBase.downPayment)} note="Purchase price less the loan." />
          <V label="Cash needed for rehab" value={money0(rBase.cashForRehab)}
            note={s.finMode === 'conv'
              ? 'The whole rehab — a conventional purchase loan funds none of it.'
              : 'Only the unfinanced share; the lender reimburses the rest by draw.'} />
          <V cls="grand" label="Peak cash out of pocket" value={money0(rBase.peakCash)}
            note="The number that decides whether you can do this deal at all." />

          <Band span={4}>Tax &amp; thresholds</Band>
          <R label="Blended tax rate" unit="%"
            note="Ordinary income, likely dealer property — no capital gains, no 1031. 40–50% typical.">
            <Num value={s.taxPct} onChange={v => set('taxPct', v)} /></R>
          <R label="A loss shelters other income"
            note="Off by default so a bad deal shows its full loss." ctl={
            <Switch checked={s.lossOffsetsIncome} onChange={v => set('lossOffsetsIncome', v)} />} />
          <R label="Minimum profit" note="$50–75k is a common Bay Area floor. Max allowable offer solves against it.">
            <Money value={s.minProfit} onChange={v => set('minProfit', v)} /></R>
          <R label="Floor is measured"
            note="Pre-tax is what flippers quote each other; after-tax is what reaches your account." ctl={
            <UnitToggle options={[{ u: 'after', label: 'after tax' }, { u: 'pre', label: 'pre-tax' }]}
              value={s.minProfitBasis} onChange={u => set('minProfitBasis', u as 'after' | 'pre')} />} />
        </tbody></table></div>

        {diverged && (
          <div className="notice warn" style={{ marginTop: 12 }}>
            <div><b>Checklist and budget have diverged</b>
              Checklist says {money0(checklist.base)} base; this deal uses {money0(s.rehab.base)}.</div>
            <div className="act">
              <button onClick={pushChecklist}>Re-sync</button>
              <button onClick={() => set('rehabSource', 'manual')}>Keep mine</button>
            </div>
          </div>
        )}
        {checklist.checkedCount > 0 && s.rehabSource === 'manual' && (
          <div className="notice" style={{ marginTop: 12 }}>
            <div><b>{checklist.checkedCount} items checked on the checklist</b>
              They total {money0(checklist.base)} at base.</div>
            <div className="act"><button onClick={pushChecklist}>Use these</button></div>
          </div>
        )}
      </section>

      {/* ============================================ TAB 2 — DEAL MODEL */}
      <section className={`pane${tab === 'model' ? ' on' : ''}`}>
        <div className={`verdict ${verdict.v}`}>
          <span className="dot" />
          <div><div className="v-title">{verdict.title}</div><div className="v-sub">{verdict.sub}</div></div>
        </div>

        <div className="sheet"><table className="ss"><tbody>
          <Band span={6} tag="base case">Headline</Band>
          <tr>
            <td className="lb">Net profit after {s.taxPct}% tax</td>
            <td className={`n ${rBase.netProfit < 0 ? 'neg' : 'pos'}`} style={{ fontSize: 15, fontWeight: 700 }}>
              {money(rBase.netProfit)}</td>
            <td className="lb">ROI on cash</td><td className="n">{pct(rBase.roi)}</td>
            <td className="lb">Annualized</td><td className="n">{pct(rBase.annualizedRoi)}</td>
          </tr>
          <tr>
            <td className="lb">Margin — % of ARV, pre-tax</td><td className="n">{pct(rBase.marginPreTax)}</td>
            <td className="lb">Max allowable offer</td><td className="n">{money0(mao)}</td>
            <td className="lb">70% rule</td><td className="n">{money(seventyRule(s))}</td>
          </tr>
        </tbody></table></div>

        <div className="notice"><div>{seventyRule(s) < mao
          ? `The 70% rule is stricter than your own numbers by ${money0(mao - seventyRule(s))}. It assumes financing and selling costs that Bay Area price points don't match, so trust your MAO.`
          : `The 70% rule is looser than your own numbers by ${money0(seventyRule(s) - mao)}. Your underwrite says pay less than the rule of thumb — trust the underwrite.`}</div></div>

        <div className="sheet">
          <table className="ss"><tbody>
            <Band span={4} tag="click a cell to load its column below">Scenarios — net profit after tax</Band>
          </tbody></table>
          <div className="sc-wrap">
            <table className="sc-grid">
              <thead><tr>
                <th className="rh">Rehab ↓ &nbsp; ARV →</th>
                {SCENARIO_KEYS.map(k => (
                  <th key={k}>ARV {k}<span className="sub">{money0(s.arv[k])} · {psf(s.arv[k], sqft)}</span></th>
                ))}
              </tr></thead>
              <tbody>
                {grid.map((row, ri) => {
                  const rk = SCENARIO_KEYS[ri];
                  return (
                    <tr key={rk}>
                      <th className="rh">Rehab {rk}<span className="sub">{money0(s.rehab[rk])} · {psf(s.rehab[rk], sqft)}</span></th>
                      {row.map(c => {
                        const on = sel.a === c.arvKey && sel.r === c.rehabKey;
                        return (
                          <td key={c.arvKey} className={`${c.result.netProfit < 0 ? 'neg' : 'pos'}${on ? ' sel' : ''}`}>
                            <button onClick={() => setSel({ a: c.arvKey, r: c.rehabKey })}>
                              <span className="p">{money(c.result.netProfit)}</span>
                              <span className="r">{pct(c.result.roi)} · {pct(c.result.annualizedRoi)} ann.</span>
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="sheet"><table className="ss pl">
          {/* the band lives in the thead: a browser renders thead before tbody
              whatever the source order, so a band in its own tbody would sit
              below these column headers instead of titling them */}
          <thead>
            <Band span={4} tag={`ARV ${sel.a} — ${money0(s.arv[sel.a])}`}>Deal model</Band>
            <tr>
              <th className="lb">Scenario</th>
              {SCENARIO_KEYS.map((k, i) => (
                <th key={k} className={`n${i === selIdx ? ' on' : ''}`}>{k} rehab<br />{money0(s.rehab[k])}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <Sec span={4}>Scope &amp; timeline</Sec>
            <PL label="Rehab incl. contingency" pick={r => r.rehabTotal} fmt={money0} />
            <PL label="Total hold period — months" pick={r => r.holdMonths} fmt={n => n.toFixed(1)} />

            <Sec span={4}>Sale proceeds</Sec>
            <PL label="Gross sale price (ARV)" pick={r => r.sale} fmt={money0} />
            <Fold id="sell" label="Less selling costs" pick={r => r.sellTotal} lines={cols[selIdx].sellLines} />
            <PL cls="tot" label="Net sale proceeds" pick={r => r.netProceeds} fmt={money0} />

            <Sec span={4}>Cost into the deal</Sec>
            <PL label="Purchase price" pick={() => s.price} />
            <Fold id="acq" label="Acquisition costs" pick={r => r.acqTotal} lines={cols[selIdx].acqLines} />
            <PL label="Rehab incl. contingency" pick={r => r.rehabTotal} />
            <Fold id="hold" label="Holding costs" pick={r => r.holdTotal} lines={cols[selIdx].holdLines} />
            <Fold id="fin" label="Financing cost" pick={r => r.finTotal} lines={cols[selIdx].finLines} />

            <Sec span={4}>Result</Sec>
            <PL cls="tot" label="Pre-tax profit / (loss)" pick={r => r.preTaxProfit} fmt={money} />
            <PL label={`Income tax at ${s.taxPct}%`} pick={r => r.tax} />
            <PL cls="grand" label="Net profit after tax" pick={r => r.netProfit} fmt={money} />

            <Sec span={4}>Returns</Sec>
            <PL label="Return on cash — after tax" pick={r => r.roi} fmt={pct} />
            <PL label="Annualized return" pick={r => r.annualizedRoi} fmt={pct} />
            <PL label="Margin — % of ARV, pre-tax" pick={r => r.marginPreTax} fmt={pct} />

            <Sec span={4}>Capital</Sec>
            <PL label="Cash to close" pick={r => r.cashToClose} fmt={money0} />
            <PL label="Cash during hold" pick={r => r.cashDuringHold} fmt={money0} />
            <PL cls="tot" label="Peak cash out of pocket" pick={r => r.peakCash} fmt={money0} />
            <PL label="Loan payoff at sale" pick={r => r.payoffAtSale} fmt={money0} />
            <PL label="Cash back at close" pick={r => r.cashBackAtClose} fmt={money} />
            {rBase.principalPaid > 0 &&
              <PL label="Principal repaid — returns at close" pick={r => r.principalPaid} fmt={money0}
                hint="a balance transfer, not an expense" />}
            {rBase.withholding > 0 &&
              <PL label="CA withholding at close" pick={r => r.withholding} fmt={money0}
                hint="a prepayment against the tax above, not an extra cost" />}
          </tbody>
        </table></div>
      </section>

      {/* ============================================ TAB 3 — SENSITIVITY */}
      <section className={`pane${tab === 'sensitivity' ? ' on' : ''}`}>
        <div className="sheet">
          <table className="ss"><tbody>
            <Band span={4} tag="ARV across · rehab down">Net profit after tax</Band>
          </tbody></table>
          <div style={{ padding: '10px 12px 12px' }}>
            <div className="hm-wrap">
              <table className="hm">
                <thead><tr>
                  <th className="corner">Rehab ↓ &nbsp; ARV →</th>
                  {sens.arvAxis.map((a, i) => (
                    <th key={i}>{money0(a)}<span className="sub">{psf(a, sqft)}</span></th>
                  ))}
                </tr></thead>
                <tbody>
                  {sens.cells.map((row, ri) => {
                    /* a contour marks a CROSSING — the first cell whose
                       predecessor was on the other side. A row that never
                       crosses gets no line. */
                    const cross = (limit: number) =>
                      row.findIndex((v, i) => i > 0 && v >= limit && row[i - 1] < limit);
                    const be = cross(0);
                    const thr = cross(s.minProfit);
                    const nearest = (arr: number[], v: number) =>
                      arr.reduce((best, x, i) => Math.abs(x - v) < Math.abs(arr[best] - v) ? i : best, 0);
                    const baseR = nearest(sens.rehabAxis, sens.baseRehab);
                    const baseA = nearest(sens.arvAxis, sens.baseArv);
                    return (
                      <tr key={ri}>
                        <th className="rh">{money0(sens.rehabAxis[ri])}
                          <span className="sub">{psf(sens.rehabAxis[ri], sqft)}</span></th>
                        {row.map((v, ci) => (
                          <td key={ci} style={heatColor(v, sens.min, sens.max)}
                            className={`${be >= 0 && ci === be ? 'be' : ''}${thr >= 0 && ci === thr && thr !== be ? ' thr' : ''}${ri === baseR && ci === baseA ? ' base-cell' : ''}`}
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
            <div className="hm-legend">
              <span className="k"><i className="bar" />Break-even — $0 net profit</span>
              <span className="k"><i className="bar d" />Your {money0(s.minProfit)} profit floor</span>
              <span className="k"><i className="box" />Base case</span>
            </div>
            <div className="hm-scale">
              {Array.from({ length: 24 }, (_, i) => {
                const v = sens.min + (sens.max - sens.min) * (i / 23);
                return <i key={i} style={{ background: heatColor(v, sens.min, sens.max).background }} />;
              })}
            </div>
            <div className="hm-scale-lbl">
              <span>{money(sens.min)}</span>
              {sens.min < 0 && sens.max > 0 && (
                <span style={{ position: 'absolute', left: `${(-sens.min / (sens.max - sens.min)) * 100}%`, transform: 'translateX(-50%)' }}>$0</span>
              )}
              <span>{money(sens.max)}</span>
            </div>
            <p className="footnote">
              Purchase price ({money0(s.price)}), timeline ({rBase.holdMonths.toFixed(1)} months), financing and the
              {' '}{s.taxPct}% tax rate are held fixed — a two-variable slice, not a full-deal sensitivity.
              Axes span your low-to-high scenarios with 10% headroom past each end.
              {city && city.tiers.length > 1 && ' This city has a transfer tax cliff, so expect a visible step wherever the ARV range crosses it.'}
            </p>
          </div>
        </div>
      </section>

      {/* ============================================ TAB 4 — CHECKLIST */}
      <section className={`pane${tab === 'checklist' ? ' on' : ''}`}>
        <div className="flip-cols">
          <div className="sheet" style={{ marginBottom: 0 }}><table className="ss"><tbody>
            <Band tag="seeds every quantity below">Property</Band>
            <R label="Square feet"><Money value={sqft} onChange={v => setProp('sqft', v)} /></R>
            <R label="Bedrooms"><Num value={s.prop.beds} onChange={v => setProp('beds', v)} /></R>
            <R label="Full baths"><Num value={s.prop.baths} onChange={v => setProp('baths', v)} /></R>
            <R label="Half baths"><Num value={s.prop.halfBaths} onChange={v => setProp('halfBaths', v)} /></R>
            <R label="Stories"><Num value={s.prop.stories} onChange={v => setProp('stories', v)} /></R>
            <R label="Garage bays"><Num value={s.prop.garageBays} onChange={v => setProp('garageBays', v)} /></R>
          </tbody></table></div>
          <div className="notice" style={{ marginBottom: 0 }}>
            <div><b>Prices are shared across every deal</b>
              Edit one here and it is corrected everywhere, for good. What this deal owns is which items are
              checked and any quantity you override — so a price you fix after a real bid comes in improves
              every future underwrite instead of just this one.</div>
          </div>
        </div>

        <div style={{ height: 14 }} />

        {CATALOG.map(sec => {
          const t = checklist.sections.find(x => x.id === sec.id)!;
          const open = !!openSecs[sec.id];
          return (
            <div className={`cl-sec${open ? ' open' : ''}`} key={sec.id}>
              <div className="cl-sec-head" onClick={() => setOpenSecs(p => ({ ...p, [sec.id]: !p[sec.id] }))}>
                <span className="chev">▶</span>
                <span className="nm">{sec.label}</span>
                <span className={`ct${t.count ? '' : ' zero'}`}>{t.count} / {sec.items.length}</span>
                <span className="amt">{t.base > 0 ? money0(t.base) : '—'}</span>
              </div>
              <div className="cl-body">
                <div className="cl-head">
                  <span /><span className="l">Item</span>
                  <span>Qty</span><span>Low</span><span>Base</span><span>High</span>
                </div>
                {sec.items.map(i => {
                  const on = !!s.checked[i.id];
                  return (
                    <div className={`cl-row${on ? ' on' : ''}`} key={i.id}>
                      <input type="checkbox" checked={on}
                        onChange={ev => setS(p => ({ ...p, checked: { ...p.checked, [i.id]: ev.target.checked } }))} />
                      <div className="d">
                        {i.desc}<span className="un">{i.pctOfHard ? '% of hard' : i.unit}</span>
                        {i.note && <span className="nt">{i.note}</span>}
                      </div>
                      {i.pctOfHard
                        ? <div style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--ink-faint)' }}>—</div>
                        : <NumInput fmt="raw" value={qtyOf(i)}
                            onChange={v => setS(p => ({ ...p, qty: { ...p.qty, [i.id]: v } }))} />}
                      {(['low', 'base', 'high'] as const).map(k => (
                        <NumInput key={k} fmt="raw" value={priceOf(i, k)}
                          className={catalogPrices[`${i.id}.${k}`] !== undefined ? 'edited' : ''}
                          onChange={v => setCatalogPrice(i.id, k, v)} />
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        <div className="cl-sticky">
          <div className="grp"><span className="lbl">Low</span>
            <span className="val">{money0(checklist.low)}<span className="psf">{psf(checklist.low, sqft)}</span></span></div>
          <div className="grp"><span className="lbl">Base</span>
            <span className="val">{money0(checklist.base)}<span className="psf">{psf(checklist.base, sqft)}</span></span></div>
          <div className="grp"><span className="lbl">High</span>
            <span className="val">{money0(checklist.high)}<span className="psf">{psf(checklist.high, sqft)}</span></span></div>
          <div className="grp"><span className="lbl">Checked</span><span className="val">{checklist.checkedCount}</span></div>
          <div className="push">
            <button className="btn" onClick={sow} disabled={!checklist.checkedCount}>⬇ Scope of Work</button>
            <button className="btn primary" onClick={pushChecklist} disabled={!checklist.checkedCount}>
              Use as rehab budget</button>
          </div>
        </div>
      </section>

      <p className="footnote">
        Screening estimates only — verify every figure locally before making an offer.
        Transfer tax and property tax presets carry the date they were verified; rates change by ballot
        measure, so confirm before relying on them. Property tax assumes Prop 13 reassessment to the
        purchase price. Flip profit is treated as ordinary income at one blended rate, not capital gains.
      </p>
    </>
  );
}
