-- ============================================================================
-- TASKSLAYER — 0002: Loot task creation
--
-- 0001_init.sql already has everything a Loot task needs once one exists:
-- the 'loot' task_type enum value, the `task_type = 'loot'` branch inside
-- complete_task() that calls claim_loot(), the RLS policy that makes tasks
-- readable to the whole guild, and even a ready TypeBadge case in the
-- frontend (components/tasks/TaskCard.tsx). What was missing is a way to
-- CREATE one: the INSERT grant on `tasks` deliberately does not include
-- `task_type` (see the "members can create normal tasks" policy/grant in
-- 0001), so a plain client-side insert can only ever produce a 'normal'
-- task. Bomb and Duel tasks solve this with their own security-definer
-- creation function; Loot needs the same treatment.
--
-- Loot tasks are pinned to 'high' difficulty/priority. The brief frames
-- loot as tied to a guild's highest-value tasks ("high-priority tasks can
-- contain hidden loot") — a flat rule here is simpler to reason about, to
-- secure, and to show on a card than a hidden probability roll on every
-- normal task would be, and it keeps loot a deliberate creator choice
-- rather than a surprise tax on unrelated high-priority work.
--
-- Run this once, after 0001_init.sql, on any project that already has it
-- (Supabase SQL Editor, or `supabase db push`).
-- ============================================================================

create or replace function public.create_loot_task(
  p_guild_id uuid, p_title text, p_description text, p_assigned_to uuid default null
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
  if p_assigned_to is not null
     and not exists (select 1 from guild_members where guild_id = p_guild_id and user_id = p_assigned_to) then
    raise exception 'Assignee is not a member of this guild';
  end if;

  select id into v_battle_id from weekly_battles where guild_id = p_guild_id and status = 'active';
  if v_battle_id is null then
    raise exception 'No active battle for this guild';
  end if;

  insert into tasks (guild_id, battle_id, creator_id, assigned_to, title, description, difficulty, priority, status, task_type)
  values (p_guild_id, v_battle_id, v_uid, p_assigned_to, p_title, p_description, 'high', 'high', 'todo', 'loot')
  returning id into v_task_id;
  -- difficulty is forced to 'high' above; trg_set_task_reward (0001) then
  -- stamps damage = 60 / points = 60 from that, same as any other high task.

  insert into activity_feed (guild_id, battle_id, user_id, icon, message)
  values (p_guild_id, v_battle_id, v_uid, '🎁',
    (select display_name from profiles where id = v_uid) || ' planted a Loot task: "' || p_title || '"');

  return v_task_id;
end;
$$;

grant execute on function public.create_loot_task(uuid, text, text, uuid) to authenticated;
