"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Skull, Trophy } from "lucide-react";
import { BossSvg } from "@/components/battle/BossSvg";
import { HpBar } from "@/components/battle/HpBar";
import { DamagePopup } from "@/components/battle/DamagePopup";
import { BattleTimer } from "@/components/battle/BattleTimer";
import { getBossVisual } from "@/data/bosses";
import type { Boss, WeeklyBattle } from "@/types/database";

export type DamagePopupItem = { id: string; amount: number; actorName: string; x: number };

export function BossPanel({
  boss,
  battle,
  hitKey,
  popups,
}: {
  boss: Boss;
  battle: WeeklyBattle;
  hitKey: number;
  popups: DamagePopupItem[];
}) {
  const visual = getBossVisual(boss.key);
  const hpPercent = battle.max_hp > 0 ? battle.boss_hp / battle.max_hp : 0;
  const defeated = battle.status !== "active";
  const won = battle.status === "won";

  return (
    <section
      className="relative overflow-hidden rounded-xl border border-surface-border bg-surface p-5 shadow-arena"
      aria-label="Boss battle"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background: `radial-gradient(ellipse 70% 55% at 50% 30%, ${visual.palette.glowSoft}33, transparent 70%)`,
        }}
      />

      <div className="relative flex flex-col items-center text-center">
        <p className="text-xs font-medium uppercase tracking-widest text-parchment-faint">{boss.title}</p>
        <h2 className="font-display text-xl font-bold text-parchment">{boss.name}</h2>

        <div className="relative mt-2 aspect-square w-full max-w-[260px]">
          <BossSvg visual={visual} hpPercent={hpPercent} hitKey={hitKey} defeated={defeated} />
          <AnimatePresence>
            {popups.map((p) => (
              <DamagePopup key={p.id} amount={p.amount} actorName={p.actorName} x={p.x} />
            ))}
          </AnimatePresence>
        </div>

        <div className="mt-3 w-full max-w-sm">
          <div className="mb-1.5 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-parchment-dim">
            <span>Boss HP</span>
            <span className="text-stat text-sm text-parchment">
              {battle.boss_hp} / {battle.max_hp}
            </span>
          </div>
          <HpBar current={battle.boss_hp} max={battle.max_hp} colorClassName="bg-gradient-to-r from-crimson-dim to-crimson-bright" height="h-5" />
        </div>

        {!defeated && (
          <p className="mt-3 max-w-sm text-xs italic text-parchment-faint">&ldquo;{boss.flavor_text}&rdquo;</p>
        )}
        {!defeated && (
          <div className="mt-3">
            <BattleTimer endsAt={battle.ends_at} />
          </div>
        )}
      </div>

      <AnimatePresence>
        {defeated && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-ink/90 px-6 text-center backdrop-blur-sm"
          >
            {won ? (
              <>
                <Trophy className="h-10 w-10 text-gold" aria-hidden />
                <h3 className="font-display text-2xl font-bold text-gold-bright">Boss Slain</h3>
                <p className="text-sm text-parchment-dim">
                  {boss.name} was defeated. +500 Guild XP, +100 Personal XP for everyone.
                </p>
              </>
            ) : (
              <>
                <Skull className="h-10 w-10 text-parchment-dim" aria-hidden />
                <h3 className="font-display text-2xl font-bold text-parchment">The Boss Wins</h3>
                <p className="text-sm text-parchment-dim">
                  Your guild survived the week, but didn&rsquo;t conquer it. A new boss awaits.
                </p>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
