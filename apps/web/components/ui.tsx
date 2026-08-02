'use client';

import { useEffect, useRef, useState } from 'react';
import { parseNum, fmtMoneyInput } from '@reit/core';

/* ---------- NumInput: text input with money/raw formatting on blur ----------
   Mirrors the original behavior: free typing while focused, live onChange with
   the parsed number, reformat from the numeric value on blur. */
export function NumInput({
  value, onChange, fmt = 'money', small = false, className = '',
  readOnly = false, placeholder, width, textAlignLeft = false,
}: {
  value: number;
  onChange: (n: number) => void;
  fmt?: 'money' | 'raw';
  small?: boolean;
  className?: string;
  readOnly?: boolean;
  placeholder?: string;
  width?: number;
  textAlignLeft?: boolean;
}) {
  const format = (n: number) => fmt === 'money' ? fmtMoneyInput(n) : String(n);
  const [text, setText] = useState(format(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(format(value));
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [value, focused, fmt]);
  return (
    <input
      className={`num${small ? ' small' : ''}${className ? ' ' + className : ''}`}
      style={{ ...(width ? { width } : {}), ...(textAlignLeft ? { textAlign: 'left' } : {}) }}
      value={text}
      readOnly={readOnly}
      placeholder={placeholder}
      inputMode="decimal"
      autoComplete="off"
      onFocus={() => setFocused(true)}
      onChange={ev => { setText(ev.target.value); onChange(parseNum(ev.target.value)); }}
      onBlur={() => { setFocused(false); if (text.trim() !== '') setText(format(parseNum(text))); }}
    />
  );
}

/* ---------- text input that reports trimmed strings ---------- */
export function TextInput({
  value, onChange, className = '', placeholder, id,
}: {
  value: string; onChange: (v: string) => void; className?: string; placeholder?: string; id?: string;
}) {
  return (
    <input
      id={id}
      type="text"
      className={className}
      value={value}
      placeholder={placeholder}
      autoComplete="off"
      onChange={ev => onChange(ev.target.value)}
    />
  );
}

/* ---------- unit toggle ---------- */
export function UnitToggle({
  options, value, onChange,
}: {
  options: { u: string; label: string }[];
  value: string;
  onChange: (u: string) => void;
}) {
  return (
    <div className="unit-toggle">
      {options.map(o => (
        <button key={o.u} type="button" className={value === o.u ? 'on' : ''}
          onClick={() => onChange(o.u)}>{o.label}</button>
      ))}
    </div>
  );
}

/* ---------- on/off switch ---------- */
export function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} onChange={ev => onChange(ev.target.checked)} />
      <span className="sl" />
    </label>
  );
}

/* ---------- slider with painted fill ---------- */
export function SliderRow({
  label, value, min, max, step, onChange, output,
}: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (n: number) => void; output: string;
}) {
  const fill = (value - min) / (max - min) * 100;
  return (
    <div className="slider-row">
      <div className="slider-head"><label>{label}</label><output>{output}</output></div>
      <input type="range" min={min} max={max} step={step} value={value}
        style={{ ['--fill' as any]: fill + '%' }}
        onChange={ev => onChange(parseFloat(ev.target.value))} />
    </div>
  );
}

/* ---------- card ---------- */
export function Card({
  title, tag, children, dense = false, className = '', style,
}: {
  title?: React.ReactNode; tag?: string; children: React.ReactNode;
  dense?: boolean; className?: string; style?: React.CSSProperties;
}) {
  return (
    <div className={`card${dense ? ' dense' : ''}${className ? ' ' + className : ''}`} style={style}>
      {title != null && <h2>{title}{tag && <span className="tag">{tag}</span>}</h2>}
      <div className="body">{children}</div>
    </div>
  );
}

/* ---------- metric tile ---------- */
export function Tile({
  label, value, note, hero = false, negative = false, valueClass = '',
}: {
  label: string; value: string; note: string;
  hero?: boolean; negative?: boolean; valueClass?: string;
}) {
  return (
    <div className={`tile${hero ? ' hero' : ''}${negative ? ' negative' : ''}`}>
      <div className="t-label">{label}</div>
      <div className={`t-value${valueClass ? ' ' + valueClass : ''}`}>{value}</div>
      <div className="t-note">{note}</div>
    </div>
  );
}

/* ---------- open a print-ready report window ---------- */
export function openReportWindow(doc: string, blockedMsg: string, onBlocked: () => void) {
  const w = window.open('', '_blank');
  if (!w) { onBlocked(); return; }
  w.document.write(doc);
  w.document.close();
  setTimeout(() => { try { w.focus(); w.print(); } catch { } }, 500);
}

/* ---------- localStorage helpers (base keys — accounts come with the backend) ---------- */
export function loadJSON<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : null;
  } catch { return null; }
}
export function saveJSON(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { }
}

/* Shared print-report stylesheet (identical to the original tools). */
export const REPORT_CSS = `
  body { font-family: Georgia, 'Times New Roman', serif; color:#222; max-width:760px; margin:36px auto; padding:0 24px; line-height:1.5; }
  header { border-bottom:3px double #222; padding-bottom:12px; margin-bottom:20px; }
  h1 { font-size:24px; margin:0; }
  .meta { color:#666; font-size:13px; margin-top:4px; }
  h2 { font-size:15px; text-transform:uppercase; letter-spacing:.06em; border-bottom:1px solid #999; padding-bottom:4px; margin:24px 0 8px; }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  td, th { padding:5.5px 4px; border-bottom:1px solid #eee; text-align:left; vertical-align:top; }
  td.r, th.r { text-align:right; white-space:nowrap; }
  tr.total td { font-weight:bold; border-top:1px solid #999; }
  .big { font-size:24px; font-weight:bold; }
  .verdict { padding:10px 14px; border:1px solid #999; border-radius:6px; margin:12px 0; font-weight:bold; }
  .note { margin-top:28px; font-size:11.5px; color:#777; border-top:1px solid #ddd; padding-top:8px; }
  @media print { body { margin:0 auto; } .noprint { display:none; } }
  .noprint { margin:18px 0; }
  .noprint button { font-size:14px; padding:8px 16px; cursor:pointer; }`;

export function escapeHtml(str: string): string {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
