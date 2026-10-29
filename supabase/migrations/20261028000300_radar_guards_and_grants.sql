create function radar.guard_profile()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.timezone is not null and (new.timezone !~ '/' and new.timezone <> 'UTC'
    or not exists(select 1 from pg_timezone_names where name = new.timezone)) then
    raise exception using errcode = '23514', message = 'profile_timezone_invalid';
  end if;
  if tg_op = 'UPDATE' then
    if row(new.rules,new.rules_schema_version,new.timezone,new.digest_local_time,new.enabled,new.digest_enabled,new.reminders_enabled)
      is distinct from row(old.rules,old.rules_schema_version,old.timezone,old.digest_local_time,old.enabled,old.digest_enabled,old.reminders_enabled) then
      new.revision := old.revision + 1;
    else new.revision := old.revision; end if;
    new.updated_at := clock_timestamp();
  end if;
  return new;
end
$$;
create trigger profiles_validate before insert or update on radar.research_profiles for each row execute function radar.guard_profile();

create function radar.guard_task_transition()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'queued' or new.attempts <> 0 or new.lease_generation <> 0 then
      raise exception using errcode = '23514', message = 'task_initial_state_invalid';
    end if;
    return new;
  end if;
  if row(new.kind,new.request_key,new.coalescing_key,new.payload,new.payload_version,new.collection_run_id,
    new.telegram_bot_id,new.telegram_update_id,new.created_at,new.max_attempts)
    is distinct from row(old.kind,old.request_key,old.coalescing_key,old.payload,old.payload_version,old.collection_run_id,
    old.telegram_bot_id,old.telegram_update_id,old.created_at,old.max_attempts) then
    raise exception using errcode = '23514', message = 'task_identity_immutable';
  end if;
  if old.status in ('succeeded','failed','canceled') and new.status <> old.status then
    raise exception using errcode = '23514', message = 'terminal_task_cannot_reopen';
  end if;
  if new.status = 'leased' and (old.status = 'queued' or (old.status = 'leased' and old.lease_until <= clock_timestamp())) then
    if new.lease_generation <> old.lease_generation + 1 or new.attempts <> old.attempts + 1
      or new.lease_until <= clock_timestamp() or new.lease_until > clock_timestamp() + interval '90 seconds' then
      raise exception using errcode = '23514', message = 'task_claim_transition_invalid';
    end if;
  elsif new.lease_generation <> old.lease_generation or new.attempts <> old.attempts
    or (new.status = 'leased' and (old.status <> 'leased' or new.lease_owner <> old.lease_owner))
    or (new.status = 'succeeded' and old.status <> 'leased' and old.status <> 'succeeded') then
    raise exception using errcode = '23514', message = 'task_lease_transition_invalid';
  end if;
  return new;
end
$$;
create trigger tasks_validate before insert or update on radar.job_tasks for each row execute function radar.guard_task_transition();

create function radar.guard_deadline_revision()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if row(new.due_at,new.due_date,new.timezone,new.precision,new.basis,new.status,new.label)
    is distinct from row(old.due_at,old.due_date,old.timezone,old.precision,old.basis,old.status,old.label) then
    if new.revision <> old.revision + 1 then
      raise exception using errcode = '23514', message = 'deadline_revision_must_advance';
    end if;
  elsif new.revision <> old.revision then
    raise exception using errcode = '23514', message = 'deadline_revision_without_change';
  end if;
  if row(new.opportunity_id,new.kind,new.round_key,new.created_at) is distinct from row(old.opportunity_id,old.kind,old.round_key,old.created_at) then
    raise exception using errcode = '23514', message = 'deadline_identity_immutable';
  end if;
  return new;
end
$$;
create trigger deadlines_validate before update on radar.opportunity_deadlines for each row execute function radar.guard_deadline_revision();

create function radar.guard_notification_reference()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_notification radar.notifications;
begin
  select * into strict v_notification from radar.notifications where id = new.notification_id;
  if new.part_index >= jsonb_array_length(v_notification.parts) then
    raise exception using errcode = '23514', message = 'notification_part_out_of_bounds';
  end if;
  if tg_table_name = 'notification_items' then
    if new.purpose is distinct from (case v_notification.kind when 'digest' then 'digest_first_seen'
      when 'reminder' then 'deadline_reminder' else 'command_view' end) then
      raise exception using errcode = '23514', message = 'notification_purpose_mismatch';
    end if;
  end if;
  return new;
end
$$;
create trigger items_validate before insert or update on radar.notification_items for each row execute function radar.guard_notification_reference();
create trigger attempts_validate before insert or update on radar.notification_attempts for each row execute function radar.guard_notification_reference();

-- Every application table is private; there are deliberately no public RLS policies.
do $$ declare v_table record; v_function record; begin
  for v_table in select tablename from pg_tables where schemaname = 'radar' loop
    execute format('alter table radar.%I enable row level security',v_table.tablename);
    execute format('revoke all on table radar.%I from public, anon, authenticated',v_table.tablename);
    execute format('grant select, insert, update on table radar.%I to service_role',v_table.tablename);
  end loop;
  for v_function in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'radar' or (n.nspname = 'public' and p.proname in (
      'rr_create_collection_run','rr_enqueue_task','rr_claim_task','rr_renew_task','rr_finish_task',
      'rr_accept_telegram_update','rr_apply_feedback','rr_commit_source_page','rr_prepare_notification',
      'rr_begin_notification_attempt','rr_finish_notification_attempt','rr_store_assessments')) loop
    execute format('revoke all on function %s from public, anon, authenticated',v_function.signature);
    execute format('grant execute on function %s to service_role',v_function.signature);
  end loop;
end $$;
revoke all on schema radar from public, anon, authenticated;
grant usage on schema radar to service_role;
revoke all on type radar.safe_url from public, anon, authenticated;
grant usage on type radar.safe_url to service_role;
revoke insert, update on radar.opportunity_types from service_role;
-- No DELETE, TRUNCATE, schema CREATE or generic SQL function is granted to the runtime.
