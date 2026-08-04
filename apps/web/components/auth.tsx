'use client';

/* Session context — one auth subscription for the whole app.
   `user` is null when signed out or when the backend isn't configured;
   `ready` flips once the stored session (if any) has been restored, so the
   header doesn't flash "Sign in" at someone who is already signed in. */

import { createContext, useContext, useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

const Ctx = createContext<{ user: User | null; ready: boolean }>({ user: null, ready: !supabase });

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(!supabase);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_ev, session) => setUser(session?.user ?? null));
    return () => sub.subscription.unsubscribe();
  }, []);

  return <Ctx.Provider value={{ user, ready }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
