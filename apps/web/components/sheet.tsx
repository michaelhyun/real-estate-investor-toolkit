'use client';

/* The spreadsheet row primitives, shared by every sheet-shaped tool.

   The reading task in these tools is scanning a column of figures, not
   filling in a form, so a group is a dense ruled table rather than a stack
   of airy input rows. Widths live in CSS classes, never inline, so the
   media queries can take them back on a narrow screen. */

import { NumInput } from './ui';

/** A section header. Given `onToggle` it also folds the rows under it — the
    tag holds that section's headline figure, so a shut section still reports
    the one number you would have opened it for. */
export const Band = ({ children, tag, span = 3, open, onToggle }: {
  children: React.ReactNode; tag?: React.ReactNode; span?: number;
  open?: boolean; onToggle?: () => void;
}) => (
  <tr className={`band${onToggle ? ' fold' : ''}${onToggle && !open ? ' shut' : ''}`}>
    <td colSpan={span} onClick={onToggle}
      role={onToggle ? 'button' : undefined} tabIndex={onToggle ? 0 : undefined}
      onKeyDown={onToggle ? ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onToggle(); } } : undefined}>
      {onToggle && <span className="chev" aria-hidden />}
      {children}
      {tag && <span className="tag">{tag}</span>}
    </td>
  </tr>
);

export const Sec = ({ children, span = 3 }: { children: React.ReactNode; span?: number }) => (
  <tr className="sec"><td colSpan={span}>{children}</td></tr>
);

/** A section-wide guidance row, sitting directly under its band header. */
export const G = ({ children, span = 5 }: { children: React.ReactNode; span?: number }) => (
  <tr className="guide"><td colSpan={span}>{children}</td></tr>
);

/** An editable row: label, the input, a static unit, then guidance. The note
    cell is only shown on tables marked `with-notes`. */
export function R({ label, hint, unit, children, ctl, note, amount }: {
  label: React.ReactNode; hint?: string; unit?: React.ReactNode;
  children?: React.ReactNode; ctl?: React.ReactNode; note?: React.ReactNode;
  amount?: React.ReactNode;
}) {
  return (
    <tr>
      <td className="lb">
        {label}
        {/* the unit column is dropped on the narrowest screens, so the unit
            rides along in the label and is revealed there instead */}
        {unit && <span className="u-inline">{unit}</span>}
        {hint && <span className="sub">{hint}</span>}
      </td>
      {ctl ? <td className="ctl" colSpan={2}>{ctl}</td> : <>
        <td className="n">{children}</td>
        <td className="u">{unit}</td>
      </>}
      <td className={`amt${amount == null ? ' muted' : ''}`}>{amount ?? '—'}</td>
      <td className="note">{note}</td>
    </tr>
  );
}

/** A computed row: nothing to type, so the figure sits in the amount column.

    On a phone the amount column is dropped, because on an editable row it only
    echoes the input beside it. A computed row has no input to echo, so the
    figure would vanish — it is therefore rendered a second time in the input
    cell, and the two copies trade places at the breakpoint. */
export function V({ label, hint, value, unit, cls, note }: {
  label: React.ReactNode; hint?: string; value: React.ReactNode;
  unit?: React.ReactNode; cls?: string; note?: React.ReactNode;
}) {
  return (
    <tr className={cls ? `calc ${cls}` : 'calc'}>
      <td className="lb">
        {label}
        {unit && <span className="u-inline">{unit}</span>}
        {hint && <span className="sub">{hint}</span>}
      </td>
      <td className="n"><span className="calc-v">{value}</span></td>
      <td className="u">{unit}</td>
      <td className="amt">{value}</td>
      <td className="note">{note}</td>
    </tr>
  );
}

export const Money = ({ value, onChange }: { value: number; onChange: (n: number) => void }) =>
  <NumInput value={value} onChange={onChange} />;

export const Num = ({ value, onChange }: { value: number; onChange: (n: number) => void }) =>
  <NumInput fmt="raw" value={value} onChange={onChange} />;

/** A count that never realistically exceeds a handful reads better — and is far
    faster on a phone — as a picker than as a free-text field. */
export function Count({ value, onChange, max, from = 0 }: {
  value: number; onChange: (n: number) => void; max: number; from?: number;
}) {
  const opts = Array.from({ length: max - from + 1 }, (_, i) => from + i);
  return (
    <select className="ss-count" value={value} onChange={ev => onChange(Number(ev.target.value))}>
      {!opts.includes(value) && <option value={value}>{value}</option>}
      {opts.map(n => <option key={n} value={n}>{n}</option>)}
    </select>
  );
}
