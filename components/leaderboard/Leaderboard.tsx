"use client";

import { useMemo, useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar } from "@/components/shared/Avatar";
import { cn } from "@/lib/utils";
import type { Profile } from "@/types/database";

type SortKey = "total_damage" | "xp" | "tasks_completed" | "duel_wins";

const TABS: { key: SortKey; label: string; suffix: string }[] = [
  { key: "total_damage", label: "Damage", suffix: "dmg" },
  { key: "xp", label: "XP", suffix: "xp" },
  { key: "tasks_completed", label: "Tasks", suffix: "done" },
  { key: "duel_wins", label: "Duels", suffix: "wins" },
];

const MEDALS = ["🥇", "🥈", "🥉"];

/**
 * Pure view over guild members' server-maintained totals; the numbers can only
 * be changed by the game functions, never from here. Ties share a rank and
 * are ordered deterministically (metric, then damage, then XP, then name) so
 * rows never flicker between renders.
 */
export function Leaderboard({
  members,
  compact = false,
  currentUserId,
}: {
  members: Profile[];
  compact?: boolean;
  currentUserId?: string;
}) {
  const [tab, setTab] = useState<SortKey>("total_damage");
  const activeTab = TABS.find((t) => t.key === tab) ?? TABS[0]!;

  const ranked = useMemo(() => {
    const sorted = [...members].sort(
      (a, b) =>
        b[tab] - a[tab] ||
        b.total_damage - a.total_damage ||
        b.xp - a.xp ||
        a.display_name.localeCompare(b.display_name)
    );
    let previousValue: number | null = null;
    let previousRank = 0;
    return sorted.map((member, index) => {
      const value = member[tab];
      const rank = value === previousValue ? previousRank : index + 1;
      previousValue = value;
      previousRank = rank;
      return { member, rank, value };
    });
  }, [members, tab]);

  const rows = compact ? ranked.slice(0, 5) : ranked;

  return (
    <div className="min-w-0 rounded-lg border border-surface-border bg-surface shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-surface-border p-3">
        <h2 className="font-display text-sm font-semibold text-parchment">Leaderboard</h2>
        <Tabs value={tab} onValueChange={(v) => setTab(v as SortKey)}>
          <TabsList>
            {TABS.map((t) => (
              <TabsTrigger key={t.key} value={t.key}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {rows.length === 0 ? (
        <p className="p-4 text-center text-xs text-parchment-faint">No one has fought yet.</p>
      ) : (
        <ol className="divide-y divide-surface-border">
          {rows.map(({ member, rank, value }) => (
            <li
              key={member.id}
              className={cn(
                "flex items-center justify-between gap-3 px-4 py-2.5",
                member.id === currentUserId && "bg-surface-raised/50"
              )}
              aria-current={member.id === currentUserId ? "true" : undefined}
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="w-6 shrink-0 text-center text-sm">{MEDALS[rank - 1] ?? rank}</span>
                <Avatar name={member.display_name} url={member.avatar_url} />
                <span className="truncate text-sm font-medium text-parchment">
                  {member.display_name}
                  {member.id === currentUserId && <span className="ml-1.5 text-xs text-parchment-faint">(you)</span>}
                </span>
              </div>
              <span className="text-stat shrink-0 text-sm font-semibold text-gold-bright">
                {value} {activeTab.suffix}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
