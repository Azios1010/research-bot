-- ADR 0008: preserve private tables; expose only bounded fenced pipeline contexts.
create function radar.pipeline_opportunity(p_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_result jsonb;
begin
  if (select count(*) from (select 1 from radar.source_records where opportunity_id=p_id limit 101) q)>100
    or (select count(*) from (select 1 from radar.opportunity_deadlines where opportunity_id=p_id limit 101) q)>100 then
    raise exception using errcode='54000',message='opportunity_context_too_large';
  end if;
  select jsonb_build_object('opportunity',to_jsonb(o),
    'deadlines',coalesce((select jsonb_agg(to_jsonb(d) order by d.kind,d.round_key)
      from radar.opportunity_deadlines d where d.opportunity_id=o.id),'[]'),
    'origins',coalesce((select jsonb_agg(jsonb_build_object('record_id',r.id,'source_id',r.source_id,
      'record_key',r.source_record_key,'source_slug',s.slug,'parser_version',r.parser_version,
      'observed_at',r.last_seen_at,'field_authority',coalesce(s.config->'field_authority','{}')))
      from radar.source_records r join radar.sources s on s.id=r.source_id where r.opportunity_id=o.id),'[]'))
  into v_result from radar.opportunities o where o.id=p_id;
  return v_result;
end
$$;

create function public.rr_read_collection_context(p_task uuid,p_owner uuid,p_generation bigint)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_task radar.job_tasks; v_run radar.collection_runs; v_source radar.sources; v_validators jsonb;
begin
  select * into strict v_task from radar.job_tasks where id=p_task;
  if v_task.kind <> 'collect_page' then raise exception using errcode='22023',message='collection_context_kind_invalid'; end if;
  if v_task.status <> 'succeeded' then v_task := radar.require_lease(p_task,p_owner,p_generation,'collect_page'); end if;
  select * into strict v_run from radar.collection_runs where id=v_task.collection_run_id;
  select * into strict v_source from radar.sources where id=v_run.source_id;
  if v_task.status <> 'succeeded' and (v_run.config_version <> v_source.config_version or v_run.adapter_version <> v_source.adapter_version) then
    raise exception using errcode='55000',message='source_run_not_current';
  end if;
  v_validators := v_run.conditional_validators;
  if v_run.page_sequence=0 and v_validators='{}'::jsonb then
    select conditional_validators into v_validators from radar.collection_runs
      where source_id=v_source.id and id<>v_run.id and status in ('succeeded','partial')
      order by finished_at desc,id limit 1;
  end if;
  return jsonb_build_object('source',to_jsonb(v_source),'run',to_jsonb(v_run),
    'page_sequence',(v_task.payload->>'page_sequence')::bigint,'cursor_hash',v_task.payload->>'cursor_hash',
    'validators',coalesce(v_validators,'{}'),'replayed',v_task.status='succeeded','paused',radar.paused('collection_paused'));
end
$$;

create function public.rr_read_candidates(p_task uuid,p_owner uuid,p_generation bigint,p_records jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_task radar.job_tasks; v_source uuid; v_request jsonb; v_identity jsonb; v_record radar.source_records;
  v_strong uuid[]; v_ids uuid[]; v_id uuid; v_matches jsonb; v_result jsonb := '[]'; v_seen text[] := '{}';
  v_key text; v_truncated boolean;
begin
  v_task := radar.require_lease(p_task,p_owner,p_generation,'collect_page');
  select source_id into strict v_source from radar.collection_runs where id=v_task.collection_run_id;
  if jsonb_typeof(p_records) is distinct from 'array' or jsonb_array_length(p_records) not between 1 and 20 or octet_length(p_records::text)>262144 then
    raise exception using errcode='22023',message='candidate_batch_invalid';
  end if;
  for v_request in select value from jsonb_array_elements(p_records) loop
    v_key := v_request->>'record_key';
    if not radar.object_ok(v_request,32768) or v_request - array['record_key','fingerprint','fingerprint_version','identities'] <> '{}'::jsonb
      or v_key is null or octet_length(v_key) not between 1 and 2000 or v_key=any(v_seen)
      or coalesce(v_request->>'fingerprint','') !~ '^[a-f0-9]{64}$' or coalesce((v_request->>'fingerprint_version')::integer,0)<1
      or jsonb_typeof(v_request->'identities') is distinct from 'array' or jsonb_array_length(v_request->'identities')>20 then
      raise exception using errcode='22023',message='candidate_request_invalid';
    end if;
    v_seen := array_append(v_seen,v_key); v_strong := '{}'; v_truncated := false;
    select * into v_record from radar.source_records where source_id=v_source and source_record_key=v_key;
    for v_identity in select value from jsonb_array_elements(v_request->'identities') loop
      if not radar.object_ok(v_identity,8192) or v_identity - array['kind','key_version','value'] <> '{}'::jsonb
        or coalesce(v_identity->>'kind','') not in ('listing_url','natural_key')
        or coalesce((v_identity->>'key_version')::integer,0)<1 or coalesce(octet_length(v_identity->>'value'),0) not between 1 and 2000 then
        raise exception using errcode='22023',message='candidate_identity_invalid';
      end if;
      select opportunity_id into v_id from radar.opportunity_identities where kind=v_identity->>'kind'
        and key_version=(v_identity->>'key_version')::integer and value=v_identity->>'value';
      if found then v_strong := array_append(v_strong,v_id); end if;
    end loop;
    select coalesce(array_agg(distinct x order by x),'{}') into v_ids from unnest(v_strong || array[v_record.opportunity_id]) x where x is not null;
    if cardinality(v_ids)=0 then
      select coalesce(array_agg(id order by id),'{}') into v_ids from (
        select id from radar.opportunities where fingerprint_version=(v_request->>'fingerprint_version')::integer
          and fingerprint=v_request->>'fingerprint' order by id limit 6) q;
      v_truncated := cardinality(v_ids)>5;
      v_ids := v_ids[1:5];
    elsif cardinality(v_ids)>1 then v_ids := '{}'; end if;
    select coalesce(jsonb_agg(radar.pipeline_opportunity(id) order by id),'[]') into v_matches from unnest(v_ids) x(id);
    v_result := v_result || jsonb_build_array(jsonb_build_object('record_key',v_key,'observation_id',v_record.id,
      'observation_opportunity_id',v_record.opportunity_id,'strong_ids',to_jsonb(v_strong),'matches',v_matches,'truncated',v_truncated));
    if octet_length(v_result::text)>2097152 then raise exception using errcode='54000',message='candidate_context_too_large'; end if;
  end loop;
  return v_result;
end
$$;

create function public.rr_read_assessment_context(p_task uuid,p_owner uuid,p_generation bigint)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_task radar.job_tasks; v_profile radar.research_profiles; v_ids uuid[]; v_result jsonb;
begin
  v_task := radar.require_lease(p_task,p_owner,p_generation,'assess_batch');
  select * into strict v_profile from radar.research_profiles where id=(v_task.payload->>'profile_id')::uuid;
  select array_agg(value::uuid) into v_ids from jsonb_array_elements_text(v_task.payload->'opportunity_ids');
  if cardinality(v_ids) not between 1 and 100 or (select count(*) from radar.opportunities where id=any(v_ids))<>cardinality(v_ids) then
    raise exception using errcode='22023',message='assessment_context_membership_invalid';
  end if;
  select jsonb_build_object('profile',to_jsonb(v_profile),
    'enabled_types',(select jsonb_agg(code order by code) from radar.opportunity_types where enabled),
    'items',jsonb_agg(jsonb_build_object('context',radar.pipeline_opportunity(id),
      'state',coalesce((select jsonb_build_object('saved',s.saved,'ignored',s.ignored) from radar.user_opportunity_state s
        where s.profile_id=v_profile.id and s.opportunity_id=x.id),'{"saved":false,"ignored":false}'::jsonb)) order by id))
    into v_result from unnest(v_ids) x(id);
  if octet_length(v_result::text)>2097152 then raise exception using errcode='54000',message='assessment_context_too_large'; end if;
  return v_result;
end
$$;

create function radar.bind_pipeline_provenance(p_value jsonb,p_source uuid,p_key text,p_record uuid)
returns jsonb language plpgsql immutable security invoker set search_path = '' as $$
declare v_field text; v_origin jsonb; v_result jsonb := '{}';
begin
  for v_field,v_origin in select key,value from jsonb_each(p_value) loop
    if v_origin->>'source_id'=p_source::text and v_origin->>'source_record_key'=p_key then
      v_origin := (v_origin - array['source_id','source_record_key']) || jsonb_build_object('source_record_id',p_record);
    end if;
    v_result := v_result || jsonb_build_object(v_field,v_origin);
  end loop;
  return v_result;
end
$$;

create function radar.enqueue_page_assessments(p_run uuid,p_sequence bigint,p_keys text[])
returns void language plpgsql security invoker set search_path = '' as $$
declare v_source uuid; v_profile uuid; v_ids uuid[];
begin
  if (select count(*) from radar.research_profiles where enabled)>1 then
    raise exception using errcode='55000',message='multiple_enabled_profiles_unsupported';
  end if;
  select id into v_profile from radar.research_profiles where enabled;
  if not found then return; end if;
  select source_id into strict v_source from radar.collection_runs where id=p_run;
  select array_agg(distinct opportunity_id order by opportunity_id) into v_ids from radar.source_records
    where source_id=v_source and last_run_id=p_run and source_record_key=any(p_keys) and record_status='accepted';
  if coalesce(cardinality(v_ids),0)=0 then return; end if;
  perform public.rr_enqueue_task('assess_batch','assess:' || p_run || ':' || p_sequence || ':' || v_profile,
    jsonb_build_object('profile_id',v_profile,'opportunity_ids',to_jsonb(v_ids)));
end
$$;

revoke all on function public.rr_read_collection_context(uuid,uuid,bigint) from public,anon,authenticated;
revoke all on function public.rr_read_candidates(uuid,uuid,bigint,jsonb) from public,anon,authenticated;
revoke all on function public.rr_read_assessment_context(uuid,uuid,bigint) from public,anon,authenticated;
grant execute on function public.rr_read_collection_context(uuid,uuid,bigint) to service_role;
grant execute on function public.rr_read_candidates(uuid,uuid,bigint,jsonb) to service_role;
grant execute on function public.rr_read_assessment_context(uuid,uuid,bigint) to service_role;
revoke all on function radar.pipeline_opportunity(uuid) from public,anon,authenticated;
revoke all on function radar.bind_pipeline_provenance(jsonb,uuid,text,uuid) from public,anon,authenticated;
revoke all on function radar.enqueue_page_assessments(uuid,bigint,text[]) from public,anon,authenticated;
grant execute on function radar.pipeline_opportunity(uuid) to service_role;
grant execute on function radar.bind_pipeline_provenance(jsonb,uuid,text,uuid) to service_role;
grant execute on function radar.enqueue_page_assessments(uuid,bigint,text[]) to service_role;

-- Compatible replacements below are copied from the immutable Phase 02 definitions.

create or replace function radar.upsert_record(p_source uuid,p_run uuid,p_record jsonb)
returns text language plpgsql security invoker set search_path = '' as $$
declare
  v_record radar.source_records; v_old radar.opportunities; v_can radar.opportunities;
  v_deadline radar.opportunity_deadlines; v_old_deadline radar.opportunity_deadlines;
  v_id uuid; v_ids uuid[] := '{}'; v_identity jsonb; v_deadline_json jsonb;
  v_canonical jsonb := p_record->'canonical'; v_record_id uuid;
  v_hash text; v_new boolean := false; v_changed boolean := false; v_deadline_changed boolean := false;
  v_expected bigint := (p_record->>'expected_revision')::bigint;
  v_allowed text[] := array['type_code','title','title_key','organization','organization_key','description',
    'topics','qualification_tags','country_codes','location_text','work_mode','canonical_url','published_at',
    'cycle_key','track_key','parent_opportunity_id','event_start','event_end','status','fingerprint','fingerprint_version',
    'attributes','quality_flags','field_provenance'];
begin
  if not radar.object_ok(v_canonical,65536) or v_canonical - v_allowed <> '{}'::jsonb
    or coalesce(v_canonical->>'status','unknown') = 'merged'
    or jsonb_typeof(coalesce(p_record->'identities','[]')) <> 'array'
    or jsonb_array_length(coalesce(p_record->'identities','[]')) > 20
    or jsonb_typeof(coalesce(p_record->'deadlines','[]')) <> 'array'
    or jsonb_array_length(coalesce(p_record->'deadlines','[]')) > 30 then
    raise exception using errcode = '22023', message = 'canonical_proposal_invalid';
  end if;
  select * into v_record from radar.source_records
    where source_id = p_source and source_record_key = p_record->>'source_record_key' for update;
  v_record_id := coalesce(v_record.id,gen_random_uuid());
  if v_record.opportunity_id is not null then v_ids := array_append(v_ids,v_record.opportunity_id); end if;
  for v_identity in select value from jsonb_array_elements(coalesce(p_record->'identities','[]')) loop
    if not radar.object_ok(v_identity,12288) or v_identity - array['kind','key_version','value','evidence'] <> '{}'::jsonb then
      raise exception using errcode = '22023', message = 'identity_invalid';
    end if;
    select opportunity_id into v_id from radar.opportunity_identities where kind = v_identity->>'kind'
      and key_version = (v_identity->>'key_version')::integer and value = v_identity->>'value';
    if found then v_ids := array_append(v_ids,v_id); end if;
  end loop;
  if p_record->>'target_opportunity_id' is not null then
    select * into strict v_old from radar.opportunities where id = (p_record->>'target_opportunity_id')::uuid for update;
    -- A weak candidate is only usable with complete, exact edition/track/organization evidence.
    if v_old.id <> all(v_ids) and (v_old.organization_key is null or v_old.cycle_key is null or v_old.track_key is null
      or v_old.organization_key is distinct from v_canonical->>'organization_key'
      or v_old.cycle_key is distinct from v_canonical->>'cycle_key'
      or v_old.track_key is distinct from v_canonical->>'track_key'
      or v_old.title_key is distinct from v_canonical->>'title_key'
      or v_old.type_code is distinct from v_canonical->>'type_code'
      or v_old.fingerprint is distinct from v_canonical->>'fingerprint') then
      raise exception using errcode = '22023', message = 'candidate_identity_unproven';
    end if;
    v_ids := array_append(v_ids,v_old.id);
  end if;
  select array_agg(distinct x) into v_ids from unnest(v_ids) x;
  if cardinality(v_ids) > 1 then
    perform radar.store_rejection(p_source,p_run,p_record->>'source_record_key',(p_record->>'source_url')::radar.safe_url,
      p_record->>'parser_version',p_record->>'payload_hash','strong_identity_conflict','conflict');
    return 'rejected';
  end if;
  v_id := v_ids[1];
  if v_id is null then v_id := gen_random_uuid(); v_new := true;
  else select * into strict v_old from radar.opportunities where id = v_id for update;
    if v_old.status = 'merged' then raise exception using errcode = '22023', message = 'merged_target_requires_resolution'; end if;
  end if;
  v_can := jsonb_populate_record(null::radar.opportunities,v_canonical);
  if not v_new and (v_old.type_code is distinct from v_can.type_code
    or (v_old.cycle_key is not null and v_can.cycle_key is not null and v_old.cycle_key <> v_can.cycle_key)
    or (v_old.track_key is not null and v_can.track_key is not null and v_old.track_key <> v_can.track_key)) then
    perform radar.store_rejection(p_source,p_run,p_record->>'source_record_key',(p_record->>'source_url')::radar.safe_url,
      p_record->>'parser_version',p_record->>'payload_hash','identity_edition_or_type_conflict','conflict');
    return 'rejected';
  end if;
  v_can.id := v_id;
  v_can.topics := coalesce(v_can.topics,'{}'); v_can.qualification_tags := coalesce(v_can.qualification_tags,'{}');
  v_can.country_codes := coalesce(v_can.country_codes,'{}'); v_can.quality_flags := coalesce(v_can.quality_flags,'{}');
  v_can.work_mode := coalesce(v_can.work_mode,'unknown'); v_can.status := coalesce(v_can.status,'unknown');
  v_can.attributes := coalesce(v_can.attributes,'{"schema_version":1}');
  v_can.field_provenance := coalesce(v_can.field_provenance,v_old.field_provenance,
    (select jsonb_object_agg(k,jsonb_build_object('source_record_id',v_record_id)) from jsonb_object_keys(v_canonical) k),'{}');
  v_can.field_provenance := radar.bind_pipeline_provenance(v_can.field_provenance,p_source,p_record->>'source_record_key',v_record_id);
  v_hash := encode(sha256(convert_to((to_jsonb(v_can) - array['id','content_hash','content_revision',
    'first_seen_at','last_seen_at','created_at','updated_at','field_provenance'])::text,'UTF8')),'hex');
  v_changed := v_new or v_old.content_hash is distinct from v_hash;
  if not v_new and v_changed and v_expected is distinct from v_old.content_revision then
    raise exception using errcode = '40001', message = 'reconciliation_revision_stale';
  end if;
  if not v_new and v_changed and (exists(select 1 from unnest(array[
    'organization','organization_key','description','location_text','canonical_url','published_at',
    'cycle_key','track_key','parent_opportunity_id','event_start','event_end']) f
    where to_jsonb(v_old)->f <> 'null'::jsonb and to_jsonb(v_can)->f = 'null'::jsonb)
    or (v_old.work_mode <> 'unknown' and v_can.work_mode = 'unknown')
    or (cardinality(v_old.topics) > 0 and cardinality(v_can.topics) = 0)
    or (cardinality(v_old.country_codes) > 0 and cardinality(v_can.country_codes) = 0)
    or (cardinality(v_old.qualification_tags) > 0 and cardinality(v_can.qualification_tags) = 0)) then
    raise exception using errcode = '22023', message = 'canonical_null_erases_evidence';
  end if;
  if v_new then
    v_can.content_hash := v_hash; v_can.content_revision := 1;
    v_can.first_seen_at := clock_timestamp(); v_can.last_seen_at := v_can.first_seen_at;
    v_can.created_at := v_can.first_seen_at; v_can.updated_at := v_can.first_seen_at;
    insert into radar.opportunities select (v_can).*;
  elsif v_changed then
    update radar.opportunities set type_code = v_can.type_code,title = v_can.title,title_key = v_can.title_key,
      organization = v_can.organization,organization_key = v_can.organization_key,description = v_can.description,
      topics = v_can.topics,qualification_tags = v_can.qualification_tags,country_codes = v_can.country_codes,
      location_text = v_can.location_text,work_mode = v_can.work_mode,canonical_url = v_can.canonical_url,
      published_at = v_can.published_at,cycle_key = v_can.cycle_key,track_key = v_can.track_key,
      parent_opportunity_id = v_can.parent_opportunity_id,event_start = v_can.event_start,event_end = v_can.event_end,
      status = v_can.status,fingerprint = v_can.fingerprint,fingerprint_version = v_can.fingerprint_version,
      attributes = v_can.attributes,quality_flags = v_can.quality_flags,field_provenance = v_can.field_provenance,
      content_hash = v_hash,last_seen_at = clock_timestamp(),updated_at = clock_timestamp() where id = v_id;
  else
    update radar.opportunities set last_seen_at = clock_timestamp(),field_provenance = v_can.field_provenance where id = v_id;
  end if;
  insert into radar.source_records(id,source_id,source_record_key,opportunity_id,source_url,source_revision,
    parser_version,payload_hash,record_status,normalized_snapshot,metadata,quality_flags,last_run_id)
    values(v_record_id,p_source,p_record->>'source_record_key',v_id,(p_record->>'source_url')::radar.safe_url,
      p_record->>'source_revision',p_record->>'parser_version',p_record->>'payload_hash','accepted',
      p_record->'normalized_snapshot',coalesce(p_record->'metadata','{}'),
      coalesce(array(select jsonb_array_elements_text(p_record->'quality_flags')),'{}'),p_run)
    on conflict(source_id,source_record_key) do update set opportunity_id = excluded.opportunity_id,
      source_url = excluded.source_url,source_revision = excluded.source_revision,parser_version = excluded.parser_version,
      payload_hash = excluded.payload_hash,record_status = 'accepted',normalized_snapshot = excluded.normalized_snapshot,
      metadata = excluded.metadata,quality_flags = excluded.quality_flags,error_code = null,last_run_id = excluded.last_run_id,
      last_seen_at = clock_timestamp();
  for v_identity in select value from jsonb_array_elements(coalesce(p_record->'identities','[]')) loop
    insert into radar.opportunity_identities(opportunity_id,kind,key_version,value,source_record_id,evidence)
      values(v_id,v_identity->>'kind',(v_identity->>'key_version')::integer,v_identity->>'value',v_record_id,coalesce(v_identity->'evidence','{}'))
      on conflict(kind,key_version,value) do nothing;
  end loop;
  for v_deadline_json in select value from jsonb_array_elements(coalesce(p_record->'deadlines','[]')) loop
    if not radar.object_ok(v_deadline_json) or v_deadline_json - array['kind','round_key','label','due_at','due_date',
      'timezone','raw_value','precision','basis','status'] <> '{}'::jsonb then
      raise exception using errcode = '22023', message = 'deadline_proposal_invalid';
    end if;
    v_deadline := jsonb_populate_record(null::radar.opportunity_deadlines,v_deadline_json);
    v_deadline.status := coalesce(v_deadline.status,'current');
    select * into v_old_deadline from radar.opportunity_deadlines where opportunity_id = v_id
      and kind = v_deadline.kind and round_key = v_deadline.round_key for update;
    if not found or (to_jsonb(v_old_deadline) - array['id','opportunity_id','revision','source_record_id','created_at','updated_at','raw_value'])
      is distinct from (to_jsonb(v_deadline) - array['id','opportunity_id','revision','source_record_id','created_at','updated_at','raw_value']) then
      if not v_new and v_expected is distinct from v_old.content_revision then
        raise exception using errcode = '40001', message = 'deadline_reconciliation_stale';
      end if;
      v_deadline_changed := true;
      insert into radar.opportunity_deadlines(opportunity_id,kind,round_key,label,due_at,due_date,timezone,raw_value,precision,basis,status,source_record_id)
        values(v_id,v_deadline.kind,v_deadline.round_key,v_deadline.label,v_deadline.due_at,v_deadline.due_date,v_deadline.timezone,
          v_deadline.raw_value,v_deadline.precision,v_deadline.basis,v_deadline.status,v_record_id)
        on conflict(opportunity_id,kind,round_key) do update set label = excluded.label,due_at = excluded.due_at,
          due_date = excluded.due_date,timezone = excluded.timezone,raw_value = excluded.raw_value,
          precision = excluded.precision,basis = excluded.basis,status = excluded.status,source_record_id = excluded.source_record_id,
          revision = radar.opportunity_deadlines.revision + 1,updated_at = clock_timestamp();
    end if;
  end loop;
  if not v_new and (v_changed or v_deadline_changed) then
    update radar.opportunities set content_revision = content_revision + 1,updated_at = clock_timestamp() where id = v_id;
  end if;
  if v_changed or v_deadline_changed then
    update radar.opportunity_assessments set valid_until = greatest(evaluated_at,clock_timestamp()) where opportunity_id = v_id;
  end if;
  return case when v_new then 'inserted' when v_changed or v_deadline_changed then 'updated' else 'duplicates' end;
end
$$;

create or replace function public.rr_commit_source_page(p_task uuid,p_owner uuid,p_generation bigint,
  p_sequence bigint,p_cursor_hash text,p_page_url radar.safe_url,p_records jsonb,
  p_next_cursor jsonb default null,p_not_modified boolean default false,
  p_source_revision text default null,p_validators jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_task radar.job_tasks; v_run radar.collection_runs; v_source radar.sources;
  v_rec jsonb; v_ord bigint; v_key text; v_seen text[] := '{}'; v_outcome text; v_code text;
  v_inserted integer := 0; v_updated integer := 0; v_duplicates integer := 0; v_rejected integer := 0;
  v_errors jsonb := '[]'; v_error_counts jsonb; v_next_hash text := radar.cursor_digest(p_next_cursor);
begin
  -- A completed page is a tombstone: return disposition, never add its counters again.
  select * into v_task from radar.job_tasks where id = p_task for update;
  if found and v_task.status = 'succeeded' and v_task.kind = 'collect_page' then
    if p_sequence is distinct from (v_task.payload->>'page_sequence')::bigint
      or p_cursor_hash is distinct from v_task.payload->>'cursor_hash' then
      raise exception using errcode = '55000', message = 'page_replay_mismatch';
    end if;
    return jsonb_build_object('replayed',true,'run_id',v_task.collection_run_id);
  end if;
  v_task := radar.require_lease(p_task,p_owner,p_generation,'collect_page');
  select * into strict v_run from radar.collection_runs where id = v_task.collection_run_id for update;
  v_error_counts := v_run.error_counts;
  select * into strict v_source from radar.sources where id = v_run.source_id for update;
  if not v_source.enabled or radar.paused('collection_paused') or v_run.status <> 'running'
    or v_run.config_version <> v_source.config_version or v_run.adapter_version <> v_source.adapter_version then
    raise exception using errcode = '55000', message = 'source_run_not_current';
  end if;
  if p_sequence is distinct from v_run.page_sequence or p_cursor_hash is distinct from v_run.cursor_hash
    or p_sequence is distinct from (v_task.payload->>'page_sequence')::bigint
    or p_cursor_hash is distinct from v_task.payload->>'cursor_hash' then
    raise exception using errcode = '55000', message = 'page_cursor_cas_failed';
  end if;
  if p_page_url is null or jsonb_typeof(p_records) is distinct from 'array' or jsonb_array_length(p_records) > 100
    or octet_length(p_records::text) > 2097152 or not radar.object_ok(p_validators,4096)
    or (p_next_cursor is not null and (v_next_hash = p_cursor_hash or octet_length(p_next_cursor::text) > 4096))
    or (p_not_modified and (p_sequence <> 0 or p_records <> '[]'::jsonb or p_next_cursor is not null))
    or (v_run.source_revision is not null and p_source_revision is distinct from v_run.source_revision)
    or p_sequence >= coalesce((v_source.config->>'max_pages')::integer,1000) then
    raise exception using errcode = '22023', message = 'page_shape_or_snapshot_invalid';
  end if;
  -- One short canonical-write critical section, appropriate to the initial single user.
  -- Fetching/parsing remains independent; there is no network inside this transaction.
  perform pg_advisory_xact_lock(hashtextextended('radar:canonical-identities',0));
  for v_rec,v_ord in select value,ordinality from jsonb_array_elements(p_records) with ordinality loop
    v_key := v_rec->>'source_record_key';
    if v_key is null or length(v_key) not between 1 and 1024 or octet_length(v_key) > 2000 then
      v_key := 'rr-rejected:' || v_run.id || ':' || p_sequence || ':' || v_ord;
      v_rec := jsonb_build_object('source_record_key',v_key,'record_status','quarantined','error_code','record_key_invalid');
    end if;
    if v_key = any(v_seen) then continue; end if;
    v_seen := array_append(v_seen,v_key); v_code := null;
    begin
      if coalesce(v_rec->>'record_status','accepted') <> 'accepted' then
        v_code := left(coalesce(v_rec->>'error_code','record_rejected'),100);
        if v_code !~ '^[A-Za-z0-9_]{1,100}$' then v_code := 'record_rejected'; end if;
        v_outcome := 'rejected';
        perform radar.store_rejection(v_source.id,v_run.id,v_key,p_page_url,v_source.adapter_version,
          coalesce(v_rec->>'payload_hash',radar.cursor_digest(v_rec)),v_code);
      else
        v_outcome := radar.upsert_record(v_source.id,v_run.id,v_rec);
        if v_outcome = 'rejected' then v_code := 'strong_identity_conflict'; end if;
      end if;
    exception when check_violation or not_null_violation or foreign_key_violation or invalid_text_representation
      or invalid_parameter_value or datetime_field_overflow or numeric_value_out_of_range then
      v_outcome := 'rejected'; v_code := 'invalid_record_' || sqlstate;
      perform radar.store_rejection(v_source.id,v_run.id,v_key,p_page_url,v_source.adapter_version,radar.cursor_digest(v_rec),v_code);
    end;
    case v_outcome
      when 'inserted' then v_inserted := v_inserted + 1;
      when 'updated' then v_updated := v_updated + 1;
      when 'duplicates' then v_duplicates := v_duplicates + 1;
      else v_rejected := v_rejected + 1;
    end case;
    if v_code is not null then
      if not (v_error_counts ? v_code) and (select count(*) from jsonb_object_keys(v_error_counts)) >= 64 then
        v_code := 'other_record_error';
      end if;
      v_error_counts := jsonb_set(v_error_counts,array[v_code],to_jsonb(coalesce((v_error_counts->>v_code)::bigint,0)+1));
      if jsonb_array_length(v_errors) < 20 then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object('record_key',left(v_key,80),'code',v_code));
      end if;
    end if;
  end loop;
  -- Recheck real wall time after all potentially blocking locks/record work.
  perform radar.require_lease(p_task,p_owner,p_generation,'collect_page');
  update radar.collection_runs set cursor = p_next_cursor,cursor_hash = v_next_hash,page_sequence = page_sequence + 1,
    pages_committed = pages_committed + 1,records_seen = records_seen + cardinality(v_seen),
    accepted = accepted + v_inserted + v_updated + v_duplicates,inserted = inserted + v_inserted,
    updated = updated + v_updated,duplicates = duplicates + v_duplicates,rejected = rejected + v_rejected,
    source_revision = coalesce(source_revision,p_source_revision),conditional_validators = p_validators,
    error_samples = (select coalesce(jsonb_agg(x.value),'[]') from
      (select value from jsonb_array_elements(error_samples || v_errors) limit 20) x),
    error_counts = v_error_counts,heartbeat_at = clock_timestamp()
    where id = v_run.id;
  perform radar.enqueue_page_assessments(v_run.id,p_sequence,v_seen);
  update radar.job_tasks set status = 'succeeded',finished_at = clock_timestamp(),lease_owner = null,lease_until = null where id = p_task;
  if p_next_cursor is null then
    perform radar.finalize_run(v_run.id,case when v_run.rejected + v_rejected > 0 then 'partial' else 'succeeded' end);
  else
    insert into radar.job_tasks(kind,request_key,coalescing_key,payload,collection_run_id)
      values('collect_page','collect:' || v_run.id || ':' || (p_sequence+1),'collect-source:' || v_source.id,
        jsonb_build_object('page_sequence',p_sequence+1,'cursor_hash',v_next_hash),v_run.id);
  end if;
  return jsonb_build_object('replayed',false,'run_id',v_run.id,'inserted',v_inserted,'updated',v_updated,'duplicates',v_duplicates,'rejected',v_rejected);
end
$$;

create or replace function public.rr_finish_task(p_task uuid,p_owner uuid,p_generation bigint,p_result text,
  p_error_code text default null,p_retry_seconds integer default 60)
returns radar.job_tasks language plpgsql security invoker set search_path = '' as $$
declare v_task radar.job_tasks; v_state text; v_now timestamptz := clock_timestamp();
begin
  v_task := radar.require_lease(p_task,p_owner,p_generation);
  if p_result is null or p_result not in ('succeeded','failed','retry','canceled') or (p_result = 'canceled' and v_task.kind <> 'collect_page') or (v_task.kind = 'collect_page' and p_result = 'succeeded')
    or p_retry_seconds is null or p_retry_seconds not between 1 and 86400 then
    raise exception using errcode = '22023', message = 'task_transition_invalid';
  end if;
  if exists(select 1 from radar.notification_attempts where task_id = p_task and state in ('sending','uncertain')) then
    raise exception using errcode = '55000', message = 'send_outcome_unresolved';
  end if;
  v_state := case when p_result = 'retry' and v_task.attempts < v_task.max_attempts
    and (v_task.expires_at is null or v_now + make_interval(secs => p_retry_seconds) < v_task.expires_at)
    then 'queued' when p_result = 'retry' then 'failed' else p_result end;
  update radar.job_tasks set status = v_state,lease_owner = null,lease_until = null,
    available_at = case when v_state = 'queued' then v_now + make_interval(secs => p_retry_seconds) else available_at end,
    finished_at = case when v_state = 'queued' then null else v_now end,last_error_code = p_error_code
    where id = p_task returning * into v_task;
  if v_task.collection_run_id is not null and v_state in ('failed','canceled') then
    update radar.collection_runs set error_counts = jsonb_set(error_counts,array[left(coalesce(p_error_code,'task_failed'),100)],
      to_jsonb(coalesce((error_counts->>left(coalesce(p_error_code,'task_failed'),100))::bigint,0)+1)) where id = v_task.collection_run_id;
    perform radar.finalize_run(v_task.collection_run_id,v_state);
  elsif v_task.kind = 'telegram_command' and v_state <> 'queued' then
    update radar.telegram_updates set status = case when v_state = 'succeeded' then 'completed' else 'failed' end,
      completed_at = v_now,error_code = p_error_code where bot_id = v_task.telegram_bot_id and update_id = v_task.telegram_update_id;
  end if;
  return v_task;
end
$$;

notify pgrst, 'reload schema';
