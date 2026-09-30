import type { SupabaseClient } from "@supabase/supabase-js";
import type { Duel } from "@/types/database";

export type DuelCardInfo = {
  duelId: string;
  opponentId: string;
  status: Duel["status"];
};

type ParticipantRow = { task_id: string; user_id: string; duel_id: string };

/**
 * Recent duels of a guild plus a `task_id -> opponent` lookup.
 *
 * A duel task row only carries its own owner, so the opponent's identity is the
 * one piece of duel UI that needs a join; win/loss is derivable from the task
 * (completed_by set vs. null once done). Scoped to the guild's latest duels —
 * the previous version pulled every participant row visible to the caller.
 * RLS already restricts both tables to the caller's guild.
 */
export async function fetchDuelsForGuild(
  supabase: SupabaseClient,
  guildId: string,
  limit = 30
): Promise<{ duels: Duel[]; info: Record<string, DuelCardInfo> }> {
  const { data: duelRows } = await supabase
    .from("duels")
    .select("*")
    .eq("guild_id", guildId)
    .order("created_at", { ascending: false })
    .limit(limit);

  const duels = (duelRows ?? []) as Duel[];
  if (duels.length === 0) return { duels, info: {} };

  const { data: partRows } = await supabase
    .from("duel_participants")
    .select("task_id, user_id, duel_id")
    .in(
      "duel_id",
      duels.map((d) => d.id)
    );

  const byId = new Map(duels.map((d) => [d.id, d]));
  const info: Record<string, DuelCardInfo> = {};
  for (const row of (partRows ?? []) as ParticipantRow[]) {
    const duel = byId.get(row.duel_id);
    if (!duel) continue;
    const opponentId = row.user_id === duel.challenger_id ? duel.opponent_id : duel.challenger_id;
    info[row.task_id] = { duelId: duel.id, opponentId, status: duel.status };
  }
  return { duels, info };
}
