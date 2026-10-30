create temporary table rr_assertions(name text primary key);
create function pg_temp.ok(b boolean,n text) returns void language plpgsql set search_path='' as $$ begin
 if b is distinct from true then raise exception using errcode='P0001',message='assertion_failed:' || n; end if;
 insert into pg_temp.rr_assertions values(n); end $$;
create function pg_temp.denied(n text,q text,c text) returns void language plpgsql set search_path='' as $$ declare caught boolean:=false; begin
 begin execute q; exception when others then if sqlstate<>c then raise exception using errcode='P0001',message='unexpected_sqlstate:' || n || ':' || sqlstate; end if; caught:=true; end;
 perform pg_temp.ok(caught,n); end $$;
do $$ declare p uuid; o uuid; t radar.job_tasks; owner_id uuid:=gen_random_uuid(); r bigint; j jsonb; bad jsonb; first_id uuid; before_rules jsonb; n integer;
begin
 insert into radar.research_profiles(display_name) values('Synthetic personalization profile') returning id into p;
 insert into radar.opportunities(type_code,title,title_key,content_hash,fingerprint,fingerprint_version,status)
 values('phd','Synthetic MRI','synthetic mri',repeat('a',64),repeat('b',64),1,'open') returning id into o;
 perform pg_temp.ok(radar.ui_patch(p,'{"timezone":"UTC","topics":["MRI"],"types":["phd"],"enabled":true,"preferences":{"type_weights":{"phd":1},"reminder_offsets":[7,1]}}'),'atomic validated profile replacement');
 select revision,rules into r,before_rules from radar.research_profiles where id=p;
 perform pg_temp.ok(r=2,'meaningful profile edit increments revision once');
 perform pg_temp.ok((select count(*)=1 from radar.job_tasks where kind='assess_batch'),'profile edit queues bounded rerank');
 perform pg_temp.ok(radar.ui_patch(p,'{"timezone":"UTC"}') and (select revision=r from radar.research_profiles where id=p),'no op keeps revision');
 perform pg_temp.ok(not radar.ui_patch(p,'{"timezone":"Europe/Paris","preferences":{"type_weights":{"phd":-1}}}') and (select timezone='UTC' and rules=before_rules and revision=r from radar.research_profiles where id=p),'invalid multiple field patch rolls back all');
 for bad in select value from jsonb_array_elements('[{"unsupported":1},{"enabled_types":["faculty"]},{"type_weights":{"phd":2}},{"preferred_countries":["ZZ"]},{"positive_topics":["MRI","mri"]},{"reminder_offsets":[1.5]},{"eligibility_facts":{"fabricated":"yes"}},{"unknown_policy":false},{"preferred_work_modes":["unknown"]}]') loop
   perform pg_temp.denied('invalid rules rejected ' || (select count(*) from pg_temp.rr_assertions),format('update radar.research_profiles set rules=%L::jsonb where id=%L',bad::text,p),'23514');
 end loop;
 perform pg_temp.ok(not radar.ui_patch(p,'{"remindersEnabled":true,"preferences":{"reminder_offsets":[]}}'),'reminders require explicit offsets');
 perform pg_temp.ok(not radar.profile_rules_valid(jsonb_build_object('blocked_topics',jsonb_build_array(repeat('😀',81)))),'profile UTF16 bounds match TypeScript');
 perform pg_temp.ok(radar.profile_rules_valid('{"preferred_countries":["BW"]}'),'complete ISO profile country catalog');
 perform pg_temp.ok(not radar.profile_rules_valid('{"positive_topics":["medical  imaging","medical imaging"]}'),'normalized duplicate phrase whitespace rejected');
 perform pg_temp.ok(not radar.profile_rules_valid(jsonb_build_object('positive_topics',jsonb_build_array(U&'\00A0'))),'normalized empty phrase rejected');
 perform pg_temp.ok(not radar.profile_rules_valid(jsonb_build_object('positive_topics',jsonb_build_array(repeat('𝐀',81)))),'raw UTF16 bound precedes compatibility normalization');
 first_id:=public.rr_request_rerank(p,'same-request');
 perform pg_temp.ok(first_id=public.rr_request_rerank(p,'same-request'),'active rerank coalesces');
 t:=public.rr_claim_task(owner_id,array['assess_batch']);
 j:=jsonb_build_array(jsonb_build_object('opportunity_id',o,'opportunity_revision',1,'profile_revision',r,'eligible',true,'score',65,'rules_version','deterministic-v2','evaluated_at',clock_timestamp(),'valid_until',clock_timestamp()+interval '12 hours'));
 perform pg_temp.ok(public.rr_store_assessments(t.id,owner_id,t.lease_generation,j)=1,'assessment stored with current revisions');
 perform pg_temp.ok((radar.ui_item(o,p)->>'score')::numeric=65,'current assessment visible');
 update radar.opportunity_assessments set rules_version='deterministic-v1' where profile_id=p;
 perform pg_temp.ok(radar.ui_item(o,p)->'score'='null'::jsonb and not radar.item_eligible(p,o,'digest'),'old rule invalidates reads and delivery');
 update radar.opportunity_assessments set rules_version='deterministic-v2',evaluated_at=clock_timestamp()-interval '2 seconds',valid_until=clock_timestamp()-interval '1 second' where profile_id=p;
 perform pg_temp.ok(radar.ui_item(o,p)->'score'='null'::jsonb,'time expired assessment hidden');
 update radar.opportunity_assessments set valid_until=clock_timestamp()+interval '1 day',opportunity_revision=2 where profile_id=p;
 perform pg_temp.ok(radar.ui_item(o,p)->'score'='null'::jsonb,'opportunity revision mismatch hidden');
 update radar.opportunity_assessments set opportunity_revision=1 where profile_id=p;
 perform radar.ui_patch(p,'{"preferences":{"blocked_topics":["MRI"]}}');
 perform pg_temp.ok(radar.ui_item(o,p)->'score'='null'::jsonb,'profile revision mismatch hidden');
 t:=public.rr_claim_task(owner_id,array['assess_batch']);
 perform pg_temp.denied('stale profile write rejected',format('select public.rr_store_assessments(%L,%L,%s,%L::jsonb)',t.id,owner_id,t.lease_generation,j::text),'PT409');
 -- Superseded chain terminalizes without overwriting a newer profile assessment.
 perform radar.ui_patch(p,'{"preferences":{"blocked_topics":[]}}');
 n:=public.rr_store_assessments(t.id,owner_id,t.lease_generation,'[]');
 perform pg_temp.ok(n=0 and (select status='canceled' from radar.job_tasks where id=t.id),'superseded rerank cannot overwrite');
end $$;
select pg_temp.denied('anon cannot request rerank','set local role anon; select public.rr_request_rerank(gen_random_uuid(),''forged'')','42501');
select pg_temp.denied('authenticated cannot request rerank','set local role authenticated; select public.rr_request_rerank(gen_random_uuid(),''forged'')','42501');
