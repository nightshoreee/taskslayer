# Concurrency check for Duel completion (pgbench)

`game_rules.sql` proves the rules one request at a time. This proves "exactly
one winner" when two players finish **at the same instant**, using real
concurrent database sessions. It was written but **not run** by its author (no
PostgreSQL was available); run it once against a scratch database.

1. In `psql`, create a guild with two members and one duel, and note the ids
   (use `create_guild`, `join_guild`, `create_duel_task` as in `game_rules.sql`
   — remember to `COMMIT`, this test needs the rows to be visible to other sessions).
   Get `A_UID`, `B_UID` and each player's duel task id:
   `select user_id, task_id from duel_participants where duel_id = '<duel id>';`
2. Save as `duel.pgbench`:

```
\set n random(0, 1)
select case when :client_id = 0 then :'a_uid' else :'b_uid' end as uid,
       case when :client_id = 0 then :'a_task' else :'b_task' end as task \gset
begin;
select set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', :'uid'), true);
select set_config('role', 'authenticated', true);
select public.complete_duel_task(:'task'::uuid);
commit;
```

3. Fire both clients at once (one transaction each):

```
pgbench "$DATABASE_URL" -n -c 2 -j 2 -t 1 -f duel.pgbench \
  -D a_uid=<A_UID> -D b_uid=<B_UID> -D a_task=<A_TASK> -D b_task=<B_TASK>
```

4. Expected: one client succeeds and the other fails with `The duel has already
   ended` (never `deadlock detected`, which the old lock order could produce).
   Then confirm the invariant:

```sql
select status, winner_id from duels where id = '<duel id>';          -- completed, exactly one winner
select user_id, xp from profiles where id in ('<A_UID>', '<B_UID>');  -- winner +50 (medium), loser unchanged
```

The same recipe works for `complete_task` (two clients, same task id: one
succeeds, one gets "already been completed", boss HP drops once) and for
`resolve_bomb_task` (two clients after the deadline: Team HP drops exactly 50 once).
