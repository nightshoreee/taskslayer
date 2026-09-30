"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/safe-redirect";
import { LIMITS } from "@/lib/validation";

export type AuthActionState = {
  error: string | null;
  info: string | null;
};

const USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,20}$/;

export async function signUpAction(_prev: AuthActionState, formData: FormData): Promise<AuthActionState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const username = String(formData.get("username") ?? "").trim();
  const displayName = String(formData.get("displayName") ?? "").trim() || username;

  if (!email || !password) {
    return { error: "Email and password are required.", info: null };
  }
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters.", info: null };
  }
  if (!USERNAME_PATTERN.test(username)) {
    return { error: "Username must be 3-20 characters: letters, numbers, underscores only.", info: null };
  }
  if (displayName.length > LIMITS.displayName) {
    return { error: `Display name must be ${LIMITS.displayName} characters or fewer.`, info: null };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { username, display_name: displayName } },
  });

  if (error) {
    return { error: error.message, info: null };
  }

  if (!data.session) {
    // Email confirmation is required by this Supabase project's settings.
    return {
      error: null,
      info: "Check your email to confirm your account, then log in.",
    };
  }

  revalidatePath("/", "layout");
  redirect("/guild");
}

export async function loginAction(_prev: AuthActionState, formData: FormData): Promise<AuthActionState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = safeNextPath(String(formData.get("next") ?? ""), "/dashboard");

  if (!email || !password) {
    return { error: "Email and password are required.", info: null };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: "Invalid email or password.", info: null };
  }

  revalidatePath("/", "layout");
  redirect(next);
}

export async function logoutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}
