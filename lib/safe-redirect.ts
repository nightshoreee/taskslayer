/**
 * Only same-site, absolute-path redirect targets are allowed. Anything else
 * (`//evil.com`, `/\evil.com`, `@evil.com`, `https://…`) falls back to `fallback`.
 * The auth callback used to concatenate `origin + next` unchecked, which made
 * `?next=@evil.com` redirect off-site.
 */
export function safeNextPath(next: string | null | undefined, fallback: string): string {
  if (!next) return fallback;
  if (!next.startsWith("/")) return fallback;
  if (next.startsWith("//") || next.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001f]/.test(next)) return fallback;
  return next;
}
