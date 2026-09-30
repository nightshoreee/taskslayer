"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Shield, Zap, Sparkles, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { useServerNow } from "@/lib/hooks/useServerClock";
import { useToast } from "@/components/ui/toast";
import { activatePowerupAction } from "@/lib/actions/powerups";
import type { Powerup, PowerupType } from "@/types/database";

const POWERUP_META: Record<PowerupType, { label: string; description: string; icon: LucideIcon }> = {
  double_xp: { label: "Double XP", description: "All XP you earn is doubled.", icon: Zap },
  team_shield: { label: "Team Shield", description: "Absorbs the next Bomb explosion or overdue penalty.", icon: Shield },
  boss_slayer: { label: "Boss Slayer", description: "A rare boon against the Boss.", icon: Sparkles },
  heal: { label: "Heal", description: "Restores team HP.", icon: Sparkles },
};

export function PowerupInventory({ powerups, userId }: { powerups: Powerup[]; userId: string }) {
  const supabase = useRef(createClient()).current;
  const { toast } = useToast();
  const [items, setItems] = useState(powerups);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  // Remaining time is derived from the SERVER's expires_at and the SERVER clock.
  const now = useServerNow(15_000);

  // Power-ups are granted server-side (loot) and consumed server-side (shields),
  // so the list follows the database in realtime.
  useEffect(() => {
    const channel = supabase
      .channel(`powerups:${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "powerups", filter: `user_id=eq.${userId}` }, (payload) => {
        const row = payload.new as Powerup;
        if (!row?.id) return;
        setItems((prev) => (prev.some((p) => p.id === row.id) ? prev.map((p) => (p.id === row.id ? row : p)) : [row, ...prev]));
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, userId]);

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-surface-border p-6 text-center">
        <Shield className="mx-auto h-6 w-6 text-parchment-faint" aria-hidden />
        <p className="mt-2 font-display text-sm font-semibold text-parchment">No powerups yet.</p>
        <p className="mt-1 text-xs text-parchment-dim">Loot Tasks can drop one — check your inventory below.</p>
      </div>
    );
  }

  function handleActivate(powerup: Powerup) {
    setPendingId(powerup.id);
    startTransition(async () => {
      const result = await activatePowerupAction(powerup.id);
      setPendingId(null);
      if (result.error || !result.data) {
        toast({ title: "Couldn't activate", description: result.error ?? "Please try again.", variant: "error" });
        return;
      }
      // Use the SERVER's activation and expiry timestamps — never a locally computed expiry.
      const { activated_at, expires_at } = result.data;
      setItems((prev) => prev.map((p) => (p.id === powerup.id ? { ...p, activated_at, expires_at } : p)));
      toast({ title: `${POWERUP_META[powerup.type].label} activated`, variant: "reward" });
    });
  }

  return (
    <ul className="flex flex-col gap-2">
      {items.map((powerup) => {
        const meta = POWERUP_META[powerup.type];
        const Icon = meta.icon;
        const expiresMs = powerup.expires_at ? new Date(powerup.expires_at).getTime() : null;
        const spent = powerup.uses_remaining <= 0;
        const timedOut = expiresMs !== null && expiresMs <= now;
        const isArmedNoExpiry = powerup.activated_at !== null && expiresMs === null && !spent;
        const isTimedActive = powerup.activated_at !== null && expiresMs !== null && !timedOut && !spent;

        let statusLabel = "Ready to activate";
        let statusTone = "text-parchment-dim";
        if (spent || timedOut) {
          statusLabel = spent && powerup.activated_at ? "Used" : "Expired";
          statusTone = "text-parchment-faint";
        } else if (isTimedActive && expiresMs !== null) {
          const minutes = Math.max(1, Math.ceil((expiresMs - now) / 60_000));
          statusLabel = `Active · ${minutes}m left`;
          statusTone = "text-gold-bright";
        } else if (isArmedNoExpiry) {
          statusLabel = "Armed — protecting the team";
          statusTone = "text-emerald-400";
        }

        const canActivate = powerup.activated_at === null && !spent;
        const lit = canActivate || isTimedActive || isArmedNoExpiry;

        return (
          <li
            key={powerup.id}
            className={cn("flex items-center gap-3 rounded-lg border bg-surface p-2.5", canActivate ? "border-gold/40" : "border-surface-border")}
          >
            <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full", lit ? "bg-gold/10" : "bg-parchment-dim/10")}>
              <Icon className={cn("h-4 w-4", lit ? "text-gold-bright" : "text-parchment-faint")} aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-parchment">{meta.label}</p>
              <p className="truncate text-xs text-parchment-dim">{meta.description}</p>
            </div>
            {canActivate ? (
              <Button size="sm" className="h-8 shrink-0 px-2.5 text-xs" disabled={isPending || pendingId === powerup.id} onClick={() => handleActivate(powerup)}>
                {pendingId === powerup.id ? "Activating…" : "Activate"}
              </Button>
            ) : (
              <span className={cn("shrink-0 text-xs font-medium", statusTone)} suppressHydrationWarning>
                {statusLabel}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
