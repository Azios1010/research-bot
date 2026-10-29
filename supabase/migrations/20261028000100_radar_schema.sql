-- Phase 02: no source, profile, credential, Cron, or delivery seed data.
create schema radar;
revoke all on schema radar from public, anon, authenticated;
alter default privileges in schema radar revoke all on tables from public, anon, authenticated;
alter default privileges in schema radar revoke all on sequences from public, anon, authenticated;
alter default privileges in schema radar revoke execute on functions from public, anon, authenticated;

create function radar.object_ok(p_value jsonb, p_limit integer default 16384)
returns boolean language sql immutable security invoker set search_path = '' as $$
  select coalesce(jsonb_typeof(p_value) = 'object'
    and octet_length(p_value::text) <= p_limit, false)
$$;

create domain radar.safe_url as text check (
  length(value) <= 4096 and value ~ '^https?://[A-Za-z0-9][A-Za-z0-9.-]*(:[0-9]+)?([/?#][^[:space:]]*)?$'
);

create table radar.opportunity_types (
  code text primary key check (code ~ '^[a-z_]+$'),
  label text not null,
  family text not null check (family in ('position','event','call','funding')),
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
insert into radar.opportunity_types(code,label,family) values
  ('phd','PhD position','position'), ('postdoc','Postdoctoral position','position'),
  ('research_assistant','Research Assistant position','position'),
  ('research_internship','Research internship','position'),
  ('conference','Conference','event'), ('workshop','Workshop','event'),
  ('conference_cfp','Conference call for papers','call'),
  ('journal_cfp','Journal call for papers','call'),
  ('journal_special_issue','Journal special issue','call'),
  ('grant','Grant','funding'), ('research_funding','Research funding','funding');

create table radar.opportunities (
  id uuid primary key default gen_random_uuid(),
  type_code text not null references radar.opportunity_types(code),
  title text not null check (length(btrim(title)) between 1 and 1024),
  title_key text not null check (length(btrim(title_key)) between 1 and 1024),
  organization text, organization_key text,
  description text check (octet_length(description) <= 32768),
  topics text[] not null default '{}', qualification_tags text[] not null default '{}',
  country_codes text[] not null default '{}', location_text text,
  work_mode text not null default 'unknown' check (work_mode in ('onsite','hybrid','remote','unknown')),
  canonical_url radar.safe_url, published_at timestamptz,
  cycle_key text, track_key text,
  parent_opportunity_id uuid references radar.opportunities(id),
  event_start date, event_end date,
  status text not null default 'unknown' check (status in ('open','closed','withdrawn','unknown','merged')),
  merged_into_id uuid references radar.opportunities(id),
  fingerprint text not null check (length(fingerprint) between 1 and 256),
  fingerprint_version integer not null check (fingerprint_version > 0),
  attributes jsonb not null default '{"schema_version":1}' check (radar.object_ok(attributes)
    and coalesce(jsonb_typeof(attributes->'schema_version') = 'number', false)),
  quality_flags text[] not null default '{}',
  field_provenance jsonb not null default '{}' check (radar.object_ok(field_provenance)),
  content_hash text not null check (length(content_hash) = 64),
  content_revision bigint not null default 1 check (content_revision > 0),
  first_seen_at timestamptz not null default now(), last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (parent_opportunity_id is distinct from id),
  check (merged_into_id is distinct from id),
  check ((status = 'merged') = (merged_into_id is not null)),
  check (event_end is null or event_start is null or event_end >= event_start),
  check (last_seen_at >= first_seen_at),
  check (array_position(topics,null) is null and cardinality(topics) <= 100),
  check (array_position(country_codes,null) is null and cardinality(country_codes) <= 50),
  check (array_position(qualification_tags,null) is null and cardinality(qualification_tags) <= 100)
);
create index opportunities_browse_idx on radar.opportunities(status,type_code,first_seen_at desc,id);
create index opportunities_fingerprint_idx on radar.opportunities(fingerprint_version,fingerprint);
create index opportunities_parent_idx on radar.opportunities(parent_opportunity_id);
create index opportunities_merged_idx on radar.opportunities(merged_into_id);

create table radar.sources (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{0,99}$'),
  name text not null, category text not null,
  adapter_version text not null, enabled boolean not null default false,
  approved_at timestamptz, config_version integer not null default 1 check (config_version > 0),
  config jsonb not null default '{}' check (radar.object_ok(config)),
  cadence_minutes integer not null default 1440 check (cadence_minutes between 5 and 525600),
  next_due_at timestamptz not null default now(), last_success_at timestamptz,
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  cooldown_until timestamptz,
  health_status text not null default 'unknown' check (health_status in ('unknown','healthy','degraded','failed','cooldown')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (not enabled or approved_at is not null)
);
create index sources_due_idx on radar.sources(next_due_at) where enabled;

create table radar.collection_runs (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references radar.sources(id),
  trigger_kind text not null check (trigger_kind in ('scheduled','manual','retry','test')),
  request_key text not null unique check (length(request_key) between 1 and 512),
  status text not null default 'queued' check (status in ('queued','running','partial','succeeded','failed','canceled')),
  started_at timestamptz, finished_at timestamptz, heartbeat_at timestamptz,
  cursor jsonb, cursor_hash text not null check (cursor_hash ~ '^[a-f0-9]{64}$'),
  page_sequence bigint not null default 0 check (page_sequence >= 0),
  source_revision text,
  conditional_validators jsonb not null default '{}' check (radar.object_ok(conditional_validators)),
  pages_committed integer not null default 0 check (pages_committed >= 0),
  records_seen bigint not null default 0, accepted bigint not null default 0,
  inserted bigint not null default 0, updated bigint not null default 0,
  duplicates bigint not null default 0, rejected bigint not null default 0,
  error_counts jsonb not null default '{}' check (radar.object_ok(error_counts)),
  error_samples jsonb not null default '[]' check (jsonb_typeof(error_samples) = 'array'
    and jsonb_array_length(error_samples) <= 20 and octet_length(error_samples::text) <= 16384),
  adapter_version text not null, config_version integer not null,
  duration_ms bigint check (duration_ms >= 0),
  unique(id,source_id),
  check (records_seen >= 0 and accepted >= 0 and inserted >= 0 and updated >= 0 and duplicates >= 0 and rejected >= 0),
  check (records_seen = accepted + rejected and accepted = inserted + updated + duplicates),
  check ((status in ('partial','succeeded','failed','canceled')) = (finished_at is not null)),
  check (status <> 'running' or started_at is not null),
  check (cursor is null or octet_length(cursor::text) <= 4096)
);
create unique index collection_runs_active_source_uidx on radar.collection_runs(source_id) where status in ('queued','running');
create index collection_runs_history_idx on radar.collection_runs(source_id,started_at desc);
create index collection_runs_heartbeat_idx on radar.collection_runs(status,heartbeat_at);

create table radar.source_records (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references radar.sources(id),
  source_record_key text not null check (length(source_record_key) between 1 and 1024 and octet_length(source_record_key) <= 2000),
  opportunity_id uuid references radar.opportunities(id),
  source_url radar.safe_url not null, source_revision text,
  parser_version text not null, payload_hash text not null,
  record_status text not null check (record_status in ('accepted','quarantined','conflict')),
  normalized_snapshot jsonb check (normalized_snapshot is null or radar.object_ok(normalized_snapshot)),
  metadata jsonb not null default '{}' check (radar.object_ok(metadata)),
  error_code text, quality_flags text[] not null default '{}',
  first_seen_at timestamptz not null default now(), last_seen_at timestamptz not null default now(),
  last_run_id uuid,
  unique(source_id,source_record_key), unique(id,opportunity_id),
  foreign key(last_run_id,source_id) references radar.collection_runs(id,source_id),
  check (record_status <> 'accepted' or opportunity_id is not null),
  check (record_status = 'accepted' or error_code is not null),
  check (octet_length(coalesce(normalized_snapshot,'{}')::text) + octet_length(metadata::text) <= 16384),
  check (last_seen_at >= first_seen_at)
);
create index source_records_opportunity_idx on radar.source_records(opportunity_id);
create index source_records_seen_idx on radar.source_records(source_id,last_seen_at);
create index source_records_run_idx on radar.source_records(last_run_id,source_id);
create index source_records_rejected_idx on radar.source_records(source_id,record_status) where record_status <> 'accepted';

create table radar.opportunity_deadlines (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references radar.opportunities(id),
  kind text not null check (kind in ('application','abstract','submission','registration','rebuttal','decision','other')),
  round_key text not null check (length(round_key) between 1 and 256),
  label text not null check (length(btrim(label)) between 1 and 1024),
  due_at timestamptz, due_date date, timezone text, raw_value text,
  precision text not null check (precision in ('instant','date','unknown')),
  basis text not null check (basis in ('explicit','source_default','unknown')),
  status text not null default 'current' check (status in ('current','superseded','conflicted')),
  revision integer not null default 1 check (revision > 0),
  source_record_id uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(opportunity_id,kind,round_key), unique(id,opportunity_id),
  foreign key(source_record_id,opportunity_id) references radar.source_records(id,opportunity_id),
  check ((precision = 'instant' and due_at is not null and nullif(btrim(timezone),'') is not null and basis <> 'unknown')
    or (precision = 'date' and due_date is not null and due_at is null)
    or (precision = 'unknown' and due_at is null and due_date is null)),
  check (raw_value is null or length(raw_value) <= 2048)
);
create index deadlines_instant_idx on radar.opportunity_deadlines(due_at,opportunity_id) where status = 'current' and kind in ('application','abstract','submission','registration');
create index deadlines_date_idx on radar.opportunity_deadlines(due_date,opportunity_id) where status = 'current' and kind in ('application','abstract','submission','registration');
create index deadlines_source_idx on radar.opportunity_deadlines(source_record_id,opportunity_id);

create table radar.opportunity_identities (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references radar.opportunities(id),
  kind text not null check (kind in ('listing_url','natural_key')),
  key_version integer not null check (key_version > 0),
  value text not null check (length(value) between 1 and 4096 and octet_length(value) <= 2000),
  evidence jsonb not null default '{}' check (radar.object_ok(evidence,8192)),
  source_record_id uuid,
  created_at timestamptz not null default now(),
  unique(kind,key_version,value),
  foreign key(source_record_id,opportunity_id) references radar.source_records(id,opportunity_id)
);
create index identities_opportunity_idx on radar.opportunity_identities(opportunity_id);
create index identities_source_idx on radar.opportunity_identities(source_record_id,opportunity_id);

create table radar.research_profiles (
  id uuid primary key default gen_random_uuid(), display_name text not null,
  enabled boolean not null default false, timezone text,
  digest_local_time time not null default '08:00',
  digest_enabled boolean not null default false, reminders_enabled boolean not null default false,
  revision bigint not null default 1 check (revision > 0),
  rules_schema_version integer not null default 1 check (rules_schema_version > 0),
  rules jsonb not null default '{}' check (radar.object_ok(rules)),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (not enabled or timezone is not null),
  check (not (digest_enabled or reminders_enabled) or (enabled and coalesce(
    case when jsonb_typeof(rules->'positive_topics') = 'array'
      then jsonb_array_length(rules->'positive_topics') > 0 else false end, false)))
);

create table radar.opportunity_assessments (
  profile_id uuid not null references radar.research_profiles(id),
  opportunity_id uuid not null references radar.opportunities(id),
  eligible boolean not null, score numeric,
  reason_codes text[] not null default '{}',
  components jsonb not null default '{}' check (radar.object_ok(components)),
  opportunity_revision bigint not null check (opportunity_revision > 0),
  profile_revision bigint not null check (profile_revision > 0), rules_version text not null,
  evaluated_at timestamptz not null default now(), valid_until timestamptz not null,
  primary key(profile_id,opportunity_id),
  check ((eligible and score is not null and score between 0 and 100) or (not eligible and score is null)),
  check (valid_until >= evaluated_at)
);
create index assessments_rank_idx on radar.opportunity_assessments(profile_id,eligible,score desc,opportunity_id);
create index assessments_expiry_idx on radar.opportunity_assessments(valid_until);
create index assessments_opportunity_idx on radar.opportunity_assessments(opportunity_id);

create table radar.user_opportunity_state (
  profile_id uuid not null references radar.research_profiles(id),
  opportunity_id uuid not null references radar.opportunities(id),
  saved boolean not null default false, ignored boolean not null default false,
  saved_at timestamptz, ignored_at timestamptz, last_open_intent_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key(profile_id,opportunity_id),
  check (saved = (saved_at is not null)), check (ignored = (ignored_at is not null))
);
create index user_state_saved_idx on radar.user_opportunity_state(profile_id,saved_at desc) where saved;
create index user_state_opportunity_idx on radar.user_opportunity_state(opportunity_id);

create table radar.user_feedback (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references radar.research_profiles(id),
  opportunity_id uuid not null references radar.opportunities(id),
  action text not null check (action in ('save','unsave','ignore','unignore','open_intent')),
  idempotency_key text not null check (length(idempotency_key) between 1 and 512),
  occurred_at timestamptz not null default now(),
  context jsonb not null default '{}' check (radar.object_ok(context)),
  unique(profile_id,idempotency_key)
);
create index feedback_history_idx on radar.user_feedback(profile_id,opportunity_id,occurred_at desc);
create index feedback_opportunity_idx on radar.user_feedback(opportunity_id);

create table radar.delivery_targets (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references radar.research_profiles(id),
  channel text not null default 'telegram' check (channel = 'telegram'),
  external_account_id text not null check (external_account_id ~ '^[0-9]{1,20}$'),
  external_chat_id text not null check (external_chat_id ~ '^[0-9]{1,20}$'),
  bot_id text not null check (bot_id ~ '^[0-9]{1,20}$'),
  enabled boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(channel,bot_id,external_account_id), unique(id,profile_id), unique(id,profile_id,bot_id),
  check (external_account_id = external_chat_id)
);
create unique index targets_active_profile_uidx on radar.delivery_targets(profile_id,bot_id) where enabled;

create table radar.telegram_updates (
  bot_id text not null, update_id bigint not null check (update_id >= 0),
  delivery_target_id uuid not null, profile_id uuid not null,
  action jsonb, action_schema_version integer not null default 1 check (action_schema_version > 0),
  payload_redacted_at timestamptz,
  status text not null default 'accepted' check (status in ('accepted','processing','completed','rejected','failed')),
  received_at timestamptz not null default now(), completed_at timestamptz, error_code text,
  primary key(bot_id,update_id),
  foreign key(delivery_target_id,profile_id,bot_id) references radar.delivery_targets(id,profile_id,bot_id),
  check (action is null or radar.object_ok(action,8192)),
  check ((status in ('completed','rejected','failed')) = (completed_at is not null)),
  check (action is not null or (payload_redacted_at is not null and status in ('completed','rejected','failed')))
);
create index updates_status_idx on radar.telegram_updates(status,received_at);
create index updates_target_idx on radar.telegram_updates(delivery_target_id,profile_id,bot_id);

create table radar.job_tasks (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('collect_page','assess_batch','telegram_command','prepare_digest','prepare_reminders','send_notification','maintenance')),
  request_key text not null unique check (length(request_key) between 1 and 512), coalescing_key text,
  payload_version integer not null default 1 check (payload_version > 0),
  payload jsonb not null default '{}' check (radar.object_ok(payload)),
  collection_run_id uuid references radar.collection_runs(id), telegram_bot_id text, telegram_update_id bigint,
  status text not null default 'queued' check (status in ('queued','leased','succeeded','failed','canceled')),
  available_at timestamptz not null default now(), expires_at timestamptz,
  attempts integer not null default 0, max_attempts integer not null default 3 check (max_attempts between 1 and 3),
  lease_owner uuid, lease_generation bigint not null default 0 check (lease_generation >= 0), lease_until timestamptz,
  created_at timestamptz not null default now(), finished_at timestamptz, last_error_code text,
  foreign key(telegram_bot_id,telegram_update_id) references radar.telegram_updates(bot_id,update_id),
  check ((telegram_bot_id is null) = (telegram_update_id is null)),
  check (kind <> 'collect_page' or collection_run_id is not null),
  check (kind <> 'telegram_command' or telegram_bot_id is not null),
  check (attempts between 0 and max_attempts and lease_generation >= attempts),
  check ((status = 'leased' and lease_owner is not null and lease_until is not null and attempts > 0)
    or (status <> 'leased' and lease_owner is null and lease_until is null)),
  check ((status in ('succeeded','failed','canceled')) = (finished_at is not null))
);
create unique index tasks_active_coalesce_uidx on radar.job_tasks(coalescing_key) where coalescing_key is not null and status in ('queued','leased');
create unique index tasks_command_update_uidx on radar.job_tasks(telegram_bot_id,telegram_update_id) where kind = 'telegram_command';
create index tasks_ready_idx on radar.job_tasks(available_at,id) where status = 'queued';
create index tasks_lease_idx on radar.job_tasks(lease_until) where status = 'leased';
create index tasks_run_idx on radar.job_tasks(collection_run_id);
create index tasks_update_idx on radar.job_tasks(telegram_bot_id,telegram_update_id);

create function radar.parts_ok(p_parts jsonb, p_states jsonb)
returns boolean language sql immutable security invoker set search_path = '' as $$
  select case when jsonb_typeof(p_parts) <> 'array' or jsonb_typeof(p_states) <> 'array' then false else
    jsonb_array_length(p_parts) = jsonb_array_length(p_states) and jsonb_array_length(p_parts) <= 10
    and not exists (select 1 from jsonb_array_elements(p_parts) x(value) where jsonb_typeof(value) <> 'object')
    and octet_length(p_parts::text) <= 65536 and not exists (
      select 1 from jsonb_array_elements_text(p_states) s(value)
      where value is null or value not in ('prepared','sending','sent','retryable_failure','failed','uncertain','canceled')
    ) end
$$;

create table radar.notifications (
  id uuid primary key default gen_random_uuid(), profile_id uuid not null references radar.research_profiles(id),
  delivery_target_id uuid not null,
  kind text not null check (kind in ('digest','reminder','command_reply')),
  schedule_key text not null check (length(schedule_key) between 1 and 512),
  local_date date, timezone_snapshot text, due_at timestamptz not null, expires_at timestamptz not null,
  status text not null default 'prepared' check (status in ('prepared','sending','sent','partial','uncertain','failed','skipped_empty','skipped_late','canceled')),
  payload_version integer not null default 1 check (payload_version > 0),
  parts jsonb not null, part_states jsonb not null,
  created_at timestamptz not null default now(), sent_at timestamptz, error_code text,
  unique(profile_id,kind,schedule_key), unique(id,profile_id),
  foreign key(delivery_target_id,profile_id) references radar.delivery_targets(id,profile_id),
  check (radar.parts_ok(parts,part_states)), check (expires_at > due_at),
  check (kind <> 'digest' or (local_date is not null and timezone_snapshot is not null and schedule_key = 'digest:' || local_date::text)),
  check (status not in ('skipped_empty','skipped_late') or jsonb_array_length(parts) = 0),
  check (status <> 'sent' or (jsonb_array_length(parts) > 0 and sent_at is not null
    and not jsonb_path_exists(part_states,'$[*] ? (@ != "sent")'))),
  check ((status = 'sent') = (sent_at is not null))
);
create index notifications_due_idx on radar.notifications(due_at,id) where status in ('prepared','sending','partial','uncertain');
create index notifications_history_idx on radar.notifications(profile_id,created_at desc);
create index notifications_target_idx on radar.notifications(delivery_target_id,profile_id);

create table radar.notification_items (
  id uuid primary key default gen_random_uuid(), notification_id uuid not null, profile_id uuid not null,
  opportunity_id uuid not null references radar.opportunities(id), part_index integer not null check (part_index between 0 and 9),
  purpose text not null check (purpose in ('digest_first_seen','deadline_reminder','command_view')),
  deadline_id uuid, deadline_revision integer, reminder_offset_days integer,
  claim_active boolean not null default true,
  snapshot jsonb not null default '{}' check (radar.object_ok(snapshot)), created_at timestamptz not null default now(),
  foreign key(notification_id,profile_id) references radar.notifications(id,profile_id),
  foreign key(deadline_id,opportunity_id) references radar.opportunity_deadlines(id,opportunity_id),
  check ((purpose = 'deadline_reminder' and deadline_id is not null and deadline_revision is not null
    and reminder_offset_days is not null and deadline_revision > 0 and reminder_offset_days between 0 and 365)
    or (purpose <> 'deadline_reminder' and deadline_id is null and deadline_revision is null and reminder_offset_days is null)),
  check (purpose <> 'command_view' or not claim_active)
);
create unique index items_digest_claim_uidx on radar.notification_items(profile_id,opportunity_id) where purpose = 'digest_first_seen' and claim_active;
create unique index items_reminder_claim_uidx on radar.notification_items(profile_id,deadline_id,deadline_revision,reminder_offset_days) where purpose = 'deadline_reminder' and claim_active;
create unique index items_membership_uidx on radar.notification_items(notification_id,opportunity_id,purpose) where deadline_id is null;
create unique index items_deadline_membership_uidx on radar.notification_items(notification_id,opportunity_id,deadline_id,deadline_revision,reminder_offset_days) where deadline_id is not null;
create index items_notification_idx on radar.notification_items(notification_id,profile_id);
create index items_opportunity_idx on radar.notification_items(opportunity_id);
create index items_deadline_idx on radar.notification_items(deadline_id,opportunity_id);

create table radar.notification_attempts (
  id uuid primary key default gen_random_uuid(), notification_id uuid not null references radar.notifications(id),
  part_index integer not null check (part_index between 0 and 9), attempt_number integer not null check (attempt_number between 1 and 3),
  task_id uuid not null references radar.job_tasks(id), lease_generation bigint not null check (lease_generation > 0),
  state text not null check (state in ('sending','sent','retryable_failure','permanent_failure','uncertain','resolved_delivered','resolved_abandoned')),
  started_at timestamptz not null default now(), finished_at timestamptz,
  telegram_message_id text, error_class text, retry_after_seconds integer check (retry_after_seconds between 0 and 86400),
  resolution jsonb check (resolution is null or radar.object_ok(resolution)),
  unique(notification_id,part_index,attempt_number),
  check ((state = 'sending') = (finished_at is null)),
  check (state <> 'sent' or nullif(btrim(telegram_message_id),'') is not null),
  check (state not in ('resolved_delivered','resolved_abandoned') or resolution is not null)
);
create unique index attempts_unresolved_uidx on radar.notification_attempts(notification_id,part_index) where state in ('sending','uncertain');
create index attempts_task_idx on radar.notification_attempts(task_id);

create table radar.system_settings (
  key text primary key check (key in ('delivery_paused','collection_paused','maintenance_cursor','installed_versions')),
  schema_version integer not null default 1 check (schema_version > 0),
  value jsonb not null check (radar.object_ok(value)),
  updated_at timestamptz not null default now(), updated_by text not null,
  check (key not in ('delivery_paused','collection_paused') or coalesce(jsonb_typeof(value->'enabled') = 'boolean',false))
);
insert into radar.system_settings(key,value,updated_by) values
  ('delivery_paused','{"enabled":true}','migration'),
  ('collection_paused','{"enabled":true}','migration'),
  ('installed_versions','{"database":1}','migration');
