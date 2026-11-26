'use client';

/* Portfolio ROE Dashboard. Math lives in @reit/core; storage keys unchanged
   (portfolio.v1, reads rentalDeals.v3). Built from components/calc.

   Four headline figures, then one table that is also the leaderboard: rows
   are ranked, the top three are numbered, and the return on equity column
   carries a bar so the ranking reads at a glance. Adding or editing a
   property happens in a popup with the same field rows as the calculators. */

import { useEffect, useMemo, useState } from 'react';
import {
  metrics, migrate, monthlyPI, money, money0,
  type PropertyState, type UnitValue, type DealState,
} from '@reit/core';
import { loadJSON, saveJSON } from '../../components/ui';
import { Panel, Field, Line, SectionLabel, NumberField, Segmented, Stat, Note, InfoTip } from '../../components/calc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from '../../components/toast';
import { Icon } from '../../components/Icon';
import { cn } from '@/lib/utils';

const PKEY = 'portfolio.v1';
const RENTAL_DEALS_KEY = 'rentalDeals.v3';
/* Podium places are shown as a numbered badge. */
const PODIUM = 3;
/* Under this return on equity, with real equity behind it, a property is "lazy". */
const LAZY_ROE = 6, LAZY_EQUITY = 25000;
const pctf = (n: number, d = 1) => (isFinite(n) ? n.toFixed(d) : '—') + '%';

type SortBy = 'roe' | 'coc' | 'cf' | 'equity';
type UnitKey = 'income' | 'opex' | 'taxes' | 'ins';

const EMPTY: PropertyState = {
  name: '', dateAcq: '', ownPct: 100, price: 0, down: 0, other: 0,
  value: 0, loan: 0, rate: 0, pay: 0,
  income: { v: 0, unit: 'mo' }, opex: { v: 0, unit: 'mo' },
  taxes: { v: 0, unit: 'mo' }, ins: { v: 0, unit: 'mo' }, cfOverride: null,
};

export default function PortfolioPage() {
  const [props, setProps] = useState<PropertyState[]>([]);
  const [deals, setDeals] = useState<DealState[]>([]);
  const [sortBy, setSortBy] = useState<SortBy>('roe');
  const [hydrated, setHydrated] = useState(false);
  const [now, setNow] = useState(0);

  /* add / edit popup */
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
  const setUnitValue = (k: UnitKey, uv: UnitValue) => setM(prev => ({ ...prev, [k]: uv }));

  const at = now || Date.now();
  const mm = useMemo(() => metrics(m, at), [m, at]);

  const sortKey = (p: PropertyState) => {
    const x = metrics(p, at);
    return sortBy === 'coc' ? (isFinite(x.coc) ? x.coc : -1e9)
      : sortBy === 'cf' ? x.cfShare
      : sortBy === 'equity' ? x.equityShare
      : (isFinite(x.roe) ? x.roe : -1e9);
  };
  const rows = useMemo(() => [...props].sort((a, b) => sortKey(b) - sortKey(a)).map(p => ({ p, x: metrics(p, at) })),
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
    [props, sortBy, at]);

  let tv = 0, teq = 0, tcf = 0, tinv = 0, tret = 0;
  rows.forEach(({ p, x }) => {
    tv += (p.value || 0) * x.own;
    teq += x.equityShare;
    tcf += x.cfShare;
    tinv += ((p.down || 0) + (p.other || 0)) * x.own;
    tret += (x.cfY + x.paydownY) * x.own;
  });
  const bRoe = teq > 0 ? tret / teq * 100 : NaN;
  const bCoc = tinv > 0 ? (tcf * 12) / tinv * 100 : NaN;

  const maxRoe = Math.max(...rows.filter(r => isFinite(r.x.roe)).map(r => r.x.roe), 1);
  const isLazy = (x: ReturnType<typeof metrics>) => isFinite(x.roe) && x.roe < LAZY_ROE && x.equityShare > LAZY_EQUITY;
  const lazy = rows.filter(r => isLazy(r.x));

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
    toast('Deal loaded. Add the remaining operating expenses, then save');
  };

  /* a money row that can be typed per month or per year */
  const unitField = (key: UnitKey, label: string, info?: string) => (
    <Field label={label} info={info}>
      <div className="flex items-center gap-1.5">
        <Segmented options={[{ u: 'mo', label: '/mo' }, { u: 'yr', label: '/yr' }]} value={m[key].unit}
          onChange={u => {
            const cur = m[key];
            if (cur.unit !== u && cur.v) setUnitValue(key, { v: u === 'yr' ? Math.round(cur.v * 12) : Math.round(cur.v / 12), unit: u as 'mo' | 'yr' });
            else setUnitValue(key, { ...cur, unit: u as 'mo' | 'yr' });
          }} />
        <NumberField value={m[key].v} onChange={v => setUnitValue(key, { ...m[key], v })} />
      </div>
    </Field>
  );
  const $ = (k: 'price' | 'value' | 'down' | 'other' | 'loan' | 'pay') => <NumberField value={m[k]} onChange={v => setField(k, v)} />;

  const th = 'px-3 py-2 text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground whitespace-nowrap';
  const td = 'px-3 py-2.5 text-right tabular-nums whitespace-nowrap';
  const place = 'inline-grid size-6 place-items-center rounded-full bg-primary-tint text-xs font-bold text-primary-deep';

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[1.75rem] font-extrabold leading-tight tracking-[-0.015em] text-ink-strong">Portfolio</h1>
        <div className="flex flex-wrap items-center gap-2">
          {deals.length > 0 && (
            <NativeSelect className="w-56" value="" aria-label="Import from a saved deal" onChange={ev => importDeal(ev.target.value)}>
              <option value="">Import from a saved deal…</option>
              {deals.map((d, i) => <option key={i} value={i}>{d.name} · {money0(d.price)}</option>)}
            </NativeSelect>
          )}
          <Button onClick={() => openModal(null)}><Icon name="add" size={18} />Add property</Button>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 min-[1100px]:grid-cols-4">
        <Stat label="Portfolio Value" value={props.length ? money0(tv) : '—'}
          note={`your share of ${props.length} propert${props.length === 1 ? 'y' : 'ies'}`} />
        <Stat label="Your Equity" value={props.length ? money0(teq) : '—'}
          note={tv > 0 ? `${Math.round(teq / tv * 100)}% of portfolio value` : 'value less loans'} />
        <Stat label="Monthly Cash Flow" value={props.length ? money(tcf) : '—'} tone={!props.length ? undefined : tcf >= 0 ? 'pos' : 'neg'}
          note="your share, after debt" />
        <Stat label="Blended ROE" value={props.length && isFinite(bRoe) ? pctf(bRoe) : '—'}
          note={isFinite(bCoc) ? `blended cash-on-cash ${pctf(bCoc)}` : 'return on equity'}
          info="Return on equity: a year of cash flow plus loan paydown, divided by the equity in the property today. It shows how hard the money tied up there is working." />
      </div>

      {lazy.length > 0 && (
        <Note tone="warn" icon="hourglass_bottom" title={`Lazy equity: ${lazy.map(r => r.p.name || 'unnamed').join(', ')}`}>
          Returning under {LAZY_ROE}% on {money0(lazy.reduce((a, r) => a + r.x.equityShare, 0))} of your equity.
          Worth modeling a cash-out refinance, a HELOC, or a 1031 exchange into a stronger deal.
        </Note>
      )}

      <Panel title="Properties" className="mt-4"
        tag={rows.length > 1 ? (
          <span className="flex items-center gap-2 font-normal">
            <label htmlFor="rank-by" className="sr-only">Rank by</label>
            <NativeSelect id="rank-by" size="sm" className="w-44" value={sortBy} onChange={ev => setSortBy(ev.target.value as SortBy)}>
              <option value="roe">Rank by ROE</option>
              <option value="coc">Rank by cash-on-cash</option>
              <option value="cf">Rank by cash flow</option>
              <option value="equity">Rank by equity</option>
            </NativeSelect>
          </span>
        ) : undefined}>
        {!rows.length ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <Icon name="home_work" size={28} className="text-muted-foreground" />
            <p className="text-[0.9375rem] text-[#3a4352]">No properties yet.</p>
            <p className="max-w-sm text-[0.8125rem] text-muted-foreground">Add one by hand{deals.length ? ', or import a deal you saved in the Rental Analyzer' : ''}. Everything stays on this device.</p>
            <Button className="mt-1" onClick={() => openModal(null)}><Icon name="add" size={18} />Add property</Button>
          </div>
        ) : (
          <div className="-mx-4 overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-line">
                  <th scope="col" className={cn(th, 'w-10 pl-4 text-left')}><span className="sr-only">Rank</span></th>
                  <th scope="col" className={cn(th, 'text-left')}>Property</th>
                  <th scope="col" className={cn(th, 'text-right')}>Value</th>
                  <th scope="col" className={cn(th, 'text-right')}>Loan</th>
                  <th scope="col" className={cn(th, 'text-right')}>Equity<InfoTip>Value less the loan, times your ownership share.</InfoTip></th>
                  <th scope="col" className={cn(th, 'text-right')}>Cash flow<InfoTip>Per month, your share, after the loan payment.</InfoTip></th>
                  <th scope="col" className={cn(th, 'text-right')}>CoC<InfoTip>Cash-on-cash: a year of cash flow divided by the cash you put in (down payment plus rehab and closing).</InfoTip></th>
                  <th scope="col" className={cn(th, 'w-36 text-right')}>ROE<InfoTip>Return on equity: a year of cash flow plus loan paydown, divided by today&apos;s equity. Low ROE on a lot of equity is lazy equity.</InfoTip></th>
                  <th scope="col" className={cn(th, 'w-20 pr-4')}><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ p, x }, i) => {
                  const sub: string[] = [];
                  if (p.dateAcq) sub.push(`acquired ${p.dateAcq}${isFinite(x.holdYrs) ? ` · ${x.holdYrs.toFixed(1)} yrs` : ''}`);
                  if ((p.ownPct || 100) !== 100) sub.push(`${p.ownPct}% owned`);
                  if (isFinite(x.appr)) sub.push(`${x.appr >= 0 ? 'up' : 'down'} ${Math.abs(x.appr).toFixed(0)}% since purchase`);
                  const low = isLazy(x);
                  const edit = () => openModal(props.indexOf(p));
                  return (
                    <tr key={i} onClick={edit} className="cursor-pointer border-b border-line/60 last:border-b-0 hover:bg-muted/50">
                      <td className="py-2.5 pl-4 pr-1">{i < PODIUM && isFinite(x.roe) ? <span className={place}>{i + 1}</span> : null}</td>
                      <th scope="row" className="px-3 py-2.5 text-left font-normal">
                        <span className="block font-bold text-ink-strong">{p.name || 'Unnamed property'}</span>
                        {sub.length > 0 && <span className="block text-[0.8125rem] text-muted-foreground">{sub.join(' · ')}</span>}
                      </th>
                      <td className={td}>{money0(p.value || 0)}</td>
                      <td className={td}>{money0(p.loan || 0)}</td>
                      <td className={cn(td, 'font-semibold', x.equityShare < 0 ? 'text-destructive' : 'text-ink-strong')}>{money(x.equityShare)}</td>
                      <td className={cn(td, 'font-semibold', x.cfShare >= 0 ? 'text-success' : 'text-destructive')}>{money(x.cfShare)}</td>
                      <td className={td}>{isFinite(x.coc) ? pctf(x.coc) : '—'}</td>
                      <td className={cn(td, 'font-bold', low ? 'text-warning' : 'text-ink-strong')}>
                        {isFinite(x.roe) ? pctf(x.roe) : '—'}
                        {isFinite(x.roe) && (
                          <span aria-hidden className="mt-1 block h-1 overflow-hidden rounded-full bg-line/70">
                            <span className={cn('ml-auto block h-full rounded-full', low ? 'bg-warning' : 'bg-primary')} style={{ width: `${Math.max(3, Math.min(100, x.roe / maxRoe * 100))}%` }} />
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 pl-1 pr-3 text-right">
                        <span className="inline-flex">
                          <Button variant="ghost" size="icon-sm" aria-label={`Edit ${p.name || 'property'}`} title="Edit"
                            onClick={ev => { ev.stopPropagation(); edit(); }}><Icon name="edit" size={16} /></Button>
                          <Button variant="ghost" size="icon-sm" aria-label={`Remove ${p.name || 'property'}`} title="Remove"
                            className="text-muted-foreground hover:bg-destructive-soft hover:text-destructive"
                            onClick={ev => { ev.stopPropagation(); removeProp(p); }}><Icon name="close" size={16} /></Button>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* ---------- add / edit property popup ---------- */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{editing != null ? `Edit ${props[editing]?.name || 'property'}` : 'Add property'}</DialogTitle>
            <DialogDescription>The returns on the right update as you type.</DialogDescription>
          </DialogHeader>

          <div className="grid items-start gap-x-8 gap-y-2 md:grid-cols-2">
            <div className="min-w-0">
              <SectionLabel>Property</SectionLabel>
              <Field label="Name or address">
                <Input className="h-[30px] w-48 shrink-0 px-2" value={m.name} placeholder="123 Main St duplex" autoComplete="off"
                  aria-label="Name or address" onChange={ev => setField('name', ev.target.value)} />
              </Field>
              <Field label="Date acquired">
                <Input type="date" className="h-[30px] w-36 shrink-0 px-2 tabular-nums" value={m.dateAcq} aria-label="Date acquired"
                  onChange={ev => setField('dateAcq', ev.target.value)} />
              </Field>
              <Field label="Ownership" info="Your share. Equity and cash flow on the dashboard are scaled by it.">
                <NumberField value={m.ownPct} onChange={v => setField('ownPct', v || 100)} fmt="raw" suffix="%" /></Field>

              <SectionLabel>Basis and value</SectionLabel>
              <Field label="Purchase price">{$('price')}</Field>
              <Field label="Current market value">{$('value')}</Field>
              <Field label="Down payment">{$('down')}</Field>
              <Field label="Additional cash in" info="Rehab, closing costs and anything else you put in. Counts toward cash-on-cash.">{$('other')}</Field>

              <SectionLabel>Financing</SectionLabel>
              <Field label="Loan balance today">{$('loan')}</Field>
              <Field label="Interest rate">
                <NumberField value={m.rate} onChange={v => setField('rate', v)} fmt="raw" suffix="%" /></Field>
              <Field label="Monthly payment" info="Principal and interest only. Taxes and insurance go on the right.">{$('pay')}</Field>
            </div>

            <div className="min-w-0">
              <SectionLabel>Income and expenses</SectionLabel>
              {unitField('income', 'Gross income')}
              {unitField('opex', 'Operating expenses', 'Everything except property tax and insurance, which have their own rows.')}
              {unitField('taxes', 'Property taxes')}
              {unitField('ins', 'Insurance')}

              <SectionLabel>Returns</SectionLabel>
              <Field label="Net cash flow / mo"
                info="Worked out from income less expenses and the loan payment. Type a number to use your own; Auto goes back to the computed one.">
                <div className="flex items-center gap-1.5">
                  {m.cfOverride !== null && <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setField('cfOverride', null)}>Auto</Button>}
                  <NumberField value={m.cfOverride ?? Math.round(mm.cfAuto)} onChange={v => setField('cfOverride', v)} />
                </div>
              </Field>
              <Line label="Cash-on-cash return" value={isFinite(mm.coc) ? pctf(mm.coc) : '—'} tone={mm.coc < 0 ? 'neg' : undefined} />
              <Line label="Return on equity" value={isFinite(mm.roe) ? pctf(mm.roe) : '—'} tone={mm.roe < 0 ? 'neg' : undefined} />
              <Line label="Your equity" value={money(mm.equityShare)} tone={mm.equityShare < 0 ? 'neg' : undefined} />
              <Line label="Appreciation since purchase" value={isFinite(mm.appr) ? pctf(mm.appr, 0) : '—'} tone={mm.appr < 0 ? 'neg' : undefined} />
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button onClick={saveModal}>Save property</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
