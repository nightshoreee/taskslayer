// Keys mirror `badges.key` seeded in supabase/migrations/0001_init.sql.
// name/description/icon/criteria also live in the database (badges is a
// public catalog table); this map exists for any client-side copy that
// wants a badge's icon/name without a round trip once the Badges screen
// ships. Not yet rendered anywhere in this build — see the README roadmap.

export const BADGE_KEYS = [
  "slayer",
  "duelist",
  "bomb_defuser",
  "loot_hunter",
  "damage_dealer",
  "week_warrior",
] as const;

export type BadgeKey = (typeof BADGE_KEYS)[number];
