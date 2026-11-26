# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Michael first (confirmed 2026-11-25): a Bay Area real estate agent and investor underwriting his own deals at a desk, and checking them on a phone. It is public, so other investors can use it, but it is built around how he works.

## Product Purpose
A set of calculators for real estate investing: rental analysis, mortgage, fix-and-flip, income tax and a portfolio return-on-equity dashboard. Success is reaching a decision on a deal (offer, renegotiate or walk) quickly, with numbers that can be trusted.

## Operating Context
- Every page is client-side. State lives in localStorage and, when signed in, syncs to Supabase. The site is a static export on GitHub Pages; a push to `main` deploys it.
- The calculation engine is `packages/core` (TypeScript, tested). The web app is `apps/web` (Next 15, React 19, Tailwind v4, shadcn/ui).
- Deals are printed or saved as PDF reports.

## Capabilities and Constraints
- Bay Area defaults: city transfer-tax presets, California income tax.
- The Rental Analyzer is the deal analyzer only (Michael, 2026-11-25): no comps, CapEx, neighborhood or scope-of-work tabs. Its financing section opens an amortization view of the whole loan stack. Down payment is a fixed choice from 0% to 30% in steps of 5 (Michael, 2026-11-25).
- Property facts (beds, baths, square feet, year built) fill in from RentCast when a suggested address is picked. That needs a RentCast API key, which is kept in the browser's localStorage only, never in a deal or the repo. Address suggestions come from OpenStreetMap (Photon), no key.
- Results are estimates for screening, not offers. The site says so.
- Dense inputs are expected: the flip analyzer is laid out as a spreadsheet and must stay that dense.

## Brand Commitments
- Carries the **BlueDoor Realty** brand (Michael, 2026-11-25) and should feel like it belongs with the BlueDoor Hub. The Hub's design system is the reference: `~/Projects/BlueDoorCRM/DESIGN.md`.
- Logo: the BlueDoor mark and wordmark, used under the Hub's logo rules.

## Product Principles
- Numbers first. The answer (the verdict and the few figures that decide it) outranks the inputs that produce it.
- Trust comes from precision: aligned figures, stated assumptions, no decoration around money.
- One system. The same components and tokens as the Hub, so the two read as one product family.
- Dense where the work is dense, calm everywhere else.
