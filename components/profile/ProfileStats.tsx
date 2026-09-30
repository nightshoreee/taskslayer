import { Swords, Target, Trophy, Calendar } from "lucide-react";
import { HpBar } from "@/components/battle/HpBar";
import { getLevelProgress } from "@/lib/game/xp";
import type { Profile } from "@/types/database";

function Stat({ icon: Icon, label, value }: { icon: typeof Swords; label: string; value: string | number }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-surface-border bg-surface p-4">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-surface-raised text-crimson-bright">
        <Icon className="h-4.5 w-4.5" aria-hidden />
      </div>
      <div>
        <p className="text-stat text-lg font-bold leading-none text-parchment">{value}</p>
        <p className="text-xs text-parchment-faint">{label}</p>
      </div>
    </div>
  );
}

export function ProfileStats({ profile }: { profile: Profile }) {
  const { level, currentLevelXp, xpPerLevel } = getLevelProgress(profile.xp);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4 rounded-lg border border-surface-border bg-surface p-5 shadow-card">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-surface-raised font-display text-xl font-bold text-gold">
          {profile.display_name.slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-lg font-bold text-parchment">{profile.display_name}</h1>
          <p className="truncate text-xs text-parchment-faint">@{profile.username}</p>
          <div className="mt-2 flex items-center gap-2">
            <span className="text-stat text-xs font-semibold text-gold">LEVEL {level}</span>
            <div className="flex-1">
              <HpBar current={currentLevelXp} max={xpPerLevel} colorClassName="bg-gold" height="h-2" />
            </div>
            <span className="text-stat shrink-0 text-[11px] text-parchment-faint">
              {currentLevelXp}/{xpPerLevel} XP
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Stat icon={Swords} label="Total damage" value={profile.total_damage} />
        <Stat icon={Target} label="Tasks completed" value={profile.tasks_completed} />
        <Stat icon={Trophy} label="Duel wins" value={profile.duel_wins} />
        <Stat icon={Calendar} label="Slaying since" value={new Date(profile.created_at).toLocaleDateString(undefined, { month: "short", year: "numeric" })} />
      </div>
    </div>
  );
}
