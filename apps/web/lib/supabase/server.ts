import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Database } from '@sanad/types';
import { supabaseAnonKey, supabaseUrl } from '../env';

/**
 * A Supabase client that acts as the signed-in user (their JWT from the session
 * cookie). It holds the anon/publishable key only, so RLS decides every read.
 */
export async function supabaseServer() {
  const store = await cookies();
  return createServerClient<Database>(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Server Components can't set cookies; the proxy refreshes the session instead.
        }
      },
    },
  });
}
