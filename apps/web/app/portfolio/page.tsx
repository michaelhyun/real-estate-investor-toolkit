'use client';

/* Portfolio ROE Dashboard — React port of portfolio.html. Math in @reit/core;
   storage keys unchanged (portfolio.v1, reads rentalDeals.v3). */

import { useEffect, useMemo, useState } from 'react';
import {
  metrics, migrate, monthlyPI, money, money0, pct,
  type PropertyState, type UnitValue, type DealState,
} from '@reit/core';
import { Card, NumInput, UnitToggle, Tile, loadJSON, saveJSON } from '../../components/ui';
import { toast } from '../../components/toast';

const PKEY = 'portfolio.v1';
const RENTAL_DEALS_KEY = 'rentalDeals.v3';
const MEDALS = ['🥇', '🥈', '🥉'];
const pctf = (n: number, d = 1) => (isFinite(n) ? n.toFixed(d) : '—') + '%';

const EMPTY: PropertyState = {
  name: '', dateAcq: '', ownPct: 100, price: 0, down: 0, other: 0,
  value: 0, loan: 0, rate: 0, pay: 0,
  income: { v: 0, unit: 'mo' }, opex: { v: 0, unit: 'mo' },
  taxes: { v: 0, unit: 'mo' }, ins: { v: 0, unit: 'mo' }, cfOverride: null,
};

export default function PortfolioPage() {
  const [props, setProps] = useState<PropertyState[]>([]);
  const [deals, setDeals] = useState<DealState[]>([]);
  const [sortBy, setSortBy] = useState<'roe' | 'coc' | 'cf' | 'equity'>('roe');
  const [hydrated, setHydrated] = useState(false);
  const [now, setNow] = useState(0);

  /* modal */
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);  /* index into props */
  const [m, setM] = useState<PropertyState>(EMPTY);

  useEffect(() => {
    setProps((loadJSON<any[]>(PKEY) || []).map(migrate));
    setDeals(loadJSON<DealState[]>(RENTAL_DEALS_KEY) || []);
    setNow(Date.now());
    setHydrated(true);
  }, []);
  useEffect(() => { if (hydrated) saveJSON(PKEY, props); }, [props, hydrated]);

  const setField = <K extends keyof PropertyState>(k: K, v: PropertyState[K]) =>
    setM(prev => ({ ...prev, [k]: v }));
  const setUnitValue = (k: 'income' | 'opex' | 'taxes' | 'ins', uv: UnitValue) =>
    setM(prev => ({ ...prev, [k]: uv }));

  const mm = useMemo(() => metrics(m, now || Date.now()), [m, now]);

  const sortKey = (p: PropertyState) => {
    const x = metrics(p, now || Date.now());
    return sortBy === 'coc' ? (isFinite(x.coc) ? x.coc : -1e9)
      : sortBy === 'cf' ? x.cfShare
      : sortBy === 'equity' ? x.equityShare
      : (isFinite(x.roe) ? x.roe : -1e9);
  };
  const order = useMemo(() => [...props].sort((a, b) => sortKey(b) - sortKey(a)),
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
    [props, sortBy, now]);

  let tv = 0, teq = 0, tcf = 0, tinv = 0, tret = 0;
  props.forEach(p => {
    const x = metrics(p, now || Date.now());
    tv += (p.value || 0) * x.own;
    teq += x.equityShare;
    tcf += x.cfShare;
    tinv += ((p.down || 0) + (p.other || 0)) * x.own;
    tret += (x.cfY + x.paydownY) * x.own;
  });
  const bRoe = teq > 0 ? tret / teq * 100 : NaN;
  const bCoc = tinv > 0 ? (tcf * 12) / tinv * 100 : NaN;

  const ranked = order.map(p => ({ p, m: metrics(p, now || Date.now()) })).filter(x => isFinite(x.m.roe));
  const maxRoe = Math.max(...ranked.map(x => x.m.roe), 1);
  const lazy = ranked.filter(x => x.m.roe < 6 && x.m.equityShare > 25000);

  function openModal(idx: number | null, prefill?: PropertyState) {
    setEditing(idx);
    setM(prefill ?? (idx != null ? { ...props[idx] } : { ...EMPTY }));
    setModalOpen(true);
  }
  function saveModal() {
    if (!m.name.trim()) { toast('Give the property a name'); return; }
    const clean = { ...m, name: m.name.trim() };
    setProps(prev => editing != null
      ? prev.map((p, i) => i === editing ? clean : p)
      : [...prev, clean]);
    setModalOpen(false);
    toast(editing != null ? 'Property updated' : `"${clean.name}" added to your portfolio`);
    setEditing(null);
  }
  function removeProp(p: PropertyState) {
    if (!confirm(`Remove "${p.name || 'this property'}" from the portfolio?`)) return;
    setProps(prev => prev.filter(x => x !== p));
  }

  const importDeal = (idx: string) => {
    const d = deals[+idx];
    if (!d) return;
    const downAmt = d.price * (d.downPct || 0) / 100;
    const loan = Math.max(0, d.price - downAmt - (d.sellerOn ? d.sellerAmt || 0 : 0) - (d.subtoOn ? d.subtoBal || 0 : 0));
    const closing = d.closingUnit === '%' ? d.price * (d.closing || 0) / 100 : (d.closing || 0);
    openModal(null, {
      ...EMPTY,
      name: d.name || d.prop?.address || 'Imported deal',
      price: d.price, value: d.prop?.list || d.price,
      down: downAmt, other: (d.rehab || 0) + closing,
      loan, rate: d.rate || 0, pay: monthlyPI(loan, d.rate || 0, d.term || 30),
      income: { v: d.rent || 0, unit: 'mo' },
      taxes: { v: d.expenses?.tax || 0, unit: d.units?.tax === 'yr' ? 'yr' : 'mo' },
      ins: { v: d.expenses?.ins || 0, unit: d.units?.ins === 'yr' ? 'yr' : 'mo' },
    });
    toast('Deal loaded into the form — add remaining operating expenses, then Save');
  };

  const unitField = (key: 'income' | 'opex' | 'taxes' | 'ins', label: React.ReactNode) => (
    <div className="pm-field"><label>{label}</label>
      <div className="pm-unit">
        <NumInput value={m[key].v} onChange={v => setUnitValue(key, { ...m[key], v })} fmt="raw" className="num" />
        <UnitToggle
          options={[{ u: 'mo', label: '$/mo' }, { u: 'yr', label: '$/yr' }]}
          value={m[key].unit}
          onChange={u => {
            const cur = m[key];
            if (cur.unit !== u && cur.v) {
              setUnitValue(key, { v: u === 'yr' ? Math.round(cur.v * 12) : Math.round(cur.v / 12), unit: u as 'mo' | 'yr' });
            } else setUnitValue(key, { ...cur, unit: u as 'mo' | 'yr' });
          }} />
      </div>
    </div>
  );

  return (
    <>
      <div className="tool-title">
        <h1>Portfolio ROE Dashboard</h1>
        <div className="toolbar">
          <select value="" onChange={ev => importDeal(ev.target.value)}>
            <option value="">Import from a saved deal…</option>
            {deals.map((d, i) => <option key={i} value={i}>{d.name} — {money0(d.price)}</option>)}
          </select>
          <select value={sortBy} onChange={ev => setSortBy(ev.target.value as any)} title="Rank properties by">
            <option value="roe">Rank by ROE</option>
            <option value="coc">Rank by CoC</option>
            <option value="cf">Rank by cash flow</option>
            <option value="equity">Rank by equity</option>
          </select>
          <button className="btn primary" onClick={() => openModal(null)}>+ Add property</button>
        </div>
      </div>

      <div className="tiles">
        <Tile label="Portfolio Value" value={props.length ? money0(tv) : '—'}
          note={`across ${props.length} propert${props.length === 1 ? 'y' : 'ies'} (your share)`} />
        <Tile hero label="Your Equity" value={props.length ? money0(teq) : '—'}
          note={tv > 0 ? `${Math.round(teq / tv * 100)}% of portfolio value` : 'value − loans, × ownership'} />
        <Tile label="Monthly Cash Flow" value={props.length ? money(tcf) : '—'}
          note="your share, after debt" valueClass={tcf >= 0 ? 'pos' : 'neg'} />
        <Tile label="Blended ROE" value={props.length && isFinite(bRoe) ? pctf(bRoe) : '—'}
          note={isFinite(bCoc) ? `blended CoC ${pctf(bCoc)}` : 'cash flow + paydown ÷ equity'} />
      </div>

      <Card title="Performance Leaderboard" tag="Best first">
        {!ranked.length
          ? <div className="empty-note">Add properties below to see how they rank.</div>
          : ranked.map((x, i) => (
            <div className="lb-row" key={i}>
              <span className="lb-name">{MEDALS[i] ? MEDALS[i] + ' ' : ''}{x.p.name || 'Property ' + (i + 1)}</span>
              <span className="lb-track"><span
                className={`lb-bar ${x.m.roe < 6 ? 'low' : x.m.roe < 10 ? 'mid' : ''}`}
                style={{ width: `${Math.max(2, x.m.roe / maxRoe * 100)}%` }} /></span>
              <span className="lb-val">ROE {pctf(x.m.roe)} · CoC {isFinite(x.m.coc) ? pctf(x.m.coc) : '—'} · {money(x.m.cfShare)}/mo</span>
            </div>
          ))}
        <div className={`lazy-note${lazy.length ? ' show' : ''}`}>
          {lazy.length > 0 && <>💤 Lazy equity: <b>{lazy.map(x => x.p.name || 'unnamed').join(', ')}</b> {lazy.length === 1 ? 'is' : 'are'} returning under 6% on {money0(lazy.reduce((a, x) => a + x.m.equityShare, 0))} of your equity — worth modeling a cash-out refi, HELOC, or 1031 into a stronger deal.</>}
        </div>
      </Card>

      <Card title="Properties" tag="Click a row to edit">
        <div className="pt-scroll">
          <div className="pt-head">
            <span /><span>Property</span><span className="r">Value</span><span className="r">Loan bal</span>
            <span className="r">Equity*</span><span className="r">CF /mo*</span><span className="r">CoC</span><span className="r">ROE</span><span /><span />
          </div>
          <div>
            {order.map((p, i) => {
              const x = metrics(p, now || Date.now());
              const subBits: string[] = [];
              if (p.dateAcq) subBits.push(`acquired ${p.dateAcq}${isFinite(x.holdYrs) ? ` · ${x.holdYrs.toFixed(1)} yrs` : ''}`);
              if ((p.ownPct || 100) !== 100) subBits.push(`${p.ownPct}% owned`);
              if (isFinite(x.appr)) subBits.push(`▲ ${x.appr.toFixed(0)}% since purchase`);
              return (
                <div className="pt-row" key={i} onClick={() => openModal(props.indexOf(p))}>
                  <span className="rank">{MEDALS[i] || ''}</span>
                  <span className="pname">{p.name || 'Unnamed property'}
                    {subBits.length > 0 && <span className="sub">{subBits.join(' · ')}</span>}</span>
                  <span className="c">{money0(p.value || 0)}</span>
                  <span className="c">{money0(p.loan || 0)}</span>
                  <span className={`c${x.equityShare < 0 ? ' neg' : ''}`}>{money(x.equityShare)}</span>
                  <span className={`c ${x.cfShare >= 0 ? 'pos' : 'neg'}`}>{money(x.cfShare)}</span>
                  <span className="c">{isFinite(x.coc) ? pctf(x.coc) : '—'}</span>
                  <span className={`c ${isFinite(x.roe) ? (x.roe >= 10 ? 'roe-hi' : x.roe < 6 ? 'roe-lo' : '') : ''}`}>{isFinite(x.roe) ? pctf(x.roe) : '—'}</span>
                  <button className="edit" title="Edit">✎</button>
                  <button className="del" title="Remove" onClick={ev => { ev.stopPropagation(); removeProp(p); }}>✕</button>
                </div>
              );
            })}
          </div>
        </div>
        {!props.length && <div className="empty-note" style={{ marginTop: 8 }}>No properties yet — hit “+ Add property”, or import a saved deal from the Rental Analyzer.</div>}
      </Card>

      <p className="footnote">* Equity and cash flow are shown as <strong>your share</strong> (scaled by ownership %). <strong>Cash-on-cash</strong> = annual net cash flow ÷ cash invested (down payment + additional cash in). <strong>Return on equity</strong> = (annual cash flow + annual principal paydown) ÷ current equity — how hard the money trapped in the property today is working. Low ROE with big equity = &quot;lazy equity&quot;: consider a cash-out refi, HELOC, or 1031 exchange.</p>

      {/* ---------- add / edit property pop-up ---------- */}
      <div className={`pmodal${modalOpen ? ' show' : ''}`} onClick={ev => { if (ev.target === ev.currentTarget) setModalOpen(false); }}>
        <div className="pmodal-card">
          <h3>{editing != null ? `Edit — ${props[editing]?.name || 'property'}` : 'Add property'}</h3>
          <div className="pm-sub">Every field feeds the dashboard — cash-on-cash and ROE compute live at the bottom.</div>

          <div className="pm-sec">Property</div>
          <div className="pm-field"><label>Nickname / address</label>
            <input type="text" className="plain" placeholder="e.g. 123 Main St duplex" value={m.name}
              autoComplete="off" onChange={ev => setField('name', ev.target.value)} /></div>
          <div className="pm-grid" style={{ marginTop: 8 }}>
            <div className="pm-field"><label>Date acquired</label>
              <input type="date" value={m.dateAcq} onChange={ev => setField('dateAcq', ev.target.value)} /></div>
            <div className="pm-field"><label>Ownership %</label>
              <NumInput value={m.ownPct} onChange={v => setField('ownPct', v || 100)} fmt="raw" className="num" /></div>
          </div>

          <div className="pm-sec">Basis &amp; Value</div>
          <div className="pm-grid">
            <div className="pm-field"><label>Purchase price</label>
              <NumInput value={m.price} onChange={v => setField('price', v)} className="num" /></div>
            <div className="pm-field"><label>Current market value</label>
              <NumInput value={m.value} onChange={v => setField('value', v)} className="num" /></div>
            <div className="pm-field"><label>Down payment</label>
              <NumInput value={m.down} onChange={v => setField('down', v)} className="num" /></div>
            <div className="pm-field"><label>Additional cash in <span style={{ fontWeight: 400 }}>(rehab, closing…)</span></label>
              <NumInput value={m.other} onChange={v => setField('other', v)} className="num" /></div>
          </div>

          <div className="pm-sec">Financing</div>
          <div className="pm-grid">
            <div className="pm-field"><label>Loan balance (today)</label>
              <NumInput value={m.loan} onChange={v => setField('loan', v)} className="num" /></div>
            <div className="pm-field"><label>Interest rate %</label>
              <NumInput value={m.rate} onChange={v => setField('rate', v)} fmt="raw" className="num" /></div>
            <div className="pm-field"><label>Monthly loan payment (P&amp;I)</label>
              <NumInput value={m.pay} onChange={v => setField('pay', v)} className="num" /></div>
          </div>

          <div className="pm-sec">Income &amp; Expenses</div>
          <div className="pm-grid">
            {unitField('income', 'Gross income')}
            {unitField('opex', <>Operating expenses <span style={{ fontWeight: 400 }}>(excl. tax &amp; ins.)</span></>)}
            {unitField('taxes', 'Property taxes')}
            {unitField('ins', 'Insurance')}
          </div>

          <div className="pm-computed">
            <div className="row-c">
              <label>Net cash flow /mo</label>
              <span className="pm-cf">
                <button className={`auto${m.cfOverride !== null ? ' off' : ''}`}
                  title="Computed from income − expenses − debt. Click to type your own number."
                  onClick={() => setField('cfOverride', null)}>
                  {m.cfOverride === null ? 'auto' : 'manual'}
                </button>
                <NumInput value={m.cfOverride ?? Math.round(mm.cfAuto)} onChange={v => setField('cfOverride', v)} className="num" />
              </span>
            </div>
            <div className="row-c"><label>Cash-on-cash return</label>
              <span className={`v${mm.coc < 0 ? ' neg' : ''}`}>{isFinite(mm.coc) ? pctf(mm.coc) : '—'}</span></div>
            <div className="row-c"><label>Return on equity</label>
              <span className={`v${mm.roe < 0 ? ' neg' : ''}`}>{isFinite(mm.roe) ? pctf(mm.roe) : '—'}</span></div>
            <div className="row-c"><label>Your equity</label>
              <span className={`v${mm.equityShare < 0 ? ' neg' : ''}`}>{money(mm.equityShare)}</span></div>
            <div className="row-c"><label>Appreciation since purchase</label>
              <span className={`v${mm.appr < 0 ? ' neg' : ''}`}>{isFinite(mm.appr) ? pctf(mm.appr, 0) : '—'}</span></div>
          </div>

          <div className="pm-actions">
            <button className="btn ghost" onClick={() => setModalOpen(false)}>Cancel</button>
            <button className="btn primary" onClick={saveModal}>Save property</button>
          </div>
        </div>
      </div>
    </>
  );
}
