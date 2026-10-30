-- Phase 07. Forward-only, private-schema interaction projections and command replies.
-- No schedules, network calls, production binding, personal profile or secret.

create function radar.ui_profile(p_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('enabled',p.enabled,'timezone',p.timezone,
    'topics',coalesce((select jsonb_agg(case when jsonb_typeof(t)='string' then t else t->'phrase' end)
      from jsonb_array_elements(coalesce(p.rules->'positive_topics','[]')) t),'[]'),
    'types',coalesce(p.rules->'enabled_types','[]'),'digestEnabled',p.digest_enabled,
    'digestTime',to_char(p.digest_local_time,'HH24:MI'),'revision',p.revision)
  from radar.research_profiles p where p.id=p_id
$$;

create function radar.ui_callback(p_target uuid,p_bot text,p_action jsonb)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_match text[]; v_key uuid; v_n radar.notifications; v_part jsonb; v_view jsonb; v_id text; v_code text;
begin
  if octet_length(p_action->>'token') > 64 then return null; end if;
  v_match := regexp_match(p_action->>'token','^1:([dsuirop]):([a-f0-9]{32}):([0-2])$');
  if v_match is null then return null; end if;
  v_key := v_match[2]::uuid; v_code := v_match[1];
  select n.* into v_n from radar.notifications n
    join radar.delivery_targets t on t.id=n.delivery_target_id
    where n.delivery_target_id=p_target and t.enabled and t.bot_id=p_bot
      and n.kind='command_reply' and n.schedule_key='command:' || v_key
      and n.created_at > statement_timestamp() - interval '24 hours';
  if not found then return null; end if;
  select v_n.parts->a.part_index into v_part from radar.notification_attempts a
    where a.notification_id=v_n.id and a.state='sent' and a.telegram_message_id=p_action->>'messageId'
      and exists(select 1 from jsonb_array_elements(v_n.parts->a.part_index->'buttons') r,
        lateral jsonb_array_elements(r.value) b where b->>'action'=p_action->>'token') limit 1;
  if v_part is null then return null; end if;
  if v_code='p' then
    v_view := v_n.parts->0->'view';
    if v_view is null or (v_view->>'expiresAt')::timestamptz <= statement_timestamp()
      or (v_view->>'offset')::integer+3 >= jsonb_array_length(v_view->'ids') then return null; end if;
    return jsonb_build_object('kind','page','view',jsonb_set(v_view,'{offset}',to_jsonb((v_view->>'offset')::integer+3)));
  end if;
  v_id := v_part->'itemIds'->>(v_match[3]::integer);
  if v_id is null or not exists(select 1 from radar.opportunities where id=v_id::uuid and status <> 'merged') then return null; end if;
  return case when v_code='d' then jsonb_build_object('kind','details','opportunityId',v_id)
    else jsonb_build_object('kind','feedback','opportunityId',v_id,'desired',case v_code
      when 's' then 'save' when 'u' then 'unsave' when 'i' then 'ignore' when 'r' then 'unignore' when 'o' then 'open_intent' end) end;
end
$$;

create function public.rr_receive_telegram(p_target uuid,p_bot text,p_user text,p_chat text,p_update text,p_action jsonb)
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
    if p_action-array['kind','command','patch'] <> '{}'::jsonb or coalesce(p_action->>'command','') not in
      ('start','help','today','deadlines','conferences','jobs','journals','saved','profile','refresh','status','unknown')
      or (p_action ? 'patch' and (p_action->>'command'<>'profile' or not radar.object_ok(p_action->'patch',4096))) then
      raise exception using errcode='22023',message='ingress_command_invalid'; end if;
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

create function radar.ui_task(p_task uuid,p_owner uuid,p_generation bigint)
returns radar.telegram_updates language plpgsql security invoker set search_path = '' as $$
declare v_task radar.job_tasks; v_u radar.telegram_updates;
begin
  v_task := radar.require_lease(p_task,p_owner,p_generation,'telegram_command');
  select * into strict v_u from radar.telegram_updates where bot_id=v_task.telegram_bot_id and update_id=v_task.telegram_update_id for update;
  if not exists(select 1 from radar.delivery_targets t where t.id=v_u.delivery_target_id and t.profile_id=v_u.profile_id
    and t.bot_id=v_u.bot_id and t.enabled and t.external_account_id=v_u.action->>'actor' and t.external_chat_id=v_u.action->>'chat') then
    raise exception using errcode='42501',message='interaction_binding_denied'; end if;
  return v_u;
end
$$;

create function radar.ui_action(p_u radar.telegram_updates)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select case when p_u.action->>'kind'='callback'
    then coalesce(radar.ui_callback(p_u.delivery_target_id,p_u.bot_id,p_u.action),'{"kind":"expired"}'::jsonb)
    else p_u.action - array['actor','chat','result'] end
$$;

create function radar.ui_health()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'staleSources',(select count(*) from radar.sources where enabled and (last_success_at is null or last_success_at < statement_timestamp()-make_interval(mins=>cadence_minutes*2) or health_status in ('failed','cooldown'))),
    'queued',(select count(*) from radar.job_tasks where status='queued'),
    'running',(select count(*) from radar.job_tasks where status='leased'),
    'replies',(select count(*) from radar.notifications where kind='command_reply' and status in ('prepared','sending','partial')),
    'uncertain',(select count(*) from radar.notification_attempts where state in ('sending','uncertain')),
    'sources',coalesce((select jsonb_agg(jsonb_build_object('name',name,'lastSuccess',last_success_at,'stale',last_success_at is null or last_success_at < statement_timestamp()-make_interval(mins=>cadence_minutes*2)) order by name) from
      (select name,last_success_at,cadence_minutes from radar.sources where enabled order by name,id limit 20) s),'[]'))
$$;

create function radar.ui_patch(p_id uuid,p_patch jsonb)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare v_p radar.research_profiles; v_rules jsonb; v_zone text; v_enabled boolean; v_digest boolean; v_time time;
begin
  if not radar.object_ok(p_patch,4096) or p_patch-array['timezone','topics','types','enabled','digestEnabled','digestTime'] <> '{}'::jsonb or p_patch='{}'::jsonb then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended('radar:single-enabled-profile',0));
  select * into strict v_p from radar.research_profiles where id=p_id for update;
  v_rules := v_p.rules;
  if p_patch ? 'topics' then
    if jsonb_typeof(p_patch->'topics') <> 'array' then return false; end if;
    if jsonb_array_length(p_patch->'topics') > 20 or exists(select 1 from jsonb_array_elements(p_patch->'topics') t where jsonb_typeof(t)<>'string' or length(btrim(t#>>'{}')) not between 1 and 160) then return false; end if;
    v_rules := jsonb_set(v_rules,'{positive_topics}',p_patch->'topics');
  end if;
  if p_patch ? 'types' then
    if jsonb_typeof(p_patch->'types') <> 'array' then return false; end if;
    if jsonb_array_length(p_patch->'types') > 11 or exists(select 1 from jsonb_array_elements(p_patch->'types') t where jsonb_typeof(t)<>'string' or not exists(select 1 from radar.opportunity_types where code=t#>>'{}' and enabled)) then return false; end if;
    v_rules := jsonb_set(v_rules,'{enabled_types}',p_patch->'types');
  end if;
  if p_patch ? 'timezone' and jsonb_typeof(p_patch->'timezone')<>'string' then return false; end if;
  v_zone := coalesce(p_patch->>'timezone',v_p.timezone);
  if v_zone is not null and ((v_zone !~ '/' and v_zone<>'UTC') or not exists(select 1 from pg_timezone_names where name=v_zone)) then return false; end if;
  if p_patch ? 'enabled' and jsonb_typeof(p_patch->'enabled')<>'boolean' or p_patch ? 'digestEnabled' and jsonb_typeof(p_patch->'digestEnabled')<>'boolean' then return false; end if;
  if p_patch ? 'digestTime' and (jsonb_typeof(p_patch->'digestTime')<>'string' or p_patch->>'digestTime' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') then return false; end if;
  v_time := coalesce((p_patch->>'digestTime')::time,v_p.digest_local_time);
  v_enabled := coalesce((p_patch->>'enabled')::boolean,v_p.enabled);
  v_digest := coalesce((p_patch->>'digestEnabled')::boolean,v_p.digest_enabled);
  if (v_enabled or v_digest) and (v_zone is null or jsonb_array_length(coalesce(v_rules->'positive_topics','[]'))=0 or jsonb_array_length(coalesce(v_rules->'enabled_types','[]'))=0) then return false; end if;
  if v_digest and not v_enabled then return false; end if;
  if v_enabled and exists(select 1 from radar.research_profiles where enabled and id<>p_id) then return false; end if;
  update radar.research_profiles set rules=v_rules,timezone=v_zone,enabled=v_enabled,digest_enabled=v_digest,
    reminders_enabled=case when v_enabled then reminders_enabled else false end,digest_local_time=v_time where id=p_id;
  return true;
end
$$;

create function public.rr_execute_interaction(p_task uuid,p_owner uuid,p_generation bigint)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_u radar.telegram_updates; v_action jsonb; v_result jsonb; v_source radar.sources; v_active integer:=0; v_queued integer:=0;
begin
  v_u := radar.ui_task(p_task,p_owner,p_generation);
  perform pg_advisory_xact_lock(hashtextextended('notification-profile:' || v_u.profile_id,0));
  v_action := radar.ui_action(v_u);
  v_result := v_u.action->'result';
  if v_result is null then
    v_result := '{"status":"ok"}'::jsonb;
    if v_action->>'kind'='feedback' then
      perform public.rr_apply_feedback(v_u.profile_id,(v_action->>'opportunityId')::uuid,v_action->>'desired','command:' || p_task,'{}',p_task,p_owner,p_generation);
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

create function radar.ui_item(p_id uuid,p_profile uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('id',o.id,'type',o.type_code,'title',o.title,'organization',o.organization,
    'location',o.location_text,'status',o.status,'url',coalesce(o.canonical_url,(select source_url::text from radar.source_records where opportunity_id=o.id and record_status='accepted' order by last_seen_at desc,id limit 1)),
    'eventStart',o.event_start,'eventEnd',o.event_end,'description',left(o.description,1800),
    'saved',coalesce(s.saved,false),'ignored',coalesce(s.ignored,false),
    'score',case when a.eligible and a.opportunity_revision=o.content_revision and a.profile_revision=p.revision and a.valid_until>statement_timestamp() then a.score else null end,
    'reasons',case when a.eligible and a.opportunity_revision=o.content_revision and a.profile_revision=p.revision and a.valid_until>statement_timestamp() then to_jsonb(a.reason_codes) else '[]'::jsonb end,
    'deadlines',coalesce((select jsonb_agg(jsonb_build_object('label',label,'precision',precision,'status',status,'dueAt',due_at,'dueDate',due_date,'timezone',timezone) order by due_at nulls last,due_date nulls last,id) from
      (select * from radar.opportunity_deadlines where opportunity_id=o.id and status<>'superseded' order by due_at nulls last,due_date nulls last,id limit 8) d),'[]'),
    'notes',to_jsonb(array_remove(array[
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

create function public.rr_browse_interaction(p_task uuid,p_owner uuid,p_generation bigint)
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
            and a.profile_revision=v_profile.revision and a.valid_until>statement_timestamp()
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
      where o.id=t.id and o.status<>'merged' and (v_kind='saved' and s.saved or v_kind<>'saved' and not coalesce(s.ignored,false) and o.status in ('open','unknown')))
  ) selected;
  perform radar.require_lease(p_task,p_owner,p_generation,'telegram_command');
  return jsonb_build_object('items',v_items,'snapshot',v_view);
end
$$;

create function public.rr_commit_interaction_reply(p_task uuid,p_owner uuid,p_generation bigint,p_parts jsonb)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_u radar.telegram_updates; v_n radar.notifications; v_part jsonb;
begin
  v_u := radar.ui_task(p_task,p_owner,p_generation);
  if jsonb_typeof(p_parts)<>'array' or jsonb_array_length(p_parts) not between 1 and 10 then raise exception using errcode='22023',message='reply_parts_invalid'; end if;
  for v_part in select value from jsonb_array_elements(p_parts) loop
    if v_part->>'renderingVersion'<>'1' or jsonb_typeof(v_part->'text')<>'string' or length(v_part->>'text') not between 1 and 24000
      or jsonb_typeof(v_part->'buttons')<>'array' or jsonb_typeof(v_part->'itemIds')<>'array' or jsonb_array_length(v_part->'itemIds')>3 then
      raise exception using errcode='22023',message='reply_parts_invalid'; end if;
  end loop;
  v_n := public.rr_prepare_notification(v_u.profile_id,v_u.delivery_target_id,'command_reply','command:' || p_task,
    clock_timestamp(),clock_timestamp()+interval '1 hour',p_parts,'[]',null,null,p_task,p_owner,p_generation);
  perform public.rr_finish_task(p_task,p_owner,p_generation,'succeeded');
  return v_n.id;
end
$$;

create function public.rr_begin_interaction_send(p_task uuid,p_owner uuid,p_generation bigint)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_task radar.job_tasks; v_target radar.delivery_targets; v_plan jsonb;
begin
  v_task := radar.require_lease(p_task,p_owner,p_generation,'send_notification');
  select t.* into strict v_target from radar.notifications n join radar.delivery_targets t on t.id=n.delivery_target_id
    where n.id=(v_task.payload->>'notification_id')::uuid and n.kind='command_reply';
  v_plan := public.rr_begin_notification_attempt(p_task,p_owner,p_generation);
  return v_plan || jsonb_build_object('destination',jsonb_build_object('account',v_target.external_chat_id,'bot',v_target.bot_id));
end
$$;

create function public.rr_finish_interaction_send(p_task uuid,p_owner uuid,p_generation bigint,p_attempt uuid,p_outcome text,p_message text default null,p_code text default null,p_retry integer default 60)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if p_code is not null and p_code not in ('telegram_rate_limit','telegram_forbidden','telegram_bad_request','telegram_auth_failure','telegram_server_unknown','telegram_transport_unknown','send_response_mismatch','send_transport_unknown') then
    raise exception using errcode='22023',message='send_code_invalid'; end if;
  if p_message is not null and p_message !~ '^(0|[1-9][0-9]{0,18})$' then raise exception using errcode='22023',message='send_id_invalid'; end if;
  if not exists(select 1 from radar.notification_attempts a join radar.notifications n on n.id=a.notification_id where a.id=p_attempt and n.kind='command_reply') then raise exception using errcode='42501',message='send_kind_denied'; end if;
  perform public.rr_finish_notification_attempt(p_task,p_owner,p_generation,p_attempt,p_outcome,p_message,p_code,p_retry);
  if p_outcome='permanent_failure' and p_code in ('telegram_forbidden','telegram_auth_failure') then
    update radar.delivery_targets t set enabled=false,updated_at=clock_timestamp() where id in (
      select n.delivery_target_id from radar.notifications n join radar.notification_attempts a on a.notification_id=n.id where a.id=p_attempt);
  end if;
end
$$;

-- Private helper defaults were revoked by Phase 02. Deliberate invoker grants only.
revoke all on function public.rr_receive_telegram(uuid,text,text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.rr_execute_interaction(uuid,uuid,bigint) from public,anon,authenticated;
revoke all on function public.rr_browse_interaction(uuid,uuid,bigint) from public,anon,authenticated;
revoke all on function public.rr_commit_interaction_reply(uuid,uuid,bigint,jsonb) from public,anon,authenticated;
revoke all on function public.rr_begin_interaction_send(uuid,uuid,bigint) from public,anon,authenticated;
revoke all on function public.rr_finish_interaction_send(uuid,uuid,bigint,uuid,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.rr_receive_telegram(uuid,text,text,text,text,jsonb), public.rr_execute_interaction(uuid,uuid,bigint),
  public.rr_browse_interaction(uuid,uuid,bigint),public.rr_commit_interaction_reply(uuid,uuid,bigint,jsonb),
  public.rr_begin_interaction_send(uuid,uuid,bigint),public.rr_finish_interaction_send(uuid,uuid,bigint,uuid,text,text,text,integer) to service_role;
grant execute on function radar.ui_profile(uuid),radar.ui_callback(uuid,text,jsonb),radar.ui_task(uuid,uuid,bigint),radar.ui_action(radar.telegram_updates),radar.ui_health(),radar.ui_patch(uuid,jsonb),radar.ui_item(uuid,uuid) to service_role;
