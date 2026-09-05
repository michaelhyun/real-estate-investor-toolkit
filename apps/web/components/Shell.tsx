'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './auth';

export const TOOLS = [
  { id: 'rental', name: 'Rental Property Analyzer', href: '/rental',
    desc: 'Cash flow, cash-on-cash, DSCR & 5-year pro-forma' },
  { id: 'mortgage', name: 'Mortgage Calculator', href: '/mortgage',
    desc: 'Payment breakdown, amortization & extra-payment savings' },
  { id: 'flip', name: 'Flip Analyzer', href: '/flip',
    desc: 'Scenarios, sensitivity & a trade-by-trade rehab checklist' },
  { id: 'renovations', name: 'Renovation Guide', href: '/renovations',
    desc: 'What 50 common Bay Area renovations actually cost' },
  { id: 'portfolio', name: 'Portfolio ROE Dashboard', href: '/portfolio',
    desc: 'Equity, cash flow & return on equity across your rentals' },
];

export function Shell() {
  const pathname = usePathname();
  const current = TOOLS.find(t => pathname.startsWith(t.href)) || null;
  const { user, ready } = useAuth();
  const [open, setOpen] = useState(false);
  const [acctOpen, setAcctOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const acctRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (ev: MouseEvent) => {
      if (!wrapRef.current?.contains(ev.target as Node)) setOpen(false);
      if (!acctRef.current?.contains(ev.target as Node)) setAcctOpen(false);
    };
    document.addEventListener('click', onDoc);
    return () => document.removeEventListener('click', onDoc);
  }, []);

  useEffect(() => { setOpen(false); setAcctOpen(false); }, [pathname]);

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
        {/* account — only when a backend is configured and the session is restored */}
        {supabase && ready && (user ? (
          <div className="shell-switch-wrap" ref={acctRef}>
            <button className="shell-switch acct" title="Account"
              onClick={ev => { ev.stopPropagation(); setAcctOpen(o => !o); }}>
              {user.email} ▾
            </button>
            <div className={`shell-menu acct-menu${acctOpen ? ' open' : ''}`}>
              <div className="am-note">Saved deals back up to this account and follow it to any device.</div>
              <button className="am-signout" onClick={() => { supabase?.auth.signOut(); setAcctOpen(false); }}>
                Sign out
              </button>
            </div>
          </div>
        ) : (
          <Link className="shell-switch signin" href="/login">Sign in</Link>
        ))}
      </div>
    </header>
  );
}
