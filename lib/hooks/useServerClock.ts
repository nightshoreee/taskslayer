"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Countdown display must not trust the visitor's clock. The database exposes
 * server_now(); we measure the offset between it and Date.now() (corrected for
 * half the round trip) and apply that offset to every countdown. This is
 * DISPLAY ONLY — deadlines are always enforced by the database.
 */
let offsetMs = 0;
let lastSyncAt = 0;
let inflight: Promise<void> | null = null;

const RESYNC_AFTER_MS = 5 * 60_000;

export function serverNow(): number {
  return Date.now() + offsetMs;
}

export function syncServerClock(force = false): Promise<void> {
  if (!force && lastSyncAt !== 0 && Date.now() - lastSyncAt < RESYNC_AFTER_MS) {
    return Promise.resolve();
  }
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const sentAt = Date.now();
      const { data, error } = await createClient().rpc("server_now");
      const receivedAt = Date.now();
      if (!error && typeof data === "string") {
        offsetMs = new Date(data).getTime() - (sentAt + receivedAt) / 2;
        lastSyncAt = receivedAt;
      }
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

/** Current server time in ms, re-rendering every `intervalMs`. */
export function useServerNow(intervalMs = 1000): number {
  const [now, setNow] = useState<number>(() => serverNow());

  useEffect(() => {
    let alive = true;
    void syncServerClock().then(() => {
      if (alive) setNow(serverNow());
    });
    const id = setInterval(() => setNow(serverNow()), intervalMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [intervalMs]);

  return now;
}
