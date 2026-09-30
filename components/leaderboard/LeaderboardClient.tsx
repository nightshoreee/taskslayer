"use client";

import { Leaderboard } from "@/components/leaderboard/Leaderboard";
import { useLiveMembers } from "@/lib/realtime/useLiveMembers";
import type { Profile } from "@/types/database";

export function LeaderboardClient({
  guildId,
  initialMembers,
  currentUserId,
}: {
  guildId: string;
  initialMembers: Profile[];
  currentUserId: string;
}) {
  const members = useLiveMembers(guildId, initialMembers);
  return <Leaderboard members={members} currentUserId={currentUserId} />;
}
