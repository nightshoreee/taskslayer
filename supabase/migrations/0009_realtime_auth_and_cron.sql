-- ============================================================================
-- TASKSLAYER — 0009: guild-scoped presence + background maintenance
--
-- Both parts are OPTIONAL infrastructure and both are guarded: if the platform
-- feature isn't available (non-Supabase Postgres, pg_cron not enabled, no
-- permission on realtime.messages) the block emits a WARNING and the migration
-- still succeeds. Nothing here changes game rules.
--
-- 1. Realtime Authorization. Presence ("who is online") runs on a PRIVATE
--    channel named  presence:<guild_id>.  These policies let a signed-in user
--    join/track only the presence channel of a guild they belong to. Without
--    them a private channel is unreachable, and the Guild page shows everyone
--    as offline (it logs a console error pointing back here).
-- 2. pg_cron. Resolves expired bombs, overdue penalties and battle deadlines
--    every minute even when nobody has the app open. Enable the extension first
--    (Dashboard -> Database -> Extensions -> pg_cron). Without it the app still
--    resolves them, on the database clock, whenever a member has it open.
-- ============================================================================

do $$
begin
  if to_regclass('realtime.messages') is null then
    raise notice 'realtime.messages not found; skipping realtime authorization policies';
    return;
  end if;

  drop policy if exists "guild members can receive presence" on realtime.messages;
  drop policy if exists "guild members can announce presence" on realtime.messages;

  create policy "guild members can receive presence" on realtime.messages
    for select to authenticated
    using (
      realtime.messages.extension = 'presence'
      and exists (
        select 1 from public.guild_members gm
         where gm.user_id = (select auth.uid())
           and (select realtime.topic()) = 'presence:' || gm.guild_id::text
      )
    );

  create policy "guild members can announce presence" on realtime.messages
    for insert to authenticated
    with check (
      realtime.messages.extension = 'presence'
      and exists (
        select 1 from public.guild_members gm
         where gm.user_id = (select auth.uid())
           and (select realtime.topic()) = 'presence:' || gm.guild_id::text
      )
    );
exception when others then
  raise warning 'Could not create realtime authorization policies (%): presence will show everyone offline until they exist', sqlerrm;
end
$$;

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron is not enabled; skipping the maintenance schedule (the app resolves deadlines while open)';
    return;
  end if;

  perform cron.schedule(
    'taskslayer-maintenance',
    '* * * * *',
    $cron$ select public.run_guild_maintenance(id) from public.guilds $cron$
  );
exception when others then
  raise warning 'Could not schedule pg_cron maintenance: %', sqlerrm;
end
$$;
