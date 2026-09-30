// SINGLE SOURCE OF TRUTH FOR THE UI. The database enforces the same numbers
// from its own single source, the public.game_config table (migration 0007);
// every game function reads it through game_setting() and nothing in SQL is
// hard-coded any more. These values only let the UI DISPLAY correct numbers
// (a task card showing "60 damage", a bomb countdown showing "30:00") without
// a round trip. They are never trusted for anything that changes game state.
//
// To change a rule: UPDATE public.game_config AND edit the matching value here.
// lib/data/gameConfig.ts compares the two when the dashboard loads and logs
// any drift, so a mismatch can't go unnoticed.

export const GAME_CONFIG = {
  boss: {
    defaultHp: 1000,
    defaultTeamHp: 500,
  },
  taskDamage: {
    low: 10,
    medium: 25,
    high: 60,
  } satisfies Record<"low" | "medium" | "high", number>,
  bomb: {
    durationMinutes: 30,
    explosionDamage: 50,
  },
  overdue: {
    bossRegen: 20,
    teamDamage: 25,
  },
  duel: {
    rewardMultiplier: 2,
  },
  progression: {
    xpPerLevel: 1000,
    battleWinPersonalXp: 100,
    battleWinGuildXp: 500,
  },
  powerups: {
    doubleXpMultiplier: 2,
    doubleXpMinutes: 60,
  },
  loot: {
    enabled: true,
  },
  polling: {
    // How often an open board asks the server to run its time-driven checks
    // (run_guild_maintenance). Purely a wake-up cadence — the database decides
    // what has expired from its own clock. Migration 0009 can schedule the
    // same function with pg_cron so deadlines resolve even with no one online.
    overdueCheckMs: 45_000,
  },
} as const;
