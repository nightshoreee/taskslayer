"use client";

import { KanbanBoard } from "@/components/tasks/KanbanBoard";
import { useGuildLive, type GuildLiveInitial } from "@/lib/realtime/useGuildLive";
import type { ClaimLootResult } from "@/types/database";

/** The /tasks page: the same live board as the dashboard, without the boss panel. */
export function TasksClient({
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
    <KanbanBoard
      guildId={initial.guildId}
      tasks={live.tasks}
      members={live.members}
      currentUserId={currentUserId}
      duelInfo={live.duelInfo}
      isLeader={isLeader}
      pendingLoot={pendingLoot}
    />
  );
}
