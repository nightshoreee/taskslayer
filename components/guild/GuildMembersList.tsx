"use client";

import { useState, useTransition } from "react";
import { Crown, UserMinus, ArrowRightLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/shared/Avatar";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { removeGuildMemberAction, transferLeadershipAction } from "@/lib/actions/guild";
import type { Profile, GuildRole } from "@/types/database";

export type MemberRow = { profile: Profile; role: GuildRole };

type Pending = { kind: "remove" | "transfer"; member: Profile };

export function GuildMembersList({
  guildId,
  members,
  currentUserId,
  isLeader,
}: {
  guildId: string;
  members: MemberRow[];
  currentUserId: string;
  isLeader: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [isPending, startTransition] = useTransition();

  function confirmAction() {
    if (!pending) return;
    const { kind, member } = pending;
    setError(null);
    startTransition(async () => {
      const result =
        kind === "remove"
          ? await removeGuildMemberAction(guildId, member.id)
          : await transferLeadershipAction(guildId, member.id);
      if (result.error) setError(result.error);
      setPending(null);
    });
  }

  return (
    <div className="rounded-lg border border-surface-border bg-surface shadow-card">
      <div className="border-b border-surface-border p-4">
        <h2 className="font-display text-sm font-semibold text-parchment">Guild Members ({members.length})</h2>
      </div>
      {error && (
        <p role="alert" className="px-4 pt-3 text-sm text-danger">
          {error}
        </p>
      )}
      <ul className="divide-y divide-surface-border">
        {members.map(({ profile, role }) => (
          <li key={profile.id} className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <Avatar name={profile.display_name} url={profile.avatar_url} className="h-9 w-9" />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="truncate text-sm font-semibold text-parchment">{profile.display_name}</p>
                  {role === "leader" && <Crown className="h-3.5 w-3.5 shrink-0 text-gold" aria-label="Guild leader" />}
                </div>
                <p className="truncate text-xs text-parchment-faint">
                  Lv {profile.level} · {profile.xp} XP · {profile.total_damage} dmg · {profile.tasks_completed} tasks
                </p>
              </div>
            </div>
            {isLeader && profile.id !== currentUserId && (
              <div className="flex shrink-0 items-center">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Make ${profile.display_name} the guild leader`}
                  disabled={isPending}
                  onClick={() => setPending({ kind: "transfer", member: profile })}
                >
                  <ArrowRightLeft className="h-4 w-4 text-gold" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${profile.display_name}`}
                  disabled={isPending}
                  onClick={() => setPending({ kind: "remove", member: profile })}
                >
                  <UserMinus className="h-4 w-4 text-danger" />
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => (open ? undefined : setPending(null))}
        title={pending?.kind === "transfer" ? "Hand over leadership?" : "Remove this member?"}
        description={
          pending?.kind === "transfer"
            ? `${pending.member.display_name} becomes the guild leader and you become a regular member.`
            : `${pending?.member.display_name ?? "This player"} loses access to the guild. Their open tasks return to the shared pool.`
        }
        confirmLabel={pending?.kind === "transfer" ? "Transfer leadership" : "Remove member"}
        destructive={pending?.kind === "remove"}
        pending={isPending}
        onConfirm={confirmAction}
      />
    </div>
  );
}
