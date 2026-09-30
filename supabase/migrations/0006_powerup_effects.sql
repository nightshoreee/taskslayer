-- ============================================================================
-- TASKSLAYER — 0006: make powerups do something
--
-- Traced every reference to `uses_remaining` and each `powerup_type` value
-- through 0001: a powerup can be earned (claim_loot) and "activated"
-- (activate_powerup sets activated_at/expires_at) — but nothing anywhere
-- ever *checked* an active powerup before awarding XP or applying a team-HP
-- penalty. The Activate button was fully wired to a database column that no
-- gameplay function read. This migration is the other half: same two
-- powerup types the game already creates, now with a real effect.
--
--   • double_xp — claim_loot() already auto-activates this one immediately
--     (activated_at/expires_at set at claim time; see 0001). complete_task()
--     and complete_duel_task() now check for an unexpired one and double the
--     XP actually credited to profiles.xp. Boss damage is never doubled —
--     only XP, matching the reward's own description ("All XP you earn is
--     doubled"). Scope note: this covers the two main "complete something,
--     earn XP" paths; it does not compound onto loot's own xp_flat/steal_xp
--     rolls, to keep the change small and its interactions easy to reason
--     about.
--   • team_shield — created inactive; a player must spend an activate_powerup
--     call to arm it (that function already guards single-use activation —
--     no change needed there). resolve_bomb_task() and check_overdue_tasks()
--     now call the new consume_team_shield() helper before applying a
--     team-HP penalty: if the guild has an armed shield, it absorbs that one
--     penalty completely (uses_remaining -> 0) and the team takes no damage;
--     otherwise play proceeds exactly as before. Boss HP effects (e.g. the
--     regen an overdue task causes) are a boss-side consequence, not a hit
--     to the team, so a team shield does not block them.
--
-- consume_team_shield() is a new internal helper (`for update skip locked`,
-- so two penalty events resolving concurrently can't double-spend the same
-- shield) — revoked from anon/authenticated below, same as every other
-- internal function (see 0004's "RULE FOR FUTURE MIGRATIONS").
-- ============================================================================

create or replace function public.consume_team_shield(p_guild_id uuid)
returns boolean
language plpgsql
security definer set search_path = public
as $$
declare
  v_id uuid;
begin
  select id into v_id from powerups
   where guild_id = p_guild_id and type = 'team_shield' and activated_at is not null and uses_remaining > 0
   order by activated_at asc
   for update skip locked
   limit 1;

  if v_id is null then
    return false;
  end if;

  update powerups set uses_remaining = uses_remaining - 1 where id = v_id;
  return true;
end;
$$;

revoke execute on function public.consume_team_shield(uuid) from public, anon, authenticated;

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
  v_loot jsonb;
  v_xp_multiplier int := 1;
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

  if exists (select 1 from powerups where user_id = v_uid and type = 'double_xp' and expires_at > now()) then
    v_xp_multiplier := 2;
  end if;

  update tasks set status = 'done', completed_at = now(), completed_by = v_uid where id = p_task_id;

  v_new_hp := greatest(0, v_battle.boss_hp - v_task.damage);
  update weekly_battles set boss_hp = v_new_hp where id = v_battle.id;

  update profiles
     set xp = xp + (v_task.points * v_xp_multiplier),
         total_damage = total_damage + v_task.damage,
         tasks_completed = tasks_completed + 1
   where id = v_uid;
  perform public.apply_level_up(v_uid);

  insert into battle_events (guild_id, battle_id, event_type, actor_id, amount, message)
  values (v_task.guild_id, v_battle.id, 'damage', v_uid, v_task.damage,
    (select display_name from profiles where id = v_uid) || ' dealt ' || v_task.damage || ' damage with "' || v_task.title || '"');
  insert into activity_feed (guild_id, battle_id, user_id, icon, message)
  values (v_task.guild_id, v_battle.id, v_uid, '⚔️',
    (select display_name from profiles where id = v_uid) || ' dealt ' || v_task.damage || ' damage with "' || v_task.title || '"'
    || case when v_xp_multiplier > 1 then ' (2× XP active)' else '' end);

  if v_task.task_type = 'bomb' then
    update tasks set bomb_result = 'defused' where id = p_task_id;
    insert into activity_feed (guild_id, battle_id, user_id, icon, message)
    values (v_task.guild_id, v_battle.id, v_uid, '💥', 'Bomb defused: "' || v_task.title || '"');
  end if;

  if v_task.task_type = 'loot' then
    v_loot := public.claim_loot(p_task_id);
    select boss_hp into v_new_hp from weekly_battles where id = v_battle.id;
  end if;

  perform public.evaluate_badges(v_uid);

  if v_new_hp <= 0 then
    perform public.finish_weekly_battle(v_battle.id, 'won');
    v_boss_defeated := true;
  end if;

  return jsonb_build_object(
    'damage', v_task.damage, 'boss_hp', v_new_hp, 'boss_defeated', v_boss_defeated, 'loot', v_loot
  );
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
  v_xp_multiplier int := 1;
  v_awarded int;
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

  if exists (select 1 from powerups where user_id = v_uid and type = 'double_xp' and expires_at > now()) then
    v_xp_multiplier := 2;
  end if;
  v_awarded := v_duel.reward_points * v_xp_multiplier;

  update tasks set status = 'done', completed_at = now(), completed_by = v_uid where id = p_task_id;
  update duel_participants set completed_at = now() where id = v_dp.id;
  update duels set status = 'completed', winner_id = v_uid, completed_at = now() where id = v_duel.id;

  update profiles set xp = xp + v_awarded, duel_wins = duel_wins + 1, tasks_completed = tasks_completed + 1
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
  values (v_task.guild_id, v_task.battle_id, 'duel_win', v_uid, v_awarded,
    (select display_name from profiles where id = v_uid) || ' won the duel: "' || v_duel.title || '"');
  insert into activity_feed (guild_id, battle_id, user_id, icon, message)
  values (v_task.guild_id, v_task.battle_id, v_uid, '🏆',
    (select display_name from profiles where id = v_uid) || ' WINS THE DUEL — +' || v_awarded || ' XP'
    || case when v_xp_multiplier > 1 then ' (2× XP active)' else '' end);

  perform public.evaluate_badges(v_uid);

  return jsonb_build_object('won', true, 'reward', v_awarded);
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
  v_shielded boolean := false;
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
    v_shielded := public.consume_team_shield(v_task.guild_id);

    if v_shielded then
      v_new_team_hp := v_battle.team_hp;
      insert into battle_events (guild_id, battle_id, event_type, amount, message)
      values (v_task.guild_id, v_battle.id, 'bomb_exploded', 0, 'Bomb exploded: "' || v_task.title || '" — absorbed by a Team Shield');
      insert into activity_feed (guild_id, battle_id, icon, message)
      values (v_task.guild_id, v_battle.id, '🛡️', 'A Team Shield absorbed the blast — "' || v_task.title || '"');
    else
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
  end if;

  return jsonb_build_object('expired', true, 'result', 'exploded', 'shielded', v_shielded);
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
  v_shielded boolean;
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

    v_shielded := public.consume_team_shield(p_guild_id);
    if v_shielded then
      insert into battle_events (guild_id, battle_id, event_type, amount, message)
      values (p_guild_id, v_battle.id, 'boss_regen', v_regen, 'Boss regenerated ' || v_regen || ' HP — "' || r.title || '" became overdue (Team Shield absorbed the HP hit)');
      insert into activity_feed (guild_id, battle_id, icon, message)
      values (p_guild_id, v_battle.id, '🛡️', 'A Team Shield absorbed an overdue penalty — "' || r.title || '"');
    else
      v_battle.team_hp := greatest(0, v_battle.team_hp - v_dmg);
      insert into battle_events (guild_id, battle_id, event_type, amount, message)
      values (p_guild_id, v_battle.id, 'boss_regen', v_regen, 'Boss regenerated ' || v_regen || ' HP — "' || r.title || '" became overdue');
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
