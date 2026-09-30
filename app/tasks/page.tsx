import { redirect } from "next/navigation";
import { Navbar } from "@/components/shared/Navbar";
import { MobileNav } from "@/components/shared/MobileNav";
import { TasksClient } from "@/components/tasks/TasksClient";
import { getSessionContext } from "@/lib/data/session";
import { getGuildContext, loadGuildSnapshot } from "@/lib/data/guild";
import type { ClaimLootResult } from "@/types/database";

export default async function TasksPage() {
  const { supabase, user } = await getSessionContext();

  const context = await getGuildContext(supabase, user.id);
  if (!context) redirect("/guild");

  const snapshot = await loadGuildSnapshot(supabase, context.guild);
  if (!snapshot) redirect("/dashboard");

  const { data: pending } = await supabase.rpc("get_pending_loot");

  return (
    <div className="min-h-screen bg-ink pb-20 md:pb-0">
      <Navbar activePath="/tasks" />
      <main className="mx-auto max-w-5xl px-4 py-6">
        <TasksClient
          initial={snapshot}
          pendingLoot={(pending ?? []) as ClaimLootResult[]}
          currentUserId={user.id}
          isLeader={context.role === "leader"}
        />
      </main>
      <MobileNav activePath="/tasks" />
    </div>
  );
}
