import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-ink px-4 text-center">
      <h1 className="font-display text-xl font-bold text-parchment">Nothing here but dust.</h1>
      <p className="max-w-sm text-sm text-parchment-dim">That page doesn&rsquo;t exist, or you don&rsquo;t have access to it.</p>
      <Link href="/dashboard" className="rounded-md bg-crimson px-4 py-2 text-sm font-semibold text-parchment hover:bg-crimson-bright">
        Back to the battle
      </Link>
    </main>
  );
}
