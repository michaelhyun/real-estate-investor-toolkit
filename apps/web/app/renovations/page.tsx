'use client';

/* Renovation Guide — a reference, not a calculator.

   The other three tabs of the toolkit ask you for numbers. This one gives them
   to you: fifty renovations, what they cost in the Bay Area, and the two things
   a cost table normally leaves out — what moves the price within the range, and
   what catches people out.

   Notes are always visible rather than hidden behind a disclosure. They are the
   reason to open the page; search and the category filter are what keep the
   list short enough for that to work. */

import { useMemo, useState } from 'react';
import {
  RENOVATIONS, RENO_CATEGORIES, PERMIT_LABEL, RESALE_LABEL,
  searchRenovations, countByCategory, money0,
  type RenoCategory, type RenoItem,
} from '@reit/core';

const range = (lo: number, hi: number) => `${money0(lo)}–${money0(hi)}`;

function Card({ i }: { i: RenoItem }) {
  const wholeJob = i.unitLow === i.projectLow && i.unitHigh === i.projectHigh;
  return (
    <article className="rg-card">
      <header>
        <span className="rg-cat">{i.category}</span>
        <span className={`rg-tag permit-${i.permit}`}>{PERMIT_LABEL[i.permit]}</span>
        <span className={`rg-tag resale-${i.resale}`}>{RESALE_LABEL[i.resale]}</span>
      </header>
      <h3>{i.name}</h3>
      {/* Where the work is priced as one job, the unit price and the whole-job
          range are the same number — show it once rather than twice. */}
      <div className={`rg-nums${wholeJob ? ' two' : ''}`}>
        <div><span className="k">{wholeJob ? 'Typical cost' : 'Unit cost'}</span>
          <span className="v">{range(i.unitLow, i.unitHigh)}</span>
          <span className="s">per {i.unit}</span></div>
        {!wholeJob && (
          <div><span className="k">Typical job</span>
            <span className="v">{range(i.projectLow, i.projectHigh)}</span>
            <span className="s">1,500 sqft home</span></div>
        )}
        <div><span className="k">Time on site</span>
          <span className="v small">{i.days}</span></div>
      </div>
      <p className="rg-note"><b>What moves the price</b> {i.drivers}</p>
      <p className="rg-note watch"><b>Watch out</b> {i.watch}</p>
    </article>
  );
}

export default function RenovationsPage() {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<RenoCategory | 'all'>('all');
  const counts = useMemo(() => countByCategory(), []);
  const results = useMemo(() => searchRenovations(q, cat), [q, cat]);

  return (
    <>
      <div className="tool-title">
        <h1>Renovation Guide</h1>
        <span className="rg-count">{results.length} of {RENOVATIONS.length}</span>
      </div>
      <p className="rg-intro">
        What fifty common renovations actually cost in the Bay Area, where labour runs well above
        national averages and permitting is its own line item. Each entry carries a unit price —
        what a contractor quotes — and a whole-job range for a typical 1,500 sqft single-family
        home, because that is the number people are really asking for. Search covers the notes too,
        so looking up <em>asbestos</em> or <em>PG&amp;E</em> finds the entry that warns about it.
      </p>

      <div className="rg-controls">
        <input className="rg-search" type="search" value={q} placeholder="Search renovations, materials or warnings…"
          onChange={ev => setQ(ev.target.value)} autoComplete="off" />
        <div className="rg-cats">
          <button className={`rg-chip${cat === 'all' ? ' on' : ''}`} onClick={() => setCat('all')}>
            All <span>{RENOVATIONS.length}</span></button>
          {RENO_CATEGORIES.map(c => (
            <button key={c} className={`rg-chip${cat === c ? ' on' : ''}`} onClick={() => setCat(c)}>
              {c} <span>{counts[c] ?? 0}</span></button>
          ))}
        </div>
      </div>

      {results.length === 0 ? (
        <div className="rg-empty">
          Nothing matches <b>{q}</b>{cat !== 'all' && <> in {cat}</>}. Try a broader term, or
          <button className="rg-reset" onClick={() => { setQ(''); setCat('all'); }}>clear the filters</button>.
        </div>
      ) : (
        <div className="rg-list">{results.map(i => <Card key={i.id} i={i} />)}</div>
      )}

      <p className="footnote">
        Current-market estimates for budgeting and screening, not quotes. Costs move with materials,
        labour availability and the city you are in — a job in Palo Alto and the same job in Hayward
        are not the same price. Always get three bids before committing, and treat any bid far below
        the range here as a question rather than a bargain.
      </p>
    </>
  );
}
