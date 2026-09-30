"use client";

import { useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { Profile } from "@/types/database";

/**
 * Real Supabase Realtime Presence, tracked by user id, on a PRIVATE channel
 * named presence:<guild_id>. The Realtime Authorization policies in migration
 * 0009 only let members of that guild join it, so presence is genuinely
 * guild-scoped rather than "anyone who knows the channel name".
 *
 * A member is online while they have the app open; Supabase drops them from
 * presence when the socket closes or its heartbeat stops, so nobody stays
 * online forever after closing a tab.
 */
export function OnlinePresence({ guildId, currentUserId, members }: { guildId: string; currentUserId: string; members: Profile[] }) {
  const supabase = useRef(createClient()).current;
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set());
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let channel: RealtimeChannel | null = null;

    void (async () => {
      // Private channels authorize with the user's JWT.
      await supabase.realtime.setAuth();
      if (cancelled) return;

      channel = supabase.channel(`presence:${guildId}`, {
        config: { private: true, presence: { key: currentUserId } },
      });
      const active = channel;

      active
        .on("presence", { event: "sync" }, () => {
          setOnlineIds(new Set(Object.keys(active.presenceState())));
        })
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            setUnavailable(false);
            void active.track({ online_at: new Date().toISOString() });
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            console.error(
              "[taskslayer] presence channel failed. If this persists, apply migration 0009 (Realtime Authorization policies for presence:<guild_id>)."
            );
            setUnavailable(true);
          }
        });
    })();

    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [supabase, guildId, currentUserId]);

  if (members.length === 0) return null;

  return (
    <div className="rounded-lg border border-surface-border bg-surface p-3">
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5" aria-label="Who is online">
        {members.map((m) => {
          const online = onlineIds.has(m.id);
          return (
            <li key={m.id} className="flex items-center gap-1.5 text-xs">
              <span className={cn("h-2 w-2 rounded-full", online ? "bg-emerald-400" : "bg-parchment-faint/40")} aria-hidden />
              <span className={online ? "text-parchment" : "text-parchment-faint"}>
                {m.display_name}
                <span className="sr-only">{online ? " (online)" : " (offline)"}</span>
              </span>
            </li>
          );
        })}
      </ul>
      {unavailable && <p className="mt-2 text-[11px] text-parchment-faint">Live presence is unavailable right now.</p>}
    </div>
  );
}
