-- ============================================================================
-- TASKSLAYER — initial schema
-- Paste this whole file into the Supabase SQL editor (or `supabase db push`)
-- on a fresh project and run it once. It is close to one-click: it creates
-- every table, enum, index, RLS policy, grant, trigger and function the app
-- needs, and seeds the boss/loot/badge catalogs. Nothing here needs the
-- dashboard UI — the SQL editor will report any error line-by-line if one
-- ever occurs.
--
-- Design principle used throughout: the `authenticated` role is only ever
-- GRANTed SELECT (plus a few narrow, explicitly-listed columns for INSERT/
-- UPDATE) on gameplay tables. Every state change that matters for fairness —
-- damage, XP, HP, duel outcomes, loot, badges — happens inside a
-- `security definer` function that re-checks authorization itself (RLS does
-- not apply inside a security definer function owned by the table owner),
-- so a client can never set its own damage, HP, or XP directly, no matter
-- what it sends over the wire.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- ENUMS
-- ----------------------------------------------------------------------------

create type difficulty_level as enum ('low', 'medium', 'high');
create type priority_level as enum ('low', 'medium', 'high');
create type task_status as enum ('todo', 'doing', 'done');
create type task_type as enum ('normal', 'duel', 'bomb', 'loot');
create type battle_status as enum ('active', 'won', 'lost');
create type guild_role as enum ('leader', 'member');
create type duel_status as enum ('active', 'completed', 'expired');
create type powerup_type as enum ('double_xp', 'boss_slayer', 'team_shield', 'heal');
create type battle_event_type as enum (
  'damage', 'duel_start', 'duel_win', 'bomb_created', 'bomb_defused', 'bomb_exploded',
  'boss_regen', 'team_damage', 'loot_found', 'battle_won', 'battle_lost', 'battle_started',
  'member_joined', 'powerup_activated'
);

-- ----------------------------------------------------------------------------
-- TABLES (created in dependency order — no forward references anywhere)
-- ----------------------------------------------------------------------------

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null check (username ~ '^[a-zA-Z0-9_]{3,20}$'),
  display_name text not null check (char_length(display_name) between 1 and 40),
  avatar_url text,
  level int not null default 1 check (level >= 1),
  xp int not null default 0 check (xp >= 0),
  total_damage int not null default 0 check (total_damage >= 0),
  tasks_completed int not null default 0 check (tasks_completed >= 0),
  duel_wins int not null default 0 check (duel_wins >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table guilds (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 50),
  description text,
  invite_code text unique not null,
  leader_id uuid not null references profiles(id),
  guild_xp int not null default 0 check (guild_xp >= 0),
  created_at timestamptz not null default now()
);

create table guild_members (
  id uuid primary key default gen_random_uuid(),
  guild_id uuid not null references guilds(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade unique, -- v1: one guild per user
  role guild_role not null default 'member',
  joined_at timestamptz not null default now()
);

create table guild_invites (
  id uuid primary key default gen_random_uuid(),
  guild_id uuid not null references guilds(id) on delete cascade,
  code text unique not null,
  created_by uuid not null references profiles(id),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table bosses (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,
  name text not null,
  title text not null,
  description text not null,
  flavor_text text not null,
  max_hp int not null default 1000 check (max_hp > 0),
  attack_style text not null
);

create table weekly_battles (
  id uuid primary key default gen_random_uuid(),
  guild_id uuid not null references guilds(id) on delete cascade,
  boss_id uuid not null references bosses(id),
  boss_hp int not null check (boss_hp >= 0),
  max_hp int not null check (max_hp > 0),
  team_hp int not null check (team_hp >= 0),
  max_team_hp int not null check (max_team_hp > 0),
  status battle_status not null default 'active',
  started_at timestamptz not null default now(),
  ends_at timestamptz not null,
  result_summary jsonb,
  created_at timestamptz not null default now(),
  check (boss_hp <= max_hp),
  check (team_hp <= max_team_hp)
);

-- Only one ACTIVE battle per guild at a time.
create unique index one_active_battle_per_guild on weekly_battles (guild_id) where status = 'active';

create table tasks (
  id uuid primary key default gen_random_uuid(),
  guild_id uuid not null references guilds(id) on delete cascade,
  battle_id uuid not null references weekly_battles(id) on delete cascade,
  creator_id uuid not null references profiles(id),
  assigned_to uuid references profiles(id),
  title text not null check (char_length(title) between 1 and 200),
  description text,
  difficulty difficulty_level not null default 'medium',
  priority priority_level not null default 'medium',
  status task_status not null default 'todo',
  task_type task_type not null default 'normal',
  due_date timestamptz,
  points int not null default 0,
  damage int not null default 0,
  completed_at timestamptz,
  completed_by uuid references profiles(id),
  bomb_expires_at timestamptz,
  bomb_result text check (bomb_result in ('defused', 'exploded')),
  penalized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (task_type <> 'bomb' or bomb_expires_at is not null),
  check (status <> 'done' or completed_at is not null)
);

create index tasks_battle_status_idx on tasks (battle_id, status);
create index tasks_guild_idx on tasks (guild_id);
create index tasks_bomb_pending_idx on tasks (bomb_expires_at) where task_type = 'bomb' and bomb_result is null;

create table duels (
  id uuid primary key default gen_random_uuid(),
  guild_id uuid not null references guilds(id) on delete cascade,
  battle_id uuid not null references weekly_battles(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  description text,
  created_by uuid not null references profiles(id),
  challenger_id uuid not null references profiles(id),
  opponent_id uuid not null references profiles(id),
  status duel_status not null default 'active',
  winner_id uuid references profiles(id),
  reward_points int not null default 0,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  check (challenger_id <> opponent_id)
);

create table duel_participants (
  id uuid primary key default gen_random_uuid(),
  duel_id uuid not null references duels(id) on delete cascade,
  user_id uuid not null references profiles(id),
  task_id uuid not null references tasks(id) on delete cascade unique,
  completed_at timestamptz,
  unique (duel_id, user_id)
);

create table loot_rewards (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,
  label text not null,
  description text not null,
  weight int not null check (weight > 0),
  effect_type text not null check (
    effect_type in ('xp_flat', 'double_xp_duration', 'shield', 'boss_damage_boost', 'team_heal', 'steal_xp')
  ),
  effect_value int not null default 0
);

create table user_loot (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id),
  guild_id uuid not null references guilds(id) on delete cascade,
  task_id uuid not null references tasks(id) on delete cascade unique, -- prevents re-rolling on refresh
  loot_reward_id uuid not null references loot_rewards(id),
  claimed_at timestamptz not null default now()
);

create table powerups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id),
  guild_id uuid not null references guilds(id) on delete cascade,
  type powerup_type not null,
  activated_at timestamptz,
  expires_at timestamptz,
  uses_remaining int not null default 1 check (uses_remaining >= 0),
  created_at timestamptz not null default now()
);

create table battle_events (
  id uuid primary key default gen_random_uuid(),
  guild_id uuid not null references guilds(id) on delete cascade,
  battle_id uuid references weekly_battles(id) on delete cascade,
  event_type battle_event_type not null,
  actor_id uuid references profiles(id),
  target_id uuid references profiles(id),
  amount int,
  message text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index battle_events_battle_idx on battle_events (battle_id, created_at desc);

create table activity_feed (
  id uuid primary key default gen_random_uuid(),
  guild_id uuid not null references guilds(id) on delete cascade,
  battle_id uuid references weekly_battles(id),
  user_id uuid references profiles(id),
  icon text not null default '⚔️',
  message text not null,
  created_at timestamptz not null default now()
);

create index activity_feed_guild_idx on activity_feed (guild_id, created_at desc);

create table badges (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,
  name text not null,
  description text not null,
  icon text not null,
  criteria_type text not null check (
    criteria_type in ('battles_won', 'duel_wins', 'bombs_defused', 'loot_found', 'total_damage', 'battles_participated')
  ),
  criteria_value int not null check (criteria_value > 0)
);

create table user_badges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id),
  badge_id uuid not null references badges(id),
  unlocked_at timestamptz not null default now(),
  unique (user_id, badge_id)
);

create index guild_members_guild_idx on guild_members (guild_id);

-- ----------------------------------------------------------------------------
-- SEED DATA — bosses, loot table, badges
-- ----------------------------------------------------------------------------

insert into bosses (key, name, title, description, flavor_text, max_hp, attack_style) values
  ('procrastination_dragon', 'Procrastination Dragon', 'Hoarder of Tomorrow',
   'A vast, slow-breathing dragon that grows fat on deferred work.',
   'It doesn''t attack. It waits. Every "later" feeds it.', 1000, 'Regenerates HP from overdue tasks'),
  ('deadline_demon', 'Deadline Demon', 'The Clock-Eater',
   'A wiry imp that lives inside countdown timers.',
   'It smiles wider the closer you get to midnight.', 1000, 'Strikes Team HP as deadlines pass'),
  ('assignment_titan', 'Assignment Titan', 'The Unmarked Mountain',
   'A titan built from every rubric nobody has read.',
   'Its weight is entirely paperwork.', 1000, 'Heavy, slow, but hard to knock down'),
  ('bug_hydra', 'Bug Hydra', 'The Regression Serpent',
   'Cut off one head and, somehow, the build still fails.',
   'Fix one thing. Watch two more wake up.', 1000, 'Splits damage requirements on missed fixes'),
  ('exam_overlord', 'Exam Overlord', 'Keeper of the Curve',
   'A crowned specter that feeds on cramming.',
   'It grades on a curve only it can see.', 1000, 'Surges power near deadline week'),
  ('distraction_phantom', 'Distraction Phantom', 'The Fourteen-Tabs Wraith',
   'Formless, flickering, always just out of focus.',
   'You only notice it after the hour is already gone.', 1000, 'Drains focus instead of dealing direct damage'),
  ('infinite_meeting', 'The Infinite Meeting', 'That Which Could Have Been an Email',
   'A recursive, self-scheduling horror with no agenda.',
   '"Quick sync" was its first lie.', 1000, 'Regenerates HP the longer the week drags on');

insert into loot_rewards (key, label, description, weight, effect_type, effect_value) values
  ('xp_50', '+50 XP', 'A small burst of experience.', 25, 'xp_flat', 50),
  ('xp_100', '+100 XP', 'A solid burst of experience.', 15, 'xp_flat', 100),
  ('double_xp_1h', 'Double XP (1 hour)', 'All XP you earn is doubled for the next hour.', 15, 'double_xp_duration', 60),
  ('shield', 'Team Shield', 'Blocks the next Boss attack against Team HP.', 15, 'shield', 0),
  ('boss_damage_boost', 'Boss Damage Boost', 'An immediate strike against the Boss.', 15, 'boss_damage_boost', 40),
  ('team_heal', 'Team Heal', 'Restores Team HP.', 10, 'team_heal', 50),
  ('steal_xp', 'XP Steal', 'Siphons XP from a random guildmate.', 5, 'steal_xp', 20);

insert into badges (key, name, description, icon, criteria_type, criteria_value) values
  ('slayer', 'Slayer', 'Defeat a weekly Boss.', '⚔️', 'battles_won', 1),
  ('duelist', 'Duelist', 'Win 5 Duels.', '🤺', 'duel_wins', 5),
  ('bomb_defuser', 'Bomb Defuser', 'Complete 10 Bomb Tasks.', '💣', 'bombs_defused', 10),
  ('loot_hunter', 'Loot Hunter', 'Discover 10 Loot rewards.', '🎁', 'loot_found', 10),
  ('damage_dealer', 'Damage Dealer', 'Deal 1000 total damage.', '💥', 'total_damage', 1000),
  ('week_warrior', 'Week Warrior', 'Participate in 4 weekly battles.', '🗓️', 'battles_participated', 4);

-- ----------------------------------------------------------------------------
-- HELPERS
-- ----------------------------------------------------------------------------

create or replace function public.next_sunday_end()
returns timestamptz
language sql
stable
as $$
  -- date_trunc('week', ...) is Monday 00:00 (ISO). +6d23h59m59s lands on
  -- Sunday 23:59:59, UTC. A guild-local timezone is a reasonable v2 upgrade.
  select date_trunc('week', now() at time zone 'utc') + interval '6 days 23 hours 59 minutes 59 seconds';
$$;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger trg_profiles_updated_at before update on profiles
  for each row execute function public.touch_updated_at();
create trigger trg_tasks_updated_at before update on tasks
  for each row execute function public.touch_updated_at();

-- Damage/points are ALWAYS derived server-side from difficulty, never from
-- whatever the client sends — this trigger overwrites them on every insert.
create or replace function public.set_task_reward()
returns trigger
language plpgsql
as $$
begin
  new.damage := case new.difficulty when 'low' then 10 when 'medium' then 25 else 60 end;
  new.points := new.damage;
  return new;
end;
$$;

create trigger trg_set_task_reward before insert on tasks
  for each row execute function public.set_task_reward();

-- Auto-create a profile row whenever a new auth user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_username text;
begin
  v_username := coalesce(new.raw_user_meta_data ->> 'username', 'slayer_' || substr(new.id::text, 1, 8));
  begin
    insert into public.profiles (id, username, display_name, avatar_url)
    values (
      new.id,
      v_username,
      coalesce(new.raw_user_meta_data ->> 'display_name', v_username),
      new.raw_user_meta_data ->> 'avatar_url'
    );
  exception when unique_violation then
    insert into public.profiles (id, username, display_name, avatar_url)
    values (
      new.id,
      v_username || '_' || substr(new.id::text, 1, 6),
      coalesce(new.raw_user_meta_data ->> 'display_name', v_username),
      new.raw_user_meta_data ->> 'avatar_url'
    );
  end;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.apply_level_up(p_user_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  update profiles set level = floor(xp / 1000) + 1 where id = p_user_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- RLS HELPER FUNCTIONS
--
-- A policy on guild_members that queries guild_members itself — even
-- indirectly — makes Postgres raise "infinite recursion detected in policy
-- for relation" (it cannot prove the self-reference terminates, so it
-- refuses outright). The fix used throughout this file: route every
-- membership check through a `security definer` function. Because such a
-- function runs as its owner (the table owner, by default), its internal
-- query bypasses RLS entirely instead of re-triggering policy evaluation,
-- which breaks the cycle. These are also just faster than a fresh subquery
-- everywhere, since they hit the table directly with no policy overhead.
-- ----------------------------------------------------------------------------

create or replace function public.is_guild_member(p_guild_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (select 1 from guild_members where guild_id = p_guild_id and user_id = p_user_id);
$$;

create or replace function public.is_guild_leader(p_guild_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (select 1 from guild_members where guild_id = p_guild_id and user_id = p_user_id and role = 'leader');
$$;

create or replace function public.shares_guild_with(p_other_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from guild_members gm1 join guild_members gm2 on gm1.guild_id = gm2.guild_id
     where gm1.user_id = auth.uid() and gm2.user_id = p_other_user_id
  );
$$;

-- ----------------------------------------------------------------------------
-- GUILD FUNCTIONS
-- ----------------------------------------------------------------------------

create or replace function public.create_guild(p_name text, p_description text default null)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_guild_id uuid;
  v_code text;
  v_boss_id uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if exists (select 1 from guild_members where user_id = v_uid) then
    raise exception 'You are already in a guild';
  end if;
  if p_name is null or length(trim(p_name)) < 2 then
    raise exception 'Guild name must be at least 2 characters';
  end if;

  loop
    v_code := upper(substr(md5(random()::text), 1, 4)) || '-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 4));
    exit when not exists (select 1 from guilds where invite_code = v_code);
  end loop;

  insert into guilds (name, description, invite_code, leader_id)
  values (trim(p_name), nullif(trim(coalesce(p_description, '')), ''), v_code, v_uid)
  returning id into v_guild_id;

  insert into guild_members (guild_id, user_id, role) values (v_guild_id, v_uid, 'leader');
  insert into guild_invites (guild_id, code, created_by) values (v_guild_id, v_code, v_uid);

  select id into v_boss_id from bosses order by random() limit 1;
  insert into weekly_battles (guild_id, boss_id, boss_hp, max_hp, team_hp, max_team_hp, ends_at)
  select v_guild_id, v_boss_id, b.max_hp, b.max_hp, 500, 500, public.next_sunday_end()
  from bosses b where b.id = v_boss_id;

  insert into activity_feed (guild_id, user_id, icon, message)
  values (v_guild_id, v_uid, '🏰', (select display_name from profiles where id = v_uid) || ' founded the guild');

  return v_guild_id;
end;
$$;

create or replace function public.join_guild(p_invite_code text)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_guild_id uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if exists (select 1 from guild_members where user_id = v_uid) then
    raise exception 'You are already in a guild';
  end if;

  select guild_id into v_guild_id from guild_invites
   where code = upper(trim(p_invite_code)) and is_active;

  if v_guild_id is null then
    raise exception 'Invalid or inactive invite code';
  end if;

  insert into guild_members (guild_id, user_id, role) values (v_guild_id, v_uid, 'member');

  insert into activity_feed (guild_id, user_id, icon, message)
  values (v_guild_id, v_uid, '🎉', (select display_name from profiles where id = v_uid) || ' joined the guild');

  return v_guild_id;
end;
$$;

create or replace function public.regenerate_invite_code(p_guild_id uuid)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_code text;
begin
  if not exists (select 1 from guild_members where guild_id = p_guild_id and user_id = v_uid and role = 'leader') then
    raise exception 'Only the guild leader can regenerate the invite code';
  end if;

  update guild_invites set is_active = false, revoked_at = now()
   where guild_id = p_guild_id and is_active;

  loop
    v_code := upper(substr(md5(random()::text), 1, 4)) || '-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 4));
    exit when not exists (select 1 from guilds where invite_code = v_code);
  end loop;

  insert into guild_invites (guild_id, code, created_by) values (p_guild_id, v_code, v_uid);
  update guilds set invite_code = v_code where id = p_guild_id;

  return v_code;
end;
$$;

create or replace function public.remove_guild_member(p_guild_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not exists (select 1 from guild_members where guild_id = p_guild_id and user_id = v_uid and role = 'leader') then
    raise exception 'Only the guild leader can remove members';
  end if;
  if p_user_id = v_uid then
    raise exception 'The leader cannot remove themselves';
  end if;

  delete from guild_members where guild_id = p_guild_id and user_id = p_user_id;

  insert into activity_feed (guild_id, icon, message)
  values (p_guild_id, '👋', (select display_name from profiles where id = p_user_id) || ' was removed from the guild');
end;
$$;

create or replace function public.leave_guild()
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_guild_id uuid;
  v_role guild_role;
  v_member_count int;
begin
  select gm.guild_id, gm.role into v_guild_id, v_role from guild_members gm where gm.user_id = v_uid;
  if v_guild_id is null then
    raise exception 'You are not in a guild';
  end if;

  select count(*) into v_member_count from guild_members where guild_id = v_guild_id;

  if v_role = 'leader' and v_member_count > 1 then
    raise exception 'Transfer leadership or remove all other members before leaving';
  end if;

  delete from guild_members where user_id = v_uid;

  if v_role = 'leader' then
    delete from guilds where id = v_guild_id; -- last member leaving disbands the guild
  else
    insert into activity_feed (guild_id, icon, message)
    values (v_guild_id, '👋', (select display_name from profiles where id = v_uid) || ' left the guild');
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- BATTLE LIFECYCLE
-- ----------------------------------------------------------------------------

create or replace function public.start_new_weekly_battle(p_guild_id uuid)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_boss_id uuid;
  v_battle_id uuid;
begin
  if v_uid is not null and not exists (select 1 from guild_members where guild_id = p_guild_id and user_id = v_uid) then
    raise exception 'You are not a member of this guild';
  end if;
  if exists (select 1 from weekly_battles where guild_id = p_guild_id and status = 'active') then
    return null;
  end if;

  select id into v_boss_id from bosses order by random() limit 1;
  insert into weekly_battles (guild_id, boss_id, boss_hp, max_hp, team_hp, max_team_hp, ends_at)
  select p_guild_id, v_boss_id, b.max_hp, b.max_hp, 500, 500, public.next_sunday_end()
  from bosses b where b.id = v_boss_id
  returning id into v_battle_id;

  insert into activity_feed (guild_id, battle_id, icon, message)
  values (p_guild_id, v_battle_id, '👹', 'A new boss has appeared!');

  return v_battle_id;
end;
$$;

create or replace function public.finish_weekly_battle(p_battle_id uuid, p_result text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_battle weekly_battles%rowtype;
  v_guild_id uuid;
  v_top record;
  v_member record;
begin
  select * into v_battle from weekly_battles where id = p_battle_id and status = 'active' for update;
  if not found then
    return;
  end if;

  v_guild_id := v_battle.guild_id;

  select p.id, p.display_name, coalesce(sum(be.amount), 0) as dmg
    into v_top
    from battle_events be
    join profiles p on p.id = be.actor_id
   where be.battle_id = p_battle_id and be.event_type = 'damage'
   group by p.id, p.display_name
   order by dmg desc
   limit 1;

  update weekly_battles
     set status = case when p_result = 'won' then 'won' else 'lost' end::battle_status,
         result_summary = jsonb_build_object(
           'top_damage_user_id', v_top.id,
           'top_damage_name', v_top.display_name,
           'top_damage', coalesce(v_top.dmg, 0)
         )
   where id = p_battle_id;

  if p_result = 'won' then
    update guilds set guild_xp = guild_xp + 500 where id = v_guild_id;
    update profiles set xp = xp + 100 where id in (select user_id from guild_members where guild_id = v_guild_id);

    for v_member in select user_id from guild_members where guild_id = v_guild_id loop
      perform public.apply_level_up(v_member.user_id);
    end loop;

    insert into activity_feed (guild_id, battle_id, icon, message)
    values (v_guild_id, p_battle_id, '🏆', 'BOSS SLAIN — the guild is victorious! +500 Guild XP, +100 Personal XP each');
    insert into battle_events (guild_id, battle_id, event_type, message)
    values (v_guild_id, p_battle_id, 'battle_won', 'The guild defeated the boss');
  else
    insert into activity_feed (guild_id, battle_id, icon, message)
    values (v_guild_id, p_battle_id, '💀', 'The boss survived the week. The guild endures, but did not conquer.');
    insert into battle_events (guild_id, battle_id, event_type, message)
    values (v_guild_id, p_battle_id, 'battle_lost', 'The boss survived the deadline');
  end if;

  perform public.start_new_weekly_battle(v_guild_id);
end;
$$;

create or replace function public.check_battle_deadline(p_guild_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_battle_id uuid;
begin
  select id into v_battle_id from weekly_battles
   where guild_id = p_guild_id and status = 'active' and ends_at < now();
  if v_battle_id is not null then
    perform public.finish_weekly_battle(v_battle_id, 'lost');
  end if;
end;
$$;

create or replace function public.check_overdue_tasks(p_guild_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_battle weekly_battles%rowtype;
  r record;
  v_regen constant int := 20;
  v_dmg constant int := 25;
begin
  select * into v_battle from weekly_battles where guild_id = p_guild_id and status = 'active' for update;
  if not found then
    return;
  end if;

  for r in
    select * from tasks
     where guild_id = p_guild_id and battle_id = v_battle.id
       and status <> 'done' and task_type = 'normal'
       and due_date is not null and due_date < now() and penalized_at is null
     for update
  loop
    update tasks set penalized_at = now() where id = r.id;
    v_battle.boss_hp := least(v_battle.max_hp, v_battle.boss_hp + v_regen);
    v_battle.team_hp := greatest(0, v_battle.team_hp - v_dmg);

    insert into battle_events (guild_id, battle_id, event_type, amount, message)
    values (p_guild_id, v_battle.id, 'boss_regen', v_regen, 'Boss regenerated ' || v_regen || ' HP — "' || r.title || '" became overdue');
    insert into activity_feed (guild_id, battle_id, icon, message)
    values (p_guild_id, v_battle.id, '💀', 'BOSS REGENERATED ' || v_regen || ' HP — "' || r.title || '" became overdue');
  end loop;

  update weekly_battles set boss_hp = v_battle.boss_hp, team_hp = v_battle.team_hp where id = v_battle.id;

  if v_battle.team_hp <= 0 then
    perform public.finish_weekly_battle(v_battle.id, 'lost');
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- BADGES
-- ----------------------------------------------------------------------------

create or replace function public.evaluate_badges(p_user_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_profile profiles%rowtype;
  v_badge badges%rowtype;
  v_won_count int;
  v_bomb_count int;
  v_loot_count int;
  v_participated int;
begin
  select * into v_profile from profiles where id = p_user_id;

  select count(*) into v_won_count from weekly_battles wb
    join guild_members gm on gm.guild_id = wb.guild_id
   where gm.user_id = p_user_id and wb.status = 'won';

  select count(*) into v_bomb_count from tasks
   where completed_by = p_user_id and task_type = 'bomb' and bomb_result = 'defused';

  select count(*) into v_loot_count from user_loot where user_id = p_user_id;

  select count(distinct battle_id) into v_participated from battle_events where actor_id = p_user_id;

  for v_badge in select * from badges loop
    if exists (select 1 from user_badges where user_id = p_user_id and badge_id = v_badge.id) then
      continue;
    end if;

    if (v_badge.criteria_type = 'total_damage' and v_profile.total_damage >= v_badge.criteria_value)
      or (v_badge.criteria_type = 'duel_wins' and v_profile.duel_wins >= v_badge.criteria_value)
      or (v_badge.criteria_type = 'battles_won' and v_won_count >= v_badge.criteria_value)
      or (v_badge.criteria_type = 'bombs_defused' and v_bomb_count >= v_badge.criteria_value)
      or (v_badge.criteria_type = 'loot_found' and v_loot_count >= v_badge.criteria_value)
      or (v_badge.criteria_type = 'battles_participated' and v_participated >= v_badge.criteria_value)
    then
      insert into user_badges (user_id, badge_id) values (p_user_id, v_badge.id) on conflict do nothing;

      insert into activity_feed (guild_id, user_id, icon, message)
      select gm.guild_id, p_user_id, '🏅', (select display_name from profiles where id = p_user_id) || ' unlocked the "' || v_badge.name || '" badge'
      from guild_members gm where gm.user_id = p_user_id;
    end if;
  end loop;
end;
$$;

-- ----------------------------------------------------------------------------
-- LOOT
-- ----------------------------------------------------------------------------

create or replace function public.claim_loot(p_task_id uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_task tasks%rowtype;
  v_reward loot_rewards%rowtype;
  v_total_weight int;
  v_uid uuid;
begin
  select * into v_task from tasks where id = p_task_id;
  v_uid := v_task.completed_by;

  if exists (select 1 from user_loot where task_id = p_task_id) then
    select lr.* into v_reward from user_loot ul join loot_rewards lr on lr.id = ul.loot_reward_id where ul.task_id = p_task_id;
    return jsonb_build_object('key', v_reward.key, 'label', v_reward.label, 'already_claimed', true);
  end if;

  select sum(weight) into v_total_weight from loot_rewards;

  select t.* into v_reward from (
    select lr.*, sum(lr.weight) over (order by lr.key) as cum_weight
    from loot_rewards lr
  ) t
  where t.cum_weight >= (random() * v_total_weight)
  order by t.cum_weight asc
  limit 1;

  insert into user_loot (user_id, guild_id, task_id, loot_reward_id) values (v_uid, v_task.guild_id, p_task_id, v_reward.id);

  if v_reward.effect_type = 'xp_flat' then
    update profiles set xp = xp + v_reward.effect_value where id = v_uid;
    perform public.apply_level_up(v_uid);
  elsif v_reward.effect_type = 'team_heal' then
    update weekly_battles set team_hp = least(max_team_hp, team_hp + v_reward.effect_value) where id = v_task.battle_id;
  elsif v_reward.effect_type = 'boss_damage_boost' then
    update weekly_battles set boss_hp = greatest(0, boss_hp - v_reward.effect_value) where id = v_task.battle_id;
  elsif v_reward.effect_type = 'double_xp_duration' then
    insert into powerups (user_id, guild_id, type, activated_at, expires_at, uses_remaining)
    values (v_uid, v_task.guild_id, 'double_xp', now(), now() + make_interval(mins => v_reward.effect_value), 1);
  elsif v_reward.effect_type = 'shield' then
    insert into powerups (user_id, guild_id, type, uses_remaining)
    values (v_uid, v_task.guild_id, 'team_shield', 1);
  elsif v_reward.effect_type = 'steal_xp' then
    update profiles set xp = greatest(0, xp - v_reward.effect_value)
     where id = (
       select user_id from guild_members
        where guild_id = v_task.guild_id and user_id <> v_uid
        order by random() limit 1
     );
    update profiles set xp = xp + v_reward.effect_value where id = v_uid;
  end if;

  insert into activity_feed (guild_id, battle_id, user_id, icon, message)
  values (v_task.guild_id, v_task.battle_id, v_uid, '🎁', (select display_name from profiles where id = v_uid) || ' found loot: ' || v_reward.label);

  return jsonb_build_object('key', v_reward.key, 'label', v_reward.label, 'already_claimed', false);
end;
$$;

create or replace function public.activate_powerup(p_powerup_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_pu powerups%rowtype;
begin
  select * into v_pu from powerups where id = p_powerup_id and user_id = v_uid for update;
  if not found then
    raise exception 'Power-up not found';
  end if;
  if v_pu.activated_at is not null then
    raise exception 'This power-up is already active';
  end if;

  update powerups
     set activated_at = now(),
         expires_at = case v_pu.type when 'double_xp' then now() + interval '1 hour' else null end
   where id = p_powerup_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- CORE LOOP: complete a normal task (atomic, authoritative)
-- ----------------------------------------------------------------------------

create or replace function public.complete_task(p_task_id uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_task tasks%rowtype;
  v_battle weekly_battles%rowtype;
  v_new_hp int;
  v_boss_defeated boolean := false;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_task from tasks where id = p_task_id for update;
  if not found then
    raise exception 'Task not found';
  end if;
  if not exists (select 1 from guild_members where guild_id = v_task.guild_id and user_id = v_uid) then
    raise exception 'You are not a member of this guild';
  end if;
  if v_task.status = 'done' then
    raise exception 'This task has already been completed';
  end if;
  if v_task.task_type = 'duel' then
    raise exception 'Use complete_duel_task for duel tasks';
  end if;
  if v_task.task_type = 'bomb' and v_task.bomb_expires_at < now() then
    raise exception 'This bomb has already expired';
  end if;

  select * into v_battle from weekly_battles where id = v_task.battle_id for update;
  if v_battle.status <> 'active' then
    raise exception 'This battle has already ended';
  end if;

  update tasks set status = 'done', completed_at = now(), completed_by = v_uid where id = p_task_id;

  v_new_hp := greatest(0, v_battle.boss_hp - v_task.damage);
  update weekly_battles set boss_hp = v_new_hp where id = v_battle.id;

  update profiles
     set xp = xp + v_task.points,
         total_damage = total_damage + v_task.damage,
         tasks_completed = tasks_completed + 1
   where id = v_uid;
  perform public.apply_level_up(v_uid);

  insert into battle_events (guild_id, battle_id, event_type, actor_id, amount, message)
  values (v_task.guild_id, v_battle.id, 'damage', v_uid, v_task.damage,
    (select display_name from profiles where id = v_uid) || ' dealt ' || v_task.damage || ' damage with "' || v_task.title || '"');
  insert into activity_feed (guild_id, battle_id, user_id, icon, message)
  values (v_task.guild_id, v_battle.id, v_uid, '⚔️',
    (select display_name from profiles where id = v_uid) || ' dealt ' || v_task.damage || ' damage with "' || v_task.title || '"');

  if v_task.task_type = 'bomb' then
    update tasks set bomb_result = 'defused' where id = p_task_id;
    insert into activity_feed (guild_id, battle_id, user_id, icon, message)
    values (v_task.guild_id, v_battle.id, v_uid, '💥', 'Bomb defused: "' || v_task.title || '"');
  end if;

  if v_task.task_type = 'loot' then
    perform public.claim_loot(p_task_id);
  end if;

  perform public.evaluate_badges(v_uid);

  if v_new_hp <= 0 then
    perform public.finish_weekly_battle(v_battle.id, 'won');
    v_boss_defeated := true;
  end if;

  return jsonb_build_object('damage', v_task.damage, 'boss_hp', v_new_hp, 'boss_defeated', v_boss_defeated);
end;
$$;

-- ----------------------------------------------------------------------------
-- BOMB TASKS
-- ----------------------------------------------------------------------------

create or replace function public.create_bomb_task(
  p_guild_id uuid, p_title text, p_description text, p_assigned_to uuid, p_difficulty difficulty_level default 'medium'
) returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_battle_id uuid;
  v_task_id uuid;
begin
  if not exists (select 1 from guild_members where guild_id = p_guild_id and user_id = v_uid) then
    raise exception 'You are not a member of this guild';
  end if;
  select id into v_battle_id from weekly_battles where guild_id = p_guild_id and status = 'active';
  if v_battle_id is null then
    raise exception 'No active battle for this guild';
  end if;

  insert into tasks (guild_id, battle_id, creator_id, assigned_to, title, description, difficulty, status, task_type, bomb_expires_at)
  values (p_guild_id, v_battle_id, v_uid, p_assigned_to, p_title, p_description, p_difficulty, 'todo', 'bomb', now() + interval '30 minutes')
  returning id into v_task_id;

  insert into activity_feed (guild_id, battle_id, user_id, icon, message)
  values (p_guild_id, v_battle_id, v_uid, '💣', (select display_name from profiles where id = v_uid) || ' planted a bomb task: "' || p_title || '"');

  return v_task_id;
end;
$$;

create or replace function public.resolve_bomb_task(p_task_id uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_task tasks%rowtype;
  v_battle weekly_battles%rowtype;
  v_new_team_hp int;
begin
  select * into v_task from tasks where id = p_task_id for update;
  if not found or v_task.task_type <> 'bomb' then
    raise exception 'Not a bomb task';
  end if;
  if v_task.bomb_result is not null then
    return jsonb_build_object('already_resolved', true, 'result', v_task.bomb_result);
  end if;
  if v_task.status = 'done' then
    return jsonb_build_object('already_resolved', true, 'result', 'defused');
  end if;
  if v_task.bomb_expires_at > now() then
    return jsonb_build_object('expired', false);
  end if;

  select * into v_battle from weekly_battles where id = v_task.battle_id for update;
  update tasks set bomb_result = 'exploded', status = 'done', completed_at = now() where id = p_task_id;

  if v_battle.status = 'active' then
    v_new_team_hp := greatest(0, v_battle.team_hp - 50);
    update weekly_battles set team_hp = v_new_team_hp where id = v_battle.id;

    insert into battle_events (guild_id, battle_id, event_type, amount, message)
    values (v_task.guild_id, v_battle.id, 'bomb_exploded', 50, 'Bomb exploded: "' || v_task.title || '"');
    insert into activity_feed (guild_id, battle_id, icon, message)
    values (v_task.guild_id, v_battle.id, '💣', 'BOMB EXPLODED — "' || v_task.title || '" — Team HP -50');

    if v_new_team_hp <= 0 then
      perform public.finish_weekly_battle(v_battle.id, 'lost');
    end if;
  end if;

  return jsonb_build_object('expired', true, 'result', 'exploded');
end;
$$;

-- ----------------------------------------------------------------------------
-- DUELS
-- ----------------------------------------------------------------------------

create or replace function public.create_duel_task(
  p_guild_id uuid, p_opponent_id uuid, p_title text, p_description text, p_difficulty difficulty_level default 'medium'
) returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_battle_id uuid;
  v_duel_id uuid;
  v_reward int;
  v_task1 uuid;
  v_task2 uuid;
begin
  if v_uid = p_opponent_id then
    raise exception 'You cannot duel yourself';
  end if;
  if not exists (select 1 from guild_members where guild_id = p_guild_id and user_id = v_uid) then
    raise exception 'You are not a member of this guild';
  end if;
  if not exists (select 1 from guild_members where guild_id = p_guild_id and user_id = p_opponent_id) then
    raise exception 'Opponent is not a member of this guild';
  end if;
  select id into v_battle_id from weekly_battles where guild_id = p_guild_id and status = 'active';
  if v_battle_id is null then
    raise exception 'No active battle for this guild';
  end if;

  v_reward := (case p_difficulty when 'low' then 10 when 'medium' then 25 else 60 end) * 2;

  insert into duels (guild_id, battle_id, title, description, created_by, challenger_id, opponent_id, reward_points)
  values (p_guild_id, v_battle_id, p_title, p_description, v_uid, v_uid, p_opponent_id, v_reward)
  returning id into v_duel_id;

  insert into tasks (guild_id, battle_id, creator_id, assigned_to, title, description, difficulty, status, task_type)
  values (p_guild_id, v_battle_id, v_uid, v_uid, p_title, p_description, p_difficulty, 'todo', 'duel')
  returning id into v_task1;
  insert into duel_participants (duel_id, user_id, task_id) values (v_duel_id, v_uid, v_task1);

  insert into tasks (guild_id, battle_id, creator_id, assigned_to, title, description, difficulty, status, task_type)
  values (p_guild_id, v_battle_id, v_uid, p_opponent_id, p_title, p_description, p_difficulty, 'todo', 'duel')
  returning id into v_task2;
  insert into duel_participants (duel_id, user_id, task_id) values (v_duel_id, p_opponent_id, v_task2);

  insert into activity_feed (guild_id, battle_id, user_id, icon, message)
  values (p_guild_id, v_battle_id, v_uid, '⚔️',
    (select display_name from profiles where id = v_uid) || ' challenged ' || (select display_name from profiles where id = p_opponent_id) || ' to a duel: "' || p_title || '"');

  return v_duel_id;
end;
$$;

create or replace function public.complete_duel_task(p_task_id uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_task tasks%rowtype;
  v_dp duel_participants%rowtype;
  v_duel duels%rowtype;
begin
  select * into v_task from tasks where id = p_task_id for update;
  if not found or v_task.task_type <> 'duel' then
    raise exception 'Not a duel task';
  end if;
  if v_task.status = 'done' then
    raise exception 'This task has already been completed';
  end if;

  select * into v_dp from duel_participants where task_id = p_task_id for update;
  if v_dp.user_id <> v_uid then
    raise exception 'This is not your duel task';
  end if;

  select * into v_duel from duels where id = v_dp.duel_id for update;
  if v_duel.status <> 'active' then
    raise exception 'The duel has already ended';
  end if;

  update tasks set status = 'done', completed_at = now(), completed_by = v_uid where id = p_task_id;
  update duel_participants set completed_at = now() where id = v_dp.id;
  update duels set status = 'completed', winner_id = v_uid, completed_at = now() where id = v_duel.id;

  update profiles set xp = xp + v_duel.reward_points, duel_wins = duel_wins + 1, tasks_completed = tasks_completed + 1
   where id = v_uid;
  perform public.apply_level_up(v_uid);

  -- lock the loser's task so it can no longer be completed for a reward.
  -- completed_at is set (satisfying the "done tasks have a completion time"
  -- check constraint) but completed_by stays null — that's how the UI tells
  -- "closed because the duel was lost" apart from an actual completion.
  update tasks set status = 'done', completed_at = now()
   where id in (select task_id from duel_participants where duel_id = v_duel.id and user_id <> v_uid)
     and status <> 'done';

  insert into battle_events (guild_id, battle_id, event_type, actor_id, amount, message)
  values (v_task.guild_id, v_task.battle_id, 'duel_win', v_uid, v_duel.reward_points,
    (select display_name from profiles where id = v_uid) || ' won the duel: "' || v_duel.title || '"');
  insert into activity_feed (guild_id, battle_id, user_id, icon, message)
  values (v_task.guild_id, v_task.battle_id, v_uid, '🏆',
    (select display_name from profiles where id = v_uid) || ' WINS THE DUEL — +' || v_duel.reward_points || ' XP');

  perform public.evaluate_badges(v_uid);

  return jsonb_build_object('won', true, 'reward', v_duel.reward_points);
end;
$$;

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

alter table profiles enable row level security;
alter table guilds enable row level security;
alter table guild_members enable row level security;
alter table guild_invites enable row level security;
alter table bosses enable row level security;
alter table weekly_battles enable row level security;
alter table tasks enable row level security;
alter table duels enable row level security;
alter table duel_participants enable row level security;
alter table loot_rewards enable row level security;
alter table user_loot enable row level security;
alter table powerups enable row level security;
alter table battle_events enable row level security;
alter table activity_feed enable row level security;
alter table badges enable row level security;
alter table user_badges enable row level security;

-- profiles: self or guildmate can read; only self can edit display fields.
create policy "profiles are visible to self and guildmates" on profiles
  for select using (id = auth.uid() or public.shares_guild_with(profiles.id));
create policy "users can edit their own display fields" on profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

revoke all on profiles from authenticated;
grant select on profiles to authenticated;
grant update (username, display_name, avatar_url) on profiles to authenticated;

-- guilds: members only. Leader may edit name/description directly.
create policy "guild visible to its members" on guilds
  for select using (public.is_guild_member(guilds.id, auth.uid()));
create policy "leader can edit guild details" on guilds
  for update using (leader_id = auth.uid()) with check (leader_id = auth.uid());

revoke all on guilds from authenticated;
grant select on guilds to authenticated;
grant update (name, description) on guilds to authenticated;

-- guild_members: visible to fellow members. No direct writes (functions only).
create policy "membership visible to guildmates" on guild_members
  for select using (public.is_guild_member(guild_members.guild_id, auth.uid()));

revoke all on guild_members from authenticated;
grant select on guild_members to authenticated;

-- guild_invites: no client-facing policy at all — validated only inside join_guild().
revoke all on guild_invites from authenticated;

-- bosses / loot_rewards / badges: public read-only catalogs.
create policy "bosses are public" on bosses for select using (true);
create policy "loot table is public" on loot_rewards for select using (true);
create policy "badge catalog is public" on badges for select using (true);

revoke all on bosses from authenticated;
grant select on bosses to authenticated;
revoke all on loot_rewards from authenticated;
grant select on loot_rewards to authenticated;
revoke all on badges from authenticated;
grant select on badges to authenticated;

-- weekly_battles: members only, no direct writes.
create policy "battle visible to guild members" on weekly_battles
  for select using (public.is_guild_member(weekly_battles.guild_id, auth.uid()));

revoke all on weekly_battles from authenticated;
grant select on weekly_battles to authenticated;

-- tasks: members can read, create normal tasks, edit non-terminal fields,
-- and delete open tasks. Completing a task ALWAYS goes through a function.
create policy "tasks visible to guild members" on tasks
  for select using (public.is_guild_member(tasks.guild_id, auth.uid()));

create policy "members can create normal tasks" on tasks
  for insert with check (
    creator_id = auth.uid()
    and public.is_guild_member(tasks.guild_id, auth.uid())
    and exists (select 1 from weekly_battles where id = tasks.battle_id and guild_id = tasks.guild_id and status = 'active')
  );

create policy "members can edit open task fields" on tasks
  for update
  using (status <> 'done' and public.is_guild_member(tasks.guild_id, auth.uid()))
  with check (status in ('todo', 'doing') and public.is_guild_member(tasks.guild_id, auth.uid()));

create policy "creators and leaders can delete open tasks" on tasks
  for delete using (
    status <> 'done'
    and public.is_guild_member(tasks.guild_id, auth.uid())
    and (creator_id = auth.uid() or public.is_guild_leader(tasks.guild_id, auth.uid()))
  );

revoke all on tasks from authenticated;
grant select on tasks to authenticated;
grant insert (guild_id, battle_id, creator_id, assigned_to, title, description, difficulty, priority, due_date) on tasks to authenticated;
grant update (title, description, priority, due_date, assigned_to, status) on tasks to authenticated;
grant delete on tasks to authenticated;

-- duels / duel_participants: visible to guild members, function-only writes.
create policy "duels visible to guild members" on duels
  for select using (public.is_guild_member(duels.guild_id, auth.uid()));
create policy "duel participants visible to guild members" on duel_participants
  for select using (
    exists (select 1 from duels d where d.id = duel_participants.duel_id and public.is_guild_member(d.guild_id, auth.uid()))
  );

revoke all on duels from authenticated;
grant select on duels to authenticated;
revoke all on duel_participants from authenticated;
grant select on duel_participants to authenticated;

-- user_loot / powerups: private-ish, scoped to guild / owner. Function-only writes.
create policy "loot claims visible to guild members" on user_loot
  for select using (public.is_guild_member(user_loot.guild_id, auth.uid()));
create policy "powerups visible to their owner" on powerups
  for select using (user_id = auth.uid());

revoke all on user_loot from authenticated;
grant select on user_loot to authenticated;
revoke all on powerups from authenticated;
grant select on powerups to authenticated;

-- battle_events / activity_feed: visible to guild members, function-only writes.
create policy "battle events visible to guild members" on battle_events
  for select using (public.is_guild_member(battle_events.guild_id, auth.uid()));
create policy "activity feed visible to guild members" on activity_feed
  for select using (public.is_guild_member(activity_feed.guild_id, auth.uid()));

revoke all on battle_events from authenticated;
grant select on battle_events to authenticated;
revoke all on activity_feed from authenticated;
grant select on activity_feed to authenticated;

-- user_badges: visible to self and guildmates.
create policy "badges visible to self and guildmates" on user_badges
  for select using (user_id = auth.uid() or public.shares_guild_with(user_badges.user_id));

revoke all on user_badges from authenticated;
grant select on user_badges to authenticated;

-- ----------------------------------------------------------------------------
-- FUNCTION EXECUTE GRANTS — only the functions clients should call directly.
-- (finish_weekly_battle, claim_loot, evaluate_badges, apply_level_up,
-- set_task_reward, touch_updated_at, handle_new_user, next_sunday_end are
-- intentionally NOT granted: they are internal, called only from inside
-- other security-definer functions.)
-- ----------------------------------------------------------------------------

grant execute on function public.create_guild(text, text) to authenticated;
grant execute on function public.join_guild(text) to authenticated;
grant execute on function public.regenerate_invite_code(uuid) to authenticated;
grant execute on function public.remove_guild_member(uuid, uuid) to authenticated;
grant execute on function public.leave_guild() to authenticated;
grant execute on function public.start_new_weekly_battle(uuid) to authenticated;
grant execute on function public.check_battle_deadline(uuid) to authenticated;
grant execute on function public.check_overdue_tasks(uuid) to authenticated;
grant execute on function public.complete_task(uuid) to authenticated;
grant execute on function public.create_bomb_task(uuid, text, text, uuid, difficulty_level) to authenticated;
grant execute on function public.resolve_bomb_task(uuid) to authenticated;
grant execute on function public.create_duel_task(uuid, uuid, text, text, difficulty_level) to authenticated;
grant execute on function public.complete_duel_task(uuid) to authenticated;
grant execute on function public.activate_powerup(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- REALTIME
-- ----------------------------------------------------------------------------

alter publication supabase_realtime add table
  weekly_battles, tasks, activity_feed, profiles, guild_members, duels, battle_events;

-- ----------------------------------------------------------------------------
-- OPTIONAL (recommended for production): resolve bombs/deadlines even when
-- no client is connected to "poke" the checks. Requires the pg_cron
-- extension (Supabase Dashboard -> Database -> Extensions), then run:
--
-- select cron.schedule('resolve-expired-bombs', '* * * * *', $$
--   select public.resolve_bomb_task(id) from tasks
--    where task_type = 'bomb' and bomb_result is null and bomb_expires_at < now();
-- $$);
-- select cron.schedule('check-overdue-and-deadlines', '*/5 * * * *', $$
--   select public.check_overdue_tasks(id) from guilds;
--   select public.check_battle_deadline(id) from guilds;
-- $$);
--
-- Without pg_cron, the app triggers the same checks client-side on an
-- interval whenever a guild member has the dashboard open (see
-- components/dashboard/DashboardClient.tsx) — still authoritative, since
-- the functions themselves compare stored timestamps to `now()` on the
-- server; the client only decides when to ask.
-- ============================================================================
