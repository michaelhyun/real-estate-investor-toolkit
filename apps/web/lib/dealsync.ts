/* Cloud sync for saved deals — one `deals` row per (user, tool, name), the full
   deal state as jsonb. localStorage stays the source the UI reads; signed in,
   every save/delete mirrors up, and sign-in reconciles the two sides through
   `mergeDeals` in @reit/core (which is where the merge rule is tested).

   Every tool titles its deals by property address, so `kind` is what keeps the
   same house underwritten twice — once as a rental, once as a flip — from
   colliding on save. It's a store factory rather than a `kind` argument on each
   function because fetching under one kind and pushing under another would make
   deals silently vanish; naming the kind once per tool makes that unwritable. */

import type { SyncableDeal, RemoteDealRecord } from '@reit/core';
import { supabase } from './supabase';

export type { RemoteDealRecord, SyncableDeal } from '@reit/core';
export { mergeDeals } from '@reit/core';

/** Must match the `deals_kind_check` constraint in supabase/schema.sql. */
export type DealKind = 'rental' | 'flip';

export interface DealStore<T extends SyncableDeal> {
  fetch(): Promise<RemoteDealRecord<T>[]>;
  push(userId: string, deals: T[]): Promise<void>;
  remove(name: string): Promise<void>;
}

export function dealStore<T extends SyncableDeal>(kind: DealKind): DealStore<T> {
  return {
    async fetch() {
      if (!supabase) return [];
      const { data, error } = await supabase
        .from('deals').select('name,data,updated_at').eq('kind', kind);
      if (error) throw error;
      return (data ?? []) as RemoteDealRecord<T>[];
    },

    async push(userId, deals) {
      if (!supabase || !deals.length) return;
      const rows = deals.map(d => ({
        user_id: userId,
        kind,
        name: d.name,
        data: d,
        updated_at: new Date().toISOString(),
      }));
      const { error } = await supabase
        .from('deals').upsert(rows, { onConflict: 'user_id,kind,name' });
      if (error) throw error;
    },

    async remove(name) {
      if (!supabase) return;
      /* RLS scopes the delete to the signed-in user's rows; kind scopes it to
         this tool's, so deleting a flip can't take the rental of the same
         address with it */
      const { error } = await supabase
        .from('deals').delete().eq('kind', kind).eq('name', name);
      if (error) throw error;
    },
  };
}
