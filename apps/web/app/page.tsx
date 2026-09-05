import Link from 'next/link';

const CARDS = [
  {
    href: '/rental', ic: '🏘️', title: 'Rental Property Analyzer',
    desc: 'Cash flow, cash-on-cash return, DSCR, creative financing, a 5-year pro-forma, and a contractor-ready scope of work.',
  },
  {
    href: '/mortgage', ic: '🏦', title: 'Mortgage Calculator',
    desc: 'Full monthly payment breakdown with taxes, insurance and PMI, an amortization schedule, and extra-payment payoff savings.',
  },
  {
    href: '/flip', ic: '🔨', title: 'Flip Analyzer',
    desc: 'Bay Area fix-and-flip underwriting — a rehab × ARV scenario grid, a profit sensitivity heatmap, city transfer tax presets, and a trade-by-trade cost checklist that builds your scope of work.',
  },
  {
    href: '/portfolio', ic: '📊', title: 'Portfolio ROE Dashboard',
    desc: 'Every rental you own in one view — cash-on-cash, return on equity, a performance leaderboard, and lazy-equity alerts.',
  },
];

export default function Home() {
  return (
    <>
      <div className="hero">
        <h1>Analyze deals like a pro, <em>in minutes</em></h1>
        <p>A growing toolkit for real-estate investors — underwrite rentals, size up financing, and keep every deal you&apos;ve looked at in one place.</p>
      </div>

      <div className="tool-grid">
        {CARDS.map(c => (
          <Link key={c.href} className="tool-card" href={c.href}>
            <div className="ic">{c.ic}</div>
            <h3>{c.title}</h3>
            <p>{c.desc}</p>
            <span className="go">Open tool →</span>
          </Link>
        ))}
        <div className="tool-card soon">
          <span className="badge">Coming soon</span>
          <div className="ic">🛠️</div>
          <h3>More tools</h3>
          <p>Sales &amp; rental comps, CapEx tracker, neighborhood research, BRRRR analyzer and more — the toolkit keeps growing.</p>
        </div>
      </div>

      <p className="footnote">Tools are estimates for screening purposes only — always verify numbers locally before making offers.</p>
    </>
  );
}
