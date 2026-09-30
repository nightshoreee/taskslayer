"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/types/database";

/**
 * Keeps a guild's member profiles (points, levels, avatars) current without a
 * page refresh — used by /leaderboard, which doesn't need the whole battle
 * state. XP, damage, joins and leaves always write an activity_feed row in the
 * same transaction, so that (plus guild_members changes) is the trigger; the
 * data itself is always re-read from the database, never patched client-side.
 */
export function useLiveMembers(guildId: string, initial: Profile[]): Profile[] {
  const supabase = useRef(createClient()).current;
  const [members, setMembers] = useState(initial);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const refresh = async () => {
      const { data } = await supabase.from("guild_members").select("profiles(*)").eq("guild_id", guildId);
      if (!data) return;
      const profiles = data
        .map((r) => (r as unknown as { profiles: Profile | null }).profiles)
        .filter((p): p is Profile => !!p);
      if (profiles.length > 0) setMembers(profiles);
    };
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void refresh(), 350);
    };

    const filter = `guild_id=eq.${guildId}`;
    let connectedOnce = false;
    const channel = supabase
      .channel(`members-live:${guildId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "activity_feed", filter }, schedule)
      .on("postgres_changes", { event: "*", schema: "public", table: "guild_members", filter }, schedule)
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          if (connectedOnce) schedule(); // resync after a reconnect
          connectedOnce = true;
        }
      });

    const onVisible = () => {
      if (document.visibilityState === "visible") schedule();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [supabase, guildId]);

  return members;
}
