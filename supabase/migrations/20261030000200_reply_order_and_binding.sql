-- Forward correction: ordered replies and original-account binding survive rebinding.
-- Existing invoker/search-path/grants remain intact; no schedules or network IO.

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
    else jsonb_build_object('kind','feedback','opportunityId',v_id,'desired',case v_code
      when 's' then 'save' when 'u' then 'unsave' when 'i' then 'ignore' when 'r' then 'unignore' when 'o' then 'open_intent' end) end;
end
$$;

create or replace function public.rr_commit_interaction_reply(p_task uuid,p_owner uuid,p_generation bigint,p_parts jsonb)
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
  -- Preserve logical part order; concurrent workers also check predecessors before IO.
  update radar.job_tasks set available_at=v_n.due_at + make_interval(secs => (payload->>'part_index')::integer * 0.001)
    where kind='send_notification' and payload->>'notification_id'=v_n.id::text and status='queued';
  perform public.rr_finish_task(p_task,p_owner,p_generation,'succeeded');
  return v_n.id;
end
$$;

create or replace function public.rr_begin_interaction_send(p_task uuid,p_owner uuid,p_generation bigint)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_task radar.job_tasks; v_target radar.delivery_targets; v_plan jsonb; v_n radar.notifications; v_index integer; v_cancel boolean; v_profile uuid;
begin
  v_task := radar.require_lease(p_task,p_owner,p_generation,'send_notification');
  select profile_id into strict v_profile from radar.notifications where id=(v_task.payload->>'notification_id')::uuid and kind='command_reply';
  perform pg_advisory_xact_lock(hashtextextended('notification-profile:' || v_profile,0));
  select * into strict v_n from radar.notifications where id=(v_task.payload->>'notification_id')::uuid and kind='command_reply' for update;
  select * into strict v_target from radar.delivery_targets where id=v_n.delivery_target_id;
  v_index := (v_task.payload->>'part_index')::integer;
  v_cancel := not exists(select 1 from radar.job_tasks c join radar.telegram_updates u
    on u.bot_id=c.telegram_bot_id and u.update_id=c.telegram_update_id where v_n.schedule_key='command:' || c.id
      and u.delivery_target_id=v_target.id and u.action->>'actor'=v_target.external_account_id and u.action->>'chat'=v_target.external_chat_id);
  v_cancel := v_cancel or exists(select 1 from jsonb_array_elements_text(v_n.part_states) with ordinality s(state,ordinal)
    where ordinal<=v_index and state in ('failed','uncertain'));
  if v_cancel then
    update radar.notifications set part_states=jsonb_set(part_states,array[v_index::text],'"canceled"') where id=v_n.id;
    update radar.notification_items set claim_active=false where notification_id=v_n.id and part_index=v_index;
    perform radar.refresh_notification(v_n.id);
    perform public.rr_finish_task(p_task,p_owner,p_generation,'succeeded');
    return jsonb_build_object('disposition','canceled');
  end if;
  if exists(select 1 from jsonb_array_elements_text(v_n.part_states) with ordinality s(state,ordinal)
    where ordinal<=v_index and state not in ('sent','canceled')) then
    perform public.rr_finish_task(p_task,p_owner,p_generation,'retry','reply_order_waiting',30);
    return jsonb_build_object('disposition','deferred');
  end if;
  v_plan := public.rr_begin_notification_attempt(p_task,p_owner,p_generation);
  return v_plan || jsonb_build_object('destination',jsonb_build_object('account',v_target.external_chat_id,'bot',v_target.bot_id));
end
$$;

