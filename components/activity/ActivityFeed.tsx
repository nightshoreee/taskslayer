"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { formatRelativeTime } from "@/lib/utils";
import type { ActivityFeedEntry } from "@/types/database";

export function ActivityFeed({ entries }: { entries: ActivityFeedEntry[] }) {
  // Re-render every 30s so "just now" doesn't stay frozen.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="rounded-lg border border-surface-border bg-surface shadow-card">
      <div className="border-b border-surface-border p-3">
        <h2 className="font-display text-sm font-semibold text-parchment">Live Battle Feed</h2>
      </div>
      {entries.length === 0 ? (
        <p className="p-4 text-center text-xs text-parchment-faint">No battles yet. Your first boss is waiting.</p>
      ) : (
        <ul className="max-h-72 divide-y divide-surface-border overflow-y-auto md:max-h-96">
          <AnimatePresence initial={false}>
            {entries.map((e) => (
              <motion.li
                key={e.id}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                transition={{ duration: 0.25 }}
                className="flex items-start gap-2.5 px-4 py-2.5"
              >
                <span className="text-base leading-none" aria-hidden>
                  {e.icon}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="break-words text-sm text-parchment">{e.message}</p>
                  <p className="text-[11px] text-parchment-faint" suppressHydrationWarning>
                    {formatRelativeTime(e.created_at)}
                  </p>
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </div>
  );
}
