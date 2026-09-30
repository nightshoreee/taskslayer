"use client";

import { useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import type { BossVisual } from "@/data/bosses";

/** Jagged crown/aura polygon — the shared building block every boss is built from. */
function spikePath(cx: number, cy: number, innerR: number, outerR: number, points: number, phase = 0): string {
  const step = Math.PI / points;
  let d = "";
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const angle = phase + i * step - Math.PI / 2;
    const x = cx + r * Math.cos(angle);
    const y = cy + r * Math.sin(angle);
    d += `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)} `;
  }
  return `${d}Z`;
}

export function BossSvg({
  visual,
  hpPercent,
  hitKey,
  defeated,
}: {
  visual: BossVisual;
  hpPercent: number;
  /** change this value to trigger one shake pulse (e.g. bump a counter on each hit) */
  hitKey: number;
  defeated: boolean;
}) {
  const prefersReducedMotion = useReducedMotion();
  const { palette, spikes, silhouette } = visual;

  const innerRatio = silhouette === "titan" ? 0.72 : silhouette === "meeting" ? 0.88 : silhouette === "phantom" ? 0.55 : 0.62;
  const outerCrown = spikePath(150, 150, 100 * innerRatio, 100, spikes, 0);
  const innerCrown =
    silhouette === "hydra"
      ? spikePath(150, 158, 78 * innerRatio, 82, Math.max(3, spikes - 4), Math.PI / spikes)
      : null;

  const damage = 1 - hpPercent;
  const cracks = useMemo(() => {
    if (damage < 0.15) return [];
    const seedAngles = [0.4, 1.6, 2.7, 4.1, 5.3];
    const count = Math.min(seedAngles.length, Math.ceil(damage * 6));
    return seedAngles.slice(0, count).map((a, i) => {
      const x1 = 150 + 20 * Math.cos(a);
      const y1 = 150 + 20 * Math.sin(a);
      const x2 = 150 + (60 + i * 6) * Math.cos(a + 0.3);
      const y2 = 150 + (60 + i * 6) * Math.sin(a + 0.3);
      const xm = 150 + 40 * Math.cos(a - 0.15);
      const ym = 150 + 40 * Math.sin(a - 0.15);
      return `M${x1.toFixed(1)},${y1.toFixed(1)} L${xm.toFixed(1)},${ym.toFixed(1)} L${x2.toFixed(1)},${y2.toFixed(1)}`;
    });
  }, [damage]);

  const gradId = `boss-core-${silhouette}`;
  const glowId = `boss-glow-${silhouette}`;

  return (
    <motion.svg
      viewBox="0 0 300 300"
      className="h-full w-full"
      role="img"
      aria-label={defeated ? "Boss defeated" : "Boss, damaged in proportion to remaining HP"}
      animate={
        !prefersReducedMotion && hitKey > 0
          ? { x: [0, -6, 5, -3, 2, 0], scale: [1, 1.03, 0.99, 1.01, 1] }
          : {}
      }
      transition={{ duration: 0.4, ease: "easeInOut" }}
      style={{ filter: defeated ? "grayscale(1) brightness(0.5)" : "none" }}
    >
      <defs>
        <radialGradient id={gradId} cx="50%" cy="45%" r="60%">
          <stop offset="0%" stopColor={palette.eye} stopOpacity="0.25" />
          <stop offset="35%" stopColor={palette.spike} />
          <stop offset="100%" stopColor={palette.core} />
        </radialGradient>
        <filter id={glowId} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="14" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* outer glow aura, pulses gently unless the boss is defeated or motion is reduced */}
      <motion.circle
        cx="150"
        cy="150"
        r="92"
        fill={palette.glowSoft}
        opacity={defeated ? 0.15 : 0.35}
        filter={`url(#${glowId})`}
        animate={!prefersReducedMotion && !defeated ? { opacity: [0.28, 0.42, 0.28] } : {}}
        transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
      />

      {innerCrown && <path d={innerCrown} fill={palette.spike} opacity={0.6} />}
      <path d={outerCrown} fill={`url(#${gradId})`} stroke={palette.glow} strokeWidth={defeated ? 0.5 : 1.5} strokeOpacity={0.6} />

      {/* core */}
      <circle cx="150" cy="150" r={100 * innerRatio * 0.62} fill={palette.core} stroke={palette.spike} strokeWidth="2" />

      {/* eyes */}
      {!defeated ? (
        <>
          <motion.ellipse
            cx="128" cy="146" rx="9" ry="6" fill={palette.eye}
            animate={!prefersReducedMotion ? { opacity: [1, 0.55, 1] } : {}}
            transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
          />
          <motion.ellipse
            cx="172" cy="146" rx="9" ry="6" fill={palette.eye}
            animate={!prefersReducedMotion ? { opacity: [1, 0.55, 1] } : {}}
            transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut", delay: 0.15 }}
          />
        </>
      ) : (
        <>
          <line x1="121" y1="140" x2="135" y2="152" stroke={palette.glow} strokeWidth="3" strokeLinecap="round" />
          <line x1="135" y1="140" x2="121" y2="152" stroke={palette.glow} strokeWidth="3" strokeLinecap="round" />
          <line x1="165" y1="140" x2="179" y2="152" stroke={palette.glow} strokeWidth="3" strokeLinecap="round" />
          <line x1="179" y1="140" x2="165" y2="152" stroke={palette.glow} strokeWidth="3" strokeLinecap="round" />
        </>
      )}

      {/* damage cracks — accumulate as HP drops */}
      {cracks.map((d, i) => (
        <path key={i} d={d} fill="none" stroke={palette.eye} strokeWidth="1.5" strokeLinecap="round" opacity={0.75} />
      ))}
    </motion.svg>
  );
}
