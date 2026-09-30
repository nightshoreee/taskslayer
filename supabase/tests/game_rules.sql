-- ============================================================================
-- TaskSlayer game-rule tests (plain SQL, no extensions).
--
-- Run against a SCRATCH database that has migrations 0001-0010 applied (e.g.
-- `supabase start` + `supabase db reset`, then):
--
--     psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/game_rules.sql
--
-- Everything happens inside one transaction that is ROLLED BACK at the end, so
-- it leaves no data behind. Any failed assertion raises 'FAIL: ...' and aborts.
-- Expected last line of output:  NOTICE:  ALL GAME-RULE TESTS PASSED
--
-- NOTE: this file was written but NOT executed by its author (the environment
-- it was written in had no PostgreSQL). Treat the first run as part of setup;
-- if an insert into auth.users fails, add the extra NOT NULL columns your
-- Supabase version requires.
-- ============================================================================
begin;

do $$
declare
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  c uuid := gen_random_uuid();          -- outsider: never joins the guild
  v_guild uuid;
  v_code text;
  v_battle weekly_battles%rowtype;
  v_task uuid;
  v_task_b uuid;
  v_res jsonb;
  v_n int;
  v_hp int;
  v_xp_a int;
  v_xp_b int;
  v_err text;
  v_duel uuid;
  v_ta uuid;
  v_tb uuid;
  v_winner uuid;
  v_bomb_deadline timestamptz;
begin
  -- ---- setup: three real users (profiles come from the signup trigger) ----
  insert into auth.users (id, email, raw_user_meta_data) values
    (a, 'a-' || a || '@test.local', '{"username":"tester_a"}'),
    (b, 'b-' || b || '@test.local', '{"username":"tester_b"}'),
    (c, 'c-' || c || '@test.local', '{"username":"tester_c"}');
  if (select count(*) from profiles where id in (a, b, c)) <> 3 then
    raise exception 'FAIL: signup trigger did not create 3 profiles';
  end if;

  -- long username collision must not break signup (old fallback exceeded 20 chars)
  insert into auth.users (id, email, raw_user_meta_data)
  values (gen_random_uuid(), 'dup-' || a || '@test.local', '{"username":"tester_a"}');

  -- ---- guild + invite -------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  v_guild := public.create_guild('Test Guild', 'tests');
  select invite_code into v_code from guilds where id = v_guild;
  if v_code !~ '^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$' then raise exception 'FAIL: invite code format %', v_code; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  if public.join_guild('NOPE-NOPE-NOPE') is not null then raise exception 'FAIL: bad code joined a guild'; end if;
  if public.join_guild(lower(v_code)) is distinct from v_guild then raise exception 'FAIL: valid code (any case) did not join'; end if;

  -- brute-force throttle: outsider gets locked out after 10 failures
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  for i in 1..10 loop perform public.join_guild('AAAA-BBBB-' || lpad(i::text, 4, '0')); end loop;
  begin
    perform public.join_guild(v_code);
    raise exception 'FAIL: throttle did not block the 11th attempt (even with a valid code)';
  exception when others then
    if sqlerrm not like 'Too many invalid invite codes%' then raise; end if;
  end;

  -- ---- normal task: damage, XP, single completion ---------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  select * into v_battle from weekly_battles where guild_id = v_guild and status = 'active';
  if v_battle.boss_hp <> 1000 or v_battle.team_hp <> 500 then raise exception 'FAIL: fresh battle HP %/%', v_battle.boss_hp, v_battle.team_hp; end if;

  insert into tasks (guild_id, battle_id, creator_id, title, difficulty, priority)
  values (v_guild, v_battle.id, a, 'medium task', 'medium', 'low') returning id into v_task;
  if (select damage from tasks where id = v_task) <> 25 then raise exception 'FAIL: medium damage not 25'; end if;
  if (select priority::text from tasks where id = v_task) <> 'medium' then raise exception 'FAIL: priority not forced to difficulty'; end if;

  v_res := public.complete_task(v_task);
  select boss_hp into v_hp from weekly_battles where id = v_battle.id;
  if v_hp <> 975 then raise exception 'FAIL: boss hp % after a 25 hit', v_hp; end if;
  begin
    perform public.complete_task(v_task);
    raise exception 'FAIL: task completed twice';
  exception when others then if sqlerrm not like '%already been completed%' then raise; end if; end;
  select boss_hp into v_hp from weekly_battles where id = v_battle.id;
  if v_hp <> 975 then raise exception 'FAIL: duplicate completion changed boss hp to %', v_hp; end if;

  -- client cannot forge state: direct writes to game columns are refused
  begin update weekly_battles set boss_hp = 0 where id = v_battle.id; raise exception 'FAIL: client updated boss hp';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; end;
  begin update profiles set xp = 999999 where id = a; raise exception 'FAIL: client updated own xp';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; end;
  begin insert into activity_feed (guild_id, icon, message) values (v_guild, 'x', 'fake'); raise exception 'FAIL: client wrote activity';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; end;

  -- past due dates and outsider assignees are refused
  begin
    insert into tasks (guild_id, battle_id, creator_id, title, difficulty, due_date)
    values (v_guild, v_battle.id, a, 'sabotage', 'low', now() - interval '1 day');
    raise exception 'FAIL: past due date accepted';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; end;
  begin
    insert into tasks (guild_id, battle_id, creator_id, assigned_to, title, difficulty)
    values (v_guild, v_battle.id, a, c, 'bad assignee', 'low');
    raise exception 'FAIL: non-member assignee accepted';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; end;

  -- assignment: only the assignee may complete an assigned task
  insert into tasks (guild_id, battle_id, creator_id, assigned_to, title, difficulty)
  values (v_guild, v_battle.id, a, a, 'a only', 'low') returning id into v_task;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  begin perform public.complete_task(v_task); raise exception 'FAIL: B completed A''s assigned task';
  exception when others then if sqlerrm not like '%assigned to someone else%' then raise; end if; end;

  -- ---- security: outsider sees nothing; internals are not callable ----------
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  select count(*) into v_n from tasks where guild_id = v_guild;
  if v_n <> 0 then raise exception 'FAIL: outsider can read % task(s) of another guild', v_n; end if;
  select count(*) into v_n from activity_feed where guild_id = v_guild;
  if v_n <> 0 then raise exception 'FAIL: outsider can read another guild''s activity'; end if;
  begin perform public.finish_weekly_battle(v_battle.id, 'won'); raise exception 'FAIL: finish_weekly_battle callable by clients';
  exception when insufficient_privilege then null; end;
  begin perform public.complete_task(v_task); raise exception 'FAIL: outsider completed a task';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; end;

  -- ---- bomb: exactly one explosion, exactly -50 -----------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  v_task := public.create_bomb_task(v_guild, 'bomb', null, b, 'low');
  if (select bomb_expires_at - created_at from tasks where id = v_task) <> interval '30 minutes' then
    raise exception 'FAIL: bomb deadline is not created_at + 30 minutes';
  end if;
  v_res := public.resolve_bomb_task(v_task);
  if (v_res ->> 'expired')::boolean then raise exception 'FAIL: bomb expired immediately'; end if;

  perform set_config('role', 'postgres', true);                     -- admin: fast-forward the deadline
  update tasks set bomb_expires_at = now() - interval '1 second' where id = v_task;
  perform set_config('role', 'authenticated', true);

  perform public.resolve_bomb_task(v_task);
  perform public.resolve_bomb_task(v_task);
  perform public.run_guild_maintenance(v_guild);
  select team_hp into v_hp from weekly_battles where id = v_battle.id;
  if v_hp <> 450 then raise exception 'FAIL: team hp % after one bomb (expected 450)', v_hp; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  begin perform public.complete_task(v_task); raise exception 'FAIL: exploded bomb was completed';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; end;

  -- ---- overdue: +20 boss HP once per task ----------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  insert into tasks (guild_id, battle_id, creator_id, title, difficulty, due_date)
  values (v_guild, v_battle.id, a, 'will be late', 'low', now() + interval '1 hour') returning id into v_task;
  perform set_config('role', 'postgres', true);
  update tasks set due_date = now() - interval '1 minute' where id = v_task;
  select boss_hp into v_hp from weekly_battles where id = v_battle.id;
  perform set_config('role', 'authenticated', true);
  perform public.check_overdue_tasks(v_guild);
  perform public.check_overdue_tasks(v_guild);
  if (select boss_hp from weekly_battles where id = v_battle.id) <> least(1000, v_hp + 20) then
    raise exception 'FAIL: overdue healed %, expected exactly +20', (select boss_hp from weekly_battles where id = v_battle.id) - v_hp;
  end if;

  -- ---- duel: one winner, winner 2x, loser 0 ---------------------------------
  select xp into v_xp_a from profiles where id = a;
  select xp into v_xp_b from profiles where id = b;
  v_duel := public.create_duel_task(v_guild, b, 'duel', null, 'medium');
  select task_id into v_ta from duel_participants where duel_id = v_duel and user_id = a;
  select task_id into v_tb from duel_participants where duel_id = v_duel and user_id = b;

  perform public.complete_duel_task(v_ta);
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  begin perform public.complete_duel_task(v_tb); raise exception 'FAIL: both duel players won';
  exception when others then if sqlerrm not like '%already ended%' then raise; end if; end;
  select winner_id into v_winner from duels where id = v_duel;
  if v_winner <> a then raise exception 'FAIL: duel winner is not the first completer'; end if;
  if (select xp from profiles where id = a) - v_xp_a <> 50 then raise exception 'FAIL: winner did not get 2 x 25 XP'; end if;
  if (select xp from profiles where id = b) <> v_xp_b then raise exception 'FAIL: loser XP changed'; end if;
  if (select count(*) from duels where id = v_duel and status = 'completed') <> 1 then raise exception 'FAIL: duel not completed exactly once'; end if;

  -- ---- loot: one persisted reward, no reroll, reveal is persisted ------------
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  v_task := public.create_loot_task(v_guild, 'loot', null, a);
  perform public.complete_task(v_task);
  if (select count(*) from user_loot where task_id = v_task) <> 1 then raise exception 'FAIL: loot not stored exactly once'; end if;
  if jsonb_array_length(public.get_pending_loot()) <> 1 then raise exception 'FAIL: unrevealed loot not reported'; end if;
  perform public.mark_loot_revealed(v_task);
  if jsonb_array_length(public.get_pending_loot()) <> 0 then raise exception 'FAIL: reveal not persisted'; end if;

  -- ---- boss defeat: history, Slayer badge, next battle, immutability --------
  perform set_config('role', 'postgres', true);
  update weekly_battles set boss_hp = 10 where id = v_battle.id;
  perform set_config('role', 'authenticated', true);
  insert into tasks (guild_id, battle_id, creator_id, title, difficulty) values (v_guild, v_battle.id, a, 'finisher', 'low') returning id into v_task;
  -- Create an unresolved bomb in the battle immediately before it is won.
  -- It must be carried into the new active battle instead of being orphaned.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  v_task_b := public.create_bomb_task(v_guild, 'rollover bomb', null, b, 'low');
  v_duel := null;
  perform set_config('role', 'postgres', true);
  select battle_id, bomb_expires_at into v_duel, v_bomb_deadline from tasks where id = v_task_b;
  if v_duel <> v_battle.id then raise exception 'FAIL: rollover bomb was not created in the expected battle'; end if;
  perform set_config('role', 'authenticated', true);

  v_res := public.complete_task(v_task);
  if not (v_res ->> 'boss_defeated')::boolean then raise exception 'FAIL: boss not defeated'; end if;
  select * into v_battle from weekly_battles where id = v_battle.id;
  if (select battle_id from tasks where id = v_task_b) = v_battle.id then
    raise exception 'FAIL: unresolved bomb stayed attached to the finished battle';
  end if;
  if (select bomb_expires_at from tasks where id = v_task_b) <> v_bomb_deadline then
    raise exception 'FAIL: bomb deadline was reset during rollover';
  end if;
  if (select status from tasks where id = v_task_b) = 'done' or (select bomb_result from tasks where id = v_task_b) is not null then
    raise exception 'FAIL: unresolved bomb was incorrectly finalized during rollover';
  end if;
  if v_battle.status <> 'won' or v_battle.finished_at is null then raise exception 'FAIL: battle not finalized'; end if;
  -- The carried bomb must still be a valid task in the new battle.
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  perform public.complete_task(v_task_b);
  if (select bomb_result from tasks where id = v_task_b) <> 'defused' then
    raise exception 'FAIL: carried bomb could not be defused in the new battle';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  if v_battle.result_summary -> 'participants' is null then raise exception 'FAIL: no participants recorded'; end if;
  if (select count(*) from weekly_battles where guild_id = v_guild and status = 'active') <> 1 then raise exception 'FAIL: expected exactly one new active battle'; end if;
  if not exists (select 1 from user_badges ub join badges bd on bd.id = ub.badge_id where ub.user_id = a and bd.criteria_type = 'battles_won') then
    raise exception 'FAIL: Slayer badge not awarded to the player who fought';
  end if;
  if exists (select 1 from user_badges ub join badges bd on bd.id = ub.badge_id where ub.user_id = c and bd.criteria_type = 'battles_won') then
    raise exception 'FAIL: outsider got a Slayer badge';
  end if;
  perform set_config('role', 'postgres', true);
  begin
    update weekly_battles set boss_hp = 1 where id = v_battle.id;
    raise exception 'FAIL: finished battle was modified';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; end;
  if (select count(*) from notifications where user_id = a and type = 'battle_won') <> 1 then raise exception 'FAIL: battle_won notification missing/duplicated'; end if;

  raise notice 'ALL GAME-RULE TESTS PASSED';
end
$$;

rollback;
