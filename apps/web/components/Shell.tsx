'use client';

/* App shell — sidebar on desktop, top bar on a phone.

   The design system's shell hides the sidebar below 800px and puts nothing in
   its place. That works for a one-page demo; a toolkit with five tools needs
   the nav to survive, so the sidebar is mirrored into a sticky top bar with
   the same tool list behind a switcher. */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './auth';

export const TOOLS = [
  { id: 'rental', name: 'Rental Property Analyzer', short: 'Rental', href: '/rental', group: 'Calculators',
    desc: 'Cash flow, cash-on-cash, DSCR & 5-year pro-forma' },
  { id: 'mortgage', name: 'Mortgage Calculator', short: 'Mortgage', href: '/mortgage', group: 'Calculators',
    desc: 'Payment breakdown, amortization & extra-payment savings' },
  { id: 'flip', name: 'Flip Analyzer', short: 'Flip', href: '/flip', group: 'Calculators',
    desc: 'Scenarios, sensitivity & a room-by-room scope of work' },
  { id: 'tax', name: 'Income Tax Calculator', short: 'Income Tax', href: '/tax', group: 'Calculators',
    desc: 'Federal & California, marginal vs effective, capital gains' },
  { id: 'renovations', name: 'Renovation Guide', short: 'Renovation Guide', href: '/renovations', group: 'Guides',
    desc: 'What 50 common Bay Area renovations actually cost' },
  { id: 'portfolio', name: 'Portfolio ROE Dashboard', short: 'Portfolio', href: '/portfolio', group: 'Portfolio',
    desc: 'Equity, cash flow & return on equity across your rentals' },
];

const GROUPS = ['Calculators', 'Guides', 'Portfolio'];

function Account({ compact }: { compact?: boolean }) {
  const { user, ready } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (ev: MouseEvent) => { if (!ref.current?.contains(ev.target as Node)) setOpen(false); };
    document.addEventListener('click', onDoc);
    return () => document.removeEventListener('click', onDoc);
  }, []);
  if (!supabase || !ready) return null;
  if (!user) return <Link className="shell-switch signin" href="/login">Sign in</Link>;
  return (
    <div className="shell-switch-wrap" ref={ref}>
      <button className="shell-switch acct" title={user.email ?? 'Account'}
        onClick={ev => { ev.stopPropagation(); setOpen(o => !o); }}>
        {compact ? 'Account' : user.email} ▾
      </button>
      <div className={`shell-menu acct-menu${open ? ' open' : ''}`}>
        <div className="am-note">Saved deals back up to this account and follow it to any device.</div>
        <button className="am-signout" onClick={() => { supabase?.auth.signOut(); setOpen(false); }}>Sign out</button>
      </div>
    </div>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const current = TOOLS.find(t => pathname.startsWith(t.href)) || null;
  const [navOpen, setNavOpen] = useState(false);
  const navRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (ev: MouseEvent) => { if (!navRef.current?.contains(ev.target as Node)) setNavOpen(false); };
    document.addEventListener('click', onDoc);
    return () => document.removeEventListener('click', onDoc);
  }, []);
  useEffect(() => { setNavOpen(false); }, [pathname]);

  return (
    <div className="rt-shell">
      <nav className="rt-sidebar">
        <Link className="rt-sidebar__brand" href="/" style={{ color: 'inherit', textDecoration: 'none' }}>
          Investor Toolkit
        </Link>
        {GROUPS.map(g => (
          <div key={g}>
            <div className="rt-sidebar__section">{g}</div>
            {TOOLS.filter(t => t.group === g).map(t => (
              <Link key={t.id} href={t.href} className="rt-navitem"
                aria-current={current?.id === t.id ? 'page' : undefined}>{t.short}</Link>
            ))}
          </div>
        ))}
        <div className="rt-sidebar__foot"><Account /></div>
      </nav>

      <div style={{ minWidth: 0 }}>
        <div className="rt-mobilebar">
          <Link className="rt-mobilebar__brand" href="/">Investor Toolkit</Link>
          <div className="rt-mobilebar__right">
            <div className="shell-switch-wrap" ref={navRef}>
              <button className="shell-switch" onClick={ev => { ev.stopPropagation(); setNavOpen(o => !o); }}>
                {current ? current.short : 'All tools'} ▾
              </button>
              <div className={`shell-menu${navOpen ? ' open' : ''}`}>
                {TOOLS.map(t => (
                  <Link key={t.id} href={t.href} className={current?.id === t.id ? 'cur' : ''}>
                    <div className="sm-n">{t.name}</div>
                    <div className="sm-d">{t.desc}</div>
                  </Link>
                ))}
              </div>
            </div>
            <Account compact />
          </div>
        </div>
        <main className="rt-main">{children}</main>
      </div>
    </div>
  );
}
