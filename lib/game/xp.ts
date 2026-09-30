import { GAME_CONFIG } from "@/config/gameConfig";

/**
 * Must match apply_level_up() in the migration exactly:
 *   level = floor(xp / 1000) + 1
 * xp is cumulative and never resets; "progress" is just xp's remainder
 * within the current level, purely for the progress bar.
 */
export function getLevelProgress(xp: number) {
  const perLevel = GAME_CONFIG.progression.xpPerLevel;
  const level = Math.floor(xp / perLevel) + 1;
  const currentLevelXp = xp % perLevel;
  return { level, currentLevelXp, xpPerLevel: perLevel };
}

export function taskDamageFor(difficulty: "low" | "medium" | "high"): number {
  return GAME_CONFIG.taskDamage[difficulty];
}
