"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

export function HpBar({
  current,
  max,
  colorClassName,
  trackClassName,
  height = "h-4",
}: {
  current: number;
  max: number;
  colorClassName: string;
  trackClassName?: string;
  height?: string;
}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (current / max) * 100)) : 0;

  return (
    <div
      className={cn("w-full overflow-hidden rounded-full bg-surface-raised", height, trackClassName)}
      role="progressbar"
      aria-valuenow={current}
      aria-valuemin={0}
      aria-valuemax={max}
    >
      <motion.div
        className={cn("h-full rounded-full", colorClassName)}
        initial={false}
        animate={{ width: `${pct}%` }}
        transition={{ type: "spring", stiffness: 120, damping: 20 }}
      />
    </div>
  );
}
