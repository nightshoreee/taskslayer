"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signUpAction, type AuthActionState } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initialState: AuthActionState = { error: null, info: null };

export function SignupForm() {
  const [state, formAction, isPending] = useActionState(signUpAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="username">Username</Label>
        <Input id="username" name="username" placeholder="dragon_slayer" required minLength={3} maxLength={20} pattern="[a-zA-Z0-9_]+" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="displayName">Display name</Label>
        <Input id="displayName" name="displayName" placeholder="How your guild sees you" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} />
        <p className="text-xs text-parchment-faint">At least 8 characters.</p>
      </div>

      {state.error && (
        <p role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {state.error}
        </p>
      )}
      {state.info && (
        <p role="status" className="rounded-md border border-gold/40 bg-gold/10 px-3 py-2 text-sm text-gold-bright">
          {state.info}
        </p>
      )}

      <Button type="submit" size="lg" disabled={isPending} className="mt-2">
        {isPending ? "Forging your character…" : "Create account"}
      </Button>

      <p className="text-center text-sm text-parchment-dim">
        Already slaying tasks?{" "}
        <Link href="/login" className="font-semibold text-gold hover:text-gold-bright">
          Log in
        </Link>
      </p>
    </form>
  );
}
