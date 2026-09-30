import { getSessionContext } from "@/lib/data/session";
import { logoutAction } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import { Navbar } from "@/components/shared/Navbar";
import { MobileNav } from "@/components/shared/MobileNav";
import { ProfileStats } from "@/components/profile/ProfileStats";
import { LootHistoryList, type LootHistoryEntry } from "@/components/loot/LootHistoryList";
import { PowerupInventory } from "@/components/loot/PowerupInventory";
import { BadgesGrid } from "@/components/profile/BadgesGrid";
import { computeLootRarity, type LootEffectType } from "@/data/loot";

export default async function ProfilePage() {
  const { supabase, user, profile } = await getSessionContext();

  const [{ data: lootRows }, { data: rewardWeights }, { data: powerupRows }, { data: badges }, { data: userBadges }] =
    await Promise.all([
      supabase
        .from("user_loot")
        .select("id, claimed_at, loot_rewards(label, effect_type, effect_value, weight)")
        .eq("user_id", user.id)
        .order("claimed_at", { ascending: false })
        .limit(30),
      supabase.from("loot_rewards").select("weight"),
      supabase.from("powerups").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
      supabase.from("badges").select("*").order("criteria_value", { ascending: true }),
      supabase.from("user_badges").select("*").eq("user_id", user.id),
    ]);

  const totalWeight = (rewardWeights ?? []).reduce((sum, r) => sum + (r.weight as number), 0);
  const lootHistory: LootHistoryEntry[] = (lootRows ?? [])
    .map((row) => {
      const reward = row.loot_rewards as unknown as
        | { label: string; effect_type: LootEffectType; effect_value: number; weight: number }
        | null;
      if (!reward) return null;
      return {
        id: row.id as string,
        claimed_at: row.claimed_at as string,
        label: reward.label,
        effect_type: reward.effect_type,
        effect_value: reward.effect_value,
        rarity: computeLootRarity(reward.weight, totalWeight),
      };
    })
    .filter((e): e is LootHistoryEntry => e !== null);

  return (
    <div className="min-h-screen bg-ink pb-20 md:pb-0">
      <Navbar activePath="/profile" />
      <main className="mx-auto max-w-lg px-4 py-6">
        <ProfileStats profile={profile} />

        <section className="mt-6 flex flex-col gap-2">
          <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-parchment-dim">
            Badges
          </h2>
          <BadgesGrid badges={badges ?? []} userBadges={userBadges ?? []} />
        </section>

        <section className="mt-6 flex flex-col gap-2">
          <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-parchment-dim">
            Powerups
          </h2>
          <PowerupInventory powerups={powerupRows ?? []} userId={user.id} />
        </section>

        <section className="mt-6 flex flex-col gap-2">
          <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-parchment-dim">
            Loot Inventory
          </h2>
          <LootHistoryList entries={lootHistory} />
        </section>

        {/* The desktop nav has Log out; on phones the bottom bar has no room for it. */}
        <form action={logoutAction} className="mt-8 md:hidden">
          <Button type="submit" variant="outline" className="w-full">
            Log out
          </Button>
        </form>
      </main>
      <MobileNav activePath="/profile" />
    </div>
  );
}
