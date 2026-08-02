/* Portfolio ROE Dashboard engine — direct port of the original portfolio.html
   metrics() and the v1→v2 row migration. Storage schema (portfolio.v1) unchanged. */

export interface UnitValue { v: number; unit: 'mo' | 'yr'; }

export interface PropertyState {
  name: string;
  dateAcq: string;
  ownPct: number;
  price: number;
  down: number;
  other: number;
  value: number;
  loan: number;
  rate: number;
  pay: number;
  income: UnitValue;
  opex: UnitValue;
  taxes: UnitValue;
  ins: UnitValue;
  cfOverride: number | null;
}

export interface PropertyMetrics {
  cfAuto: number; cfM: number; cfY: number; coc: number;
  equityFull: number; equityShare: number; cfShare: number;
  paydownY: number; roe: number; appr: number; holdYrs: number; own: number;
}

/* v1 row → v2 */
export function migrate(p: any): PropertyState {
  if (p.income) return p as PropertyState;      /* already v2 */
  return {
    name: p.name || '', dateAcq: '', ownPct: 100,
    price: 0, down: p.invested || 0, other: 0,
    value: p.value || 0, loan: p.loan || 0, rate: p.rate || 0, pay: p.pay || 0,
    income: { v: p.rent || 0, unit: 'mo' }, opex: { v: p.opex || 0, unit: 'mo' },
    taxes: { v: 0, unit: 'mo' }, ins: { v: 0, unit: 'mo' }, cfOverride: null,
  };
}

export const perMo = (u: UnitValue): number => u.unit === 'yr' ? (u.v || 0) / 12 : (u.v || 0);

/* now: injectable so callers pass Date.now(); keeps this module clock-free. */
export function metrics(p: PropertyState, now: number): PropertyMetrics {
  const own = (p.ownPct > 0 ? p.ownPct : 100) / 100;
  const incomeM = perMo(p.income), expM = perMo(p.opex) + perMo(p.taxes) + perMo(p.ins);
  const cfAuto = incomeM - expM - (p.pay || 0);
  const cfM = (p.cfOverride ?? cfAuto);
  const cfY = cfM * 12;
  const invested = (p.down || 0) + (p.other || 0);
  const coc = invested > 0 ? cfY / invested * 100 : NaN;
  const equityFull = (p.value || 0) - (p.loan || 0);
  const paydownY = p.loan > 0 ? Math.max(0, (p.pay || 0) * 12 - p.loan * (p.rate || 0) / 100) : 0;
  const roe = equityFull > 0 ? (cfY + paydownY) / equityFull * 100 : NaN;
  const appr = p.price > 0 ? ((p.value || 0) - p.price) / p.price * 100 : NaN;
  let holdYrs = NaN;
  if (p.dateAcq) { holdYrs = (now - new Date(p.dateAcq).getTime()) / 31557600000; }
  return {
    cfAuto, cfM, cfY, coc, equityFull, equityShare: equityFull * own,
    cfShare: cfM * own, paydownY, roe, appr, holdYrs, own,
  };
}
