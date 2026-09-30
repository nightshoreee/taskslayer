-- ============================================================================
-- TASKSLAYER — 0007: hardening core
--
-- Additive migration. Run after 0006. Everything here is either new (tables,
-- helper functions) or a `create or replace` of a function whose signature is
-- unchanged, so it is safe on a project that already has data.
--
-- What this adds / fixes
--   1. game_config  — ONE place in the database for every game number
--      (damage, bomb duration/penalty, overdue regen, XP curve, ...). The game
--      functions in 0008 read from it through game_setting(); nothing there is
--      hard-coded any more. config/gameConfig.ts is the UI-side mirror and
--      the dashboard verifies the two agree (see lib/data/gameConfig.ts).
--   2. server_now() — lets the browser compute countdowns against the SERVER
--      clock (offset-corrected) instead of trusting the local clock.
--   3. next_sunday_end() — was implicitly cast from `timestamp` to
--      `timestamptz` using the SESSION time zone, so the weekly deadline
--      shifted on any database not set to UTC. Now explicitly UTC.
--   4. Task integrity trigger — closes a sabotage hole: any guild member could
--      insert tasks with a due date in the past and every one of them would
--      heal the boss +20 and cost the team 25 HP on the next overdue check.
--      Past due dates are now rejected, overdue tasks can't be rescheduled to
--      dodge the penalty, and assignees must belong to the guild.
--   5. Task edit policy — only the creator, the assignee, or the guild leader
--      (or anyone, for an unassigned task) may edit / move an open task.
--   6. Priority is forced to equal difficulty on insert, so the two columns
--      can never disagree (the README always claimed this; nothing enforced it).
--   7. Battle history immutability — a finalized battle can't be updated
--      except through a deliberate, explicit database-level switch.
--   8. notifications — persistent, per-user, RLS-scoped, realtime-published.
--   9. invite_attempts — backs the invite-code brute-force throttle (0008).
--  10. Profile recovery — handle_new_user() failed on a username collision
--      when the chosen name was longer than 13 characters (the fallback name
--      exceeded the 20-char check constraint), and there was no way to
--      recover an account whose profile row was missing. Fixed + ensure_profile().
--  11. user_loot.revealed_at and weekly_battles.finished_at.
--  12. Realtime publication now also covers powerups, user_loot, user_badges,
--      duel_participants and notifications.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. game_config
-- ----------------------------------------------------------------------------

create table if not exists public.game_config (
  key text primary key,
  int_value int not null check (int_value >= 0),
  description text not null default ''
);

alter table public.game_config enable row level security;

drop policy if exists "game config is public" on public.game_config;
create policy "game config is public" on public.game_config for select using (true);

revoke all on public.game_config from anon, authenticated;
grant select on public.game_config to anon, authenticated;

insert into public.game_config (key, int_value, description) values
  ('boss_max_hp',                 1000, 'HP of a freshly spawned weekly boss'),
  ('team_max_hp',                  500, 'Team HP at the start of each weekly battle'),
  ('damage_low',                    10, 'Damage / points for a LOW priority task'),
  ('damage_medium',                 25, 'Damage / points for a MEDIUM priority task'),
  ('damage_high',                   60, 'Damage / points for a HIGH priority task'),
  ('bomb_duration_minutes',         30, 'Minutes a bomb task has to be defused, from creation'),
  ('bomb_penalty_team_hp',          50, 'Team HP lost when a bomb explodes'),
  ('overdue_boss_regen',            20, 'Boss HP healed when a task becomes overdue'),
  ('overdue_team_damage',           25, 'Team HP lost when a task becomes overdue'),
  ('duel_reward_multiplier',         2, 'Winner of a duel earns this multiple of the task points'),
  ('xp_per_level',                1000, 'XP needed per level (level = floor(xp / this) + 1)'),
  ('battle_win_personal_xp',       100, 'XP every guild member earns when the boss is defeated'),
  ('battle_win_guild_xp',          500, 'Guild XP earned when the boss is defeated'),
  ('double_xp_multiplier',           2, 'XP multiplier while a Double XP power-up is active'),
  ('double_xp_minutes',             60, 'Duration of an activated Double XP power-up'),
  ('invite_max_failed_attempts',    10, 'Failed invite-code attempts allowed per window'),
  ('invite_attempt_window_minutes', 15, 'Window for counting failed invite-code attempts')
on conflict (key) do nothing;

create or replace function public.game_setting(p_key text)
returns int
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_value int;
begin
  select int_value into v_value from game_config where key = p_key;
  if v_value is null then
    raise exception 'Missing game_config key: %', p_key;
  end if;
  return v_value;
end;
$$;

revoke execute on function public.game_setting(text) from public;
grant execute on function public.game_setting(text) to anon, authenticated;

comment on column public.bosses.max_hp is
  'Informational catalog value. Battles snapshot their HP from game_config.boss_max_hp (see spawn_battle in 0008).';

-- ----------------------------------------------------------------------------
-- 2. Server clock
-- ----------------------------------------------------------------------------

create or replace function public.server_now()
returns timestamptz
language sql
volatile
as $$
  select clock_timestamp();
$$;

revoke execute on function public.server_now() from public, anon;
grant execute on function public.server_now() to authenticated;

-- ----------------------------------------------------------------------------
-- 3. Deterministic weekly deadline (Sunday 23:59:59 UTC)
-- ----------------------------------------------------------------------------

create or replace function public.next_sunday_end()
returns timestamptz
language sql
stable
as $$
  select (date_trunc('week', now() at time zone 'utc') + interval '6 days 23 hours 59 minutes 59 seconds') at time zone 'utc';
$$;

-- ----------------------------------------------------------------------------
-- 4. New columns (backfilled exactly once)
-- ----------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'user_loot' and column_name = 'revealed_at'
  ) then
    alter table public.user_loot add column revealed_at timestamptz;
    -- Everything claimed before this migration is treated as already seen.
    update public.user_loot set revealed_at = claimed_at;
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'weekly_battles' and column_name = 'finished_at'
  ) then
    alter table public.weekly_battles add column finished_at timestamptz;
    update public.weekly_battles set finished_at = least(ends_at, now()) where status <> 'active';
  end if;
end
$$;

-- ----------------------------------------------------------------------------
-- 5. Finalized battles are immutable
--    Deliberate escape hatch for an admin doing a manual correction:
--      select set_config('taskslayer.allow_history_edit', 'on', true);
--    (transaction-local) before the UPDATE.
-- ----------------------------------------------------------------------------

create or replace function public.guard_finalized_battle()
returns trigger
language plpgsql
as $$
begin
  if old.status <> 'active'
     and coalesce(current_setting('taskslayer.allow_history_edit', true), '') <> 'on' then
    raise exception 'A finished battle is part of the guild history and cannot be modified';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_finalized_battle on public.weekly_battles;
create trigger guard_finalized_battle
  before update on public.weekly_battles
  for each row execute function public.guard_finalized_battle();

revoke execute on function public.guard_finalized_battle() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 6. Notifications + invite throttle tables
-- ----------------------------------------------------------------------------

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  guild_id uuid references public.guilds(id) on delete cascade,
  type text not null check (char_length(type) between 1 and 40),
  title text not null check (char_length(title) between 1 and 200),
  body text check (body is null or char_length(body) <= 500),
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_created_idx
  on public.notifications (user_id, created_at desc);
create index if not exists notifications_user_unread_idx
  on public.notifications (user_id) where read_at is null;

alter table public.notifications enable row level security;

drop policy if exists "notifications visible to their recipient" on public.notifications;
create policy "notifications visible to their recipient" on public.notifications
  for select using (user_id = auth.uid());

revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;

create table if not exists public.invite_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  attempted_at timestamptz not null default now()
);

create index if not exists invite_attempts_user_idx on public.invite_attempts (user_id, attempted_at desc);

alter table public.invite_attempts enable row level security;
revoke all on public.invite_attempts from anon, authenticated;

create or replace function public.notify_user(
  p_user_id uuid, p_guild_id uuid, p_type text, p_title text,
  p_body text default null, p_payload jsonb default '{}'::jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null then
    return;
  end if;
  insert into notifications (user_id, guild_id, type, title, body, payload)
  values (p_user_id, p_guild_id, p_type, left(p_title, 200), left(p_body, 500), coalesce(p_payload, '{}'::jsonb));
end;
$$;

create or replace function public.notify_guild(
  p_guild_id uuid, p_exclude_user uuid, p_type text, p_title text,
  p_body text default null, p_payload jsonb default '{}'::jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into notifications (user_id, guild_id, type, title, body, payload)
  select gm.user_id, p_guild_id, p_type, left(p_title, 200), left(p_body, 500), coalesce(p_payload, '{}'::jsonb)
    from guild_members gm
   where gm.guild_id = p_guild_id
     and gm.user_id is distinct from p_exclude_user;
end;
$$;

revoke execute on function public.notify_user(uuid, uuid, text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.notify_guild(uuid, uuid, text, text, text, jsonb) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 7. Profiles: collision-safe creation + recovery
-- ----------------------------------------------------------------------------

create or replace function public.create_profile_for(p_id uuid, p_meta jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_username text := coalesce(p_meta ->> 'username', '');
  v_display text;
  v_avatar text := case when coalesce(p_meta ->> 'avatar_url', '') ~ '^https://' then p_meta ->> 'avatar_url' else null end;
begin
  if v_username !~ '^[a-zA-Z0-9_]{3,20}$' then
    v_username := 'slayer_' || substr(replace(p_id::text, '-', ''), 1, 8);
  end if;
  v_display := left(coalesce(nullif(trim(p_meta ->> 'display_name'), ''), v_username), 40);

  begin
    insert into profiles (id, username, display_name, avatar_url)
    values (p_id, v_username, v_display, v_avatar);
  exception when unique_violation then
    if exists (select 1 from profiles where id = p_id) then
      return; -- profile already exists; nothing to do
    end if;
    -- Username taken. Keep the result within the 20-character limit
    -- (13 + '_' + 6 = 20) — the previous fallback could exceed it and fail signup.
    insert into profiles (id, username, display_name, avatar_url)
    values (p_id, left(v_username, 13) || '_' || substr(replace(p_id::text, '-', ''), 1, 6), v_display, v_avatar);
  end;
end;
$$;

revoke execute on function public.create_profile_for(uuid, jsonb) from public, anon, authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.create_profile_for(new.id, coalesce(new.raw_user_meta_data, '{}'::jsonb));
  return new;
end;
$$;

create or replace function public.ensure_profile()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_meta jsonb;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if exists (select 1 from profiles where id = v_uid) then
    return v_uid;
  end if;

  select coalesce(raw_user_meta_data, '{}'::jsonb) into v_meta from auth.users where id = v_uid;
  if not found then
    raise exception 'This account no longer exists';
  end if;

  perform public.create_profile_for(v_uid, v_meta);
  return v_uid;
end;
$$;

-- ----------------------------------------------------------------------------
-- 8. XP curve from config
-- ----------------------------------------------------------------------------

create or replace function public.apply_level_up(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update profiles set level = (xp / public.game_setting('xp_per_level')) + 1 where id = p_user_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 9. Tasks: reward stamping, integrity guard, edit policy, assignment notice
-- ----------------------------------------------------------------------------

create or replace function public.set_task_reward()
returns trigger
language plpgsql
as $$
begin
  new.damage := public.game_setting('damage_' || new.difficulty::text);
  new.points := new.damage;
  -- One concept in the product: priority always equals difficulty.
  new.priority := new.difficulty::text::priority_level;
  return new;
end;
$$;

create or replace function public.guard_task_integrity()
returns trigger
language plpgsql
as $$
begin
  -- Internal game functions run as the table owner and are exempt (same
  -- pattern as guard_special_task_edits in 0005).
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.due_date is not null and new.due_date <= now() then
      raise exception 'Due date must be in the future';
    end if;
    if new.assigned_to is not null and not public.is_guild_member(new.guild_id, new.assigned_to) then
      raise exception 'Assignee is not a member of this guild';
    end if;
  else
    if new.due_date is distinct from old.due_date then
      if old.due_date is not null and old.due_date <= now() then
        raise exception 'An overdue task cannot be rescheduled';
      end if;
      if new.due_date is not null and new.due_date <= now() then
        raise exception 'Due date must be in the future';
      end if;
    end if;
    if new.assigned_to is distinct from old.assigned_to
       and new.assigned_to is not null
       and not public.is_guild_member(new.guild_id, new.assigned_to) then
      raise exception 'Assignee is not a member of this guild';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists guard_task_integrity on public.tasks;
create trigger guard_task_integrity
  before insert or update on public.tasks
  for each row execute function public.guard_task_integrity();

revoke execute on function public.guard_task_integrity() from public, anon, authenticated;

drop policy if exists "members can edit open task fields" on public.tasks;
drop policy if exists "owners and assignees can edit open task fields" on public.tasks;
create policy "owners and assignees can edit open task fields" on public.tasks
  for update
  using (
    status <> 'done'
    and public.is_guild_member(tasks.guild_id, auth.uid())
    and (
      creator_id = auth.uid()
      or assigned_to = auth.uid()
      or assigned_to is null
      or public.is_guild_leader(tasks.guild_id, auth.uid())
    )
  )
  with check (
    status in ('todo', 'doing')
    and public.is_guild_member(tasks.guild_id, auth.uid())
  );

create or replace function public.notify_task_assigned()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.assigned_to is not null
     and new.assigned_to is distinct from new.creator_id
     and new.task_type in ('normal', 'loot') then
    perform public.notify_user(
      new.assigned_to, new.guild_id, 'task_assigned', 'New task assigned', new.title,
      jsonb_build_object('task_id', new.id)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists notify_task_assigned on public.tasks;
create trigger notify_task_assigned
  after insert on public.tasks
  for each row execute function public.notify_task_assigned();

revoke execute on function public.notify_task_assigned() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 10. Realtime publication
-- ----------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['powerups', 'user_loot', 'user_badges', 'duel_participants', 'notifications'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception
      when duplicate_object then null;   -- already published
      when undefined_object then null;   -- not a Supabase database (no publication)
    end;
  end loop;
end
$$;
