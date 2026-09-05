/* Merge rule for cloud-synced deals — pure, so it lives here with the rest of
   the logic that has to be provably right.

   Sign-in has to reconcile the deals on this device with the deals on the
   account. Same deal on both sides: newest `savedAt` wins. On one side only:
   keep it. There are no tombstones, so "deleted on the other device" and
   "created on this one" look identical from here — keeping both is the only
   choice that can't destroy work. A deal deleted on device A therefore comes
   back on the next sync from device B, which is the right trade: a resurrected
   deal is an annoyance, a vaporized one is data loss. */

/** The only shape the merge needs. Every tool's deal state satisfies it, which
    is what lets one merge rule serve the rental analyzer and the flip analyzer
    without either knowing about the other. */
export interface SyncableDeal {
  name: string;
  savedAt?: string;
}

export interface RemoteDealRecord<T extends SyncableDeal = SyncableDeal> {
  name: string;
  data: T;
  updated_at: string;
}

export interface MergeResult<T extends SyncableDeal = SyncableDeal> {
  /** the full set to write back to local storage */
  merged: T[];
  /** the subset the account is missing or has an older copy of */
  toPush: T[];
}

/* `savedAt` is the deal's own stamp and travels with it; `updated_at` is the
   row's. Prefer the former and fall back to the latter for rows written before
   a deal carried a stamp. Unparseable or missing → 0, i.e. loses any real date. */
function stamp(deal: SyncableDeal | undefined, fallback?: string): number {
  const t = Date.parse(deal?.savedAt || '');
  if (!Number.isNaN(t)) return t;
  const f = Date.parse(fallback || '');
  return Number.isNaN(f) ? 0 : f;
}

export function mergeDeals<T extends SyncableDeal>(
  local: T[], remote: RemoteDealRecord<T>[],
): MergeResult<T> {
  const merged: T[] = [];
  const toPush: T[] = [];
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
