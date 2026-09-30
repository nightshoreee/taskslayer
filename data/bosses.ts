// Keys MUST match `bosses.key` seeded in supabase/migrations/0001_init.sql.
// Name/title/description/flavor_text/max_hp come from the database at
// runtime (bosses is a public, readable catalog table) — this file only
// adds presentation-layer info the database doesn't need to know about:
// which color palette and silhouette shape BossSvg should render.

export type BossPalette = {
  glow: string;
  glowSoft: string;
  core: string;
  spike: string;
  eye: string;
};

export type BossVisual = {
  palette: BossPalette;
  spikes: number;
  silhouette: "dragon" | "demon" | "titan" | "hydra" | "overlord" | "phantom" | "meeting";
};

export const BOSS_VISUALS: Record<string, BossVisual> = {
  procrastination_dragon: {
    palette: { glow: "#DD5266", glowSoft: "#7A1F30", core: "#2A0E14", spike: "#4E1420", eye: "#E6BE73" },
    spikes: 9,
    silhouette: "dragon",
  },
  deadline_demon: {
    palette: { glow: "#E13A3A", glowSoft: "#8C2A36", core: "#1E0A0C", spike: "#7A1F30", eye: "#FFD27A" },
    spikes: 7,
    silhouette: "demon",
  },
  assignment_titan: {
    palette: { glow: "#C99A4B", glowSoft: "#8C6E39", core: "#231C10", spike: "#6B5730", eye: "#EDE7E0" },
    spikes: 5,
    silhouette: "titan",
  },
  bug_hydra: {
    palette: { glow: "#7FBF8C", glowSoft: "#365B3D", core: "#0F1A12", spike: "#7A1F30", eye: "#C13A4A" },
    spikes: 11,
    silhouette: "hydra",
  },
  exam_overlord: {
    palette: { glow: "#9A6FD6", glowSoft: "#4A3369", core: "#150F1E", spike: "#4E1420", eye: "#E6BE73" },
    spikes: 8,
    silhouette: "overlord",
  },
  distraction_phantom: {
    palette: { glow: "#6FA9D6", glowSoft: "#33506B", core: "#0C1620", spike: "#2A2530", eye: "#DD5266" },
    spikes: 6,
    silhouette: "phantom",
  },
  infinite_meeting: {
    palette: { glow: "#A9A2AC", glowSoft: "#4A4650", core: "#17141B", spike: "#2A2530", eye: "#C13A4A" },
    spikes: 4,
    silhouette: "meeting",
  },
};

export const DEFAULT_BOSS_VISUAL: BossVisual = BOSS_VISUALS.procrastination_dragon!;

export function getBossVisual(key: string): BossVisual {
  return BOSS_VISUALS[key] ?? DEFAULT_BOSS_VISUAL;
}
