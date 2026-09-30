/**
 * Turns a Supabase/PostgREST error into something safe to show a user.
 *
 * Our SQL functions and triggers signal expected failures with
 * `raise exception '<user-facing sentence>'`, which Postgres reports as
 * SQLSTATE P0001 — those messages are written for players and pass through.
 * Everything else (constraint names, RLS text, driver errors) is logged on the
 * server and replaced with a generic message so internals never reach the UI.
 */
export type SupabaseLikeError = { code?: string | null; message?: string | null };

const GENERIC = "Something went wrong. Please try again.";

export function toUserMessage(error: SupabaseLikeError, fallback: string = GENERIC): string {
  if (error.code === "P0001" && error.message) {
    return error.message;
  }

  console.error("[taskslayer] database error", error.code ?? "no-code", error.message ?? "");

  switch (error.code) {
    case "42501":
      return "You don't have permission to do that.";
    case "23505":
      return "That already exists.";
    case "23503":
      return "That refers to something that no longer exists.";
    case "23514":
    case "22P02":
    case "22001":
      return "One of the values you entered isn't valid.";
    case "40P01":
    case "40001":
      return "The game was busy processing another action. Please try again.";
    case "PGRST301":
      return "Your session expired. Please log in again.";
    default:
      return fallback;
  }
}
