import { Swords, Trophy } from "lucide-react";
import { formatRelativeTime } from "@/lib/utils";
import type { Duel, Profile } from "@/types/database";

/**
 * Active and past duels of the guild (live, fed by the duels table). Winners
 * come from the database (`duels.winner_id`), never from the client.
 */
export function DuelHistory({ duels, members }: { duels: Duel[]; members: Profile[] }) {
  const names = new Map(members.map((m) => [m.id, m.display_name]));
  const nameOf = (id: string | null) => (id ? (names.get(id) ?? "Former member") : "—");

  return (
    <section aria-label="Duels" className="rounded-lg border border-surface-border bg-surface shadow-card">
      <div className="flex items-center gap-2 border-b border-surface-border p-3">
        <Swords className="h-4 w-4 text-gold" aria-hidden />
        <h2 className="font-display text-sm font-semibold text-parchment">Duels</h2>
      </div>

      {duels.length === 0 ? (
        <p className="p-4 text-center text-xs text-parchment-faint">
          No duels yet. Pick <span className="font-semibold text-parchment-dim">New Task → Duel</span> to challenge a guildmate.
        </p>
      ) : (
        <ul className="max-h-72 divide-y divide-surface-border overflow-y-auto">
          {duels.map((duel) => (
            <li key={duel.id} className="flex flex-col gap-1 px-4 py-2.5">
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 break-words text-sm font-medium text-parchment">{duel.title}</p>
                <span
                  className={
                    duel.status === "active"
                      ? "shrink-0 rounded-full bg-gold/15 px-2 py-0.5 text-[10px] font-semibold text-gold"
                      : duel.status === "completed"
                        ? "shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-400"
                        : "shrink-0 rounded-full bg-surface-raised px-2 py-0.5 text-[10px] font-semibold text-parchment-faint"
                  }
                >
                  {duel.status === "active" ? "In progress" : duel.status === "completed" ? "Decided" : "No winner"}
                </span>
              </div>
              <p className="text-xs text-parchment-dim">
                {nameOf(duel.challenger_id)} <span className="text-parchment-faint">vs</span> {nameOf(duel.opponent_id)}
                <span className="text-parchment-faint"> · </span>
                <time dateTime={duel.created_at} suppressHydrationWarning>
                  {formatRelativeTime(duel.created_at)}
                </time>
              </p>
              {duel.status === "completed" && duel.winner_id && (
                <p className="flex items-center gap-1 text-xs font-semibold text-gold">
                  <Trophy className="h-3 w-3" aria-hidden /> {nameOf(duel.winner_id)} won
                  <span className="font-normal text-parchment-dim"> — first valid completion, {duel.reward_points} base XP</span>
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
