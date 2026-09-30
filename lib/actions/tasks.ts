"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { toUserMessage } from "@/lib/errors";
import { LIMITS, checkFutureIso, checkText, isPriority, isUuid } from "@/lib/validation";
import type { CompleteDuelTaskResult, CompleteTaskResult, PriorityLevel } from "@/types/database";

export type ActionResult<T = undefined> = { error: string | null; data?: T };

function refresh() {
  revalidatePath("/dashboard");
  revalidatePath("/tasks");
}

/**
 * Every action below takes the caller's identity from the verified Supabase
 * session (auth.getUser / auth.uid() inside the RPC). No user id is ever
 * accepted from the client, and every write is re-validated by the database
 * (RLS, triggers, RPC checks) — the checks here only produce friendlier errors.
 */
async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

export async function createTaskAction(input: {
  guildId: string;
  title: string;
  description: string;
  priority: PriorityLevel;
  assignedTo: string | null;
  dueDate: string | null;
}): Promise<ActionResult> {
  const problem =
    checkText("title", input.title, LIMITS.title, true) ??
    checkText("description", input.description, LIMITS.description, false) ??
    checkFutureIso(input.dueDate);
  if (problem) return { error: problem };
  if (!isUuid(input.guildId) || (input.assignedTo !== null && !isUuid(input.assignedTo))) {
    return { error: "That request wasn't valid." };
  }
  if (!isPriority(input.priority)) return { error: "Pick a priority." };

  const { supabase, user } = await requireUser();
  if (!user) return { error: "Your session expired. Please log in again." };

  // The server — not the browser — decides which battle the task belongs to.
  const { data: battle } = await supabase
    .from("weekly_battles")
    .select("id")
    .eq("guild_id", input.guildId)
    .eq("status", "active")
    .maybeSingle();
  if (!battle) return { error: "Your guild has no active battle right now. Refresh and try again." };

  const { error } = await supabase.from("tasks").insert({
    guild_id: input.guildId,
    battle_id: (battle as { id: string }).id,
    creator_id: user.id,
    assigned_to: input.assignedTo,
    title: input.title.trim(),
    description: input.description.trim() || null,
    // The set_task_reward trigger overwrites damage/points/priority from
    // difficulty, so these can't be used to smuggle in extra damage.
    difficulty: input.priority,
    priority: input.priority,
    due_date: input.dueDate,
  });

  if (error) return { error: toUserMessage(error, "Couldn't create the task.") };
  refresh();
  return { error: null };
}

export async function updateTaskAction(
  taskId: string,
  input: { title: string; description: string; dueDate: string | null; assignedTo: string | null; dueDateChanged: boolean }
): Promise<ActionResult> {
  if (!isUuid(taskId) || (input.assignedTo !== null && !isUuid(input.assignedTo))) {
    return { error: "That request wasn't valid." };
  }
  const problem =
    checkText("title", input.title, LIMITS.title, true) ??
    checkText("description", input.description, LIMITS.description, false) ??
    (input.dueDateChanged ? checkFutureIso(input.dueDate) : null);
  if (problem) return { error: problem };

  const { supabase, user } = await requireUser();
  if (!user) return { error: "Your session expired. Please log in again." };

  const patch: Record<string, unknown> = {
    title: input.title.trim(),
    description: input.description.trim() || null,
    assigned_to: input.assignedTo,
  };
  // Only send due_date when it actually changed: the database refuses to
  // reschedule an already-overdue task, and an unchanged value must not trip that.
  if (input.dueDateChanged) patch.due_date = input.dueDate;

  const { data, error } = await supabase.from("tasks").update(patch).eq("id", taskId).select("id");
  if (error) return { error: toUserMessage(error, "Couldn't save your changes.") };
  if (!data || data.length === 0) return { error: "You can't edit this task (or it was already completed)." };

  refresh();
  return { error: null };
}

export async function completeTaskAction(taskId: string): Promise<ActionResult<CompleteTaskResult>> {
  if (!isUuid(taskId)) return { error: "That request wasn't valid." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("complete_task", { p_task_id: taskId });
  if (error) return { error: toUserMessage(error, "Couldn't complete the task.") };

  const result = data as CompleteTaskResult;
  refresh();
  if (result.battle_ended) {
    return { error: "The weekly battle just ended, so that strike didn't count. A new boss has appeared — try again." };
  }
  if (result.bomb_exploded) {
    return { error: "Too late — the bomb exploded before you could defuse it." };
  }
  return { error: null, data: result };
}

export async function completeDuelTaskAction(taskId: string): Promise<ActionResult<CompleteDuelTaskResult>> {
  if (!isUuid(taskId)) return { error: "That request wasn't valid." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("complete_duel_task", { p_task_id: taskId });
  if (error) return { error: toUserMessage(error, "Couldn't complete the duel.") };
  refresh();
  return { error: null, data: data as CompleteDuelTaskResult };
}

export async function updateTaskStatusAction(taskId: string, status: "todo" | "doing"): Promise<ActionResult> {
  if (!isUuid(taskId) || (status !== "todo" && status !== "doing")) return { error: "That request wasn't valid." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("tasks").update({ status }).eq("id", taskId).select("id");
  if (error) return { error: toUserMessage(error, "Couldn't move the task.") };
  // RLS can filter a write down to zero rows without raising — that is a refusal, not a success.
  if (!data || data.length === 0) return { error: "You can't move this task." };
  refresh();
  return { error: null };
}

export async function deleteTaskAction(taskId: string): Promise<ActionResult> {
  if (!isUuid(taskId)) return { error: "That request wasn't valid." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("tasks").delete().eq("id", taskId).select("id");
  if (error) return { error: toUserMessage(error, "Couldn't delete the task.") };
  if (!data || data.length === 0) {
    return { error: "You can't delete this task. Only its creator or the guild leader can, and only before it's completed." };
  }
  refresh();
  return { error: null };
}

export async function createBombTaskAction(input: {
  guildId: string;
  title: string;
  description: string;
  assignedTo: string;
  priority: PriorityLevel;
}): Promise<ActionResult> {
  const problem =
    checkText("bomb title", input.title, LIMITS.title, true) ?? checkText("description", input.description, LIMITS.description, false);
  if (problem) return { error: problem };
  if (!isUuid(input.guildId)) return { error: "That request wasn't valid." };
  if (!isUuid(input.assignedTo)) return { error: "A bomb needs someone to defuse it — pick an assignee." };
  if (!isPriority(input.priority)) return { error: "Pick a priority." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_bomb_task", {
    p_guild_id: input.guildId,
    p_title: input.title.trim(),
    p_description: input.description.trim() || null,
    p_assigned_to: input.assignedTo,
    p_difficulty: input.priority,
  });
  if (error) return { error: toUserMessage(error, "Couldn't plant the bomb.") };
  refresh();
  return { error: null };
}

export async function createDuelTaskAction(input: {
  guildId: string;
  opponentId: string;
  title: string;
  description: string;
  priority: PriorityLevel;
}): Promise<ActionResult> {
  const problem =
    checkText("duel title", input.title, LIMITS.title, true) ?? checkText("description", input.description, LIMITS.description, false);
  if (problem) return { error: problem };
  if (!isUuid(input.guildId)) return { error: "That request wasn't valid." };
  if (!isUuid(input.opponentId)) return { error: "Choose who you're challenging." };
  if (!isPriority(input.priority)) return { error: "Pick a priority." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_duel_task", {
    p_guild_id: input.guildId,
    p_opponent_id: input.opponentId,
    p_title: input.title.trim(),
    p_description: input.description.trim() || null,
    p_difficulty: input.priority,
  });
  if (error) return { error: toUserMessage(error, "Couldn't start the duel.") };
  refresh();
  return { error: null };
}

export async function createLootTaskAction(input: {
  guildId: string;
  title: string;
  description: string;
  assignedTo: string | null;
}): Promise<ActionResult> {
  const problem =
    checkText("title", input.title, LIMITS.title, true) ?? checkText("description", input.description, LIMITS.description, false);
  if (problem) return { error: problem };
  if (!isUuid(input.guildId) || (input.assignedTo !== null && !isUuid(input.assignedTo))) {
    return { error: "That request wasn't valid." };
  }

  const supabase = await createClient();
  // No priority param: create_loot_task always pins Loot tasks to 'high' server-side.
  const { error } = await supabase.rpc("create_loot_task", {
    p_guild_id: input.guildId,
    p_title: input.title.trim(),
    p_description: input.description.trim() || null,
    p_assigned_to: input.assignedTo,
  });
  if (error) return { error: toUserMessage(error, "Couldn't plant the loot task.") };
  refresh();
  return { error: null };
}

export async function markLootRevealedAction(taskId: string): Promise<ActionResult> {
  if (!isUuid(taskId)) return { error: "That request wasn't valid." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_loot_revealed", { p_task_id: taskId });
  if (error) return { error: toUserMessage(error) };
  return { error: null };
}
