import { createBrowserClient } from "@supabase/ssr";
import { getSupabaseConfig } from "@/lib/env";

/**
 * Browser client. Safe to call from Client Components. Uses the anon key —
 * every privileged operation is gated by RLS + the security-definer
 * functions in the migration, so the anon key alone can never do anything
 * a signed-in user shouldn't be able to do (and a signed-out one can only
 * read the public boss/badge/loot catalogs).
 */
export function createClient() {
  const { url, anonKey } = getSupabaseConfig();
  return createBrowserClient(url, anonKey);
}
