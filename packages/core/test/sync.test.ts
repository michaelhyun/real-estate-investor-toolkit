/* The merge that runs once per sign-in. Every case here is a way a user could
   lose a deal, so they're written as "nothing disappears" assertions. */

import { describe, it, expect } from 'vitest';
import { mergeDeals, type RemoteDealRecord } from '../src/sync';
import { defaultDealState, type DealState } from '../src/rental';

const deal = (name: string, savedAt?: string, price = 100000): DealState =>
  ({ ...defaultDealState(), name, price, savedAt });

const row = (d: DealState, updated_at = '2020-01-01T00:00:00.000Z'): RemoteDealRecord<DealState> =>
  ({ name: d.name, data: d, updated_at });

const names = (ds: DealState[]) => ds.map(d => d.name).sort();

describe('mergeDeals', () => {
  it('keeps deals that exist on only one side', () => {
    const local = [deal('123 Local St', '2026-01-01T00:00:00.000Z')];
    const remote = [row(deal('456 Remote Ave', '2026-01-01T00:00:00.000Z'))];
    const { merged, toPush } = mergeDeals(local, remote);
    expect(names(merged)).toEqual(['123 Local St', '456 Remote Ave']);
    /* the local-only deal is what the account is missing */
    expect(names(toPush)).toEqual(['123 Local St']);
  });

  it('newer local copy wins and is pushed up', () => {
    const local = [deal('1 Main St', '2026-06-01T00:00:00.000Z', 500000)];
    const remote = [row(deal('1 Main St', '2026-01-01T00:00:00.000Z', 111111))];
    const { merged, toPush } = mergeDeals(local, remote);
    expect(merged).toHaveLength(1);
    expect(merged[0].price).toBe(500000);
    expect(toPush).toHaveLength(1);
  });

  it('newer remote copy wins and is not pushed back', () => {
    const local = [deal('1 Main St', '2026-01-01T00:00:00.000Z', 111111)];
    const remote = [row(deal('1 Main St', '2026-06-01T00:00:00.000Z', 500000))];
    const { merged, toPush } = mergeDeals(local, remote);
    expect(merged).toHaveLength(1);
    expect(merged[0].price).toBe(500000);
    expect(toPush).toEqual([]);
  });

  it('a tie prefers the remote copy and pushes nothing', () => {
    const when = '2026-03-03T00:00:00.000Z';
    const { merged, toPush } = mergeDeals([deal('1 Main St', when, 1)], [row(deal('1 Main St', when, 2))]);
    expect(merged[0].price).toBe(2);
    expect(toPush).toEqual([]);
  });

  it('falls back to the row timestamp when the deal carries no savedAt', () => {
    /* remote row is stamped 2026 by the column even though the deal has no
       savedAt — it must still beat a 2020 local deal */
    const local = [deal('1 Main St', '2020-01-01T00:00:00.000Z', 1)];
    const remote = [row(deal('1 Main St', undefined, 2), '2026-06-01T00:00:00.000Z')];
    const { merged, toPush } = mergeDeals(local, remote);
    expect(merged[0].price).toBe(2);
    expect(toPush).toEqual([]);
  });

  it('an undated local deal loses to a dated remote one but is never dropped', () => {
    const local = [deal('1 Main St', undefined, 1)];
    const remote = [row(deal('1 Main St', '2026-06-01T00:00:00.000Z', 2))];
    const { merged } = mergeDeals(local, remote);
    expect(merged).toHaveLength(1);
    expect(merged[0].price).toBe(2);
  });

  it('first sign-in on a fresh account pushes every local deal', () => {
    const local = [deal('A', '2026-01-01T00:00:00.000Z'), deal('B', '2026-01-02T00:00:00.000Z')];
    const { merged, toPush } = mergeDeals(local, []);
    expect(names(merged)).toEqual(['A', 'B']);
    expect(names(toPush)).toEqual(['A', 'B']);
  });

  it('signing in on a brand-new device pulls everything and pushes nothing', () => {
    const remote = [row(deal('A', '2026-01-01T00:00:00.000Z')), row(deal('B', '2026-01-02T00:00:00.000Z'))];
    const { merged, toPush } = mergeDeals([], remote);
    expect(names(merged)).toEqual(['A', 'B']);
    expect(toPush).toEqual([]);
  });

  it('produces no duplicate names', () => {
    const local = [deal('A', '2026-01-01T00:00:00.000Z'), deal('B', '2026-01-01T00:00:00.000Z')];
    const remote = [row(deal('B', '2026-02-01T00:00:00.000Z')), row(deal('C', '2026-02-01T00:00:00.000Z'))];
    const { merged } = mergeDeals(local, remote);
    expect(names(merged)).toEqual(['A', 'B', 'C']);
    expect(new Set(merged.map(d => d.name)).size).toBe(merged.length);
  });

  it('two empty sides are a no-op', () => {
    expect(mergeDeals([], [])).toEqual({ merged: [], toPush: [] });
  });
});
