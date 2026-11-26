import Link from 'next/link';
import { Icon } from '../components/Icon';
import { TOOLS, GROUPS } from '../lib/tools';

/* What each tool answers, in the words of the decision it supports. */
const ANSWERS: Record<string, string> = {
  rental: 'Cash flow, cash-on-cash return, DSCR, creative financing, a 5-year pro-forma, and a contractor-ready scope of work.',
  mortgage: 'Full monthly payment with taxes, insurance and PMI, an amortization schedule, and what extra payments save.',
  flip: 'Bay Area fix-and-flip underwriting: a rehab and ARV scenario grid, profit sensitivity, city transfer tax presets, and a trade-by-trade scope of work.',
  tax: 'Federal and California income tax, marginal against effective rates, and capital gains.',
  portfolio: 'Every rental you own in one view: cash-on-cash, return on equity, a performance leaderboard, and lazy-equity alerts.',
};

export default function Home() {
  return (
    <div className="max-w-3xl">
      <h1 className="text-[2rem] font-extrabold leading-tight tracking-[-0.015em] text-ink-strong max-[640px]:text-[1.75rem]">Investor Toolkit</h1>
      <p className="mt-1 text-[0.9375rem] text-muted-foreground">Underwrite a rental, size up the financing, and keep every deal you have looked at in one place.</p>

      {GROUPS.map(g => (
        <section key={g} className="mt-7">
          <h2 className="text-lg font-extrabold text-ink-strong">{g}</h2>
          <ul className="mt-3 divide-y divide-line overflow-hidden rounded-lg bg-card shadow-tight">
            {TOOLS.filter(t => t.group === g).map(t => (
              <li key={t.id}>
                <Link href={t.href}
                  className="group flex items-center gap-4 px-5 py-4 no-underline transition-colors hover:bg-primary-tint hover:no-underline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary">
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary-soft text-primary-deep">
                    <Icon name={t.icon} size={22} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-base font-bold text-ink-strong">{t.name}</span>
                    <span className="mt-0.5 block text-[0.9375rem] leading-snug text-muted-foreground">{ANSWERS[t.id]}</span>
                  </span>
                  <Icon name="chevron_right" size={22} className="text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <p className="mt-7 text-[0.9375rem] text-muted-foreground">
        <span className="font-semibold text-foreground">Coming next:</span> sales and rental comps, a CapEx tracker, neighborhood research and a BRRRR analyzer.
      </p>
      <p className="mt-2 text-[0.8125rem] text-muted-foreground">These tools give estimates for screening. Verify the numbers locally before making an offer.</p>
    </div>
  );
}
