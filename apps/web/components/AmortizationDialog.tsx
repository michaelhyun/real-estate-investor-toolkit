'use client';

/* Loan amortization at a glance, opened from the Rental Analyzer's financing
   panel: four headline figures, the shared charts, and the table. */

import { useMemo } from 'react';
import { money0, type AmortResult } from '@reit/core';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AmortizationCharts, AmortTable } from './AmortizationCharts';

export function AmortizationDialog({
  open, onOpenChange, data, notes,
}: {
  open: boolean; onOpenChange: (o: boolean) => void; data: AmortResult;
  /** One line per note, e.g. "Bank loan $200,000 at 7% for 30 yrs". */
  notes: string[];
}) {
  const { years, startBalance, totalInterest, balloon } = data;
  const n = years.length;
  const halfYear = useMemo(() => years.find(y => y.balance <= startBalance / 2)?.year ?? null, [years, startBalance]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Loan amortization</DialogTitle>
          <DialogDescription>{notes.join(' · ')}</DialogDescription>
        </DialogHeader>

        {n === 0 ? <p className="text-muted-foreground">There is no loan in this deal to amortize.</p> : (
          <>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {([
                ['Borrowed', money0(startBalance)],
                ['Total interest', money0(totalInterest)],
                ['Half paid off', halfYear ? `Year ${halfYear}` : '—'],
                balloon > 0 ? ['Balloon due', money0(balloon)] : ['Paid off', `Year ${n}`],
              ] as [string, string][]).map(([k, v]) => (
                <div key={k} className="rounded-md bg-page px-3 py-2.5">
                  <dt className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">{k}</dt>
                  <dd className="mt-0.5 text-lg font-extrabold leading-tight tracking-[-0.015em] tabular-nums text-ink-strong">{v}</dd>
                </div>
              ))}
            </dl>

            <AmortizationCharts years={years} startBalance={startBalance} />
            <AmortTable years={years} />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
