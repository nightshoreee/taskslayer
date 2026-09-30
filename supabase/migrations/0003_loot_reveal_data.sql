-- ============================================================================
-- TASKSLAYER — 0003: loot reveal data + loot correctness fixes
--
-- claim_loot() already rolls a weighted-random reward and persists it
-- atomically (0001_init.sql). But it only ever returned {key, label,
-- already_claimed}, and complete_task() calls it with `perform`, which
-- discards the return value entirely — so nothing server-side ever told
-- the client what was actually found, and a "loot reveal" UI had no data
-- to reveal without a second query the instant after completion.
--
-- What changes here (same signatures, same inputs, same security model —
-- security definer, and see 0004 for who is allowed to *call* them):
--
--   1. ENRICHED RETURN. claim_loot() also returns description, effect_type,
--      effect_value and a `rarity` tier, on both the fresh-roll branch and
--      the already-claimed replay branch (so a refresh mid-reveal gets the
--      full picture). complete_task() captures that result instead of
--      discarding it and returns it under a `loot` key — null for every
--      non-loot task.
--
--   2. FIX: BIASED ROLL. The old query compared each candidate reward's
--      cumulative weight against `random() * total` *inside the WHERE
--      clause*. random() is volatile, so Postgres re-evaluates it for every
--      row — each reward was tested against a different random number.
--      With the seeded weights (15/15/15/5/10/15/25 in key order) that made
--      the intended-rarest reward (Steal XP, 5%) land ~16% of the time and
--      the intended-most-common (+50 XP, 25%) ~1.6%. It is now a single
--      draw stored in a variable, so probabilities equal weight / total.
--
--   3. FIX: STEAL_XP LEVELS. The steal branch moved XP between two players
--      without recomputing either one's level (profiles.level is derived
--      from xp via apply_level_up). It now recomputes both. If the guild
--      has nobody else to steal from, only the claimer gains (unchanged).
--
--   4. FIX: LOOT KILLING THE BOSS. A Boss Damage Boost roll lowers boss_hp
--      inside claim_loot(), but complete_task() decided "boss defeated"
--      from the HP it computed *before* the loot ran — so a boost that
--      landed the killing blow left the boss at 0 HP with the battle still
--      'active' until some later task. It now re-reads the real HP.
--
--   5. GUARD. claim_loot() refuses tasks that aren't completed Loot tasks.
--
-- New helper: loot_rarity(weight, total) -> common|uncommon|rare|legendary,
-- derived from each reward's probability so the tiers can never drift from
-- the seeded weights (with the current table: 25% common, 15% uncommon,
-- 10% rare, 5% legendary).
-- ============================================================================

create or replace function public.loot_rarity(p_weight int, p_total int)
returns text
language sql
immutable
as $$
  select case
    when coalesce(p_total, 0) <= 0 then 'common'
    when p_weight::numeric / p_total < 0.08 then 'legendary'
    when p_weight::numeric / p_total < 0.12 then 'rare'
    when p_weight::numeric / p_total < 0.20 then 'uncommon'
    else 'common'
  end;
$$;

create or replace function public.claim_loot(p_task_id uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_task tasks%rowtype;
  v_reward loot_rewards%rowtype;
  v_total_weight int;
  v_roll numeric;
  v_uid uuid;
  v_victim uuid;
  v_rarity text;
begin
  select * into v_task from tasks where id = p_task_id;
  if not found or v_task.task_type <> 'loot' or v_task.completed_by is null then
    raise exception 'Nothing to claim for this task';
  end if;
  v_uid := v_task.completed_by;

  select sum(weight) into v_total_weight from loot_rewards;

  -- Idempotent replay: a task can only ever yield one reward.
  if exists (select 1 from user_loot where task_id = p_task_id) then
    select lr.* into v_reward
      from user_loot ul join loot_rewards lr on lr.id = ul.loot_reward_id
     where ul.task_id = p_task_id;
    return jsonb_build_object(
      'key', v_reward.key, 'label', v_reward.label, 'description', v_reward.description,
      'effect_type', v_reward.effect_type, 'effect_value', v_reward.effect_value,
      'rarity', public.loot_rarity(v_reward.weight, v_total_weight),
      'already_claimed', true
    );
  end if;

  -- ONE draw, held in a variable. (Putting random() inside the WHERE below
  -- would re-roll it per row — see fix 2 in the header.)
  v_roll := random() * v_total_weight;

  -- Cumulative-weight pick: reward i wins iff prev_cum <= roll < cum_i, so
  -- P(reward) = weight / total. Joined back by id so the SELECT list is
  -- exactly loot_rewards' own columns (matches the %rowtype target).
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

  insert into user_loot (user_id, guild_id, task_id, loot_reward_id)
  values (v_uid, v_task.guild_id, p_task_id, v_reward.id);

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
    select user_id into v_victim from guild_members
     where guild_id = v_task.guild_id and user_id <> v_uid
     order by random() limit 1;
    if v_victim is not null then
      update profiles set xp = greatest(0, xp - v_reward.effect_value) where id = v_victim;
      perform public.apply_level_up(v_victim);
    end if;
    update profiles set xp = xp + v_reward.effect_value where id = v_uid;
    perform public.apply_level_up(v_uid);
  end if;

  insert into activity_feed (guild_id, battle_id, user_id, icon, message)
  values (v_task.guild_id, v_task.battle_id, v_uid, '🎁',
    (select display_name from profiles where id = v_uid) || ' found loot: ' || v_reward.label
    || case when v_rarity in ('rare', 'legendary') then ' (' || initcap(v_rarity) || ')' else '' end);

  return jsonb_build_object(
    'key', v_reward.key, 'label', v_reward.label, 'description', v_reward.description,
    'effect_type', v_reward.effect_type, 'effect_value', v_reward.effect_value,
    'rarity', v_rarity, 'already_claimed', false
  );
end;
$$;

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
    v_loot := public.claim_loot(p_task_id);
    -- A Boss Damage Boost can itself land the killing blow; re-read the
    -- authoritative HP so the defeat check below (and the value we return)
    -- reflects it instead of the pre-loot number.
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
