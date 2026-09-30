import type { PriorityLevel } from "@/types/database";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const LIMITS = {
  title: 200,
  description: 500,
  guildName: 50,
  guildDescription: 300,
  displayName: 40,
} as const;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function isPriority(value: unknown): value is PriorityLevel {
  return value === "low" || value === "medium" || value === "high";
}

/** Returns a user-facing error, or null when the text is acceptable. */
export function checkText(label: string, value: string, max: number, required: boolean): string | null {
  const trimmed = value.trim();
  if (required && trimmed.length === 0) return `Give the ${label} a value.`;
  if (trimmed.length > max) return `The ${label} must be ${max} characters or fewer.`;
  return null;
}

/** An ISO timestamp strictly in the future (the DB re-checks this authoritatively). */
export function checkFutureIso(value: string | null): string | null {
  if (value === null) return null;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return "That due date isn't valid.";
  if (ms <= Date.now()) return "The due date must be in the future.";
  return null;
}
