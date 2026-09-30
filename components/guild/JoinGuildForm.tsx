"use client";

import { useActionState } from "react";
import { joinGuildAction } from "@/lib/actions/guild";
import type { AuthActionState } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initialState: AuthActionState = { error: null, info: null };

export function JoinGuildForm() {
  const [state, formAction, isPending] = useActionState(joinGuildAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="code">Invite code</Label>
        <Input
          id="code"
          name="code"
          placeholder="A1B2-C3D4-E5F6"
          autoComplete="off"
          maxLength={40}
          required
          className="uppercase tracking-wider"
          autoCapitalize="characters"
        />
      </div>
      {state.error && (
        <p role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {state.error}
        </p>
      )}
      <Button type="submit" variant="secondary" disabled={isPending}>
        {isPending ? "Joining…" : "Join guild"}
      </Button>
    </form>
  );
}
