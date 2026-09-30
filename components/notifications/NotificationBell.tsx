"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, Check } from "lucide-react";
import { cn, formatRelativeTime } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { useToast, type ToastVariant } from "@/components/ui/toast";
import { markAllNotificationsReadAction, markNotificationReadAction } from "@/lib/actions/notifications";
import type { AppNotification } from "@/types/database";

const TOAST_VARIANT: Record<string, ToastVariant> = {
  duel_won: "success",
  battle_won: "success",
  badge_unlocked: "reward",
  loot_stolen: "error",
  bomb_exploded: "error",
  task_overdue: "error",
  duel_lost: "info",
};

/**
 * Persistent notifications (public.notifications), delivered live over
 * Realtime. Toasts are just the transient echo of a row that already exists in
 * the database, so nothing important is lost if the tab was closed: the list
 * and unread count come from the database on every page load.
 */
export function NotificationBell({
  userId,
  initial,
  initialUnread,
}: {
  userId: string;
  initial: AppNotification[];
  initialUnread: number;
}) {
  const supabase = useRef(createClient()).current;
  const { toast } = useToast();
  const [items, setItems] = useState(initial);
  const [unread, setUnread] = useState(initialUnread);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const seen = useRef<Set<string>>(new Set(initial.map((n) => n.id)));

  useEffect(() => {
    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (payload) => {
          const row = payload.new as AppNotification;
          if (!row?.id || seen.current.has(row.id)) return; // a duplicated event is harmless
          seen.current.add(row.id);
          setItems((prev) => [row, ...prev].slice(0, 30));
          setUnread((n) => n + 1);
          toast({ title: row.title, description: row.body ?? undefined, variant: TOAST_VARIANT[row.type] ?? "info" });
        }
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, userId, toast]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const markRead = useCallback(
    async (id: string) => {
      const target = items.find((n) => n.id === id);
      if (!target || target.read_at) return;
      const stamp = new Date().toISOString();
      setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read_at: stamp } : n)));
      setUnread((n) => Math.max(0, n - 1));
      await markNotificationReadAction(id);
    },
    [items]
  );

  async function markAll() {
    const stamp = new Date().toISOString();
    setItems((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: stamp })));
    setUnread(0);
    await markAllNotificationsReadAction();
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        aria-expanded={open}
        aria-haspopup="true"
        className="relative flex h-9 w-9 items-center justify-center rounded-md text-parchment-dim transition-colors hover:bg-surface-raised hover:text-parchment focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold"
      >
        <Bell className="h-5 w-5" aria-hidden />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-crimson px-1 text-[10px] font-bold text-parchment">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          role="region"
          aria-label="Notifications"
          className="fixed inset-x-3 top-16 z-40 max-h-[70dvh] overflow-hidden rounded-lg border border-surface-border bg-surface-raised shadow-arena sm:absolute sm:inset-x-auto sm:right-0 sm:top-11 sm:w-96"
        >
          <div className="flex items-center justify-between border-b border-surface-border px-3 py-2">
            <h2 className="font-display text-sm font-semibold text-parchment">Notifications</h2>
            <button
              type="button"
              onClick={() => void markAll()}
              disabled={unread === 0}
              className="flex items-center gap-1 text-xs font-medium text-gold hover:text-gold-bright disabled:cursor-not-allowed disabled:text-parchment-faint"
            >
              <Check className="h-3 w-3" aria-hidden /> Mark all read
            </button>
          </div>
          {items.length === 0 ? (
            <p className="p-6 text-center text-xs text-parchment-faint">Nothing yet. Duels, bombs, loot and badges show up here.</p>
          ) : (
            <ul className="max-h-[calc(70dvh-44px)] divide-y divide-surface-border overflow-y-auto">
              {items.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => void markRead(n.id)}
                    className={cn("flex w-full items-start gap-2.5 px-3 py-2.5 text-left hover:bg-surface", !n.read_at && "bg-crimson/5")}
                  >
                    <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.read_at ? "bg-transparent" : "bg-crimson-bright")} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block break-words text-sm font-medium text-parchment">{n.title}</span>
                      {n.body && <span className="block break-words text-xs text-parchment-dim">{n.body}</span>}
                      <span className="block text-[11px] text-parchment-faint" suppressHydrationWarning>
                        {formatRelativeTime(n.created_at)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
