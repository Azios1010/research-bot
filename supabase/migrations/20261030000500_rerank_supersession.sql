-- Forward correction: a superseded assessment chain may terminalize without writes.
create or replace function public.rr_finish_task(p_task uuid,p_owner uuid,p_generation bigint,p_result text,
  p_error_code text default null,p_retry_seconds integer default 60)
returns radar.job_tasks language plpgsql security invoker set search_path = '' as $$
declare v_task radar.job_tasks; v_state text; v_now timestamptz := clock_timestamp();
begin
  v_task := radar.require_lease(p_task,p_owner,p_generation);
  if p_result is null or p_result not in ('succeeded','failed','retry','canceled') or (p_result = 'canceled' and v_task.kind not in ('collect_page','assess_batch')) or (v_task.kind = 'collect_page' and p_result = 'succeeded')
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
create or replace function radar.ui_item(p_id uuid,p_profile uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('id',o.id,'type',o.type_code,'title',o.title,'organization',o.organization,
    'location',o.location_text,'status',case
      when o.attributes->'funding'->>'source_status' in ('forecasted','forecast') then 'forecast'
      when o.attributes->'funding'->>'source_status' in ('closed','archived') then 'closed'
      when o.attributes->'journal_call'->>'source_status'='upcoming' then 'upcoming'
      else o.status end,'url',coalesce(o.canonical_url,(select source_url::text from radar.source_records where opportunity_id=o.id and record_status='accepted' order by last_seen_at desc,id limit 1)),
    'eventStart',o.event_start,'eventEnd',o.event_end,'description',left(o.description,1800),
    'saved',coalesce(s.saved,false),'ignored',coalesce(s.ignored,false),
    'score',case when not coalesce(s.ignored,false) and a.eligible and a.opportunity_revision=o.content_revision and a.profile_revision=p.revision and a.valid_until>statement_timestamp() and a.rules_version='deterministic-v2' then a.score else null end,
    'reasons',case when coalesce(s.ignored,false) then '["ignored"]'::jsonb when a.opportunity_revision=o.content_revision and a.profile_revision=p.revision and a.valid_until>statement_timestamp() and a.rules_version='deterministic-v2' then to_jsonb(a.reason_codes) else '[]'::jsonb end,
    'components',case when a.opportunity_revision=o.content_revision and a.profile_revision=p.revision and a.valid_until>statement_timestamp() and a.rules_version='deterministic-v2' then a.components else '{}'::jsonb end,
    'assessmentContext',case when a.opportunity_revision=o.content_revision and a.profile_revision=p.revision and a.valid_until>statement_timestamp() and a.rules_version='deterministic-v2' then jsonb_build_object('rule_version',a.rules_version,'score',case when not coalesce(s.ignored,false) and a.eligible and not coalesce(s.ignored,false) then a.score else null end,'profile_revision',a.profile_revision,'opportunity_revision',a.opportunity_revision,'evaluated_at',a.evaluated_at) else '{}'::jsonb end,
    'deadlines',coalesce((select jsonb_agg(jsonb_build_object('label',label,'precision',precision,'status',status,'dueAt',due_at,'dueDate',due_date,'timezone',timezone) order by case when status='current' and kind in ('application','abstract','submission','registration') and coalesce(due_at,(due_date+1)::timestamp at time zone 'Etc/GMT+12')>statement_timestamp() then 0 when precision='unknown' or status='conflicted' then 1 else 2 end,due_at nulls last,due_date nulls last,id) from
      (select * from radar.opportunity_deadlines where opportunity_id=o.id and status<>'superseded' order by case when status='current' and kind in ('application','abstract','submission','registration') and coalesce(due_at,(due_date+1)::timestamp at time zone 'Etc/GMT+12')>statement_timestamp() then 0 when precision='unknown' or status='conflicted' then 1 else 2 end,due_at nulls last,due_date nulls last,id limit 8) d),'[]'),
    'notes',to_jsonb(array_remove(array[
      case when o.type_code in ('conference','workshop')
        and exists(select 1 from radar.opportunity_deadlines where opportunity_id=o.id and kind in ('application','abstract','submission') and status<>'superseded')
        and not exists(select 1 from radar.opportunity_deadlines where opportunity_id=o.id and kind in ('application','abstract','submission') and status<>'superseded'
          and (status='conflicted' or precision='unknown' or coalesce(due_at,(due_date+1)::timestamp at time zone 'Etc/GMT+12')>statement_timestamp()))
        then 'Known submission rounds have elapsed; event lifecycle is separate.' end,
      case when o.attributes->'funding'->>'source_status'='forecasted' or o.attributes->'funding'->>'source_status'='forecast' then 'Forecast; not yet accepting applications.' end,
      case when o.attributes->'journal_call'->>'source_status'='upcoming' then 'Upcoming call; submission window has not opened.' end,
      case when o.attributes->'journal_call'->>'abstract_required'='true' then 'Manuscript submission requires the earlier abstract stage.' end,
      case when o.type_code in ('phd','postdoc','research_assistant','research_internship','grant','research_funding') then 'Eligibility is source-specific; confirm qualifications and applicant restrictions at the official link.' end,
      case when cardinality(o.quality_flags)>0 then 'Some source facts are incomplete or uncertain; confirm at the official link.' end,
      case when (select count(*) from radar.opportunity_deadlines where opportunity_id=o.id and status<>'superseded')>8 then 'Additional rounds are available at the official link.' end
    ],null)))
  from radar.opportunities o join radar.research_profiles p on p.id=p_profile
    left join radar.user_opportunity_state s on s.profile_id=p.id and s.opportunity_id=o.id
    left join radar.opportunity_assessments a on a.profile_id=p.id and a.opportunity_id=o.id
    where o.id=p_id and o.status<>'merged'
$$;



create function radar.profile_text_valid(p text)
returns boolean language sql immutable security invoker set search_path='' as $$
 select coalesce((select sum(case when ascii(c)>65535 then 2 else 1 end)<=160 from regexp_split_to_table(lower(normalize(btrim(p),NFKC)),'') c),false)
   and p !~ '[[:cntrl:]]'
$$;
revoke all on function radar.profile_text_valid(text) from public,anon,authenticated;
grant execute on function radar.profile_text_valid(text) to service_role;
create or replace function radar.profile_rules_valid(p jsonb)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare k text; v jsonb; t jsonb; a jsonb; n numeric; codes text[];
begin
  if not coalesce(radar.object_ok(p,16384),false) or p-array['enabled_types','positive_topics','blocked_topics','ignored_topics','blocked_institutions','preferred_institutions','preferred_countries','excluded_countries','hard_countries','preferred_work_modes','compatible_qualifications','incompatible_qualifications','eligibility_facts','unknown_policy','type_weights','reminder_offsets','digest_threshold']<>'{}'::jsonb then return false; end if;
  codes := array['phd','postdoc','research_assistant','research_internship','conference','workshop','conference_cfp','journal_cfp','journal_special_issue','grant','research_funding'];
  for k,v in select key,value from jsonb_each(p) loop
    if k in ('blocked_topics','ignored_topics','blocked_institutions','preferred_institutions','preferred_countries','excluded_countries','preferred_work_modes','compatible_qualifications','incompatible_qualifications','enabled_types') then
      if jsonb_typeof(v)<>'array' or jsonb_array_length(v)>(case when k='enabled_types' then 11 else 20 end) then return false; end if;
      for t in select value from jsonb_array_elements(v) loop
        if jsonb_typeof(t)<>'string' or length(btrim(t#>>'{}')) not between 1 and 160 then return false; end if;
        if k='enabled_types' and not (t#>>'{}'=any(codes)) then return false; end if;
        if k='preferred_work_modes' and not (t#>>'{}'=any(array['remote','hybrid','onsite'])) then return false; end if;
        if k in ('preferred_countries','excluded_countries') and not radar.profile_country(t#>>'{}') then return false; end if;
      end loop;
    elsif k='positive_topics' then
      if jsonb_typeof(v)<>'array' or jsonb_array_length(v)>20 then return false; end if;
      for t in select value from jsonb_array_elements(v) loop
        if jsonb_typeof(t)='string' then
          if length(btrim(t#>>'{}')) not between 1 and 160 then return false; end if;
        elsif jsonb_typeof(t)='object' then
          if t-array['phrase','weight','aliases']<>'{}'::jsonb or jsonb_typeof(t->'phrase') is distinct from 'string' or length(btrim(t->>'phrase')) not between 1 and 160 or jsonb_typeof(t->'weight') is distinct from 'number' then return false; end if;
          n := (t->>'weight')::numeric; if n<=0 or n>100 then return false; end if;
          a := coalesce(t->'aliases','[]');
          if jsonb_typeof(a)<>'array' or jsonb_array_length(a)>10 or exists(select 1 from jsonb_array_elements(a) x where jsonb_typeof(x)<>'string' or length(btrim(x#>>'{}')) not between 1 and 160) then return false; end if;
        else return false; end if;
      end loop;
      if (select count(*)<>count(distinct lower(normalize(btrim(case when jsonb_typeof(x)='string' then x#>>'{}' else x->>'phrase' end),NFKC))) from jsonb_array_elements(v) x) then return false; end if;
    elsif k='type_weights' then
      if jsonb_typeof(v)<>'object' then return false; end if;
      for k,t in select key,value from jsonb_each(v) loop
        if not k=any(codes) or jsonb_typeof(t)<>'number' or (t#>>'{}')::numeric not between 0 and 1 then return false; end if;
      end loop;
    elsif k='hard_countries' then if jsonb_typeof(v)<>'boolean' then return false; end if;
    elsif k='unknown_policy' then if jsonb_typeof(v)<>'string' or v#>>'{}' not in ('allow','exclude') then return false; end if;
    elsif k='digest_threshold' then if jsonb_typeof(v)<>'number' or (v#>>'{}')::numeric not between 0 and 100 then return false; end if;
    elsif k='reminder_offsets' then
      if jsonb_typeof(v)<>'array' or jsonb_array_length(v)>12 or exists(select 1 from jsonb_array_elements(v) x where jsonb_typeof(x)<>'number' or x::text !~ '^[0-9]{1,3}$' or (x::text)::numeric>365) then return false; end if;
    elsif k='eligibility_facts' then
      if jsonb_typeof(v)<>'object' or v-array['student_full_time','nationalities']<>'{}'::jsonb then return false; end if;
      if v ? 'student_full_time' and jsonb_typeof(v->'student_full_time') not in ('boolean','null') then return false; end if;
      if v ? 'nationalities' then
        a:=v->'nationalities'; if jsonb_typeof(a)<>'array' or jsonb_array_length(a)>20 or exists(select 1 from jsonb_array_elements(a) x where jsonb_typeof(x)<>'string' or not radar.profile_country(x#>>'{}')) then return false; end if;
      end if;
    end if;
  end loop;
  if exists(select 1 from jsonb_path_query(p,'$.** ? (@.type() == "string")') x where not radar.profile_text_valid(x#>>'{}')) then return false; end if;
  return true;
exception when invalid_text_representation or numeric_value_out_of_range then return false;
end $$;


