-- Conditional validators prove a fully processed snapshot of this config/parser only.
create or replace function public.rr_read_collection_context(p_task uuid,p_owner uuid,p_generation bigint)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_task radar.job_tasks; v_run radar.collection_runs; v_source radar.sources; v_validators jsonb;
begin
  select * into strict v_task from radar.job_tasks where id=p_task;
  if v_task.kind <> 'collect_page' then raise exception using errcode='22023',message='collection_context_kind_invalid'; end if;
  if v_task.status <> 'succeeded' then v_task := radar.require_lease(p_task,p_owner,p_generation,'collect_page'); end if;
  select * into strict v_run from radar.collection_runs where id=v_task.collection_run_id;
  select * into strict v_source from radar.sources where id=v_run.source_id;
  if v_task.status <> 'succeeded' and (v_run.config_version <> v_source.config_version or v_run.adapter_version <> v_source.adapter_version) then
    raise exception using errcode='55000',message='source_run_not_current';
  end if;
  v_validators := v_run.conditional_validators;
  if v_run.page_sequence=0 and v_validators='{}'::jsonb then
    select case when status in ('succeeded','partial') and cursor is null
        and config_version=v_run.config_version and adapter_version=v_run.adapter_version
      then conditional_validators else '{}'::jsonb end into v_validators from radar.collection_runs
      where source_id=v_source.id and id<>v_run.id and status not in ('queued','running')
      order by finished_at desc nulls last,id limit 1;
  end if;
  return jsonb_build_object('source',to_jsonb(v_source),'run',to_jsonb(v_run),
    'page_sequence',(v_task.payload->>'page_sequence')::bigint,'cursor_hash',v_task.payload->>'cursor_hash',
    'validators',coalesce(v_validators,'{}'),'replayed',v_task.status='succeeded','paused',radar.paused('collection_paused'));
end
$$;

notify pgrst, 'reload schema';
