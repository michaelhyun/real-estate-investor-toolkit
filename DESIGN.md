---
name: BlueDoor Investor Toolkit
description: Real estate calculators under the BlueDoor Realty brand, on the same design system as the BlueDoor Hub (navy shell, action blue, pill controls, white cards on a quiet grey page).
source: The BlueDoor Hub's DESIGN.md (BlueDoorCRM repo) is the reference system. Adopted here on 2026-11-25. Replaces the slate-and-teal system ported on 2026-09-05.
---

# Design system: BlueDoor Investor Toolkit

## Overview
Operate-mode tool UI for one investor at a desk, checked on a phone. It shares the Hub's look so the two read as one product family. Personality comes from the navy shell, one action blue, heavy headings and pill controls, not decoration.

## Where things live
- **Tokens:** `apps/web/app/globals.css`, the `BlueDoor tokens` block. It is the only place a colour is defined. The first group are the names shadcn/ui reads (`--primary`, `--border`…); the second are BlueDoor's own (`--navy`, `--success`, `--primary-soft`…). Both are exposed as Tailwind utilities (`bg-navy`, `text-success`, `shadow-tight`).
- **Components:** shadcn/ui (`base-nova` style, Base UI primitives) in `apps/web/components/ui/`. Add more with `npx shadcn@latest add <name>` from `apps/web`, then restyle to the rules below.
- **Icons:** Material Icons Round through `<Icon name size>` (`components/Icon.tsx`). No emoji or Unicode glyphs as icons. shadcn components ship with lucide icons; swap them for `<Icon>` when adding one.
- **Legacy layer:** `apps/web/app/legacy.css` holds the old hand-written class names (`.card`, `.btn`, `.tile`, `.tab`, the flip spreadsheet) that the calculator pages still use. Its tokens alias the BlueDoor tokens and section 4 restates the shared pieces in BlueDoor's language. It sits in a cascade layer below Tailwind utilities. Delete rules from it as pages move to shadcn components; do not add to it.

## Colour
- **One action colour.** Blue `#3c5bf6` marks what you can do or where you are: filled buttons, the active nav pill, selected tabs, links, sliders, switches.
- **Green is money and success only** (`--success`), amber is cost and caution (`--warning`), red is loss and errors (`--destructive`). Each comes as strong text on a soft tint, and always with a word.
- Green and amber are one shade darker than the Hub's so small figures pass 4.5:1 on white.
- Grey text uses `--muted-foreground`. `--faint` is for decoration only.

## Type
One family, Source Sans 3. Page titles 28px/800 with -0.015em tracking; section headings 18px/800; body 15px; card overlines 12px bold uppercase, 0.08em tracking. Figures are set in the same face with tabular numerals, never mono. The figures that decide a deal are 800 weight in `--ink-strong`.

## Layout
- Desktop (900px and up): a 240px navy sidebar with the BlueDoor mark, tools grouped as Calculators, Guides, Portfolio, and the account at the foot. Content sits on the grey page with 40px gutters, up to 1240px wide.
- Phone: a sticky navy top bar with the mark and a menu button that opens the tool list.
- Home is a grouped list of tools, not a card grid.
- The flip and tax tools are spreadsheets and stay dense (28px rows).

## Components
- **Buttons:** pills. Primary is filled blue with a soft blue shadow; secondary is white with a 1.5px pale-blue ring and blue text; ghost is text only.
- **Cards:** white, 8px radius, `--shadow-tight`, no border. Menus and popovers use `--shadow-fluffy`.
- **Inputs:** white, 6px radius, 1px grey border; blue border on focus.
- **Tabs:** underlined, 15px bold, 3px blue underline, pill count badges.
- **Stat tiles:** uppercase overline, heavy figure, one muted line under it.
- **Notices and verdicts:** a tint and a word. Never a coloured stripe down one edge.
- **Focus:** 2px blue outline, 2px offset, everywhere.

## Do's and don'ts
- Do use shadows, not borders, to separate cards from the page.
- Do pair every status colour with a word or icon.
- Don't introduce a second action hue.
- Don't use a legacy class name that is also a Tailwind utility (the old `.grid` was renamed `.calc-grid` for this reason).
