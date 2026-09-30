import { redirect } from "next/navigation";
import { Navbar } from "@/components/shared/Navbar";
import { MobileNav } from "@/components/shared/MobileNav";
import { DashboardClient } from "@/components/dashboard/DashboardClient";
import { getSessionContext } from "@/lib/data/session";
import { getGuildContext, loadGuildSnapshot } from "@/lib/data/guild";
import { findGameConfigDrift } from "@/lib/data/gameConfig";
import type { ClaimLootResult } from "@/types/database";

export default async function DashboardPage() {
  const { supabase, user } = await getSessionContext();

  const context = await getGuildContext(supabase, user.id);
  if (!context) redirect("/guild");

  // Runs the server's deadline / bomb / overdue checks first, so the page never
  // renders a battle that already ended on the database clock.
  const snapshot = await loadGuildSnapshot(supabase, context.guild);
  if (!snapshot) redirect("/guild");

  const [{ data: pending }, drift] = await Promise.all([
    supabase.rpc("get_pending_loot"),
    findGameConfigDrift(supabase),
  ]);
  if (drift.length > 0) {
    console.error("[taskslayer] config/gameConfig.ts and public.game_config disagree:\n  " + drift.join("\n  "));
  }

  return (
    <div className="min-h-screen bg-ink pb-20 md:pb-0">
      <Navbar activePath="/dashboard" />
      <DashboardClient
        initial={snapshot}
        pendingLoot={(pending ?? []) as ClaimLootResult[]}
        currentUserId={user.id}
        isLeader={context.role === "leader"}
      />
      <MobileNav activePath="/dashboard" />
    </div>
  );
}
