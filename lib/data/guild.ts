import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchDuelsForGuild } from "@/lib/data/duels";
import type { GuildLiveInitial } from "@/lib/realtime/useGuildLive";
import type { ActivityFeedEntry, Boss, Guild, GuildRole, Profile, Task, WeeklyBattle } from "@/types/database";

export type GuildContext = { guild: Guild; role: GuildRole };

/** The signed-in user's guild + role, or null if they haven't joined one. */
export async function getGuildContext(supabase: SupabaseClient, userId: string): Promise<GuildContext | null> {
  const { data } = await supabase
    .from("guild_members")
    .select("role, guilds(*)")
    .eq("user_id", userId)
    .maybeSingle();

  const row = data as unknown as { role: GuildRole; guilds: Guild | null } | null;
  if (!row?.guilds) return null;
  return { guild: row.guilds, role: row.role };
}

/**
 * Runs the server's time-driven checks first (deadline, expired bombs, overdue
 * penalties) so a page never renders a battle that already ended on the
 * database clock, then returns the active battle — starting one if none exists.
 */
export async function loadActiveBattle(
  supabase: SupabaseClient,
  guildId: string
): Promise<{ battle: WeeklyBattle; boss: Boss } | null> {
  await supabase.rpc("run_guild_maintenance", { p_guild_id: guildId });

  const query = () =>
    supabase.from("weekly_battles").select("*").eq("guild_id", guildId).eq("status", "active").maybeSingle();

  let { data: battle } = await query();
  if (!battle) {
    await supabase.rpc("start_new_weekly_battle", { p_guild_id: guildId });
    ({ data: battle } = await query());
  }
  if (!battle) return null;

  const { data: boss } = await supabase.from("bosses").select("*").eq("id", (battle as WeeklyBattle).boss_id).single();
  if (!boss) return null;

  return { battle: battle as WeeklyBattle, boss: boss as Boss };
}

export async function loadMembers(supabase: SupabaseClient, guildId: string): Promise<Profile[]> {
  const { data } = await supabase.from("guild_members").select("profiles(*)").eq("guild_id", guildId);
  return (data ?? [])
    .map((r) => (r as unknown as { profiles: Profile | null }).profiles)
    .filter((p): p is Profile => !!p);
}

/** Everything the live board needs for its first paint, read on the server. */
export async function loadGuildSnapshot(supabase: SupabaseClient, guild: Guild): Promise<GuildLiveInitial | null> {
  const active = await loadActiveBattle(supabase, guild.id);
  if (!active) return null;

  const [{ data: taskRows }, members, { data: activity }, duelData] = await Promise.all([
    supabase.from("tasks").select("*").eq("battle_id", active.battle.id).order("created_at", { ascending: false }),
    loadMembers(supabase, guild.id),
    supabase.from("activity_feed").select("*").eq("guild_id", guild.id).order("created_at", { ascending: false }).limit(60),
    fetchDuelsForGuild(supabase, guild.id),
  ]);

  return {
    guildId: guild.id,
    battle: active.battle,
    boss: active.boss,
    tasks: (taskRows ?? []) as Task[],
    members,
    activity: (activity ?? []) as ActivityFeedEntry[],
    duels: duelData.duels,
    duelInfo: duelData.info,
  };
}
