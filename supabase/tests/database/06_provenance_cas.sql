create temporary table rr_assertions(name text primary key);
create function pg_temp.ok(p_condition boolean,p_name text) returns void
language plpgsql security invoker set search_path = '' as $$ begin
  if p_condition is distinct from true then raise exception using errcode='P0001',message='assertion_failed:' || p_name; end if;
  insert into pg_temp.rr_assertions values(p_name);
end $$;
do $$ declare
  v_source uuid; v_owner uuid := gen_random_uuid(); v_run radar.collection_runs; v_task radar.job_tasks;
  v_record jsonb; v_opportunity uuid; v_token text; v_failed boolean := false;
begin
  update radar.system_settings set value='{"enabled":false}' where key='collection_paused';
  insert into radar.sources(slug,name,category,adapter_version,enabled,approved_at)
    values('p03-evidence-' || gen_random_uuid(),'Synthetic provenance fixture','fixture','fake-json-v1',true,now()) returning id into v_source;
  v_run := public.rr_create_collection_run(v_source,'p03-evidence-initial','test');
  v_task := public.rr_claim_task(v_owner,array['collect_page']);
  v_record := jsonb_build_object('source_record_key','first','source_url','https://example.invalid/first','parser_version','fake-json-v1','payload_hash',repeat('a',64),
    'canonical',jsonb_build_object('type_code','phd','title','Evidence fixture','title_key','evidence fixture','fingerprint',repeat('a',64),'fingerprint_version',1,'field_provenance','{}'::jsonb));
  perform public.rr_commit_source_page(v_task.id,v_owner,v_task.lease_generation,0,v_run.cursor_hash,'https://example.invalid/page',jsonb_build_array(v_record));
  select opportunity_id into v_opportunity from radar.source_records where source_id=v_source;
  v_token := radar.pipeline_opportunity(v_opportunity)->>'evidence_version';
  perform pg_temp.ok(v_token ~ '^[a-f0-9]{64}$','bounded opaque evidence token returned');
  v_run := public.rr_create_collection_run(v_source,'p03-evidence-authority','test');
  v_task := public.rr_claim_task(v_owner,array['collect_page']);
  v_record := v_record || jsonb_build_object('expected_revision',1,'expected_provenance_token',v_token);
  v_record := jsonb_set(v_record,'{canonical,field_provenance}',jsonb_build_object('title',jsonb_build_object(
    'source_id',v_source,'source_record_key','first','source_slug','fixture','parser_version','fake-json-v1','observed_at',now(),'authority',100)));
  perform public.rr_commit_source_page(v_task.id,v_owner,v_task.lease_generation,0,v_run.cursor_hash,'https://example.invalid/page',jsonb_build_array(v_record));
  perform pg_temp.ok((select content_revision=1 from radar.opportunities where id=v_opportunity) and radar.pipeline_opportunity(v_opportunity)->>'evidence_version'<>v_token,'evidence changes without content revision change');
  v_run := public.rr_create_collection_run(v_source,'p03-evidence-stale','test');
  v_task := public.rr_claim_task(v_owner,array['collect_page']);
  v_record := jsonb_set(v_record,'{canonical,title}','"Stale weak overwrite"');
  begin
    perform public.rr_commit_source_page(v_task.id,v_owner,v_task.lease_generation,0,v_run.cursor_hash,'https://example.invalid/page',jsonb_build_array(v_record));
  exception when sqlstate 'PT409' then v_failed := true;
  end;
  perform pg_temp.ok(v_failed,'stale provenance rejected despite current content revision');
  perform pg_temp.ok((select title='Evidence fixture' and content_revision=1 from radar.opportunities where id=v_opportunity)
    and (select page_sequence=0 and records_seen=0 from radar.collection_runs where id=v_run.id),'stale evidence cannot mutate facts or page progress');
end $$;
