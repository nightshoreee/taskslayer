-- Who can call which function through the Supabase Data API (/rpc/<name>)?
-- Run this in the SQL editor after any migration that adds or changes a
-- function. Expected result for a healthy TaskSlayer project:
--   * server-only game functions (finish_weekly_battle, claim_loot,
--     evaluate_badges, apply_level_up, loot_rarity): anon = false, authenticated = false
--   * client RPCs (create_guild, complete_task, ...): anon = false, authenticated = true
-- Trigger functions (handle_new_user, set_task_reward, touch_updated_at) can't
-- be invoked as RPCs regardless of what this column says.

select
  p.oid::regprocedure                            as function,
  has_function_privilege('anon', p.oid, 'execute')          as anon_can_call,
  has_function_privilege('authenticated', p.oid, 'execute') as authenticated_can_call
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prokind = 'f'
  and p.prorettype <> 'trigger'::regtype
  -- ignore functions that belong to an extension (e.g. pgcrypto), only list ours
  and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
order by authenticated_can_call desc, anon_can_call desc, function;
