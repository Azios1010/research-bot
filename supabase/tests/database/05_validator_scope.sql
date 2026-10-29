create temporary table rr_assertions(name text primary key);
create function pg_temp.ok(p_condition boolean,p_name text) returns void
language plpgsql security invoker set search_path = '' as $$ begin
  if p_condition is distinct from true then raise exception using errcode='P0001',message='assertion_failed:' || p_name; end if;
  insert into pg_temp.rr_assertions values(p_name);
end $$;
do $$ declare
  v_source uuid; v_owner uuid := gen_random_uuid(); v_run radar.collection_runs; v_task radar.job_tasks;
begin
  update radar.system_settings set value='{"enabled":false}' where key='collection_paused';
  insert into radar.sources(slug,name,category,adapter_version,enabled,approved_at)
    values('p03-cache-' || gen_random_uuid(),'Synthetic cache fixture','fixture','fake-json-v1',true,now()) returning id into v_source;
  v_run := public.rr_create_collection_run(v_source,'p03-cache-full','test');
  v_task := public.rr_claim_task(v_owner,array['collect_page']);
  perform public.rr_commit_source_page(v_task.id,v_owner,v_task.lease_generation,0,v_run.cursor_hash,'https://example.invalid/page','[]',null,false,'v0','{"etag":"v0"}');
  v_run := public.rr_create_collection_run(v_source,'p03-cache-interrupted','test');
  v_task := public.rr_claim_task(v_owner,array['collect_page']);
  perform pg_temp.ok(public.rr_read_collection_context(v_task.id,v_owner,v_task.lease_generation)->'validators'='{"etag":"v0"}'::jsonb,'latest complete matching snapshot reuses validators');
  perform public.rr_commit_source_page(v_task.id,v_owner,v_task.lease_generation,0,v_run.cursor_hash,'https://example.invalid/page','[]','{"page":1}',false,'v1','{"etag":"v1"}');
  v_task := public.rr_claim_task(v_owner,array['collect_page']);
  perform public.rr_finish_task(v_task.id,v_owner,v_task.lease_generation,'failed','fixture_document_failed');
  v_run := public.rr_create_collection_run(v_source,'p03-cache-after-interruption','test');
  v_task := public.rr_claim_task(v_owner,array['collect_page']);
  perform pg_temp.ok(public.rr_read_collection_context(v_task.id,v_owner,v_task.lease_generation)->'validators'='{}'::jsonb,'interrupted snapshot cannot fall back to older complete validators');
  perform public.rr_commit_source_page(v_task.id,v_owner,v_task.lease_generation,0,v_run.cursor_hash,'https://example.invalid/page','[]',null,false,'v2','{"etag":"v2"}');
  update radar.sources set config_version=config_version+1 where id=v_source;
  v_run := public.rr_create_collection_run(v_source,'p03-cache-new-config','test');
  v_task := public.rr_claim_task(v_owner,array['collect_page']);
  perform pg_temp.ok(public.rr_read_collection_context(v_task.id,v_owner,v_task.lease_generation)->'validators'='{}'::jsonb,'new config invalidates conditional validators');
  perform public.rr_commit_source_page(v_task.id,v_owner,v_task.lease_generation,0,v_run.cursor_hash,'https://example.invalid/page','[]',null,false,'v3','{"etag":"v3"}');
  update radar.sources set adapter_version='fake-json-v2' where id=v_source;
  v_run := public.rr_create_collection_run(v_source,'p03-cache-new-parser','test');
  v_task := public.rr_claim_task(v_owner,array['collect_page']);
  perform pg_temp.ok(public.rr_read_collection_context(v_task.id,v_owner,v_task.lease_generation)->'validators'='{}'::jsonb,'new parser invalidates conditional validators');
  perform public.rr_commit_source_page(v_task.id,v_owner,v_task.lease_generation,0,v_run.cursor_hash,'https://example.invalid/page',
    '[{"source_record_key":"broken","record_status":"quarantined","error_code":"fixture"}]',null,false,'v4','{"etag":"v4"}');
  v_run := public.rr_create_collection_run(v_source,'p03-cache-complete-quarantine','test');
  v_task := public.rr_claim_task(v_owner,array['collect_page']);
  perform pg_temp.ok(public.rr_read_collection_context(v_task.id,v_owner,v_task.lease_generation)->'validators'='{"etag":"v4"}'::jsonb,'fully processed partial page remains conditionally cacheable');
end $$;
