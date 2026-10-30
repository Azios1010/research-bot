-- Serialize assessment CAS with profile edits and desired-state feedback.
create or replace function public.rr_store_assessments(p_task uuid,p_owner uuid,p_generation bigint,p_assessments jsonb)
returns integer language plpgsql security invoker set search_path = '' as $$
declare v_task radar.job_tasks; v_item jsonb; v_opportunity radar.opportunities; v_profile radar.research_profiles;
  v_seen uuid[] := '{}'; v_id uuid; v_count integer := 0; v_evaluated timestamptz; v_until timestamptz; v_last uuid;
begin
  v_task := radar.require_lease(p_task,p_owner,p_generation,'assess_batch');
  -- Same lock order as profile edits and feedback; Ignore cannot race this CAS.
  perform pg_advisory_xact_lock(hashtextextended('notification-profile:' || (v_task.payload->>'profile_id'),0));
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



notify pgrst, 'reload schema';
