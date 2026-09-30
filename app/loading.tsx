export default function Loading() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-ink" aria-busy="true">
      <p role="status" className="animate-pulse font-display text-sm text-parchment-dim">
        Summoning the arena…
      </p>
    </main>
  );
}
