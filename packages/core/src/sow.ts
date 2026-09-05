/* Scope of Work — the estimating surface.

   WHAT THIS IS OPTIMISED FOR: arriving at a rehab number that is actually
   right. Not for slicing the job into contractor packages — that is a later
   concern and a different grouping of the same lines.

   Estimates go wrong in a predictable order, and the structure here answers
   each one:

     1. OMISSION — forgetting a whole category. The biggest error by far.
        Answered by walking the house space by space, the way you inspect it,
        plus fixed whole-property sections for the things that live in no room
        (roof, panel, repipe, permits) and would otherwise fall through. Spaces
        with nothing scoped are reported back so a blank room is a decision
        rather than an oversight, and the lines people most often forget carry
        a `missed` flag.

     2. QUANTITY — pricing one bathroom in a three-bath house. Answered by
        generating a real instance per room from the property itself, each with
        its own editable area.

     3. SCOPE AMBIGUITY — "kitchen remodel" is $25k or $120k. Answered twice:
        a level preset per space (skip / refresh / renovate / gut) that checks a
        coherent set of tasks in one click, and three price points per task read
        as finish grade — rental, standard, high-end — which are the same three
        numbers that drive the low/base/high rehab scenarios.

     4. UNIT PRICE DRIFT — answered by the shared catalog: correct a price once
        after a real bid and every future deal is right. */

export type Unit = 'ea' | 'sf' | 'lf' | 'allow' | 'pct';

/** How a task's quantity is derived. */
export type Basis =
  | 'each'        /* literal quantity */
  | 'roomSf'      /* the area of this space */
  | 'houseSf'     /* whole-house living area */
  | 'perimeter'   /* rough exterior perimeter */
  | 'roomPerim';  /* rough perimeter of this space, for trim and base */

/** 1 refresh · 2 renovate · 3 gut. A task lists every level that includes it,
    which lets alternatives coexist — refinish the floor at a refresh, replace
    it at a renovate — instead of forcing one cumulative ladder. */
export type Level = 1 | 2 | 3;

export interface SowTask {
  id: string;
  desc: string;
  unit: Unit;
  basis: Basis;
  qty: number;
  low: number; base: number; high: number;
  levels: Level[];
  note?: string;
  /** commonly forgotten — surfaced even when its space is left alone */
  missed?: boolean;
  /** billed as a percent of hard costs rather than a unit price */
  pctOfHard?: boolean;
}

export type SpaceKind =
  | 'bedroom' | 'bathroom' | 'halfbath' | 'kitchen' | 'living' | 'dining'
  | 'laundry' | 'hall' | 'garage'
  | 'exterior' | 'roof' | 'structural' | 'electrical' | 'plumbing' | 'hvac'
  | 'windows' | 'landscape' | 'demo' | 'soft';

export interface SpaceDef {
  kind: SpaceKind;
  label: string;
  /** rooms are generated per instance; property sections appear once */
  room: boolean;
  /** share of house area this room typically occupies, for seeding its size */
  share?: number;
  tasks: SowTask[];
}

const t = (
  id: string, desc: string, unit: Unit, basis: Basis, qty: number,
  low: number, base: number, high: number, levels: Level[],
  opts: { note?: string; missed?: boolean; pctOfHard?: boolean } = {},
): SowTask => ({ id, desc, unit, basis, qty, low, base, high, levels, ...opts });

/* ------------------------------------------------------------ room catalogs */

const BEDROOM: SowTask[] = [
  t('paint', 'Paint walls and ceiling', 'sf', 'roomSf', 1, 3, 4.6, 7, [1, 2, 3]),
  t('floor-refinish', 'Refinish existing hardwood', 'sf', 'roomSf', 1, 4.5, 7, 10.5, [1]),
  t('floor-lvp', 'New luxury vinyl plank', 'sf', 'roomSf', 1, 6.5, 9.5, 14, [2]),
  t('floor-wood', 'New engineered or solid hardwood', 'sf', 'roomSf', 1, 11, 17, 26, [3]),
  t('carpet', 'Carpet and pad', 'sf', 'roomSf', 1, 4.5, 6.8, 10, []),
  t('base-trim', 'Baseboard and casing', 'lf', 'roomPerim', 1, 9, 14, 22, [2, 3]),
  t('door', 'Interior door, jamb and hardware', 'ea', 'each', 1, 450, 720, 1150, [2, 3]),
  t('closet-doors', 'Closet doors', 'ea', 'each', 1, 380, 620, 1000, [2, 3]),
  t('closet-sys', 'Closet organiser system', 'ea', 'each', 1, 550, 1100, 2400, [3]),
  t('recessed', 'Recessed LED lighting', 'ea', 'each', 4, 185, 285, 440, [2, 3]),
  t('fixture', 'Ceiling fixture or fan', 'ea', 'each', 1, 285, 450, 750, [1, 2, 3]),
  t('devices', 'Outlets, switches and plates', 'ea', 'each', 6, 38, 58, 90, [2, 3]),
  t('drywall-patch', 'Drywall patch and repair', 'allow', 'each', 1, 250, 550, 1200, [1, 2]),
  t('drywall-new', 'Drywall hang and finish', 'sf', 'roomSf', 2.2, 3.5, 5.2, 7.8, [3]),
  t('popcorn', 'Popcorn ceiling removal and smooth', 'sf', 'roomSf', 1, 3, 4.6, 7, [2, 3]),
  t('insulation', 'Wall and ceiling insulation', 'sf', 'roomSf', 1, 2.4, 3.8, 5.8, [3]),
  t('window-cover', 'Blinds or window coverings', 'ea', 'each', 2, 120, 240, 520, [1, 2, 3]),
];

const BATHROOM: SowTask[] = [
  t('demo', 'Demo to studs', 'ea', 'each', 1, 900, 1400, 2200, [3]),
  t('rough', 'Plumbing rough-in — supply and waste', 'ea', 'each', 1, 2200, 3600, 6000, [3]),
  t('waterproof', 'Shower waterproofing and pan', 'ea', 'each', 1, 1350, 2300, 3900, [2, 3]),
  t('shower-tile', 'Tile shower surround, full height', 'ea', 'each', 1, 2400, 4000, 7000, [2, 3]),
  t('tub-replace', 'Replace tub', 'ea', 'each', 1, 900, 1600, 3200, [2]),
  t('tub-to-shower', 'Convert tub to walk-in shower', 'ea', 'each', 1, 3200, 5400, 9000, [3]),
  t('glass', 'Frameless shower glass', 'ea', 'each', 1, 1400, 2400, 4200, [2, 3]),
  t('floor-tile', 'Floor tile', 'sf', 'roomSf', 1, 13, 19, 29, [2, 3]),
  t('vanity', 'Vanity with top', 'ea', 'each', 1, 950, 1700, 3400, [1, 2, 3]),
  t('faucet', 'Faucet and shower trim', 'ea', 'each', 1, 380, 700, 1500, [1, 2, 3]),
  t('toilet', 'Toilet', 'ea', 'each', 1, 320, 550, 1100, [1, 2, 3]),
  t('mirror', 'Mirror or medicine cabinet', 'ea', 'each', 1, 250, 480, 950, [1, 2, 3]),
  t('lighting', 'Vanity and ceiling lighting', 'ea', 'each', 2, 145, 260, 480, [1, 2, 3]),
  t('fan', 'Exhaust fan vented to exterior', 'ea', 'each', 1, 380, 620, 1000, [2, 3],
    { missed: true, note: 'Code requires exterior venting — a fan into the attic fails inspection.' }),
  t('accessories', 'Towel bars, hooks, paper holder', 'allow', 'each', 1, 120, 260, 550, [1, 2, 3]),
  t('paint', 'Paint', 'sf', 'roomSf', 1, 3, 4.6, 7, [1, 2, 3]),
  t('niche', 'Shower niche and bench', 'ea', 'each', 1, 380, 680, 1200, [3]),
];

const HALFBATH: SowTask[] = [
  t('rough', 'Plumbing rough and trim', 'ea', 'each', 1, 1800, 3000, 5000, [3]),
  t('vanity', 'Vanity with top', 'ea', 'each', 1, 650, 1100, 2200, [1, 2, 3]),
  t('toilet', 'Toilet', 'ea', 'each', 1, 320, 550, 1100, [1, 2, 3]),
  t('floor-tile', 'Floor tile', 'sf', 'roomSf', 1, 13, 19, 29, [2, 3]),
  t('mirror', 'Mirror', 'ea', 'each', 1, 180, 340, 700, [1, 2, 3]),
  t('lighting', 'Lighting', 'ea', 'each', 1, 145, 260, 480, [1, 2, 3]),
  t('fan', 'Exhaust fan', 'ea', 'each', 1, 380, 620, 1000, [2, 3]),
  t('paint', 'Paint', 'sf', 'roomSf', 1, 3, 4.6, 7, [1, 2, 3]),
];

const KITCHEN: SowTask[] = [
  t('demo', 'Demo and haul-out', 'ea', 'each', 1, 1200, 1900, 2800, [2, 3]),
  t('cab-stock', 'Cabinets — stock, installed', 'lf', 'each', 22, 320, 480, 720, [2]),
  t('cab-semi', 'Cabinets — semi-custom, installed', 'lf', 'each', 22, 550, 850, 1300, [3]),
  t('cab-reface', 'Reface or repaint existing cabinets', 'lf', 'each', 22, 145, 235, 380, [1]),
  t('island', 'Island — cabinetry and top', 'ea', 'each', 1, 1800, 3400, 6500, [3]),
  t('counter', 'Countertops — quartz or slab', 'sf', 'each', 55, 75, 110, 165, [1, 2, 3]),
  t('backsplash', 'Tile backsplash', 'ea', 'each', 1, 950, 1700, 3200, [1, 2, 3]),
  t('sink', 'Sink and faucet', 'ea', 'each', 1, 550, 1000, 1900, [1, 2, 3]),
  t('appliances', 'Appliance package', 'ea', 'each', 1, 3800, 6500, 13000, [1, 2, 3]),
  t('hood', 'Range hood and exterior venting', 'ea', 'each', 1, 750, 1400, 2600, [2, 3], { missed: true }),
  t('floor', 'Flooring', 'sf', 'roomSf', 1, 9, 14, 22, [2, 3]),
  t('recessed', 'Recessed lighting', 'ea', 'each', 6, 185, 285, 440, [2, 3]),
  t('undercab', 'Under-cabinet lighting', 'allow', 'each', 1, 350, 700, 1400, [2, 3]),
  t('circuits', 'Dedicated circuits and GFCI', 'allow', 'each', 1, 850, 1600, 3200, [3], { missed: true }),
  t('plumb-rough', 'Plumbing rough and trim', 'ea', 'each', 1, 1800, 3000, 5200, [3]),
  t('pantry', 'Pantry build-out', 'ea', 'each', 1, 900, 1800, 3400, [3]),
  t('paint', 'Paint', 'sf', 'roomSf', 1, 3, 4.6, 7, [1, 2, 3]),
  t('wall-remove', 'Open wall to living area, with beam', 'ea', 'each', 1, 4500, 8500, 16000, []),
];

const LIVING: SowTask[] = [
  t('paint', 'Paint walls and ceiling', 'sf', 'roomSf', 1, 3, 4.6, 7, [1, 2, 3]),
  t('floor-refinish', 'Refinish existing hardwood', 'sf', 'roomSf', 1, 4.5, 7, 10.5, [1]),
  t('floor-new', 'New flooring', 'sf', 'roomSf', 1, 9, 14, 22, [2, 3]),
  t('base-trim', 'Baseboard and casing', 'lf', 'roomPerim', 1, 9, 14, 22, [2, 3]),
  t('recessed', 'Recessed lighting', 'ea', 'each', 6, 185, 285, 440, [2, 3]),
  t('fireplace', 'Fireplace surround and mantel', 'ea', 'each', 1, 1200, 2600, 5500, [3]),
  t('drywall-patch', 'Drywall patch and repair', 'allow', 'each', 1, 400, 900, 1900, [1, 2]),
  t('drywall-new', 'Drywall hang and finish', 'sf', 'roomSf', 2.2, 3.5, 5.2, 7.8, [3]),
  t('popcorn', 'Popcorn ceiling removal and smooth', 'sf', 'roomSf', 1, 3, 4.6, 7, [2, 3]),
  t('builtin', 'Built-in shelving or bench', 'allow', 'each', 1, 1500, 3200, 6500, [3]),
  t('devices', 'Outlets, switches and plates', 'ea', 'each', 8, 38, 58, 90, [2, 3]),
];

const DINING: SowTask[] = [
  t('paint', 'Paint walls and ceiling', 'sf', 'roomSf', 1, 3, 4.6, 7, [1, 2, 3]),
  t('floor-refinish', 'Refinish existing hardwood', 'sf', 'roomSf', 1, 4.5, 7, 10.5, [1]),
  t('floor-new', 'New flooring', 'sf', 'roomSf', 1, 9, 14, 22, [2, 3]),
  t('base-trim', 'Baseboard and casing', 'lf', 'roomPerim', 1, 9, 14, 22, [2, 3]),
  t('fixture', 'Pendant or chandelier', 'ea', 'each', 1, 285, 600, 1600, [1, 2, 3]),
  t('drywall-patch', 'Drywall patch and repair', 'allow', 'each', 1, 250, 550, 1200, [1, 2]),
  t('popcorn', 'Popcorn ceiling removal and smooth', 'sf', 'roomSf', 1, 3, 4.6, 7, [2, 3]),
];

const LAUNDRY: SowTask[] = [
  t('hookups', 'Washer and dryer hookups', 'ea', 'each', 1, 900, 1700, 3200, [2, 3]),
  t('vent', 'Dryer vent to exterior', 'ea', 'each', 1, 250, 480, 900, [2, 3], { missed: true }),
  t('cabinets', 'Cabinets and counter', 'allow', 'each', 1, 900, 1800, 3600, [3]),
  t('floor', 'Flooring', 'sf', 'roomSf', 1, 9, 14, 22, [2, 3]),
  t('paint', 'Paint', 'sf', 'roomSf', 1, 3, 4.6, 7, [1, 2, 3]),
  t('door', 'Door and hardware', 'ea', 'each', 1, 450, 720, 1150, [2, 3]),
];

const HALL: SowTask[] = [
  t('paint', 'Paint walls and ceiling', 'sf', 'roomSf', 1, 3, 4.6, 7, [1, 2, 3]),
  t('floor', 'Flooring', 'sf', 'roomSf', 1, 9, 14, 22, [2, 3]),
  t('base-trim', 'Baseboard and casing', 'lf', 'roomPerim', 1, 9, 14, 22, [2, 3]),
  t('stairs', 'Stair rebuild or re-tread', 'ea', 'each', 1, 3500, 6500, 12000, [3]),
  t('railing', 'Railing and balustrade', 'lf', 'each', 16, 95, 165, 280, [2, 3]),
  t('lighting', 'Hall and stair lighting', 'ea', 'each', 3, 145, 260, 480, [1, 2, 3]),
  t('linen', 'Linen closet and doors', 'ea', 'each', 1, 380, 620, 1000, [2, 3]),
];

const GARAGE: SowTask[] = [
  t('door', 'Garage door and opener', 'ea', 'each', 1, 1600, 2600, 4400, [2, 3]),
  t('floor-coat', 'Floor coating', 'sf', 'roomSf', 1, 3.5, 6, 10, [2, 3]),
  t('drywall', 'Drywall and paint', 'sf', 'roomSf', 1.6, 3.5, 5.2, 7.8, [2, 3]),
  t('lighting', 'Lighting and outlets', 'allow', 'each', 1, 450, 900, 1800, [1, 2, 3]),
  t('ev', 'EV charger circuit, 240V', 'ea', 'each', 1, 950, 1700, 3200, [3]),
  t('slab', 'Slab repair or pour', 'sf', 'roomSf', 1, 10, 15, 23, []),
];

/* ------------------------------------------- whole-property section catalogs */

const EXTERIOR: SowTask[] = [
  t('paint-body', 'Exterior paint — prep and paint', 'sf', 'houseSf', 1, 4.5, 7, 11, [1, 2, 3]),
  t('stucco', 'Stucco patch and re-coat', 'allow', 'each', 1, 2200, 4800, 10000, [2, 3]),
  t('siding', 'Siding repair and replacement', 'allow', 'each', 1, 1800, 4500, 12000, [],
    { note: 'Alternative to stucco — pick whichever the house actually has.' }),
  t('dryrot', 'Dry rot and termite damage repair', 'allow', 'each', 1, 2500, 6500, 16000, [2, 3],
    { missed: true, note: 'A near-certainty on anything pre-1970 in the Bay Area.' }),
  t('entry-door', 'Entry door', 'ea', 'each', 1, 1400, 2600, 5200, [2, 3]),
  t('porch', 'Porch and front steps', 'allow', 'each', 1, 1200, 2800, 6000, [2, 3]),
  t('trim-ext', 'Exterior trim and fascia', 'allow', 'each', 1, 900, 1800, 3400, [2, 3]),
  t('washer', 'Pressure wash', 'allow', 'each', 1, 350, 650, 1200, [1, 2, 3]),
  t('hardware', 'House numbers, lighting, hardware', 'allow', 'each', 1, 300, 650, 1400, [1, 2, 3]),
];

const ROOF: SowTask[] = [
  t('comp', 'Comp shingle — tear off and replace', 'sf', 'houseSf', 1.15, 8.5, 13, 19, [2, 3]),
  t('flat', 'Flat roof — torch-down or TPO', 'sf', 'each', 400, 12, 18, 26, []),
  t('tile', 'Tile or slate roof', 'sf', 'houseSf', 1.15, 22, 34, 52, []),
  t('sheathing', 'Sheathing replacement', 'sf', 'houseSf', 0.35, 4.5, 7, 11, [3], { missed: true }),
  t('gutters', 'Gutters and downspouts', 'lf', 'perimeter', 1, 16, 26, 40, [1, 2, 3]),
  t('skylight', 'Skylights', 'ea', 'each', 2, 1400, 2400, 4200, [3]),
  t('flashing', 'Flashing, vents and detail', 'allow', 'each', 1, 900, 1800, 3400, [2, 3]),
  t('chimney', 'Chimney repair or removal', 'allow', 'each', 1, 1800, 4200, 9500, []),
];

const STRUCTURAL: SowTask[] = [
  t('seismic', 'Seismic retrofit — foundation bolting', 'lf', 'perimeter', 1, 38, 58, 85, [2, 3],
    { missed: true, note: 'Standard on Bay Area pre-1980 stock and often an insurance condition.' }),
  t('cripple', 'Cripple wall bracing and shear', 'lf', 'perimeter', 1, 45, 70, 105, [3]),
  t('found-repair', 'Foundation crack repair', 'allow', 'each', 1, 2500, 6500, 15000, [2, 3]),
  t('found-replace', 'Foundation replacement', 'sf', 'houseSf', 1, 85, 135, 210, []),
  t('pier', 'Pier and beam repair, post replacement', 'allow', 'each', 1, 3500, 8500, 18000, []),
  t('subfloor', 'Subfloor repair and replacement', 'sf', 'houseSf', 0.3, 9, 14, 21, [3]),
  t('joist', 'Joist sistering and floor structure', 'allow', 'each', 1, 2200, 4800, 9500, [3]),
  t('beam', 'Beam for load-bearing wall removal', 'ea', 'each', 1, 4500, 8500, 16000, []),
  t('drainage', 'Perimeter drainage and French drain', 'lf', 'perimeter', 1, 35, 55, 85, [3], { missed: true }),
];

const ELECTRICAL: SowTask[] = [
  t('panel', 'Main panel upgrade to 200A', 'ea', 'each', 1, 3200, 5200, 8500, [2, 3], { missed: true }),
  t('service', 'Service drop and utility coordination', 'ea', 'each', 1, 1800, 3400, 6500, [3]),
  t('rewire', 'Whole-house rewire', 'sf', 'houseSf', 1, 11, 17, 26, [3]),
  t('rewire-part', 'Partial rewire and added circuits', 'allow', 'each', 1, 3500, 7000, 14000, [2]),
  t('knob', 'Knob-and-tube removal', 'sf', 'houseSf', 1, 8, 13, 20, [],
    { missed: true, note: 'Common pre-1950 and a blocker for insurance and lending.' }),
  t('subpanel', 'Subpanel', 'ea', 'each', 1, 1200, 2000, 3400, []),
  t('gfci', 'GFCI and AFCI protection', 'allow', 'each', 1, 550, 950, 1600, [1, 2, 3]),
  t('smoke', 'Smoke and CO alarms to code', 'allow', 'each', 1, 300, 550, 950, [1, 2, 3], { missed: true }),
  t('solar', 'Solar PV system', 'allow', 'each', 1, 12000, 19000, 30000, []),
];

const PLUMBING: SowTask[] = [
  t('repipe', 'Whole-house repipe', 'sf', 'houseSf', 1, 8, 13, 21, [3]),
  t('galv', 'Galvanised supply replacement', 'allow', 'each', 1, 4500, 8500, 16000, [2]),
  t('lateral', 'Sewer lateral replacement', 'lf', 'each', 50, 175, 285, 450, [],
    { missed: true, note: 'Oakland, Berkeley, Albany and Piedmont require a certificate at sale.' }),
  t('lateral-cert', 'Sewer lateral compliance certificate', 'ea', 'each', 1, 400, 750, 1400, [1, 2, 3], { missed: true }),
  t('drains', 'Drain and waste line replacement', 'allow', 'each', 1, 3500, 7500, 15000, [3]),
  t('wh', 'Water heater with seismic strapping', 'ea', 'each', 1, 1400, 2200, 3400, [1, 2, 3]),
  t('tankless', 'Tankless conversion', 'ea', 'each', 1, 3200, 5000, 8000, []),
  t('gas', 'Gas line work and seismic shutoff', 'allow', 'each', 1, 900, 1800, 3400, [2, 3]),
  t('hose', 'Exterior hose bibs', 'allow', 'each', 1, 350, 700, 1300, [2, 3]),
];

const HVAC: SowTask[] = [
  t('furnace', 'Furnace replacement', 'ea', 'each', 1, 3200, 5000, 8000, [2, 3]),
  t('ac', 'Condenser and coil', 'ea', 'each', 1, 3800, 6000, 9500, [2, 3]),
  t('heatpump', 'Heat pump — full changeout', 'ea', 'each', 1, 8500, 14000, 22000, []),
  t('mini', 'Ductless mini-split, per head', 'ea', 'each', 2, 3200, 4800, 7500, []),
  t('duct-new', 'New ductwork throughout', 'sf', 'houseSf', 1, 7, 11, 17, [3]),
  t('duct-seal', 'Duct sealing and Title 24 testing', 'allow', 'each', 1, 900, 1600, 2800, [2, 3], { missed: true }),
  t('thermostat', 'Smart thermostat', 'ea', 'each', 1, 250, 420, 700, [1, 2, 3]),
];

const WINDOWS: SowTask[] = [
  t('retrofit', 'Vinyl retrofit windows, dual pane', 'ea', 'each', 12, 650, 950, 1450, [2]),
  t('newconst', 'New-construction windows with patch', 'ea', 'each', 12, 1100, 1700, 2600, [3]),
  t('slider', 'Sliding or French patio door', 'ea', 'each', 1, 2200, 3800, 6800, [2, 3]),
  t('screens', 'Window screens', 'ea', 'each', 12, 65, 105, 165, [1, 2, 3]),
  t('trim', 'Window trim and sills', 'allow', 'each', 1, 600, 1300, 2600, [2, 3]),
];

const LANDSCAPE: SowTask[] = [
  t('front', 'Front yard refresh — clean, mulch, plant', 'allow', 'each', 1, 2200, 4500, 9000, [1, 2, 3],
    { note: 'Highest-return dollar in the whole budget.' }),
  t('sod', 'Sod and soil prep', 'sf', 'each', 800, 2.2, 3.6, 5.5, [2, 3]),
  t('drought', 'Drought-tolerant planting and gravel', 'sf', 'each', 800, 4, 7, 12, [],
    { note: 'Alternative to sod. Cheaper to keep alive through a long marketing period.' }),
  t('irrigation', 'Irrigation and controller', 'allow', 'each', 1, 1800, 3400, 6500, [2, 3]),
  t('fence', 'Fencing', 'lf', 'each', 120, 38, 58, 90, [2, 3]),
  t('gate', 'Gates', 'ea', 'each', 2, 650, 1200, 2400, [2, 3]),
  t('deck', 'Deck build or re-deck', 'sf', 'each', 250, 38, 62, 105, [3]),
  t('patio', 'Patio — pavers or stamped concrete', 'sf', 'each', 300, 16, 26, 42, [3]),
  t('retaining', 'Retaining wall', 'lf', 'each', 40, 145, 240, 420, []),
  t('tree', 'Tree removal and trimming', 'allow', 'each', 1, 1200, 2800, 7000, [1, 2, 3]),
  t('driveway', 'Driveway replacement', 'sf', 'each', 600, 12, 18, 27, []),
  t('ext-light', 'Exterior and landscape lighting', 'allow', 'each', 1, 800, 1700, 3400, [2, 3]),
];

const DEMO: SowTask[] = [
  t('interior', 'Interior strip-out', 'sf', 'houseSf', 1, 3, 5, 8, [3]),
  t('flooring', 'Flooring removal and disposal', 'sf', 'houseSf', 1, 1.75, 2.75, 4, [2, 3]),
  t('dumpster', 'Dumpsters — 30 yard, per pull', 'ea', 'each', 3, 750, 950, 1300, [1, 2, 3], { missed: true }),
  t('haul', 'Debris hauling and labour', 'allow', 'each', 1, 1800, 3200, 5500, [1, 2, 3]),
  t('asbestos', 'Asbestos abatement', 'allow', 'each', 1, 3500, 8500, 22000, [],
    { missed: true, note: 'Assume it on anything pre-1980 until tested.' }),
  t('lead', 'Lead paint remediation', 'allow', 'each', 1, 2500, 6000, 15000, [], { missed: true }),
  t('fence-temp', 'Temporary fencing and site protection', 'allow', 'each', 1, 900, 1600, 2800, [2, 3]),
];

const SOFT: SowTask[] = [
  t('permit-build', 'Building permit', 'ea', 'each', 1, 2500, 5500, 14000, [2, 3], { missed: true }),
  t('permit-trades', 'Electrical, plumbing and mechanical permits', 'allow', 'each', 1, 1000, 2000, 4300, [2, 3]),
  t('plancheck', 'Plan check and city review', 'ea', 'each', 1, 900, 2200, 5500, [3]),
  t('architect', 'Architect — drawings and permit set', 'allow', 'each', 1, 4500, 9500, 22000, [3]),
  t('engineer', 'Structural engineer and calcs', 'allow', 'each', 1, 2200, 4500, 9500, [3]),
  t('title24', 'Title 24 energy compliance', 'ea', 'each', 1, 550, 950, 1800, [2, 3], { missed: true }),
  t('survey', 'Survey and site plan', 'ea', 'each', 1, 1200, 2400, 4500, []),
  t('portapotty', 'Portable toilet and site sanitation', 'allow', 'each', 1, 450, 850, 1500, [2, 3]),
  t('temppower', 'Temporary power and utilities', 'allow', 'each', 1, 600, 1200, 2400, [3]),
  t('clean', 'Final construction clean', 'allow', 'each', 1, 650, 1200, 2200, [1, 2, 3]),
  t('gc', 'General contractor fee', 'pct', 'each', 1, 12, 18, 25, [1, 2, 3],
    { pctOfHard: true, note: 'Percent of every hard cost above.' }),
  t('genconditions', 'General conditions — supervision, tools, delivery', 'pct', 'each', 1, 3, 5, 8, [2, 3],
    { pctOfHard: true }),
  t('contingency', 'Contingency', 'pct', 'each', 1, 10, 15, 20, [1, 2, 3],
    { pctOfHard: true, missed: true, note: 'The line that saves deals. 10% cosmetic, 15–20% on a gut.' }),
];

/* ----------------------------------------------------------------- the model */

export const SPACE_DEFS: SpaceDef[] = [
  { kind: 'kitchen',    label: 'Kitchen',              room: true, share: 0.12, tasks: KITCHEN },
  { kind: 'bathroom',   label: 'Bathroom',             room: true, share: 0.05, tasks: BATHROOM },
  { kind: 'halfbath',   label: 'Half Bath',            room: true, share: 0.02, tasks: HALFBATH },
  { kind: 'bedroom',    label: 'Bedroom',              room: true, share: 0.11, tasks: BEDROOM },
  { kind: 'living',     label: 'Living Room',          room: true, share: 0.16, tasks: LIVING },
  { kind: 'dining',     label: 'Dining Room',          room: true, share: 0.09, tasks: DINING },
  { kind: 'laundry',    label: 'Laundry',              room: true, share: 0.03, tasks: LAUNDRY },
  { kind: 'hall',       label: 'Hallways & Stairs',    room: true, share: 0.08, tasks: HALL },
  { kind: 'garage',     label: 'Garage',               room: true, tasks: GARAGE },
  { kind: 'roof',       label: 'Roof & Gutters',       room: false, tasks: ROOF },
  { kind: 'exterior',   label: 'Exterior & Curb Appeal', room: false, tasks: EXTERIOR },
  { kind: 'structural', label: 'Structural & Foundation', room: false, tasks: STRUCTURAL },
  { kind: 'electrical', label: 'Electrical — whole house', room: false, tasks: ELECTRICAL },
  { kind: 'plumbing',   label: 'Plumbing — whole house',  room: false, tasks: PLUMBING },
  { kind: 'hvac',       label: 'HVAC',                 room: false, tasks: HVAC },
  { kind: 'windows',    label: 'Windows & Doors',      room: false, tasks: WINDOWS },
  { kind: 'landscape',  label: 'Landscaping & Yard',   room: false, tasks: LANDSCAPE },
  { kind: 'demo',       label: 'Demolition & Site',    room: false, tasks: DEMO },
  { kind: 'soft',       label: 'Permits & Soft Costs', room: false, tasks: SOFT },
];

export const DEF_BY_KIND: Record<string, SpaceDef> =
  Object.fromEntries(SPACE_DEFS.map(d => [d.kind, d]));

/** A concrete space in this house — "Bedroom 2", or the one Roof section. */
export interface SpaceInstance {
  id: string;
  kind: SpaceKind;
  label: string;
  /** area in square feet; rooms only */
  sqft: number;
  room: boolean;
}

export interface PropertyShape {
  sqft: number; beds: number; baths: number; halfBaths: number;
  stories: number; garageBays: number;
}

/** Rough exterior perimeter from floor area — enough to price bolting and
    gutters without asking for a site plan. */
export const perimeterOf = (p: PropertyShape) =>
  p.sqft > 0 ? Math.round(4 * Math.sqrt(p.sqft / Math.max(1, p.stories))) : 0;

/** Generate every space in this house, rooms first, then the sections that
    belong to no room. Room areas seed from a share of living area and are
    editable per space. */
export function buildSpaces(p: PropertyShape): SpaceInstance[] {
  const out: SpaceInstance[] = [];
  const room = (kind: SpaceKind, n: number, label?: string) => {
    const def = DEF_BY_KIND[kind];
    for (let i = 1; i <= n; i++) {
      out.push({
        id: `${kind}-${i}`, kind, room: true,
        label: n > 1 ? `${def.label} ${i}` : (label ?? def.label),
        sqft: kind === 'garage'
          ? Math.max(1, p.garageBays) * 200
          : Math.round(p.sqft * (def.share ?? 0.1)),
      });
    }
  };
  room('kitchen', 1);
  room('bathroom', Math.max(0, Math.round(p.baths)));
  room('halfbath', Math.max(0, Math.round(p.halfBaths)));
  room('bedroom', Math.max(0, Math.round(p.beds)));
  room('living', 1);
  room('dining', 1);
  room('laundry', 1);
  room('hall', 1);
  if (p.garageBays > 0) room('garage', 1);
  for (const d of SPACE_DEFS) {
    if (!d.room) out.push({ id: d.kind, kind: d.kind, label: d.label, sqft: 0, room: false });
  }
  return out;
}

/** Rough interior perimeter of a room from its area, for trim and base. */
const roomPerim = (sf: number) => sf > 0 ? Math.round(4 * Math.sqrt(sf)) : 0;

export function taskQty(
  task: SowTask, space: SpaceInstance, p: PropertyShape,
): number {
  const b = task.basis === 'roomSf' ? space.sqft
    : task.basis === 'houseSf' ? p.sqft
    : task.basis === 'perimeter' ? perimeterOf(p)
    : task.basis === 'roomPerim' ? roomPerim(space.sqft)
    : 1;
  const q = b * task.qty;
  return task.basis === 'each' ? task.qty : Math.max(0, Math.round(q * 100) / 100);
}

/** The full key for one task in one space. */
export const taskKey = (spaceId: string, taskId: string) => `${spaceId}.${taskId}`;

export interface SpaceTotal {
  id: string; label: string; room: boolean;
  low: number; base: number; high: number; count: number; total: number;
}

export interface SowTotals {
  low: number; base: number; high: number;
  hardLow: number; hardBase: number; hardHigh: number;
  spaces: SpaceTotal[];
  checkedCount: number;
  /** spaces with nothing scoped — the omission check */
  emptySpaces: string[];
  /** commonly-missed tasks that are still unchecked */
  missedUnchecked: { key: string; space: string; desc: string }[];
}

export function computeSow(
  spaces: SpaceInstance[],
  checked: Record<string, boolean>,
  qtyOverride: Record<string, number>,
  prices: Record<string, number>,
  p: PropertyShape,
): SowTotals {
  const priceOf = (kind: string, task: SowTask, k: 'low' | 'base' | 'high') => {
    const v = prices[`${kind}.${task.id}.${k}`];
    return v !== undefined ? v : task[k];
  };

  let hardLow = 0, hardBase = 0, hardHigh = 0, checkedCount = 0;
  const emptySpaces: string[] = [];
  const missedUnchecked: { key: string; space: string; desc: string }[] = [];

  /* hard costs first — percent lines ride on their total */
  const raw = spaces.map(sp => {
    const def = DEF_BY_KIND[sp.kind];
    let low = 0, base = 0, high = 0, count = 0;
    for (const task of def.tasks) {
      const key = taskKey(sp.id, task.id);
      if (!checked[key]) {
        if (task.missed) missedUnchecked.push({ key, space: sp.label, desc: task.desc });
        continue;
      }
      count++;
      if (task.pctOfHard) continue;
      const q = qtyOverride[key] !== undefined ? qtyOverride[key] : taskQty(task, sp, p);
      low += q * priceOf(sp.kind, task, 'low');
      base += q * priceOf(sp.kind, task, 'base');
      high += q * priceOf(sp.kind, task, 'high');
    }
    if (count === 0) emptySpaces.push(sp.label);
    checkedCount += count;
    hardLow += low; hardBase += base; hardHigh += high;
    return { sp, def, low, base, high, count };
  });

  const spaceTotals: SpaceTotal[] = raw.map(({ sp, def, low, base, high, count }) => {
    for (const task of def.tasks) {
      if (!task.pctOfHard || !checked[taskKey(sp.id, task.id)]) continue;
      low += hardLow * priceOf(sp.kind, task, 'low') / 100;
      base += hardBase * priceOf(sp.kind, task, 'base') / 100;
      high += hardHigh * priceOf(sp.kind, task, 'high') / 100;
    }
    return { id: sp.id, label: sp.label, room: sp.room, low, base, high, count, total: def.tasks.length };
  });

  return {
    low: spaceTotals.reduce((a, x) => a + x.low, 0),
    base: spaceTotals.reduce((a, x) => a + x.base, 0),
    high: spaceTotals.reduce((a, x) => a + x.high, 0),
    hardLow, hardBase, hardHigh,
    spaces: spaceTotals, checkedCount, emptySpaces, missedUnchecked,
  };
}

/** Level 0 clears a space; 1-3 check exactly the tasks that level includes. */
export function applyLevel(
  space: SpaceInstance, level: 0 | Level, checked: Record<string, boolean>,
): Record<string, boolean> {
  const next = { ...checked };
  for (const task of DEF_BY_KIND[space.kind].tasks) {
    const key = taskKey(space.id, task.id);
    if (level === 0) delete next[key];
    else if (task.levels.includes(level)) next[key] = true;
    else delete next[key];
  }
  return next;
}

export const LEVEL_LABELS: { v: 0 | Level; label: string; hint: string }[] = [
  { v: 0, label: 'Skip',     hint: 'Nothing in this space' },
  { v: 1, label: 'Refresh',  hint: 'Paint, fixtures, cosmetics' },
  { v: 2, label: 'Renovate', hint: 'New finishes and surfaces' },
  { v: 3, label: 'Gut',      hint: 'To the studs and back' },
];
