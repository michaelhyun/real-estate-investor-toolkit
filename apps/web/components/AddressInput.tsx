'use client';

/* Address field with type-ahead suggestions.

   Suggestions come from Photon (photon.komoot.io), an OpenStreetMap geocoder
   built for type-ahead: no API key, CORS enabled, and — unlike Nominatim —
   its usage policy actually permits autocomplete. Nothing else in the toolkit
   talks to the network, so this is the one outbound call: the characters typed
   here are sent to that service to be matched. Everything else, including the
   saved deals, stays in the browser.

   The lookup is strictly an enhancement. Requests are debounced, only fire
   while the field has focus, and any failure — offline, blocked, rate-limited —
   is swallowed, leaving an ordinary text input that works exactly as before. */

import { useEffect, useRef, useState } from 'react';

const ENDPOINT = 'https://photon.komoot.io/api/';
const MIN_CHARS = 4;
const DEBOUNCE_MS = 280;

interface Suggestion { line1: string; line2: string; full: string; key: string }

/* OSM spells states out in full ("District of Columbia"), which makes for a very
   long deal title. Abbreviate so addresses read the way people write them. */
const STATES: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', 'district of columbia': 'DC',
  florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL',
  indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA',
  maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN',
  mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK',
  oregon: 'OR', pennsylvania: 'PA', 'puerto rico': 'PR', 'rhode island': 'RI',
  'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX',
  utah: 'UT', vermont: 'VT', virginia: 'VA', washington: 'WA',
  'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
};

/* Photon returns GeoJSON; fold one feature into a single-line US-style address */
function toSuggestion(f: any, i: number): Suggestion | null {
  const p = f?.properties;
  if (!p) return null;
  const street = [p.housenumber, p.street].filter(Boolean).join(' ');
  const line1 = street || p.name || '';
  if (!line1) return null;

  const city = p.city || p.district || p.county || '';
  const state = p.state ? (STATES[String(p.state).toLowerCase()] || p.state) : '';
  /* "Springfield, IL 62704" — no comma between state and ZIP */
  const tail = [state, p.postcode].filter(Boolean).join(' ');
  const line2 = [city, tail].filter(Boolean).join(', ');

  return {
    line1, line2,
    full: [line1, line2].filter(Boolean).join(', '),
    key: `${p.osm_type || ''}${p.osm_id || i}-${i}`,
  };
}

export function AddressInput({
  value, onChange, placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [items, setItems] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [focused, setFocused] = useState(false);
  const skipNext = useRef(false);          /* don't re-query the text we just inserted */
  const abortRef = useRef<AbortController | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!focused) return;
    if (skipNext.current) { skipNext.current = false; return; }
    const q = value.trim();
    if (q.length < MIN_CHARS) { setItems([]); setOpen(false); return; }

    const timer = setTimeout(() => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      fetch(`${ENDPOINT}?limit=6&lang=en&q=${encodeURIComponent(q)}`, { signal: ac.signal })
        .then(res => res.ok ? res.json() : Promise.reject(new Error(String(res.status))))
        .then(json => {
          const list = (json?.features || []).map(toSuggestion).filter(Boolean) as Suggestion[];
          /* de-dupe — Photon happily returns the same address twice */
          const seen = new Set<string>();
          const uniq = list.filter(s => !seen.has(s.full) && seen.add(s.full));
          setItems(uniq);
          setActive(-1);
          setOpen(uniq.length > 0);
        })
        .catch(() => { /* offline, blocked or rate-limited — stay a plain text field */ });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [value, focused]);

  /* close when the click lands outside */
  useEffect(() => {
    const onDoc = (ev: MouseEvent) => {
      if (!wrapRef.current?.contains(ev.target as Node)) setOpen(false);
    };
    document.addEventListener('click', onDoc);
    return () => document.removeEventListener('click', onDoc);
  }, []);

  function choose(s: Suggestion) {
    skipNext.current = true;
    onChange(s.full);
    setOpen(false);
    setItems([]);
    setActive(-1);
  }

  function onKeyDown(ev: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || !items.length) {
      if (ev.key === 'Enter') ev.currentTarget.blur();
      return;
    }
    if (ev.key === 'ArrowDown') { ev.preventDefault(); setActive(a => (a + 1) % items.length); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); setActive(a => (a <= 0 ? items.length : a) - 1); }
    else if (ev.key === 'Enter') {
      ev.preventDefault();
      if (active >= 0) choose(items[active]); else { setOpen(false); ev.currentTarget.blur(); }
    } else if (ev.key === 'Escape') { setOpen(false); setActive(-1); }
  }

  return (
    <div className="addr-wrap" ref={wrapRef}>
      <input
        className="addr-input"
        type="text"
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        aria-autocomplete="list"
        aria-expanded={open}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={ev => onChange(ev.target.value)}
        onKeyDown={onKeyDown}
      />
      {open && items.length > 0 && (
        <div className="addr-menu" role="listbox">
          {items.map((s, i) => (
            <div
              key={s.key}
              role="option"
              aria-selected={i === active}
              className={`addr-item${i === active ? ' on' : ''}`}
              onMouseEnter={() => setActive(i)}
              /* mousedown, not click — it fires before the input blurs */
              onMouseDown={ev => { ev.preventDefault(); choose(s); }}
            >
              <div className="a1">{s.line1}</div>
              {s.line2 && <div className="a2">{s.line2}</div>}
            </div>
          ))}
          <div className="addr-foot">Addresses from OpenStreetMap · ↑↓ to pick, Esc to dismiss</div>
        </div>
      )}
    </div>
  );
}
