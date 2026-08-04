/* Merge rule for cloud-synced deals — pure, so it lives here with the rest of
   the logic that has to be provably right.

   Sign-in has to reconcile the deals on this device with the deals on the
   account. Same deal on both sides: newest `savedAt` wins. On one side only:
   keep it. There are no tombstones, so "deleted on the other device" and
   "created on this one" look identical from here — keeping both is the only
   choice that can't destroy work. A deal deleted on device A therefore comes
   back on the next sync from device B, which is the right trade: a resurrected
   deal is an annoyance, a vaporized one is data loss. */

import type { DealState } from './rental';

export interface RemoteDealRecord {
  name: string;
  data: DealState;
  updated_at: string;
}

export interface MergeResult {
  /** the full set to write back to local storage */
  merged: DealState[];
  /** the subset the account is missing or has an older copy of */
  toPush: DealState[];
}

/* `savedAt` is the deal's own stamp and travels with it; `updated_at` is the
   row's. Prefer the former and fall back to the latter for rows written before
   a deal carried a stamp. Unparseable or missing → 0, i.e. loses any real date. */
function stamp(deal: DealState | undefined, fallback?: string): number {
  const t = Date.parse(deal?.savedAt || '');
  if (!Number.isNaN(t)) return t;
  const f = Date.parse(fallback || '');
  return Number.isNaN(f) ? 0 : f;
}

export function mergeDeals(local: DealState[], remote: RemoteDealRecord[]): MergeResult {
  const merged: DealState[] = [];
  const toPush: DealState[] = [];
  const remoteByName = new Map(remote.map(r => [r.name, r]));
  const localNames = new Set(local.map(d => d.name));

  for (const l of local) {
    const r = remoteByName.get(l.name);
    if (!r) { merged.push(l); toPush.push(l); continue; }
    /* ties go to the remote copy — re-pushing an identical deal is pure noise */
    if (stamp(l) > stamp(r.data, r.updated_at)) { merged.push(l); toPush.push(l); }
    else merged.push(r.data);
  }
  for (const r of remote) if (!localNames.has(r.name)) merged.push(r.data);

  return { merged, toPush };
}
