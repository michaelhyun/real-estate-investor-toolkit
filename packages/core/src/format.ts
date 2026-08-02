/* Shared formatting & parsing — behavior identical to the original tools. */

export const money = (n: number): string =>
  (n < 0 ? '−$' : '$') + Math.round(Math.abs(n)).toLocaleString('en-US');

export const money0 = (n: number): string =>
  '$' + Math.round(Math.abs(n)).toLocaleString('en-US');

export const pct = (n: number, d = 1): string =>
  (isFinite(n) ? n.toFixed(d) : '—') + '%';

export const stripZeros = (s: string): string => s.replace(/\.?0+%$/, '%');

export const parseNum = (s: unknown): number => {
  const n = parseFloat(String(s).replace(/[^0-9.\-]/g, ''));
  return isFinite(n) ? n : 0;
};

export const fmtYears = (months: number): string => {
  const y = Math.floor(months / 12), mo = months % 12;
  return mo ? `${y}y ${mo}m` : `${y} yrs`;
};

export const fmtMoneyInput = (n: number): string =>
  Math.round(n).toLocaleString('en-US');
