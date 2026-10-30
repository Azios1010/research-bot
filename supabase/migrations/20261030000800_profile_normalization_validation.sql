-- Forward validation parity: canonical whitespace, normalized emptiness, raw UTF16 bounds.
create or replace function radar.profile_text_valid(p text)
returns boolean language sql immutable security invoker set search_path='' as $$
 with normalized(x) as (select btrim(regexp_replace(lower(normalize(p,NFKC)),'[[:space:]]+',' ','g')))
 select coalesce((select sum(case when ascii(c)>65535 then 2 else 1 end)<=160 from regexp_split_to_table(p,'') c),false)
   and (select length(x)>0 and coalesce((select sum(case when ascii(c)>65535 then 2 else 1 end)<=160 from regexp_split_to_table(x,'') c),false) from normalized)
   and p !~ '[[:cntrl:]]'
$$;
create or replace function radar.profile_rules_valid(p jsonb)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare k text; v jsonb; t jsonb; a jsonb; n numeric; codes text[];
begin
  if not coalesce(radar.object_ok(p,16384),false) or p-array['enabled_types','positive_topics','blocked_topics','ignored_topics','blocked_institutions','preferred_institutions','preferred_countries','excluded_countries','hard_countries','preferred_work_modes','compatible_qualifications','incompatible_qualifications','eligibility_facts','unknown_policy','type_weights','reminder_offsets','digest_threshold']<>'{}'::jsonb then return false; end if;
  codes := array['phd','postdoc','research_assistant','research_internship','conference','workshop','conference_cfp','journal_cfp','journal_special_issue','grant','research_funding'];
  for k,v in select key,value from jsonb_each(p) loop
    if k in ('blocked_topics','ignored_topics','blocked_institutions','preferred_institutions','preferred_countries','excluded_countries','preferred_work_modes','compatible_qualifications','incompatible_qualifications','enabled_types') then
      if jsonb_typeof(v)<>'array' or jsonb_array_length(v)>(case when k='enabled_types' then 11 else 20 end) then return false; end if;
      for t in select value from jsonb_array_elements(v) loop
        if jsonb_typeof(t)<>'string' or length(btrim(t#>>'{}')) not between 1 and 160 then return false; end if;
        if k='enabled_types' and not (t#>>'{}'=any(codes)) then return false; end if;
        if k='preferred_work_modes' and not (t#>>'{}'=any(array['remote','hybrid','onsite'])) then return false; end if;
        if k in ('preferred_countries','excluded_countries') and not radar.profile_country(t#>>'{}') then return false; end if;
      end loop;
    elsif k='positive_topics' then
      if jsonb_typeof(v)<>'array' or jsonb_array_length(v)>20 then return false; end if;
      for t in select value from jsonb_array_elements(v) loop
        if jsonb_typeof(t)='string' then
          if length(btrim(t#>>'{}')) not between 1 and 160 then return false; end if;
        elsif jsonb_typeof(t)='object' then
          if t-array['phrase','weight','aliases']<>'{}'::jsonb or jsonb_typeof(t->'phrase') is distinct from 'string' or length(btrim(t->>'phrase')) not between 1 and 160 or jsonb_typeof(t->'weight') is distinct from 'number' then return false; end if;
          n := (t->>'weight')::numeric; if n<=0 or n>100 then return false; end if;
          a := coalesce(t->'aliases','[]');
          if jsonb_typeof(a)<>'array' or jsonb_array_length(a)>10 or exists(select 1 from jsonb_array_elements(a) x where jsonb_typeof(x)<>'string' or length(btrim(x#>>'{}')) not between 1 and 160) then return false; end if;
        else return false; end if;
      end loop;
      if (select count(*)<>count(distinct btrim(regexp_replace(lower(normalize(case when jsonb_typeof(x)='string' then x#>>'{}' else x->>'phrase' end,NFKC)),'[[:space:]]+',' ','g'))) from jsonb_array_elements(v) x) then return false; end if;
    elsif k='type_weights' then
      if jsonb_typeof(v)<>'object' then return false; end if;
      for k,t in select key,value from jsonb_each(v) loop
        if not k=any(codes) or jsonb_typeof(t)<>'number' or (t#>>'{}')::numeric not between 0 and 1 then return false; end if;
      end loop;
    elsif k='hard_countries' then if jsonb_typeof(v)<>'boolean' then return false; end if;
    elsif k='unknown_policy' then if jsonb_typeof(v)<>'string' or v#>>'{}' not in ('allow','exclude') then return false; end if;
    elsif k='digest_threshold' then if jsonb_typeof(v)<>'number' or (v#>>'{}')::numeric not between 0 and 100 then return false; end if;
    elsif k='reminder_offsets' then
      if jsonb_typeof(v)<>'array' or jsonb_array_length(v)>12 or exists(select 1 from jsonb_array_elements(v) x where jsonb_typeof(x)<>'number' or x::text !~ '^[0-9]{1,3}$' or (x::text)::numeric>365) then return false; end if;
    elsif k='eligibility_facts' then
      if jsonb_typeof(v)<>'object' or v-array['student_full_time','nationalities']<>'{}'::jsonb then return false; end if;
      if v ? 'student_full_time' and jsonb_typeof(v->'student_full_time') not in ('boolean','null') then return false; end if;
      if v ? 'nationalities' then
        a:=v->'nationalities'; if jsonb_typeof(a)<>'array' or jsonb_array_length(a)>20 or exists(select 1 from jsonb_array_elements(a) x where jsonb_typeof(x)<>'string' or not radar.profile_country(x#>>'{}')) then return false; end if;
      end if;
    end if;
  end loop;
  if exists(select 1 from jsonb_path_query(p,'$.** ? (@.type() == "string")') x where not radar.profile_text_valid(x#>>'{}')) then return false; end if;
  return true;
exception when invalid_text_representation or numeric_value_out_of_range then return false;
end $$;


