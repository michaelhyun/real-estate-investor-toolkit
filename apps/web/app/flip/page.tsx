'use client';

/* Bay Area Flip Analyzer — four tabs over one FlipState.

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
  CATALOG, ITEM_BY_ID, computeChecklist, seededQty, citiesByCounty, findCity,
  money, money0, pct, parseNum,
  type FlipState, type ScenarioKey, type CostLine, type QtyContext, type CatalogItem,
} from '@reit/core';
import { Card, NumInput, Switch, UnitToggle, Tile, loadJSON, saveJSON, openReportWindow } from '../../components/ui';
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
  const s = a >= 1000 ? `$${(a / 1000).toFixed(a >= 100000 ? 0 : 1)}k` : `$${Math.round(a)}`;
  return n < 0 ? `(${s})` : s;
};

/* ---------------------------------------------------------- small components */

/** A total and its $/sqft, each derived from the other. Type in whichever unit
    you actually think in — comps come in $/sqft, offers go out in dollars. */
function PsfRow({ label, value, sqft, onChange, hint }: {
  label: string; value: number; sqft: number; onChange: (n: number) => void; hint?: string;
}) {
  return (
    <div className="psf-row">
      <label>{label}{hint && <span className="sub">{hint}</span>}</label>
      <NumInput value={value} onChange={onChange} />
      <div className="psf">
        <NumInput fmt="raw" value={sqft > 0 ? Math.round(value / sqft) : 0}
          onChange={v => sqft > 0 && onChange(Math.round(v * sqft))} />
      </div>
    </div>
  );
}

/** The computed side of a cost group. Lines that would only repeat an input
    field verbatim are skipped — showing them twice makes a card twice as long
    and tells you nothing new. */
function CostList({ lines, total, label = 'Total', derivedOnly = false }: {
  lines: CostLine[]; total: number; label?: string; derivedOnly?: boolean;
}) {
  return (
    <div className="cost-list">
      {lines.filter(l => l.amount !== 0 && (!derivedOnly || l.derived || l.disclosure)).map((l, i) => (
        <div className={`cost-line${l.disclosure ? ' disclosure' : ''}`} key={i} title={l.hint}>
          <span className="cl-l">{l.label}</span>
          <span className="cl-v">{money0(l.amount)}</span>
        </div>
      ))}
      <div className="cost-line total"><span className="cl-l">{label}</span><span className="cl-v">{money0(total)}</span></div>
    </div>
  );
}

function MoneyRow({ label, value, onChange, hint }: {
  label: string; value: number; onChange: (n: number) => void; hint?: string;
}) {
  return (
    <div className="row">
      <label>{label}{hint && <span className="sub">{hint}</span>}</label>
      <NumInput value={value} onChange={onChange} />
    </div>
  );
}

function PctRow({ label, value, onChange, hint }: {
  label: string; value: number; onChange: (n: number) => void; hint?: string;
}) {
  return (
    <div className="row">
      <label>{label}{hint && <span className="sub">{hint}</span>}</label>
      <div className="inline-input">
        <NumInput fmt="raw" small value={value} onChange={onChange} />
        <span className="unit-suffix">%</span>
      </div>
    </div>
  );
}

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
  const ctx: QtyContext = useMemo(() => ({
    sqft: s.prop.sqft, beds: s.prop.beds, baths: s.prop.baths,
    halfBaths: s.prop.halfBaths, stories: s.prop.stories, garageBays: s.prop.garageBays,
  }), [s.prop]);

  const checklist = useMemo(
    () => computeChecklist(s.checked, s.qty, catalogPrices, ctx),
    [s.checked, s.qty, catalogPrices, ctx]);

  const r = useMemo(() => computeFlip(s, sel.a, sel.r), [s, sel]);
  const rBase = useMemo(() => computeFlip(s, 'base', 'base'), [s]);
  const grid = useMemo(() => computeGrid(s), [s]);
  const sens = useMemo(() => buildSensitivity(s, 7), [s]);
  const mao = useMemo(() => solveMAO(s), [s]);
  const verdict = verdictFor(rBase, s);

  /* the checklist and the rehab inputs can drift once you hand-edit tab 1 */
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

        <div className="prop-line">
          {([['beds', 'Beds'], ['baths', 'Baths'], ['halfBaths', 'Half ba'], ['sqft', 'Sq ft'], ['stories', 'Stories'], ['garageBays', 'Garage']] as const).map(([k, label]) => (
            <div className="pf-item" key={k}><label>{label}</label>
              <NumInput fmt={k === 'sqft' ? 'money' : 'raw'} small value={s.prop[k]} onChange={v => setProp(k, v)} /></div>
          ))}
          <div className="pf-item"><label>Year built</label>
            <input className="num small" value={s.prop.year} autoComplete="off"
              onChange={ev => setProp('year', ev.target.value)} /></div>
          <div className="pf-item grow"><label>City — sets transfer tax &amp; property tax</label>
            <select className="sel-city" value={s.citySlug} onChange={ev => applyCity(ev.target.value)}>
              <option value="">Not listed — enter rates manually</option>
              {citiesByCounty().map(g => (
                <optgroup key={g.county} label={`${g.county} County`}>
                  {g.cities.map(c => <option key={c.slug} value={c.slug}>{c.name}</option>)}
                </optgroup>
              ))}
            </select>
          </div>
        </div>

        <div className="prop-chips">
          <span className="p-chip">Gross spread <b>{pct(rBase.grossSpread)}</b></span>
          <span className="p-chip">ARV <b>{money0(rBase.arvPsf)}/sf</b></span>
          <span className="p-chip">Purchase <b>{money0(rBase.pricePsf)}/sf</b></span>
          <span className="p-chip">Rehab <b>{money0(rBase.rehabPsf)}/sf</b></span>
          <span className="p-chip">Hold <b>{rBase.holdMonths.toFixed(1)} mo</b></span>
        </div>
      </div>

      <nav className="tabs">
        <button className={`tab${tab === 'assumptions' ? ' on' : ''}`} onClick={() => setTab('assumptions')}>Assumptions</button>
        <button className={`tab${tab === 'model' ? ' on' : ''}`} onClick={() => setTab('model')}>
          Financial Model <span className="badge">{compact(rBase.netProfit)}</span></button>
        <button className={`tab${tab === 'sensitivity' ? ' on' : ''}`} onClick={() => setTab('sensitivity')}>Sensitivity</button>
        <button className={`tab${tab === 'checklist' ? ' on' : ''}`} onClick={() => setTab('checklist')}>
          Cost Checklist <span className="badge">{checklist.checkedCount || '0'}</span></button>
      </nav>

      {/* ============================================ TAB 1 — ASSUMPTIONS */}
      <section className={`pane${tab === 'assumptions' ? ' on' : ''}`}>
        {city?.note && (
          <div className="notice warn">
            <div><b>{city.name}</b>{city.note}</div>
          </div>
        )}
        <div className="flip-cols">
          <div>
            <Card dense title="Purchase & ARV" tag="two-way $/sqft">
              <MoneyRow label="Purchase price" value={s.price} onChange={v => set('price', v)} />
              <div className="psf-head"><span>After-repair value</span><span>Total</span><span>Per sqft</span></div>
              {SCENARIO_KEYS.map(k => (
                <PsfRow key={k} label={k[0].toUpperCase() + k.slice(1)} value={s.arv[k]}
                  sqft={s.prop.sqft} onChange={v => setArv(k, v)} />
              ))}
              <div className="cost-line total" style={{ marginTop: 8 }}>
                <span className="cl-l">Gross spread at base ARV</span>
                <span className="cl-v">{money0(s.arv.base - s.price)} · {pct(rBase.grossSpread)}</span>
              </div>
            </Card>

            <Card dense title="Rehab budget" tag={s.rehabSource === 'checklist' ? 'from checklist' : 'manual'}>
              {diverged && (
                <div className="notice warn">
                  <div><b>Checklist and budget have diverged</b>
                    Checklist says {money0(checklist.base)} base; this deal is using {money0(s.rehab.base)}.</div>
                  <div className="act">
                    <button onClick={pushChecklist}>Re-sync</button>
                    <button onClick={() => set('rehabSource', 'manual')}>Keep mine</button>
                  </div>
                </div>
              )}
              <div className="psf-head"><span>Scenario</span><span>Total</span><span>Per sqft</span></div>
              {SCENARIO_KEYS.map(k => (
                <PsfRow key={k} label={k[0].toUpperCase() + k.slice(1)} value={s.rehab[k]}
                  sqft={s.prop.sqft} onChange={v => setRehab(k, v)} />
              ))}
              <PctRow label="Contingency" hint="applied on top of each scenario, shown as its own P&L line"
                value={s.contingencyPct} onChange={v => set('contingencyPct', v)} />
              {checklist.checkedCount > 0 && s.rehabSource === 'manual' && (
                <div className="notice">
                  <div><b>{checklist.checkedCount} items checked on the checklist</b>
                    They total {money0(checklist.base)} at base.</div>
                  <div className="act"><button onClick={pushChecklist}>Use these</button></div>
                </div>
              )}
            </Card>

            <Card dense title="Timeline" tag={`${rBase.holdMonths.toFixed(1)} mo hold`}>
              <MoneyRow label="Rehab duration" hint="months — fold permit and design time in here"
                value={s.rehabMonths} onChange={v => set('rehabMonths', v)} />
              <MoneyRow label="Days on market" hint="list to accepted offer"
                value={s.domDays} onChange={v => set('domDays', v)} />
              <MoneyRow label="Escrow period" hint="accepted offer to close, in days"
                value={s.escrowDays} onChange={v => set('escrowDays', v)} />
              <MoneyRow label="Schedule overrun" hint="extra months — costs you holding AND interest"
                value={s.overrunMonths} onChange={v => set('overrunMonths', v)} />
              <div className="cost-line total"><span className="cl-l">Total hold period</span>
                <span className="cl-v">{rBase.holdMonths.toFixed(1)} months</span></div>
            </Card>

            <Card dense title="Tax & thresholds">
              <PctRow label="Blended tax rate" hint="flip profit is ordinary income, not capital gains"
                value={s.taxPct} onChange={v => set('taxPct', v)} />
              <div className="row"><label>A loss shelters other income
                <span className="sub">off by default — no phantom benefit on a bad deal</span></label>
                <Switch checked={s.lossOffsetsIncome} onChange={v => set('lossOffsetsIncome', v)} /></div>
              <MoneyRow label="Minimum profit" hint="your walk-away floor — this is what MAO solves against"
                value={s.minProfit} onChange={v => set('minProfit', v)} />
              <div className="row"><label>Floor is measured</label>
                <UnitToggle options={[{ u: 'after', label: 'after tax' }, { u: 'pre', label: 'pre-tax' }]}
                  value={s.minProfitBasis} onChange={u => set('minProfitBasis', u as 'after' | 'pre')} /></div>
            </Card>
          </div>

          <div>
            <Card dense title="Acquisition costs" tag={money0(rBase.acqTotal)}>
              {ACQ_ITEMS.map(i => (
                <MoneyRow key={i.id} label={i.label} hint={i.hint}
                  value={s.acq[i.id] ?? 0} onChange={v => setMap('acq', i.id, v)} />
              ))}
              <CostList derivedOnly lines={rBase.acqLines} total={rBase.acqTotal} />
            </Card>

            <Card dense title="Holding costs" tag={`${money0(rBase.holdMonthly)}/mo`}>
              <PctRow label="Levied property tax rate"
                hint="1% Prop 13 base plus local bonds — not a published “effective” rate"
                value={s.taxRatePct} onChange={v => set('taxRatePct', v)} />
              <MoneyRow label="Prior assessed value"
                hint="optional — breaks out the supplemental bill you’ll get"
                value={s.priorAssessed} onChange={v => set('priorAssessed', v)} />
              <div className="row"><label>Builder&apos;s risk insurance</label>
                <div className="inline-input">
                  <NumInput fmt="raw" small value={s.builderRisk} onChange={v => set('builderRisk', v)} />
                  <UnitToggle options={[{ u: '$', label: '$/mo' }, { u: '%', label: '% rehab' }]}
                    value={s.builderRiskUnit} onChange={u => set('builderRiskUnit', u as '$' | '%')} />
                </div>
              </div>
              {HOLD_ITEMS.map(i => (
                <MoneyRow key={i.id} label={`${i.label} — $/mo`} hint={i.hint}
                  value={s.hold[i.id] ?? 0} onChange={v => setMap('hold', i.id, v)} />
              ))}
              <CostList label={`Total over ${rBase.holdMonths.toFixed(1)} months`} total={rBase.holdTotal}
                lines={[
                  { label: 'Property tax — reassessed at purchase price', amount: rBase.propertyTax },
                  ...(rBase.supplementalTax > 0
                    ? [{ label: 'of which supplemental bill', amount: rBase.supplementalTax, disclosure: true }]
                    : []),
                  { label: "Builder's risk insurance",
                    amount: rBase.holdTotal - rBase.propertyTax - rBase.holdMonthly * rBase.holdMonths },
                  { label: `Utilities & upkeep — ${money0(rBase.holdMonthly)}/mo`,
                    amount: rBase.holdMonthly * rBase.holdMonths },
                ]} />
            </Card>

            <Card dense title="Selling costs" tag={pct(rBase.sellPctOfSale)}>
              <PctRow label="Listing commission" value={s.listCommPct} onChange={v => set('listCommPct', v)} />
              <PctRow label="Buyer agent commission" hint="negotiable or zero post-settlement"
                value={s.buyCommPct} onChange={v => set('buyCommPct', v)} />
              <div className="row"><label>City transfer tax paid by
                {city && <span className="sub">{city.name} custom — override per deal</span>}</label>
                <UnitToggle
                  options={[{ u: 'seller', label: 'Seller' }, { u: 'split', label: 'Split' }, { u: 'buyer', label: 'Buyer' }]}
                  value={s.transferPayer}
                  onChange={u => set('transferPayer', u as FlipState['transferPayer'])} />
              </div>
              {SELL_FLAT_ITEMS.map(i => (
                <MoneyRow key={i.id} label={i.label} value={s.sell[i.id] ?? 0} onChange={v => setMap('sell', i.id, v)} />
              ))}
              <MoneyRow label="Staging — per month" hint="runs over DOM plus escrow"
                value={s.stagingMo} onChange={v => set('stagingMo', v)} />
              <MoneyRow label="Retrofit compliance"
                hint={city ? city.retrofit.map(x => x.label).join(' · ') : 'sewer lateral, water heater strapping, alarms'}
                value={s.retrofit} onChange={v => set('retrofit', v)} />
              <PctRow label="Seller concessions" value={s.concessionsPct} onChange={v => set('concessionsPct', v)} />
              <div className="row"><label>CA 3.33% withholding
                <span className="sub">a cash-flow timing item, never an expense</span></label>
                <Switch checked={s.withholdingOn} onChange={v => set('withholdingOn', v)} /></div>
              <CostList derivedOnly lines={rBase.sellLines} total={rBase.sellTotal} />
            </Card>

            <Card dense title="Financing" tag={s.finMode === 'hard' ? 'hard money' : (s.ltvPct > 0 ? 'conventional' : 'all cash')}>
              <div className="mode-row">
                <UnitToggle options={[{ u: 'hard', label: 'Hard money' }, { u: 'conv', label: 'Conventional' }]}
                  value={s.finMode} onChange={u => set('finMode', u as FlipState['finMode'])} />
              </div>
              {s.finMode === 'hard' ? (
                <>
                  <PctRow label="Loan-to-cost on purchase" value={s.ltcPct} onChange={v => set('ltcPct', v)} />
                  <PctRow label="Rehab financed" hint="released in draws over the rehab"
                    value={s.rehabFinancedPct} onChange={v => set('rehabFinancedPct', v)} />
                  <PctRow label="Interest rate" value={s.hardRate} onChange={v => set('hardRate', v)} />
                  <PctRow label="Points" hint="charged on purchase loan plus rehab holdback"
                    value={s.pointsPct} onChange={v => set('pointsPct', v)} />
                  <MoneyRow label="Lender fees" value={s.hardFees} onChange={v => set('hardFees', v)} />
                  <MoneyRow label="Number of draws" value={s.drawCount} onChange={v => set('drawCount', v)} />
                  <MoneyRow label="Fee per draw" value={s.drawFee} onChange={v => set('drawFee', v)} />
                  <MoneyRow label="Minimum interest months" value={s.minInterestMonths} onChange={v => set('minInterestMonths', v)} />
                  <PctRow label="Extension fee" hint="charged when schedule overrun is above zero"
                    value={s.extensionFeePct} onChange={v => set('extensionFeePct', v)} />
                </>
              ) : (
                <>
                  <PctRow label="Loan-to-value on purchase" hint="set to 0 to model an all-cash purchase"
                    value={s.ltvPct} onChange={v => set('ltvPct', v)} />
                  <PctRow label="Interest rate" value={s.convRate} onChange={v => set('convRate', v)} />
                  <MoneyRow label="Term — years" value={s.convTerm} onChange={v => set('convTerm', v)} />
                  <div className="row"><label>Interest only</label>
                    <Switch checked={s.convIO} onChange={v => set('convIO', v)} /></div>
                  <PctRow label="Origination" value={s.originationPct} onChange={v => set('originationPct', v)} />
                  <MoneyRow label="Lender fees" value={s.convFees} onChange={v => set('convFees', v)} />
                  <PctRow label="Prepayment penalty" value={s.prepayPct} onChange={v => set('prepayPct', v)} />
                  <div className="notice">
                    <div><b>Rehab is unfinanced in this mode</b>
                      A conventional purchase loan funds no rehab, so the whole {money0(rBase.rehabTotal)} budget
                      is cash. Principal you repay during the hold is a balance transfer, not an expense — it
                      raises peak cash and comes back as a smaller payoff.</div>
                  </div>
                </>
              )}
              <CostList lines={rBase.finLines} total={rBase.finTotal} />
              <div className="cost-line"><span className="cl-l">Loan at close</span><span className="cl-v">{money0(rBase.loanAtClose)}</span></div>
              <div className="cost-line"><span className="cl-l">Down payment</span><span className="cl-v">{money0(rBase.downPayment)}</span></div>
              <div className="cost-line"><span className="cl-l">Cash needed for rehab</span><span className="cl-v">{money0(rBase.cashForRehab)}</span></div>
              <div className="cost-line total"><span className="cl-l">Peak cash out of pocket</span><span className="cl-v">{money0(rBase.peakCash)}</span></div>
            </Card>
          </div>
        </div>
      </section>

      {/* ============================================ TAB 2 — MODEL */}
      <section className={`pane${tab === 'model' ? ' on' : ''}`}>
        <div className={`verdict ${verdict.v}`}>
          <span className="dot" />
          <div><div className="v-title">{verdict.title}</div><div className="v-sub">{verdict.sub}</div></div>
        </div>

        <div className="tiles" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
          <Tile hero label="Net profit" value={money(rBase.netProfit)}
            negative={rBase.netProfit < 0} note={`after ${s.taxPct}% tax`} />
          <Tile label="ROI on cash" value={pct(rBase.roi)} note={`${money0(rBase.peakCash)} invested`} />
          <Tile label="Annualized ROI" value={pct(rBase.annualizedRoi)} note={`${rBase.holdMonths.toFixed(1)}-month hold`} />
          <Tile label="Margin % of ARV" value={pct(rBase.marginPreTax)} note={`pre-tax · ${pct(rBase.marginAfterTax)} after`} />
          <Tile label="Max offer" value={money0(mao)} note={`for ${money0(s.minProfit)} ${s.minProfitBasis === 'pre' ? 'pre-tax' : 'net'}`} />
        </div>

        <div className="notice">
          <div>
            <b>70% rule cross-check: {money(seventyRule(s))}</b>
            {seventyRule(s) < mao
              ? `Stricter than your own numbers by ${money0(mao - seventyRule(s))}. The rule assumes financing and selling costs that Bay Area price points don't match, so your MAO is the one to trust here.`
              : `Looser than your own numbers by ${money0(seventyRule(s) - mao)}. Your underwrite says pay less than the rule of thumb does — trust the underwrite.`}
          </div>
        </div>

        <Card title="Scenarios" tag="rehab × ARV — click a cell">
          <div className="sc-wrap">
            <table className="sc-grid">
              <thead>
                <tr>
                  <th className="rh">Rehab ↓ &nbsp; ARV →</th>
                  {SCENARIO_KEYS.map(k => (
                    <th key={k}>ARV {k}<span className="sub">{money0(s.arv[k])} · {money0(s.prop.sqft > 0 ? s.arv[k] / s.prop.sqft : 0)}/sf</span></th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grid.map((row, ri) => {
                  const rk = SCENARIO_KEYS[ri];
                  return (
                    <tr key={rk}>
                      <th className="rh">Rehab {rk}<span className="sub">{money0(s.rehab[rk])} · {money0(s.prop.sqft > 0 ? s.rehab[rk] / s.prop.sqft : 0)}/sf</span></th>
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
        </Card>

        <div className="flip-cols">
          <Card title={`Profit & loss — ARV ${sel.a}, rehab ${sel.r}`} tag="click a row to expand">
            <table className="wf">
              <tbody>
                <tr><td>Sale price</td><td className="v">{money0(r.sale)}</td><td className="pc">100%</td></tr>
                {([
                  ['sell', 'Less selling costs', r.sellTotal, r.sellLines],
                ] as const).map(([k, label, amt, lines]) => (
                  <FoldRow key={k} id={k} label={label} amount={amt} lines={lines as CostLine[]}
                    sale={r.sale} expanded={expanded} setExpanded={setExpanded} />
                ))}
                <tr className="sub"><td>Net sale proceeds</td><td className="v">{money(r.netProceeds)}</td>
                  <td className="pc">{pct(r.sale > 0 ? r.netProceeds / r.sale * 100 : 0)}</td></tr>
                <tr><td>Less purchase price</td><td className="v neg">({money0(s.price)})</td>
                  <td className="pc">{pct(r.sale > 0 ? s.price / r.sale * 100 : 0)}</td></tr>
                {([
                  ['acq', 'Less acquisition costs', r.acqTotal, r.acqLines],
                  ['rehab', 'Less rehab incl. contingency', r.rehabTotal, [
                    { label: 'Rehab budget', amount: r.rehabBase },
                    { label: `Contingency at ${s.contingencyPct}%`, amount: r.contingency },
                  ]],
                  ['hold', 'Less holding costs', r.holdTotal, r.holdLines],
                  ['fin', 'Less financing', r.finTotal, r.finLines],
                ] as const).map(([k, label, amt, lines]) => (
                  <FoldRow key={k} id={k} label={label} amount={amt} lines={lines as CostLine[]}
                    sale={r.sale} expanded={expanded} setExpanded={setExpanded} />
                ))}
                <tr className="sub"><td>Pre-tax profit</td><td className="v">{money(r.preTaxProfit)}</td>
                  <td className="pc">{pct(r.marginPreTax)}</td></tr>
                <tr><td>Less income tax at {s.taxPct}%</td><td className="v neg">({money0(r.tax)})</td>
                  <td className="pc">{pct(r.sale > 0 ? r.tax / r.sale * 100 : 0)}</td></tr>
                <tr className="fin"><td>Net profit after tax</td><td className="v">{money(r.netProfit)}</td>
                  <td className="pc">{pct(r.marginAfterTax)}</td></tr>
              </tbody>
            </table>
          </Card>

          <Card title="Capital" tag="what the deal actually needs">
            <div className="cost-list">
              <div className="cost-line"><span className="cl-l">Down payment</span><span className="cl-v">{money0(r.downPayment)}</span></div>
              <div className="cost-line"><span className="cl-l">Acquisition costs</span><span className="cl-v">{money0(r.acqTotal)}</span></div>
              <div className="cost-line"><span className="cl-l">Points, origination &amp; lender fees</span>
                <span className="cl-v">{money0(r.cashToClose - r.downPayment - r.acqTotal)}</span></div>
              <div className="cost-line total"><span className="cl-l">Cash to close</span><span className="cl-v">{money0(r.cashToClose)}</span></div>
            </div>
            <div className="cost-list" style={{ marginTop: 14 }}>
              <div className="cost-line"><span className="cl-l">Rehab paid in cash</span><span className="cl-v">{money0(r.cashForRehab)}</span></div>
              <div className="cost-line"><span className="cl-l">Holding costs</span><span className="cl-v">{money0(r.holdTotal)}</span></div>
              <div className="cost-line"><span className="cl-l">Interest &amp; loan fees during hold</span>
                <span className="cl-v">{money0(r.cashDuringHold - r.holdTotal - r.cashForRehab - r.principalPaid)}</span></div>
              {r.principalPaid > 0 && (
                <div className="cost-line" title="Not an expense — it returns to you as a smaller payoff at close">
                  <span className="cl-l">Principal repaid <em>(returns at close)</em></span>
                  <span className="cl-v">{money0(r.principalPaid)}</span></div>
              )}
              <div className="cost-line total"><span className="cl-l">Cash during hold</span><span className="cl-v">{money0(r.cashDuringHold)}</span></div>
            </div>
            <div className="tiles" style={{ gridTemplateColumns: '1fr 1fr', marginTop: 16 }}>
              <Tile label="Peak cash out of pocket" value={money0(r.peakCash)} note="the number that decides if you can do it" />
              <Tile label="Cash back at close" value={money(r.cashBackAtClose)} note={`after ${money0(r.payoffAtSale)} payoff`} />
            </div>
            {r.withholding > 0 && (
              <div className="notice" style={{ marginTop: 12 }}>
                <div><b>CA withholding at close: {money0(r.withholding)}</b>
                  A prepayment against the tax already in the P&amp;L — it reduces proceeds at close but is
                  not an additional cost, so it is not subtracted twice.</div>
              </div>
            )}
          </Card>
        </div>
      </section>

      {/* ============================================ TAB 3 — SENSITIVITY */}
      <section className={`pane${tab === 'sensitivity' ? ' on' : ''}`}>
        <Card title="Net profit after tax" tag="ARV across · rehab down">
          <div className="hm-wrap">
            <table className="hm">
              <thead>
                <tr>
                  <th className="corner">Rehab ↓ &nbsp; ARV →</th>
                  {sens.arvAxis.map((a, i) => (
                    <th key={i}>{money0(a)}<span className="sub">{money0(s.prop.sqft > 0 ? a / s.prop.sqft : 0)}/sf</span></th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sens.cells.map((row, ri) => {
                  /* first column where the row turns positive, and where it
                     clears the floor — drawn as contours on the left edge */
                  /* a contour marks a CROSSING — the first cell whose
                     predecessor was on the other side. A row that is positive
                     all the way across never crosses zero and gets no line. */
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
                        <span className="sub">{money0(s.prop.sqft > 0 ? sens.rehabAxis[ri] / s.prop.sqft : 0)}/sf</span></th>
                      {row.map((v, ci) => (
                        <td key={ci} style={heatColor(v, sens.min, sens.max)}
                          className={`${be >= 0 && ci === be ? 'be' : ''}${thr >= 0 && ci === thr && thr !== be ? ' thr' : ''}${ri === baseR && ci === baseA ? ' base-cell' : ''}`}
                          title={`ARV ${money0(sens.arvAxis[ci])} · rehab ${money0(sens.rehabAxis[ri])} → ${money0(v)}`}>
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
          <div className="hm-scale-lbl" style={{ position: 'relative' }}>
            <span>{money(sens.min)}</span>
            {sens.min < 0 && sens.max > 0 && (
              <span style={{ position: 'absolute', left: `${(-sens.min / (sens.max - sens.min)) * 100}%`, transform: 'translateX(-50%)' }}>$0</span>
            )}
            <span>{money(sens.max)}</span>
          </div>
          <p className="footnote">
            Purchase price ({money0(s.price)}), timeline ({rBase.holdMonths.toFixed(1)} months), financing and the
            {' '}{s.taxPct}% tax rate are held fixed — this grid varies ARV and rehab only, so read it as a
            two-variable slice rather than a full-deal sensitivity. Axes span your low-to-high scenarios with
            10% headroom past each end.
            {city && city.tiers.length > 1 && ' This city has a transfer tax cliff, so expect a visible step wherever the ARV range crosses it.'}
          </p>
        </Card>
      </section>

      {/* ============================================ TAB 4 — CHECKLIST */}
      <section className={`pane${tab === 'checklist' ? ' on' : ''}`}>
        <Card dense title="Property" tag="seeds every quantity below">
          <div className="cl-rooms">
            {([['beds', 'Bedrooms'], ['baths', 'Full baths'], ['halfBaths', 'Half baths'], ['sqft', 'Sq ft'], ['stories', 'Stories'], ['garageBays', 'Garage bays']] as const).map(([k, label]) => (
              <div className="pf-item" key={k}><label>{label}</label>
                <NumInput fmt={k === 'sqft' ? 'money' : 'raw'} small value={s.prop[k]} onChange={v => setProp(k, v)} /></div>
            ))}
          </div>
          <p className="footnote" style={{ marginTop: 10 }}>
            Prices are shared across every deal — edit one here and it is corrected everywhere, for good.
            What this deal owns is which items are checked and any quantity you override.
          </p>
        </Card>

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
                  <span />
                  <span className="l">Item</span>
                  <span>Qty</span><span>Low</span><span>Base</span><span>High</span>
                </div>
                {sec.items.map(i => {
                  const on = !!s.checked[i.id];
                  const q = qtyOf(i);
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
                        : <NumInput fmt="raw" value={q} onChange={v => setS(p => ({ ...p, qty: { ...p.qty, [i.id]: v } }))} />}
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
            <span className="val">{money0(checklist.low)}
              <span className="psf">{s.prop.sqft > 0 ? `${money0(checklist.low / s.prop.sqft)}/sf` : ''}</span></span></div>
          <div className="grp"><span className="lbl">Base</span>
            <span className="val">{money0(checklist.base)}
              <span className="psf">{s.prop.sqft > 0 ? `${money0(checklist.base / s.prop.sqft)}/sf` : ''}</span></span></div>
          <div className="grp"><span className="lbl">High</span>
            <span className="val">{money0(checklist.high)}
              <span className="psf">{s.prop.sqft > 0 ? `${money0(checklist.high / s.prop.sqft)}/sf` : ''}</span></span></div>
          <div className="grp"><span className="lbl">Checked</span><span className="val">{checklist.checkedCount}</span></div>
          <div className="push">
            <button className="btn" onClick={sow} disabled={!checklist.checkedCount}>⬇ Scope of Work</button>
            <button className="btn primary" onClick={pushChecklist} disabled={!checklist.checkedCount}>
              Use as rehab budget
            </button>
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

/* An expandable "less …" row in the waterfall. */
function FoldRow({ id, label, amount, lines, sale, expanded, setExpanded }: {
  id: string; label: string; amount: number; lines: CostLine[]; sale: number;
  expanded: Record<string, boolean>; setExpanded: (f: (p: Record<string, boolean>) => Record<string, boolean>) => void;
}) {
  const open = !!expanded[id];
  return (
    <>
      <tr>
        <td>
          <button className="exp" onClick={() => setExpanded(p => ({ ...p, [id]: !p[id] }))}>
            {open ? '▾' : '▸'}
          </button>
          {label}
        </td>
        <td className="v neg">({money0(amount)})</td>
        <td className="pc">{pct(sale > 0 ? amount / sale * 100 : 0)}</td>
      </tr>
      {open && lines.filter(l => l.amount !== 0).map((l, i) => (
        <tr className="detail" key={i}>
          <td>{l.label}</td><td className="v">{money0(l.amount)}</td><td className="pc" />
        </tr>
      ))}
    </>
  );
}
