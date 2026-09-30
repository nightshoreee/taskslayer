import { Heart } from "lucide-react";
import { HpBar } from "@/components/battle/HpBar";

export function TeamHpCard({ current, max }: { current: number; max: number }) {
  const critical = max > 0 && current / max <= 0.25;

  return (
    <div className="rounded-lg border border-surface-border bg-surface p-4 shadow-card">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-parchment-dim">
          <Heart className={critical ? "h-3.5 w-3.5 text-danger" : "h-3.5 w-3.5 text-crimson"} aria-hidden />
          Team HP
        </div>
        <span className="text-stat text-sm font-semibold text-parchment">
          {current} / {max}
        </span>
      </div>
      <HpBar current={current} max={max} colorClassName={critical ? "bg-danger" : "bg-crimson"} />
    </div>
  );
}
