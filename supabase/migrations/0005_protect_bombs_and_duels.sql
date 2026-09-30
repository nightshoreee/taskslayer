-- ============================================================================
-- TASKSLAYER — 0005: bombs and duels are commitments
--
-- Three integrity gaps in how the API role may touch the `tasks` table
-- (found by attacking a real Postgres — see the test notes in the README):
--
-- 1. BOMB DODGE. The delete policy let a task's creator delete ANY open
--    task, including an armed bomb. Plant a bomb on yourself, delete it a
--    second before the timer ends: no penalty, no reward, and the whole
--    "the deadline is server-enforced, you can't wriggle out of it" design
--    is moot.
--
-- 2. DUEL KNOCK-OUT. create_duel_task() makes the *challenger* the creator
--    of BOTH task rows (one per participant), so the same delete policy let
--    the challenger delete the opponent's row. With their opponent unable
--    to finish, the challenger wins by walkover — double points, no race.
--
-- 3. DUEL/BOMB TAMPERING. `assigned_to` (and title/description/due_date) are
--    client-editable on any open task. Reassigning the opponent's duel row
--    to yourself doesn't change who the server lets complete it (that is
--    decided by duel_participants) — but it hides the opponent's Complete
--    button and re-labels their card. RLS can't express "only some columns,
--    only for some rows", so a BEFORE UPDATE trigger does.
--
-- Also: `priority` and `difficulty` are one concept in the product (the
-- single "Priority" the player picks). Damage is stamped from `difficulty`
-- at insert; `priority` is written identically alongside it. Letting the
-- client edit `priority` afterwards could only make a card say "High" while
-- it still deals Medium damage, so that column grant is removed.
--
-- None of this touches the server-side game functions: they run as the
-- table owner (security definer), so neither the policy nor the trigger's
-- API-role check applies to them.
-- ============================================================================

-- 1 + 2. Only ordinary tasks are deletable through the API.
drop policy if exists "creators and leaders can delete open tasks" on tasks;
create policy "creators and leaders can delete open tasks" on tasks
  for delete using (
    status <> 'done'
    and task_type in ('normal', 'loot')
    and public.is_guild_member(tasks.guild_id, auth.uid())
    and (creator_id = auth.uid() or public.is_guild_leader(tasks.guild_id, auth.uid()))
  );

-- 3. Duel and Bomb rows: the API may move them between To Do / Doing, and
--    nothing else. (Completion, expiry and rewards go through the RPCs.)
create or replace function public.guard_special_task_edits()
returns trigger
language plpgsql
as $$
begin
  if current_user in ('anon', 'authenticated') and old.task_type in ('duel', 'bomb') then
    if new.assigned_to is distinct from old.assigned_to
       or new.title is distinct from old.title
       or new.description is distinct from old.description
       or new.priority is distinct from old.priority
       or new.due_date is distinct from old.due_date then
      raise exception 'Duel and Bomb tasks can''t be edited once created';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_special_task_edits on tasks;
create trigger guard_special_task_edits
  before update on tasks
  for each row execute function public.guard_special_task_edits();

-- Trigger functions can't be called as RPCs, but keep the API surface tidy.
revoke execute on function public.guard_special_task_edits() from public, anon, authenticated;

-- Priority is fixed at creation together with the damage it implies.
revoke update (priority) on tasks from authenticated;
