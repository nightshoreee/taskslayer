"use server";

import { createClient } from "@/lib/supabase/server";
import { toUserMessage } from "@/lib/errors";
import { isUuid } from "@/lib/validation";
import type { ActionResult } from "@/lib/actions/tasks";

export async function markNotificationReadAction(id: string): Promise<ActionResult> {
  if (!isUuid(id)) return { error: "That request wasn't valid." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_notification_read", { p_id: id });
  return { error: error ? toUserMessage(error) : null };
}

export async function markAllNotificationsReadAction(): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_all_notifications_read");
  return { error: error ? toUserMessage(error) : null };
}
