import { cn } from "@/lib/utils";
import type { Badge, UserBadge } from "@/types/database";

const CRITERIA_LABEL: Record<Badge["criteria_type"], (n: number) => string> = {
  battles_won: (n) => `Defeat ${n} weekly boss${n === 1 ? "" : "es"}`,
  duel_wins: (n) => `Win ${n} duel${n === 1 ? "" : "s"}`,
  bombs_defused: (n) => `Defuse ${n} Bomb Task${n === 1 ? "" : "s"}`,
  loot_found: (n) => `Discover ${n} Loot reward${n === 1 ? "" : "s"}`,
  total_damage: (n) => `Deal ${n.toLocaleString()} total damage`,
  battles_participated: (n) => `Fight in ${n} weekly battles`,
};

export function BadgesGrid({ badges, userBadges }: { badges: Badge[]; userBadges: UserBadge[] }) {
  if (badges.length === 0) {
    return null;
  }

  const unlockedByBadge = new Map(userBadges.map((ub) => [ub.badge_id, ub.unlocked_at]));

  return (
    <div className="grid grid-cols-3 gap-2">
      {badges.map((badge) => {
        const unlockedAt = unlockedByBadge.get(badge.id);
        const earned = unlockedAt !== undefined;
        return (
          <div
            key={badge.id}
            title={earned ? badge.description : `${badge.description} (${CRITERIA_LABEL[badge.criteria_type](badge.criteria_value)})`}
            className={cn(
              "flex flex-col items-center gap-1 rounded-lg border p-3 text-center",
              earned ? "border-gold/40 bg-gold/10" : "border-surface-border bg-surface opacity-60"
            )}
          >
            <span className={cn("text-2xl", !earned && "grayscale")} aria-hidden>
              {badge.icon}
            </span>
            <p className={cn("text-xs font-semibold", earned ? "text-parchment" : "text-parchment-dim")}>
              {badge.name}
            </p>
            <p className="text-[10px] leading-tight text-parchment-faint">
              {earned ? "Unlocked" : CRITERIA_LABEL[badge.criteria_type](badge.criteria_value)}
            </p>
          </div>
        );
      })}
    </div>
  );
}
