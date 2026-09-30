import { cn } from "@/lib/utils";

/**
 * Profile picture with an initial fallback. Only https:// URLs are rendered
 * (the database also refuses anything else at signup); a plain <img> is used
 * on purpose so arbitrary avatar hosts don't need next/image configuration.
 */
export function Avatar({
  name,
  url,
  className,
}: {
  name: string;
  url?: string | null;
  className?: string;
}) {
  const initial = (name.trim().charAt(0) || "?").toUpperCase();
  const safeUrl = url && url.startsWith("https://") ? url : null;

  return safeUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={safeUrl}
      alt=""
      referrerPolicy="no-referrer"
      className={cn("h-7 w-7 shrink-0 rounded-full border border-surface-border object-cover", className)}
    />
  ) : (
    <span
      aria-hidden
      className={cn(
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-surface-border bg-surface text-xs font-semibold text-parchment-dim",
        className
      )}
    >
      {initial}
    </span>
  );
}
