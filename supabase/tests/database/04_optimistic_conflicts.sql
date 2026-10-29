-- Business conflicts must roll back fully without triggering platform serialization retries.
create temporary table rr_assertions(name text primary key);
create function pg_temp.ok(p_condition boolean,p_name text) returns void
language plpgsql security invoker set search_path = '' as $$ begin
  if p_condition is distinct from true then raise exception using errcode='P0001',message='assertion_failed:' || p_name; end if;
  insert into pg_temp.rr_assertions values(p_name);
end $$;
create function pg_temp.must_fail(p_name text,p_sql text,p_expected text) returns void
language plpgsql security invoker set search_path = '' as $$ declare caught boolean := false; begin
  begin execute p_sql; exception when others then
    if sqlstate<>p_expected then raise exception using errcode='P0001',message='unexpected_sqlstate:' || p_name || ':' || sqlstate; end if;
    caught := true;
  end;
  perform pg_temp.ok(caught,p_name);
end $$;
do $$ declare
  v_source uuid; v_profile uuid; v_owner uuid := gen_random_uuid(); v_run radar.collection_runs;
  v_task radar.job_tasks; v_assess radar.job_tasks; v_record jsonb; v_new jsonb; v_opportunity uuid;
begin
  update radar.system_settings set value='{"enabled":false}' where key='collection_paused';
  insert into radar.sources(slug,name,category,adapter_version,enabled,approved_at)
    values('p03-conflict-' || gen_random_uuid(),'Synthetic conflict','fixture','fake-json-v1',true,now()) returning id into v_source;
  insert into radar.research_profiles(display_name,enabled,timezone) values('Temporary conflict profile',true,'UTC') returning id into v_profile;
  v_run := public.rr_create_collection_run(v_source,'p03-conflict-initial','test');
  v_task := public.rr_claim_task(v_owner,array['collect_page']);
  v_record := jsonb_build_object('source_record_key','old','source_url','https://example.invalid/old',
    'parser_version','fake-json-v1','payload_hash',repeat('a',64),'canonical',jsonb_build_object(
      'type_code','phd','title','Original fixture','title_key','original fixture','fingerprint',repeat('a',64),'fingerprint_version',1));
  perform public.rr_commit_source_page(v_task.id,v_owner,v_task.lease_generation,0,v_run.cursor_hash,'https://example.invalid/page',jsonb_build_array(v_record));
  select opportunity_id into v_opportunity from radar.source_records where source_id=v_source and source_record_key='old';
  v_run := public.rr_create_collection_run(v_source,'p03-conflict-stale','test');
  v_task := public.rr_claim_task(v_owner,array['collect_page']);
  v_new := jsonb_set(jsonb_set(v_record,'{source_record_key}','"new-before-failure"'),'{canonical,title}','"New before late failure"');
  v_record := jsonb_set(jsonb_set(v_record,'{expected_revision}','0'),'{canonical,title}','"Revised fixture"');
  perform pg_temp.must_fail('intentional canonical conflict is PT409',format('select public.rr_commit_source_page(%L,%L,%s,0,%L,%L,%L::jsonb)',
    v_task.id,v_owner,v_task.lease_generation,v_run.cursor_hash,'https://example.invalid/page',jsonb_build_array(v_new,v_record)::text),'PT409');
  perform pg_temp.ok((select count(*)=1 from radar.opportunities) and (select count(*)=1 from radar.source_records where source_id=v_source),'late conflict rolls back preceding new canonical and observation');
  perform pg_temp.ok((select page_sequence=0 and records_seen=0 and status='running' from radar.collection_runs where id=v_run.id),'late conflict leaves cursor and task retryable');
  v_assess := public.rr_claim_task(v_owner,array['assess_batch']);
  update radar.research_profiles set rules='{"positive_topics":["changed fixture"]}' where id=v_profile;
  perform pg_temp.must_fail('intentional assessment conflict is PT409',format('select public.rr_store_assessments(%L,%L,%s,%L::jsonb)',
    v_assess.id,v_owner,v_assess.lease_generation,jsonb_build_array(jsonb_build_object('opportunity_id',v_opportunity,'opportunity_revision',1,
      'profile_revision',1,'eligible',true,'score',10,'rules_version','deterministic-v1','valid_until',now()+interval '1 day'))::text),'PT409');
  perform pg_temp.ok(not exists(select 1 from radar.opportunity_assessments),'stale assessment leaves no partial result');
end $$;
