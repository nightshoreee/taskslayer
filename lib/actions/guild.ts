"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { toUserMessage } from "@/lib/errors";
import { LIMITS, checkText, isUuid } from "@/lib/validation";
import type { AuthActionState } from "@/lib/actions/auth";

export async function createGuildAction(_prev: AuthActionState, formData: FormData): Promise<AuthActionState> {
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();

  if (name.length < 2) {
    return { error: "Guild name must be at least 2 characters.", info: null };
  }
  const problem =
    checkText("guild name", name, LIMITS.guildName, true) ??
    checkText("description", description, LIMITS.guildDescription, false);
  if (problem) return { error: problem, info: null };

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_guild", {
    p_name: name,
    p_description: description || null,
  });

  if (error) {
    return { error: toUserMessage(error, "Couldn't create the guild."), info: null };
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
}

export async function joinGuildAction(_prev: AuthActionState, formData: FormData): Promise<AuthActionState> {
  const code = String(formData.get("code") ?? "").trim();
  if (!code) {
    return { error: "Enter an invite code.", info: null };
  }
  if (code.length > 40) {
    return { error: "That invite code isn't valid.", info: null };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("join_guild", { p_invite_code: code });

  if (error) {
    return { error: toUserMessage(error, "Couldn't join the guild."), info: null };
  }
  // join_guild returns NULL for an unknown/revoked code (it records the failed
  // attempt for rate limiting, so it can't raise).
  if (!data) {
    return { error: "That invite code isn't valid or is no longer active.", info: null };
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
}

export async function leaveGuildAction(): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("leave_guild");
  if (error) {
    return { error: toUserMessage(error, "Couldn't leave the guild.") };
  }
  revalidatePath("/", "layout");
  redirect("/guild");
}

export async function regenerateInviteCodeAction(guildId: string): Promise<{ error: string | null; code?: string }> {
  if (!isUuid(guildId)) return { error: "That request wasn't valid." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("regenerate_invite_code", { p_guild_id: guildId });
  if (error) {
    return { error: toUserMessage(error, "Couldn't regenerate the invite code.") };
  }
  revalidatePath("/guild");
  return { error: null, code: data as string };
}

export async function removeGuildMemberAction(guildId: string, userId: string): Promise<{ error: string | null }> {
  if (!isUuid(guildId) || !isUuid(userId)) return { error: "That request wasn't valid." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_guild_member", { p_guild_id: guildId, p_user_id: userId });
  if (error) {
    return { error: toUserMessage(error, "Couldn't remove that member.") };
  }
  revalidatePath("/guild");
  return { error: null };
}

export async function transferLeadershipAction(guildId: string, userId: string): Promise<{ error: string | null }> {
  if (!isUuid(guildId) || !isUuid(userId)) return { error: "That request wasn't valid." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("transfer_guild_leadership", { p_guild_id: guildId, p_new_leader_id: userId });
  if (error) {
    return { error: toUserMessage(error, "Couldn't transfer leadership.") };
  }
  revalidatePath("/", "layout");
  return { error: null };
}
