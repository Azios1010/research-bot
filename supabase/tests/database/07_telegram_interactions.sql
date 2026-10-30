-- Always rolled back by the guarded hosted verifier. Synthetic identities only.
create temporary table rr_assertions(name text primary key);
create function pg_temp.ok(p_condition boolean,p_name text) returns void
language plpgsql security invoker set search_path='' as $$ begin
  if p_condition is distinct from true then raise exception using errcode='P0001',message='assertion_failed:' || p_name; end if;
  insert into pg_temp.rr_assertions values(p_name);
end $$;
create function pg_temp.must_fail(p_name text,p_sql text,p_expected text) returns void
language plpgsql security invoker set search_path='' as $$ declare caught boolean:=false; begin
  begin execute p_sql; exception when others then
    if sqlstate<>p_expected then raise exception using errcode='P0001',message='unexpected_sqlstate:' || p_name || ':' || sqlstate; end if; caught:=true;
  end;
  perform pg_temp.ok(caught,p_name);
end $$;
do $$ declare
  v_profile uuid; v_target uuid; v_owner uuid:=gen_random_uuid(); v_task radar.job_tasks; v_send radar.job_tasks;
  v_r jsonb; v_c jsonb; v_parts jsonb; v_n uuid; v_attempt jsonb; v_id uuid; v_token text; v_source uuid;
  v_rev bigint; v_count integer;
begin
  update radar.system_settings set value='{"enabled":false}' where key in ('collection_paused','delivery_paused');
  insert into radar.research_profiles(display_name) values('Synthetic Phase 07 profile') returning id into v_profile;
  insert into radar.delivery_targets(profile_id,external_account_id,external_chat_id,bot_id,enabled)
    values(v_profile,'10000000000000001','10000000000000001','999000111',true) returning id into v_target;
  perform pg_temp.must_fail('wrong target denied',format('select public.rr_receive_telegram(%L,%L,%L,%L,%L,%L)',v_target,'999000111','20000000000000002','20000000000000002','1','{"kind":"command","command":"start"}'),'42501');
  v_r:=public.rr_receive_telegram(v_target,'999000111','10000000000000001','10000000000000001','9007199254740995','{"kind":"command","command":"start"}');
  perform pg_temp.ok(v_r->>'duplicate'='false','lossless update receipt');
  v_r:=public.rr_receive_telegram(v_target,'999000111','10000000000000001','10000000000000001','9007199254740995','{"kind":"command","command":"start"}');
  perform pg_temp.ok(v_r->>'duplicate'='true' and (select count(*)=1 from radar.job_tasks where telegram_update_id=9007199254740995),'atomic inbox dedupe');
  v_task:=public.rr_claim_task(v_owner,array['telegram_command']);
  v_c:=public.rr_execute_interaction(v_task.id,v_owner,v_task.lease_generation);
  perform pg_temp.ok(v_c->'profile'->>'enabled'='false' and v_c->'profile'->'topics'='[]','incomplete profile remains disabled');
  perform pg_temp.must_fail('stale interaction fence',format('select public.rr_execute_interaction(%L,%L,%s)',v_task.id,v_owner,v_task.lease_generation+1),'55000');
  v_parts:='[{"text":"Synthetic start","buttons":[],"itemIds":[],"renderingVersion":1}]';
  v_n:=public.rr_commit_interaction_reply(v_task.id,v_owner,v_task.lease_generation,v_parts);
  perform pg_temp.ok((select status='completed' from radar.telegram_updates where update_id=9007199254740995) and (select count(*)=1 from radar.notifications where id=v_n),'reply and completion atomic');
  v_r:=public.rr_receive_telegram(v_target,'999000111','10000000000000001','10000000000000001','9007199254740995','{"kind":"command","command":"start"}');
  perform pg_temp.ok((select count(*)=1 from radar.notifications where profile_id=v_profile),'logical reply replay prevented');
  v_send:=public.rr_claim_task(v_owner,array['send_notification']);
  v_attempt:=public.rr_begin_interaction_send(v_send.id,v_owner,v_send.lease_generation);
  perform pg_temp.ok(v_attempt->'destination'->>'account'='10000000000000001' and (select state='sending' from radar.notification_attempts where task_id=v_send.id),'attempt before external IO');
  perform public.rr_finish_interaction_send(v_send.id,v_owner,v_send.lease_generation,(v_attempt->>'attempt_id')::uuid,'sent','9007199254740997');
  perform pg_temp.ok((select telegram_message_id='9007199254740997' and state='sent' from radar.notification_attempts where task_id=v_send.id),'lossless message success');
  perform public.rr_receive_telegram(v_target,'999000111','10000000000000001','10000000000000001','1002','{"kind":"command","command":"help"}');
  v_task:=public.rr_claim_task(v_owner,array['telegram_command']); perform public.rr_finish_task(v_task.id,v_owner,v_task.lease_generation,'succeeded');
  perform public.rr_receive_telegram(v_target,'999000111','10000000000000001','10000000000000001','1001','{"kind":"command","command":"help"}');
  v_task:=public.rr_claim_task(v_owner,array['telegram_command']); perform public.rr_finish_task(v_task.id,v_owner,v_task.lease_generation,'succeeded');
  perform pg_temp.ok((select count(*)=2 from radar.telegram_updates where update_id in (1001,1002) and status='completed'),'out of order IDs accepted');
  perform public.rr_receive_telegram(v_target,'999000111','10000000000000001','10000000000000001','1003','{"kind":"command","command":"profile","patch":{"enabled":true}}');
  v_task:=public.rr_claim_task(v_owner,array['telegram_command']); v_c:=public.rr_execute_interaction(v_task.id,v_owner,v_task.lease_generation);
  perform pg_temp.ok(v_c->'result'->>'status'='invalid_profile' and v_c->'profile'->>'enabled'='false','incomplete enable rejected');
  perform public.rr_finish_task(v_task.id,v_owner,v_task.lease_generation,'succeeded');
  perform public.rr_receive_telegram(v_target,'999000111','10000000000000001','10000000000000001','1004','{"kind":"command","command":"profile","patch":{"timezone":"UTC","topics":["synthetic topic"],"types":["conference"],"enabled":true}}');
  v_task:=public.rr_claim_task(v_owner,array['telegram_command']); v_c:=public.rr_execute_interaction(v_task.id,v_owner,v_task.lease_generation);
  v_rev:=(v_c->'profile'->>'revision')::bigint;
  perform pg_temp.ok(v_c->'profile'->>'enabled'='true' and v_c->'profile'->>'digestEnabled'='false','basic supplied profile setup');
  v_c:=public.rr_execute_interaction(v_task.id,v_owner,v_task.lease_generation);
  perform pg_temp.ok((v_c->'profile'->>'revision')::bigint=v_rev,'profile effect journal replay');
  perform public.rr_finish_task(v_task.id,v_owner,v_task.lease_generation,'succeeded');
  insert into radar.opportunities(type_code,title,title_key,fingerprint,fingerprint_version,content_hash,canonical_url,status)
    values('conference','Synthetic item','synthetic item',repeat('a',64),1,repeat('b',64),'https://example.invalid/item','open') returning id into v_id;
  perform public.rr_receive_telegram(v_target,'999000111','10000000000000001','10000000000000001','1005','{"kind":"command","command":"conferences"}');
  v_task:=public.rr_claim_task(v_owner,array['telegram_command']); v_c:=public.rr_browse_interaction(v_task.id,v_owner,v_task.lease_generation);
  perform pg_temp.ok(jsonb_array_length(v_c->'items')=1 and v_c->'snapshot'->'ids'=jsonb_build_array(v_id),'bounded snapshot projection');
  v_token:='1:s:' || replace(v_task.id::text,'-','') || ':0';
  v_parts:=jsonb_build_array(jsonb_build_object('text','Synthetic item','buttons',jsonb_build_array(jsonb_build_array(jsonb_build_object('label','Save','action',v_token))),
    'itemIds',jsonb_build_array(v_id),'view',v_c->'snapshot','renderingVersion',1));
  v_n:=public.rr_commit_interaction_reply(v_task.id,v_owner,v_task.lease_generation,v_parts);
  v_send:=public.rr_claim_task(v_owner,array['send_notification']); v_attempt:=public.rr_begin_interaction_send(v_send.id,v_owner,v_send.lease_generation);
  perform public.rr_finish_interaction_send(v_send.id,v_owner,v_send.lease_generation,(v_attempt->>'attempt_id')::uuid,'sent','100');
  v_r:=public.rr_receive_telegram(v_target,'999000111','10000000000000001','10000000000000001','1006',jsonb_build_object('kind','callback','token',v_token,'messageId','101'));
  perform pg_temp.ok(v_r->>'status'='rejected' and not exists(select 1 from radar.job_tasks where telegram_update_id=1006),'copied message callback denied');
  v_r:=public.rr_receive_telegram(v_target,'999000111','10000000000000001','10000000000000001','1007',jsonb_build_object('kind','callback','token',v_token,'messageId','100'));
  v_task:=public.rr_claim_task(v_owner,array['telegram_command']); v_c:=public.rr_execute_interaction(v_task.id,v_owner,v_task.lease_generation);
  perform pg_temp.ok((select saved from radar.user_opportunity_state where profile_id=v_profile and opportunity_id=v_id),'authorized desired state save');
  v_c:=public.rr_execute_interaction(v_task.id,v_owner,v_task.lease_generation);
  perform pg_temp.ok((select count(*)=1 from radar.user_feedback where profile_id=v_profile) and (select saved from radar.user_opportunity_state where profile_id=v_profile and opportunity_id=v_id),'feedback journal replay');
  perform public.rr_finish_task(v_task.id,v_owner,v_task.lease_generation,'succeeded');
  insert into radar.sources(slug,name,category,adapter_version,enabled,approved_at) values('p07-' || gen_random_uuid(),'Synthetic refresh','fixture','fake-json-v1',true,clock_timestamp()) returning id into v_source;
  perform public.rr_receive_telegram(v_target,'999000111','10000000000000001','10000000000000001','1008','{"kind":"command","command":"refresh"}');
  v_task:=public.rr_claim_task(v_owner,array['telegram_command']); v_c:=public.rr_execute_interaction(v_task.id,v_owner,v_task.lease_generation);
  perform pg_temp.ok(v_c->'result'->>'status'='queued' and (select count(*)=1 from radar.collection_runs where source_id=v_source),'refresh durably queued');
  perform public.rr_execute_interaction(v_task.id,v_owner,v_task.lease_generation);
  perform pg_temp.ok((select count(*)=1 from radar.collection_runs where source_id=v_source),'refresh effect replay coalesced');
  perform public.rr_finish_task(v_task.id,v_owner,v_task.lease_generation,'succeeded');
  perform public.rr_receive_telegram(v_target,'999000111','10000000000000001','10000000000000001','1009','{"kind":"command","command":"refresh"}');
  v_task:=public.rr_claim_task(v_owner,array['telegram_command']); v_c:=public.rr_execute_interaction(v_task.id,v_owner,v_task.lease_generation);
  perform pg_temp.ok(v_c->'result'->>'status'='throttled','refresh five minute throttle');
  v_n:=public.rr_commit_interaction_reply(v_task.id,v_owner,v_task.lease_generation,'[{"text":"Crash fixture","buttons":[],"itemIds":[],"renderingVersion":1}]');
  v_send:=public.rr_claim_task(v_owner,array['send_notification']); v_attempt:=public.rr_begin_interaction_send(v_send.id,v_owner,v_send.lease_generation);
  update radar.job_tasks set lease_until=clock_timestamp()-interval '1 second' where id=v_send.id;
  perform public.rr_claim_task(gen_random_uuid(),array['send_notification']);
  perform pg_temp.ok((select state='uncertain' from radar.notification_attempts where id=(v_attempt->>'attempt_id')::uuid) and (select status='failed' from radar.job_tasks where id=v_send.id),'crash marker reclaimed as uncertain');
  perform pg_temp.ok((select status='uncertain' from radar.notifications where id=v_n),'uncertain notification retained');
  select count(*) into v_count from radar.job_tasks where status='queued' and kind='send_notification';
  perform public.rr_receive_telegram(v_target,'999000111','10000000000000001','10000000000000001','1009','{"kind":"command","command":"refresh"}');
  perform pg_temp.ok((select count(*)=v_count from radar.job_tasks where status='queued' and kind='send_notification'),'uncertain replay cannot enqueue another reply');
end $$;
