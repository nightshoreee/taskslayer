"use client";

import Link from "next/link";
import { BossPanel } from "@/components/battle/BossPanel";
import { TeamHpCard } from "@/components/battle/TeamHpCard";
import { KanbanBoard } from "@/components/tasks/KanbanBoard";
import { Leaderboard } from "@/components/leaderboard/Leaderboard";
import { ActivityFeed } from "@/components/activity/ActivityFeed";
import { DuelHistory } from "@/components/duel/DuelHistory";
import { useGuildLive, type GuildLiveInitial } from "@/lib/realtime/useGuildLive";
import type { ClaimLootResult } from "@/types/database";

export function DashboardClient({
  initial,
  pendingLoot,
  currentUserId,
  isLeader,
}: {
  initial: GuildLiveInitial;
  pendingLoot: ClaimLootResult[];
  currentUserId: string;
  isLeader: boolean;
}) {
  const live = useGuildLive(initial, { maintenance: true });

  return (
    <div className="mx-auto grid max-w-6xl grid-cols-1 gap-4 px-4 py-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="order-2 flex min-w-0 flex-col gap-4 lg:order-1">
        <KanbanBoard
          guildId={initial.guildId}
          tasks={live.tasks}
          members={live.members}
          currentUserId={currentUserId}
          duelInfo={live.duelInfo}
          isLeader={isLeader}
          pendingLoot={pendingLoot}
        />
        <DuelHistory duels={live.duels} members={live.members} />
      </div>

      <div className="order-1 flex min-w-0 flex-col gap-4 lg:order-2">
        <BossPanel boss={live.boss} battle={live.battle} hitKey={live.hitKey} popups={live.popups} />
        <Link href="/battle-history" className="-mt-2 self-end text-xs font-medium text-parchment-dim hover:text-parchment">
          Battle History →
        </Link>
        <TeamHpCard current={live.battle.team_hp} max={live.battle.max_team_hp} />
        <Leaderboard members={live.members} currentUserId={currentUserId} compact />
      </div>

      <div className="order-3 min-w-0 lg:col-span-2">
        <ActivityFeed entries={live.activity} />
      </div>
    </div>
  );
}
