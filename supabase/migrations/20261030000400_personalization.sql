-- Phase 08: strict profiles and bounded persisted-data reranking. No schedule/source IO.
create function radar.profile_country(p text)
returns boolean language sql immutable security invoker set search_path='' as $$
 select coalesce(upper(p)=any(string_to_array('AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW',' ')),false)
$$;
revoke all on function radar.profile_country(text) from public,anon,authenticated;
grant execute on function radar.profile_country(text) to service_role;
create function radar.profile_rules_valid(p jsonb)
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
  return true;
exception when invalid_text_representation or numeric_value_out_of_range then return false;
end $$;

create function radar.validate_profile_rules()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if new.rules_schema_version<>1 or not radar.profile_rules_valid(new.rules) then
    raise exception using errcode='23514',message='profile_rules_invalid'; end if;
  return new;
end $$;
create trigger profiles_rules_validate before insert or update on radar.research_profiles for each row execute function radar.validate_profile_rules();

-- A scan is a UUID-keyset chain of <=50 IDs, bounded by its initial highest UUID.
-- Its active coalescing identity includes profile revision and rule version.
create function radar.enqueue_rerank(p_profile uuid,p_request text,p_after uuid default null,p_upper uuid default null)
returns uuid language plpgsql security invoker set search_path='' as $$
declare p radar.research_profiles; ids uuid[]; upper_id uuid; task_id uuid; scope text; meta jsonb;
begin
  select * into strict p from radar.research_profiles where id=p_profile for update;
  scope:='rerank:' || p.id || ':' || p.revision || ':deterministic-v2';
  select id into task_id from radar.job_tasks where coalescing_key=scope and status in ('queued','leased');
  if found then return task_id; end if;
  if p_upper is null then select id into upper_id from radar.opportunities order by id desc limit 1; else upper_id:=p_upper; end if;
  select array_agg(id order by id) into ids from (select id from radar.opportunities where (p_after is null or id>p_after) and id<=upper_id order by id limit 50) x;
  if ids is null then return null; end if;
  meta:=jsonb_build_object('revision',p.revision,'rule','deterministic-v2','request',p_request,'upper',upper_id);
  insert into radar.job_tasks(kind,request_key,coalescing_key,payload)
    values('assess_batch',scope || ':' || p_request || ':' || coalesce(p_after::text,'first'),scope,
      jsonb_build_object('profile_id',p.id,'opportunity_ids',to_jsonb(ids),'rerank',meta))
    on conflict(request_key) do nothing returning id into task_id;
  return task_id;
end $$;

create function public.rr_request_rerank(p_profile uuid,p_request_key text)
returns uuid language plpgsql security invoker set search_path='' as $$
begin
  if p_request_key is null or p_request_key !~ '^[A-Za-z0-9:_-]{1,80}$' then raise exception using errcode='22023',message='rerank_request_invalid'; end if;
  return radar.enqueue_rerank(p_profile,p_request_key);
end $$;
revoke all on function public.rr_request_rerank(uuid,text) from public,anon,authenticated;
grant execute on function public.rr_request_rerank(uuid,text) to service_role;

create function radar.profile_rerank_changed()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if new.revision<>old.revision then perform radar.enqueue_rerank(new.id,'revision'); end if;
  return new;
end $$;
create trigger profiles_rerank_changed after update on radar.research_profiles for each row execute function radar.profile_rerank_changed();

create function radar.ignore_reassess_changed()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='INSERT' and new.ignored or tg_op='UPDATE' and new.ignored is distinct from old.ignored then
    perform public.rr_enqueue_task('assess_batch','feedback-assess:' || new.profile_id || ':' || new.opportunity_id || ':' || txid_current(),
      jsonb_build_object('profile_id',new.profile_id,'opportunity_ids',jsonb_build_array(new.opportunity_id)));
  end if;
  return new;
end $$;
create trigger state_ignore_reassess after insert or update on radar.user_opportunity_state for each row execute function radar.ignore_reassess_changed();
revoke all on function radar.ignore_reassess_changed() from public,anon,authenticated;
grant execute on function radar.ignore_reassess_changed() to service_role;

create or replace function radar.ui_patch(p_id uuid,p_patch jsonb)
returns boolean language plpgsql security invoker set search_path='' as $$
declare p radar.research_profiles; r jsonb; pref jsonb; k text; v jsonb; z text; e boolean; d boolean; m boolean; tm time;
begin
  if not coalesce(radar.object_ok(p_patch,4096),false) or p_patch='{}'::jsonb or p_patch-array['timezone','topics','types','enabled','digestEnabled','digestTime','remindersEnabled','preferences','rerank']<>'{}'::jsonb then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended('radar:single-enabled-profile',0));
  select * into strict p from radar.research_profiles where id=p_id for update;
  pref:=coalesce(p_patch->'preferences','{}');
  if not radar.profile_rules_valid(pref) then return false; end if;
  r:=p.rules || (pref-'eligibility_facts');
  if pref ? 'eligibility_facts' then r:=jsonb_set(r,'{eligibility_facts}',coalesce(p.rules->'eligibility_facts','{}') || pref->'eligibility_facts'); end if;
  if p_patch ? 'topics' then r:=jsonb_set(r,'{positive_topics}',p_patch->'topics'); end if;
  if p_patch ? 'types' then r:=jsonb_set(r,'{enabled_types}',p_patch->'types'); end if;
  if not radar.profile_rules_valid(r) then return false; end if;
  -- Canonicalize set-valued fields to avoid revisions for order/case/duplicate-only edits.
  for k,v in select key,value from jsonb_each(r) where key in ('blocked_topics','ignored_topics','blocked_institutions','preferred_institutions','preferred_countries','excluded_countries','preferred_work_modes','compatible_qualifications','incompatible_qualifications','enabled_types') loop
    r:=jsonb_set(r,array[k],coalesce((select jsonb_agg(x order by x) from (select distinct case when k in ('preferred_countries','excluded_countries') then upper(btrim(value)) else lower(normalize(btrim(value),NFKC)) end x from jsonb_array_elements_text(v)) q),'[]'));
  end loop;
  if p_patch ? 'timezone' and jsonb_typeof(p_patch->'timezone')<>'string' then return false; end if;
  z:=coalesce(p_patch->>'timezone',p.timezone);
  if z is not null and ((z !~ '/' and z<>'UTC') or not exists(select 1 from pg_timezone_names where name=z)) then return false; end if;
  for k in select unnest(array['enabled','digestEnabled','remindersEnabled','rerank']) loop
    if p_patch ? k and jsonb_typeof(p_patch->k)<>'boolean' then return false; end if;
  end loop;
  if p_patch ? 'digestTime' and (jsonb_typeof(p_patch->'digestTime')<>'string' or p_patch->>'digestTime' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') then return false; end if;
  tm:=coalesce((p_patch->>'digestTime')::time,p.digest_local_time);
  e:=coalesce((p_patch->>'enabled')::boolean,p.enabled);
  d:=coalesce((p_patch->>'digestEnabled')::boolean,p.digest_enabled);
  m:=coalesce((p_patch->>'remindersEnabled')::boolean,p.reminders_enabled);
  if (e or d or m) and (z is null or jsonb_array_length(coalesce(r->'positive_topics','[]'))=0 or jsonb_array_length(coalesce(r->'enabled_types','[]'))=0) then return false; end if;
  if (d or m) and not e or m and jsonb_array_length(coalesce(r->'reminder_offsets','[]'))=0 then return false; end if;
  if e and exists(select 1 from radar.research_profiles where enabled and id<>p_id) then return false; end if;
  update radar.research_profiles set rules=r,rules_schema_version=1,timezone=z,enabled=e,digest_enabled=d,reminders_enabled=m,digest_local_time=tm where id=p_id;
  if p_patch->'rerank'='true'::jsonb then perform radar.enqueue_rerank(p_id,'manual:' || txid_current()); end if;
  return true;
end $$;

create or replace function radar.ui_profile(p_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('enabled',p.enabled,'timezone',p.timezone,
    'topics',coalesce((select jsonb_agg(case when jsonb_typeof(t)='string' then t else t->'phrase' end) from jsonb_array_elements(coalesce(p.rules->'positive_topics','[]')) t),'[]'),
    'types',coalesce(p.rules->'enabled_types','[]'),'digestEnabled',p.digest_enabled,'digestTime',to_char(p.digest_local_time,'HH24:MI'),
    'revision',p.revision,'preferences',p.rules,'remindersEnabled',p.reminders_enabled) from radar.research_profiles p where p.id=p_id
$$;

revoke all on function radar.profile_rules_valid(jsonb),radar.validate_profile_rules(),radar.enqueue_rerank(uuid,text,uuid,uuid),radar.profile_rerank_changed() from public,anon,authenticated;
grant execute on function radar.profile_rules_valid(jsonb),radar.validate_profile_rules(),radar.enqueue_rerank(uuid,text,uuid,uuid),radar.profile_rerank_changed() to service_role;
create or replace function public.rr_store_assessments(p_task uuid,p_owner uuid,p_generation bigint,p_assessments jsonb)
returns integer language plpgsql security invoker set search_path = '' as $$
declare v_task radar.job_tasks; v_item jsonb; v_opportunity radar.opportunities; v_profile radar.research_profiles;
  v_seen uuid[] := '{}'; v_id uuid; v_count integer := 0; v_evaluated timestamptz; v_until timestamptz; v_last uuid;
begin
  v_task := radar.require_lease(p_task,p_owner,p_generation,'assess_batch');
  -- Use the same short write critical section as canonical reconciliation;
  -- otherwise two multi-opportunity batches can acquire row locks in opposite order.
  perform pg_advisory_xact_lock(hashtextextended('radar:canonical-identities',0));
  if jsonb_typeof(p_assessments) is distinct from 'array' or jsonb_array_length(p_assessments) not between 0 and 100 then
    raise exception using errcode = '22023', message = 'assessment_batch_invalid';
  end if;
  select * into strict v_profile from radar.research_profiles where id = (v_task.payload->>'profile_id')::uuid for update;
  if v_task.payload ? 'rerank' and ((v_task.payload->'rerank'->>'revision')::bigint<>v_profile.revision or v_task.payload->'rerank'->>'rule'<>'deterministic-v2') then
    perform public.rr_finish_task(p_task,p_owner,p_generation,'canceled','rerank_superseded'); return 0;
  end if;
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
    v_evaluated:=coalesce((v_item->>'evaluated_at')::timestamptz,clock_timestamp());
    v_until:=(v_item->>'valid_until')::timestamptz;
    if v_item->>'rules_version' is distinct from 'deterministic-v2' or v_until is null or v_until<=clock_timestamp() or v_until<=v_evaluated or v_until>v_evaluated+interval '1 day' or v_evaluated>clock_timestamp()+interval '5 seconds'
      or exists(select 1 from radar.opportunity_assessments a where a.profile_id=v_profile.id and a.opportunity_id=v_id and a.evaluated_at>v_evaluated)
      or coalesce(v_item->'reason_codes' ? 'ignored',false) is distinct from coalesce((select ignored from radar.user_opportunity_state where profile_id=v_profile.id and opportunity_id=v_id),false)
      then raise exception using errcode='PT409',message='assessment_context_stale'; end if;
    insert into radar.opportunity_assessments(profile_id,opportunity_id,eligible,score,reason_codes,components,
      opportunity_revision,profile_revision,rules_version,evaluated_at,valid_until)
      values(v_profile.id,v_id,(v_item->>'eligible')::boolean,(v_item->>'score')::numeric,
        array(select jsonb_array_elements_text(coalesce(v_item->'reason_codes','[]'))),coalesce(v_item->'components','{}'),
        v_opportunity.content_revision,v_profile.revision,v_item->>'rules_version',v_evaluated,v_until)
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
  if v_task.payload ? 'rerank' then
    select value::uuid into v_last from jsonb_array_elements_text(v_task.payload->'opportunity_ids') order by value::uuid desc limit 1;
    perform radar.enqueue_rerank(v_profile.id,v_task.payload->'rerank'->>'request',v_last,(v_task.payload->'rerank'->>'upper')::uuid);
  end if;
  return v_count;
end
$$;


create or replace function public.rr_read_assessment_context(p_task uuid,p_owner uuid,p_generation bigint)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_task radar.job_tasks; v_profile radar.research_profiles; v_ids uuid[]; v_result jsonb;
begin
  v_task := radar.require_lease(p_task,p_owner,p_generation,'assess_batch');
  select * into strict v_profile from radar.research_profiles where id=(v_task.payload->>'profile_id')::uuid;
  if v_task.payload ? 'rerank' and ((v_task.payload->'rerank'->>'revision')::bigint<>v_profile.revision or v_task.payload->'rerank'->>'rule'<>'deterministic-v2') then
    return jsonb_build_object('profile',to_jsonb(v_profile),'enabled_types','[]'::jsonb,'items','[]'::jsonb);
  end if;
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


create or replace function public.rr_receive_telegram(p_target uuid,p_bot text,p_user text,p_chat text,p_update text,p_action jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_target radar.delivery_targets; v_action jsonb; v_result jsonb; v_update bigint;
begin
  if p_update is null or p_update !~ '^(0|[1-9][0-9]{0,18})$' or p_user is null or p_user !~ '^[1-9][0-9]{0,19}$' or p_chat is distinct from p_user then
    raise exception using errcode='22023',message='ingress_id_invalid'; end if;
  v_update := p_update::bigint;
  select * into v_target from radar.delivery_targets where id=p_target and bot_id=p_bot and enabled
    and external_account_id=p_user and external_chat_id=p_chat for update;
  if not found then raise exception using errcode='42501',message='ingress_binding_denied'; end if;
  if not coalesce(radar.object_ok(p_action,4096),false) or coalesce(p_action->>'kind','') not in ('command','callback','rejected') then
    raise exception using errcode='22023',message='ingress_action_invalid'; end if;
  if p_action->>'kind'='command' then
    if p_action-array['kind','command','patch','invalid'] <> '{}'::jsonb or coalesce(p_action->>'command','') not in
      ('start','help','today','deadlines','conferences','jobs','journals','saved','profile','refresh','status','unknown')
      or (p_action ? 'patch' and (p_action->>'command'<>'profile' or not radar.object_ok(p_action->'patch',4096))) then
      raise exception using errcode='22023',message='ingress_command_invalid'; end if;
    if p_action ? 'invalid' and p_action->'invalid' <> 'true'::jsonb then raise exception using errcode='22023',message='ingress_command_invalid'; end if;
    v_action := p_action;
  elsif p_action->>'kind'='callback' then
    if p_action-array['kind','token','messageId'] <> '{}'::jsonb or coalesce(p_action->>'messageId','') !~ '^(0|[1-9][0-9]{0,18})$' then
      raise exception using errcode='22023',message='ingress_callback_invalid'; end if;
    v_action := case when radar.ui_callback(p_target,p_bot,p_action) is null then
      jsonb_build_object('kind','rejected','reason','callback_expired') else p_action end;
  else v_action := jsonb_build_object('kind','rejected','reason','unsupported'); end if;
  v_action := v_action || jsonb_build_object('actor',p_user,'chat',p_chat);
  if v_action->>'kind'='rejected' then
    insert into radar.telegram_updates(bot_id,update_id,delivery_target_id,profile_id,action,status,completed_at,error_code)
      values(p_bot,v_update,p_target,v_target.profile_id,v_action,'rejected',clock_timestamp(),'safe_rejection')
      on conflict(bot_id,update_id) do nothing;
    if exists(select 1 from radar.telegram_updates where bot_id=p_bot and update_id=v_update and delivery_target_id<>p_target) then
      raise exception using errcode='42501',message='ingress_binding_denied'; end if;
    return jsonb_build_object('duplicate',true,'status','rejected');
  end if;
  v_result := public.rr_accept_telegram_update(p_target,p_bot,v_update,v_action);
  return v_result;
end
$$;


create or replace function public.rr_execute_interaction(p_task uuid,p_owner uuid,p_generation bigint)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_u radar.telegram_updates; v_action jsonb; v_result jsonb; v_source radar.sources; v_active integer:=0; v_queued integer:=0;
begin
  v_u := radar.ui_task(p_task,p_owner,p_generation);
  perform pg_advisory_xact_lock(hashtextextended('notification-profile:' || v_u.profile_id,0));
  v_action := radar.ui_action(v_u);
  v_result := v_u.action->'result';
  if v_result is null then
    v_result := '{"status":"ok"}'::jsonb;
    if v_action->'invalid'='true'::jsonb then v_result := '{"status":"invalid_profile"}'::jsonb;
    elsif v_action->>'kind'='feedback' then
      perform public.rr_apply_feedback(v_u.profile_id,(v_action->>'opportunityId')::uuid,v_action->>'desired','command:' || p_task,coalesce(v_action->'context','{}'),p_task,p_owner,p_generation);
    elsif v_action->>'kind'='command' and v_action->>'command'='profile' and v_action ? 'patch' then
      if not radar.ui_patch(v_u.profile_id,v_action->'patch') then v_result := '{"status":"invalid_profile"}'::jsonb; end if;
    elsif v_action->>'kind'='command' and v_action->>'command'='refresh' then
      if radar.paused('collection_paused') then v_result := '{"status":"unavailable"}'::jsonb;
      elsif exists(select 1 from radar.telegram_updates u where u.profile_id=v_u.profile_id and (u.bot_id,u.update_id)<>(v_u.bot_id,v_u.update_id)
        and u.action->>'command'='refresh' and u.action->'result'->>'status' in ('queued','active')
        and (u.action->'result'->>'at')::timestamptz > clock_timestamp()-interval '5 minutes') then v_result := '{"status":"throttled"}'::jsonb;
      else
        if (select count(*) from radar.sources where enabled and approved_at is not null) > 20 then
          v_result := '{"status":"unavailable"}'::jsonb;
        else
          for v_source in select * from radar.sources where enabled and approved_at is not null and (cooldown_until is null or cooldown_until<=clock_timestamp()) order by id for update loop
            if exists(select 1 from radar.collection_runs where source_id=v_source.id and status in ('queued','running')) then v_active:=v_active+1;
            else perform public.rr_create_collection_run(v_source.id,'refresh:' || p_task || ':' || v_source.id,'manual'); v_queued:=v_queued+1; end if;
          end loop;
          v_result := jsonb_build_object('status',case when v_queued>0 then 'queued' when v_active>0 then 'active' else 'unavailable' end,'queued',v_queued,'active',v_active,'at',clock_timestamp());
        end if;
      end if;
    end if;
    update radar.telegram_updates set action=jsonb_set(action,'{result}',v_result) where bot_id=v_u.bot_id and update_id=v_u.update_id;
  end if;
  perform radar.require_lease(p_task,p_owner,p_generation,'telegram_command');
  return jsonb_build_object('profileId',v_u.profile_id,'targetId',v_u.delivery_target_id,'profile',radar.ui_profile(v_u.profile_id),
    'action',v_action,'result',v_result,'health',radar.ui_health());
end
$$;


create or replace function public.rr_browse_interaction(p_task uuid,p_owner uuid,p_generation bigint)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_u radar.telegram_updates; v_action jsonb; v_view jsonb; v_kind text; v_ids uuid[]; v_items jsonb; v_offset integer:=0; v_profile radar.research_profiles;
begin
  v_u := radar.ui_task(p_task,p_owner,p_generation); v_action := radar.ui_action(v_u);
  select * into strict v_profile from radar.research_profiles where id=v_u.profile_id;
  if v_action->>'kind' in ('details','feedback') then
    return jsonb_build_object('items',coalesce(jsonb_build_array(radar.ui_item((v_action->>'opportunityId')::uuid,v_u.profile_id)),'[]'));
  elsif v_action->>'kind'='page' then
    v_view := v_action->'view'; v_kind := v_view->>'kind'; v_offset := (v_view->>'offset')::integer;
    if (v_view->>'revision')::bigint<>v_profile.revision then return jsonb_build_object('items','[]'::jsonb); end if;
    v_ids := array(select value::uuid from jsonb_array_elements_text(v_view->'ids'));
  elsif v_action->>'kind'='command' and v_action->>'command' in ('today','deadlines','conferences','jobs','journals','saved') then
    v_kind := v_action->>'command';
    select array_agg(id order by ordinal) into v_ids from (
      select o.id,row_number() over(order by
        case when v_kind='today' then a.score end desc nulls last,
        case when v_kind in ('today','deadlines') then nd.due end asc nulls last,
        case when v_kind='saved' then s.saved_at end desc nulls last,
        o.first_seen_at desc,o.id) ordinal
      from radar.opportunities o join radar.opportunity_types ty on ty.code=o.type_code and ty.enabled
      left join radar.user_opportunity_state s on s.profile_id=v_u.profile_id and s.opportunity_id=o.id
      left join radar.opportunity_assessments a on a.profile_id=v_u.profile_id and a.opportunity_id=o.id
      left join lateral (select min(coalesce(d.due_at,(d.due_date+1)::timestamp at time zone 'Etc/GMT+12')) due
        from radar.opportunity_deadlines d where d.opportunity_id=o.id and d.status='current' and d.kind in ('application','abstract','submission','registration')
        and coalesce(d.due_at,(d.due_date+1)::timestamp at time zone 'Etc/GMT+12')>statement_timestamp()) nd on true
      where o.status<>'merged' and (v_kind='saved' and coalesce(s.saved,false) or
        v_kind<>'saved' and not coalesce(s.ignored,false) and o.status in ('open','unknown')
        and (o.type_code not in ('conference','workshop') or coalesce(o.event_end,o.event_start) is null or (coalesce(o.event_end,o.event_start)+1)::timestamp at time zone 'Etc/GMT+12'>statement_timestamp())
        and (o.type_code in ('conference','workshop') or not exists(select 1 from radar.opportunity_deadlines d where d.opportunity_id=o.id and d.kind in ('application','abstract','submission','registration') and d.status<>'superseded')
          or exists(select 1 from radar.opportunity_deadlines d where d.opportunity_id=o.id and d.kind in ('application','abstract','submission','registration') and d.status<>'superseded'
            and (d.status='conflicted' or d.precision='unknown' or coalesce(d.due_at,(d.due_date+1)::timestamp at time zone 'Etc/GMT+12')>statement_timestamp())))
        and case v_kind
          when 'conferences' then o.type_code in ('conference','workshop','conference_cfp')
          when 'jobs' then o.type_code in ('phd','postdoc','research_assistant','research_internship')
          when 'journals' then o.type_code in ('journal_cfp','journal_special_issue')
          when 'today' then v_profile.enabled and jsonb_array_length(coalesce(v_profile.rules->'positive_topics','[]'))>0
            and o.first_seen_at>=statement_timestamp()-interval '7 days' and a.eligible and a.opportunity_revision=o.content_revision
            and a.score>=coalesce((v_profile.rules->>'digest_threshold')::numeric,40) and a.profile_revision=v_profile.revision and a.valid_until>statement_timestamp() and a.rules_version='deterministic-v2'
            and coalesce(v_profile.rules->'enabled_types','[]') ? o.type_code
            and coalesce(o.attributes->'funding'->>'source_status','') not in ('forecast','forecasted')
            and coalesce(o.attributes->'journal_call'->>'source_status','')<>'upcoming'
          when 'deadlines' then nd.due<=statement_timestamp()+interval '30 days' or exists(select 1 from radar.opportunity_deadlines d where d.opportunity_id=o.id and d.status<>'superseded' and d.kind in ('application','abstract','submission','registration') and (d.precision='unknown' or d.status='conflicted'))
          else false end)
      order by ordinal limit 101
    ) candidates;
    v_ids := coalesce(v_ids,'{}');
    v_view := jsonb_build_object('kind',v_kind,'ids',to_jsonb(v_ids[1:100]),'offset',0,'expiresAt',statement_timestamp()+interval '30 minutes','revision',v_profile.revision,'capped',cardinality(v_ids)>100);
    v_ids := v_ids[1:100];
  else return jsonb_build_object('items','[]'::jsonb); end if;
  select coalesce(jsonb_agg(item order by ordinal),'[]') into v_items from (
    select radar.ui_item(id,v_u.profile_id) item,ordinal from unnest(v_ids) with ordinality t(id,ordinal)
    where ordinal>v_offset and ordinal<=v_offset+3 and exists(select 1 from radar.opportunities o
      left join radar.user_opportunity_state s on s.opportunity_id=o.id and s.profile_id=v_u.profile_id
      where o.id=t.id and (v_kind<>'today' or exists(select 1 from radar.opportunity_assessments a where a.profile_id=v_u.profile_id and a.opportunity_id=o.id and a.eligible and a.opportunity_revision=o.content_revision and a.profile_revision=v_profile.revision and a.rules_version='deterministic-v2' and a.valid_until>statement_timestamp() and a.score>=coalesce((v_profile.rules->>'digest_threshold')::numeric,40))) and o.status<>'merged' and (v_kind='saved' and s.saved or v_kind<>'saved' and not coalesce(s.ignored,false) and o.status in ('open','unknown')))
  ) selected;
  perform radar.require_lease(p_task,p_owner,p_generation,'telegram_command');
  return jsonb_build_object('items',v_items,'snapshot',v_view);
end
$$;


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
    'reasons',case when a.opportunity_revision=o.content_revision and a.profile_revision=p.revision and a.valid_until>statement_timestamp() and a.rules_version='deterministic-v2' then to_jsonb(a.reason_codes) else '[]'::jsonb end,
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


create or replace function radar.ui_callback(p_target uuid,p_bot text,p_action jsonb)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_match text[]; v_key uuid; v_n radar.notifications; v_part jsonb; v_view jsonb; v_id text; v_code text;
begin
  if octet_length(p_action->>'token') > 64 then return null; end if;
  v_match := regexp_match(p_action->>'token','^1:([dsuirop]):([a-f0-9]{32}):([0-2])$');
  if v_match is null then return null; end if;
  v_key := v_match[2]::uuid; v_code := v_match[1];
  select n.* into v_n from radar.notifications n
    join radar.delivery_targets t on t.id=n.delivery_target_id
    join radar.job_tasks c on n.schedule_key='command:' || c.id
    join radar.telegram_updates u on u.bot_id=c.telegram_bot_id and u.update_id=c.telegram_update_id
    where n.delivery_target_id=p_target and t.enabled and t.bot_id=p_bot
      and u.action->>'actor'=t.external_account_id and u.action->>'chat'=t.external_chat_id
      and n.kind='command_reply' and n.schedule_key='command:' || v_key
      and n.created_at > statement_timestamp() - interval '24 hours';
  if not found then return null; end if;
  select v_n.parts->a.part_index into v_part from radar.notification_attempts a
    where a.notification_id=v_n.id and a.state='sent' and a.telegram_message_id=p_action->>'messageId'
      and exists(select 1 from jsonb_array_elements(v_n.parts->a.part_index->'buttons') r,
        lateral jsonb_array_elements(r.value) b where b->>'action'=p_action->>'token') limit 1;
  if v_part is null then return null; end if;
  if v_n.parts->0 ? 'view' and (v_n.parts->0->'view'->>'revision')::bigint is distinct from
    (select revision from radar.research_profiles where id=v_n.profile_id) then return null; end if;
  if v_code='p' then
    v_view := v_n.parts->0->'view';
    if v_view is null or (v_view->>'expiresAt')::timestamptz <= statement_timestamp()
      or (v_view->>'offset')::integer+3 >= jsonb_array_length(v_view->'ids') then return null; end if;
    return jsonb_build_object('kind','page','view',jsonb_set(v_view,'{offset}',to_jsonb((v_view->>'offset')::integer+3)));
  end if;
  v_id := v_part->'itemIds'->>(v_match[3]::integer);
  if v_id is null or not exists(select 1 from radar.opportunities where id=v_id::uuid and status <> 'merged') then return null; end if;
  return case when v_code='d' then jsonb_build_object('kind','details','opportunityId',v_id)
    else jsonb_build_object('kind','feedback','opportunityId',v_id,'context',coalesce(v_part->'assessments'->v_id,'{}') || jsonb_build_object('view',coalesce(v_n.parts->0->'view'->>'kind','details')),'desired',case v_code
      when 's' then 'save' when 'u' then 'unsave' when 'i' then 'ignore' when 'r' then 'unignore' when 'o' then 'open_intent' end) end;
end
$$;


create or replace function radar.item_eligible(p_profile uuid,p_opportunity uuid,p_kind text,p_deadline uuid default null,p_revision integer default null)
returns boolean language sql volatile security invoker set search_path = '' as $$
  select exists (
    select 1 from radar.opportunities o join radar.opportunity_types ty on ty.code = o.type_code
    join radar.research_profiles p on p.id = p_profile
    join radar.opportunity_assessments a on a.profile_id = p.id and a.opportunity_id = o.id
    left join radar.user_opportunity_state s on s.profile_id = p.id and s.opportunity_id = o.id
    where o.id = p_opportunity and p.enabled and ty.enabled and o.status in ('open','unknown')
      and not coalesce(s.ignored,false) and a.eligible and a.opportunity_revision = o.content_revision
      and a.profile_revision = p.revision and a.valid_until > clock_timestamp() and a.rules_version='deterministic-v2'
      and (p_kind <> 'digest' or a.score >= coalesce((p.rules->>'digest_threshold')::numeric,40))
      and (p_kind <> 'reminder' or (s.saved and exists (
        select 1 from radar.opportunity_deadlines d where d.id = p_deadline and d.opportunity_id = o.id
          and d.status = 'current' and d.revision = p_revision and d.precision <> 'unknown'
          and d.kind in ('application','abstract','submission','registration')
          and ((d.precision = 'instant' and d.due_at > clock_timestamp())
            or (d.precision = 'date' and (d.due_date + 1)::timestamp at time zone 'Etc/GMT+12' > clock_timestamp()))
      )))
  )
$$;



notify pgrst, 'reload schema';
