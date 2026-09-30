import { Gift } from "lucide-react";
import { cn, formatRelativeTime } from "@/lib/utils";
import { LOOT_EFFECT_ICON, RARITY_STYLE, formatLootEffect } from "@/data/loot";
import type { LootEffectType } from "@/data/loot";
import type { LootRarity } from "@/types/database";

export interface LootHistoryEntry {
  id: string;
  claimed_at: string;
  label: string;
  effect_type: LootEffectType;
  effect_value: number;
  rarity: LootRarity;
}

export function LootHistoryList({ entries }: { entries: LootHistoryEntry[] }) {
  if (entries.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-surface-border p-6 text-center">
        <Gift className="mx-auto h-6 w-6 text-parchment-faint" aria-hidden />
        <p className="mt-2 font-display text-sm font-semibold text-parchment">Your inventory is empty.</p>
        <p className="mt-1 text-xs text-parchment-dim">Complete Loot Tasks to discover rewards.</p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {entries.map((entry) => {
        const style = RARITY_STYLE[entry.rarity];
        const Icon = LOOT_EFFECT_ICON[entry.effect_type];
        return (
          <li
            key={entry.id}
            className={cn("flex items-center gap-3 rounded-lg border bg-surface p-2.5", style.border)}
          >
            <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full", style.wash)}>
              <Icon className={cn("h-4 w-4", style.text)} aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-parchment">{entry.label}</p>
              <p className="text-xs text-parchment-dim">{formatLootEffect(entry.effect_type, entry.effect_value)}</p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-0.5">
              <span className={cn("text-[10px] font-semibold uppercase tracking-wide", style.text)}>
                {style.label}
              </span>
              <span className="text-[10px] text-parchment-faint">{formatRelativeTime(entry.claimed_at)}</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
