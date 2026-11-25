'use client';

/* App shell — BlueDoor's navy sidebar on desktop, a navy top bar on a phone.

   Below 900px the sidebar gives way to a sticky top bar with the same tool
   list behind a menu button, so the nav survives on a phone. */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './auth';
import { Icon } from './Icon';
import { LogoMark } from './Logo';
import { TOOLS, GROUPS } from '../lib/tools';

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
  const pill = 'inline-flex h-9 items-center gap-2 rounded-full px-3 text-sm font-semibold text-white/80 no-underline transition-colors hover:bg-white/10 hover:text-white hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white';
  if (!user) {
    return (
      <Link className={pill} href="/login">
        <Icon name="login" size={18} />Sign in
      </Link>
    );
  }
  return (
    <div className="relative min-w-0" ref={ref}>
      <button type="button" className={`${pill} max-w-full`} title={user.email ?? 'Account'} aria-expanded={open}
        onClick={ev => { ev.stopPropagation(); setOpen(o => !o); }}>
        <Icon name="account_circle" size={18} />
        <span className="truncate">{compact ? 'Account' : user.email}</span>
      </button>
      {open && (
        <div className={`absolute z-50 w-64 rounded-lg bg-card p-1.5 text-foreground shadow-fluffy ${compact ? 'right-0 top-[calc(100%+8px)]' : 'bottom-[calc(100%+8px)] left-0'}`}>
          <p className="px-2.5 py-2 text-[0.8125rem] leading-snug text-muted-foreground">Saved deals back up to this account and follow it to any device.</p>
          <button type="button" className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm font-semibold text-destructive hover:bg-destructive-soft"
            onClick={() => { supabase?.auth.signOut(); setOpen(false); }}>
            <Icon name="logout" size={18} />Sign out
          </button>
        </div>
      )}
    </div>
  );
}

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5 rounded-md text-white no-underline hover:text-white hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white">
      <LogoMark size={32} />
      <span>
        <span className="block text-lg font-extrabold leading-none tracking-[-0.015em]">BlueDoor</span>
        <span className="mt-1 block text-[0.625rem] font-bold uppercase leading-none tracking-[0.1em] text-sun">Investor Toolkit</span>
      </span>
    </Link>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const current = TOOLS.find(t => pathname.startsWith(t.href)) || null;
  const [navOpen, setNavOpen] = useState(false);
  const navRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (ev: MouseEvent) => { if (!navRef.current?.contains(ev.target as Node)) setNavOpen(false); };
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') setNavOpen(false); };
    document.addEventListener('click', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('click', onDoc); document.removeEventListener('keydown', onKey); };
  }, []);
  useEffect(() => { setNavOpen(false); }, [pathname]);

  const item = (on: boolean) =>
    `flex items-center gap-3 rounded-full px-3 py-2 text-[0.9375rem] font-semibold no-underline transition-colors hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${
      on ? 'bg-primary text-white shadow-[0_2px_8px_rgba(60,91,246,0.45)] hover:text-white'
         : 'text-white/75 hover:bg-white/10 hover:text-white'}`;

  return (
    <div className="min-h-screen min-[900px]:grid min-[900px]:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-screen flex-col bg-navy text-white/75 min-[900px]:flex print:hidden">
        <div className="px-5 py-6"><Brand /></div>
        <nav aria-label="Tools" className="flex flex-1 flex-col gap-5 overflow-y-auto px-3">
          {GROUPS.map(g => (
            <div key={g} className="flex flex-col gap-0.5">
              <div className="px-3 pb-1.5 text-[0.6875rem] font-bold uppercase tracking-[0.08em] text-white/60">{g}</div>
              {TOOLS.filter(t => t.group === g).map(t => {
                const on = current?.id === t.id;
                return (
                  <Link key={t.id} href={t.href} className={item(on)} aria-current={on ? 'page' : undefined}>
                    <Icon name={t.icon} size={20} className={on ? '' : 'text-white/60'} />
                    {t.short}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="border-t border-white/10 p-3"><Account /></div>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-40 flex items-center justify-between gap-3 bg-navy px-4 py-2.5 min-[900px]:hidden print:hidden">
          <Brand />
          <div className="flex items-center gap-1">
            <Account compact />
            <div className="relative" ref={navRef}>
              <button type="button" aria-expanded={navOpen} aria-controls="tool-menu"
                className="inline-flex h-9 items-center gap-1.5 rounded-full bg-white/10 pl-3.5 pr-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                onClick={ev => { ev.stopPropagation(); setNavOpen(o => !o); }}>
                {current ? current.short : 'Tools'}
                <Icon name="expand_more" size={18} className={`transition-transform ${navOpen ? 'rotate-180' : ''}`} />
              </button>
              {navOpen && (
                <nav id="tool-menu" aria-label="Tools" className="absolute right-0 top-[calc(100%+8px)] z-50 w-[min(20rem,calc(100vw-2rem))] rounded-lg bg-card p-1.5 shadow-fluffy">
                  {TOOLS.map(t => {
                    const on = current?.id === t.id;
                    return (
                      <Link key={t.id} href={t.href} aria-current={on ? 'page' : undefined}
                        className={`flex items-start gap-3 rounded-md px-2.5 py-2 no-underline hover:no-underline ${on ? 'bg-primary-soft' : 'hover:bg-muted'}`}>
                        <Icon name={t.icon} size={20} className={`mt-0.5 ${on ? 'text-primary-deep' : 'text-muted-foreground'}`} />
                        <span>
                          <span className={`block text-[0.9375rem] font-bold leading-snug ${on ? 'text-primary-deep' : 'text-ink-strong'}`}>{t.name}</span>
                          <span className="block text-[0.8125rem] leading-snug text-muted-foreground">{t.desc}</span>
                        </span>
                      </Link>
                    );
                  })}
                </nav>
              )}
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1240px] px-4 py-5 min-[900px]:mx-0 min-[900px]:px-10 min-[900px]:py-8">{children}</main>
      </div>
    </div>
  );
}
