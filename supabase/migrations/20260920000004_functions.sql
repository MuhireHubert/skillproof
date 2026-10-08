-- Privileged workflows (security definer, each checks the caller itself) and analytics.
-- Analytics about people (outcomes, feedback) require the student's consent and a minimum group size.

-- ==================================================== shared review engine
-- Internal: applies a review decision to an evidence row. Not callable by API roles.
create or replace function public._apply_review(
  p_evidence uuid, p_status text, p_note text, p_ratings jsonb, p_pro jsonb, p_overall int,
  p_by_name text, p_by_role text, p_org_name text, p_assurance text
) returns void language plpgsql security definer set search_path = public as $$
declare c record; v int; k text; val jsonb; note text := btrim(coalesce(p_note, ''));
begin
  if p_status not in ('verified', 'revision', 'declined') then
    raise exception 'Invalid decision' using errcode = '22023';
  end if;
  if p_status <> 'verified' and note = '' then
    raise exception 'Add a note so the student knows what happens next' using errcode = '22023';
  end if;
  if p_status = 'verified' then
    if not exists (select 1 from public.evidence_competencies where evidence_id = p_evidence) then
      raise exception 'This evidence has no competencies tagged' using errcode = '22023';
    end if;
    for c in select competency_id from public.evidence_competencies where evidence_id = p_evidence loop
      v := coalesce(p_overall, case when (p_ratings ->> c.competency_id) ~ '^[1-4]$' then (p_ratings ->> c.competency_id)::int end);
      if v is null or v not between 1 and 4 then
        raise exception 'Rate every competency before verifying' using errcode = '22023';
      end if;
      update public.evidence_competencies set rating = v where evidence_id = p_evidence and competency_id = c.competency_id;
    end loop;
    for k, val in select * from jsonb_each(coalesce(p_pro, '{}')) loop
      if (val #>> '{}') ~ '^[1-4]$' and exists (select 1 from public.competencies where id = k and category = 'professional') then
        insert into public.evidence_competencies (evidence_id, competency_id, rating)
        values (p_evidence, k, (val #>> '{}')::int)
        on conflict (evidence_id, competency_id) do update set rating = excluded.rating;
      end if;
    end loop;
  end if;
  update public.evidence set
    status = p_status,
    verifier_note = note,
    verified_at = case when p_status = 'verified' then now() end,
    verified_by_name = coalesce(p_by_name, ''),
    verified_by_role = coalesce(p_by_role, ''),
    verified_by_org_name = coalesce(p_org_name, ''),
    assurance = case when p_status = 'verified' then p_assurance end
  where id = p_evidence;
end $$;

-- ================================================ employer reviews evidence
create or replace function public.review_evidence(
  p_evidence uuid, p_status text, p_note text default '', p_ratings jsonb default '{}', p_pro jsonb default '{}'
) returns void language plpgsql security definer set search_path = public as $$
declare org uuid := public.approved_org('employer'); e public.evidence; me public.profiles; org_name text;
begin
  if org is null then raise exception 'Only approved employer accounts can review evidence' using errcode = '42501'; end if;
  select * into e from public.evidence where id = p_evidence and verifier_org_id = org for update;
  if not found then raise exception 'Evidence not found' using errcode = 'P0002'; end if;
  if e.status <> 'submitted' then raise exception 'This evidence is not awaiting review' using errcode = '22023'; end if;
  select * into me from public.profiles where id = auth.uid();
  select name into org_name from public.organizations where id = org;
  perform public._apply_review(e.id, p_status, p_note, p_ratings, p_pro, null, me.full_name, '', org_name, 'org_verified');
end $$;

-- ================================= student asks an outside supervisor to verify
create or replace function public.request_external_verification(p_evidence uuid, p_name text, p_role text default '', p_contact text default '')
returns table (token text, short_code text, expires_at timestamptz)
language plpgsql security definer set search_path = public, extensions as $$
declare e public.evidence; t text; code text; contact text; tries int := 0; exp timestamptz := now() + interval '14 days';
        base text := coalesce(public.setting('public_app_url'), ''); ussd text := coalesce(public.setting('ussd_code'), '');
begin
  select * into e from public.evidence where id = p_evidence and student_id = auth.uid() for update;
  if not found then raise exception 'Evidence not found' using errcode = 'P0002'; end if;
  if e.verifier_org_id is not null then
    raise exception 'This work is reviewed by the employer who set it' using errcode = '22023';
  end if;
  if e.status not in ('draft', 'submitted') then
    raise exception 'This evidence can no longer be sent for verification' using errcode = '22023';
  end if;
  if not exists (select 1 from public.evidence_competencies where evidence_id = e.id) then
    raise exception 'Tag at least one competency first' using errcode = '22023';
  end if;
  if btrim(coalesce(p_name, '')) = '' then raise exception 'Enter the supervisor''s name' using errcode = '22023'; end if;
  if (select count(*) from public.verification_requests v
      where v.evidence_id = e.id and v.used_at is null and v.expires_at > now()) >= 3 then
    raise exception 'There are already three open requests for this evidence' using errcode = '22023';
  end if;
  contact := public.normalize_contact(coalesce(p_contact, ''));
  t := translate(encode(gen_random_bytes(24), 'base64'), '+/=', '-_');
  loop
    code := lpad((('x' || encode(gen_random_bytes(4), 'hex'))::bit(32)::bigint % 1000000)::text, 6, '0');
    exit when not exists (select 1 from public.verification_requests v where v.short_code = code and v.used_at is null);
    tries := tries + 1;
    if tries > 20 then raise exception 'Please try again' using errcode = '55000'; end if;
  end loop;
  insert into public.verification_requests (evidence_id, token, short_code, verifier_name, verifier_role, verifier_contact, expires_at, created_by)
  values (e.id, t, code, btrim(p_name), btrim(coalesce(p_role, '')), contact, exp, auth.uid());
  update public.evidence set status = 'submitted' where id = e.id and status = 'draft';
  if contact <> '' then
    insert into public.outbox (channel, recipient, subject, body)
    values (case when contact like '%@%' then 'email' else 'sms' end, contact,
            'Please verify ' || e.student_name || '''s work',
            e.student_name || ' asks you to verify their work "' || e.title || '". Open ' || base || '/v/' || t ||
            case when ussd <> '' then ' or dial ' || ussd || ' and enter code ' || code else '' end || '. It expires in 14 days.');
  end if;
  return query select t, code, exp;
end $$;

-- Service role only: completes a verification from a link (token) or USSD (short code + caller phone).
create or replace function public.complete_external_verification(
  p_token text, p_code text, p_phone text, p_name text, p_role text, p_decision text,
  p_ratings jsonb, p_overall int, p_note text, p_method text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare vr public.verification_requests; e public.evidence;
begin
  if p_token is not null then
    select * into vr from public.verification_requests where token = p_token for update;
  else
    select * into vr from public.verification_requests where short_code = p_code and used_at is null for update;
  end if;
  if not found or vr.used_at is not null or vr.expires_at <= now() then
    raise exception 'This verification link or code is invalid or has expired' using errcode = 'SP001';
  end if;
  select * into e from public.evidence where id = vr.evidence_id for update;
  if e.status <> 'submitted' then
    raise exception 'This work is no longer awaiting verification' using errcode = 'SP001';
  end if;
  if p_method = 'ussd' then
    if vr.verifier_contact = '' or vr.verifier_contact like '%@%' then
      raise exception 'This code cannot be used by phone' using errcode = 'SP003';
    end if;
    if vr.verifier_contact <> public.normalize_contact(p_phone) then
      raise exception 'This code is registered to a different phone number' using errcode = 'SP003';
    end if;
  end if;
  begin
    perform public._apply_review(e.id, p_decision, p_note, coalesce(p_ratings, '{}'), '{}', p_overall,
      coalesce(nullif(btrim(p_name), ''), vr.verifier_name), coalesce(nullif(btrim(p_role), ''), vr.verifier_role),
      '', case when p_method = 'ussd' then 'ussd_attested' else 'external_attested' end);
  exception when sqlstate '22023' then
    raise exception '%', sqlerrm using errcode = 'SP002';
  end;
  update public.verification_requests set used_at = now() where id = vr.id;
  if p_decision = 'verified' then
    update public.verification_requests set used_at = now() where evidence_id = e.id and used_at is null;
  end if;
  insert into public.evidence_events (evidence_id, actor, action, meta)
  values (e.id, null, 'external:' || p_decision, jsonb_build_object('method', p_method, 'verifier', vr.verifier_name));
  return jsonb_build_object('status', p_decision);
end $$;

-- =============================================== internships: complete + hire
create or replace function public.complete_internship(
  p_application uuid, p_ratings jsonb, p_pro jsonb default '{}', p_note text default '', p_hours numeric default 0
) returns uuid language plpgsql security definer set search_path = public as $$
declare org uuid := public.approved_org('employer'); a record; ev uuid; me public.profiles; org_name text;
begin
  if org is null then raise exception 'Only approved employer accounts can complete placements' using errcode = '42501'; end if;
  select ap.id, ap.student_id, ap.status, i.id as internship_id, i.title, i.employer_org_id
    into a from public.internship_applications ap join public.internships i on i.id = ap.internship_id
    where ap.id = p_application and i.employer_org_id = org for update of ap;
  if not found then raise exception 'Application not found' using errcode = 'P0002'; end if;
  if a.status <> 'accepted' then raise exception 'Only accepted placements can be completed' using errcode = '22023'; end if;
  insert into public.evidence (student_id, internship_application_id, title, description, evidence_type, hours, status)
  values (a.student_id, a.id, 'Internship: ' || a.title, btrim(coalesce(p_note, '')), 'Internship placement', coalesce(p_hours, 0), 'submitted')
  returning id into ev;
  insert into public.evidence_competencies (evidence_id, competency_id)
  select ev, ic.competency_id from public.internship_competencies ic where ic.internship_id = a.internship_id;
  select * into me from public.profiles where id = auth.uid();
  select name into org_name from public.organizations where id = org;
  perform public._apply_review(ev, 'verified', 'Internship completed', p_ratings, p_pro, null, me.full_name, '', org_name, 'org_verified');
  update public.internship_applications set status = 'completed' where id = a.id;
  return ev;
end $$;

create or replace function public.hire_student(p_student uuid, p_job_title text, p_started_on date default null, p_sector text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare org uuid := public.approved_org('employer'); pl public.talent_pipeline; o public.organizations; emp uuid;
begin
  if org is null then raise exception 'Only approved employer accounts can record hires' using errcode = '42501'; end if;
  if btrim(coalesce(p_job_title, '')) = '' then raise exception 'Enter the job title' using errcode = '22023'; end if;
  select * into pl from public.talent_pipeline where employer_org_id = org and student_id = p_student for update;
  if not found or pl.stage not in ('interviewing', 'offered') then
    raise exception 'Move the candidate to interviewing or offered before recording a hire' using errcode = '22023';
  end if;
  select * into o from public.organizations where id = org;
  update public.talent_pipeline set stage = 'hired' where id = pl.id;
  insert into public.employments (student_id, employer_org_id, employer_name, job_title, sector_id, started_on, source, employer_confirmed)
  values (p_student, org, o.name, btrim(p_job_title), coalesce(p_sector, o.sector_ids[1]), coalesce(p_started_on, current_date), 'pipeline', true)
  returning id into emp;
  insert into public.outcomes (student_id, status) values (p_student, 'employed')
  on conflict (student_id) do update set status = 'employed', updated_at = now();
  return emp;
end $$;

-- ============================================================ talent discovery
create or replace function public.discover_talent(p_sector text, p_competencies text[] default '{}', p_min_level int default 1)
returns table (student_id uuid, full_name text, headline text, slug text, matched int, evidence_count int, best jsonb, in_pipeline boolean)
language plpgsql stable security definer set search_path = public as $$
declare org uuid := public.approved_org('employer');
begin
  if org is null then raise exception 'Only approved employer accounts can search for talent' using errcode = '42501'; end if;
  return query
  with rec as (
    select e.student_id as sid, ec.competency_id as cid, ec.rating as lvl, 1 as is_ev
    from public.evidence e join public.evidence_competencies ec on ec.evidence_id = e.id
    where e.status = 'verified' and ec.rating is not null
    union all
    select r.student_id, l.competency_id, l.level, 0
    from public.assessment_results r join public.assessment_result_levels l on l.result_id = r.id
  ), best as (
    select rec.sid, rec.cid, max(rec.lvl) as lvl, sum(rec.is_ev)::int as evn
    from rec join public.competencies c on c.id = rec.cid
    where c.sector_id = p_sector
    group by rec.sid, rec.cid
  ), scored as (
    select b.sid,
           count(*) filter (where b.lvl >= greatest(p_min_level, 1)
                            and (cardinality(p_competencies) = 0 or b.cid = any (p_competencies)))::int as matched,
           sum(b.evn)::int as evn,
           jsonb_object_agg(b.cid, b.lvl) as best
    from best b group by b.sid
  )
  select p.id, p.full_name, p.headline, p.slug, s.matched, s.evn, s.best,
         exists (select 1 from public.talent_pipeline t where t.employer_org_id = org and t.student_id = p.id)
  from scored s join public.profiles p on p.id = s.sid
  where p.role = 'student' and p.discoverable and s.matched > 0
  order by s.matched desc, s.evn desc, p.full_name
  limit 50;
end $$;

-- ================================================================ assessments
create or replace function public.record_assessment_result(p_assessment uuid, p_student uuid, p_levels jsonb, p_note text default '', p_evidence uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare org uuid := public.my_approved_org(); a public.assessments; o public.organizations; me public.profiles;
        rid uuid; k text; val jsonb; n int := 0;
begin
  if org is null then raise exception 'Only approved organisations can record assessments' using errcode = '42501'; end if;
  select * into a from public.assessments where id = p_assessment and owner_org_id = org;
  if not found then raise exception 'Assessment not found' using errcode = 'P0002'; end if;
  select * into o from public.organizations where id = org;
  if o.type = 'institution' then
    if not exists (select 1 from public.enrollments en where en.student_id = p_student and en.institution_org_id = org
                   and en.status in ('confirmed', 'graduated')) then
      raise exception 'That student is not enrolled with your institution' using errcode = '22023';
    end if;
  elsif o.type = 'employer' then
    if not public.employer_can_reach_student(org, p_student) then
      raise exception 'That student is not eligible for this assessment' using errcode = '22023';
    end if;
  else
    raise exception 'Regulators cannot record assessments' using errcode = '42501';
  end if;
  if p_evidence is not null and not exists (select 1 from public.evidence where id = p_evidence and student_id = p_student) then
    raise exception 'That evidence does not belong to the student' using errcode = '22023';
  end if;
  select * into me from public.profiles where id = auth.uid();
  insert into public.assessment_results (assessment_id, assessment_title, student_id, student_name, assessor_id, assessor_name, owner_org_name, note, evidence_id)
  values (a.id, a.title, p_student, (select full_name from public.profiles where id = p_student), me.id, me.full_name, o.name, btrim(coalesce(p_note, '')), p_evidence)
  on conflict (assessment_id, student_id) do update
    set assessor_id = excluded.assessor_id, assessor_name = excluded.assessor_name, note = excluded.note,
        assessed_at = now(), evidence_id = coalesce(excluded.evidence_id, public.assessment_results.evidence_id)
  returning id into rid;
  delete from public.assessment_result_levels where result_id = rid;
  for k, val in select * from jsonb_each(coalesce(p_levels, '{}')) loop
    if not exists (select 1 from public.assessment_competencies where assessment_id = a.id and competency_id = k) then
      raise exception 'Competency % is not part of this assessment', k using errcode = '22023';
    end if;
    if (val #>> '{}') !~ '^[1-4]$' then raise exception 'Levels must be between 1 and 4' using errcode = '22023'; end if;
    insert into public.assessment_result_levels (result_id, competency_id, level) values (rid, k, (val #>> '{}')::int);
    n := n + 1;
  end loop;
  if n = 0 then raise exception 'Record at least one competency level' using errcode = '22023'; end if;
  return rid;
end $$;

-- ================================================================== feedback
-- p_levels: {"<competency_id>": {"observed": 1-4, "expected": 1-4}}
create or replace function public.submit_feedback(
  p_student uuid, p_employment uuid, p_application uuid, p_preparedness text,
  p_would_hire_again boolean, p_comment text default '', p_levels jsonb default '{}'
) returns uuid language plpgsql security definer set search_path = public as $$
declare org uuid := public.approved_org('employer'); fid uuid; k text; val jsonb; ok boolean := false;
begin
  if org is null then raise exception 'Only approved employer accounts can give feedback' using errcode = '42501'; end if;
  if p_employment is not null and exists (select 1 from public.employments where id = p_employment and student_id = p_student and employer_org_id = org) then ok := true; end if;
  if not ok and p_application is not null and exists (
       select 1 from public.internship_applications a join public.internships i on i.id = a.internship_id
       where a.id = p_application and a.student_id = p_student and i.employer_org_id = org and a.status in ('accepted', 'completed')) then ok := true; end if;
  if not ok then raise exception 'You can only give feedback on someone you employed or hosted' using errcode = '42501'; end if;
  insert into public.employer_feedback (employer_org_id, student_id, student_name, employment_id, internship_application_id, preparedness, would_hire_again, comment)
  values (org, p_student, (select full_name from public.profiles where id = p_student), p_employment, p_application,
          p_preparedness, p_would_hire_again, btrim(coalesce(p_comment, '')))
  returning id into fid;
  for k, val in select * from jsonb_each(coalesce(p_levels, '{}')) loop
    if (val ->> 'observed') ~ '^[1-4]$' and exists (select 1 from public.competencies where id = k) then
      insert into public.feedback_competencies (feedback_id, competency_id, observed_level, expected_level)
      values (fid, k, (val ->> 'observed')::int, case when (val ->> 'expected') ~ '^[1-4]$' then (val ->> 'expected')::int end);
    end if;
  end loop;
  return fid;
end $$;

-- ================================================ analytics: demand and gaps
create or replace function public.competency_demand(p_sector text)
returns table (competency_id text, name text, score int, essential int, standards int, avg_level numeric, employers int, projects int, internships int)
language sql stable as $$
  with s as (
    select sc.competency_id as cid, sum(sc.importance)::int as score, count(*) filter (where sc.importance = 3)::int as essential,
           count(*)::int as n, round(avg(sc.level), 1) as avg_level, count(distinct st.employer_org_id)::int as employers
    from public.standard_competencies sc join public.standards st on st.id = sc.standard_id
    where st.sector_id = p_sector and st.status = 'published' group by sc.competency_id
  ), p as (
    select pc.competency_id as cid, count(*)::int as n
    from public.project_competencies pc join public.projects pr on pr.id = pc.project_id
    where pr.sector_id = p_sector group by pc.competency_id
  ), i as (
    select ic.competency_id as cid, count(*)::int as n
    from public.internship_competencies ic join public.internships it on it.id = ic.internship_id
    where it.sector_id = p_sector group by ic.competency_id
  )
  select c.id, c.name, coalesce(s.score, 0) + coalesce(p.n, 0) + coalesce(i.n, 0),
         coalesce(s.essential, 0), coalesce(s.n, 0), s.avg_level, coalesce(s.employers, 0), coalesce(p.n, 0), coalesce(i.n, 0)
  from public.competencies c
  left join s on s.cid = c.id left join p on p.cid = c.id left join i on i.cid = c.id
  where c.sector_id = p_sector and (s.cid is not null or p.cid is not null or i.cid is not null)
  order by 3 desc, c.name;
$$;

create or replace function public.competency_gap(p_sector text)
returns table (competency_id text, name text, score int, avg_level numeric, coverage int, courses int, status text)
language plpgsql stable as $$
declare org uuid := public.approved_org('institution');
begin
  if org is null then raise exception 'Only approved institutions can view the gap analysis' using errcode = '42501'; end if;
  return query
  with cov as (
    select cc.competency_id as cid, max(cc.coverage_level)::int as coverage, count(distinct cc.course_id)::int as courses
    from public.course_competencies cc
    join public.courses co on co.id = cc.course_id
    join public.programmes pr on pr.id = co.programme_id
    where pr.institution_org_id = org group by cc.competency_id
  )
  select d.competency_id, d.name, d.score, d.avg_level, cov.coverage, coalesce(cov.courses, 0),
         case when cov.coverage is null then 'gap'
              when cov.coverage < round(coalesce(d.avg_level, 3)) then 'partial'
              else 'covered' end
  from public.competency_demand(p_sector) d left join cov on cov.cid = d.competency_id
  order by case when cov.coverage is null then 0 when cov.coverage < round(coalesce(d.avg_level, 3)) then 1 else 2 end, d.score desc;
end $$;

-- ====================================== analytics about graduates (consented, k-anonymous)
create or replace function public.outcome_summary(p_programme uuid default null)
returns table (programme_id uuid, programme_name text, graduates int, respondents int, employed int, further_study int,
               seeking int, directly int, partly int, unrelated int, avg_days_to_work numeric, suppressed boolean)
language plpgsql stable security definer set search_path = public as $$
declare org uuid := public.approved_org('institution'); k int := coalesce(public.setting('outcomes_min_group')::int, 5);
begin
  if org is null then raise exception 'Only approved institutions can view outcomes' using errcode = '42501'; end if;
  return query
  with grads as (
    select en.programme_id as pid, en.student_id as sid, en.graduated_on as gon
    from public.enrollments en
    where en.institution_org_id = org and en.status = 'graduated' and (p_programme is null or en.programme_id = p_programme)
  ), cons as (
    select g.pid, g.sid, o.status as ostatus, fe.related, (fe.started_on - g.gon) as days
    from grads g
    join public.outcomes o on o.student_id = g.sid and o.share_with_institution
    left join lateral (
      select em.related_to_field as related, em.started_on
      from public.employments em where em.student_id = g.sid
      order by em.started_on nulls last, em.created_at limit 1
    ) fe on true
  ), agg as (
    select pr.id as pid, pr.name as pname,
      (select count(*) from grads g where g.pid = pr.id)::int as graduates,
      count(c.sid)::int as respondents,
      (count(*) filter (where c.ostatus in ('employed', 'self_employed')))::int as employed,
      (count(*) filter (where c.ostatus = 'further_study'))::int as further_study,
      (count(*) filter (where c.ostatus = 'seeking'))::int as seeking,
      (count(*) filter (where c.related = 'directly'))::int as directly,
      (count(*) filter (where c.related = 'partly'))::int as partly,
      (count(*) filter (where c.related = 'not'))::int as unrelated,
      round(avg(c.days) filter (where c.days >= 0), 0) as avg_days
    from public.programmes pr left join cons c on c.pid = pr.id
    where pr.institution_org_id = org and (p_programme is null or pr.id = p_programme)
    group by pr.id, pr.name
  )
  select a.pid, a.pname, a.graduates, a.respondents,
         case when a.respondents >= k then a.employed end, case when a.respondents >= k then a.further_study end,
         case when a.respondents >= k then a.seeking end, case when a.respondents >= k then a.directly end,
         case when a.respondents >= k then a.partly end, case when a.respondents >= k then a.unrelated end,
         case when a.respondents >= k then a.avg_days end, a.respondents < k
  from agg a order by a.pname;
end $$;

create or replace function public.feedback_summary(p_programme uuid default null)
returns table (competency_id text, name text, responses int, avg_observed numeric, avg_expected numeric, shortfall numeric)
language plpgsql stable security definer set search_path = public as $$
declare org uuid := public.approved_org('institution'); k int := coalesce(public.setting('outcomes_min_group')::int, 5);
begin
  if org is null then raise exception 'Only approved institutions can view feedback analytics' using errcode = '42501'; end if;
  return query
  select c.id, c.name, count(*)::int, round(avg(fc.observed_level), 2), round(avg(fc.expected_level), 2),
         round(avg(fc.expected_level) - avg(fc.observed_level), 2)
  from public.feedback_competencies fc
  join public.employer_feedback f on f.id = fc.feedback_id
  join public.competencies c on c.id = fc.competency_id
  where exists (
    select 1 from public.enrollments en
    join public.outcomes o on o.student_id = en.student_id and o.share_with_institution
    where en.student_id = f.student_id and en.institution_org_id = org and en.status = 'graduated'
      and (p_programme is null or en.programme_id = p_programme))
  group by c.id, c.name
  having count(*) >= k
  order by 6 desc nulls last, c.name;
end $$;

create or replace function public.feedback_preparedness(p_programme uuid default null)
returns table (responses int, ready int, mostly int, partly int, not_ready int, would_hire_again int, suppressed boolean)
language plpgsql stable security definer set search_path = public as $$
declare org uuid := public.approved_org('institution'); k int := coalesce(public.setting('outcomes_min_group')::int, 5);
begin
  if org is null then raise exception 'Only approved institutions can view feedback analytics' using errcode = '42501'; end if;
  return query
  with fb as (
    select f.* from public.employer_feedback f
    where exists (
      select 1 from public.enrollments en
      join public.outcomes o on o.student_id = en.student_id and o.share_with_institution
      where en.student_id = f.student_id and en.institution_org_id = org and en.status = 'graduated'
        and (p_programme is null or en.programme_id = p_programme))
  ), a as (
    select count(*)::int as n,
           (count(*) filter (where fb.preparedness = 'ready'))::int as ready,
           (count(*) filter (where fb.preparedness = 'mostly'))::int as mostly,
           (count(*) filter (where fb.preparedness = 'partly'))::int as partly,
           (count(*) filter (where fb.preparedness = 'not_ready'))::int as not_ready,
           (count(*) filter (where fb.would_hire_again))::int as again
    from fb
  )
  select a.n, case when a.n >= k then a.ready end, case when a.n >= k then a.mostly end, case when a.n >= k then a.partly end,
         case when a.n >= k then a.not_ready end, case when a.n >= k then a.again end, a.n < k
  from a;
end $$;

-- ================================================================== regulation
create or replace function public.requirement_status(p_student uuid, p_requirement uuid)
returns table (hours numeric, met_competencies int, total_competencies int, met boolean)
language plpgsql stable security definer set search_path = public as $$
declare r public.requirements; h numeric; total int; ok int;
begin
  select * into r from public.requirements where id = p_requirement;
  if not found then return; end if;
  select coalesce(sum(e.hours), 0) into h from public.evidence e
    where e.student_id = p_student and e.sector_id = r.sector_id and e.status = 'verified';
  select count(*) into total from public.requirement_competencies where requirement_id = r.id;
  select count(*) into ok from public.requirement_competencies rc
  where rc.requirement_id = r.id and (
    select max(x.lvl) from (
      select ec.rating as lvl from public.evidence_competencies ec join public.evidence e on e.id = ec.evidence_id
        where e.student_id = p_student and e.status = 'verified' and ec.competency_id = rc.competency_id and ec.rating is not null
      union all
      select l.level from public.assessment_result_levels l join public.assessment_results ar on ar.id = l.result_id
        where ar.student_id = p_student and l.competency_id = rc.competency_id
    ) x) >= r.min_level;
  return query select h, ok, total, (h >= r.min_hours and ok = total);
end $$;

create or replace function public.my_requirement_progress()
returns table (requirement_id uuid, title text, sector_id text, regulator text, hours numeric, min_hours numeric,
               met_competencies int, total_competencies int, met boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  return query
  select r.id, r.title, r.sector_id, o.name, s.hours, r.min_hours, s.met_competencies, s.total_competencies, s.met
  from public.requirements r
  join public.organizations o on o.id = r.regulator_org_id
  cross join lateral public.requirement_status(auth.uid(), r.id) s
  where r.sector_id = any (coalesce((select p.sector_ids from public.profiles p where p.id = auth.uid()), '{}'::text[]))
     or exists (select 1 from public.evidence e where e.student_id = auth.uid() and e.sector_id = r.sector_id)
  order by r.title;
end $$;

create or replace function public.regulator_compliance(p_requirement uuid)
returns table (institution_org_id uuid, institution_name text, students int, meeting int, avg_hours numeric)
language plpgsql stable security definer set search_path = public as $$
declare org uuid := public.approved_org('regulator');
begin
  if org is null then raise exception 'Only approved regulators can view compliance' using errcode = '42501'; end if;
  if not exists (select 1 from public.requirements where id = p_requirement and regulator_org_id = org) then
    raise exception 'Requirement not found' using errcode = 'P0002';
  end if;
  return query
  select o.id, o.name, count(distinct en.student_id)::int,
         (count(distinct en.student_id) filter (where s.met))::int, round(avg(s.hours), 1)
  from public.requirements r
  join public.programmes pr on pr.sector_id = r.sector_id
  join public.organizations o on o.id = pr.institution_org_id
  join public.enrollments en on en.programme_id = pr.id and en.status in ('confirmed', 'graduated')
  cross join lateral public.requirement_status(en.student_id, r.id) s
  where r.id = p_requirement
  group by o.id, o.name order by o.name;
end $$;

-- ================================================ student competency record
-- Invoker: row-level security decides what the caller may see (own, public, or verified for their org).
create or replace function public.competency_record(p_student uuid)
returns table (competency_id text, name text, best_level int, evidence_count int, assessment_count int, last_at timestamptz)
language sql stable as $$
  with rec as (
    select ec.competency_id as cid, ec.rating as lvl, 'e' as src, e.verified_at as at
    from public.evidence_competencies ec join public.evidence e on e.id = ec.evidence_id
    where e.student_id = p_student and e.status = 'verified' and ec.rating is not null
    union all
    select l.competency_id, l.level, 'a', r.assessed_at
    from public.assessment_result_levels l join public.assessment_results r on r.id = l.result_id
    where r.student_id = p_student
  )
  select c.id, c.name, max(rec.lvl)::int, (count(*) filter (where rec.src = 'e'))::int,
         (count(*) filter (where rec.src = 'a'))::int, max(rec.at)
  from rec join public.competencies c on c.id = rec.cid
  group by c.id, c.name order by max(rec.lvl) desc, count(*) desc, c.name;
$$;

-- ================================================================ dashboards
create or replace function public.dashboard_stats() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid(); r text := public.my_role(); org uuid := public.my_org(); res jsonb := '{}';
begin
  if uid is null then return res; end if;
  res := jsonb_build_object('role', r, 'unread', (select count(*) from public.notifications where user_id = uid and read_at is null));
  if r = 'student' then
    res := res || jsonb_build_object(
      'evidence', (select coalesce(jsonb_object_agg(status, n), '{}') from (select status, count(*) n from public.evidence where student_id = uid group by status) x),
      'applications', (select count(*) from public.internship_applications where student_id = uid and status in ('applied', 'shortlisted', 'offered', 'accepted')),
      'results', (select count(*) from public.assessment_results where student_id = uid),
      'pipeline', (select count(*) from public.talent_pipeline where student_id = uid and stage in ('invited', 'assessing', 'interviewing', 'offered', 'hired')));
  elsif r = 'employer' then
    res := res || jsonb_build_object(
      'open_projects', (select count(*) from public.projects where employer_org_id = org and status = 'open'),
      'open_internships', (select count(*) from public.internships where employer_org_id = org and status = 'open'),
      'to_review', (select count(*) from public.evidence where verifier_org_id = org and status = 'submitted'),
      'new_applications', (select count(*) from public.internship_applications a join public.internships i on i.id = a.internship_id where i.employer_org_id = org and a.status = 'applied'),
      'pipeline', (select coalesce(jsonb_object_agg(stage, n), '{}') from (select stage, count(*) n from public.talent_pipeline where employer_org_id = org group by stage) x),
      'standards_due', (select count(*) from public.standards where employer_org_id = org and status = 'published' and review_by <= current_date + 14));
  elsif r = 'institution' then
    res := res || jsonb_build_object(
      'enrolment_requests', (select count(*) from public.enrollments where institution_org_id = org and status = 'requested'),
      'students', (select count(*) from public.enrollments where institution_org_id = org and status in ('confirmed', 'graduated')),
      'programmes', (select count(*) from public.programmes where institution_org_id = org),
      'standards_awaiting_response', (select count(*) from public.standards s where s.status = 'published' and not exists (select 1 from public.standard_responses x where x.standard_id = s.id and x.institution_org_id = org)),
      'open_actions', (select count(*) from public.curriculum_actions where institution_org_id = org and status in ('proposed', 'in_progress')));
  elsif r = 'regulator' then
    res := res || jsonb_build_object('requirements', (select count(*) from public.requirements where regulator_org_id = org));
  end if;
  if public.is_admin() then
    res := res || jsonb_build_object('admin', jsonb_build_object(
      'pending_orgs', (select count(*) from public.organizations where status = 'pending'),
      'users', (select coalesce(jsonb_object_agg(role, n), '{}') from (select role, count(*) n from public.profiles group by role) x),
      'verified_evidence', (select count(*) from public.evidence where status = 'verified'),
      'outbox_pending', (select count(*) from public.outbox where status = 'pending')));
  end if;
  return res;
end $$;
