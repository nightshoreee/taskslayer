import { Swords } from "lucide-react";
import { LoginForm } from "@/components/auth/LoginForm";
import { safeNextPath } from "@/lib/safe-redirect";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;
  const next = safeNextPath(params.next, "/dashboard");
  const notice = params.error === "confirmation_failed" ? "That confirmation link is invalid or has expired. Log in or sign up again." : null;

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-ink px-4">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 60% 50% at 50% 0%, rgba(193,58,74,0.18), transparent 70%)",
        }}
      />
      <div className="relative z-10 w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-2 text-center">
          <Swords className="h-8 w-8 text-crimson" aria-hidden />
          <h1 className="font-display text-2xl font-bold tracking-tight text-parchment">TaskSlayer</h1>
          <p className="text-sm text-parchment-dim">Turn your workload into a boss fight.</p>
        </div>
        <div className="rounded-lg border border-surface-border bg-surface p-6 shadow-arena">
          <LoginForm next={next} notice={notice} />
        </div>
      </div>
    </main>
  );
}
