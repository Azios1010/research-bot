-- ADR 0009: optimistic revision conflicts are HTTP 409, not serialization failures.
-- Keep full transactional rollback without PostgREST serialization retry loops.
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
    raise exception using errcode = 'PT409', message = 'reconciliation_revision_stale';
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
        raise exception using errcode = 'PT409', message = 'deadline_reconciliation_stale';
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

create or replace function public.rr_store_assessments(p_task uuid,p_owner uuid,p_generation bigint,p_assessments jsonb)
returns integer language plpgsql security invoker set search_path = '' as $$
declare v_task radar.job_tasks; v_item jsonb; v_opportunity radar.opportunities; v_profile radar.research_profiles;
  v_seen uuid[] := '{}'; v_id uuid; v_count integer := 0;
begin
  v_task := radar.require_lease(p_task,p_owner,p_generation,'assess_batch');
  -- Use the same short write critical section as canonical reconciliation;
  -- otherwise two multi-opportunity batches can acquire row locks in opposite order.
  perform pg_advisory_xact_lock(hashtextextended('radar:canonical-identities',0));
  if jsonb_typeof(p_assessments) is distinct from 'array' or jsonb_array_length(p_assessments) not between 1 and 100 then
    raise exception using errcode = '22023', message = 'assessment_batch_invalid';
  end if;
  select * into strict v_profile from radar.research_profiles where id = (v_task.payload->>'profile_id')::uuid for update;
  for v_item in select value from jsonb_array_elements(p_assessments) loop
    v_id := (v_item->>'opportunity_id')::uuid;
    if v_id is null or v_id = any(v_seen) or not (v_task.payload->'opportunity_ids' @> jsonb_build_array(v_id::text)) then
      raise exception using errcode = '22023', message = 'assessment_membership_invalid';
    end if;
    v_seen := array_append(v_seen,v_id);
    select * into strict v_opportunity from radar.opportunities where id = v_id for update;
    if (v_item->>'opportunity_revision')::bigint is distinct from v_opportunity.content_revision
      or (v_item->>'profile_revision')::bigint is distinct from v_profile.revision then
      raise exception using errcode = 'PT409', message = 'assessment_revision_stale';
    end if;
    insert into radar.opportunity_assessments(profile_id,opportunity_id,eligible,score,reason_codes,components,
      opportunity_revision,profile_revision,rules_version,evaluated_at,valid_until)
      values(v_profile.id,v_id,(v_item->>'eligible')::boolean,(v_item->>'score')::numeric,
        array(select jsonb_array_elements_text(coalesce(v_item->'reason_codes','[]'))),coalesce(v_item->'components','{}'),
        v_opportunity.content_revision,v_profile.revision,v_item->>'rules_version',clock_timestamp(),(v_item->>'valid_until')::timestamptz)
      on conflict(profile_id,opportunity_id) do update set eligible = excluded.eligible,score = excluded.score,
        reason_codes = excluded.reason_codes,components = excluded.components,opportunity_revision = excluded.opportunity_revision,
        profile_revision = excluded.profile_revision,rules_version = excluded.rules_version,
        evaluated_at = excluded.evaluated_at,valid_until = excluded.valid_until;
    v_count := v_count + 1;
  end loop;
  if v_count <> jsonb_array_length(v_task.payload->'opportunity_ids') then
    raise exception using errcode = '22023', message = 'assessment_batch_incomplete';
  end if;
  perform public.rr_finish_task(p_task,p_owner,p_generation,'succeeded');
  return v_count;
end
$$;

notify pgrst, 'reload schema';
