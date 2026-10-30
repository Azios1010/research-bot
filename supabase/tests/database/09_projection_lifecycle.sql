create temporary table rr_assertions(name text primary key);
create function pg_temp.ok(p_condition boolean,p_name text) returns void language plpgsql set search_path='' as $$ begin
  if p_condition is distinct from true then raise exception using errcode='P0001',message='assertion_failed:' || p_name; end if;
  insert into pg_temp.rr_assertions values(p_name);
end $$;
do $$ declare v_profile uuid; v_funding uuid; v_journal uuid; v_event uuid; v_view jsonb; begin
  insert into radar.research_profiles(display_name)values('Synthetic lifecycle fixture')returning id into v_profile;
  insert into radar.opportunities(type_code,title,title_key,fingerprint,fingerprint_version,content_hash,status,attributes)
    values('grant','Synthetic forecast','synthetic forecast','forecast',1,repeat('a',64),'open','{"schema_version":1,"funding":{"schema_version":1,"source_status":"forecasted"}}')returning id into v_funding;
  insert into radar.opportunities(type_code,title,title_key,fingerprint,fingerprint_version,content_hash,status,attributes)
    values('journal_special_issue','Synthetic upcoming call','synthetic upcoming','upcoming',1,repeat('a',64),'open','{"schema_version":1,"journal_call":{"schema_version":1,"source_status":"upcoming"}}')returning id into v_journal;
  insert into radar.opportunities(type_code,title,title_key,fingerprint,fingerprint_version,content_hash,status,event_start)
    values('conference','Synthetic event','synthetic event','event',1,repeat('a',64),'open',current_date+30)returning id into v_event;
  insert into radar.opportunity_deadlines(opportunity_id,kind,round_key,label,precision,basis,due_at,timezone)
    values(v_event,'submission','paper','Paper submission','instant','explicit',clock_timestamp()-interval '1 day','UTC'),
      (v_event,'registration','registration','Registration','instant','explicit',clock_timestamp()+interval '1 day','UTC');
  perform pg_temp.ok(radar.ui_item(v_funding,v_profile)->>'status'='forecast','forecast overrides retained open display');
  perform pg_temp.ok(radar.ui_item(v_journal,v_profile)->>'status'='upcoming','upcoming overrides retained open display');
  v_view:=radar.ui_item(v_event,v_profile);
  perform pg_temp.ok(v_view->>'status'='open' and v_view->'notes' @> '["Known submission rounds have elapsed; event lifecycle is separate."]','submission availability distinct from event lifecycle');
  perform pg_temp.ok(v_view->'deadlines'->0->>'label'='Registration','next current actionable round precedes elapsed round');
end $$;
