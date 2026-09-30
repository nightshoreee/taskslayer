-- ============================================================================
-- TaskSlayer — 0010: carry unresolved Bomb Tasks across weekly battle rollover
--
-- Bomb Tasks are real 30-minute commitments. When a weekly battle ends, an
-- unresolved bomb must move to the newly spawned active battle while retaining
-- its original bomb_expires_at timestamp. Otherwise the bomb remains attached
-- to an inactive battle and later resolution cannot apply its penalty.
--
-- This migration preserves the existing behavior for normal/Loot tasks and
-- changes only the battle rollover carry-forward set to include bombs.
-- ============================================================================

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
    -- Unfinished work isn't stranded in the finished battle. Bomb tasks carry
    -- into the new battle with their original database deadline intact.
    -- This is important because a bomb's 30-minute commitment is independent
    -- of the weekly battle boundary. It must remain defusable (or explodable)
    -- exactly once after rollover instead of becoming orphaned on a finished battle.
    update tasks set battle_id = v_new_battle
     where battle_id = p_battle_id and status <> 'done' and task_type in ('normal', 'loot', 'bomb');
    insert into activity_feed (guild_id, battle_id, icon, message)
    values (v_battle.guild_id, v_new_battle, '👹', 'A new boss has appeared!');
  end if;
end;
$$;
