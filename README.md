# TaskSlayer

**Task manager + RPG boss battle + guild competition.** Every task you finish is a strike against your guild's weekly boss. Teammates see the boss lose HP, the leaderboard move and the feed update live.

All game outcomes — damage, XP, boss HP, duel winners, bomb explosions, loot, badges, weekly rollover — are decided **inside Postgres**, never in the browser.

> **Verification status — read this first.** This repository includes the latest production patch, `0010_bomb_battle_rollover.sql`, which carries unresolved Bomb Tasks into the newly spawned battle without resetting their original server deadline. The patch and its regression test were mechanically checked here, but this environment has **no PostgreSQL** and the clean `npm ci` attempt timed out, so `npm run lint`, `npm run build`, the SQL migrations/tests, and the two-client concurrency check are **not claimed as executed here**. **Run the [verification checklist](#verification-checklist) before deploying** — that is what turns reviewed code into verified production behavior.

## Contents

- [Tech stack](#tech-stack)
- [Architecture](#architecture)
- [Local setup](#local-setup)
- [Environment variables](#environment-variables)
- [Supabase setup](#supabase-setup)
- [Development commands](#development-commands)
- [Game rules](#game-rules)
- [Security model](#security-model)
- [Realtime](#realtime)
- [Verification checklist](#verification-checklist)
- [Deployment](#deployment)
- [Design decisions and known limits](#design-decisions-and-known-limits)
- [Project structure](#project-structure)

## Tech stack

Next.js 15 (App Router, Server Actions) · React 19 · TypeScript (strict, `noUncheckedIndexedAccess`) · Tailwind CSS · Supabase (Postgres, Auth, Realtime) · Radix UI primitives · Framer Motion · Lucide icons.

## Architecture

```
Browser ──► Next.js Server Actions ──► Supabase (anon key + the user's JWT)
   ▲                                        │
   │                                        ▼
   └──── Realtime (postgres_changes) ◄── Postgres: RLS + SECURITY DEFINER functions
```

- **The database is the game server.** Game-changing operations are `SECURITY DEFINER` Postgres functions (`complete_task`, `complete_duel_task`, `create_bomb_task`, `resolve_bomb_task`, `claim_loot`, `activate_powerup`, `finish_weekly_battle`, …). They read the caller from `auth.uid()`, lock the rows they touch, validate, apply every state change in one transaction and write the activity/notification rows in the same transaction.
- **Clients cannot write game state.** Tables like `weekly_battles`, `profiles` (XP/damage), `powerups`, `user_loot`, `duels`, `activity_feed`, `notifications` have no client write grants. Clients may only insert/update/delete ordinary tasks, within RLS and trigger limits.
- **Server Actions** (`lib/actions/*`) resolve identity from the verified session, validate input for friendly errors, call the RPC, and map errors through `lib/errors.ts` so raw database messages never reach users. They never accept a user id from the client.
- **Realtime is an optimisation, not the source of truth.** The UI re-reads from the database after every (re)connect and when the tab regains focus.
- **One source of truth for numbers.** `public.game_config` (migration 0007) holds every rule value; all game functions read it via `game_setting()`. `config/gameConfig.ts` is the UI's mirror, and the dashboard logs any drift between the two on load.

### Lock order (why concurrent actions can't deadlock or double-apply)

| Function | Locks, in order |
|---|---|
| `complete_task`, `resolve_bomb_task` | task → battle → (via `finish_weekly_battle`: duels → duel tasks) |
| `complete_duel_task` | battle → duel → task |
| `check_overdue_tasks` | battle → tasks (`FOR UPDATE SKIP LOCKED`, never waits on a task) |
| `finish_weekly_battle` | battle → duels → tasks |

## Local setup

Prerequisites: Node.js 20+, a Supabase project (or the Supabase CLI for a local one).

```bash
npm ci
cp .env.example .env.local      # then fill in the two values
# apply the database migrations (see "Supabase setup")
npm run dev                     # http://localhost:3000
```

## Environment variables

| Variable | Where | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | browser + server | Your project URL (Project Settings → API) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | browser + server | The **anon/public** key |

That is all the app reads (`lib/env.ts`); if either is missing it fails immediately with a message naming the variable. The app **never** needs — and the code never reads — the Supabase `service_role` key. Do not put it in any `NEXT_PUBLIC_` variable or commit it. `.env` and `.env*.local` are git-ignored.

## Supabase setup

1. **Create a project**, then apply the migrations **in order** with either the CLI (`supabase link` → `supabase db push`) or by pasting each file into the SQL editor:

   | File | What it does |
   |---|---|
   | `0001_init.sql` | Schema, RLS, core game functions, seed bosses/badges/loot |
   | `0002_loot_tasks.sql` | Loot task creation |
   | `0003_loot_reveal_data.sql` | Loot rewards + rarity |
   | `0004_lock_down_internal_functions.sql` | Removes API access to internal functions |
   | `0005_protect_bombs_and_duels.sql` | Blocks tampering with bomb/duel tasks |
   | `0006_powerup_effects.sql` | Double XP, Team Shield |
   | `0007_hardening_core.sql` | `game_config`, `server_now()`, integrity triggers, notifications, profile recovery, immutable history |
   | `0008_game_logic_v2.sql` | Rewritten game functions (lock order, badges, invites, history, notifications) |
   | `0009_realtime_auth_and_cron.sql` | Guild-scoped presence policies; optional pg_cron schedule (both guarded) |
   | `0010_bomb_battle_rollover.sql` | Carries unresolved Bomb Tasks into the next active battle without resetting their deadlines |

   Never edit an applied migration — add a new one.

2. **Auth**: Authentication → URL Configuration → set *Site URL* to your deployed origin and add `http://localhost:3000/auth/callback` and `https://<your-domain>/auth/callback` to *Redirect URLs*. If *Confirm email* is enabled, signup shows "check your email" and the link returns through `/auth/callback`.
3. **Realtime**: the migrations add the needed tables to the `supabase_realtime` publication. Presence uses **Realtime Authorization** (private channels): migration `0009` creates the policies on `realtime.messages`. If your platform role can't, it logs a warning and the Guild page shows everyone offline (with a console message) until you create them.
4. **Optional — pg_cron**: enable the `pg_cron` extension (Database → Extensions) and re-run the second block of `0009`. It calls `run_guild_maintenance()` every minute so expired bombs, overdue penalties and weekly deadlines resolve even with no one online. Without it the same checks run (against the database clock) whenever a member has the app open and on every page load.
5. **Confirm lock-down**: `supabase/audit_function_privileges.sql` lists which functions the API roles can execute; `0008` also asserts this itself and aborts if an internal function is exposed.

## Development commands

```bash
npm run dev         # dev server
npm run lint        # ESLint (next/core-web-vitals + next/typescript); also enforced by `next build`
npm run typecheck   # tsc --noEmit
npm run build       # production build (type-checks and lints)
npm run start       # serve the production build
```

## Game rules

| Rule | Value (source: `public.game_config`) |
|---|---|
| Damage / task points | Low 10 · Medium 25 · High 60 (priority always equals difficulty) |
| Boss HP | 1000 per weekly boss · Team HP 500 |
| Overdue task | Boss heals +20 HP, team loses 25 HP — **once per task** (`penalized_at`) |
| Bomb task | Must be completed within 30 min of creation (server clock). Explodes once: team −50 HP. A Team Shield absorbs it |
| Duel | Both players get a task; the **first valid completion wins** double XP; loser gets 0; exactly one winner |
| Loot task | Always High priority. Reward rolled and stored server-side, once, on completion; reveal state persisted |
| Double XP | ×2 XP for 60 min; the expiry timestamp is set by the database on activation |
| Boss defeated | +500 guild XP, +100 XP for every member, history entry, Slayer badge for those who fought, new boss |
| Week end | Sunday 23:59:59 UTC. Unfinished normal, Loot, and Bomb tasks carry over to the next battle |
| Assignment | An assigned task can only be completed by its assignee; an unassigned one by any member |
| Editing | Creator, assignee, guild leader (or anyone, if unassigned) may edit/move an open task; creator or leader may delete ordinary tasks. Bomb and duel tasks can't be edited or deleted |

To change a number: `update public.game_config set int_value = … where key = …;` **and** update `config/gameConfig.ts` (the dashboard warns in the server log if they disagree).

## Security model

- **RLS on every table.** Members read only their own guild's rows; clients have no write access to game tables. `game_config` is world-readable (not secret); `notifications`, `powerups`, `user_loot` are per-user.
- **Internal functions are unreachable from the API** (`0004`, re-asserted in `0008`); client RPCs are `authenticated`-only and check `auth.uid()` and guild membership themselves.
- **Anti-sabotage rules in the database**: past due dates rejected (a teammate can't spam overdue tasks to heal the boss), overdue tasks can't be rescheduled, assignees must be guild members, finished battles are immutable (escape hatch: `select set_config('taskslayer.allow_history_edit','on',true)` inside a transaction).
- **Invite codes**: 48 bits from a CSPRNG (`gen_random_uuid()`), unique, revocable; failed guesses are recorded and a user is locked out after 10 in 15 minutes.
- **Errors**: only messages raised deliberately by SQL (`P0001`) reach users; everything else is logged server-side and replaced with a generic message.
- **Open redirects**: `?next=` values are validated (`lib/safe-redirect.ts`).
- **Session**: server pages use `auth.getUser()` (verified with Auth, not a cookie's claims); a missing profile is repaired via `ensure_profile()`.

## Realtime

One channel per mounted board (`lib/realtime/useGuildLive.ts`) listens to battles, tasks, activity, battle events, members and duels for the caller's guild, plus an unfiltered task-`DELETE` listener (Supabase can't filter deletes; only the primary key is present, so it removes by id). Notifications and powerups have their own per-user channels. After every reconnect and whenever the tab becomes visible, the full state is re-read. Rows are de-duplicated by id, so duplicate events are harmless. `/dashboard`, `/tasks`, `/leaderboard` and `/guild` all update live.

## Verification checklist

Run these once, in a scratch project or local Supabase, before trusting a deployment:

```bash
npm ci && npm run lint && npm run typecheck && npm run build
supabase start && supabase db reset          # applies 0001–0010 to a local database
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/game_rules.sql   # expect: ALL GAME-RULE TESTS PASSED
```

Then follow `supabase/tests/concurrency/README.md` (two simultaneous duel completions → exactly one winner, no deadlock).

Manual two-browser check: sign up two accounts → A creates a guild → B joins with the invite code → A completes a task and B sees the boss HP, feed, leaderboard and board change without refreshing → refresh both and confirm nothing changed.

## Deployment

Any Node host that supports Next.js (Vercel, etc.): set the two environment variables, run `npm run build`, serve with `npm run start`. Apply migrations to the production database first, add the production origin to Supabase Auth redirect URLs, and (recommended) enable `pg_cron` as described above.

## Design decisions and known limits

- **Duels start immediately** (the opponent gets a task at once); there is no accept/decline step. A duel ends when someone finishes, when its battle ends, or when a participant leaves the guild (then it ends with no winner).
- **One guild per user** (`guild_members.user_id` is unique).
- **Leaderboard totals are lifetime** (per player), shown for the current guild's members.
- **Account deletion is not a supported flow.** Game history keeps foreign keys to profiles on purpose; deleting an auth user who has history is blocked by the database rather than rewriting history.
- **Profile editing** (display name, avatar upload) is not implemented; avatars render from an `https://` URL if one is set and fall back to an initial.
- **Two loot-steal transactions that target each other at the same instant** could still deadlock on profile row locks; Postgres aborts one with a retryable error and nothing is corrupted.
- **Time zone**: weekly deadlines are UTC. A task's due date means the end of the chosen day in the picker's own time zone.

## Project structure

```
app/                     routes (dashboard, tasks, guild, leaderboard, profile, battle-history, auth) + error/loading/404
components/              UI (battle, tasks, guild, loot, notifications, shared, ui primitives)
config/gameConfig.ts     UI mirror of the game numbers
lib/actions/             Server Actions (auth, guild, tasks, powerups, notifications)
lib/data/                server data loaders (session, guild, duels, config drift check)
lib/realtime/            useGuildLive, useLiveMembers
lib/hooks/               useServerClock (server-clock countdowns)
lib/errors.ts, env.ts, validation.ts, safe-redirect.ts
supabase/migrations/     0001–0010
supabase/tests/          game_rules.sql, concurrency/README.md
types/database.ts        shared types
```
