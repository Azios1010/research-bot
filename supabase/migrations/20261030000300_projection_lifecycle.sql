-- Forward-only display clarification: retain explicit source state and relevant rounds.
-- No canonical facts, source ingestion, scoring, signature or privileges change.

create or replace function radar.ui_item(p_id uuid,p_profile uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('id',o.id,'type',o.type_code,'title',o.title,'organization',o.organization,
    'location',o.location_text,'status',case
      when o.attributes->'funding'->>'source_status' in ('forecasted','forecast') then 'forecast'
      when o.attributes->'funding'->>'source_status' in ('closed','archived') then 'closed'
      when o.attributes->'journal_call'->>'source_status'='upcoming' then 'upcoming'
      else o.status end,'url',coalesce(o.canonical_url,(select source_url::text from radar.source_records where opportunity_id=o.id and record_status='accepted' order by last_seen_at desc,id limit 1)),
    'eventStart',o.event_start,'eventEnd',o.event_end,'description',left(o.description,1800),
    'saved',coalesce(s.saved,false),'ignored',coalesce(s.ignored,false),
    'score',case when a.eligible and a.opportunity_revision=o.content_revision and a.profile_revision=p.revision and a.valid_until>statement_timestamp() then a.score else null end,
    'reasons',case when a.eligible and a.opportunity_revision=o.content_revision and a.profile_revision=p.revision and a.valid_until>statement_timestamp() then to_jsonb(a.reason_codes) else '[]'::jsonb end,
    'deadlines',coalesce((select jsonb_agg(jsonb_build_object('label',label,'precision',precision,'status',status,'dueAt',due_at,'dueDate',due_date,'timezone',timezone) order by case when status='current' and kind in ('application','abstract','submission','registration') and coalesce(due_at,(due_date+1)::timestamp at time zone 'Etc/GMT+12')>statement_timestamp() then 0 when precision='unknown' or status='conflicted' then 1 else 2 end,due_at nulls last,due_date nulls last,id) from
      (select * from radar.opportunity_deadlines where opportunity_id=o.id and status<>'superseded' order by case when status='current' and kind in ('application','abstract','submission','registration') and coalesce(due_at,(due_date+1)::timestamp at time zone 'Etc/GMT+12')>statement_timestamp() then 0 when precision='unknown' or status='conflicted' then 1 else 2 end,due_at nulls last,due_date nulls last,id limit 8) d),'[]'),
    'notes',to_jsonb(array_remove(array[
      case when o.type_code in ('conference','workshop')
        and exists(select 1 from radar.opportunity_deadlines where opportunity_id=o.id and kind in ('application','abstract','submission') and status<>'superseded')
        and not exists(select 1 from radar.opportunity_deadlines where opportunity_id=o.id and kind in ('application','abstract','submission') and status<>'superseded'
          and (status='conflicted' or precision='unknown' or coalesce(due_at,(due_date+1)::timestamp at time zone 'Etc/GMT+12')>statement_timestamp()))
        then 'Known submission rounds have elapsed; event lifecycle is separate.' end,
      case when o.attributes->'funding'->>'source_status'='forecasted' or o.attributes->'funding'->>'source_status'='forecast' then 'Forecast; not yet accepting applications.' end,
      case when o.attributes->'journal_call'->>'source_status'='upcoming' then 'Upcoming call; submission window has not opened.' end,
      case when o.attributes->'journal_call'->>'abstract_required'='true' then 'Manuscript submission requires the earlier abstract stage.' end,
      case when o.type_code in ('phd','postdoc','research_assistant','research_internship','grant','research_funding') then 'Eligibility is source-specific; confirm qualifications and applicant restrictions at the official link.' end,
      case when cardinality(o.quality_flags)>0 then 'Some source facts are incomplete or uncertain; confirm at the official link.' end,
      case when (select count(*) from radar.opportunity_deadlines where opportunity_id=o.id and status<>'superseded')>8 then 'Additional rounds are available at the official link.' end
    ],null)))
  from radar.opportunities o join radar.research_profiles p on p.id=p_profile
    left join radar.user_opportunity_state s on s.profile_id=p.id and s.opportunity_id=o.id
    left join radar.opportunity_assessments a on a.profile_id=p.id and a.opportunity_id=o.id
    where o.id=p_id and o.status<>'merged'
$$;

