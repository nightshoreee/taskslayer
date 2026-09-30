-- ============================================================================
-- TASKSLAYER — 0008: game logic v2
--
-- Requires 0007. Replaces the game functions from 0001–0006 with versions that
-- are config-driven (game_setting), deadlock-free, and complete. Signatures are
-- unchanged except where noted, so existing grants carry over; the privilege
-- pass at the bottom re-asserts every grant and self-checks the result.
--
-- LOCK ORDER (the invariant that removes the deadlocks):
--     complete_task / resolve_bomb_task :  task  -> battle -> (duels -> duel tasks via finish)
--     complete_duel_task                :  battle -> duel   -> task
--     check_overdue_tasks               :  battle -> tasks  (FOR UPDATE SKIP LOCKED — never waits on a task)
--     finish_weekly_battle              :  battle -> duels  -> tasks
--   The old code took task->duel->(other task) in complete_duel_task, so two
--   players finishing a duel at the same moment deadlocked each other (one was
--   aborted with "deadlock detected" after a 1 s stall), and check_overdue_tasks
--   (battle -> tasks) deadlocked against complete_task (task -> battle).
--
-- BUG FIXES (each was reproducible by reading the previous function):
--   * Slayer badge: complete_task evaluated badges BEFORE the battle was
--     marked 'won', so the killing blow never granted it; and "battles won"
--     counted every won battle of any guild the user is CURRENTLY in, so a new
--     member inherited old wins. Badges now count battles the user actually
--     fought in, and finish_weekly_battle evaluates every member after the
--     status flips to 'won'.
--   * Duel completion never checked the battle was still active or that the
--     winner was still a guild member.
--   * Loot "steal XP" minted XP from nothing when the victim had less than the
--     stolen amount (or nobody). It now steals only what the victim has.
--   * Invite codes came from md5(random()) (32 bits, non-cryptographic) and
--     could be brute-forced without limit. Now 48 random bits from
--     gen_random_uuid(), with a per-user failed-attempt throttle.
--   * Removing/leaving a guild left the member's open tasks assigned to them
--     and their duels dangling forever. Now cleaned up.
--   * A guild leader with other members had no way to hand over leadership.
--   * activate_powerup now returns the SERVER-computed activated_at/expires_at
--     (the UI used to invent an expiry from the browser clock).
--   * finish_weekly_battle now records a full, immutable history entry.
--   * Open normal/loot tasks are carried into the next battle instead of being
--     silently stranded in a finished one.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- HELPERS
-- ----------------------------------------------------------------------------

create or replace function public.generate_invite_code()
returns text
language plpgsql
volatile
set search_path = public
as $$
declare
  v_raw text;
  v_code text;
begin
  loop
    -- gen_random_uuid() is backed by a CSPRNG. Characters 1-12 are pure random
    -- bits (the version/variant nibbles sit at positions 13 and 17).
    v_raw := upper(replace(gen_random_uuid()::text, '-', ''));
    v_code := substr(v_raw, 1, 4) || '-' || substr(v_raw, 5, 4) || '-' || substr(v_raw, 9, 4);
    exit when not exists (select 1 from guild_invites where code = v_code)
          and not exists (select 1 from guilds where invite_code = v_code);
  end loop;
  return v_code;
end;
$$;

-- Starts a battle for the guild unless one is already active. Returns the new
-- battle id, or NULL when an active battle already exists (the partial unique
-- index makes this race-free: two concurrent callers cannot both insert).
create or replace function public.spawn_battle(p_guild_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_boss_id uuid;
  v_id uuid;
  v_boss_hp int := public.game_setting('boss_max_hp');
  v_team_hp int := public.game_setting('team_max_hp');
begin
  select id into v_boss_id from bosses order by random() limit 1;
  if v_boss_id is null then
    raise exception 'No bosses are configured';
  end if;

  insert into weekly_battles (guild_id, boss_id, boss_hp, max_hp, team_hp, max_team_hp, ends_at)
  values (p_guild_id, v_boss_id, v_boss_hp, v_boss_hp, v_team_hp, v_team_hp, public.next_sunday_end())
  on conflict (guild_id) where status = 'active' do nothing
  returning id into v_id;

  return v_id;
end;
$$;

-- A member who leaves or is removed: their duels end without a winner and
-- their open tasks return to the shared pool (so bombs can still be defused).
create or replace function public.cleanup_departing_member(p_guild_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  for r in
    select d.id
      from duels d
      join duel_participants dp on dp.duel_id = d.id
     where d.guild_id = p_guild_id and d.status = 'active' and dp.user_id = p_user_id
     order by d.id
       for update of d
  loop
    update duels set status = 'expired', completed_at = now() where id = r.id;
    update tasks set status = 'done', completed_at = now()
     where id in (select task_id from duel_participants where duel_id = r.id)
       and status <> 'done';
  end loop;

  update tasks set assigned_to = null
   where guild_id = p_guild_id
     and assigned_to = p_user_id
     and status <> 'done'
     and task_type <> 'duel';
end;
$$;

-- ----------------------------------------------------------------------------
-- GUILDS
-- ----------------------------------------------------------------------------

create or replace function public.create_guild(p_name text, p_description text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_name text := trim(coalesce(p_name, ''));
  v_desc text := nullif(trim(coalesce(p_description, '')), '');
  v_guild_id uuid;
  v_code text;
  v_battle_id uuid;
  v_display text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  perform public.ensure_profile();

  if exists (select 1 from guild_members where user_id = v_uid) then
    raise exception 'You are already in a guild';
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 50 then
    raise exception 'Guild name must be between 2 and 50 characters';
  end if;
  if v_desc is not null and char_length(v_desc) > 300 then
    raise exception 'Description must be 300 characters or fewer';
  end if;

  v_code := public.generate_invite_code();

  insert into guilds (name, description, invite_code, leader_id)
  values (v_name, v_desc, v_code, v_uid)
  returning id into v_guild_id;

  insert into guild_members (guild_id, user_id, role) values (v_guild_id, v_uid, 'leader');
  insert into guild_invites (guild_id, code, created_by) values (v_guild_id, v_code, v_uid);

  v_battle_id := public.spawn_battle(v_guild_id);
  select display_name into v_display from profiles where id = v_uid;

  insert into activity_feed (guild_id, battle_id, user_id, icon, message)
  values (v_guild_id, v_battle_id, v_uid, '🏰', v_display || ' founded the guild');

  return v_guild_id;
exception
  when unique_violation then
    -- A double-submit raced past the "already in a guild" check above.
    raise exception 'You are already in a guild';
end;
$$;

-- Returns the guild id on success, or NULL for an unknown/revoked code (failed
-- attempts are recorded, so this can't RAISE — a raise would roll the record
-- back). Raises only for real errors and when the throttle trips.
create or replace function public.join_guild(p_invite_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_code text := upper(trim(coalesce(p_invite_code, '')));
  v_guild_id uuid;
  v_failures int;
  v_display text;
  v_leader uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  perform public.ensure_profile();

  if exists (select 1 from guild_members where user_id = v_uid) then
    raise exception 'You are already in a guild';
  end if;

  delete from invite_attempts where attempted_at < now() - interval '1 day';
  select count(*) into v_failures
    from invite_attempts
   where user_id = v_uid
     and attempted_at > now() - make_interval(mins => public.game_setting('invite_attempt_window_minutes'));
  if v_failures >= public.game_setting('invite_max_failed_attempts') then
    raise exception 'Too many invalid invite codes. Please wait a few minutes and try again.';
  end if;

  select guild_id into v_guild_id from guild_invites where code = v_code and is_active;
  if v_guild_id is null then
    insert into invite_attempts (user_id) values (v_uid);
    return null;
  end if;

  insert into guild_members (guild_id, user_id, role) values (v_guild_id, v_uid, 'member');

  select display_name into v_display from profiles where id = v_uid;
  insert into activity_feed (guild_id, user_id, icon, message)
  values (v_guild_id, v_uid, '🎉', v_display || ' joined the guild');

  select leader_id into v_leader from guilds where id = v_guild_id;
  perform public.notify_user(v_leader, v_guild_id, 'member_joined', 'New guild member', v_display || ' joined your guild.', jsonb_build_object('user_id', v_uid));

  return v_guild_id;
exception
  when unique_violation then
    raise exception 'You are already in a guild';
end;
$$;

create or replace function public.regenerate_invite_code(p_guild_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_code text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if not public.is_guild_leader(p_guild_id, v_uid) then
    raise exception 'Only the guild leader can regenerate the invite code';
  end if;

  update guild_invites set is_active = false, revoked_at = now()
   where guild_id = p_guild_id and is_active;

  v_code := public.generate_invite_code();
  insert into guild_invites (guild_id, code, created_by) values (p_guild_id, v_code, v_uid);
  update guilds set invite_code = v_code where id = p_guild_id;

  return v_code;
end;
$$;

create or replace function public.remove_guild_member(p_guild_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_name text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if not public.is_guild_leader(p_guild_id, v_uid) then
    raise exception 'Only the guild leader can remove members';
  end if;
  if p_user_id = v_uid then
    raise exception 'The leader cannot remove themselves';
  end if;

  select display_name into v_name from profiles where id = p_user_id;
  delete from guild_members where guild_id = p_guild_id and user_id = p_user_id;
  if not found then
    raise exception 'That player is not in this guild';
  end if;

  perform public.cleanup_departing_member(p_guild_id, p_user_id);

  insert into activity_feed (guild_id, icon, message)
  values (p_guild_id, '👋', coalesce(v_name, 'A player') || ' was removed from the guild');
  perform public.notify_user(p_user_id, null, 'removed_from_guild', 'Removed from guild', 'The guild leader removed you from your guild.', '{}'::jsonb);
end;
$$;

create or replace function public.leave_guild()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_guild_id uuid;
  v_role guild_role;
  v_member_count int;
  v_name text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select gm.guild_id, gm.role into v_guild_id, v_role from guild_members gm where gm.user_id = v_uid;
  if v_guild_id is null then
    raise exception 'You are not in a guild';
  end if;

  select count(*) into v_member_count from guild_members where guild_id = v_guild_id;
  if v_role = 'leader' and v_member_count > 1 then
    raise exception 'Transfer leadership to another member before leaving';
  end if;

  select display_name into v_name from profiles where id = v_uid;
  delete from guild_members where user_id = v_uid;

  if v_role = 'leader' then
    delete from guilds where id = v_guild_id; -- the last member leaving disbands the guild
  else
    perform public.cleanup_departing_member(v_guild_id, v_uid);
    insert into activity_feed (guild_id, icon, message)
    values (v_guild_id, '👋', coalesce(v_name, 'A player') || ' left the guild');
  end if;
end;
$$;

create or replace function public.transfer_guild_leadership(p_guild_id uuid, p_new_leader_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_name text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if not public.is_guild_leader(p_guild_id, v_uid) then
    raise exception 'Only the guild leader can transfer leadership';
  end if;
  if p_new_leader_id = v_uid then
    raise exception 'You are already the leader';
  end if;
  if not public.is_guild_member(p_guild_id, p_new_leader_id) then
    raise exception 'That player is not in this guild';
  end if;

  update guild_members set role = 'member' where guild_id = p_guild_id and user_id = v_uid;
  update guild_members set role = 'leader' where guild_id = p_guild_id and user_id = p_new_leader_id;
  update guilds set leader_id = p_new_leader_id where id = p_guild_id;

  select display_name into v_name from profiles where id = p_new_leader_id;
  insert into activity_feed (guild_id, user_id, icon, message)
  values (p_guild_id, p_new_leader_id, '👑', coalesce(v_name, 'A player') || ' is the new guild leader');
  perform public.notify_user(p_new_leader_id, p_guild_id, 'leadership_transferred', 'You lead the guild now', 'The previous leader handed the guild over to you.', '{}'::jsonb);
end;
$$;

-- ----------------------------------------------------------------------------
-- BATTLE LIFECYCLE
-- ----------------------------------------------------------------------------

create or replace function public.start_new_weekly_battle(p_guild_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_battle_id uuid;
begin
  if v_uid is not null and not public.is_guild_member(p_guild_id, v_uid) then
    raise exception 'You are not a member of this guild';
  end if;

  v_battle_id := public.spawn_battle(p_guild_id);
  if v_battle_id is not null then
    insert into activity_feed (guild_id, battle_id, icon, message)
    values (p_guild_id, v_battle_id, '👹', 'A new boss has appeared!');
  end if;
  return v_battle_id;
end;
$$;

-- Internal. Finalizes an active battle exactly once (the FOR UPDATE + status
-- filter make a second call a no-op), records the history entry, pays rewards
-- once, expires open duels, and starts the next battle.
create or replace function public.finish_weekly_battle(p_battle_id uuid, p_result text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_battle weekly_battles%rowtype;
  v_participants jsonb;
  v_total int;
  v_top_id uuid;
  v_top_name text;
  v_top_dmg int;
  v_guild_xp int := 0;
  v_member_xp int := 0;
  v_member record;
  v_new_battle uuid;
begin
  if p_result not in ('won', 'lost') then
    raise exception 'Invalid battle result';
  end if;

  select * into v_battle from weekly_battles where id = p_battle_id and status = 'active' for update;
  if not found then
    return;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('user_id', x.actor_id, 'name', p.display_name, 'damage', x.dmg)
                            order by x.dmg desc, p.display_name), '[]'::jsonb),
         coalesce(sum(x.dmg), 0)::int
    into v_participants, v_total
    from (
      select actor_id, sum(amount)::int as dmg
        from battle_events
       where battle_id = p_battle_id and event_type = 'damage' and actor_id is not null
       group by actor_id
    ) x
    join profiles p on p.id = x.actor_id;

  v_top_id   := nullif(v_participants -> 0 ->> 'user_id', '')::uuid;
  v_top_name := v_participants -> 0 ->> 'name';
  v_top_dmg  := coalesce((v_participants -> 0 ->> 'damage')::int, 0);

  if p_result = 'won' then
    v_guild_xp  := public.game_setting('battle_win_guild_xp');
    v_member_xp := public.game_setting('battle_win_personal_xp');
  end if;

  update weekly_battles
     set status = p_result::battle_status,
         finished_at = now(),
         result_summary = jsonb_build_object(
           'top_damage_user_id', v_top_id,
           'top_damage_name', v_top_name,
           'top_damage', v_top_dmg,
           'total_damage', v_total,
           'participants', v_participants,
           'boss_hp_start', v_battle.max_hp,
           'boss_hp_end', v_battle.boss_hp,
           'team_hp_end', v_battle.team_hp,
           'team_hp_max', v_battle.max_team_hp,
           'rewards', jsonb_build_object('guild_xp', v_guild_xp, 'member_xp', v_member_xp)
         )
   where id = p_battle_id;

  -- Open duels can't outlive their battle.
  update duels set status = 'expired', completed_at = now()
   where battle_id = p_battle_id and status = 'active';
  update tasks set status = 'done', completed_at = now()
   where id in (
           select dp.task_id from duel_participants dp
             join duels d on d.id = dp.duel_id
            where d.battle_id = p_battle_id and d.status = 'expired'
         )
     and status <> 'done';

  if p_result = 'won' then
    update guilds set guild_xp = guild_xp + v_guild_xp where id = v_battle.guild_id;
    update profiles set xp = xp + v_member_xp
     where id in (select user_id from guild_members where guild_id = v_battle.guild_id);

    for v_member in
      select user_id from guild_members where guild_id = v_battle.guild_id order by user_id
    loop
      perform public.apply_level_up(v_member.user_id);
      -- The battle is already 'won' here, so the Slayer badge sees it.
      perform public.evaluate_badges(v_member.user_id);
    end loop;

    insert into activity_feed (guild_id, battle_id, icon, message)
    values (v_battle.guild_id, p_battle_id, '🏆',
            'BOSS SLAIN — the guild is victorious! +' || v_guild_xp || ' Guild XP, +' || v_member_xp || ' Personal XP each');
    insert into battle_events (guild_id, battle_id, event_type, message)
    values (v_battle.guild_id, p_battle_id, 'battle_won', 'The guild defeated the boss');
    perform public.notify_guild(v_battle.guild_id, null, 'battle_won', 'Boss defeated!',
                                'Your guild claimed victory this week.', jsonb_build_object('battle_id', p_battle_id));
  else
    insert into activity_feed (guild_id, battle_id, icon, message)
    values (v_battle.guild_id, p_battle_id, '💀', 'The boss survived the week. The guild endures, but did not conquer.');
    insert into battle_events (guild_id, battle_id, event_type, message)
    values (v_battle.guild_id, p_battle_id, 'battle_lost', 'The boss survived the deadline');
    perform public.notify_guild(v_battle.guild_id, null, 'battle_lost', 'The boss survived',
                                'A new boss appears now.', jsonb_build_object('battle_id', p_battle_id));
  end if;

  v_new_battle := public.spawn_battle(v_battle.guild_id);
  if v_new_battle is not null then
    -- Unfinished ordinary work isn't stranded in the finished battle.
    update tasks set battle_id = v_new_battle
     where battle_id = p_battle_id and status <> 'done' and task_type in ('normal', 'loot');
    insert into activity_feed (guild_id, battle_id, icon, message)
    values (v_battle.guild_id, v_new_battle, '👹', 'A new boss has appeared!');
  end if;
end;
$$;

create or replace function public.check_battle_deadline(p_guild_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_battle_id uuid;
begin
  if v_uid is not null and not public.is_guild_member(p_guild_id, v_uid) then
    raise exception 'You are not a member of this guild';
  end if;

  select id into v_battle_id from weekly_battles
   where guild_id = p_guild_id and status = 'active' and ends_at <= clock_timestamp();
  if v_battle_id is not null then
    perform public.finish_weekly_battle(v_battle_id, 'lost');
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- BADGES
-- ----------------------------------------------------------------------------

create or replace function public.evaluate_badges(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile profiles%rowtype;
  v_badge badges%rowtype;
  v_won int;
  v_bombs int;
  v_loot int;
  v_participated int;
  v_earned boolean;
  v_rows int;
  v_guild uuid;
begin
  select * into v_profile from profiles where id = p_user_id;
  if not found then
    return;
  end if;

  -- "Won" means a battle the player actually fought in (not merely one their
  -- current guild happened to win before they joined).
  select count(distinct wb.id) into v_won
    from weekly_battles wb
   where wb.status = 'won'
     and exists (select 1 from battle_events be where be.battle_id = wb.id and be.actor_id = p_user_id);

  select count(*) into v_bombs from tasks
   where completed_by = p_user_id and task_type = 'bomb' and bomb_result = 'defused';

  select count(*) into v_loot from user_loot where user_id = p_user_id;

  select count(distinct battle_id) into v_participated
    from battle_events where actor_id = p_user_id and battle_id is not null;

  select guild_id into v_guild from guild_members where user_id = p_user_id;

  for v_badge in select * from badges order by criteria_value loop
    v_earned := case v_badge.criteria_type
      when 'total_damage'         then v_profile.total_damage >= v_badge.criteria_value
      when 'duel_wins'            then v_profile.duel_wins >= v_badge.criteria_value
      when 'battles_won'          then v_won >= v_badge.criteria_value
      when 'bombs_defused'        then v_bombs >= v_badge.criteria_value
      when 'loot_found'           then v_loot >= v_badge.criteria_value
      when 'battles_participated' then v_participated >= v_badge.criteria_value
      else false
    end;

    if v_earned then
      insert into user_badges (user_id, badge_id) values (p_user_id, v_badge.id)
      on conflict (user_id, badge_id) do nothing;
      get diagnostics v_rows = row_count;

      if v_rows > 0 then
        if v_guild is not null then
          insert into activity_feed (guild_id, user_id, icon, message)
          values (v_guild, p_user_id, '🏅', v_profile.display_name || ' unlocked the "' || v_badge.name || '" badge');
        end if;
        perform public.notify_user(p_user_id, v_guild, 'badge_unlocked', 'Badge unlocked: ' || v_badge.name,
                                   v_badge.description, jsonb_build_object('badge_key', v_badge.key));
      end if;
    end if;
  end loop;
end;
$$;

-- ----------------------------------------------------------------------------
-- LOOT
-- ----------------------------------------------------------------------------

-- Internal; only ever called from complete_task while it holds the task lock,
-- and user_loot.task_id is UNIQUE — a task can never yield two rewards.
create or replace function public.claim_loot(p_task_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task tasks%rowtype;
  v_reward loot_rewards%rowtype;
  v_claim user_loot%rowtype;
  v_total_weight int;
  v_roll numeric;
  v_uid uuid;
  v_victim uuid;
  v_taken int := 0;
  v_rarity text;
  v_name text;
begin
  select * into v_task from tasks where id = p_task_id;
  if not found or v_task.task_type <> 'loot' or v_task.completed_by is null then
    raise exception 'Nothing to claim for this task';
  end if;
  v_uid := v_task.completed_by;

  select sum(weight) into v_total_weight from loot_rewards;

  -- Idempotent replay: a task can only ever yield one reward.
  select * into v_claim from user_loot where task_id = p_task_id;
  if found then
    select * into v_reward from loot_rewards where id = v_claim.loot_reward_id;
    return jsonb_build_object(
      'key', v_reward.key, 'label', v_reward.label, 'description', v_reward.description,
      'effect_type', v_reward.effect_type, 'effect_value', v_reward.effect_value,
      'rarity', public.loot_rarity(v_reward.weight, v_total_weight),
      'already_claimed', true, 'task_id', p_task_id
    );
  end if;

  -- ONE draw held in a variable (see 0003 for why random() must not sit in a WHERE).
  v_roll := random() * v_total_weight;

  select lr.* into v_reward
    from loot_rewards lr
    join (
      select l2.id, sum(l2.weight) over (order by l2.key) as cum_weight
        from loot_rewards l2
    ) c on c.id = lr.id
   where c.cum_weight > v_roll
   order by c.cum_weight asc
   limit 1;

  if v_reward.id is null then
    raise exception 'No loot rewards are configured';
  end if;
  v_rarity := public.loot_rarity(v_reward.weight, v_total_weight);
  select display_name into v_name from profiles where id = v_uid;

  insert into user_loot (user_id, guild_id, task_id, loot_reward_id)
  values (v_uid, v_task.guild_id, p_task_id, v_reward.id);

  if v_reward.effect_type = 'xp_flat' then
    update profiles set xp = xp + v_reward.effect_value where id = v_uid;
    perform public.apply_level_up(v_uid);
  elsif v_reward.effect_type = 'team_heal' then
    update weekly_battles set team_hp = least(max_team_hp, team_hp + v_reward.effect_value)
     where id = v_task.battle_id;
  elsif v_reward.effect_type = 'boss_damage_boost' then
    update weekly_battles set boss_hp = greatest(0, boss_hp - v_reward.effect_value)
     where id = v_task.battle_id;
  elsif v_reward.effect_type = 'double_xp_duration' then
    -- Expiry is computed here, on the server, from the database clock.
    insert into powerups (user_id, guild_id, type, activated_at, expires_at, uses_remaining)
    values (v_uid, v_task.guild_id, 'double_xp', now(), now() + make_interval(mins => v_reward.effect_value), 1);
  elsif v_reward.effect_type = 'shield' then
    insert into powerups (user_id, guild_id, type, uses_remaining)
    values (v_uid, v_task.guild_id, 'team_shield', 1);
  elsif v_reward.effect_type = 'steal_xp' then
    select user_id into v_victim from guild_members
     where guild_id = v_task.guild_id and user_id <> v_uid
     order by random() limit 1;
    if v_victim is not null then
      -- Only what the victim actually has: XP is moved, never minted.
      select least(v_reward.effect_value, xp) into v_taken from profiles where id = v_victim for update;
      if v_taken > 0 then
        update profiles set xp = xp - v_taken where id = v_victim;
        update profiles set xp = xp + v_taken where id = v_uid;
        perform public.apply_level_up(v_victim);
        perform public.apply_level_up(v_uid);
        perform public.notify_user(v_victim, v_task.guild_id, 'loot_stolen', 'XP stolen!',
                                   coalesce(v_name, 'A guildmate') || ' siphoned ' || v_taken || ' XP from you.',
                                   jsonb_build_object('thief_id', v_uid, 'amount', v_taken));
      end if;
    end if;
  end if;

  insert into activity_feed (guild_id, battle_id, user_id, icon, message)
  values (v_task.guild_id, v_task.battle_id, v_uid, '🎁',
          coalesce(v_name, 'Someone') || ' found loot: ' || v_reward.label
          || case when v_rarity in ('rare', 'legendary') then ' (' || initcap(v_rarity) || ')' else '' end);

  return jsonb_build_object(
    'key', v_reward.key, 'label', v_reward.label, 'description', v_reward.description,
    'effect_type', v_reward.effect_type,
    'effect_value', case when v_reward.effect_type = 'steal_xp' then v_taken else v_reward.effect_value end,
    'rarity', v_rarity, 'already_claimed', false, 'task_id', p_task_id
  );
end;
$$;

create or replace function public.mark_loot_revealed(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  update user_loot set revealed_at = coalesce(revealed_at, now())
   where task_id = p_task_id and user_id = auth.uid();
end;
$$;

-- Loot the player earned but hasn't watched the reveal for yet (e.g. they
-- completed the task by drag-and-drop and closed the tab). The reward was
-- already applied when the task was completed; this only drives the animation.
create or replace function public.get_pending_loot()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_total int;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  select sum(weight) into v_total from loot_rewards;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'key', lr.key, 'label', lr.label, 'description', lr.description,
             'effect_type', lr.effect_type, 'effect_value', lr.effect_value,
             'rarity', public.loot_rarity(lr.weight, v_total),
             'already_claimed', true, 'task_id', ul.task_id
           ) order by ul.claimed_at)
      from user_loot ul
      join loot_rewards lr on lr.id = ul.loot_reward_id
     where ul.user_id = auth.uid() and ul.revealed_at is null
  ), '[]'::jsonb);
end;
$$;

-- ----------------------------------------------------------------------------
-- POWERUPS
-- ----------------------------------------------------------------------------

-- Return type changes (void -> jsonb), which `create or replace` can't do.
drop function if exists public.activate_powerup(uuid);

create function public.activate_powerup(p_powerup_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_pu powerups%rowtype;
  v_expires timestamptz;
  v_name text;
  v_battle uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_pu from powerups where id = p_powerup_id and user_id = v_uid for update;
  if not found then
    raise exception 'Power-up not found';
  end if;
  if not public.is_guild_member(v_pu.guild_id, v_uid) then
    raise exception 'You are no longer in the guild this power-up belongs to';
  end if;
  if v_pu.uses_remaining <= 0 then
    raise exception 'This power-up has already been used';
  end if;
  if v_pu.activated_at is not null then
    if v_pu.expires_at is not null and v_pu.expires_at <= clock_timestamp() then
      raise exception 'This power-up has expired';
    end if;
    raise exception 'This power-up is already active';
  end if;

  v_expires := case v_pu.type
    when 'double_xp' then clock_timestamp() + make_interval(mins => public.game_setting('double_xp_minutes'))
    else null
  end;

  update powerups set activated_at = clock_timestamp(), expires_at = v_expires where id = p_powerup_id;

  select display_name into v_name from profiles where id = v_uid;
  select id into v_battle from weekly_battles where guild_id = v_pu.guild_id and status = 'active';
  insert into battle_events (guild_id, battle_id, event_type, actor_id, message)
  values (v_pu.guild_id, v_battle, 'powerup_activated', v_uid,
          coalesce(v_name, 'Someone') || ' activated ' || replace(v_pu.type::text, '_', ' '));
  insert into activity_feed (guild_id, battle_id, user_id, icon, message)
  values (v_pu.guild_id, v_battle, v_uid, '⚡',
          coalesce(v_name, 'Someone') || ' activated a ' || replace(v_pu.type::text, '_', ' ') || ' power-up');

  return jsonb_build_object(
    'id', v_pu.id, 'type', v_pu.type,
    'activated_at', (select activated_at from powerups where id = p_powerup_id),
    'expires_at', v_expires,
    'server_now', clock_timestamp()
  );
end;
$$;

-- (consume_team_shield from 0006 is unchanged: FOR UPDATE SKIP LOCKED means two
-- penalties resolving concurrently can't spend the same shield.)

-- ----------------------------------------------------------------------------
-- CORE LOOP: complete a normal / bomb / loot task
-- ----------------------------------------------------------------------------

create or replace function public.complete_task(p_task_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_task tasks%rowtype;
  v_battle weekly_battles%rowtype;
  v_new_hp int;
  v_boss_defeated boolean := false;
  v_loot jsonb;
  v_multiplier int := 1;
  v_awarded int;
  v_name text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_task from tasks where id = p_task_id for update;
  if not found then
    raise exception 'Task not found';
  end if;
  if not public.is_guild_member(v_task.guild_id, v_uid) then
    raise exception 'You are not a member of this guild';
  end if;
  if v_task.status = 'done' then
    raise exception 'This task has already been completed';
  end if;
  if v_task.task_type = 'duel' then
    raise exception 'Use complete_duel_task for duel tasks';
  end if;
  if v_task.assigned_to is not null and v_task.assigned_to <> v_uid then
    raise exception 'This task is assigned to someone else';
  end if;

  select * into v_battle from weekly_battles where id = v_task.battle_id for update;
  if v_battle.status <> 'active' then
    raise exception 'This battle has already ended';
  end if;

  -- Deadlines are judged on the database clock, at the moment we hold the lock.
  if v_battle.ends_at <= clock_timestamp() then
    perform public.finish_weekly_battle(v_battle.id, 'lost');
    return jsonb_build_object('battle_ended', true, 'damage', 0, 'boss_hp', v_battle.boss_hp,
                              'boss_defeated', false, 'loot', null);
  end if;
  if v_task.task_type = 'bomb' and v_task.bomb_expires_at <= clock_timestamp() then
    perform public.resolve_bomb_task(p_task_id);
    return jsonb_build_object('bomb_exploded', true, 'damage', 0, 'boss_hp', v_battle.boss_hp,
                              'boss_defeated', false, 'loot', null);
  end if;

  if exists (
    select 1 from powerups
     where user_id = v_uid and type = 'double_xp'
       and activated_at is not null and expires_at > clock_timestamp()
  ) then
    v_multiplier := public.game_setting('double_xp_multiplier');
  end if;
  v_awarded := v_task.points * v_multiplier;

  update tasks
     set status = 'done', completed_at = now(), completed_by = v_uid,
         bomb_result = case when task_type = 'bomb' then 'defused' else bomb_result end
   where id = p_task_id;

  v_new_hp := greatest(0, v_battle.boss_hp - v_task.damage);
  update weekly_battles set boss_hp = v_new_hp where id = v_battle.id;

  update profiles
     set xp = xp + v_awarded,
         total_damage = total_damage + v_task.damage,
         tasks_completed = tasks_completed + 1
   where id = v_uid;
  perform public.apply_level_up(v_uid);

  select display_name into v_name from profiles where id = v_uid;
  insert into battle_events (guild_id, battle_id, event_type, actor_id, amount, message)
  values (v_task.guild_id, v_battle.id, 'damage', v_uid, v_task.damage,
          v_name || ' dealt ' || v_task.damage || ' damage with "' || v_task.title || '"');
  insert into activity_feed (guild_id, battle_id, user_id, icon, message)
  values (v_task.guild_id, v_battle.id, v_uid, '⚔️',
          v_name || ' dealt ' || v_task.damage || ' damage with "' || v_task.title || '"'
          || case when v_multiplier > 1 then ' (' || v_multiplier || '× XP active)' else '' end);

  if v_task.task_type = 'bomb' then
    insert into activity_feed (guild_id, battle_id, user_id, icon, message)
    values (v_task.guild_id, v_battle.id, v_uid, '💥', 'Bomb defused: "' || v_task.title || '"');
    if v_task.creator_id is distinct from v_uid then
      perform public.notify_user(v_task.creator_id, v_task.guild_id, 'bomb_defused', 'Bomb defused',
                                 v_name || ' defused "' || v_task.title || '".', jsonb_build_object('task_id', p_task_id));
    end if;
  end if;

  if v_task.task_type = 'loot' then
    v_loot := public.claim_loot(p_task_id);
    -- A Boss Damage Boost can itself land the killing blow: re-read the real HP.
    select boss_hp into v_new_hp from weekly_battles where id = v_battle.id;
  end if;

  perform public.evaluate_badges(v_uid);

  if v_new_hp <= 0 then
    perform public.finish_weekly_battle(v_battle.id, 'won');
    v_boss_defeated := true;
  end if;

  return jsonb_build_object(
    'damage', v_task.damage, 'boss_hp', v_new_hp, 'boss_defeated', v_boss_defeated,
    'loot', v_loot, 'xp_awarded', v_awarded, 'xp_multiplier', v_multiplier
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- BOMB TASKS
-- ----------------------------------------------------------------------------

create or replace function public.create_bomb_task(
  p_guild_id uuid, p_title text, p_description text, p_assigned_to uuid,
  p_difficulty difficulty_level default 'medium'
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_title text := trim(coalesce(p_title, ''));
  v_desc text := nullif(trim(coalesce(p_description, '')), '');
  v_battle_id uuid;
  v_task_id uuid;
  v_name text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if not public.is_guild_member(p_guild_id, v_uid) then
    raise exception 'You are not a member of this guild';
  end if;
  if p_assigned_to is null or not public.is_guild_member(p_guild_id, p_assigned_to) then
    raise exception 'A bomb must be assigned to a member of this guild';
  end if;
  if char_length(v_title) < 1 or char_length(v_title) > 200 then
    raise exception 'Title must be between 1 and 200 characters';
  end if;
  if v_desc is not null and char_length(v_desc) > 500 then
    raise exception 'Description must be 500 characters or fewer';
  end if;

  select id into v_battle_id from weekly_battles where guild_id = p_guild_id and status = 'active';
  if v_battle_id is null then
    raise exception 'No active battle for this guild';
  end if;

  -- The deadline is stamped by the database, never supplied by the client.
  insert into tasks (guild_id, battle_id, creator_id, assigned_to, title, description, difficulty, status, task_type, bomb_expires_at)
  values (p_guild_id, v_battle_id, v_uid, p_assigned_to, v_title, v_desc, p_difficulty, 'todo', 'bomb',
          clock_timestamp() + make_interval(mins => public.game_setting('bomb_duration_minutes')))
  returning id into v_task_id;

  select display_name into v_name from profiles where id = v_uid;
  insert into activity_feed (guild_id, battle_id, user_id, icon, message)
  values (p_guild_id, v_battle_id, v_uid, '💣', v_name || ' planted a bomb task: "' || v_title || '"');
  if p_assigned_to <> v_uid then
    perform public.notify_user(p_assigned_to, p_guild_id, 'bomb_assigned', 'A bomb was planted on you',
                               '"' || v_title || '" explodes in ' || public.game_setting('bomb_duration_minutes') || ' minutes.',
                               jsonb_build_object('task_id', v_task_id));
  end if;

  return v_task_id;
end;
$$;

-- Safe to call repeatedly and from anywhere: it only acts once the stored
-- deadline has passed on the database clock, and the row lock plus the
-- bomb_result guard make the explosion happen at most once.
create or replace function public.resolve_bomb_task(p_task_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_task tasks%rowtype;
  v_battle weekly_battles%rowtype;
  v_new_team_hp int;
  v_shielded boolean := false;
  v_penalty int := public.game_setting('bomb_penalty_team_hp');
begin
  select * into v_task from tasks where id = p_task_id for update;
  if not found or v_task.task_type <> 'bomb' then
    raise exception 'Not a bomb task';
  end if;
  if v_uid is not null and not public.is_guild_member(v_task.guild_id, v_uid) then
    raise exception 'You are not a member of this guild';
  end if;

  if v_task.bomb_result is not null then
    return jsonb_build_object('already_resolved', true, 'result', v_task.bomb_result);
  end if;
  if v_task.status = 'done' then
    return jsonb_build_object('already_resolved', true, 'result', 'defused');
  end if;
  if v_task.bomb_expires_at > clock_timestamp() then
    return jsonb_build_object('expired', false);
  end if;

  select * into v_battle from weekly_battles where id = v_task.battle_id for update;
  update tasks set bomb_result = 'exploded', status = 'done', completed_at = now() where id = p_task_id;

  if v_battle.status = 'active' then
    v_shielded := public.consume_team_shield(v_task.guild_id);

    if v_shielded then
      insert into battle_events (guild_id, battle_id, event_type, amount, message)
      values (v_task.guild_id, v_battle.id, 'bomb_exploded', 0,
              'Bomb exploded: "' || v_task.title || '" — absorbed by a Team Shield');
      insert into activity_feed (guild_id, battle_id, icon, message)
      values (v_task.guild_id, v_battle.id, '🛡️', 'A Team Shield absorbed the blast — "' || v_task.title || '"');
      perform public.notify_guild(v_task.guild_id, null, 'bomb_exploded', 'Bomb absorbed by the shield',
                                  '"' || v_task.title || '" exploded but the Team Shield took the hit.',
                                  jsonb_build_object('task_id', p_task_id));
    else
      v_new_team_hp := greatest(0, v_battle.team_hp - v_penalty);
      update weekly_battles set team_hp = v_new_team_hp where id = v_battle.id;

      insert into battle_events (guild_id, battle_id, event_type, amount, message)
      values (v_task.guild_id, v_battle.id, 'bomb_exploded', v_penalty, 'Bomb exploded: "' || v_task.title || '"');
      insert into activity_feed (guild_id, battle_id, icon, message)
      values (v_task.guild_id, v_battle.id, '💣', 'BOMB EXPLODED — "' || v_task.title || '" — Team HP -' || v_penalty);
      perform public.notify_guild(v_task.guild_id, null, 'bomb_exploded', 'Bomb exploded!',
                                  '"' || v_task.title || '" — the team lost ' || v_penalty || ' HP.',
                                  jsonb_build_object('task_id', p_task_id));

      if v_new_team_hp <= 0 then
        perform public.finish_weekly_battle(v_battle.id, 'lost');
      end if;
    end if;
  end if;

  return jsonb_build_object('expired', true, 'result', 'exploded', 'shielded', v_shielded);
end;
$$;

-- ----------------------------------------------------------------------------
-- LOOT TASK CREATION
-- ----------------------------------------------------------------------------

create or replace function public.create_loot_task(
  p_guild_id uuid, p_title text, p_description text, p_assigned_to uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_title text := trim(coalesce(p_title, ''));
  v_desc text := nullif(trim(coalesce(p_description, '')), '');
  v_battle_id uuid;
  v_task_id uuid;
  v_name text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if not public.is_guild_member(p_guild_id, v_uid) then
    raise exception 'You are not a member of this guild';
  end if;
  if p_assigned_to is not null and not public.is_guild_member(p_guild_id, p_assigned_to) then
    raise exception 'Assignee is not a member of this guild';
  end if;
  if char_length(v_title) < 1 or char_length(v_title) > 200 then
    raise exception 'Title must be between 1 and 200 characters';
  end if;
  if v_desc is not null and char_length(v_desc) > 500 then
    raise exception 'Description must be 500 characters or fewer';
  end if;

  select id into v_battle_id from weekly_battles where guild_id = p_guild_id and status = 'active';
  if v_battle_id is null then
    raise exception 'No active battle for this guild';
  end if;

  insert into tasks (guild_id, battle_id, creator_id, assigned_to, title, description, difficulty, priority, status, task_type)
  values (p_guild_id, v_battle_id, v_uid, p_assigned_to, v_title, v_desc, 'high', 'high', 'todo', 'loot')
  returning id into v_task_id;

  select display_name into v_name from profiles where id = v_uid;
  insert into activity_feed (guild_id, battle_id, user_id, icon, message)
  values (p_guild_id, v_battle_id, v_uid, '🎁', v_name || ' planted a Loot task: "' || v_title || '"');

  return v_task_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- DUELS
-- ----------------------------------------------------------------------------

create or replace function public.create_duel_task(
  p_guild_id uuid, p_opponent_id uuid, p_title text, p_description text,
  p_difficulty difficulty_level default 'medium'
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_title text := trim(coalesce(p_title, ''));
  v_desc text := nullif(trim(coalesce(p_description, '')), '');
  v_battle_id uuid;
  v_duel_id uuid;
  v_reward int;
  v_task1 uuid;
  v_task2 uuid;
  v_me text;
  v_them text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if p_opponent_id is null or v_uid = p_opponent_id then
    raise exception 'You cannot duel yourself';
  end if;
  if not public.is_guild_member(p_guild_id, v_uid) then
    raise exception 'You are not a member of this guild';
  end if;
  if not public.is_guild_member(p_guild_id, p_opponent_id) then
    raise exception 'Opponent is not a member of this guild';
  end if;
  if char_length(v_title) < 1 or char_length(v_title) > 200 then
    raise exception 'Title must be between 1 and 200 characters';
  end if;
  if v_desc is not null and char_length(v_desc) > 500 then
    raise exception 'Description must be 500 characters or fewer';
  end if;

  select id into v_battle_id from weekly_battles where guild_id = p_guild_id and status = 'active';
  if v_battle_id is null then
    raise exception 'No active battle for this guild';
  end if;

  v_reward := public.game_setting('damage_' || p_difficulty::text) * public.game_setting('duel_reward_multiplier');

  insert into duels (guild_id, battle_id, title, description, created_by, challenger_id, opponent_id, reward_points)
  values (p_guild_id, v_battle_id, v_title, v_desc, v_uid, v_uid, p_opponent_id, v_reward)
  returning id into v_duel_id;

  insert into tasks (guild_id, battle_id, creator_id, assigned_to, title, description, difficulty, status, task_type)
  values (p_guild_id, v_battle_id, v_uid, v_uid, v_title, v_desc, p_difficulty, 'todo', 'duel')
  returning id into v_task1;
  insert into duel_participants (duel_id, user_id, task_id) values (v_duel_id, v_uid, v_task1);

  insert into tasks (guild_id, battle_id, creator_id, assigned_to, title, description, difficulty, status, task_type)
  values (p_guild_id, v_battle_id, v_uid, p_opponent_id, v_title, v_desc, p_difficulty, 'todo', 'duel')
  returning id into v_task2;
  insert into duel_participants (duel_id, user_id, task_id) values (v_duel_id, p_opponent_id, v_task2);

  select display_name into v_me from profiles where id = v_uid;
  select display_name into v_them from profiles where id = p_opponent_id;
  insert into activity_feed (guild_id, battle_id, user_id, icon, message)
  values (p_guild_id, v_battle_id, v_uid, '⚔️', v_me || ' challenged ' || v_them || ' to a duel: "' || v_title || '"');
  insert into battle_events (guild_id, battle_id, event_type, actor_id, target_id, message)
  values (p_guild_id, v_battle_id, 'duel_start', v_uid, p_opponent_id, v_me || ' challenged ' || v_them);
  perform public.notify_user(p_opponent_id, p_guild_id, 'duel_challenge', v_me || ' challenged you to a duel',
                             '"' || v_title || '" — first to finish wins ' || v_reward || ' XP.',
                             jsonb_build_object('duel_id', v_duel_id));

  return v_duel_id;
end;
$$;

-- Exactly one winner, however many requests arrive and in whatever order:
-- every completion of this duel first takes the battle lock and then the duel
-- row lock, so concurrent completions are serialized; the second one sees
-- duels.status <> 'active' and is rejected. See the lock-order note above.
create or replace function public.complete_duel_task(p_task_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_dp duel_participants%rowtype;
  v_duel duels%rowtype;
  v_battle weekly_battles%rowtype;
  v_task tasks%rowtype;
  v_multiplier int := 1;
  v_awarded int;
  v_name text;
  v_loser uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  -- Unlocked lookups only to discover WHICH rows to lock, in the right order.
  select * into v_dp from duel_participants where task_id = p_task_id;
  if not found then
    raise exception 'Not a duel task';
  end if;
  select * into v_duel from duels where id = v_dp.duel_id;

  select * into v_battle from weekly_battles where id = v_duel.battle_id for update;   -- 1. battle
  select * into v_duel from duels where id = v_dp.duel_id for update;                   -- 2. duel
  if v_duel.status <> 'active' then
    raise exception 'The duel has already ended';
  end if;
  if v_dp.user_id <> v_uid then
    raise exception 'This is not your duel task';
  end if;
  if not public.is_guild_member(v_duel.guild_id, v_uid) then
    raise exception 'You are not a member of this guild';
  end if;
  if v_battle.status <> 'active' then
    raise exception 'The battle for this duel has ended';
  end if;

  select * into v_task from tasks where id = p_task_id for update;                      -- 3. task
  if v_task.status = 'done' then
    raise exception 'This task has already been completed';
  end if;

  if exists (
    select 1 from powerups
     where user_id = v_uid and type = 'double_xp'
       and activated_at is not null and expires_at > clock_timestamp()
  ) then
    v_multiplier := public.game_setting('double_xp_multiplier');
  end if;
  v_awarded := v_duel.reward_points * v_multiplier;

  update tasks set status = 'done', completed_at = now(), completed_by = v_uid where id = p_task_id;
  update duel_participants set completed_at = now() where id = v_dp.id;
  update duels set status = 'completed', winner_id = v_uid, completed_at = now() where id = v_duel.id;

  update profiles set xp = xp + v_awarded, duel_wins = duel_wins + 1, tasks_completed = tasks_completed + 1
   where id = v_uid;
  perform public.apply_level_up(v_uid);

  -- The loser's task is closed with completed_by left NULL — that's how the UI
  -- tells "closed because the duel was lost" from a real completion.
  update tasks set status = 'done', completed_at = now()
   where id in (select task_id from duel_participants where duel_id = v_duel.id and user_id <> v_uid)
     and status <> 'done';

  select display_name into v_name from profiles where id = v_uid;
  insert into battle_events (guild_id, battle_id, event_type, actor_id, target_id, amount, message)
  values (v_duel.guild_id, v_duel.battle_id, 'duel_win', v_uid,
          case when v_duel.challenger_id = v_uid then v_duel.opponent_id else v_duel.challenger_id end,
          v_awarded, v_name || ' won the duel: "' || v_duel.title || '"');
  insert into activity_feed (guild_id, battle_id, user_id, icon, message)
  values (v_duel.guild_id, v_duel.battle_id, v_uid, '🏆',
          v_name || ' WINS THE DUEL — +' || v_awarded || ' XP'
          || case when v_multiplier > 1 then ' (' || v_multiplier || '× XP active)' else '' end);

  v_loser := case when v_duel.challenger_id = v_uid then v_duel.opponent_id else v_duel.challenger_id end;
  perform public.notify_user(v_loser, v_duel.guild_id, 'duel_lost', 'You lost a duel',
                             v_name || ' finished "' || v_duel.title || '" first.',
                             jsonb_build_object('duel_id', v_duel.id));
  perform public.notify_user(v_uid, v_duel.guild_id, 'duel_won', 'You won the duel!',
                             '+' || v_awarded || ' XP for "' || v_duel.title || '".',
                             jsonb_build_object('duel_id', v_duel.id));

  perform public.evaluate_badges(v_uid);

  return jsonb_build_object('won', true, 'reward', v_awarded, 'xp_multiplier', v_multiplier);
end;
$$;

-- ----------------------------------------------------------------------------
-- OVERDUE TASKS
-- ----------------------------------------------------------------------------

-- Each task is penalized at most once (penalized_at). Candidates are taken with
-- FOR UPDATE SKIP LOCKED: a task someone is completing right now is skipped
-- (and picked up next run) instead of making this function wait — that wait
-- was one half of the old battle<->task deadlock.
create or replace function public.check_overdue_tasks(p_guild_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_battle weekly_battles%rowtype;
  r record;
  v_regen int := public.game_setting('overdue_boss_regen');
  v_dmg int := public.game_setting('overdue_team_damage');
  v_shielded boolean;
begin
  if v_uid is not null and not public.is_guild_member(p_guild_id, v_uid) then
    raise exception 'You are not a member of this guild';
  end if;

  -- Cheap pre-check so idle polling never touches the battle row lock.
  if not exists (
    select 1 from tasks t
      join weekly_battles b on b.id = t.battle_id and b.status = 'active'
     where t.guild_id = p_guild_id
       and t.status <> 'done' and t.task_type in ('normal', 'loot')
       and t.due_date is not null and t.due_date <= clock_timestamp() and t.penalized_at is null
  ) then
    return;
  end if;

  select * into v_battle from weekly_battles where guild_id = p_guild_id and status = 'active' for update;
  if not found then
    return;
  end if;

  for r in
    select id, title, assigned_to, creator_id from tasks
     where guild_id = p_guild_id and battle_id = v_battle.id
       and status <> 'done' and task_type in ('normal', 'loot')
       and due_date is not null and due_date <= clock_timestamp() and penalized_at is null
     order by id
       for update skip locked
  loop
    update tasks set penalized_at = now() where id = r.id;
    v_battle.boss_hp := least(v_battle.max_hp, v_battle.boss_hp + v_regen);

    perform public.notify_user(coalesce(r.assigned_to, r.creator_id), p_guild_id, 'task_overdue', 'Task overdue',
                               '"' || r.title || '" is overdue — the boss healed ' || v_regen || ' HP.',
                               jsonb_build_object('task_id', r.id));

    v_shielded := public.consume_team_shield(p_guild_id);
    if v_shielded then
      insert into battle_events (guild_id, battle_id, event_type, amount, message)
      values (p_guild_id, v_battle.id, 'boss_regen', v_regen,
              'Boss regenerated ' || v_regen || ' HP — "' || r.title || '" became overdue (Team Shield absorbed the HP hit)');
      insert into activity_feed (guild_id, battle_id, icon, message)
      values (p_guild_id, v_battle.id, '🛡️', 'A Team Shield absorbed an overdue penalty — "' || r.title || '"');
    else
      v_battle.team_hp := greatest(0, v_battle.team_hp - v_dmg);
      insert into battle_events (guild_id, battle_id, event_type, amount, message)
      values (p_guild_id, v_battle.id, 'boss_regen', v_regen,
              'Boss regenerated ' || v_regen || ' HP — "' || r.title || '" became overdue');
      insert into activity_feed (guild_id, battle_id, icon, message)
      values (p_guild_id, v_battle.id, '💀', 'BOSS REGENERATED ' || v_regen || ' HP — "' || r.title || '" became overdue');
    end if;
  end loop;

  update weekly_battles set boss_hp = v_battle.boss_hp, team_hp = v_battle.team_hp where id = v_battle.id;

  if v_battle.team_hp <= 0 then
    perform public.finish_weekly_battle(v_battle.id, 'lost');
  end if;
end;
$$;

-- One call for everything time-driven. Used by the dashboard poll and by
-- pg_cron (see 0009). NULL auth.uid() (cron) skips the membership check.
create or replace function public.run_guild_maintenance(p_guild_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  r record;
begin
  if v_uid is not null and not public.is_guild_member(p_guild_id, v_uid) then
    raise exception 'You are not a member of this guild';
  end if;

  perform public.check_battle_deadline(p_guild_id);

  for r in
    select id from tasks
     where guild_id = p_guild_id and task_type = 'bomb'
       and bomb_result is null and status <> 'done'
       and bomb_expires_at <= clock_timestamp()
     order by bomb_expires_at
  loop
    perform public.resolve_bomb_task(r.id);
  end loop;

  perform public.check_overdue_tasks(p_guild_id);
end;
$$;

-- ----------------------------------------------------------------------------
-- NOTIFICATIONS (client-callable state changes)
-- ----------------------------------------------------------------------------

create or replace function public.mark_notification_read(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  update notifications set read_at = coalesce(read_at, now())
   where id = p_id and user_id = auth.uid();
end;
$$;

create or replace function public.mark_all_notifications_read()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  update notifications set read_at = now() where user_id = auth.uid() and read_at is null;
  -- Keep the table small: read notifications older than 30 days are dropped.
  delete from notifications
   where user_id = auth.uid() and read_at is not null and created_at < now() - interval '30 days';
end;
$$;

-- ----------------------------------------------------------------------------
-- BATTLE HISTORY CONSTRAINT (added only now that finish_weekly_battle sets it)
-- ----------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'weekly_battles_finished_at_check') then
    alter table public.weekly_battles
      add constraint weekly_battles_finished_at_check check (status = 'active' or finished_at is not null);
  end if;
end
$$;

-- ----------------------------------------------------------------------------
-- PRIVILEGE PASS (same approach as 0004: by name, idempotent, self-checking)
-- ----------------------------------------------------------------------------

do $$
declare
  r record;
begin
  -- Server-only. Reachable only from other SECURITY DEFINER functions / triggers.
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'finish_weekly_battle', 'claim_loot', 'evaluate_badges', 'apply_level_up', 'loot_rarity',
         'consume_team_shield', 'spawn_battle', 'generate_invite_code', 'cleanup_departing_member',
         'notify_user', 'notify_guild', 'create_profile_for', 'notify_task_assigned',
         'guard_task_integrity', 'guard_finalized_battle', 'guard_special_task_edits'
       )
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
  end loop;

  -- Client RPCs: signed-in users only.
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'create_guild', 'join_guild', 'regenerate_invite_code', 'remove_guild_member', 'leave_guild',
         'transfer_guild_leadership', 'start_new_weekly_battle', 'check_battle_deadline',
         'check_overdue_tasks', 'run_guild_maintenance', 'complete_task', 'create_bomb_task',
         'resolve_bomb_task', 'create_duel_task', 'complete_duel_task', 'create_loot_task',
         'activate_powerup', 'mark_loot_revealed', 'get_pending_loot', 'mark_notification_read',
         'mark_all_notifications_read', 'ensure_profile', 'server_now'
       )
  loop
    execute format('revoke execute on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end
$$;

do $$
declare
  v_exposed text;
begin
  select string_agg(p.oid::regprocedure::text, ', ')
    into v_exposed
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in (
       'finish_weekly_battle', 'claim_loot', 'evaluate_badges', 'apply_level_up', 'loot_rarity',
       'consume_team_shield', 'spawn_battle', 'generate_invite_code', 'cleanup_departing_member',
       'notify_user', 'notify_guild', 'create_profile_for'
     )
     and (has_function_privilege('anon', p.oid, 'execute')
          or has_function_privilege('authenticated', p.oid, 'execute'));

  if v_exposed is not null then
    raise exception 'Internal game functions are still callable by API roles: %', v_exposed;
  end if;
end
$$;
