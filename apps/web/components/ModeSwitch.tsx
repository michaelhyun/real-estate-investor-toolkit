'use client';

/* The Rental / Flip switch in the Deal Analyzer's header row: a small track
   with a pill that slides to the chosen side. The two calculators are separate
   components, so the switch is drawn afresh after every change; it remembers
   where the pill last sat and slides from there, so the move still reads as one
   motion. */

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

export type DealMode = 'rental' | 'flip';
const SIDES: { id: DealMode; label: string }[] = [{ id: 'rental', label: 'Rental' }, { id: 'flip', label: 'Flip' }];

let lastShown: DealMode | null = null;

export function ModeSwitch({ mode, onChange }: { mode: DealMode; onChange: (m: DealMode) => void }) {
  const [at, setAt] = useState<DealMode>(lastShown ?? mode);
  useEffect(() => {
    const id = requestAnimationFrame(() => { setAt(mode); lastShown = mode; });
    return () => cancelAnimationFrame(id);
  }, [mode]);

  return (
    <div role="radiogroup" aria-label="Kind of deal"
      className="relative grid h-9 grid-cols-2 rounded-full bg-line/70 p-[3px] text-sm font-bold">
      <span aria-hidden
        className={cn('absolute inset-y-[3px] left-[3px] w-[calc(50%-3px)] rounded-full bg-card shadow-tight transition-transform duration-200 ease-out motion-reduce:transition-none',
          at === 'flip' && 'translate-x-full')} />
      {SIDES.map(o => (
        <button key={o.id} type="button" role="radio" aria-checked={mode === o.id} onClick={() => onChange(o.id)}
          className={cn('relative z-10 rounded-full px-4 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
            mode === o.id ? 'text-ink-strong' : 'text-muted-foreground hover:text-ink-strong')}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
