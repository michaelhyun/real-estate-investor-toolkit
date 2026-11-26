'use client';

/* Calculator building blocks, composed from the shadcn/ui primitives in
   components/ui/. Every calculator page is built from these, so a figure, a
   field row or a verdict looks and behaves the same in each tool.

   The older components/ui.tsx holds the pre-shadcn versions; pages that have
   not been migrated still import from there. */

import { createContext, useContext, useEffect, useId, useRef, useState } from 'react';
import { parseNum, fmtMoneyInput } from '@reit/core';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { NativeSelect } from '@/components/ui/native-select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Icon } from '@/components/Icon';

/* ---------- InfoTip: a small "i" that holds a row's note ----------
   The note opens on hover, on keyboard focus and on tap, so it works on a
   phone too. Notes live here instead of on the page to keep rows short. */
export function InfoTip({ children, label = 'More about this', more }: {
  children: React.ReactNode; label?: string;
  /** A page to read more on, shown as a link under the note. */
  more?: string;
}) {
  const host = more ? more.replace(/^https?:\/\/(www\.)?/, '').split('/')[0] : '';
  return (
    <Popover>
      <PopoverTrigger openOnHover delay={120} closeDelay={80}
        render={<button type="button" aria-label={label}
          className="ml-1 inline-flex size-4 translate-y-[3px] items-center justify-center rounded-full text-muted-foreground/70 outline-none hover:text-primary focus-visible:text-primary focus-visible:ring-2 focus-visible:ring-ring/50 data-popup-open:text-primary" />}>
        <Icon name="info" size={15} />
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="block w-64 p-3 text-[0.8125rem] font-normal normal-case leading-snug tracking-normal text-[#3a4352] [&_b]:font-bold [&_b]:text-ink-strong">
        {children}
        {more ? (
          <a href={more} target="_blank" rel="noopener noreferrer"
            className="mt-1.5 flex w-fit items-center gap-0.5 font-semibold text-primary hover:text-primary-hover hover:underline">
            Learn more on {host}<Icon name="open_in_new" size={13} />
          </a>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

/* ---------- Panel: a titled card ----------
   Given onOpenChange, the title bar folds the panel. The tag stays visible
   when shut, so it should hold the panel's headline figure. */
export function Panel({
  title, tag, children, dense = false, className, open = true, onOpenChange,
}: {
  title?: React.ReactNode; tag?: React.ReactNode; children: React.ReactNode;
  dense?: boolean; className?: string; open?: boolean; onOpenChange?: (o: boolean) => void;
}) {
  const id = useId();
  const head = 'flex min-h-11 w-full items-center justify-between gap-3 px-4 text-left';
  const inner = (
    <>
      <h2 className="flex min-w-0 items-center gap-1 truncate text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">
        {onOpenChange && <Icon name="chevron_right" size={18} className={cn('-ml-1.5 transition-transform', open && 'rotate-90')} />}{title}
      </h2>
      {tag != null && <span className="shrink-0 whitespace-nowrap text-xs font-semibold tabular-nums text-muted-foreground">{tag}</span>}
    </>
  );
  return (
    <Card className={cn('gap-0 py-0', className)}>
      {title != null && (onOpenChange
        ? <button type="button" aria-expanded={open} aria-controls={id} onClick={() => onOpenChange(!open)}
            className={cn(head, 'rounded-t-lg hover:bg-muted/50', open ? 'border-b border-line/70' : 'rounded-b-lg')}>{inner}</button>
        : <div className={cn(head, 'border-b border-line/70')}>{inner}</div>)}
      <CardContent id={id} hidden={!open} className={cn('px-4', dense ? 'py-2' : 'py-3')}>{children}</CardContent>
    </Card>
  );
}

/* ---------- Field: a labelled row, label left and control right ----------
   The label's id is handed to the control through context, so NumberField
   and friends are named for screen readers without each page wiring ids. */
const FieldLabel = createContext<string | undefined>(undefined);
export const useFieldLabel = () => useContext(FieldLabel);

export function Field({
  label, hint, info, more, children, className,
}: {
  label: React.ReactNode; hint?: React.ReactNode;
  /** A link for the info note's "Learn more". */
  more?: string;
  /** A note for the row, shown from a small info icon beside the label. */
  info?: React.ReactNode;
  children?: React.ReactNode; className?: string;
}) {
  const id = useId();
  return (
    <div className={cn('flex min-h-9 flex-wrap items-center justify-between gap-x-3 gap-y-0.5 border-b border-line/60 py-[3px] last:border-b-0', className)}>
      <div className="min-w-[110px] flex-1 text-sm leading-snug text-[#3a4352]">
        <span id={id}>{label}</span>
        {info ? <InfoTip more={more}>{info}</InfoTip> : null}
        {hint ? <span className="block text-xs text-muted-foreground">{hint}</span> : null}
      </div>
      <FieldLabel.Provider value={id}>{children}</FieldLabel.Provider>
    </div>
  );
}

/* ---------- Line: a computed row — label left, figure right ---------- */
export function Line({
  label, value, tone, strong = false, total = false, indent = false, className, hint, info, more,
}: {
  label: React.ReactNode; value: React.ReactNode; hint?: React.ReactNode; info?: React.ReactNode; more?: string;
  tone?: 'pos' | 'neg' | 'warn'; strong?: boolean; total?: boolean; indent?: boolean; className?: string;
}) {
  const color = tone === 'pos' ? 'text-success' : tone === 'neg' ? 'text-destructive' : tone === 'warn' ? 'text-warning' : 'text-ink-strong';
  return (
    <div className={cn(
      'flex min-h-8 items-center justify-between gap-3 border-b border-line/60 py-[3px] text-sm last:border-b-0',
      total && 'border-t border-b-0 border-line-strong font-bold', className)}>
      <span className={cn('leading-snug', indent && 'pl-3', strong || total ? 'font-bold text-ink-strong' : tone === 'warn' ? 'text-warning' : 'text-[#3a4352]')}>
        {label}{info ? <InfoTip more={more}>{info}</InfoTip> : null}
        {hint ? <span className="block text-xs font-normal text-muted-foreground">{hint}</span> : null}
      </span>
      <span className={cn('whitespace-nowrap font-semibold tabular-nums', (strong || total) && 'font-bold', color)}>{value}</span>
    </div>
  );
}

/* ---------- SectionLabel: a heading inside a panel ---------- */
export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h3 className="pt-3 pb-0.5 text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground first:pt-1">{children}</h3>;
}

/* One width for every control in a calculator's input column — number fields,
   dropdowns — so they stack with their edges aligned. */
export const CONTROL_W = 'w-28';

/* ---------- NumberField: money/raw input, reformatted on blur ----------
   Free typing while focused, live onChange with the parsed number, reformat
   from the numeric value on blur. */
export function NumberField({
  value, onChange, fmt = 'money', suffix, width = CONTROL_W, className,
  readOnly = false, disabled = false, placeholder, 'aria-label': ariaLabel, step, min, max,
}: {
  /** With a step, the up and down arrow keys nudge the value by it. */
  step?: number; min?: number; max?: number;
  value: number; onChange: (n: number) => void; fmt?: 'money' | 'raw';
  /** A unit shown inside the field, e.g. "%" or "yrs". */
  suffix?: string;
  /** Tailwind width class for the field. Every field in a calculator column
      uses the default, so their edges line up. */
  width?: string;
  className?: string; readOnly?: boolean; disabled?: boolean; placeholder?: string; 'aria-label'?: string;
}) {
  const labelledBy = useFieldLabel();
  const format = (n: number) => fmt === 'money' ? fmtMoneyInput(n) : String(n);
  const [text, setText] = useState(format(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(format(value));
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [value, focused, fmt]);
  return (
    <span className={cn('relative block shrink-0', width)}>
      <Input
        className={cn(
          'h-[30px] w-full px-2 text-right font-medium tabular-nums text-ink-strong',
          suffix && 'pr-9',
          readOnly && 'bg-muted text-muted-foreground',
          className)}
        value={text}
        readOnly={readOnly}
        disabled={disabled}
        placeholder={placeholder}
        inputMode="decimal"
        autoComplete="off"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabel ? undefined : labelledBy}
        onFocus={() => setFocused(true)}
        onKeyDown={step ? ev => {
          if (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown') return;
          ev.preventDefault();
          const next = stepTo(parseNum(text), ev.key === 'ArrowUp' ? 1 : -1, step, min, max);
          setText(format(next)); onChange(next);
        } : undefined}
        onChange={ev => { setText(ev.target.value); onChange(parseNum(ev.target.value)); }}
        onBlur={() => { setFocused(false); if (text.trim() !== '') setText(format(parseNum(text))); }}
      />
      {suffix ? <span aria-hidden className={cn('pointer-events-none absolute inset-y-0 right-2 flex w-6 items-center justify-end text-[0.8125rem] text-muted-foreground', disabled && 'opacity-50')}>{suffix}</span> : null}
    </span>
  );
}

/* The next multiple of step above or below v, kept inside min..max. A value
   typed between steps (6.9) lands on the nearest step in that direction (7). */
export function stepTo(v: number, dir: 1 | -1, step: number, min = -Infinity, max = Infinity) {
  const q = v / step, near = Math.round(q);
  const onStep = Math.abs(q - near) < 1e-6;
  const next = (onStep ? near + dir : dir > 0 ? Math.ceil(q) : Math.floor(q)) * step;
  return Math.min(max, Math.max(min, +next.toFixed(6)));
}

/* ---------- Stepper: minus and plus beside a number field ----------
   Sits where a unit toggle would, so the field keeps its place in the column.
   Hold a button to keep stepping. */
export function Stepper({
  value, onChange, step, min, max, unit = '',
}: { value: number; onChange: (n: number) => void; step: number; min?: number; max?: number; unit?: string }) {
  const cur = useRef(value); cur.current = value;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stop = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  useEffect(() => stop, []);
  const go = (dir: 1 | -1) => { const n = stepTo(cur.current, dir, step, min, max); cur.current = n; onChange(n); };
  const hold = (dir: 1 | -1) => {
    stop(); go(dir);
    const again = (wait: number) => { timer.current = setTimeout(() => { go(dir); again(70); }, wait); };
    again(380);
  };
  const btn = (dir: 1 | -1) => (
    <button type="button" aria-label={`${dir > 0 ? 'Raise' : 'Lower'} by ${step}${unit}`}
      disabled={dir > 0 ? max != null && value >= max : min != null && value <= min}
      onPointerDown={ev => { if (ev.button === 0) hold(dir); }} onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop}
      onKeyDown={ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); go(dir); } }}
      className="flex size-6 items-center justify-center rounded-full text-muted-foreground hover:bg-card hover:text-primary-deep hover:shadow-[0_1px_2px_rgba(14,20,31,0.12)] disabled:pointer-events-none disabled:opacity-40">
      <Icon name={dir > 0 ? 'add' : 'remove'} size={16} />
    </button>
  );
  return <span className="flex shrink-0 select-none items-center rounded-full bg-[#eceff3] p-0.5">{btn(-1)}{btn(1)}</span>;
}

/* ---------- Unit: the suffix after a number field ---------- */
export function Unit({ children }: { children: React.ReactNode }) {
  return <span className="w-6 text-[0.8125rem] text-muted-foreground">{children}</span>;
}

/* ---------- Segmented: pick one of a few units ---------- */
export function Segmented({
  options, value, onChange, 'aria-label': ariaLabel,
}: {
  options: { u: string; label: string }[]; value: string; onChange: (u: string) => void; 'aria-label'?: string;
}) {
  const labelledBy = useFieldLabel();
  return (
    <ToggleGroup
      value={[value]}
      onValueChange={v => { const next = v[v.length - 1]; if (next != null && next !== value) onChange(String(next)); }}
      spacing={0}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabel ? undefined : labelledBy}
      className="shrink-0 rounded-full bg-[#eceff3] p-0.5"
    >
      {options.map(o => (
        <ToggleGroupItem key={o.u} value={o.u}
          className="h-6 min-w-7 rounded-full! px-2 text-[0.8125rem] font-semibold text-muted-foreground hover:bg-transparent hover:text-ink-strong aria-pressed:bg-card aria-pressed:text-primary-deep aria-pressed:shadow-[0_1px_2px_rgba(14,20,31,0.12)]">
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/* ---------- SliderField: label, live readout, slider ---------- */
export function SliderField({
  label, value, min, max, step, onChange, output,
}: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (n: number) => void; output: string;
}) {
  const id = useId();
  return (
    <div className="py-1.5">
      <div className="mb-1.5 flex items-baseline justify-between gap-2 text-sm">
        <span id={id} className="text-[#3a4352]">{label}</span>
        <output className="font-bold tabular-nums text-ink-strong">{output}</output>
      </div>
      <Slider aria-labelledby={id} min={min} max={max} step={step} value={[value]}
        onValueChange={v => onChange(Array.isArray(v) ? v[0] : (v as number))} />
    </div>
  );
}

/* ---------- Stat: one headline figure ---------- */
export function Stat({
  label, value, note, tone, info, more,
}: { label: string; value: string; note?: React.ReactNode; tone?: 'pos' | 'neg'; info?: React.ReactNode; more?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-lg bg-card p-4 shadow-tight">
      <div className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">{label}{info ? <InfoTip more={more}>{info}</InfoTip> : null}</div>
      <div className={cn('text-[1.75rem] font-extrabold leading-tight tracking-[-0.015em] tabular-nums',
        tone === 'pos' ? 'text-success' : tone === 'neg' ? 'text-destructive' : 'text-ink-strong')}>{value}</div>
      {note ? <div className="text-[0.8125rem] leading-snug text-muted-foreground">{note}</div> : null}
    </div>
  );
}

/* ---------- Verdict: the call on the deal — a tint, an icon and a sentence ---------- */
const VERDICT = {
  good: { box: 'bg-success-soft', icon: 'check_circle', ic: 'text-success' },
  ok: { box: 'bg-warning-soft', icon: 'error', ic: 'text-warning' },
  bad: { box: 'bg-destructive-soft', icon: 'cancel', ic: 'text-destructive' },
} as const;

export function Verdict({ tone, title, children }: { tone: keyof typeof VERDICT; title: string; children?: React.ReactNode }) {
  const v = VERDICT[tone];
  return (
    <div role="status" className={cn('flex items-start gap-3 rounded-lg p-4', v.box)}>
      <Icon name={v.icon} size={24} className={cn('mt-0.5', v.ic)} />
      <div>
        <div className="text-lg font-extrabold leading-snug text-ink-strong">{title}</div>
        {children ? <div className="text-[0.9375rem] leading-snug text-[#3a4352]">{children}</div> : null}
      </div>
    </div>
  );
}

/* ---------- Note: an inline message inside a panel ---------- */
export function Note({ tone = 'info', icon, title, children }: {
  tone?: 'info' | 'warn' | 'bad'; icon?: string; title?: React.ReactNode; children?: React.ReactNode;
}) {
  const box = tone === 'warn' ? 'bg-warning-soft' : tone === 'bad' ? 'bg-destructive-soft' : 'bg-primary-tint';
  const ic = tone === 'warn' ? 'text-warning' : tone === 'bad' ? 'text-destructive' : 'text-primary-deep';
  return (
    <div className={cn('my-2 flex items-start gap-2.5 rounded-md px-3 py-2.5 text-sm leading-snug text-[#3a4352]', box)}>
      {icon ? <Icon name={icon} size={20} className={ic} /> : null}
      <div>{title ? <div className="font-bold text-ink-strong">{title}</div> : null}{children}</div>
    </div>
  );
}

/* ---------- Fold: a row that opens a group of rows beneath it ---------- */
export function Fold({
  label, summary, open, onOpenChange, children,
}: { label: React.ReactNode; summary?: React.ReactNode; open: boolean; onOpenChange: (o: boolean) => void; children: React.ReactNode }) {
  const id = useId();
  return (
    <div className="border-b border-line/60 last:border-b-0">
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => onOpenChange(!open)}
        className="flex min-h-9 w-full items-center justify-between gap-3 rounded-sm py-[3px] text-left text-sm text-[#3a4352] hover:text-ink-strong">
        <span className="flex items-center gap-1 font-semibold">
          <Icon name="chevron_right" size={18} className={cn('-ml-1 text-muted-foreground transition-transform', open && 'rotate-90')} />{label}
        </span>
        {summary != null ? <span className="font-semibold tabular-nums text-ink-strong">{summary}</span> : null}
      </button>
      <div id={id} hidden={!open} className="mb-2 ml-1.5 border-l border-line pl-3">{children}</div>
    </div>
  );
}

/* ---------- Sub: rows that belong to the switch above them ---------- */
export function Sub({ children }: { children: React.ReactNode }) {
  return <div className="mb-1 ml-1.5 border-l border-line pl-3">{children}</div>;
}

/* ---------- Toggle: an on/off switch named by its Field ---------- */
export function Toggle({ checked, onChange, disabled = false }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const labelledBy = useFieldLabel();
  return <Switch checked={checked} onCheckedChange={v => onChange(v)} disabled={disabled} aria-labelledby={labelledBy} />;
}

/* ---------- Choice: a native select named by its Field ---------- */
export function Choice({
  value, onChange, disabled = false, children,
}: { value: string | number; onChange: (v: string) => void; disabled?: boolean; children: React.ReactNode }) {
  const labelledBy = useFieldLabel();
  return (
    <NativeSelect size="sm" className={cn('shrink-0', CONTROL_W)} value={value} disabled={disabled} aria-labelledby={labelledBy}
      onChange={ev => onChange(ev.target.value)}>{children}</NativeSelect>
  );
}
