import { Swords, DoorOpen } from "lucide-react";
import { getSessionContext } from "@/lib/data/session";
import { GuildLiveRefresh } from "@/components/guild/GuildLiveRefresh";
import { CreateGuildForm } from "@/components/guild/CreateGuildForm";
import { JoinGuildForm } from "@/components/guild/JoinGuildForm";
import { GuildHeader } from "@/components/guild/GuildHeader";
import { GuildMembersList, type MemberRow } from "@/components/guild/GuildMembersList";
import { OnlinePresence } from "@/components/guild/OnlinePresence";
import { Navbar } from "@/components/shared/Navbar";
import { MobileNav } from "@/components/shared/MobileNav";
import type { Profile } from "@/types/database";

export default async function GuildPage() {
  const { supabase, user } = await getSessionContext();

  const { data: membership } = await supabase
    .from("guild_members")
    .select("guild_id, role")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership) {
    return (
      <main className="flex min-h-screen flex-col items-center bg-ink px-4 py-16">
        <div className="mb-10 flex flex-col items-center gap-2 text-center">
          <Swords className="h-8 w-8 text-crimson" aria-hidden />
          <h1 className="font-display text-2xl font-bold text-parchment">You have no guild.</h1>
          <p className="max-w-xs text-sm text-parchment-dim">
            Create one or join an existing guild with an invite code.
          </p>
        </div>
        <div className="grid w-full max-w-3xl gap-6 sm:grid-cols-2">
          <div className="rounded-lg border border-surface-border bg-surface p-6 shadow-card">
            <h2 className="mb-4 font-display text-sm font-semibold uppercase tracking-wide text-gold">
              Found a guild
            </h2>
            <CreateGuildForm />
          </div>
          <div className="rounded-lg border border-surface-border bg-surface p-6 shadow-card">
            <h2 className="mb-4 flex items-center gap-2 font-display text-sm font-semibold uppercase tracking-wide text-parchment-dim">
              <DoorOpen className="h-4 w-4" /> Join a guild
            </h2>
            <JoinGuildForm />
          </div>
        </div>
      </main>
    );
  }

  const [{ data: guild }, { data: memberRows }] = await Promise.all([
    supabase.from("guilds").select("*").eq("id", membership.guild_id).single(),
    supabase
      .from("guild_members")
      .select("role, profiles(*)")
      .eq("guild_id", membership.guild_id),
  ]);

  const members: MemberRow[] = (memberRows ?? [])
    .filter((r): r is typeof r & { profiles: Profile } => !!r.profiles)
    .map((r) => ({ profile: r.profiles, role: r.role }))
    .sort((a, b) => (a.role === b.role ? 0 : a.role === "leader" ? -1 : 1));

  return (
    <div className="min-h-screen bg-ink pb-20 md:pb-0">
      <Navbar activePath="/guild" />
      <main className="mx-auto max-w-3xl px-4 py-8">
        <div className="flex flex-col gap-6">
          <GuildLiveRefresh guildId={membership.guild_id} />
          {guild && <GuildHeader guild={guild} isLeader={membership.role === "leader"} />}
          <OnlinePresence guildId={membership.guild_id} currentUserId={user.id} members={members.map((m) => m.profile)} />
          <GuildMembersList
            guildId={membership.guild_id}
            members={members}
            currentUserId={user.id}
            isLeader={membership.role === "leader"}
          />
        </div>
      </main>
      <MobileNav activePath="/guild" />
    </div>
  );
}
