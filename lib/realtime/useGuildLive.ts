"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { GAME_CONFIG } from "@/config/gameConfig";
import { fetchDuelsForGuild, type DuelCardInfo } from "@/lib/data/duels";
import { syncServerClock } from "@/lib/hooks/useServerClock";
import type { DamagePopupItem } from "@/components/battle/BossPanel";
import type { ActivityFeedEntry, BattleEvent, Boss, Duel, Profile, Task, WeeklyBattle } from "@/types/database";

export type GuildLiveInitial = {
  guildId: string;
  battle: WeeklyBattle;
  boss: Boss;
  tasks: Task[];
  members: Profile[];
  activity: ActivityFeedEntry[];
  duels: Duel[];
  duelInfo: Record<string, DuelCardInfo>;
};

/**
 * The single owner of a guild's live state, shared by /dashboard, /tasks and
 * /leaderboard (previously only the dashboard was live and the other two
 * pages were static snapshots).
 *
 * Design rules:
 *  - ONE channel per mount whose dependencies are just [supabase, guildId].
 *    The old code listed bossCache and toast as dependencies, so the channel
 *    was torn down and rebuilt on nearly every event, dropping messages in the
 *    gap. Anything a handler needs that changes over time lives in a ref.
 *  - Realtime is an optimisation, not the source of truth: after every
 *    (re)subscription and whenever the tab becomes visible again the full
 *    snapshot is re-read from the database, so a missed or duplicated event
 *    can't leave the UI stale.
 *  - Realtime can't deliver a filtered DELETE (only the primary key exists on
 *    delete), so task deletions use an unfiltered listener that removes by id,
 *    and member removals/leaves are picked up because they always write an
 *    activity_feed row, which triggers a member re-read.
 *  - Rows are de-duplicated by id, so a duplicated event is harmless.
 */
export function useGuildLive(initial: GuildLiveInitial, options: { maintenance: boolean }) {
  const { guildId } = initial;
  const supabase = useRef(createClient()).current;

  const [battle, setBattle] = useState(initial.battle);
  const [bossCache, setBossCache] = useState<Record<string, Boss>>({ [initial.boss.id]: initial.boss });
  const [tasks, setTasks] = useState(initial.tasks);
  const [members, setMembers] = useState(initial.members);
  const [activity, setActivity] = useState(initial.activity);
  const [duels, setDuels] = useState(initial.duels);
  const [duelInfo, setDuelInfo] = useState(initial.duelInfo);
  const [popups, setPopups] = useState<DamagePopupItem[]>([]);
  const [hitKey, setHitKey] = useState(0);

  const battleRef = useRef(battle);
  const membersRef = useRef(members);
  const tasksRef = useRef(tasks);
  const bossCacheRef = useRef(bossCache);
  const seenEvents = useRef<Set<string>>(new Set());
  const membersTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const duelsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const popupTimers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const connectedOnce = useRef(false);

  useEffect(() => {
    membersRef.current = members;
  }, [members]);
  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);
  useEffect(() => {
    bossCacheRef.current = bossCache;
  }, [bossCache]);

  const ensureBoss = useCallback(
    async (bossId: string) => {
      if (bossCacheRef.current[bossId]) return;
      const { data } = await supabase.from("bosses").select("*").eq("id", bossId).single();
      if (data) {
        const boss = data as Boss;
        setBossCache((prev) => ({ ...prev, [boss.id]: boss }));
      }
    },
    [supabase]
  );

  const refreshMembers = useCallback(async () => {
    const { data } = await supabase.from("guild_members").select("profiles(*)").eq("guild_id", guildId);
    if (!data) return;
    const profiles = data
      .map((r) => (r as unknown as { profiles: Profile | null }).profiles)
      .filter((p): p is Profile => !!p);
    if (profiles.length > 0) setMembers(profiles);
  }, [supabase, guildId]);

  const scheduleMembersRefresh = useCallback(() => {
    if (membersTimer.current) clearTimeout(membersTimer.current);
    membersTimer.current = setTimeout(() => void refreshMembers(), 350);
  }, [refreshMembers]);

  const refreshDuels = useCallback(async () => {
    const result = await fetchDuelsForGuild(supabase, guildId);
    setDuels(result.duels);
    setDuelInfo(result.info);
  }, [supabase, guildId]);

  const scheduleDuelsRefresh = useCallback(() => {
    if (duelsTimer.current) clearTimeout(duelsTimer.current);
    duelsTimer.current = setTimeout(() => void refreshDuels(), 350);
  }, [refreshDuels]);

  const refreshTasks = useCallback(
    async (battleId: string) => {
      const { data } = await supabase
        .from("tasks")
        .select("*")
        .eq("battle_id", battleId)
        .order("created_at", { ascending: false });
      if (data) setTasks(data as Task[]);
    },
    [supabase]
  );

  const refreshActivity = useCallback(async () => {
    const { data } = await supabase
      .from("activity_feed")
      .select("*")
      .eq("guild_id", guildId)
      .order("created_at", { ascending: false })
      .limit(60);
    if (data) setActivity(data as ActivityFeedEntry[]);
  }, [supabase, guildId]);

  /** Re-reads everything from the database. Called on (re)connect and on tab focus. */
  const refreshAll = useCallback(async () => {
    const readActive = () =>
      supabase.from("weekly_battles").select("*").eq("guild_id", guildId).eq("status", "active").maybeSingle();

    let { data: active } = await readActive();
    if (!active) {
      await supabase.rpc("start_new_weekly_battle", { p_guild_id: guildId });
      ({ data: active } = await readActive());
    }
    if (active) {
      const row = active as WeeklyBattle;
      battleRef.current = row;
      setBattle(row);
      void ensureBoss(row.boss_id);
      await Promise.all([refreshTasks(row.id), refreshDuels()]);
    }
    await Promise.all([refreshMembers(), refreshActivity()]);
  }, [supabase, guildId, ensureBoss, refreshTasks, refreshDuels, refreshMembers, refreshActivity]);

  // --- realtime subscriptions ----------------------------------------------
  useEffect(() => {
    const filter = `guild_id=eq.${guildId}`;

    const channel = supabase
      .channel(`guild-live:${guildId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "weekly_battles", filter }, (payload) => {
        const row = payload.new as WeeklyBattle;
        if (!row?.id) return;
        const current = battleRef.current;
        if (row.id === current.id) {
          battleRef.current = row;
          setBattle(row);
          // The battle we were showing just ended: pick up its successor.
          if (row.status !== "active") void refreshAll();
        } else if (row.status === "active") {
          battleRef.current = row;
          setBattle(row);
          void ensureBoss(row.boss_id);
          void refreshTasks(row.id);
          scheduleDuelsRefresh();
        }
        // A finished row for a battle we've already moved past is ignored.
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks", filter }, (payload) => {
        if (payload.eventType === "DELETE") {
          const gone = payload.old as Partial<Task>;
          if (gone?.id) setTasks((prev) => prev.filter((t) => t.id !== gone.id));
          return;
        }
        const row = payload.new as Task;
        if (!row?.id) return;

        if (row.battle_id !== battleRef.current.id) {
          // Belongs to another battle (or was carried out of this one).
          setTasks((prev) => (prev.some((t) => t.id === row.id) ? prev.filter((t) => t.id !== row.id) : prev));
          return;
        }
        if (row.task_type === "duel" && !tasksRef.current.some((t) => t.id === row.id)) {
          scheduleDuelsRefresh();
        }
        setTasks((prev) =>
          prev.some((t) => t.id === row.id) ? prev.map((t) => (t.id === row.id ? row : t)) : [row, ...prev]
        );
      })
      // Filtered DELETE events don't work in Supabase Realtime, so listen
      // unfiltered and remove by id. On delete the payload carries only the PK.
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "tasks" }, (payload) => {
        const gone = payload.old as Partial<Task>;
        if (gone?.id) setTasks((prev) => (prev.some((t) => t.id === gone.id) ? prev.filter((t) => t.id !== gone.id) : prev));
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "activity_feed", filter }, (payload) => {
        const row = payload.new as ActivityFeedEntry;
        if (!row?.id) return;
        setActivity((prev) => (prev.some((a) => a.id === row.id) ? prev : [row, ...prev].slice(0, 60)));
        // Points, levels, joins and leaves always write a feed row, so this is
        // also what keeps the leaderboard / member list current.
        scheduleMembersRefresh();
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "battle_events", filter }, (payload) => {
        const row = payload.new as BattleEvent;
        if (!row?.id || seenEvents.current.has(row.id)) return;
        seenEvents.current.add(row.id);
        if (seenEvents.current.size > 200) seenEvents.current.clear();

        if (row.event_type === "damage" && row.actor_id && row.amount) {
          const actor = membersRef.current.find((m) => m.id === row.actor_id);
          const popup: DamagePopupItem = {
            id: row.id,
            amount: row.amount,
            actorName: actor?.display_name ?? "Someone",
            x: 35 + Math.random() * 30,
          };
          setPopups((prev) => [...prev, popup]);
          setHitKey((k) => k + 1);
          const timer = setTimeout(() => {
            setPopups((prev) => prev.filter((p) => p.id !== popup.id));
            popupTimers.current.delete(timer);
          }, 1400);
          popupTimers.current.add(timer);
        }
        if (row.actor_id || row.event_type === "battle_won" || row.event_type === "battle_lost") {
          scheduleMembersRefresh();
        }
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "guild_members", filter }, () =>
        scheduleMembersRefresh()
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "duels", filter }, () => scheduleDuelsRefresh())
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          // Anything that happened while we were (re)connecting is re-read.
          if (connectedOnce.current) void refreshAll();
          connectedOnce.current = true;
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.error(`[taskslayer] realtime channel ${status}; it will retry and resync on reconnect`);
        }
      });

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void refreshAll();
        void syncServerClock();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    const popupTimerSet = popupTimers.current;
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      if (membersTimer.current) clearTimeout(membersTimer.current);
      if (duelsTimer.current) clearTimeout(duelsTimer.current);
      popupTimerSet.forEach((t) => clearTimeout(t));
      popupTimerSet.clear();
      void supabase.removeChannel(channel);
    };
  }, [
    supabase,
    guildId,
    refreshAll,
    ensureBoss,
    refreshTasks,
    scheduleMembersRefresh,
    scheduleDuelsRefresh,
  ]);

  // --- server-driven time checks -------------------------------------------
  // The database decides what has expired (from ITS clock) inside
  // run_guild_maintenance; this only decides when to ask. Idempotent, and a
  // no-op when nothing is due. pg_cron (migration 0009) does the same with no
  // browser open.
  useEffect(() => {
    if (!options.maintenance) return;
    let cancelled = false;

    const run = async () => {
      if (cancelled || document.visibilityState !== "visible") return;
      const { error } = await supabase.rpc("run_guild_maintenance", { p_guild_id: guildId });
      if (error) console.error("[taskslayer] maintenance check failed:", error.message);
    };

    const id = setInterval(() => void run(), GAME_CONFIG.polling.overdueCheckMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [supabase, guildId, options.maintenance]);

  const boss = bossCache[battle.boss_id] ?? initial.boss;

  return { battle, boss, tasks, members, activity, duels, duelInfo, popups, hitKey, refresh: refreshAll };
}
