"use client";

import { useActionState } from "react";
import Link from "next/link";
import { loginAction, type AuthActionState } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initialState: AuthActionState = { error: null, info: null };

export function LoginForm({ next, notice }: { next?: string; notice?: string | null }) {
  const [state, formAction, isPending] = useActionState(loginAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {next ? <input type="hidden" name="next" value={next} /> : null}
      {notice && (
        <p role="status" className="rounded-md border border-gold/40 bg-gold/10 px-3 py-2 text-sm text-gold">
          {notice}
        </p>
      )}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>

      {state.error && (
        <p role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {state.error}
        </p>
      )}

      <Button type="submit" size="lg" disabled={isPending} className="mt-2">
        {isPending ? "Entering the arena…" : "Log in"}
      </Button>

      <p className="text-center text-sm text-parchment-dim">
        New here?{" "}
        <Link href="/signup" className="font-semibold text-gold hover:text-gold-bright">
          Create an account
        </Link>
      </p>
    </form>
  );
}
