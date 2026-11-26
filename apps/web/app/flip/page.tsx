'use client';

/* The flip calculator lives on the Deal Analyzer page now. This address is
   kept so old links and bookmarks still land in the right place; anything
   after the path (a sign-in token, say) is carried along. */

import { useEffect } from 'react';

export default function Moved() {
  useEffect(() => {
    const base = window.location.pathname.replace(/\/flip\/?$/, '');
    window.location.replace(`${base}/deal/?mode=flip${window.location.hash}`);
  }, []);
  return <p className="text-[0.9375rem] text-muted-foreground">Opening the Deal Analyzer…</p>;
}
