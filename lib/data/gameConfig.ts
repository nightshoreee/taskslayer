import { GAME_CONFIG } from "@/config/gameConfig";
import type { createClient } from "@/lib/supabase/server";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * The database (public.game_config) is what ENFORCES the rules; config/gameConfig.ts
 * is what the UI DISPLAYS. This compares the two and returns human-readable
 * differences so drift is caught the first time the dashboard loads instead of
 * showing players a number the server won't honour.
 */
export async function findGameConfigDrift(supabase: ServerClient): Promise<string[]> {
  const { data, error } = await supabase.from("game_config").select("key, int_value");
  if (error || !data) {
    return ["public.game_config is unreadable — apply migrations 0007–0009."];
  }

  const db = new Map<string, number>((data as { key: string; int_value: number }[]).map((r) => [r.key, r.int_value]));
  const expected: Record<string, number> = {
    boss_max_hp: GAME_CONFIG.boss.defaultHp,
    team_max_hp: GAME_CONFIG.boss.defaultTeamHp,
    damage_low: GAME_CONFIG.taskDamage.low,
    damage_medium: GAME_CONFIG.taskDamage.medium,
    damage_high: GAME_CONFIG.taskDamage.high,
    bomb_duration_minutes: GAME_CONFIG.bomb.durationMinutes,
    bomb_penalty_team_hp: GAME_CONFIG.bomb.explosionDamage,
    overdue_boss_regen: GAME_CONFIG.overdue.bossRegen,
    overdue_team_damage: GAME_CONFIG.overdue.teamDamage,
    duel_reward_multiplier: GAME_CONFIG.duel.rewardMultiplier,
    xp_per_level: GAME_CONFIG.progression.xpPerLevel,
    battle_win_personal_xp: GAME_CONFIG.progression.battleWinPersonalXp,
    battle_win_guild_xp: GAME_CONFIG.progression.battleWinGuildXp,
    double_xp_multiplier: GAME_CONFIG.powerups.doubleXpMultiplier,
    double_xp_minutes: GAME_CONFIG.powerups.doubleXpMinutes,
  };

  const drift: string[] = [];
  for (const [key, uiValue] of Object.entries(expected)) {
    const dbValue = db.get(key);
    if (dbValue !== uiValue) {
      drift.push(`${key}: database=${dbValue ?? "missing"}, config/gameConfig.ts=${uiValue}`);
    }
  }
  return drift;
}
