/* The toolkit's tools, in nav order. A plain module (no 'use client') so the
   server-rendered home page and the client shell can both read it. */

export const TOOLS = [
  { id: 'rental', icon: 'home_work', name: 'Rental Property Analyzer', short: 'Rental', href: '/rental', group: 'Calculators',
    desc: 'Cash flow, cash-on-cash, DSCR & 5-year pro-forma' },
  { id: 'mortgage', icon: 'account_balance', name: 'Mortgage Calculator', short: 'Mortgage', href: '/mortgage', group: 'Calculators',
    desc: 'Payment breakdown, amortization & extra-payment savings' },
  { id: 'flip', icon: 'construction', name: 'Flip Analyzer', short: 'Flip', href: '/flip', group: 'Calculators',
    desc: 'Scenarios, sensitivity & a room-by-room scope of work' },
  { id: 'tax', icon: 'receipt_long', name: 'Income Tax Calculator', short: 'Income Tax', href: '/tax', group: 'Calculators',
    desc: 'Federal & California, marginal vs effective, capital gains' },
  { id: 'portfolio', icon: 'donut_small', name: 'Portfolio ROE Dashboard', short: 'Portfolio', href: '/portfolio', group: 'Portfolio',
    desc: 'Equity, cash flow & return on equity across your rentals' },
];

export const GROUPS = ['Calculators', 'Portfolio'];
