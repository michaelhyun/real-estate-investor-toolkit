'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

export const TOOLS = [
  { id: 'rental', name: 'Rental Property Analyzer', href: '/rental',
    desc: 'Cash flow, cash-on-cash, DSCR & 5-year pro-forma' },
  { id: 'mortgage', name: 'Mortgage Calculator', href: '/mortgage',
    desc: 'Payment breakdown, amortization & extra-payment savings' },
  { id: 'portfolio', name: 'Portfolio ROE Dashboard', href: '/portfolio',
    desc: 'Equity, cash flow & return on equity across your rentals' },
];

export function Shell() {
  const pathname = usePathname();
  const current = TOOLS.find(t => pathname.startsWith(t.href)) || null;
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (ev: MouseEvent) => {
      if (!wrapRef.current?.contains(ev.target as Node)) setOpen(false);
    };
    document.addEventListener('click', onDoc);
    return () => document.removeEventListener('click', onDoc);
  }, []);

  useEffect(() => { setOpen(false); }, [pathname]);

  return (
    <header className="shell-bar">
      <Link className="shell-brand" href="/"><span className="dot" />Real Estate Investor <em>Toolkit</em></Link>
      <div className="shell-right">
        <div className="shell-switch-wrap" ref={wrapRef}>
          <button className="shell-switch" onClick={ev => { ev.stopPropagation(); setOpen(o => !o); }}>
            {current ? current.name : 'All tools'} ▾
          </button>
          <div className={`shell-menu${open ? ' open' : ''}`}>
            {TOOLS.map(t => (
              <Link key={t.id} href={t.href} className={current?.id === t.id ? 'cur' : ''}>
                <div className="sm-n">{t.name}</div>
                <div className="sm-d">{t.desc}</div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </header>
  );
}
