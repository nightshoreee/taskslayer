"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * The guild page is server-rendered (roster, roles, invite code). This has no
 * UI of its own: it listens for membership changes and activity in the guild
 * and re-runs the server render, so joins, leaves, removals and leadership
 * transfers show up for everyone without a manual refresh.
 */
export function GuildLiveRefresh({ guildId }: { guildId: string }) {
  const router = useRouter();
  const supabase = useRef(createClient()).current;

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 400);
    };
    const filter = `guild_id=eq.${guildId}`;
    const channel = supabase
      .channel(`guild-roster:${guildId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "guild_members", filter }, schedule)
      // Leaves/removals are DELETEs (which can't be filtered), but they always write a feed row.
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "activity_feed", filter }, schedule)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "guilds", filter: `id=eq.${guildId}` }, schedule)
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [supabase, router, guildId]);

  return null;
}
