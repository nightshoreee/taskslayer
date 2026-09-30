import { redirect } from "next/navigation";
import { Navbar } from "@/components/shared/Navbar";
import { MobileNav } from "@/components/shared/MobileNav";
import { LeaderboardClient } from "@/components/leaderboard/LeaderboardClient";
import { getSessionContext } from "@/lib/data/session";
import { getGuildContext, loadMembers } from "@/lib/data/guild";

export default async function LeaderboardPage() {
  const { supabase, user } = await getSessionContext();

  const context = await getGuildContext(supabase, user.id);
  if (!context) redirect("/guild");

  const members = await loadMembers(supabase, context.guild.id);

  return (
    <div className="min-h-screen bg-ink pb-20 md:pb-0">
      <Navbar activePath="/leaderboard" />
      <main className="mx-auto max-w-2xl px-4 py-6">
        <LeaderboardClient guildId={context.guild.id} initialMembers={members} currentUserId={user.id} />
      </main>
      <MobileNav activePath="/leaderboard" />
    </div>
  );
}
