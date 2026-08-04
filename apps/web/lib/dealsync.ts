/* Cloud sync for saved deals — one `deals` row per (user, name), the full
   DealState as jsonb. localStorage stays the source the UI reads; signed in,
   every save/delete mirrors up, and sign-in reconciles the two sides through
   `mergeDeals` in @reit/core (which is where the merge rule is tested). */

import type { DealState } from '@reit/core';
import { supabase } from './supabase';

export type { RemoteDealRecord } from '@reit/core';
export { mergeDeals } from '@reit/core';

export async function fetchDeals() {
  if (!supabase) return [];
  const { data, error } = await supabase.from('deals').select('name,data,updated_at');
  if (error) throw error;
  return data ?? [];
}

export async function pushDeals(userId: string, deals: DealState[]) {
  if (!supabase || !deals.length) return;
  const rows = deals.map(d => ({
    user_id: userId,
    name: d.name,
    data: d,
    updated_at: new Date().toISOString(),
  }));
  const { error } = await supabase.from('deals').upsert(rows, { onConflict: 'user_id,name' });
  if (error) throw error;
}

export async function deleteRemoteDeal(name: string) {
  if (!supabase) return;
  /* RLS scopes the delete to the signed-in user's rows */
  const { error } = await supabase.from('deals').delete().eq('name', name);
  if (error) throw error;
}
