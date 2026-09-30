"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Gift } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { LOOT_EFFECT_ICON, RARITY_STYLE, formatLootEffect } from "@/data/loot";
import type { ClaimLootResult } from "@/types/database";

/** How long the sealed chest wobbles before it opens on its own. */
const SEALED_MS = 1100;
const SPARK_RADIUS = 92;

/**
 * The loot has already been rolled and saved by the database by the time this
 * opens — closing it early loses nothing. It is purely the "moment": what the
 * server decided, shown with a bit of theatre.
 */
export function LootRevealDialog({ loot, onClose }: { loot: ClaimLootResult | null; onClose: () => void }) {
  return (
    <Dialog
      open={loot !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {loot && <RevealContent key={loot.task_id} loot={loot} onClose={onClose} />}
    </Dialog>
  );
}

function RevealContent({ loot, onClose }: { loot: ClaimLootResult; onClose: () => void }) {
  const reduceMotion = useReducedMotion();
  const [revealed, setRevealed] = useState(false);
  const style = RARITY_STYLE[loot.rarity];
  const Icon = LOOT_EFFECT_ICON[loot.effect_type];

  useEffect(() => {
    const timer = window.setTimeout(() => setRevealed(true), reduceMotion ? 200 : SEALED_MS);
    return () => window.clearTimeout(timer);
  }, [reduceMotion]);

  const sparks = useMemo(
    () =>
      Array.from({ length: style.sparks }, (_, i) => {
        const angle = (i / style.sparks) * Math.PI * 2;
        return { x: Math.cos(angle) * SPARK_RADIUS, y: Math.sin(angle) * SPARK_RADIUS };
      }),
    [style.sparks]
  );

  return (
    <DialogContent
      title={revealed ? "Loot discovered!" : "Something is stirring…"}
      description={revealed ? loot.description : "The Boss's hoard is giving something up."}
      className="text-center"
    >
      <div className="flex flex-col items-center gap-3 pt-1" aria-live="polite">
        <div className="relative flex h-32 w-32 items-center justify-center">
          <AnimatePresence mode="wait" initial={false}>
            {!revealed ? (
              <motion.button
                key="sealed"
                type="button"
                onClick={() => setRevealed(true)}
                aria-label="Open the loot now"
                animate={reduceMotion ? undefined : { rotate: [0, -8, 8, -6, 6, 0], scale: [1, 1.06, 1] }}
                transition={{ duration: 0.8, repeat: Infinity }}
                exit={{ scale: 0.6, opacity: 0 }}
                className="flex h-24 w-24 items-center justify-center rounded-full border-2 border-gold/50 bg-gold/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
              >
                <Gift className="h-10 w-10 text-gold-bright" aria-hidden />
              </motion.button>
            ) : (
              <motion.div
                key="revealed"
                className="relative flex items-center justify-center"
                initial={reduceMotion ? false : { scale: 0.3, opacity: 0, rotate: -18 }}
                animate={{ scale: 1, opacity: 1, rotate: 0 }}
                transition={{ type: "spring", stiffness: 260, damping: 15 }}
              >
                {!reduceMotion && (
                  <motion.span
                    aria-hidden
                    className="pointer-events-none absolute h-24 w-24 rounded-full border-2"
                    style={{ borderColor: style.hex }}
                    initial={{ scale: 0.6, opacity: 0.9 }}
                    animate={{ scale: 2.2, opacity: 0 }}
                    transition={{ duration: 0.8, ease: "easeOut" }}
                  />
                )}
                {!reduceMotion &&
                  sparks.map((spark, i) => (
                    <motion.span
                      key={i}
                      aria-hidden
                      className="pointer-events-none absolute h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: style.hex }}
                      initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
                      animate={{ x: spark.x, y: spark.y, opacity: 0, scale: 0.4 }}
                      transition={{ duration: 0.9, ease: "easeOut" }}
                    />
                  ))}
                <div
                  className={cn(
                    "flex h-24 w-24 items-center justify-center rounded-full border-2",
                    style.border,
                    style.wash
                  )}
                >
                  <Icon className={cn("h-10 w-10", style.text)} aria-hidden />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {revealed && (
          <motion.div
            className="flex flex-col items-center gap-1.5"
            initial={reduceMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: reduceMotion ? 0 : 0.25 }}
          >
            <span
              className={cn(
                "text-[11px] font-semibold uppercase tracking-[0.2em]",
                style.text,
                loot.rarity === "legendary" && "animate-pulse-glow"
              )}
            >
              {style.label}
            </span>
            <p className="font-display text-xl font-semibold text-parchment">{loot.label}</p>
            <span className="rounded-full border border-surface-border bg-surface px-3 py-1 text-xs font-medium text-parchment-dim">
              {formatLootEffect(loot.effect_type, loot.effect_value)}
            </span>
          </motion.div>
        )}

        <Button onClick={onClose} className="mt-2 w-full" disabled={!revealed}>
          {revealed ? "Got it" : "Opening…"}
        </Button>
      </div>
    </DialogContent>
  );
}
