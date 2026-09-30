"use client";

import { motion, useReducedMotion } from "framer-motion";

export function DamagePopup({ amount, actorName, x }: { amount: number; actorName: string; x: number }) {
  const prefersReducedMotion = useReducedMotion();

  return (
    <motion.div
      initial={{ opacity: 0, y: 0 }}
      animate={{ opacity: [0, 1, 1, 0], y: prefersReducedMotion ? 0 : -48 }}
      transition={{ duration: 1.3, times: [0, 0.15, 0.7, 1], ease: "easeOut" }}
      className="pointer-events-none absolute top-1/3 flex -translate-x-1/2 flex-col items-center"
      style={{ left: `${x}%` }}
    >
      <span className="font-display text-2xl font-bold text-crimson-bright drop-shadow-[0_2px_6px_rgba(0,0,0,0.8)]">
        -{amount}
      </span>
      <span className="text-xs font-medium text-parchment-dim">{actorName}</span>
    </motion.div>
  );
}
