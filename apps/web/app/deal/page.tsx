'use client';

/* Deal Analyzer: the rental and flip calculators on one page, with a switch
   between them. Each keeps its own inputs, draft and saved deals, so flipping
   the switch never loses work. The choice is remembered in this browser and
   can be set by a link (?mode=flip). */

import { useEffect, useState } from 'react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Icon } from '../../components/Icon';
import { RentalAnalyzer } from '../../components/RentalAnalyzer';
import { FlipAnalyzer } from '../../components/FlipAnalyzer';

type Mode = 'rental' | 'flip';
const MODE_KEY = 'dealAnalyzer.mode';
const asMode = (v: unknown): Mode | null => (v === 'rental' || v === 'flip' ? v : null);

export default function DealPage() {
  /* null until the browser has said which one: nothing is drawn twice */
  const [mode, setMode] = useState<Mode | null>(null);

  useEffect(() => {
    let saved: string | null = null;
    try { saved = localStorage.getItem(MODE_KEY); } catch { }
    setMode(asMode(new URLSearchParams(window.location.search).get('mode')) || asMode(saved) || 'rental');
  }, []);

  const pick = (v: unknown) => {
    const m = asMode(v);
    if (!m) return;
    setMode(m);
    try { localStorage.setItem(MODE_KEY, m); } catch { }
    const url = new URL(window.location.href);
    url.searchParams.set('mode', m);
    window.history.replaceState(null, '', url);
  };

  if (!mode) return null;
  return (
    <>
      <Tabs value={mode} onValueChange={pick} className="mb-4 print:hidden">
        <TabsList aria-label="Kind of deal">
          <TabsTrigger value="rental" className="gap-1.5 px-4"><Icon name="home_work" size={18} />Rental</TabsTrigger>
          <TabsTrigger value="flip" className="gap-1.5 px-4"><Icon name="construction" size={18} />Flip</TabsTrigger>
        </TabsList>
      </Tabs>
      {mode === 'flip' ? <FlipAnalyzer /> : <RentalAnalyzer />}
    </>
  );
}
