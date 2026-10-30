create temporary table rr_assertions(name text primary key);
create function pg_temp.ok(p_condition boolean,p_name text) returns void language plpgsql set search_path='' as $$ begin
  if p_condition is distinct from true then raise exception using errcode='P0001',message='assertion_failed:' || p_name; end if;
  insert into pg_temp.rr_assertions values(p_name);
end $$;
do $$ declare
  v_profile uuid; v_target uuid; v_id uuid; v_owner uuid:=gen_random_uuid(); v_task radar.job_tasks; v_a radar.job_tasks; v_b radar.job_tasks;
  v_n uuid; v_attempt jsonb; v_plan jsonb; v_token text; v_parts jsonb; v_unsent uuid;
begin
  update radar.system_settings set value='{"enabled":false}' where key='delivery_paused';
  insert into radar.research_profiles(display_name)values('Synthetic ordering fixture')returning id into v_profile;
  insert into radar.delivery_targets(profile_id,external_account_id,external_chat_id,bot_id,enabled)values(v_profile,'10000000000000001','10000000000000001','999000111',true)returning id into v_target;
  insert into radar.opportunities(type_code,title,title_key,fingerprint,fingerprint_version,content_hash)values('conference','Ordering item','ordering item',repeat('a',64),1,repeat('b',64))returning id into v_id;
  perform public.rr_receive_telegram(v_target,'999000111','10000000000000001','10000000000000001','1','{"kind":"command","command":"help"}');
  v_task:=public.rr_claim_task(v_owner,array['telegram_command']);
  v_token:='1:d:' || replace(v_task.id::text,'-','') || ':0';
  v_parts:=jsonb_build_array(jsonb_build_object('text','First part','renderingVersion',1,'itemIds',jsonb_build_array(v_id),'buttons',jsonb_build_array(jsonb_build_array(jsonb_build_object('label','Details','action',v_token)))),
    jsonb_build_object('text','Second part','renderingVersion',1,'itemIds','[]'::jsonb,'buttons','[]'::jsonb));
  v_n:=public.rr_commit_interaction_reply(v_task.id,v_owner,v_task.lease_generation,v_parts);
  update radar.job_tasks set available_at=clock_timestamp()-interval '1 second'+make_interval(secs=>(payload->>'part_index')::integer*0.001)
    where kind='send_notification' and payload->>'notification_id'=v_n::text;
  v_a:=public.rr_claim_task(v_owner,array['send_notification']); v_b:=public.rr_claim_task(gen_random_uuid(),array['send_notification']);
  perform pg_temp.ok((v_a.payload->>'part_index')::integer=0 and (v_b.payload->>'part_index')::integer=1,'parts claimed in intended order');
  v_plan:=public.rr_begin_interaction_send(v_b.id,v_b.lease_owner,v_b.lease_generation);
  perform pg_temp.ok(v_plan->>'disposition'='deferred' and not exists(select 1 from radar.notification_attempts where task_id=v_b.id),'concurrent successor defers before IO');
  v_attempt:=public.rr_begin_interaction_send(v_a.id,v_owner,v_a.lease_generation);
  perform public.rr_finish_interaction_send(v_a.id,v_owner,v_a.lease_generation,(v_attempt->>'attempt_id')::uuid,'sent','200');
  update radar.job_tasks set available_at=clock_timestamp()-interval '1 second' where id=v_b.id;
  v_b:=public.rr_claim_task(v_owner,array['send_notification']);
  v_attempt:=public.rr_begin_interaction_send(v_b.id,v_owner,v_b.lease_generation);
  perform public.rr_finish_interaction_send(v_b.id,v_owner,v_b.lease_generation,(v_attempt->>'attempt_id')::uuid,'sent','201');
  perform pg_temp.ok((select status='sent' from radar.notifications where id=v_n),'ordered parts finish definite success');
  perform pg_temp.ok(radar.ui_callback(v_target,'999000111',jsonb_build_object('token',v_token,'messageId','200'))->>'kind'='details','original bound callback accepted');
  perform public.rr_receive_telegram(v_target,'999000111','10000000000000001','10000000000000001','2','{"kind":"command","command":"help"}');
  v_task:=public.rr_claim_task(v_owner,array['telegram_command']);
  v_unsent:=public.rr_commit_interaction_reply(v_task.id,v_owner,v_task.lease_generation,'[{"text":"Unsent old binding","renderingVersion":1,"itemIds":[],"buttons":[]}]');
  update radar.delivery_targets set external_account_id='20000000000000002',external_chat_id='20000000000000002' where id=v_target;
  perform pg_temp.ok(radar.ui_callback(v_target,'999000111',jsonb_build_object('token',v_token,'messageId','200')) is null,'old callback denied after same target rebinding');
  v_a:=public.rr_claim_task(v_owner,array['send_notification']);v_plan:=public.rr_begin_interaction_send(v_a.id,v_owner,v_a.lease_generation);
  perform pg_temp.ok(v_plan->>'disposition'='canceled' and not exists(select 1 from radar.notification_attempts where task_id=v_a.id),'old unsent reply canceled on rebinding');
  perform pg_temp.ok((select status='canceled' from radar.notifications where id=v_unsent),'rebinding cancellation remains visible');
end $$;
