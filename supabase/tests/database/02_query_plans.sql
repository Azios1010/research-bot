-- Disposable hosted fixture volume, always rolled back by the verifier.
-- Planner defaults remain enabled; no forced index/disabled sequential scan.
create temporary table rr_query_plans(name text primary key,index_name text not null,plan jsonb not null);
create function pg_temp.expect_index(p_sql text,p_name text,p_index text)
returns void language plpgsql security invoker set search_path = '' as $$
declare v_plan jsonb;
begin
  execute 'explain (format json) ' || p_sql into v_plan;
  if position(p_index in v_plan::text) = 0 then
    raise exception using errcode = 'P0001', message = 'plan_index_missing:' || p_name;
  end if;
  insert into pg_temp.rr_query_plans values(p_name,p_index,v_plan);
end $$;

do $$ declare
  v_scope text := 'rrplan-' || gen_random_uuid();
  v_profile uuid; v_source uuid; v_target uuid;
begin
  insert into radar.research_profiles(display_name) values(v_scope) returning id into v_profile;
  insert into radar.sources(slug,name,category,adapter_version)
    values(v_scope,v_scope,'fixture','query-plan-v1') returning id into v_source;
  insert into radar.delivery_targets(profile_id,bot_id,external_account_id,external_chat_id)
    values(v_profile,'2','2','2') returning id into v_target;
  insert into radar.opportunities(type_code,title,title_key,status,fingerprint,fingerprint_version,content_hash,first_seen_at,last_seen_at)
    select 'conference',v_scope || ':' || g,v_scope || ':' || g,'open',v_scope || ':' || g,1,repeat('b',64),
      now() - g * interval '1 minute',now() from generate_series(1,4096) g;
  insert into radar.opportunity_identities(opportunity_id,kind,key_version,value)
    select id,'natural_key',1,title_key from radar.opportunities where title_key like v_scope || ':%';
  insert into radar.source_records(source_id,source_record_key,opportunity_id,source_url,parser_version,payload_hash,record_status)
    select v_source,title_key,id,'https://example.invalid/query-plan','fixture-v1',repeat('b',64),'accepted'
      from radar.opportunities where title_key like v_scope || ':%';
  insert into radar.opportunity_deadlines(opportunity_id,kind,round_key,label,due_at,due_date,timezone,precision,basis)
    select id,'submission','main','Fixture deadline',
      case when rn % 2 = 0 then now() + rn * interval '1 hour' end,
      case when rn % 2 <> 0 then current_date + rn::integer end,
      'UTC',case when rn % 2 = 0 then 'instant' else 'date' end,'explicit'
    from (select id,row_number() over(order by id) as rn from radar.opportunities where title_key like v_scope || ':%') q;
  insert into radar.opportunity_assessments(profile_id,opportunity_id,eligible,score,opportunity_revision,profile_revision,rules_version,valid_until)
    select v_profile,id,true,row_number() over(order by id) % 101,1,1,'query-plan-v1',now()+interval '1 day'
      from radar.opportunities where title_key like v_scope || ':%';
  insert into radar.user_opportunity_state(profile_id,opportunity_id,saved,saved_at)
    select v_profile,id,true,now() - rn * interval '1 minute'
      from (select id,row_number() over(order by id) as rn from radar.opportunities where title_key like v_scope || ':%') q;
  insert into radar.job_tasks(kind,request_key,payload,available_at)
    select 'maintenance',v_scope || ':' || g,'{"operation":"health"}',
      case when g <= 5 then now() - interval '1 minute' else now() + interval '1 day' end
      from generate_series(1,4096) g;
  insert into radar.notifications(profile_id,delivery_target_id,kind,schedule_key,due_at,expires_at,parts,part_states)
    select v_profile,v_target,'command_reply',v_scope || ':' || g,now() - interval '1 minute',now()+interval '1 day',
      '[{"text":"Query-plan fixture"}]','["prepared"]' from generate_series(1,512) g;
  analyze radar.opportunities;
  analyze radar.opportunity_identities;
  analyze radar.source_records;
  analyze radar.opportunity_deadlines;
  analyze radar.opportunity_assessments;
  analyze radar.user_opportunity_state;
  analyze radar.job_tasks;
  analyze radar.notifications;
  perform pg_temp.expect_index('select id from radar.opportunities where status = ''open'' and type_code = ''conference'' order by first_seen_at desc,id limit 20',
    'bounded opportunity browse','opportunities_browse_idx');
  perform pg_temp.expect_index(format('select id from radar.opportunities where fingerprint_version = 1 and fingerprint = %L',v_scope || ':1'),
    'candidate fingerprint','opportunities_fingerprint_idx');
  perform pg_temp.expect_index(format('select opportunity_id from radar.opportunity_identities where kind = ''natural_key'' and key_version = 1 and value = %L',v_scope || ':1'),
    'strong identity lookup','opportunity_identities_kind_key_version_value_key');
  perform pg_temp.expect_index(format('select id from radar.source_records where source_id = %L and source_record_key = %L',v_source,v_scope || ':1'),
    'source observation lookup','source_records_source_id_source_record_key_key');
  perform pg_temp.expect_index('select opportunity_id from radar.opportunity_deadlines where status = ''current'' and kind in (''application'',''abstract'',''submission'',''registration'') and due_at > now() order by due_at,opportunity_id limit 20',
    'instant deadline browse','deadlines_instant_idx');
  perform pg_temp.expect_index('select opportunity_id from radar.opportunity_deadlines where status = ''current'' and kind in (''application'',''abstract'',''submission'',''registration'') and due_date >= current_date order by due_date,opportunity_id limit 20',
    'date deadline browse','deadlines_date_idx');
  perform pg_temp.expect_index('select id from radar.job_tasks where status = ''queued'' and available_at <= now() order by available_at,id limit 1 for update skip locked',
    'ready task claim','tasks_ready_idx');
  perform pg_temp.expect_index(format('select opportunity_id from radar.opportunity_assessments where profile_id = %L and eligible order by score desc,opportunity_id limit 20',v_profile),
    'profile ranking view','assessments_rank_idx');
  perform pg_temp.expect_index(format('select opportunity_id from radar.user_opportunity_state where profile_id = %L and saved order by saved_at desc limit 20',v_profile),
    'saved view','user_state_saved_idx');
  perform pg_temp.expect_index('select id from radar.notifications where status in (''prepared'',''sending'',''partial'',''uncertain'') and due_at <= now() order by due_at,id limit 20',
    'due notification view','notifications_due_idx');
end $$;
