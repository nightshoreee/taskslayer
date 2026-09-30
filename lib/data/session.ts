import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import type { Profile } from "@/types/database";

/**
 * The one place server pages resolve "who is this?".
 *
 *  - Identity always comes from the verified session (auth.getUser() asks the
 *    Auth server; it never trusts a client-supplied id or an unverified cookie).
 *  - A signed-in user whose profile row is missing (trigger failure, account
 *    created before the trigger existed) is repaired through ensure_profile()
 *    instead of dead-ending.
 *  - If the profile still can't be produced we THROW rather than redirect to
 *    /login: middleware bounces signed-in users away from /login, so a redirect
 *    would loop. app/error.tsx catches the throw and offers "Log out".
 */
export async function getSessionContext() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  let { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();

  if (!profile) {
    const { error } = await supabase.rpc("ensure_profile");
    if (!error) {
      const retry = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
      profile = retry.data;
    }
  }

  if (!profile) {
    throw new Error("PROFILE_UNAVAILABLE");
  }

  return { supabase, user, profile: profile as Profile };
}

export type SessionContext = Awaited<ReturnType<typeof getSessionContext>>;
