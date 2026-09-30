import { Sparkles, Zap, Shield, Flame, HeartPulse, ArrowLeftRight, type LucideIcon } from "lucide-react";
import type { LootRarity, LootReward } from "@/types/database";

// Keys mirror `loot_rewards.key` seeded in supabase/migrations/0001_init.sql.
// The weighted roll — and the rarity tier — happen server-side in claim_loot()
// (see 0003_loot_reveal_data.sql). Everything in this file is presentation
// only: icons, colours and wording for the reveal and inventory UI. Nothing
// here can influence what a player actually receives.

export const LOOT_KEYS = [
  "xp_50",
  "xp_100",
  "double_xp_1h",
  "shield",
  "boss_damage_boost",
  "team_heal",
  "steal_xp",
] as const;

export type LootKey = (typeof LOOT_KEYS)[number];

export type LootEffectType = LootReward["effect_type"];

export const LOOT_EFFECT_ICON: Record<LootEffectType, LucideIcon> = {
  xp_flat: Sparkles,
  double_xp_duration: Zap,
  shield: Shield,
  boss_damage_boost: Flame,
  team_heal: HeartPulse,
  steal_xp: ArrowLeftRight,
};

export interface RarityStyle {
  label: string;
  /** Text/icon colour for the rarity label and reward icon. */
  text: string;
  /** Border colour for the icon medallion. */
  border: string;
  /** Soft background wash behind the medallion. */
  wash: string;
  /** Raw colour for framer-motion rings/particles, where a class can't be used. */
  hex: string;
  /** How many sparks burst out on reveal (0 = none). */
  sparks: number;
}

export const RARITY_STYLE: Record<LootRarity, RarityStyle> = {
  common: {
    label: "Common",
    text: "text-parchment-dim",
    border: "border-surface-border",
    wash: "bg-parchment-dim/10",
    hex: "#A9A2AC",
    sparks: 0,
  },
  uncommon: {
    label: "Uncommon",
    text: "text-emerald-400",
    border: "border-emerald-500/40",
    wash: "bg-emerald-400/10",
    hex: "#34D399",
    sparks: 6,
  },
  rare: {
    label: "Rare",
    text: "text-sky-400",
    border: "border-sky-500/50",
    wash: "bg-sky-400/15",
    hex: "#38BDF8",
    sparks: 10,
  },
  legendary: {
    label: "Legendary",
    text: "text-gold-bright",
    border: "border-gold/70",
    wash: "bg-gold-bright/20",
    hex: "#E6BE73",
    sparks: 16,
  },
};

/**
 * Mirrors public.loot_rarity() in 0003_loot_reveal_data.sql exactly, for
 * *display* purposes only (e.g. a history list showing a past claim's
 * tier). The rarity shown at claim time always comes from the server
 * (ClaimLootResult.rarity); this is only to re-derive a label for a
 * `user_loot` row, which doesn't persist a rarity column of its own.
 */
export function computeLootRarity(weight: number, totalWeight: number): LootRarity {
  if (!totalWeight || totalWeight <= 0) return "common";
  const share = weight / totalWeight;
  if (share < 0.08) return "legendary";
  if (share < 0.12) return "rare";
  if (share < 0.2) return "uncommon";
  return "common";
}

function formatMinutes(minutes: number): string {
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  return `${minutes} min`;
}

/** Short, honest description of what the reward did (or will do) for the player. */
export function formatLootEffect(type: LootEffectType, value: number): string {
  switch (type) {
    case "xp_flat":
      return `+${value} XP`;
    case "double_xp_duration":
      return `2× XP · active for ${formatMinutes(value)}`;
    case "shield":
      return "Added to your inventory";
    case "boss_damage_boost":
      return `−${value} Boss HP`;
    case "team_heal":
      return `+${value} Team HP`;
    case "steal_xp":
      return `+${value} XP siphoned`;
  }
}
