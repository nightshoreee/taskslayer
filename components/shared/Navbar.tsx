import Link from "next/link";
import { Swords, ListChecks, Castle, Trophy, User as UserIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { logoutAction } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/shared/Avatar";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import type { AppNotification } from "@/types/database";

const LINKS = [
  { href: "/dashboard", label: "Battle", icon: Swords },
  { href: "/tasks", label: "Tasks", icon: ListChecks },
  { href: "/guild", label: "Guild", icon: Castle },
  { href: "/leaderboard", label: "Leaderboard", icon: Trophy },
  { href: "/profile", label: "Profile", icon: UserIcon },
];

/** Desktop navigation bar + a compact mobile top bar (logo and notifications). */
export async function Navbar({ activePath }: { activePath: string }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let displayName = "";
  let avatarUrl: string | null = null;
  let notifications: AppNotification[] = [];
  let unread = 0;

  if (user) {
    const [{ data: profile }, { data: notificationRows }, { count }] = await Promise.all([
      supabase.from("profiles").select("display_name, avatar_url").eq("id", user.id).maybeSingle(),
      supabase.from("notifications").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(20),
      supabase.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", user.id).is("read_at", null),
    ]);
    displayName = profile?.display_name ?? "";
    avatarUrl = profile?.avatar_url ?? null;
    notifications = (notificationRows ?? []) as AppNotification[];
    unread = count ?? 0;
  }

  const bell = user ? <NotificationBell userId={user.id} initial={notifications} initialUnread={unread} /> : null;

  return (
    <>
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-surface-border bg-ink/90 px-4 backdrop-blur md:hidden">
        <Link href="/dashboard" className="flex items-center gap-2">
          <Swords className="h-5 w-5 text-crimson" aria-hidden />
          <span className="font-display text-base font-bold tracking-tight text-parchment">TaskSlayer</span>
        </Link>
        {bell}
      </header>

      <header className="sticky top-0 z-30 hidden border-b border-surface-border bg-ink/90 backdrop-blur md:block">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Link href="/dashboard" className="flex items-center gap-2">
            <Swords className="h-5 w-5 text-crimson" aria-hidden />
            <span className="font-display text-lg font-bold tracking-tight text-parchment">TaskSlayer</span>
          </Link>

          <nav aria-label="Primary" className="flex items-center gap-1">
            {LINKS.map(({ href, label, icon: Icon }) => {
              const active = activePath.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    active ? "bg-surface-raised text-parchment" : "text-parchment-dim hover:text-parchment"
                  )}
                >
                  <Icon className="h-4 w-4" aria-hidden />
                  {label}
                </Link>
              );
            })}
          </nav>

          <div className="flex items-center gap-2">
            {bell}
            {displayName && <Avatar name={displayName} url={avatarUrl} className="h-8 w-8" />}
            <form action={logoutAction}>
              <Button type="submit" variant="ghost" size="sm">
                Log out
              </Button>
            </form>
          </div>
        </div>
      </header>
    </>
  );
}
