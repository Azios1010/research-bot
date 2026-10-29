-- Fenced reads, provenance binding, atomic handoff and disabled-source cancellation.
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
  v_source uuid; v_profile uuid; v_extra uuid; v_owner uuid := gen_random_uuid();
  v_run radar.collection_runs; v_task radar.job_tasks; v_assess radar.job_tasks;
  v_record jsonb; v_opportunity uuid; v_observation uuid; v_context jsonb;
begin
  update radar.system_settings set value='{"enabled":false}' where key='collection_paused';
  insert into radar.sources(slug,name,category,adapter_version,enabled,approved_at)
    values('p03-' || gen_random_uuid(),'Synthetic fixture','fixture','fake-json-v1',true,now()) returning id into v_source;
  insert into radar.research_profiles(display_name,enabled,timezone,rules)
    values('Temporary pipeline profile',true,'UTC','{"positive_topics":["fixture"]}') returning id into v_profile;
  v_run := public.rr_create_collection_run(v_source,'p03-read-run','test');
  v_task := public.rr_claim_task(v_owner,array['collect_page']);
  v_context := public.rr_read_collection_context(v_task.id,v_owner,v_task.lease_generation);
  perform pg_temp.ok((v_context->'source'->>'id')::uuid=v_source and not (v_context->>'replayed')::boolean,'live collection context');
  perform pg_temp.must_fail('read rejects stale owner',format('select public.rr_read_collection_context(%L,%L,%s)',v_task.id,gen_random_uuid(),v_task.lease_generation),'55000');
  perform pg_temp.must_fail('bounded candidate read',format('select public.rr_read_candidates(%L,%L,%s,%L::jsonb)',v_task.id,v_owner,v_task.lease_generation,'[]'),'22023');
  perform pg_temp.ok(public.rr_read_candidates(v_task.id,v_owner,v_task.lease_generation,
    jsonb_build_array(jsonb_build_object('record_key','first','fingerprint',repeat('a',64),'fingerprint_version',1,'identities','[]'::jsonb)))
    ->0->'matches'='[]'::jsonb,'empty candidates are explicit');
  v_record := jsonb_build_object('source_record_key','first','source_url','https://example.invalid/first',
    'parser_version','fake-json-v1','payload_hash',repeat('a',64),
    'canonical',jsonb_build_object('type_code','phd','title','Pipeline fixture','title_key','pipeline fixture',
      'fingerprint',repeat('a',64),'fingerprint_version',1,'field_provenance',jsonb_build_object('title',jsonb_build_object(
        'source_id',v_source,'source_record_key','first','source_slug','fixture','parser_version','fake-json-v1','observed_at',now(),'authority',5))));
  insert into radar.research_profiles(display_name,enabled,timezone) values('Extra unsupported fixture',true,'UTC') returning id into v_extra;
  perform pg_temp.must_fail('late handoff failure rolls back entire page',format('select public.rr_commit_source_page(%L,%L,%s,0,%L,%L,%L::jsonb)',
    v_task.id,v_owner,v_task.lease_generation,v_run.cursor_hash,'https://example.invalid/page',jsonb_build_array(v_record)::text),'55000');
  perform pg_temp.ok(not exists(select 1 from radar.opportunities) and (select page_sequence=0 and records_seen=0 from radar.collection_runs where id=v_run.id),'no partial canonical or advanced cursor');
  update radar.research_profiles set enabled=false where id=v_extra;
  perform public.rr_commit_source_page(v_task.id,v_owner,v_task.lease_generation,0,v_run.cursor_hash,'https://example.invalid/page',jsonb_build_array(v_record));
  select id,opportunity_id into v_observation,v_opportunity from radar.source_records where source_id=v_source and source_record_key='first';
  perform pg_temp.ok((select field_provenance->'title'->>'source_record_id'=v_observation::text from radar.opportunities where id=v_opportunity),'new observation provenance UUID bound atomically');
  perform pg_temp.ok((select count(*)=1 from radar.job_tasks where kind='assess_batch' and payload->>'profile_id'=v_profile::text),'page assessment handoff is durable');
  perform pg_temp.ok((public.rr_read_collection_context(v_task.id,v_owner,v_task.lease_generation)->>'replayed')::boolean,'completed page context is a tombstone');
  v_assess := public.rr_claim_task(v_owner,array['assess_batch']);
  v_context := public.rr_read_assessment_context(v_assess.id,v_owner,v_assess.lease_generation);
  perform pg_temp.ok(jsonb_array_length(v_context->'items')=1 and (v_context->'profile'->>'id')::uuid=v_profile,'assessment context binds batch and profile');
  perform pg_temp.must_fail('assessment read rejects stale fence',format('select public.rr_read_assessment_context(%L,%L,%s)',v_assess.id,v_owner,v_assess.lease_generation+1),'55000');
  perform public.rr_finish_task(v_assess.id,v_owner,v_assess.lease_generation,'failed','fixture_done');
  v_run := public.rr_create_collection_run(v_source,'p03-disabled-run','test');
  v_task := public.rr_claim_task(v_owner,array['collect_page']);
  update radar.sources set enabled=false where id=v_source;
  perform public.rr_finish_task(v_task.id,v_owner,v_task.lease_generation,'canceled','source_disabled');
  perform pg_temp.ok((select status='canceled' and records_seen=0 from radar.collection_runs where id=v_run.id),'disabled source cancels without committing a page');
  perform pg_temp.ok((select consecutive_failures=0 from radar.sources where id=v_source),'cancellation does not damage source health');
end $$;
