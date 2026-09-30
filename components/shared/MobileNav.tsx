import Link from "next/link";
import { Swords, ListChecks, Castle, Trophy, User as UserIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/dashboard", label: "Battle", icon: Swords },
  { href: "/tasks", label: "Tasks", icon: ListChecks },
  { href: "/guild", label: "Guild", icon: Castle },
  { href: "/leaderboard", label: "Rank", icon: Trophy },
  { href: "/profile", label: "Profile", icon: UserIcon },
];

export function MobileNav({ activePath }: { activePath: string }) {
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-30 flex border-t border-surface-border bg-ink/95 backdrop-blur md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      {LINKS.map(({ href, label, icon: Icon }) => {
        const active = activePath.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium",
              active ? "text-crimson-bright" : "text-parchment-faint"
            )}
          >
            <Icon className="h-5 w-5" aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
