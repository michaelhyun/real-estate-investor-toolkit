/* Supabase client — the toolkit's backend for accounts and deal sync.

   Built from NEXT_PUBLIC_* vars inlined at build time. When they're absent the
   client is null and everything that needs it quietly disappears, so the app
   still runs as the local-only tool it was before accounts existed.

   The publishable key is public by design — it ships in the JS bundle on any
   host. Row-level security on the tables is what protects the data. */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabase: SupabaseClient | null = url && key ? createClient(url, key) : null;
