"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { toUserMessage } from "@/lib/errors";
import { isUuid } from "@/lib/validation";
import type { ActionResult } from "@/lib/actions/tasks";
import type { ActivatePowerupResult } from "@/types/database";

/**
 * Activation is decided entirely by activate_powerup(): ownership, guild
 * membership, single use, and the expiry timestamp all come from the database.
 * The result carries the SERVER's activated_at / expires_at / now so the UI
 * never has to compute an expiry from the browser clock.
 */
export async function activatePowerupAction(powerupId: string): Promise<ActionResult<ActivatePowerupResult>> {
  if (!isUuid(powerupId)) return { error: "That request wasn't valid." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("activate_powerup", { p_powerup_id: powerupId });
  if (error) return { error: toUserMessage(error, "Couldn't activate that power-up.") };

  revalidatePath("/profile");
  return { error: null, data: data as ActivatePowerupResult };
}
