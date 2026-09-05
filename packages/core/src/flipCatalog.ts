/* The rehab cost catalog — organized by trade, the way subs actually bid, so a
   section can be handed to one contractor for pricing.

   THE CATALOG IS SHARED ACROSS DEALS. Prices live here and, once edited, in a
   single account-level record — not inside any deal. A deal stores only what is
   specific to it: which items are checked, quantity overrides, and one-off
   price overrides. That split is what makes a price correction propagate to
   every future underwrite instead of needing to be re-fixed forever.

   Quantities are seeded from the property's own numbers through `driver`, which
   is how a trade-organized list still prices a 4/3 house correctly: check
   "tile shower surround" once and it bills at qty 3. Every quantity stays
   editable per deal.

   Costs are Bay Area, where labor runs well above national averages. They are
   seeded estimates, not quotes — the `seeded` flag stays true until you touch a
   price, so the tab can show how much of the catalog is genuinely yours. */

/** What a line item's quantity scales with. */
export type Driver =
  | 'none' | 'sqft' | 'bed' | 'bath' | 'halfBath' | 'kitchen'
  | 'story' | 'garage' | 'perimeter';

export type Unit = 'ea' | 'sf' | 'lf' | 'room' | 'allow';

export interface CatalogItem {
  id: string;
  desc: string;
  unit: Unit;
  driver: Driver;
  /** literal quantity when driver is 'none', otherwise a multiplier on it */
  qty: number;
  low: number; base: number; high: number;
  /** soft costs billed as a percent of hard costs rather than a unit price */
  pctOfHard?: boolean;
  note?: string;
}

export interface CatalogSection { id: string; label: string; items: CatalogItem[]; }

const it = (
  id: string, desc: string, unit: Unit, driver: Driver, qty: number,
  low: number, base: number, high: number, note?: string,
): CatalogItem => ({ id, desc, unit, driver, qty, low, base, high, note });

const pctItem = (id: string, desc: string, low: number, base: number, high: number, note?: string): CatalogItem =>
  ({ id, desc, unit: 'allow', driver: 'none', qty: 1, low, base, high, pctOfHard: true, note });

export const CATALOG: CatalogSection[] = [
  {
    id: 'demo', label: 'Demolition',
    items: [
      it('demo-int', 'Interior strip-out — walls, fixtures, finishes', 'sf', 'sqft', 1, 3, 5, 8),
      it('demo-kitchen', 'Kitchen demo and haul-out', 'ea', 'kitchen', 1, 1200, 1900, 2800),
      it('demo-bath', 'Bathroom demo to studs', 'ea', 'bath', 1, 900, 1400, 2200),
      it('demo-floor', 'Flooring removal and disposal', 'sf', 'sqft', 1, 1.75, 2.75, 4),
      it('demo-dumpster', 'Dumpster — 30 yard, per pull', 'ea', 'none', 3, 750, 950, 1300),
      it('demo-haul', 'Debris hauling and labor', 'allow', 'none', 1, 1800, 3200, 5500),
      it('demo-asbestos', 'Asbestos abatement — popcorn, mastic, ducting', 'allow', 'none', 1, 3500, 8500, 22000, 'Assume it in anything pre-1980 until tested'),
      it('demo-lead', 'Lead paint remediation', 'allow', 'none', 1, 2500, 6000, 15000),
      it('demo-fence', 'Temporary fencing and site protection', 'allow', 'none', 1, 900, 1600, 2800),
    ],
  },
  {
    id: 'concrete', label: 'Concrete & Foundation',
    items: [
      it('found-seismic', 'Seismic retrofit — foundation bolting', 'lf', 'perimeter', 1, 38, 58, 85, 'Priced per linear foot of perimeter'),
      it('found-cripple', 'Cripple wall bracing and shear plywood', 'lf', 'perimeter', 1, 45, 70, 105),
      it('found-replace', 'Foundation replacement — full', 'sf', 'sqft', 1, 85, 135, 210),
      it('found-repair', 'Foundation crack repair and epoxy injection', 'allow', 'none', 1, 2500, 6500, 15000),
      it('found-pier', 'Pier and beam repair, post replacement', 'allow', 'none', 1, 3500, 8500, 18000),
      it('found-slab', 'Slab patch and level', 'allow', 'none', 1, 1800, 4000, 9000),
      it('found-drain', 'Perimeter drainage and French drain', 'lf', 'perimeter', 1, 35, 55, 85),
      it('found-sump', 'Sump pump and basin', 'ea', 'none', 1, 1600, 2600, 4200),
      it('found-driveway', 'Driveway replacement — concrete', 'sf', 'none', 600, 12, 18, 27),
      it('found-walkway', 'Walkway and front steps', 'allow', 'none', 1, 1800, 3500, 6500),
      it('found-garage-slab', 'Garage slab pour', 'sf', 'none', 400, 10, 15, 23),
    ],
  },
  {
    id: 'framing', label: 'Framing & Carpentry',
    items: [
      it('frame-wall-remove', 'Load-bearing wall removal with beam', 'ea', 'none', 1, 4500, 8500, 16000),
      it('frame-wall-nonbearing', 'Non-bearing wall removal', 'ea', 'none', 1, 900, 1600, 2800),
      it('frame-wall-new', 'New partition wall framing', 'lf', 'none', 20, 55, 85, 130),
      it('frame-subfloor', 'Subfloor repair and replacement', 'sf', 'sqft', 0.3, 9, 14, 21),
      it('frame-dryrot', 'Dry rot and termite damage repair', 'allow', 'none', 1, 2500, 6500, 16000, 'Bay Area near-certainty in anything pre-1970'),
      it('frame-joist', 'Joist sistering and floor structure', 'allow', 'none', 1, 2200, 4800, 9500),
      it('frame-stairs', 'Interior stair rebuild', 'ea', 'none', 1, 3500, 6500, 12000),
      it('frame-railing', 'Stair railing and balustrade', 'lf', 'none', 16, 95, 165, 280),
      it('frame-trim-base', 'Baseboard and casing — supply and install', 'lf', 'sqft', 0.9, 9, 14, 22),
      it('frame-crown', 'Crown molding', 'lf', 'sqft', 0.5, 12, 19, 30),
      it('frame-closet', 'Closet build-out and shelving system', 'ea', 'bed', 1, 650, 1300, 2600),
      it('frame-pantry', 'Pantry build-out', 'ea', 'none', 1, 900, 1800, 3400),
      it('frame-mantel', 'Fireplace surround and mantel', 'ea', 'none', 1, 1200, 2600, 5500),
      it('frame-builtin', 'Built-in shelving or bench', 'allow', 'none', 1, 1500, 3200, 6500),
    ],
  },
  {
    id: 'roofing', label: 'Roofing',
    items: [
      it('roof-comp', 'Comp shingle — tear off and replace', 'sf', 'sqft', 1.15, 8.5, 13, 19, 'Roof area runs about 15% over floor area on a simple pitch'),
      it('roof-flat', 'Flat roof — torch-down or TPO', 'sf', 'none', 400, 12, 18, 26),
      it('roof-tile', 'Tile or slate roof replacement', 'sf', 'sqft', 1.15, 22, 34, 52),
      it('roof-sheath', 'Sheathing replacement', 'sf', 'sqft', 0.35, 4.5, 7, 11),
      it('roof-gutter', 'Gutters and downspouts', 'lf', 'perimeter', 1, 16, 26, 40),
      it('roof-skylight', 'Skylight — supply and install', 'ea', 'none', 2, 1400, 2400, 4200),
      it('roof-flash', 'Flashing, vents and detail work', 'allow', 'none', 1, 900, 1800, 3400),
      it('roof-chimney', 'Chimney repair or removal', 'allow', 'none', 1, 1800, 4200, 9500),
    ],
  },
  {
    id: 'windows', label: 'Windows & Doors',
    items: [
      it('win-retrofit', 'Vinyl retrofit windows — dual pane', 'ea', 'none', 12, 650, 950, 1450),
      it('win-newconst', 'New-construction windows with stucco patch', 'ea', 'none', 12, 1100, 1700, 2600),
      it('win-slider', 'Sliding or French patio door', 'ea', 'none', 1, 2200, 3800, 6800),
      it('win-entry', 'Entry door — supply and install', 'ea', 'none', 1, 1400, 2600, 5200),
      it('win-interior', 'Interior doors — slab, jamb and hardware', 'ea', 'bed', 1.6, 450, 720, 1150),
      it('win-closet-door', 'Closet doors — bypass or bifold', 'ea', 'bed', 1, 380, 620, 1000),
      it('win-garage-door', 'Garage door and opener', 'ea', 'garage', 0.5, 1600, 2600, 4400),
      it('win-hardware', 'Door hardware package', 'allow', 'none', 1, 450, 900, 1800),
      it('win-screens', 'Window screens', 'ea', 'none', 12, 65, 105, 165),
      it('win-trim-ext', 'Exterior door and window trim', 'allow', 'none', 1, 900, 1800, 3400),
    ],
  },
  {
    id: 'electrical', label: 'Electrical',
    items: [
      it('elec-panel', 'Main panel upgrade to 200A', 'ea', 'none', 1, 3200, 5200, 8500),
      it('elec-service', 'Service drop and utility coordination', 'ea', 'none', 1, 1800, 3400, 6500),
      it('elec-rewire-full', 'Whole-house rewire', 'sf', 'sqft', 1, 11, 17, 26),
      it('elec-rewire-part', 'Partial rewire and circuit additions', 'allow', 'none', 1, 3500, 7000, 14000),
      it('elec-knob', 'Knob-and-tube removal', 'sf', 'sqft', 1, 8, 13, 20, 'Common in pre-1950 Bay Area stock and an insurance blocker'),
      it('elec-subpanel', 'Subpanel', 'ea', 'none', 1, 1200, 2000, 3400),
      it('elec-recessed', 'Recessed LED can lights', 'ea', 'sqft', 0.014, 185, 285, 440),
      it('elec-fixture', 'Light fixtures — supply and install', 'ea', 'none', 14, 145, 260, 480),
      it('elec-ceilingfan', 'Ceiling fans', 'ea', 'bed', 1, 285, 450, 750),
      it('elec-devices', 'Switches, outlets and plates', 'ea', 'sqft', 0.03, 38, 58, 90),
      it('elec-gfci', 'GFCI and AFCI protection', 'allow', 'none', 1, 550, 950, 1600),
      it('elec-smoke', 'Smoke and CO alarms — code compliance', 'ea', 'bed', 1.5, 95, 155, 240),
      it('elec-ev', 'EV charger circuit — 240V', 'ea', 'none', 1, 950, 1700, 3200),
      it('elec-exterior', 'Exterior and landscape lighting circuits', 'allow', 'none', 1, 750, 1500, 3000),
      it('elec-solar', 'Solar PV system', 'allow', 'none', 1, 12000, 19000, 30000),
    ],
  },
  {
    id: 'plumbing', label: 'Plumbing',
    items: [
      it('plumb-repipe', 'Whole-house repipe — PEX or copper', 'sf', 'sqft', 1, 8, 13, 21),
      it('plumb-galv', 'Galvanized supply line replacement', 'allow', 'none', 1, 4500, 8500, 16000),
      it('plumb-lateral', 'Sewer lateral replacement', 'lf', 'none', 50, 175, 285, 450, 'Required for a compliance certificate in Oakland, Berkeley, Albany, Piedmont'),
      it('plumb-lateral-cert', 'Sewer lateral compliance certificate', 'ea', 'none', 1, 400, 750, 1400),
      it('plumb-drain', 'Drain and waste line replacement', 'allow', 'none', 1, 3500, 7500, 15000),
      it('plumb-wh', 'Water heater — tank, with strapping', 'ea', 'none', 1, 1400, 2200, 3400),
      it('plumb-tankless', 'Tankless water heater conversion', 'ea', 'none', 1, 3200, 5000, 8000),
      it('plumb-gas', 'Gas line work and seismic shutoff valve', 'allow', 'none', 1, 900, 1800, 3400),
      it('plumb-rough-bath', 'Bathroom rough-in — supply and waste', 'ea', 'bath', 1, 2200, 3600, 6000),
      it('plumb-trim-bath', 'Bathroom fixture trim — valves, toilet, faucets', 'ea', 'bath', 1, 1400, 2400, 4200),
      it('plumb-kitchen', 'Kitchen rough and trim', 'ea', 'kitchen', 1, 1800, 3000, 5200),
      it('plumb-halfbath', 'Half bath — rough and trim', 'ea', 'halfBath', 1, 1800, 3000, 5000),
      it('plumb-laundry', 'Laundry hookups — supply, drain, vent', 'ea', 'none', 1, 900, 1700, 3200),
      it('plumb-hose', 'Exterior hose bibs and irrigation stub', 'allow', 'none', 1, 350, 700, 1300),
    ],
  },
  {
    id: 'hvac', label: 'HVAC',
    items: [
      it('hvac-furnace', 'Furnace replacement', 'ea', 'none', 1, 3200, 5000, 8000),
      it('hvac-ac', 'Condenser and evaporator coil', 'ea', 'none', 1, 3800, 6000, 9500),
      it('hvac-heatpump', 'Heat pump system — full changeout', 'ea', 'none', 1, 8500, 14000, 22000),
      it('hvac-duct-new', 'New ductwork throughout', 'sf', 'sqft', 1, 7, 11, 17),
      it('hvac-duct-seal', 'Duct sealing and Title 24 testing', 'allow', 'none', 1, 900, 1600, 2800),
      it('hvac-mini', 'Ductless mini-split — per head', 'ea', 'none', 2, 3200, 4800, 7500),
      it('hvac-thermostat', 'Smart thermostat', 'ea', 'none', 1, 250, 420, 700),
      it('hvac-bathfan', 'Bath exhaust fans, vented to exterior', 'ea', 'bath', 1, 380, 620, 1000),
      it('hvac-range', 'Range hood and exterior venting', 'ea', 'kitchen', 1, 750, 1400, 2600),
    ],
  },
  {
    id: 'drywall', label: 'Insulation & Drywall',
    items: [
      it('dry-attic', 'Attic insulation — blown-in to R-38', 'sf', 'sqft', 1, 2.2, 3.4, 5),
      it('dry-wall-ins', 'Wall insulation — batts at open framing', 'sf', 'sqft', 1, 2.4, 3.8, 5.8),
      it('dry-sound', 'Sound batts at bedroom and bath walls', 'allow', 'none', 1, 700, 1400, 2600),
      it('dry-hang', 'Drywall hang and finish — full', 'sf', 'sqft', 2.2, 3.5, 5.2, 7.8, 'Wall area runs roughly 2.2x floor area'),
      it('dry-patch', 'Drywall patch and repair', 'allow', 'none', 1, 1200, 2600, 5500),
      it('dry-texture', 'Texture removal and smooth-coat walls', 'sf', 'sqft', 2.2, 2.2, 3.4, 5.2),
      it('dry-popcorn', 'Popcorn ceiling removal and smooth', 'sf', 'sqft', 1, 3, 4.6, 7),
      it('dry-ceiling', 'Ceiling replacement', 'sf', 'sqft', 1, 4.5, 7, 10.5),
      it('dry-corner', 'Corner bead, archways and detail', 'allow', 'none', 1, 600, 1300, 2600),
    ],
  },
  {
    id: 'tile', label: 'Tile & Stone',
    items: [
      it('tile-shower', 'Tile shower surround — full height', 'ea', 'bath', 1, 2400, 4000, 7000),
      it('tile-tub', 'Tub surround tile', 'ea', 'bath', 0.5, 1600, 2700, 4600),
      it('tile-bathfloor', 'Bathroom floor tile', 'ea', 'bath', 1, 900, 1600, 2800),
      it('tile-backsplash', 'Kitchen backsplash', 'ea', 'kitchen', 1, 950, 1700, 3200),
      it('tile-entry', 'Entry and mudroom tile', 'allow', 'none', 1, 700, 1400, 2800),
      it('tile-waterproof', 'Shower waterproofing — Schluter or hot mop', 'ea', 'bath', 1, 700, 1200, 2000),
      it('tile-pan', 'Shower pan and drain assembly', 'ea', 'bath', 1, 650, 1100, 1900),
      it('tile-niche', 'Shower niche and bench', 'ea', 'bath', 1, 380, 680, 1200),
      it('tile-glass', 'Frameless shower glass enclosure', 'ea', 'bath', 1, 1400, 2400, 4200),
      it('tile-slab-fireplace', 'Stone or tile fireplace face', 'ea', 'none', 1, 1200, 2400, 4800),
      it('tile-grout', 'Grout, seal and finish detail', 'allow', 'none', 1, 450, 900, 1800),
    ],
  },
  {
    id: 'flooring', label: 'Flooring',
    items: [
      it('floor-engineered', 'Engineered hardwood — supply and install', 'sf', 'sqft', 0.75, 11, 17, 26),
      it('floor-solid', 'Solid hardwood — supply and install', 'sf', 'sqft', 0.75, 15, 23, 35),
      it('floor-refinish', 'Refinish existing hardwood', 'sf', 'sqft', 0.75, 4.5, 7, 10.5),
      it('floor-lvp', 'Luxury vinyl plank', 'sf', 'sqft', 0.75, 6.5, 9.5, 14),
      it('floor-tile', 'Porcelain tile flooring', 'sf', 'sqft', 0.25, 13, 19, 29),
      it('floor-carpet', 'Carpet and pad', 'sf', 'sqft', 0.35, 4.5, 6.8, 10),
      it('floor-underlay', 'Underlayment and moisture barrier', 'sf', 'sqft', 0.75, 1.6, 2.6, 4),
      it('floor-level', 'Floor leveling and prep', 'sf', 'sqft', 0.5, 3, 5, 8),
      it('floor-transition', 'Transitions, thresholds and stair nosing', 'allow', 'none', 1, 450, 900, 1800),
      it('floor-shoe', 'Base shoe and quarter round', 'lf', 'sqft', 0.9, 4, 6.5, 10),
    ],
  },
  {
    id: 'cabinets', label: 'Cabinets & Countertops',
    items: [
      it('cab-kitchen-stock', 'Kitchen cabinets — stock, installed', 'lf', 'none', 22, 320, 480, 720),
      it('cab-kitchen-semi', 'Kitchen cabinets — semi-custom, installed', 'lf', 'none', 22, 550, 850, 1300),
      it('cab-island', 'Kitchen island — cabinetry and install', 'ea', 'kitchen', 1, 1800, 3400, 6500),
      it('cab-counter-quartz', 'Quartz countertops — fabricated and installed', 'sf', 'none', 55, 75, 110, 165),
      it('cab-counter-slab', 'Natural stone slab counters', 'sf', 'none', 55, 95, 145, 230),
      it('cab-sink-kitchen', 'Kitchen sink and faucet', 'ea', 'kitchen', 1, 550, 1000, 1900),
      it('cab-appliance', 'Appliance package — range, hood, DW, fridge', 'ea', 'kitchen', 1, 3800, 6500, 13000),
      it('cab-vanity', 'Bath vanity with top — supply and install', 'ea', 'bath', 1, 950, 1700, 3400),
      it('cab-vanity-half', 'Half bath vanity', 'ea', 'halfBath', 1, 650, 1100, 2200),
      it('cab-mirror', 'Mirrors and medicine cabinets', 'ea', 'bath', 1, 250, 480, 950),
      it('cab-hardware', 'Cabinet hardware — pulls and knobs', 'allow', 'none', 1, 350, 700, 1500),
      it('cab-laundry', 'Laundry cabinets and counter', 'allow', 'none', 1, 900, 1800, 3600),
      it('cab-closet-sys', 'Closet organizer systems', 'ea', 'bed', 1, 550, 1100, 2400),
    ],
  },
  {
    id: 'paint', label: 'Painting',
    items: [
      it('paint-int-walls', 'Interior walls and ceilings', 'sf', 'sqft', 1, 3, 4.6, 7),
      it('paint-int-trim', 'Interior trim, doors and casing', 'allow', 'none', 1, 1800, 3400, 6500),
      it('paint-cab-refinish', 'Cabinet refinish or spray', 'lf', 'none', 22, 145, 235, 380),
      it('paint-ext-body', 'Exterior body and trim — prep and paint', 'sf', 'sqft', 1, 4.5, 7, 11),
      it('paint-stucco', 'Stucco patch and re-coat', 'allow', 'none', 1, 2200, 4800, 10000),
      it('paint-siding-prep', 'Siding prep, scrape and prime', 'allow', 'none', 1, 1500, 3200, 6500),
      it('paint-deck', 'Deck stain or seal', 'allow', 'none', 1, 600, 1300, 2600),
      it('paint-garage', 'Garage interior and floor coating', 'allow', 'none', 1, 900, 1800, 3600),
    ],
  },
  {
    id: 'landscape', label: 'Landscape & Hardscape',
    items: [
      it('land-front', 'Front yard refresh — clean, mulch, plant', 'allow', 'none', 1, 2200, 4500, 9000, 'Highest-return dollar in the whole budget'),
      it('land-sod', 'Sod and soil prep', 'sf', 'none', 800, 2.2, 3.6, 5.5),
      it('land-drought', 'Drought-tolerant planting and gravel', 'sf', 'none', 800, 4, 7, 12),
      it('land-irrigation', 'Irrigation system and controller', 'allow', 'none', 1, 1800, 3400, 6500),
      it('land-fence', 'Wood fencing — supply and install', 'lf', 'none', 120, 38, 58, 90),
      it('land-gate', 'Gates — pedestrian and vehicle', 'ea', 'none', 2, 650, 1200, 2400),
      it('land-deck', 'Deck build — pressure treated or composite', 'sf', 'none', 250, 38, 62, 105),
      it('land-deck-repair', 'Deck repair and re-decking', 'allow', 'none', 1, 1800, 3800, 8000),
      it('land-patio', 'Patio — pavers or stamped concrete', 'sf', 'none', 300, 16, 26, 42),
      it('land-retaining', 'Retaining wall', 'lf', 'none', 40, 145, 240, 420),
      it('land-tree', 'Tree removal and trimming', 'allow', 'none', 1, 1200, 2800, 7000),
      it('land-lighting', 'Exterior and landscape lighting', 'allow', 'none', 1, 800, 1700, 3400),
    ],
  },
  {
    id: 'soft', label: 'Soft Costs & Permits',
    items: [
      it('soft-permit-build', 'Building permit', 'ea', 'none', 1, 2500, 5500, 14000),
      it('soft-permit-elec', 'Electrical permit', 'ea', 'none', 1, 350, 700, 1500),
      it('soft-permit-plumb', 'Plumbing permit', 'ea', 'none', 1, 350, 700, 1500),
      it('soft-permit-mech', 'Mechanical permit', 'ea', 'none', 1, 300, 600, 1300),
      it('soft-plancheck', 'Plan check and city review fees', 'ea', 'none', 1, 900, 2200, 5500),
      it('soft-architect', 'Architect — drawings and permit set', 'allow', 'none', 1, 4500, 9500, 22000),
      it('soft-engineer', 'Structural engineer and calcs', 'allow', 'none', 1, 2200, 4500, 9500),
      it('soft-title24', 'Title 24 energy compliance', 'ea', 'none', 1, 550, 950, 1800),
      it('soft-survey', 'Survey and site plan', 'ea', 'none', 1, 1200, 2400, 4500),
      it('soft-portapotty', 'Portable toilet and site sanitation', 'allow', 'none', 1, 450, 850, 1500),
      it('soft-temppower', 'Temporary power and utilities during build', 'allow', 'none', 1, 600, 1200, 2400),
      it('soft-clean', 'Final construction clean', 'allow', 'none', 1, 650, 1200, 2200),
      pctItem('soft-gc', 'General contractor fee', 12, 18, 25, 'Percent of hard costs — the trades above'),
      pctItem('soft-genconditions', 'General conditions — supervision, tools, delivery', 3, 5, 8, 'Percent of hard costs'),
    ],
  },
];

export const CATALOG_ITEMS: CatalogItem[] = CATALOG.flatMap(s => s.items);
export const ITEM_BY_ID: Record<string, CatalogItem> =
  Object.fromEntries(CATALOG_ITEMS.map(i => [i.id, i]));

/* Contingency deliberately is NOT in this catalog. It lives on the deal as
   `contingencyPct` and shows as its own P&L line, so the rehab axis labels on
   the scenario grid stay honest and nothing is counted twice. */

/** The property numbers a quantity can scale with. */
export interface QtyContext {
  sqft: number; beds: number; baths: number; halfBaths: number;
  stories: number; garageBays: number;
}

export function driverValue(driver: Driver, c: QtyContext): number {
  switch (driver) {
    case 'sqft': return c.sqft;
    case 'bed': return c.beds;
    case 'bath': return c.baths;
    case 'halfBath': return c.halfBaths;
    case 'kitchen': return 1;
    case 'story': return c.stories;
    case 'garage': return c.garageBays;
    /* a rough rectangular perimeter from floor area — good enough to price
       bolting and gutters without asking for a site plan */
    case 'perimeter': return c.sqft > 0 ? Math.round(4 * Math.sqrt(c.sqft / Math.max(1, c.stories))) : 0;
    default: return 1;
  }
}

/** Seeded quantity for an item, before any per-deal override. */
export function seededQty(item: CatalogItem, c: QtyContext): number {
  const base = driverValue(item.driver, c) * item.qty;
  return item.driver === 'none' ? item.qty : Math.max(0, Math.round(base * 100) / 100);
}

export interface ChecklistTotals {
  low: number; base: number; high: number;
  hardLow: number; hardBase: number; hardHigh: number;
  sections: { id: string; label: string; low: number; base: number; high: number; count: number }[];
  checkedCount: number;
}

/** Roll up the checked items. Percent-of-hard soft costs are applied last,
    against the hard-cost subtotal, so they can never compound on each other. */
export function computeChecklist(
  checked: Record<string, boolean>,
  qtyOverride: Record<string, number>,
  priceOverride: Record<string, number>,
  ctx: QtyContext,
  catalog: CatalogSection[] = CATALOG,
): ChecklistTotals {
  const qtyOf = (i: CatalogItem) =>
    qtyOverride[i.id] !== undefined ? qtyOverride[i.id] : seededQty(i, ctx);
  const priceOf = (i: CatalogItem, k: 'low' | 'base' | 'high') =>
    priceOverride[`${i.id}.${k}`] !== undefined ? priceOverride[`${i.id}.${k}`] : i[k];

  let hardLow = 0, hardBase = 0, hardHigh = 0, checkedCount = 0;
  const sectionRaw = catalog.map(sec => {
    let low = 0, base = 0, high = 0, count = 0;
    for (const i of sec.items) {
      if (!checked[i.id] || i.pctOfHard) continue;
      const q = qtyOf(i);
      low += q * priceOf(i, 'low');
      base += q * priceOf(i, 'base');
      high += q * priceOf(i, 'high');
      count++;
    }
    hardLow += low; hardBase += base; hardHigh += high; checkedCount += count;
    return { id: sec.id, label: sec.label, low, base, high, count };
  });

  /* percent items ride on the hard subtotal */
  const sections = sectionRaw.map(sec => {
    const def = catalog.find(c => c.id === sec.id)!;
    let { low, base, high, count } = sec;
    for (const i of def.items) {
      if (!checked[i.id] || !i.pctOfHard) continue;
      low += hardLow * priceOf(i, 'low') / 100;
      base += hardBase * priceOf(i, 'base') / 100;
      high += hardHigh * priceOf(i, 'high') / 100;
      count++; checkedCount++;
    }
    return { ...sec, low, base, high, count };
  });

  return {
    low: sections.reduce((a, s) => a + s.low, 0),
    base: sections.reduce((a, s) => a + s.base, 0),
    high: sections.reduce((a, s) => a + s.high, 0),
    hardLow, hardBase, hardHigh,
    sections, checkedCount,
  };
}
