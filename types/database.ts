// Hand-written to mirror supabase/migrations/0001_init.sql exactly. If you
// change the schema, update this file to match (or generate it for real once
// you have a live project: `supabase gen types typescript --linked`).

export type DifficultyLevel = "low" | "medium" | "high";
export type PriorityLevel = "low" | "medium" | "high";
export type TaskStatus = "todo" | "doing" | "done";
export type TaskType = "normal" | "duel" | "bomb" | "loot";
export type BattleStatus = "active" | "won" | "lost";
export type GuildRole = "leader" | "member";
export type DuelStatus = "active" | "completed" | "expired";
export type PowerupType = "double_xp" | "boss_slayer" | "team_shield" | "heal";
export type BattleEventType =
  | "damage"
  | "duel_start"
  | "duel_win"
  | "bomb_created"
  | "bomb_defused"
  | "bomb_exploded"
  | "boss_regen"
  | "team_damage"
  | "loot_found"
  | "battle_won"
  | "battle_lost"
  | "battle_started"
  | "member_joined"
  | "powerup_activated";

export interface Profile {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  level: number;
  xp: number;
  total_damage: number;
  tasks_completed: number;
  duel_wins: number;
  created_at: string;
  updated_at: string;
}

export interface Guild {
  id: string;
  name: string;
  description: string | null;
  invite_code: string;
  leader_id: string;
  guild_xp: number;
  created_at: string;
}

export interface GuildMember {
  id: string;
  guild_id: string;
  user_id: string;
  role: GuildRole;
  joined_at: string;
}

export interface Boss {
  id: string;
  key: string;
  name: string;
  title: string;
  description: string;
  flavor_text: string;
  max_hp: number;
  attack_style: string;
}

export interface BattleParticipantSummary {
  user_id: string;
  name: string;
  damage: number;
}

export interface WeeklyBattleResultSummary {
  top_damage_user_id: string | null;
  top_damage_name: string | null;
  top_damage: number;
  // Added by 0008. Battles finished before that migration only have the three
  // fields above, so everything below is optional.
  total_damage?: number;
  participants?: BattleParticipantSummary[];
  boss_hp_start?: number;
  boss_hp_end?: number;
  team_hp_end?: number;
  team_hp_max?: number;
  rewards?: { guild_xp: number; member_xp: number };
}

export interface WeeklyBattle {
  id: string;
  guild_id: string;
  boss_id: string;
  boss_hp: number;
  max_hp: number;
  team_hp: number;
  max_team_hp: number;
  status: BattleStatus;
  started_at: string;
  ends_at: string;
  // Set when the battle is finalized (0007/0008). Null while active.
  finished_at: string | null;
  result_summary: WeeklyBattleResultSummary | null;
  created_at: string;
}

export interface Task {
  id: string;
  guild_id: string;
  battle_id: string;
  creator_id: string;
  assigned_to: string | null;
  title: string;
  description: string | null;
  difficulty: DifficultyLevel;
  priority: PriorityLevel;
  status: TaskStatus;
  task_type: TaskType;
  due_date: string | null;
  points: number;
  damage: number;
  completed_at: string | null;
  completed_by: string | null;
  bomb_expires_at: string | null;
  bomb_result: "defused" | "exploded" | null;
  penalized_at: string | null;
  created_at: string;
  updated_at: string;
}

export type TaskInsert = Pick<Task, "guild_id" | "battle_id" | "creator_id" | "title"> &
  Partial<Pick<Task, "assigned_to" | "description" | "difficulty" | "priority" | "due_date">>;

export type TaskUpdate = Partial<
  Pick<Task, "title" | "description" | "priority" | "due_date" | "assigned_to" | "status">
>;

export interface Duel {
  id: string;
  guild_id: string;
  battle_id: string;
  title: string;
  description: string | null;
  created_by: string;
  challenger_id: string;
  opponent_id: string;
  status: DuelStatus;
  winner_id: string | null;
  reward_points: number;
  created_at: string;
  completed_at: string | null;
}

export interface DuelParticipant {
  id: string;
  duel_id: string;
  user_id: string;
  task_id: string;
  completed_at: string | null;
}

export interface LootReward {
  id: string;
  key: string;
  label: string;
  description: string;
  weight: number;
  effect_type: "xp_flat" | "double_xp_duration" | "shield" | "boss_damage_boost" | "team_heal" | "steal_xp";
  effect_value: number;
}

export interface UserLoot {
  id: string;
  user_id: string;
  guild_id: string;
  task_id: string;
  loot_reward_id: string;
  claimed_at: string;
  // Null until the player has actually seen the reveal (0007).
  revealed_at: string | null;
}

export interface Powerup {
  id: string;
  user_id: string;
  guild_id: string;
  type: PowerupType;
  activated_at: string | null;
  expires_at: string | null;
  uses_remaining: number;
  created_at: string;
}

export interface BattleEvent {
  id: string;
  guild_id: string;
  battle_id: string | null;
  event_type: BattleEventType;
  actor_id: string | null;
  target_id: string | null;
  amount: number | null;
  message: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface ActivityFeedEntry {
  id: string;
  guild_id: string;
  battle_id: string | null;
  user_id: string | null;
  icon: string;
  message: string;
  created_at: string;
}

export interface Badge {
  id: string;
  key: string;
  name: string;
  description: string;
  icon: string;
  criteria_type: "battles_won" | "duel_wins" | "bombs_defused" | "loot_found" | "total_damage" | "battles_participated";
  criteria_value: number;
}

export interface UserBadge {
  id: string;
  user_id: string;
  badge_id: string;
  unlocked_at: string;
}

// Return shapes of the RPC functions called from the client.
export type LootRarity = "common" | "uncommon" | "rare" | "legendary";

export interface ClaimLootResult {
  key: string;
  label: string;
  description: string;
  effect_type: LootReward["effect_type"];
  effect_value: number;
  // Derived server-side from the reward's drop probability (loot_rarity()
  // in 0003_loot_reveal_data.sql), so it can't drift from the seeded weights.
  rarity: LootRarity;
  already_claimed: boolean;
  task_id: string;
}

export interface CompleteTaskResult {
  damage: number;
  boss_hp: number;
  boss_defeated: boolean;
  // Populated only for task_type = 'loot' (see 0003_loot_reveal_data.sql).
  loot?: ClaimLootResult | null;
  xp_awarded?: number;
  xp_multiplier?: number;
  // Set instead of a normal result when the deadline passed while the request
  // was in flight; the server settled it (battle lost / bomb exploded) itself.
  battle_ended?: boolean;
  bomb_exploded?: boolean;
}

export interface CompleteDuelTaskResult {
  won: boolean;
  reward: number;
}

export type NotificationType =
  | "task_assigned"
  | "task_overdue"
  | "duel_challenge"
  | "duel_won"
  | "duel_lost"
  | "bomb_assigned"
  | "bomb_defused"
  | "bomb_exploded"
  | "loot_stolen"
  | "badge_unlocked"
  | "battle_won"
  | "battle_lost"
  | "member_joined"
  | "removed_from_guild"
  | "leadership_transferred";

export interface AppNotification {
  id: string;
  user_id: string;
  guild_id: string | null;
  type: NotificationType | string;
  title: string;
  body: string | null;
  payload: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
}

export interface ActivatePowerupResult {
  id: string;
  type: PowerupType;
  activated_at: string;
  expires_at: string | null;
  server_now: string;
}
