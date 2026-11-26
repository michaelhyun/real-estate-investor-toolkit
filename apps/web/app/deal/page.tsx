'use client';

/* Deal Analyzer: the rental and flip calculators on one page, with a switch
   between them in the header row. Each keeps its own inputs, draft and saved deals, so flipping
   the switch never loses work. The choice is remembered in this browser and
   can be set by a link (?mode=flip). */

import { useEffect, useState } from 'react';
import { ModeSwitch } from '../../components/ModeSwitch';
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
  const modeSwitch = <ModeSwitch mode={mode} onChange={pick} />;
  return mode === 'flip' ? <FlipAnalyzer modeSwitch={modeSwitch} /> : <RentalAnalyzer modeSwitch={modeSwitch} />;
}
