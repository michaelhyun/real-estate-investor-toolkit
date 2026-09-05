/* Renovation Guide — a reference, not a calculator.

   Fifty renovations people actually ask about, priced for the Bay Area, where
   labour runs well above national averages and permitting is its own line item.
   Every entry carries the two things a cost table normally leaves out: what
   actually moves the price, and the thing people get wrong.

   Two figures per renovation, because one is never enough. The UNIT cost is
   what a contractor quotes. The PROJECT range is what the job comes to on a
   typical 1,500 sqft Bay Area single-family home — which is the number someone
   is really asking for when they ask what a renovation costs.

   Costs are current-market estimates for screening and budgeting, not quotes.
   They move with materials, labour availability and the city you are in. */

export type RenoCategory =
  | 'Kitchen' | 'Bathroom' | 'Flooring' | 'Interior' | 'Windows & Doors'
  | 'Electrical' | 'Plumbing' | 'HVAC' | 'Exterior' | 'Structural'
  | 'Outdoor' | 'Adding Space';

export type PermitNeed = 'none' | 'sometimes' | 'yes';
/** Directional, not a promise — Bay Area resale rewards kitchens, baths and
    curb appeal far more than it rewards mechanical work, even when the
    mechanical work is what the house actually needs. */
export type Resale = 'high' | 'medium' | 'low';

export interface RenoItem {
  id: string;
  name: string;
  category: RenoCategory;
  /** what the unit price is per */
  unit: string;
  unitLow: number;
  unitHigh: number;
  /** whole-job range on a typical 1,500 sqft Bay Area home */
  projectLow: number;
  projectHigh: number;
  /** typical time on site */
  days: string;
  permit: PermitNeed;
  resale: Resale;
  /** what moves the price within the range */
  drivers: string;
  /** the thing that catches people out */
  watch: string;
}

const r = (
  id: string, name: string, category: RenoCategory, unit: string,
  unitLow: number, unitHigh: number, projectLow: number, projectHigh: number,
  days: string, permit: PermitNeed, resale: Resale, drivers: string, watch: string,
): RenoItem => ({
  id, name, category, unit, unitLow, unitHigh, projectLow, projectHigh,
  days, permit, resale, drivers, watch,
});

export const RENOVATIONS: RenoItem[] = [
  /* ------------------------------------------------------------- Kitchen */
  r('kitchen-full', 'Full kitchen remodel', 'Kitchen', 'kitchen', 35000, 120000, 35000, 120000,
    '4–8 weeks', 'yes', 'high',
    'Cabinet grade is the single biggest lever — stock to semi-custom roughly doubles the cabinet line. Moving plumbing or gas, or opening a wall, adds structural and permit cost.',
    'Appliance lead times can idle a finished kitchen for weeks. Order them before demolition, not after.'),
  r('cabinets-reface', 'Cabinet refacing or repainting', 'Kitchen', 'linear foot', 145, 380, 3200, 8500,
    '3–6 days', 'none', 'high',
    'Spray refinishing costs more than brush-and-roll and looks it. New doors and drawer fronts sit at the top of the range.',
    'Only worth it if the boxes are solid and the layout works. On damaged or particle-board boxes you are paying to keep a problem.'),
  r('cabinets-new', 'New kitchen cabinets', 'Kitchen', 'linear foot', 320, 1300, 7000, 29000,
    '1–2 weeks install', 'none', 'high',
    'Stock, semi-custom and custom are roughly 1x, 1.8x and 3x. Soft-close, drawer banks and specialty pull-outs add up quietly.',
    'Measure for appliance panels early. A fridge that does not fit its opening is a re-order, not an adjustment.'),
  r('countertops', 'Countertops — quartz or stone slab', 'Kitchen', 'sq ft installed', 75, 165, 4000, 9000,
    '1 day template, 1 day install', 'none', 'high',
    'Quartz sits mid-range; exotic natural stone and thick mitred edges run to the top. Cut-outs, waterfall ends and seams add labour.',
    'Templating happens after cabinets are set, so it is a hard 7–10 day gap in the schedule. Plan the sink and faucet before templating.'),
  r('backsplash', 'Tile backsplash', 'Kitchen', 'project', 950, 3200, 950, 3200,
    '1–2 days', 'none', 'high',
    'Material choice dominates: ceramic subway at the bottom, handmade zellige or slab backsplash at the top. Intricate patterns double the labour.',
    'Outlets in the backsplash need cover plates that match, and often need to be moved. Decide before the tile goes up.'),
  r('kitchen-island', 'Kitchen island', 'Kitchen', 'island', 1800, 12000, 1800, 12000,
    '2–5 days', 'sometimes', 'high',
    'Cabinetry plus its own countertop. Adding a sink, dishwasher or cooktop brings plumbing, electrical and often a permit.',
    'You need 42–48 inches of clearance on all sides. Islands that squeeze the walkway read as a downgrade to buyers.'),
  r('appliances', 'Appliance package', 'Kitchen', 'package', 3800, 20000, 3800, 20000,
    '1 day', 'none', 'medium',
    'Builder-grade to premium is a 4–5x spread. Panel-ready and integrated units cost more in cabinetry as well as in the appliance.',
    'Induction cooking usually needs a dedicated 240V circuit. Budget the electrician alongside the range.'),
  r('bath-full', 'Full bathroom remodel', 'Bathroom', 'bathroom', 18000, 45000, 18000, 45000,
    '3–5 weeks', 'yes', 'high',
    'Whether you move plumbing. Keeping the toilet, tub and vanity in place can cut a third off the job.',
    'Waterproofing behind tile is invisible and non-negotiable. It is the one line never to value-engineer.'),
  r('shower-tile', 'Tile shower replacement', 'Bathroom', 'shower', 4500, 12000, 4500, 12000,
    '1–2 weeks', 'sometimes', 'high',
    'Tile size and pattern, niche and bench work, and whether the pan is pre-formed or hot-mopped.',
    'A frameless glass enclosure is measured after tile and takes 2–3 weeks to fabricate. It is usually the last thing to arrive.'),
  r('tub-to-shower', 'Tub-to-shower conversion', 'Bathroom', 'each', 3200, 12000, 3200, 12000,
    '1–2 weeks', 'sometimes', 'medium',
    'Drain relocation, whether the walls open, and the glass. A curbless conversion needs the floor structure lowered.',
    'Removing the only tub in the house can cost you family buyers. Keep one tub if the home has three or more bedrooms.'),
  r('vanity', 'Vanity replacement', 'Bathroom', 'each', 950, 4200, 950, 4200,
    '1 day', 'none', 'high',
    'Stock versus custom, and whether the top is cultured marble or stone slab.',
    'Plumbing rough-in heights rarely match a new vanity exactly. Assume a plumber, not just a handyman.'),
  r('floor-refinish', 'Hardwood refinishing', 'Flooring', 'sq ft', 4.5, 10.5, 4500, 10500,
    '3–5 days plus cure', 'none', 'high',
    'Number of coats, stain versus natural, and whether the floor needs repairs before sanding.',
    'Oil-based finish needs 3–5 days to cure before furniture returns. Water-based costs more and cures faster.'),
  r('floor-hardwood', 'New hardwood flooring', 'Flooring', 'sq ft', 11, 26, 11000, 26000,
    '1–2 weeks', 'none', 'high',
    'Engineered versus solid, plank width, and site-finished versus pre-finished. Wide-plank white oak sits at the top.',
    'Subfloor flatness drives cost and nobody quotes it until demolition. Budget for levelling.'),
  r('floor-lvp', 'Luxury vinyl plank', 'Flooring', 'sq ft', 6.5, 14, 6500, 14000,
    '3–6 days', 'none', 'medium',
    'Wear-layer thickness and whether it is glue-down or floating. Rigid-core costs more and performs better.',
    'Cheap LVP telegraphs every subfloor imperfection and dents under appliance legs. The bottom of the range is a false economy.'),
  r('floor-tile', 'Tile flooring', 'Flooring', 'sq ft', 13, 29, 4000, 9000,
    '4–8 days', 'none', 'medium',
    'Tile size, pattern and whether the substrate needs a decoupling membrane. Large-format tile needs a flatter floor.',
    'Heated floor is far cheaper to add during tiling than after. Decide before the substrate goes down.'),
  r('paint-interior', 'Interior painting', 'Interior', 'sq ft of floor', 3, 7, 4500, 10500,
    '4–8 days', 'none', 'high',
    'Ceilings and trim included or not, number of colours, and how much patching and priming the walls need.',
    'The cheapest quote usually means one coat over a dark colour. Ask how many coats are in the price.'),
  r('baseboards', 'Baseboard and trim replacement', 'Interior', 'linear foot', 9, 22, 2500, 6000,
    '3–5 days', 'none', 'medium',
    'Profile height and material — MDF at the bottom, primed poplar and paint-grade hardwood above. Taller profiles cost more to install as well as to buy.',
    'Removing old base often takes drywall with it. Patching and repainting the wall is part of the job, not an extra.'),
  r('popcorn', 'Popcorn ceiling removal', 'Interior', 'sq ft', 3, 7, 3000, 7000,
    '3–6 days', 'none', 'medium',
    'Whether the texture tests positive for asbestos, and whether the ceiling gets skim-coated smooth or re-textured.',
    'Anything installed before 1980 must be tested. Abatement adds $3–8k and is not optional once it tests positive.'),
  r('interior-doors', 'Interior doors', 'Interior', 'each', 450, 1500, 3500, 11000,
    '2–4 days', 'none', 'medium',
    'Hollow-core to solid-core roughly doubles it. Pre-hung units cost more than slabs but install far faster.',
    'Solid-core doors are the cheapest upgrade that makes a house feel expensive. Worth the difference.'),
  r('recessed-lighting', 'Recessed LED lighting', 'Interior', 'each', 185, 480, 2200, 6000,
    '2–4 days', 'yes', 'high',
    'Whether the ceiling is open, insulated, or has to be fished. New circuits and dimmers add cost.',
    'Too many cans reads as an office. Plan the layout rather than gridding the ceiling.'),
  r('windows-retrofit', 'Window replacement — vinyl retrofit', 'Windows & Doors', 'each', 650, 1450, 8000, 18000,
    '2–4 days', 'yes', 'medium',
    'Frame material, size and whether it is a retrofit into the existing frame or a full new-construction replacement.',
    'Retrofit frames lose a little glass area and leave the old frame in place. Full replacement costs more and looks better.'),
  r('entry-door', 'Entry door replacement', 'Windows & Doors', 'each', 1400, 5500, 1400, 5500,
    '1 day', 'sometimes', 'high',
    'Slab versus pre-hung, material, and sidelights or transoms. Solid wood and steel sit at the top.',
    'One of the highest-return dollars in a renovation. It is the first thing anyone touches.'),
  r('patio-door', 'Sliding or French patio door', 'Windows & Doors', 'each', 2200, 7000, 2200, 7000,
    '1–2 days', 'yes', 'medium',
    'Width, material and whether the opening is enlarged. Multi-slide and pocketing doors run well past the top of this range.',
    'Widening an opening in a bearing wall needs a header and an engineer. That is a different project.'),

  /* ---------------------------------------------------------- Electrical */
  r('panel-upgrade', 'Electrical panel upgrade to 200A', 'Electrical', 'each', 3200, 8500, 3200, 8500,
    '1–2 days plus utility', 'yes', 'medium',
    'Whether the service drop and meter move, and how far the panel is from the utility connection. Underground service costs more.',
    'PG&E scheduling, not the electrician, sets the timeline. Allow 4–12 weeks from application in the Bay Area.'),
  r('ev-charger', 'EV charger installation', 'Electrical', 'each', 950, 3200, 950, 3200,
    '1 day', 'yes', 'medium',
    'Distance from the panel to the parking space and whether the panel has capacity. A long conduit run through finished space is most of the cost.',
    'Many older Bay Area homes have 100A service with no room for a 50A circuit. Check capacity before buying the charger.'),
  r('rewire', 'Whole-house rewire', 'Electrical', 'sq ft', 11, 26, 16000, 39000,
    '2–4 weeks', 'yes', 'low',
    'Whether walls are already open. Rewiring a finished house means cutting and patching every room.',
    'Almost always worth doing during a gut and almost never worth doing on its own. Combine it with other work.'),
  r('knob-and-tube', 'Knob-and-tube removal', 'Electrical', 'sq ft', 8, 20, 12000, 30000,
    '2–3 weeks', 'yes', 'low',
    'How much remains active and how accessible it is. Attic and crawlspace runs are cheaper than in-wall.',
    'Many insurers will not write a policy and many lenders will not fund with active knob-and-tube. It can block a sale.'),
  r('solar', 'Solar PV system', 'Electrical', 'system', 12000, 32000, 12000, 32000,
    '2–4 days plus approvals', 'yes', 'medium',
    'System size, roof complexity and whether battery storage is included. Battery roughly adds half again.',
    'Do the roof first. Removing and resetting panels for a reroof later costs $3–6k.'),

  /* ------------------------------------------------------------ Plumbing */
  r('repipe', 'Whole-house repipe', 'Plumbing', 'sq ft', 8, 21, 12000, 31000,
    '1–2 weeks', 'yes', 'low',
    'PEX versus copper, number of fixtures, and slab versus crawlspace access.',
    'Galvanised supply lines fail from the inside out. Low pressure and rusty water mean it is already overdue.'),
  r('sewer-lateral', 'Sewer lateral replacement', 'Plumbing', 'linear foot', 175, 450, 9000, 23000,
    '2–5 days', 'yes', 'low',
    'Length to the main, depth, and whether it runs under a driveway, mature trees or the street.',
    'Oakland, Berkeley, Albany and Piedmont require a compliance certificate at sale. Scope it before you buy, not after.'),
  r('water-heater', 'Water heater replacement', 'Plumbing', 'each', 1400, 3400, 1400, 3400,
    '1 day', 'yes', 'low',
    'Tank size, gas versus electric, and whether the location needs a pan, expansion tank or new venting.',
    'California requires seismic strapping. An unstrapped heater is a routine inspection call-out.'),
  r('tankless', 'Tankless water heater conversion', 'Plumbing', 'each', 3200, 8000, 3200, 8000,
    '1–2 days', 'yes', 'medium',
    'Gas line upsizing and new venting, which is most of the difference from a tank swap.',
    'A tankless unit usually needs a 3/4-inch gas line. Running one across the house can cost more than the heater.'),
  r('furnace', 'Furnace replacement', 'HVAC', 'each', 3200, 8000, 3200, 8000,
    '1–2 days', 'yes', 'medium',
    'Capacity, efficiency rating and whether the existing ducting and flue can be reused.',
    'Title 24 requires duct leakage testing on a changeout. Budget the test and any duct sealing it triggers.'),
  r('ac-install', 'Air conditioning — condenser and coil', 'HVAC', 'each', 3800, 9500, 3800, 9500,
    '1–2 days', 'yes', 'medium',
    'Tonnage, efficiency, and whether the electrical panel can carry the new load.',
    'Many older Bay Area homes have no AC and no circuit for it. The panel upgrade can cost as much as the unit.'),
  r('heat-pump', 'Heat pump conversion', 'HVAC', 'system', 8500, 24000, 8500, 24000,
    '3–5 days', 'yes', 'medium',
    'Whether ducting is reused, panel capacity, and how many zones. Ducted systems cost more than mini-splits.',
    'Bay Area utility and state rebates can cover a meaningful share. Apply before installation, not after.'),
  r('roof-comp', 'Roof replacement — composition shingle', 'Exterior', 'sq ft of roof', 8.5, 19, 15000, 33000,
    '3–6 days', 'yes', 'medium',
    'Number of existing layers to tear off, pitch, and how much sheathing turns out to be rotten.',
    'Sheathing damage is invisible until tear-off. Get the contractor to state a per-sheet price up front.'),
  r('paint-exterior', 'Exterior painting', 'Exterior', 'sq ft of floor', 4.5, 11, 7000, 16000,
    '1–2 weeks', 'none', 'high',
    'Prep, which is most of the labour — scraping, sanding, caulking and priming. Substrate condition drives the whole quote.',
    'Homes built before 1978 need lead-safe practices. A contractor who does not mention it is cutting a corner.'),
  r('stucco-repair', 'Stucco repair and re-coat', 'Exterior', 'project', 2200, 12000, 2200, 12000,
    '1–2 weeks', 'sometimes', 'medium',
    'Extent of cracking and whether it is a patch, a fog coat or a full re-stucco over new lath.',
    'Cracks that reappear are usually a moisture or foundation problem. Patching them repeatedly treats the symptom.'),
  r('siding', 'Siding replacement', 'Exterior', 'sq ft of wall', 12, 32, 18000, 48000,
    '2–4 weeks', 'yes', 'medium',
    'Material — fibre cement, wood, engineered — and whether the sheathing and weather barrier are replaced underneath.',
    'This is when you find dry rot. Budget a contingency of 10–20% specifically for what is behind the siding.'),
  r('seismic-retrofit', 'Seismic retrofit — foundation bolting', 'Structural', 'linear foot', 38, 85, 5000, 12000,
    '3–7 days', 'yes', 'medium',
    'Perimeter length, crawlspace height, and whether cripple walls need shear plywood as well as bolting.',
    'Earthquake Brace + Bolt grants cover a meaningful share for eligible Bay Area homes. Check eligibility before starting.'),
  r('foundation-repair', 'Foundation repair', 'Structural', 'project', 4000, 30000, 4000, 30000,
    '1–3 weeks', 'yes', 'low',
    'Whether it is crack injection, pier and beam work, or partial replacement. Access and soil type matter enormously.',
    'Get a structural engineer, not just a contractor. A repair designed by the company selling it is a conflict of interest.'),
  r('dry-rot', 'Dry rot and termite repair', 'Structural', 'project', 2500, 18000, 2500, 18000,
    '3 days–2 weeks', 'sometimes', 'low',
    'How far it has spread and whether it reaches structural framing rather than trim and siding.',
    'A near-certainty on Bay Area homes built before 1970. The visible damage is usually a fraction of the total.'),

  /* ------------------------------------------------------------- Outdoor */
  r('landscape-front', 'Front yard landscaping', 'Outdoor', 'project', 2500, 15000, 2500, 15000,
    '3 days–2 weeks', 'none', 'high',
    'Scope — a clean-up, mulch and plants at the bottom; hardscape, irrigation and lighting at the top.',
    'Dollar for dollar the highest-return money in a renovation. It sets the buyer’s expectation before they walk in.'),
  r('fence', 'Fencing', 'Outdoor', 'linear foot', 38, 95, 4500, 11000,
    '2–5 days', 'sometimes', 'medium',
    'Height, material and whether posts go into concrete. Sloped ground and retaining conditions add cost.',
    'Confirm the property line before building. A fence in the wrong place is a survey and a rebuild.'),
  r('deck', 'Deck build or replacement', 'Outdoor', 'sq ft', 38, 105, 9500, 26000,
    '1–3 weeks', 'yes', 'medium',
    'Pressure-treated versus composite versus hardwood, height off grade, and railing style.',
    'Decks over 30 inches high need a permit and a railing to code. An unpermitted deck shows up in disclosures.'),
  r('patio', 'Patio — pavers or stamped concrete', 'Outdoor', 'sq ft', 16, 42, 4800, 12600,
    '3–7 days', 'sometimes', 'medium',
    'Material, base preparation and drainage. A proper compacted base is most of the difference between a patio that lasts and one that heaves.',
    'Adding impervious surface can trigger stormwater requirements in some Bay Area cities. Check before you pour.'),
  r('adu-detached', 'Detached ADU', 'Adding Space', 'sq ft', 350, 700, 210000, 420000,
    '8–14 months', 'yes', 'high',
    'Size, site access, and utility connections — running sewer, water and power to a back-yard structure is a large share of the cost.',
    'California law now limits how much cities can restrict ADUs, but impact fees, utility connections and site work still decide whether the numbers work.'),
  r('garage-conversion', 'Garage conversion or JADU', 'Adding Space', 'sq ft', 150, 350, 60000, 140000,
    '3–6 months', 'yes', 'medium',
    'Whether it needs its own bathroom and kitchen, plus insulation, egress windows, and raising the slab to meet floor height.',
    'Losing the only covered parking can hurt resale in some neighbourhoods. Check what comparable homes have.'),
  r('room-addition', 'Room addition', 'Adding Space', 'sq ft', 400, 800, 120000, 320000,
    '6–12 months', 'yes', 'high',
    'Foundation, roof tie-in, and whether the existing systems can carry the added load. Second-storey additions cost substantially more than ground-floor.',
    'Design and permitting alone run 3–6 months in most Bay Area cities before construction starts.'),
  r('bathroom-addition', 'Adding a bathroom', 'Adding Space', 'each', 25000, 65000, 25000, 65000,
    '4–8 weeks', 'yes', 'high',
    'Distance to existing drain lines and whether the floor structure can be cut for the waste line.',
    'Going from one bathroom to two changes the buyer pool more than almost any other renovation of this size.'),
];

export const RENO_CATEGORIES: RenoCategory[] = [
  'Kitchen', 'Bathroom', 'Flooring', 'Interior', 'Windows & Doors',
  'Electrical', 'Plumbing', 'HVAC', 'Exterior', 'Structural', 'Outdoor', 'Adding Space',
];

export const PERMIT_LABEL: Record<PermitNeed, string> = {
  none: 'No permit', sometimes: 'Sometimes', yes: 'Permit required',
};
export const RESALE_LABEL: Record<Resale, string> = {
  high: 'Strong return', medium: 'Moderate return', low: 'Little return',
};

/** Free-text search across name, category and both note fields, so searching
    "asbestos" or "PG&E" finds the entry that warns about it. */
export function searchRenovations(
  q: string, category: RenoCategory | 'all', items: RenoItem[] = RENOVATIONS,
): RenoItem[] {
  const needle = q.trim().toLowerCase();
  return items.filter(i => {
    if (category !== 'all' && i.category !== category) return false;
    if (!needle) return true;
    return `${i.name} ${i.category} ${i.drivers} ${i.watch}`.toLowerCase().includes(needle);
  });
}

export function countByCategory(items: RenoItem[] = RENOVATIONS): Record<string, number> {
  const out: Record<string, number> = {};
  for (const i of items) out[i.category] = (out[i.category] ?? 0) + 1;
  return out;
}
