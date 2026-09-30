import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseConfig } from "@/lib/env";

/**
 * Server client for Server Components, Route Handlers, and Server Actions.
 * `await cookies()` because Next 15 made the cookies API async. Writes to
 * cookies from inside a Server Component render are expected to throw
 * (Next disallows it there) — middleware.ts is what actually refreshes the
 * session cookie on navigation, so we just swallow that specific case.
 */
export async function createClient() {
  const cookieStore = await cookies();
  const { url, anonKey } = getSupabaseConfig();

  return createServerClient(
    url,
    anonKey,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Called from a Server Component render — middleware refreshes
            // the session instead. Safe to ignore here.
          }
        },
      },
    }
  );
}
