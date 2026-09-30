import { redirect } from "next/navigation";
import Link from "next/link";
import { Trophy, Skull } from "lucide-react";
import { Navbar } from "@/components/shared/Navbar";
import { MobileNav } from "@/components/shared/MobileNav";
import { getSessionContext } from "@/lib/data/session";
import { getGuildContext } from "@/lib/data/guild";
import { cn } from "@/lib/utils";
import type { Boss, WeeklyBattle } from "@/types/database";

type BattleRow = WeeklyBattle & { bosses: Boss | null };

const dateFormat: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" };

export default async function BattleHistoryPage() {
  const { supabase, user } = await getSessionContext();

  const context = await getGuildContext(supabase, user.id);
  if (!context) redirect("/guild");

  const { data } = await supabase
    .from("weekly_battles")
    .select("*, bosses(*)")
    .eq("guild_id", context.guild.id)
    .neq("status", "active")
    .order("started_at", { ascending: false })
    .limit(30);

  const rows = (data ?? []) as unknown as BattleRow[];

  return (
    <div className="min-h-screen bg-ink pb-20 md:pb-0">
      <Navbar activePath="/battle-history" />
      <main className="mx-auto max-w-2xl px-4 py-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="font-display text-lg font-semibold text-parchment">Battle History</h1>
            <p className="text-xs text-parchment-faint">{context.guild.name}</p>
          </div>
          <Link href="/dashboard" className="text-xs font-medium text-parchment-dim hover:text-parchment">
            ← Current battle
          </Link>
        </div>

        {rows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-surface-border p-8 text-center">
            <p className="font-display text-sm font-semibold text-parchment">No finished battles yet.</p>
            <p className="mt-1 text-xs text-parchment-dim">Once a boss falls — or the week ends — it is recorded here for good.</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {rows.map((battle) => {
              const summary = battle.result_summary;
              const won = battle.status === "won";
              const started = new Date(battle.started_at).toLocaleDateString(undefined, dateFormat);
              const finished = battle.finished_at ? new Date(battle.finished_at).toLocaleDateString(undefined, dateFormat) : null;
              // Battles finished before migration 0008 only stored an MVP; fall back to the row's own HP.
              const hpStart = summary?.boss_hp_start ?? battle.max_hp;
              const hpEnd = summary?.boss_hp_end ?? battle.boss_hp;
              const participants = summary?.participants ?? [];
              const rewards = summary?.rewards;

              return (
                <li
                  key={battle.id}
                  className={cn("rounded-lg border p-4", won ? "border-gold/40 bg-gold/5" : "border-surface-border bg-surface")}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[11px] uppercase tracking-wide text-parchment-faint">
                        {started}
                        {finished && finished !== started ? ` → ${finished}` : ""}
                      </p>
                      <p className="break-words font-display text-base font-semibold text-parchment">{battle.bosses?.name ?? "Unknown Boss"}</p>
                    </div>
                    <span
                      className={cn(
                        "flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide",
                        won ? "bg-gold/15 text-gold-bright" : "bg-danger/15 text-danger"
                      )}
                    >
                      {won ? <Trophy className="h-3 w-3" aria-hidden /> : <Skull className="h-3 w-3" aria-hidden />}
                      {won ? "Defeated" : "Boss Won"}
                    </span>
                  </div>

                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
                    <div>
                      <dt className="text-[11px] uppercase tracking-wide text-parchment-faint">Boss HP</dt>
                      <dd className="text-parchment-dim">
                        {hpStart} <span className="text-parchment-faint">→</span> {hpEnd}
                      </dd>
                    </div>
                    {summary?.total_damage !== undefined && (
                      <div>
                        <dt className="text-[11px] uppercase tracking-wide text-parchment-faint">Damage dealt</dt>
                        <dd className="font-semibold text-crimson-bright">{summary.total_damage}</dd>
                      </div>
                    )}
                    {summary?.team_hp_end !== undefined && summary.team_hp_max !== undefined && (
                      <div>
                        <dt className="text-[11px] uppercase tracking-wide text-parchment-faint">Team HP</dt>
                        <dd className="text-parchment-dim">
                          {summary.team_hp_end} / {summary.team_hp_max}
                        </dd>
                      </div>
                    )}
                    {won && rewards && (
                      <div className="col-span-2 sm:col-span-3">
                        <dt className="text-[11px] uppercase tracking-wide text-parchment-faint">Rewards</dt>
                        <dd className="text-gold">
                          +{rewards.guild_xp} guild XP · +{rewards.member_xp} XP for each member
                        </dd>
                      </div>
                    )}
                  </dl>

                  {summary?.top_damage_name && (
                    <p className="mt-2 text-xs text-parchment-dim">
                      MVP <span className="font-semibold text-parchment">{summary.top_damage_name}</span> · {summary.top_damage} dmg
                    </p>
                  )}

                  {participants.length > 0 && (
                    <details className="mt-2 text-xs">
                      <summary className="cursor-pointer text-parchment-dim hover:text-parchment">
                        {participants.length} fighter{participants.length === 1 ? "" : "s"}
                      </summary>
                      <ul className="mt-1.5 flex flex-col gap-0.5 text-parchment-dim">
                        {participants.map((p) => (
                          <li key={p.user_id} className="flex justify-between gap-3">
                            <span className="truncate">{p.name}</span>
                            <span className="shrink-0 text-parchment-faint">{p.damage} dmg</span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </main>
      <MobileNav activePath="/battle-history" />
    </div>
  );
}
