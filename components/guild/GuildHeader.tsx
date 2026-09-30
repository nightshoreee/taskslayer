"use client";

import { useState, useTransition } from "react";
import { Copy, Check, RefreshCw, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { regenerateInviteCodeAction, leaveGuildAction } from "@/lib/actions/guild";
import type { Guild } from "@/types/database";

export function GuildHeader({ guild, isLeader }: { guild: Guild; isLeader: boolean }) {
  const [code, setCode] = useState(guild.invite_code);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleCopy() {
    navigator.clipboard.writeText(code).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => setError("Couldn't copy automatically — select the code and copy it manually.")
    );
  }

  function handleRegenerate() {
    setError(null);
    startTransition(async () => {
      const result = await regenerateInviteCodeAction(guild.id);
      if (result.error) {
        setError(result.error);
      } else if (result.code) {
        setCode(result.code);
      }
    });
  }

  function handleLeave() {
    startTransition(async () => {
      const result = await leaveGuildAction();
      if (result?.error) setError(result.error);
      setConfirmLeave(false);
    });
  }

  return (
    <div className="rounded-lg border border-surface-border bg-surface p-5 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-xl font-bold text-parchment">{guild.name}</h1>
          {guild.description && <p className="mt-1 text-sm text-parchment-dim">{guild.description}</p>}
          <p className="mt-1 text-xs text-parchment-faint">{guild.guild_xp} guild XP earned</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setConfirmLeave(true)} disabled={isPending}>
          <LogOut className="h-4 w-4" /> Leave
        </Button>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-wide text-parchment-faint">Invite code</span>
        <code className="rounded-md border border-surface-border bg-ink px-3 py-1.5 font-display text-sm font-semibold tracking-wider text-gold-bright">
          {code}
        </code>
        <Button variant="outline" size="sm" onClick={handleCopy} aria-label="Copy invite code">
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </Button>
        {isLeader && (
          <Button variant="outline" size="sm" onClick={handleRegenerate} disabled={isPending} aria-label="Regenerate invite code">
            <RefreshCw className={isPending ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
      <ConfirmDialog
        open={confirmLeave}
        onOpenChange={setConfirmLeave}
        title="Leave this guild?"
        description={
          isLeader
            ? "If other members remain you must hand over leadership first. If you are the last member, the guild is disbanded."
            : "You'll need a new invite code to rejoin. Your open tasks return to the shared pool."
        }
        confirmLabel="Leave guild"
        destructive
        pending={isPending}
        onConfirm={handleLeave}
      />
    </div>
  );
}
