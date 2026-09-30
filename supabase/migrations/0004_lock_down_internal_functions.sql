-- ============================================================================
-- TASKSLAYER — 0004: lock down internal game functions
--
-- THE PROBLEM. 0001 grants EXECUTE to `authenticated` on the 14 functions
-- the app is meant to call — but it never REVOKEs anything on functions.
-- In Postgres (and therefore Supabase), a new function is executable by
-- PUBLIC by default, and Supabase's Data API exposes every function in the
-- `public` schema as /rpc/<name> to whoever holds EXECUTE. So the "internal"
-- helpers 0001 meant to keep server-only were in fact callable from any
-- browser console:
--
--   supabase.rpc('finish_weekly_battle', { p_battle_id, p_result: 'won' })
--
-- That function is `security definer`, does no auth.uid() check, and never
-- verifies the boss is actually dead — it just believes `p_result`. Any
-- signed-in player could end their own guild's battle as WON with the boss
-- at full health, collect +500 Guild XP and +100 XP for every member, and
-- repeat it every time the next boss spawned. (Reproduced against a real
-- Postgres: boss at 880 HP, battle flipped to 'won', XP granted.)
-- claim_loot() had the same exposure — loot could be minted on demand.
--
-- THE FIX (no logic changes, only who may call what):
--   1. Internal-only functions get EXECUTE revoked from PUBLIC, anon and
--      authenticated. They keep working: every caller is another
--      SECURITY DEFINER function, which runs with its owner's privileges.
--   2. The client-callable RPCs are restricted to signed-in users — `anon`
--      (not logged in) has no business calling any of them.
--   3. A self-check at the bottom RAISEs if any internal function is still
--      reachable, so this migration can never "succeed" while leaving the
--      hole open (e.g. on a project with unusual default privileges).
--
-- The revokes are looked up by function *name* (not hard-coded signatures),
-- so they can't fail on a signature mismatch and keep working if arguments
-- are ever added. All statements are idempotent.
--
-- RULE FOR FUTURE MIGRATIONS: a new function is client-callable by default.
-- Any new server-only function must revoke EXECUTE itself, and any new
-- client RPC must grant it explicitly to `authenticated` (as 0001 does).
-- supabase/audit_function_privileges.sql lists who can call what.
-- ============================================================================

do $$
declare
  r record;
begin
  -- 1. Server-only. Never callable through the API.
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('finish_weekly_battle', 'claim_loot', 'evaluate_badges', 'apply_level_up', 'loot_rarity')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
  end loop;

  -- 2. Client RPCs: signed-in users only.
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'create_guild', 'join_guild', 'regenerate_invite_code', 'remove_guild_member', 'leave_guild',
         'start_new_weekly_battle', 'check_battle_deadline', 'check_overdue_tasks',
         'complete_task', 'create_bomb_task', 'resolve_bomb_task',
         'create_duel_task', 'complete_duel_task', 'create_loot_task', 'activate_powerup'
       )
  loop
    execute format('revoke execute on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end
$$;

-- 3. Fail loudly if the lock-down didn't take.
do $$
declare
  v_exposed text;
begin
  select string_agg(p.oid::regprocedure::text, ', ')
    into v_exposed
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('finish_weekly_battle', 'claim_loot', 'evaluate_badges', 'apply_level_up', 'loot_rarity')
     and (has_function_privilege('anon', p.oid, 'execute')
          or has_function_privilege('authenticated', p.oid, 'execute'));

  if v_exposed is not null then
    raise exception 'Internal game functions are still callable by API roles: %', v_exposed;
  end if;
end
$$;
