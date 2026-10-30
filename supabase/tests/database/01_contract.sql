-- Runs only inside the verifier's transaction. The verifier ALWAYS rolls it back.
create temporary table rr_assertions(name text primary key);
create function pg_temp.ok(p_condition boolean,p_name text) returns void
language plpgsql security invoker set search_path = '' as $$ begin
  if p_condition is distinct from true then raise exception using errcode = 'P0001', message = 'assertion_failed:' || p_name; end if;
  insert into pg_temp.rr_assertions values(p_name);
end $$;
create function pg_temp.must_fail(p_name text,p_sql text,p_expected text) returns void
language plpgsql security invoker set search_path = '' as $$ declare v_caught boolean := false; begin
  begin execute p_sql; exception when others then
    if sqlstate <> p_expected then raise exception using errcode = 'P0001', message = 'unexpected_sqlstate:' || p_name || ':' || sqlstate; end if;
    v_caught := true;
  end;
  perform pg_temp.ok(v_caught,p_name);
end $$;

select pg_temp.ok((select count(*) = 18 from pg_catalog.pg_tables where schemaname = 'radar'),'all eighteen tables');
select pg_temp.ok((select count(*) = 18 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'radar' and c.relkind = 'r' and c.relrowsecurity),'all tables have RLS');
select pg_temp.ok((select count(*) = 11 from radar.opportunity_types),'eleven seeded types');
select pg_temp.ok(not has_schema_privilege('anon','radar','USAGE') and not has_schema_privilege('authenticated','radar','USAGE'),'private schema');
select pg_temp.ok(not exists(select 1 from pg_catalog.pg_policies where schemaname = 'radar'),'no permissive RLS policy');
select pg_temp.ok(not exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where (n.nspname = 'radar' or (n.nspname = 'public' and p.proname like 'rr_%')) and p.prosecdef),'no security definer');

do $$ declare v_function record; v_table record; begin
  for v_function in select p.oid,p.oid::regprocedure as signature from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'rr_%' loop
    perform pg_temp.ok(not has_function_privilege('anon',v_function.oid,'EXECUTE')
      and not has_function_privilege('authenticated',v_function.oid,'EXECUTE')
      and has_function_privilege('service_role',v_function.oid,'EXECUTE'),'RPC grants:' || v_function.signature);
  end loop;
  for v_table in select c.oid,c.relname from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'radar' and c.relkind = 'r' loop
    perform pg_temp.ok(not has_table_privilege('anon',v_table.oid,'SELECT')
      and not has_table_privilege('authenticated',v_table.oid,'SELECT')
      and not has_table_privilege('service_role',v_table.oid,'DELETE'),'table grants:' || v_table.relname);
  end loop;
  execute 'set local role anon';
  begin perform 1 from radar.opportunities; raise exception 'unexpected access'; exception when insufficient_privilege then null; end;
  begin perform public.rr_claim_task(gen_random_uuid(),array['maintenance']); raise exception 'unexpected access'; exception when insufficient_privilege then null; end;
  execute 'reset role';
  perform pg_temp.ok(true,'anon actual denied statements');
  execute 'set local role authenticated';
  begin perform 1 from radar.opportunities; raise exception 'unexpected access'; exception when insufficient_privilege then null; end;
  begin perform public.rr_claim_task(gen_random_uuid(),array['maintenance']); raise exception 'unexpected access'; exception when insufficient_privilege then null; end;
  execute 'reset role';
  perform pg_temp.ok(true,'authenticated actual denied statements');
  execute 'set local role service_role';
  perform 1 from radar.opportunities limit 1;
  perform public.rr_enqueue_task('maintenance','rrtest-sql-backend',jsonb_build_object('operation','health'));
  execute 'reset role';
  perform pg_temp.ok(true,'backend actual positive execution');
end $$;

do $$ declare
  v_source uuid; v_run radar.collection_runs; v_task radar.job_tasks; v_other radar.job_tasks;
  v_owner uuid := gen_random_uuid(); v_owner2 uuid := gen_random_uuid(); v_opportunity uuid;
  v_profile uuid; v_profile2 uuid; v_target uuid; v_record jsonb; v_result jsonb;
  v_notification radar.notifications; v_attempt jsonb; v_snapshot jsonb;
  v_command uuid; v_command_generation bigint; v_prepare uuid; v_prepare_generation bigint;
  v_deadline uuid; v_revision bigint; v_before timestamptz;
begin
  update radar.system_settings set value = '{"enabled":false}' where key in ('collection_paused','delivery_paused');
  insert into radar.sources(slug,name,category,adapter_version,enabled,approved_at)
    values('rrtest-sql-' || gen_random_uuid(),'Fixture source','fixture','fixture-v1',true,now()) returning id into v_source;
  v_run := public.rr_create_collection_run(v_source,'rrtest-sql-collect-1','test');
  perform pg_temp.ok((public.rr_create_collection_run(v_source,'rrtest-sql-coalesced','test')).id = v_run.id,'active source coalescing');
  v_task := public.rr_claim_task(v_owner,array['collect_page']);
  perform pg_temp.must_fail('stale fencing token',format('select public.rr_finish_task(%L,%L,%s,%L)',v_task.id,v_owner,v_task.lease_generation+1,'failed'),'55000');
  perform pg_temp.must_fail('unclaimed success transition',format('update radar.job_tasks set status = %L,finished_at = now() where request_key = %L','succeeded','rrtest-sql-backend'),'23514');
  perform pg_temp.must_fail('invalid cursor CAS',format('select public.rr_commit_source_page(%L,%L,%s,99,%L,%L,%L::jsonb)',
    v_task.id,v_owner,v_task.lease_generation,v_run.cursor_hash,'https://example.invalid/fixture','[]'),'55000');
  v_record := jsonb_build_object('source_record_key','fixture-1','source_url','https://example.invalid/fixture/1',
    'parser_version','fixture-v1','payload_hash',repeat('a',64),
    'canonical',jsonb_build_object('type_code','conference','title','Fixture conference 2027','title_key','fixture conference',
      'organization','Fixture University','organization_key','fixture university','cycle_key','2027','track_key','',
      'status','open','fingerprint','fixture-conference-2027','fingerprint_version',1),
    'identities',jsonb_build_array(jsonb_build_object('kind','natural_key','key_version',1,'value','rrtest-fixture-conference-2027')),
    'deadlines',jsonb_build_array(jsonb_build_object('kind','submission','round_key','main','label','Paper deadline',
      'due_at',now()+interval '10 days','timezone','UTC','precision','instant','basis','explicit')));
  v_result := public.rr_commit_source_page(v_task.id,v_owner,v_task.lease_generation,0,v_run.cursor_hash,
    'https://example.invalid/fixture',jsonb_build_array(v_record,v_record,jsonb_build_object('source_record_key','bad','record_status','quarantined','error_code','fixture_bad')));
  perform pg_temp.ok((v_result->>'inserted')::integer = 1 and (v_result->>'rejected')::integer = 1,'valid sibling and quarantine');
  perform pg_temp.ok((select records_seen = 2 and accepted = 1 and rejected = 1 and status = 'partial' from radar.collection_runs where id = v_run.id),'page counters and terminal partial');
  select opportunity_id into v_opportunity from radar.source_records where source_id = v_source and source_record_key = 'fixture-1';
  select id into v_deadline from radar.opportunity_deadlines where opportunity_id = v_opportunity;
  select next_due_at into v_before from radar.sources where id = v_source;
  v_result := public.rr_commit_source_page(v_task.id,v_owner,v_task.lease_generation,0,v_run.cursor_hash,'https://example.invalid/fixture',jsonb_build_array(v_record));
  perform pg_temp.ok((v_result->>'replayed')::boolean and (select records_seen = 2 from radar.collection_runs where id = v_run.id),'completed page replay');
  perform pg_temp.ok((select next_due_at = v_before from radar.sources where id = v_source),'replay cannot advance cadence twice');
  perform pg_temp.must_fail('terminal task cannot reopen',format('update radar.job_tasks set status = %L,finished_at = null where id = %L','queued',v_task.id),'23514');
  perform pg_temp.must_fail('duplicate source record identity',format('insert into radar.source_records(source_id,source_record_key,source_url,parser_version,payload_hash,record_status,error_code) values(%L,%L,%L,%L,%L,%L,%L)',v_source,'fixture-1','https://example.invalid/fixture','fixture-v1','a','quarantined','bad'),'23505');
  perform pg_temp.must_fail('instant needs timezone',format('insert into radar.opportunity_deadlines(opportunity_id,kind,round_key,label,due_at,precision,basis) values(%L,%L,%L,%L,now(),%L,%L)',v_opportunity,'application','invalid','Invalid','instant','explicit'),'23514');
  perform pg_temp.must_fail('deadline cannot move without revision',format('update radar.opportunity_deadlines set due_at = due_at + interval %L where id = %L','1 day',v_deadline),'23514');
  -- Refetch updates one source observation and never refreshes canonical freshness/revision.
  select content_revision into v_revision from radar.opportunities where id = v_opportunity;
  v_run := public.rr_create_collection_run(v_source,'rrtest-sql-collect-2','test');
  v_task := public.rr_claim_task(v_owner,array['collect_page']);
  v_result := public.rr_commit_source_page(v_task.id,v_owner,v_task.lease_generation,0,v_run.cursor_hash,'https://example.invalid/fixture',jsonb_build_array(v_record));
  perform pg_temp.ok((v_result->>'duplicates')::integer = 1 and (select content_revision = v_revision from radar.opportunities where id = v_opportunity),'identical refetch is unchanged');
  insert into radar.research_profiles(display_name,enabled,timezone,digest_enabled,reminders_enabled,rules)
    values('Fixture profile',true,'UTC',true,true,'{"positive_topics":["fixture"]}') returning id into v_profile;
  insert into radar.research_profiles(display_name) values('Other fixture') returning id into v_profile2;
  insert into radar.delivery_targets(profile_id,bot_id,external_account_id,external_chat_id,enabled)
    values(v_profile,'1','1','1',true) returning id into v_target;
  v_result := public.rr_accept_telegram_update(v_target,'1',10,'{"action":"help"}');
  perform pg_temp.ok(not (v_result->>'duplicate')::boolean,'new inbox action');
  perform pg_temp.ok((public.rr_accept_telegram_update(v_target,'1',10,'{"action":"help"}')->>'duplicate')::boolean,'duplicate inbox update');
  perform pg_temp.ok((select count(*) = 1 from radar.job_tasks where telegram_bot_id = '1' and telegram_update_id = 10),'one inbox task');
  v_other := public.rr_claim_task(v_owner,array['telegram_command']);
  v_command := v_other.id; v_command_generation := v_other.lease_generation;
  perform public.rr_apply_feedback(v_profile,v_opportunity,'save','save-one','{}',v_command,v_owner,v_command_generation);
  perform public.rr_apply_feedback(v_profile,v_opportunity,'save','save-one','{}',v_command,v_owner,v_command_generation);
  perform public.rr_apply_feedback(v_profile,v_opportunity,'ignore','ignore-one','{}',v_command,v_owner,v_command_generation);
  perform pg_temp.ok((select saved and ignored from radar.user_opportunity_state where profile_id = v_profile and opportunity_id = v_opportunity),'save plus ignore consistency');
  perform pg_temp.ok((select count(*) = 2 from radar.user_feedback where profile_id = v_profile),'feedback replay does not toggle or append');
  perform public.rr_apply_feedback(v_profile,v_opportunity,'unignore','unignore-one','{}',v_command,v_owner,v_command_generation);
  perform pg_temp.must_fail('feedback key mismatch',format('select public.rr_apply_feedback(%L,%L,%L,%L,%L::jsonb,%L,%L,%s)',v_profile,v_opportunity,'ignore','save-one','{}',v_command,v_owner,v_command_generation),'22023');
  perform pg_temp.must_fail('feedback needs live fencing context',format('select public.rr_apply_feedback(%L,%L,%L,%L)',v_profile,v_opportunity,'save','unfenced'),'55000');
  perform pg_temp.must_fail('excluded assessment cannot have score',format('insert into radar.opportunity_assessments(profile_id,opportunity_id,eligible,score,opportunity_revision,profile_revision,rules_version,valid_until) values(%L,%L,false,10,1,1,%L,now()+interval %L)',v_profile,v_opportunity,'fixture','1 day'),'23514');
  -- Store handwritten results, not a ranking implementation.
  v_task := public.rr_enqueue_task('assess_batch','rrtest-assess',jsonb_build_object('profile_id',v_profile,'opportunity_ids',jsonb_build_array(v_opportunity::text)));
  v_task := public.rr_claim_task(v_owner,array['assess_batch']);
  perform public.rr_store_assessments(v_task.id,v_owner,v_task.lease_generation,jsonb_build_array(jsonb_build_object(
    'opportunity_id',v_opportunity,'eligible',true,'score',75,'opportunity_revision',v_revision,'profile_revision',1,'rules_version','deterministic-v2','valid_until',now()+interval '1 day')));
  v_snapshot := jsonb_build_array(jsonb_build_object('opportunity_id',v_opportunity,'part_index',0,'snapshot',jsonb_build_object('opportunity_revision',v_revision)));
  perform public.rr_enqueue_task('prepare_digest','rrtest-prepare-digest',jsonb_build_object('profile_id',v_profile,'local_date',current_date));
  v_other := public.rr_claim_task(v_owner,array['prepare_digest']);
  v_prepare := v_other.id; v_prepare_generation := v_other.lease_generation;
  v_notification := public.rr_prepare_notification(v_profile,v_target,'digest','digest:' || current_date,
    now()-interval '1 second',now()+interval '1 day','[{"text":"Fixture digest"}]',v_snapshot,current_date,'UTC',v_prepare,v_owner,v_prepare_generation);
  perform pg_temp.ok((public.rr_prepare_notification(v_profile,v_target,'digest','digest:' || current_date,
    now()-interval '1 second',now()+interval '1 day','[{"text":"Fixture digest"}]',v_snapshot,current_date,'UTC',v_prepare,v_owner,v_prepare_generation)).id = v_notification.id,'digest schedule replay');
  perform public.rr_enqueue_task('prepare_digest','rrtest-prepare-digest-next',jsonb_build_object('profile_id',v_profile,'local_date',current_date+1));
  v_other := public.rr_claim_task(v_owner,array['prepare_digest']);
  perform pg_temp.must_fail('duplicate digest item claim',format('select public.rr_prepare_notification(%L,%L,%L,%L,now()-interval %L,now()+interval %L,%L::jsonb,%L::jsonb,%L::date,%L,%L,%L,%s)',
    v_profile,v_target,'digest','digest:' || (current_date+1),'1 second','1 day','[{"text":"Fixture"}]',v_snapshot::text,(current_date+1)::text,'UTC',v_other.id,v_owner,v_other.lease_generation),'23505');
  perform pg_temp.must_fail('cross profile target FK',format('insert into radar.notifications(profile_id,delivery_target_id,kind,schedule_key,due_at,expires_at,parts,part_states) values(%L,%L,%L,%L,now(),now()+interval %L,%L::jsonb,%L::jsonb)',
    v_profile2,v_target,'command_reply','fixture-cross','1 day','[{"text":"Fixture"}]','["prepared"]'),'23503');
  v_task := public.rr_claim_task(v_owner,array['send_notification']);
  v_attempt := public.rr_begin_notification_attempt(v_task.id,v_owner,v_task.lease_generation);
  perform public.rr_finish_notification_attempt(v_task.id,v_owner,v_task.lease_generation,(v_attempt->>'attempt_id')::uuid,'uncertain',null,'fixture_timeout');
  perform pg_temp.ok((select status = 'uncertain' from radar.notifications where id = v_notification.id),'uncertain aggregate state');
  perform pg_temp.ok((select claim_active from radar.notification_items where notification_id = v_notification.id),'uncertain retains delivery claim');
  perform public.rr_enqueue_task('send_notification','rrtest-unsafe-resend',jsonb_build_object('notification_id',v_notification.id,'part_index',0),now(),now()+interval '1 day');
  v_task := public.rr_claim_task(v_owner,array['send_notification']);
  perform pg_temp.must_fail('uncertain cannot be blindly resent',format('select public.rr_begin_notification_attempt(%L,%L,%s)',v_task.id,v_owner,v_task.lease_generation),'55000');
  -- Actual lease expiry/reclamation, not a mock or direct edit of the lease.
  perform public.rr_enqueue_task('prepare_reminders','rrtest-expiring',jsonb_build_object('profile_id',v_profile));
  v_task := public.rr_claim_task(v_owner,array['prepare_reminders'],1);
  perform pg_sleep(1.1);
  v_other := public.rr_claim_task(v_owner2,array['prepare_reminders']);
  perform pg_temp.ok(v_task.id = v_other.id and v_other.lease_generation = v_task.lease_generation+1,'expired task reclaimed with new generation');
  perform pg_temp.must_fail('old owner cannot commit after reclaim',format('select public.rr_finish_task(%L,%L,%s,%L)',v_task.id,v_owner,v_task.lease_generation,'succeeded'),'55000');
  perform public.rr_finish_task(v_other.id,v_owner2,v_other.lease_generation,'succeeded');
  perform pg_temp.must_fail('invalid IANA timezone',format('update radar.research_profiles set timezone = %L where id = %L','Invented/Zone',v_profile),'23514');
end $$;
select pg_temp.ok((select count(*) >= 65 from pg_temp.rr_assertions),'nonempty assertion coverage');
