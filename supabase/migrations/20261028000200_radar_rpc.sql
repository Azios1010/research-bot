-- Transactional persistence primitives only. No fetching, ranking, scheduling, or sending.
create function radar.cursor_digest(p_cursor jsonb)
returns text language sql immutable security invoker set search_path = '' as $$
  select encode(sha256(convert_to(coalesce(p_cursor,'null'::jsonb)::text,'UTF8')),'hex')
$$;

create function radar.paused(p_key text)
returns boolean language sql stable security invoker set search_path = '' as $$
  select coalesce((select (value->>'enabled')::boolean from radar.system_settings where key = p_key),true)
$$;

create function radar.require_lease(p_task uuid,p_owner uuid,p_generation bigint,p_kind text default null)
returns radar.job_tasks language plpgsql security invoker set search_path = '' as $$
declare v_task radar.job_tasks;
begin
  select * into v_task from radar.job_tasks where id = p_task for update;
  if not found or v_task.status <> 'leased' or p_owner is null or p_generation is null
    or v_task.lease_owner <> p_owner or v_task.lease_generation <> p_generation
    or v_task.lease_until <= clock_timestamp()
    or (v_task.expires_at is not null and v_task.expires_at <= clock_timestamp())
    or (p_kind is not null and v_task.kind <> p_kind) then
    raise exception using errcode = '55000', message = 'lease_invalid_or_stale';
  end if;
  return v_task;
end
$$;

create function radar.finalize_run(p_run uuid,p_status text)
returns void language plpgsql security invoker set search_path = '' as $$
declare v_run radar.collection_runs; v_now timestamptz := clock_timestamp();
begin
  if p_status not in ('succeeded','partial','failed','canceled') then
    raise exception using errcode = '22023', message = 'run_terminal_status_required';
  end if;
  update radar.collection_runs set status = case when p_status = 'failed' and pages_committed > 0 then 'partial' else p_status end,
    finished_at = v_now, heartbeat_at = v_now,
    duration_ms = greatest(0,extract(epoch from (v_now - coalesce(started_at,v_now))) * 1000)::bigint
    where id = p_run and status in ('queued','running') returning * into v_run;
  if not found then return; end if;
  update radar.sources set
    last_success_at = case when p_status in ('succeeded','partial') then v_now else last_success_at end,
    consecutive_failures = case when p_status in ('succeeded','partial') then 0 when p_status = 'canceled' then consecutive_failures else consecutive_failures + 1 end,
    cooldown_until = case when p_status in ('succeeded','partial') then null
      when p_status = 'failed' and consecutive_failures + 1 >= 3 then v_now + interval '1 day' else cooldown_until end,
    health_status = case when p_status = 'succeeded' then 'healthy' when p_status = 'canceled' then health_status
      when p_status = 'partial' then 'degraded' when consecutive_failures + 1 >= 3 then 'cooldown' else 'failed' end,
    next_due_at = case when p_status = 'canceled' then next_due_at
      else greatest(v_now + make_interval(mins => cadence_minutes),coalesce(cooldown_until,v_now),
        case when p_status = 'failed' and consecutive_failures + 1 >= 3 then v_now + interval '1 day' else v_now end) end,
    updated_at = v_now where id = v_run.source_id;
end
$$;

create function radar.item_eligible(p_profile uuid,p_opportunity uuid,p_kind text,p_deadline uuid default null,p_revision integer default null)
returns boolean language sql volatile security invoker set search_path = '' as $$
  select exists (
    select 1 from radar.opportunities o join radar.opportunity_types ty on ty.code = o.type_code
    join radar.research_profiles p on p.id = p_profile
    join radar.opportunity_assessments a on a.profile_id = p.id and a.opportunity_id = o.id
    left join radar.user_opportunity_state s on s.profile_id = p.id and s.opportunity_id = o.id
    where o.id = p_opportunity and p.enabled and ty.enabled and o.status in ('open','unknown')
      and not coalesce(s.ignored,false) and a.eligible and a.opportunity_revision = o.content_revision
      and a.profile_revision = p.revision and a.valid_until > clock_timestamp()
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

create function public.rr_prepare_notification(p_profile uuid,p_target uuid,p_kind text,p_schedule_key text,
  p_due_at timestamptz,p_expires_at timestamptz,p_parts jsonb,p_items jsonb,
  p_local_date date default null,p_timezone text default null,
  p_task uuid default null,p_owner uuid default null,p_generation bigint default null)
returns radar.notifications language plpgsql security invoker set search_path = '' as $$
declare v_notification radar.notifications; v_profile radar.research_profiles; v_item jsonb;
  v_states jsonb; v_index integer; v_count integer; v_purpose text; v_task radar.job_tasks;
begin
  v_task := radar.require_lease(p_task,p_owner,p_generation,
    case p_kind when 'digest' then 'prepare_digest' when 'reminder' then 'prepare_reminders' else 'telegram_command' end);
  if (p_kind in ('digest','reminder') and (v_task.payload->>'profile_id')::uuid is distinct from p_profile)
    or (p_kind = 'digest' and (v_task.payload->>'local_date')::date is distinct from p_local_date)
    or (p_kind = 'command_reply' and not exists(select 1 from radar.telegram_updates
      where bot_id = v_task.telegram_bot_id and update_id = v_task.telegram_update_id and profile_id = p_profile)) then
    raise exception using errcode = '22023', message = 'notification_task_context_mismatch';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('notification-profile:' || p_profile,0));
  select * into v_notification from radar.notifications where profile_id = p_profile and kind = p_kind and schedule_key = p_schedule_key;
  if found then return v_notification; end if;
  select * into strict v_profile from radar.research_profiles where id = p_profile for update;
  perform 1 from radar.delivery_targets where id = p_target and profile_id = p_profile and enabled for update;
  if not found then raise exception using errcode = '22023', message = 'delivery_target_unavailable'; end if;
  if p_kind not in ('digest','reminder','command_reply') or jsonb_typeof(p_parts) is distinct from 'array'
    or jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) > 100
    or p_expires_at <= p_due_at or p_expires_at <= clock_timestamp()
    or (p_kind = 'digest' and (not v_profile.digest_enabled or not v_profile.enabled or p_timezone is distinct from v_profile.timezone))
    or (p_kind = 'reminder' and (not v_profile.reminders_enabled or not v_profile.enabled)) then
    raise exception using errcode = '22023', message = 'notification_preparation_invalid';
  end if;
  v_count := jsonb_array_length(p_parts);
  if (p_kind = 'reminder' and jsonb_array_length(p_items) <> 1)
    or (p_kind <> 'command_reply' and jsonb_array_length(p_items) = 0 and v_count <> 0)
    or (jsonb_array_length(p_items) > 0 and v_count = 0) then
    raise exception using errcode = '22023', message = 'notification_membership_invalid';
  end if;
  select coalesce(jsonb_agg('prepared'::text),'[]') into v_states from generate_series(1,v_count);
  insert into radar.notifications(profile_id,delivery_target_id,kind,schedule_key,local_date,timezone_snapshot,
    due_at,expires_at,status,parts,part_states)
    values(p_profile,p_target,p_kind,p_schedule_key,p_local_date,p_timezone,p_due_at,p_expires_at,
      case when v_count = 0 then 'skipped_empty' else 'prepared' end,p_parts,v_states) returning * into v_notification;
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_purpose := case p_kind when 'digest' then 'digest_first_seen' when 'reminder' then 'deadline_reminder' else 'command_view' end;
    if not radar.object_ok(v_item) or v_item - array['opportunity_id','part_index','deadline_id','deadline_revision','reminder_offset_days','snapshot'] <> '{}'::jsonb then
      raise exception using errcode = '22023', message = 'notification_item_invalid';
    end if;
    perform 1 from radar.opportunities where id = (v_item->>'opportunity_id')::uuid;
    if not found then raise exception using errcode = '22023', message = 'notification_opportunity_missing'; end if;
    if p_kind <> 'command_reply' and not radar.item_eligible(p_profile,(v_item->>'opportunity_id')::uuid,p_kind,
      (v_item->>'deadline_id')::uuid,(v_item->>'deadline_revision')::integer) then
      raise exception using errcode = '55000', message = 'notification_item_ineligible';
    end if;
    if p_kind = 'reminder' and p_schedule_key is distinct from ('reminder:' || (v_item->>'deadline_id') || ':'
      || (v_item->>'deadline_revision') || ':' || (v_item->>'reminder_offset_days')) then
      raise exception using errcode = '22023', message = 'reminder_schedule_key_invalid';
    end if;
    insert into radar.notification_items(notification_id,profile_id,opportunity_id,part_index,purpose,
      deadline_id,deadline_revision,reminder_offset_days,claim_active,snapshot)
      values(v_notification.id,p_profile,(v_item->>'opportunity_id')::uuid,(v_item->>'part_index')::integer,v_purpose,
        (v_item->>'deadline_id')::uuid,(v_item->>'deadline_revision')::integer,(v_item->>'reminder_offset_days')::integer,
        p_kind <> 'command_reply',coalesce(v_item->'snapshot','{}'));
  end loop;
  for v_index in 0..v_count-1 loop
    perform public.rr_enqueue_task('send_notification','send:' || v_notification.id || ':' || v_index,
      jsonb_build_object('notification_id',v_notification.id,'part_index',v_index),p_due_at,p_expires_at);
  end loop;
  perform radar.require_lease(p_task,p_owner,p_generation);
  return v_notification;
end
$$;

create function public.rr_begin_notification_attempt(p_task uuid,p_owner uuid,p_generation bigint)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_task radar.job_tasks; v_notification radar.notifications; v_attempt radar.notification_attempts;
  v_profile uuid; v_id uuid; v_part integer; v_number integer; v_state text;
begin
  v_task := radar.require_lease(p_task,p_owner,p_generation,'send_notification');
  v_id := (v_task.payload->>'notification_id')::uuid; v_part := (v_task.payload->>'part_index')::integer;
  select profile_id into strict v_profile from radar.notifications where id = v_id;
  perform pg_advisory_xact_lock(hashtextextended('notification-profile:' || v_profile,0));
  select * into strict v_notification from radar.notifications where id = v_id for update;
  v_state := v_notification.part_states->>v_part;
  if v_state in ('sent','canceled') then
    perform public.rr_finish_task(p_task,p_owner,p_generation,'succeeded');
    return jsonb_build_object('disposition',v_state);
  end if;
  if v_state is null or v_state not in ('prepared','retryable_failure')
    or radar.paused('delivery_paused') or v_notification.due_at > clock_timestamp()
    or exists(select 1 from radar.notification_attempts where notification_id = v_id and part_index = v_part and state in ('sending','uncertain')) then
    raise exception using errcode = '55000', message = 'notification_part_not_sendable';
  end if;
  if v_notification.expires_at <= clock_timestamp() or not exists (
    select 1 from radar.delivery_targets where id = v_notification.delivery_target_id and enabled)
    or exists(select 1 from radar.notification_items i where i.notification_id = v_id and i.part_index = v_part
      and v_notification.kind <> 'command_reply'
      and not radar.item_eligible(i.profile_id,i.opportunity_id,v_notification.kind,i.deadline_id,i.deadline_revision)) then
    update radar.notifications set part_states = jsonb_set(part_states,array[v_part::text],'"canceled"') where id = v_id;
    update radar.notification_items set claim_active = false where notification_id = v_id and part_index = v_part;
    perform radar.refresh_notification(v_id);
    perform public.rr_finish_task(p_task,p_owner,p_generation,'succeeded');
    return jsonb_build_object('disposition','canceled');
  end if;
  select coalesce(max(attempt_number),0)+1 into v_number from radar.notification_attempts where notification_id = v_id and part_index = v_part;
  perform radar.require_lease(p_task,p_owner,p_generation,'send_notification');
  insert into radar.notification_attempts(notification_id,part_index,attempt_number,task_id,lease_generation,state)
    values(v_id,v_part,v_number,p_task,p_generation,'sending') returning * into v_attempt;
  update radar.notifications set part_states = jsonb_set(part_states,array[v_part::text],'"sending"') where id = v_id;
  perform radar.refresh_notification(v_id);
  return jsonb_build_object('disposition','sending','attempt_id',v_attempt.id,'part',v_notification.parts->v_part,
    'delivery_target_id',v_notification.delivery_target_id);
end
$$;

create function public.rr_finish_notification_attempt(p_task uuid,p_owner uuid,p_generation bigint,p_attempt uuid,
  p_outcome text,p_message_id text default null,p_error_class text default null,p_retry_seconds integer default 60)
returns radar.notification_attempts language plpgsql security invoker set search_path = '' as $$
declare v_task radar.job_tasks; v_attempt radar.notification_attempts; v_profile uuid; v_part_state text;
begin
  v_task := radar.require_lease(p_task,p_owner,p_generation,'send_notification');
  select n.profile_id into strict v_profile from radar.notification_attempts a
    join radar.notifications n on n.id = a.notification_id where a.id = p_attempt;
  perform pg_advisory_xact_lock(hashtextextended('notification-profile:' || v_profile,0));
  select * into strict v_attempt from radar.notification_attempts where id = p_attempt for update;
  if v_attempt.task_id <> p_task or v_attempt.lease_generation <> p_generation or v_attempt.state <> 'sending'
    or p_outcome not in ('sent','retryable_failure','permanent_failure','uncertain') or p_retry_seconds not between 1 and 86400 then
    raise exception using errcode = '55000', message = 'notification_attempt_transition_invalid';
  end if;
  perform radar.require_lease(p_task,p_owner,p_generation,'send_notification');
  update radar.notification_attempts set state = p_outcome,finished_at = clock_timestamp(),telegram_message_id = p_message_id,
    error_class = p_error_class,retry_after_seconds = case when p_outcome = 'retryable_failure' then p_retry_seconds else null end
    where id = p_attempt returning * into v_attempt;
  v_part_state := case p_outcome when 'permanent_failure' then 'failed' else p_outcome end;
  if p_outcome = 'retryable_failure' and (v_task.attempts >= v_task.max_attempts
    or v_task.expires_at <= clock_timestamp() + make_interval(secs => p_retry_seconds)) then v_part_state := 'failed'; end if;
  update radar.notifications set part_states = jsonb_set(part_states,array[v_attempt.part_index::text],to_jsonb(v_part_state)) where id = v_attempt.notification_id;
  perform radar.refresh_notification(v_attempt.notification_id);
  if p_outcome = 'uncertain' then
    -- Terminalize work, retain claims and unresolved attempt; no automatic resend path.
    update radar.job_tasks set status = 'failed',finished_at = clock_timestamp(),lease_owner = null,lease_until = null,
      last_error_code = 'send_uncertain' where id = p_task;
  else
    perform public.rr_finish_task(p_task,p_owner,p_generation,
      case p_outcome when 'sent' then 'succeeded' when 'retryable_failure' then 'retry' else 'failed' end,p_error_class,p_retry_seconds);
  end if;
  return v_attempt;
end
$$;

create function public.rr_create_collection_run(p_source_id uuid,p_request_key text,p_trigger_kind text)
returns radar.collection_runs language plpgsql security invoker set search_path = '' as $$
declare v_source radar.sources; v_run radar.collection_runs;
begin
  select * into strict v_source from radar.sources where id = p_source_id for update;
  select * into v_run from radar.collection_runs where request_key = p_request_key;
  if found then
    if v_run.source_id <> p_source_id or v_run.trigger_kind <> p_trigger_kind then
      raise exception using errcode = '22023', message = 'request_key_reused';
    end if;
    return v_run;
  end if;
  select * into v_run from radar.collection_runs where source_id = p_source_id and status in ('queued','running');
  if found then return v_run; end if;
  if not v_source.enabled or v_source.approved_at is null or radar.paused('collection_paused')
    or v_source.cooldown_until > clock_timestamp() then
    raise exception using errcode = '55000', message = 'source_not_collectible';
  end if;
  insert into radar.collection_runs(source_id,trigger_kind,request_key,cursor_hash,adapter_version,config_version)
    values(p_source_id,p_trigger_kind,p_request_key,radar.cursor_digest(null),v_source.adapter_version,v_source.config_version)
    returning * into v_run;
  insert into radar.job_tasks(kind,request_key,coalescing_key,payload,collection_run_id)
    values('collect_page','collect:' || v_run.id || ':0','collect-source:' || p_source_id,
      jsonb_build_object('page_sequence',0,'cursor_hash',v_run.cursor_hash),v_run.id);
  return v_run;
end
$$;

create function public.rr_enqueue_task(p_kind text,p_request_key text,p_payload jsonb,
  p_available_at timestamptz default now(),p_expires_at timestamptz default null)
returns radar.job_tasks language plpgsql security invoker set search_path = '' as $$
declare v_task radar.job_tasks; v_allowed text[];
begin
  v_allowed := case p_kind
    when 'assess_batch' then array['profile_id','opportunity_ids']
    when 'prepare_digest' then array['profile_id','local_date']
    when 'prepare_reminders' then array['profile_id']
    when 'send_notification' then array['notification_id','part_index']
    when 'maintenance' then array['operation'] else null end;
  if v_allowed is null or not radar.object_ok(p_payload) or p_payload - v_allowed <> '{}'::jsonb then
    raise exception using errcode = '22023', message = 'task_payload_invalid';
  end if;
  if p_kind in ('assess_batch','prepare_digest','prepare_reminders') then
    perform 1 from radar.research_profiles where id = (p_payload->>'profile_id')::uuid;
    if not found then raise exception using errcode = '22023', message = 'task_profile_missing'; end if;
  end if;
  if p_kind = 'assess_batch' and not coalesce(case when jsonb_typeof(p_payload->'opportunity_ids') = 'array'
    then jsonb_array_length(p_payload->'opportunity_ids') between 1 and 100 else false end,false) then
    raise exception using errcode = '22023', message = 'assessment_batch_invalid';
  end if;
  if p_kind = 'prepare_digest' and (p_payload->>'local_date')::date is null then
    raise exception using errcode = '22023', message = 'digest_date_required';
  end if;
  if p_kind = 'send_notification' then
    perform 1 from radar.notifications where id = (p_payload->>'notification_id')::uuid
      and (p_payload->>'part_index')::integer between 0 and jsonb_array_length(parts)-1;
    if not found then raise exception using errcode = '22023', message = 'notification_part_missing'; end if;
  end if;
  if p_kind = 'maintenance' and coalesce(p_payload->>'operation','') not in ('retention','health') then
    raise exception using errcode = '22023', message = 'maintenance_operation_invalid';
  end if;
  insert into radar.job_tasks(kind,request_key,payload,available_at,expires_at)
    values(p_kind,p_request_key,p_payload,p_available_at,p_expires_at)
    on conflict(request_key) do nothing returning * into v_task;
  if not found then
    select * into strict v_task from radar.job_tasks where request_key = p_request_key;
    if v_task.kind <> p_kind or v_task.payload <> p_payload then
      raise exception using errcode = '22023', message = 'request_key_reused';
    end if;
  end if;
  return v_task;
end
$$;

create function radar.refresh_notification(p_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare v_states jsonb; v_status text;
begin
  select part_states into strict v_states from radar.notifications where id = p_id for update;
  if jsonb_array_length(v_states) = 0 then return; end if;
  select case
    when bool_or(s = 'uncertain') then 'uncertain'
    when bool_or(s = 'sending') then 'sending'
    when bool_and(s = 'sent') then 'sent'
    when bool_or(s = 'sent') then 'partial'
    when bool_and(s = 'canceled') then 'canceled'
    when bool_or(s = 'failed') then 'failed' else 'prepared' end
    into v_status from jsonb_array_elements_text(v_states) x(s);
  update radar.notifications set status = v_status,
    sent_at = case when v_status = 'sent' then clock_timestamp() else null end where id = p_id;
end
$$;

create function public.rr_claim_task(p_owner uuid,p_kinds text[],p_lease_seconds integer default 90)
returns radar.job_tasks language plpgsql security invoker set search_path = '' as $$
declare v_task radar.job_tasks; v_attempt radar.notification_attempts; v_now timestamptz := clock_timestamp();
begin
  if p_owner is null or p_lease_seconds is null or p_lease_seconds not between 1 and 90
    or p_kinds is null or cardinality(p_kinds) not between 1 and 7 then
    raise exception using errcode = '22023', message = 'claim_arguments_invalid';
  end if;
  -- Expired send leases are never evidence that no external message was delivered.
  for v_task in select * from radar.job_tasks t where t.kind = any(p_kinds)
    and ((t.status = 'leased' and t.lease_until <= v_now) or (t.status = 'queued' and t.expires_at <= v_now))
    order by t.id limit 100 for update skip locked loop
    for v_attempt in select * from radar.notification_attempts where task_id = v_task.id and state = 'sending' for update loop
      update radar.notification_attempts set state = 'uncertain',finished_at = v_now,error_class = 'lease_expired'
        where id = v_attempt.id;
      update radar.notifications set part_states = jsonb_set(part_states,array[v_attempt.part_index::text],'"uncertain"')
        where id = v_attempt.notification_id;
      perform radar.refresh_notification(v_attempt.notification_id);
    end loop;
    if v_task.attempts >= v_task.max_attempts or v_task.expires_at <= v_now or exists (
      select 1 from radar.notification_attempts where task_id = v_task.id and state = 'uncertain') then
      update radar.job_tasks set status = 'failed',finished_at = v_now,lease_owner = null,lease_until = null,
        last_error_code = 'expired_or_exhausted' where id = v_task.id;
      if v_task.collection_run_id is not null then
        perform radar.finalize_run(v_task.collection_run_id,'failed');
      end if;
      if v_task.kind = 'telegram_command' then
        update radar.telegram_updates set status = 'failed',completed_at = v_now,error_code = 'task_exhausted'
          where bot_id = v_task.telegram_bot_id and update_id = v_task.telegram_update_id;
      end if;
    end if;
  end loop;
  select * into v_task from radar.job_tasks t where t.kind = any(p_kinds) and t.attempts < t.max_attempts
    and t.available_at <= v_now and (t.expires_at is null or t.expires_at > v_now)
    and (t.status = 'queued' or (t.status = 'leased' and t.lease_until <= v_now))
    order by t.available_at,t.id limit 1 for update skip locked;
  if not found then return null; end if;
  update radar.job_tasks set status = 'leased',lease_owner = p_owner,lease_generation = lease_generation + 1,
    attempts = attempts + 1,lease_until = v_now + make_interval(secs => p_lease_seconds)
    where id = v_task.id returning * into v_task;
  if v_task.kind = 'collect_page' then
    update radar.collection_runs set status = 'running',started_at = coalesce(started_at,v_now),heartbeat_at = v_now
      where id = v_task.collection_run_id and status in ('queued','running');
  elsif v_task.kind = 'telegram_command' then
    update radar.telegram_updates set status = 'processing' where bot_id = v_task.telegram_bot_id and update_id = v_task.telegram_update_id;
  end if;
  return v_task;
end
$$;

create function public.rr_renew_task(p_task uuid,p_owner uuid,p_generation bigint,p_lease_seconds integer default 90)
returns radar.job_tasks language plpgsql security invoker set search_path = '' as $$
declare v_task radar.job_tasks;
begin
  v_task := radar.require_lease(p_task,p_owner,p_generation);
  if p_lease_seconds is null or p_lease_seconds not between 1 and 90 then raise exception using errcode = '22023', message = 'lease_duration_invalid'; end if;
  update radar.job_tasks set lease_until = clock_timestamp() + make_interval(secs => p_lease_seconds)
    where id = p_task returning * into v_task;
  return v_task;
end
$$;

create function public.rr_finish_task(p_task uuid,p_owner uuid,p_generation bigint,p_result text,
  p_error_code text default null,p_retry_seconds integer default 60)
returns radar.job_tasks language plpgsql security invoker set search_path = '' as $$
declare v_task radar.job_tasks; v_state text; v_now timestamptz := clock_timestamp();
begin
  v_task := radar.require_lease(p_task,p_owner,p_generation);
  if p_result is null or p_result not in ('succeeded','failed','retry') or (v_task.kind = 'collect_page' and p_result = 'succeeded')
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
  if v_task.collection_run_id is not null and v_state = 'failed' then
    update radar.collection_runs set error_counts = jsonb_set(error_counts,array[left(coalesce(p_error_code,'task_failed'),100)],
      to_jsonb(coalesce((error_counts->>left(coalesce(p_error_code,'task_failed'),100))::bigint,0)+1)) where id = v_task.collection_run_id;
    perform radar.finalize_run(v_task.collection_run_id,'failed');
  elsif v_task.kind = 'telegram_command' and v_state <> 'queued' then
    update radar.telegram_updates set status = case when v_state = 'succeeded' then 'completed' else 'failed' end,
      completed_at = v_now,error_code = p_error_code where bot_id = v_task.telegram_bot_id and update_id = v_task.telegram_update_id;
  end if;
  return v_task;
end
$$;

create function public.rr_accept_telegram_update(p_target uuid,p_bot_id text,p_update_id bigint,p_action jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_target radar.delivery_targets; v_update radar.telegram_updates; v_task uuid;
begin
  select t.* into strict v_target from radar.delivery_targets t join radar.research_profiles p on p.id = t.profile_id
    where t.id = p_target and t.bot_id = p_bot_id and t.enabled for update of t;
  -- Profile may still be incomplete: /start, /profile, /help and /status must work.
  insert into radar.telegram_updates(bot_id,update_id,delivery_target_id,profile_id,action)
    values(p_bot_id,p_update_id,p_target,v_target.profile_id,p_action)
    on conflict(bot_id,update_id) do nothing returning * into v_update;
  if not found then
    select * into strict v_update from radar.telegram_updates where bot_id = p_bot_id and update_id = p_update_id;
    if v_update.delivery_target_id <> p_target then raise exception using errcode = '22023', message = 'update_target_mismatch'; end if;
    return jsonb_build_object('duplicate',true,'status',v_update.status);
  end if;
  insert into radar.job_tasks(kind,request_key,telegram_bot_id,telegram_update_id,payload)
    values('telegram_command','telegram:' || p_bot_id || ':' || p_update_id,p_bot_id,p_update_id,
      jsonb_build_object('bot_id',p_bot_id,'update_id',p_update_id::text)) returning id into v_task;
  return jsonb_build_object('duplicate',false,'task_id',v_task,'status','accepted');
end
$$;

create function public.rr_apply_feedback(p_profile uuid,p_opportunity uuid,p_action text,p_idempotency_key text,p_context jsonb default '{}',
  p_task uuid default null,p_owner uuid default null,p_generation bigint default null)
returns radar.user_opportunity_state language plpgsql security invoker set search_path = '' as $$
declare v_feedback radar.user_feedback; v_state radar.user_opportunity_state; v_now timestamptz := clock_timestamp(); v_task radar.job_tasks;
begin
  v_task := radar.require_lease(p_task,p_owner,p_generation,'telegram_command');
  if not exists(select 1 from radar.telegram_updates where bot_id = v_task.telegram_bot_id
    and update_id = v_task.telegram_update_id and profile_id = p_profile) then
    raise exception using errcode = '22023', message = 'feedback_task_profile_mismatch';
  end if;
  -- Serialize desired-state changes per profile/item, including retry after an uncertain reply.
  perform pg_advisory_xact_lock(hashtextextended('notification-profile:' || p_profile,0));
  perform pg_advisory_xact_lock(hashtextextended('feedback:' || p_profile || ':' || p_opportunity,0));
  insert into radar.user_feedback(profile_id,opportunity_id,action,idempotency_key,context)
    values(p_profile,p_opportunity,p_action,p_idempotency_key,p_context)
    on conflict(profile_id,idempotency_key) do nothing returning * into v_feedback;
  if not found then
    select * into strict v_feedback from radar.user_feedback where profile_id = p_profile and idempotency_key = p_idempotency_key;
    if v_feedback.opportunity_id <> p_opportunity or v_feedback.action <> p_action then
      raise exception using errcode = '22023', message = 'feedback_key_reused';
    end if;
  else
    insert into radar.user_opportunity_state(profile_id,opportunity_id) values(p_profile,p_opportunity)
      on conflict(profile_id,opportunity_id) do nothing;
    update radar.user_opportunity_state set
      saved = case when p_action = 'save' then true when p_action = 'unsave' then false else saved end,
      saved_at = case when p_action = 'save' then coalesce(saved_at,v_now) when p_action = 'unsave' then null else saved_at end,
      ignored = case when p_action = 'ignore' then true when p_action = 'unignore' then false else ignored end,
      ignored_at = case when p_action = 'ignore' then coalesce(ignored_at,v_now) when p_action = 'unignore' then null else ignored_at end,
      last_open_intent_at = case when p_action = 'open_intent' then v_now else last_open_intent_at end,updated_at = v_now
      where profile_id = p_profile and opportunity_id = p_opportunity;
  end if;
  select * into strict v_state from radar.user_opportunity_state where profile_id = p_profile and opportunity_id = p_opportunity;
  perform radar.require_lease(p_task,p_owner,p_generation,'telegram_command');
  return v_state;
end
$$;

create function radar.store_rejection(p_source uuid,p_run uuid,p_key text,p_url radar.safe_url,
  p_parser text,p_hash text,p_code text,p_status text default 'quarantined')
returns void language sql security invoker set search_path = '' as $$
  insert into radar.source_records(source_id,source_record_key,source_url,parser_version,payload_hash,record_status,error_code,last_run_id)
    values(p_source,p_key,p_url,p_parser,p_hash,p_status,p_code,p_run)
  on conflict(source_id,source_record_key) do update set
    source_url = excluded.source_url,parser_version = excluded.parser_version,payload_hash = excluded.payload_hash,
    record_status = excluded.record_status,error_code = excluded.error_code,last_run_id = excluded.last_run_id,
    last_seen_at = clock_timestamp()
$$;

create function radar.upsert_record(p_source uuid,p_run uuid,p_record jsonb)
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
    update radar.opportunities set last_seen_at = clock_timestamp() where id = v_id;
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

create function public.rr_commit_source_page(p_task uuid,p_owner uuid,p_generation bigint,
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

create function public.rr_store_assessments(p_task uuid,p_owner uuid,p_generation bigint,p_assessments jsonb)
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
      raise exception using errcode = '40001', message = 'assessment_revision_stale';
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

-- Revoke defaults in the SAME migration that introduces public wrappers.
-- Do not alter default privileges for unrelated functions in the public schema.
do $$ declare v_function record; begin
  for v_function in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'rr_create_collection_run','rr_enqueue_task','rr_claim_task','rr_renew_task','rr_finish_task',
      'rr_accept_telegram_update','rr_apply_feedback','rr_commit_source_page','rr_prepare_notification',
      'rr_begin_notification_attempt','rr_finish_notification_attempt','rr_store_assessments') loop
    execute format('revoke all on function %s from public, anon, authenticated',v_function.signature);
  end loop;
end $$;
