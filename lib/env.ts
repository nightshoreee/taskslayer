/**
 * Environment access with a clear failure mode.
 *
 * NEXT_PUBLIC_* values are inlined by Next at build time ONLY when they are
 * referenced as literal `process.env.NEXT_PUBLIC_X` expressions, so each one is
 * read literally here and passed through requireEnv() for validation.
 *
 * Only the public URL and anon key are ever needed by this app. The Supabase
 * service-role key is deliberately never read anywhere in the codebase.
 */
export function requireEnv(name: string, value: string | undefined): string {
  if (!value || value.trim() === "") {
    throw new Error(
      `Missing required environment variable ${name}. Copy .env.example to .env.local and fill it in (see README → Environment variables).`
    );
  }
  return value;
}

export function getSupabaseConfig(): { url: string; anonKey: string } {
  return {
    url: requireEnv("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL),
    anonKey: requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  };
}
