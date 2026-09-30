"use client";

import { useEffect } from "react";
import { logoutAction } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";

/** Catches render/server errors for every route with a recoverable screen (incl. an unrecoverable profile). */
export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[taskslayer] route error", error.digest ?? "", error.message);
  }, [error]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-ink px-4 text-center">
      <h1 className="font-display text-xl font-bold text-parchment">The arena hit a snag.</h1>
      <p className="max-w-sm text-sm text-parchment-dim">
        Something went wrong loading this page. Your progress is safe — it lives in the database, not in this tab.
      </p>
      <div className="flex gap-2">
        <Button onClick={reset}>Try again</Button>
        <form action={logoutAction}>
          <Button type="submit" variant="outline">
            Log out
          </Button>
        </form>
      </div>
    </main>
  );
}
