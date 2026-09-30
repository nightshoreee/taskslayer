"use client";

import { useActionState } from "react";
import { createGuildAction } from "@/lib/actions/guild";
import type { AuthActionState } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const initialState: AuthActionState = { error: null, info: null };

export function CreateGuildForm() {
  const [state, formAction, isPending] = useActionState(createGuildAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="name">Guild name</Label>
        <Input id="name" name="name" placeholder="Dragon Guild" required minLength={2} maxLength={50} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="description">Description (optional)</Label>
        <Textarea id="description" name="description" placeholder="What is this guild fighting for?" maxLength={300} />
      </div>
      {state.error && (
        <p role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {state.error}
        </p>
      )}
      <Button type="submit" disabled={isPending}>
        {isPending ? "Founding guild…" : "Found guild"}
      </Button>
    </form>
  );
}
