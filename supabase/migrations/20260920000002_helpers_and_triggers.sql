-- Helpers, signup, guard triggers and notification triggers.
-- Guard triggers are deliberately NOT security definer: they must see the real caller
-- (current_user = 'authenticated') so RPCs running as the function owner pass through.

-- ================================================================== helpers
create function public.is_api_role() returns boolean
language sql stable as $$ select current_user in ('authenticated', 'anon') $$;

create function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.app_admins a
    where a.email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

create function public.my_org() returns uuid
language sql stable security definer set search_path = public as $$
  select org_id from public.profiles where id = auth.uid();
$$;

create function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid();
$$;

-- The caller's organisation id, only if the organisation is approved and of the given type.
create function public.approved_org(p_type text) returns uuid
language sql stable security definer set search_path = public as $$
  select o.id
  from public.profiles p
  join public.organizations o on o.id = p.org_id
  where p.id = auth.uid() and o.type = p_type and o.status = 'approved';
$$;

create function public.my_approved_org() returns uuid
language sql stable security definer set search_path = public as $$
  select o.id
  from public.profiles p
  join public.organizations o on o.id = p.org_id
  where p.id = auth.uid() and o.status = 'approved';
$$;

create function public.setting(p_key text) returns text
language sql stable security definer set search_path = public as $$
  select value from public.app_settings where key = p_key;
$$;

create function public.normalize_contact(p text) returns text
language plpgsql stable security definer set search_path = public as $$
declare d text; cc text := coalesce(public.setting('default_country_code'), '');
begin
  p := btrim(coalesce(p, ''));
  if p like '%@%' then return lower(p); end if;
  d := regexp_replace(p, '\D', '', 'g');
  if d like '0%' and length(d) between 9 and 11 then d := cc || substr(d, 2); end if;
  return d;
end $$;

-- Can this employer organisation legitimately reach this student?
create function public.employer_can_reach_student(p_org uuid, p_student uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_org is not null and (
    exists (select 1 from public.profiles s where s.id = p_student and s.role = 'student' and s.discoverable)
    or exists (select 1 from public.internship_applications a join public.internships i on i.id = a.internship_id
               where a.student_id = p_student and i.employer_org_id = p_org and a.status <> 'withdrawn')
    or exists (select 1 from public.evidence e where e.student_id = p_student and e.verifier_org_id = p_org)
    or exists (select 1 from public.talent_pipeline t where t.student_id = p_student and t.employer_org_id = p_org)
  );
$$;

create function public.notify_user(p_user uuid, p_kind text, p_title text, p_body text default '', p_link text default '')
returns void language sql security definer set search_path = public as $$
  insert into public.notifications (user_id, kind, title, body, link) values (p_user, p_kind, p_title, p_body, p_link);
$$;

create function public.notify_org(p_org uuid, p_kind text, p_title text, p_body text default '', p_link text default '')
returns void language sql security definer set search_path = public as $$
  insert into public.notifications (user_id, kind, title, body, link)
  select id, p_kind, p_title, p_body, p_link from public.profiles where org_id = p_org;
$$;

create function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

-- ================================================================== signup
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}');
  r text := meta ->> 'role';
  nm text := btrim(coalesce(nullif(meta ->> 'full_name', ''), split_part(coalesce(new.email, 'user'), '@', 1)));
  org uuid;
  sect text[];
  base text;
begin
  if r is null or r not in ('student', 'employer', 'institution', 'regulator') then r := 'student'; end if;
  if jsonb_typeof(meta -> 'sector_ids') = 'array' then
    sect := array(select s.id from public.sectors s where s.id in (select jsonb_array_elements_text(meta -> 'sector_ids')));
  else
    sect := '{}';
  end if;
  if r <> 'student' then
    insert into public.organizations (type, name, sector_ids)
    values (r, coalesce(nullif(btrim(meta ->> 'org_name'), ''), nm), sect)
    returning id into org;
  end if;
  base := btrim(regexp_replace(lower(nm), '[^a-z0-9]+', '-', 'g'), '-');
  if base = '' then base := 'user'; end if;
  insert into public.profiles (id, role, full_name, email, org_id, sector_ids, slug)
  values (new.id, r, nm, new.email, org, sect, left(base, 30) || '-' || substr(encode(gen_random_bytes(4), 'hex'), 1, 6));
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

-- ===================================================================== guards
create function public.profiles_guard() returns trigger language plpgsql as $$
begin
  if public.is_api_role() and not public.is_admin() then
    if new.id <> old.id or new.role <> old.role or new.org_id is distinct from old.org_id
       or new.email is distinct from old.email or new.slug <> old.slug or new.created_at <> old.created_at then
      raise exception 'Protected profile fields cannot be changed' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger profiles_guard before update on public.profiles for each row execute function public.profiles_guard();

create function public.organizations_guard() returns trigger language plpgsql as $$
begin
  if public.is_api_role() and not public.is_admin() then
    if new.type <> old.type or new.status <> old.status or new.created_at <> old.created_at then
      raise exception 'Only an administrator can change an organisation''s type or approval status' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger organizations_guard before update on public.organizations for each row execute function public.organizations_guard();

-- Evidence: students edit their own work; only the review process may set verification fields.
create function public.evidence_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare pr record; ia record;
begin
  select full_name into new.student_name from public.profiles where id = new.student_id;
  if new.project_id is not null then
    select * into pr from public.projects where id = new.project_id;
    if not found or pr.status <> 'open' then
      raise exception 'That project is not open' using errcode = '22023';
    end if;
    new.sector_id := pr.sector_id; new.verifier_org_id := pr.employer_org_id; new.context_title := pr.title;
    new.internship_application_id := null;
  elsif new.internship_application_id is not null then
    select a.student_id, a.status, i.employer_org_id, i.sector_id, i.title into ia
    from public.internship_applications a join public.internships i on i.id = a.internship_id
    where a.id = new.internship_application_id;
    if not found or ia.student_id <> new.student_id or ia.status <> 'accepted' then
      raise exception 'Internship work can only be logged on a placement you have accepted' using errcode = '22023';
    end if;
    new.sector_id := ia.sector_id; new.verifier_org_id := ia.employer_org_id; new.context_title := ia.title;
  else
    new.verifier_org_id := null;
  end if;
  return new;
end $$;
create trigger evidence_before_insert before insert on public.evidence for each row execute function public.evidence_before_insert();

create function public.evidence_guard() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if not public.is_api_role() then return new; end if;
  if old.status = 'verified' then
    if (to_jsonb(new) - 'is_public' - 'updated_at') is distinct from (to_jsonb(old) - 'is_public' - 'updated_at') then
      raise exception 'Verified evidence can only be shown or hidden' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.student_id <> old.student_id or new.student_name is distinct from old.student_name
     or new.project_id is distinct from old.project_id
     or new.internship_application_id is distinct from old.internship_application_id
     or new.context_title is distinct from old.context_title or new.sector_id <> old.sector_id
     or new.verifier_org_id is distinct from old.verifier_org_id
     or new.verifier_note is distinct from old.verifier_note or new.verified_at is distinct from old.verified_at
     or new.verified_by_name is distinct from old.verified_by_name
     or new.verified_by_role is distinct from old.verified_by_role
     or new.verified_by_org_name is distinct from old.verified_by_org_name
     or new.assurance is distinct from old.assurance then
    raise exception 'Only the review process can change verification fields' using errcode = '42501';
  end if;
  if new.status not in ('draft', 'submitted') then
    raise exception 'Only a reviewer can set that status' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger evidence_guard before update on public.evidence for each row execute function public.evidence_guard();

create function public.enrollments_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select full_name into new.student_name from public.profiles where id = new.student_id;
  return new;
end $$;
create trigger enrollments_before_insert before insert on public.enrollments for each row execute function public.enrollments_before_insert();

create function public.enrollments_guard() returns trigger language plpgsql as $$
begin
  if not public.is_api_role() then return new; end if;
  if new.student_id <> old.student_id or new.student_name is distinct from old.student_name
     or new.institution_org_id <> old.institution_org_id or new.programme_id <> old.programme_id then
    raise exception 'Enrolment identity cannot be changed' using errcode = '42501';
  end if;
  if auth.uid() = old.student_id then
    if new.status <> 'withdrawn' or new.start_year is distinct from old.start_year
       or new.graduated_on is distinct from old.graduated_on then
      raise exception 'Students can only withdraw an enrolment request' using errcode = '42501';
    end if;
  else
    if new.status is distinct from old.status and not (
         (old.status = 'requested' and new.status in ('confirmed', 'withdrawn'))
      or (old.status = 'confirmed' and new.status in ('graduated', 'withdrawn'))) then
      raise exception 'That enrolment status change is not allowed' using errcode = '22023';
    end if;
    if new.status = 'graduated' and new.graduated_on is null then new.graduated_on := current_date; end if;
  end if;
  return new;
end $$;
create trigger enrollments_guard before update on public.enrollments for each row execute function public.enrollments_guard();

create function public.applications_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare i record;
begin
  select * into i from public.internships where id = new.internship_id;
  if not found or i.status <> 'open' or (i.application_deadline is not null and i.application_deadline < current_date) then
    raise exception 'This internship is not open for applications' using errcode = '22023';
  end if;
  select full_name into new.student_name from public.profiles where id = new.student_id;
  return new;
end $$;
create trigger applications_before_insert before insert on public.internship_applications for each row execute function public.applications_before_insert();

create function public.applications_guard() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if not public.is_api_role() then return new; end if;
  if new.internship_id <> old.internship_id or new.student_id <> old.student_id
     or new.student_name is distinct from old.student_name or new.cover_note is distinct from old.cover_note then
    raise exception 'Application details cannot be changed' using errcode = '42501';
  end if;
  if new.status = old.status then return new; end if;
  if auth.uid() = old.student_id then
    if not ((old.status = 'offered' and new.status in ('accepted', 'declined'))
         or (old.status in ('applied', 'shortlisted', 'offered') and new.status = 'withdrawn')) then
      raise exception 'That change is not allowed for applicants' using errcode = '22023';
    end if;
  else
    if not ((old.status = 'applied' and new.status in ('shortlisted', 'offered', 'declined'))
         or (old.status = 'shortlisted' and new.status in ('offered', 'declined'))
         or (old.status = 'offered' and new.status = 'declined')) then
      raise exception 'That change is not allowed for employers' using errcode = '22023';
    end if;
  end if;
  return new;
end $$;
create trigger applications_guard before update on public.internship_applications for each row execute function public.applications_guard();

create function public.pipeline_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select full_name into new.student_name from public.profiles where id = new.student_id;
  return new;
end $$;
create trigger pipeline_before_insert before insert on public.talent_pipeline for each row execute function public.pipeline_before_insert();

create function public.pipeline_guard() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if not public.is_api_role() then return new; end if;
  if new.employer_org_id <> old.employer_org_id or new.student_id <> old.student_id
     or new.student_name is distinct from old.student_name or new.source <> old.source then
    raise exception 'Pipeline identity cannot be changed' using errcode = '42501';
  end if;
  if old.stage = 'hired' and new.stage <> 'hired' then
    raise exception 'A hired candidate cannot be moved' using errcode = '22023';
  end if;
  if new.stage = 'hired' and old.stage <> 'hired' then
    raise exception 'Use the hire action to record a hire' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger pipeline_guard before update on public.talent_pipeline for each row execute function public.pipeline_guard();

create function public.employments_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select full_name into new.student_name from public.profiles where id = new.student_id;
  return new;
end $$;
create trigger employments_before_insert before insert on public.employments for each row execute function public.employments_before_insert();

create function public.employments_guard() returns trigger language plpgsql as $$
begin
  if public.is_api_role() and (new.student_id <> old.student_id or new.student_name is distinct from old.student_name or new.employer_org_id is distinct from old.employer_org_id
      or new.source <> old.source or new.employer_confirmed <> old.employer_confirmed or new.created_at <> old.created_at) then
    raise exception 'Protected employment fields cannot be changed' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger employments_guard before update on public.employments for each row execute function public.employments_guard();

create function public.assessment_results_guard() returns trigger language plpgsql as $$
begin
  if public.is_api_role() and (to_jsonb(new) - 'is_public') is distinct from (to_jsonb(old) - 'is_public') then
    raise exception 'Students can only show or hide an assessment result' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger assessment_results_guard before update on public.assessment_results for each row execute function public.assessment_results_guard();

create function public.notifications_guard() returns trigger language plpgsql as $$
begin
  if public.is_api_role() and (to_jsonb(new) - 'read_at') is distinct from (to_jsonb(old) - 'read_at') then
    raise exception 'Notifications can only be marked as read' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger notifications_guard before update on public.notifications for each row execute function public.notifications_guard();

create trigger outcomes_touch before update on public.outcomes for each row execute function public.touch_updated_at();
create trigger standard_responses_touch before update on public.standard_responses for each row execute function public.touch_updated_at();
create trigger curriculum_actions_touch before update on public.curriculum_actions for each row execute function public.touch_updated_at();

-- ======================================================== notification triggers
create function public.evidence_events_and_notify() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.evidence_events (evidence_id, actor, action, meta)
    values (new.id, auth.uid(), 'status:' || new.status, jsonb_build_object('assurance', new.assurance));
    if new.status = 'submitted' and new.verifier_org_id is not null then
      perform public.notify_org(new.verifier_org_id, 'evidence_submitted',
        new.student_name || ' submitted work', new.title, '/review');
    elsif tg_op = 'UPDATE' and new.status in ('verified', 'revision', 'declined') then
      perform public.notify_user(new.student_id, 'evidence_' || new.status,
        case new.status when 'verified' then 'Your work was verified' when 'revision' then 'Changes requested on your work' else 'Your work was declined' end,
        new.title, '/evidence/' || new.id);
    end if;
  end if;
  return null;
end $$;
create trigger evidence_events_and_notify after insert or update on public.evidence
for each row execute function public.evidence_events_and_notify();

create function public.application_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare i record;
begin
  select * into i from public.internships where id = new.internship_id;
  if tg_op = 'INSERT' then
    perform public.notify_org(i.employer_org_id, 'application_received', new.student_name || ' applied', i.title, '/internships');
  elsif new.status is distinct from old.status then
    if auth.uid() = new.student_id then
      perform public.notify_org(i.employer_org_id, 'application_' || new.status, new.student_name || ' ' || new.status, i.title, '/internships');
    else
      perform public.notify_user(new.student_id, 'application_' || new.status, 'Internship update: ' || new.status, i.title, '/internships');
    end if;
  end if;
  return null;
end $$;
create trigger application_notify after insert or update on public.internship_applications
for each row execute function public.application_notify();

create function public.pipeline_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare org_name text;
begin
  if tg_op = 'UPDATE' and new.stage is distinct from old.stage and new.stage in ('invited', 'assessing', 'interviewing', 'offered', 'hired') then
    select name into org_name from public.organizations where id = new.employer_org_id;
    perform public.notify_user(new.student_id, 'pipeline_' || new.stage, org_name || ' moved you to: ' || new.stage, '', '/journey');
  end if;
  return null;
end $$;
create trigger pipeline_notify after update on public.talent_pipeline
for each row execute function public.pipeline_notify();

create function public.assessment_result_notify() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.notify_user(new.student_id, 'assessment_result', 'New assessment result', new.owner_org_name, '/assessments');
  return null;
end $$;
create trigger assessment_result_notify after insert on public.assessment_results
for each row execute function public.assessment_result_notify();

create function public.feedback_notify() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.notify_user(new.student_id, 'feedback_received', 'You received employer feedback', '', '/journey');
  return null;
end $$;
create trigger feedback_notify after insert on public.employer_feedback
for each row execute function public.feedback_notify();

create function public.enrollment_notify() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.notify_org(new.institution_org_id, 'enrollment_requested', new.student_name || ' requested enrolment', '', '/enrollments');
  elsif new.status is distinct from old.status and auth.uid() is distinct from new.student_id then
    perform public.notify_user(new.student_id, 'enrollment_' || new.status, 'Enrolment ' || new.status, '', '/journey');
  end if;
  return null;
end $$;
create trigger enrollment_notify after insert or update on public.enrollments
for each row execute function public.enrollment_notify();

create function public.standard_response_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare s record; inst text;
begin
  select * into s from public.standards where id = new.standard_id;
  select name into inst from public.organizations where id = new.institution_org_id;
  perform public.notify_org(s.employer_org_id, 'standard_response', inst || ' responded to "' || s.role_title || '"', new.status, '/standards');
  return null;
end $$;
create trigger standard_response_notify after insert or update on public.standard_responses
for each row execute function public.standard_response_notify();

create function public.organization_status_notify() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    perform public.notify_org(new.id, 'organization_' || new.status, 'Your organisation is now ' || new.status, new.name, '/');
  end if;
  return null;
end $$;
create trigger organization_status_notify after update on public.organizations
for each row execute function public.organization_status_notify();
