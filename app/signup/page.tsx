import { Swords } from "lucide-react";
import { SignupForm } from "@/components/auth/SignupForm";

export default function SignupPage() {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-ink px-4 py-12">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 60% 50% at 50% 0%, rgba(201,154,75,0.14), transparent 70%)",
        }}
      />
      <div className="relative z-10 w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-2 text-center">
          <Swords className="h-8 w-8 text-crimson" aria-hidden />
          <h1 className="font-display text-2xl font-bold tracking-tight text-parchment">Join TaskSlayer</h1>
          <p className="text-sm text-parchment-dim">Your guild is waiting. Your boss is bigger.</p>
        </div>
        <div className="rounded-lg border border-surface-border bg-surface p-6 shadow-arena">
          <SignupForm />
        </div>
      </div>
    </main>
  );
}
