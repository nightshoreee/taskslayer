"use client";

import { Hourglass } from "lucide-react";
import { formatCountdown } from "@/lib/utils";
import { useServerNow } from "@/lib/hooks/useServerClock";

/**
 * Counts down to the battle's deadline on the SERVER clock (offset-corrected).
 * Display only: the database ends the battle from its own clock. The target now
 * follows the `endsAt` prop — it used to be frozen in state on first render, so
 * after a weekly rollover it kept counting down to the previous battle.
 */
export function BattleTimer({ endsAt }: { endsAt: string }) {
  const now = useServerNow(1000);
  const remaining = new Date(endsAt).getTime() - now;

  return (
    <div className="flex items-center gap-1.5 text-xs font-medium text-parchment-dim">
      <Hourglass className="h-3.5 w-3.5" aria-hidden />
      <span>
        Battle ends in{" "}
        <span className="text-stat font-semibold text-parchment" suppressHydrationWarning>
          {remaining > 0 ? formatCountdown(remaining) : "any moment now"}
        </span>
      </span>
    </div>
  );
}
