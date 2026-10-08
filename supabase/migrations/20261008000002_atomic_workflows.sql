-- Atomic workflow commands for SkillProof.
-- These functions make multi-table business operations transactional.
-- Clients call one command; PostgreSQL either commits the whole operation or nothing.

create or replace function public.publish_standard(
  p_sector_id text,
  p_role_title text,
  p_review_by date,
  p_competencies jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.approved_org('employer');
  v_id uuid;
  v_item jsonb;
begin
  if v_org is null then raise exception 'Only approved employers can publish standards' using errcode = '42501'; end if;
  if not exists (select 1 from sectors where id = p_sector_id and active) then raise exception 'Sector is not active' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_role_title,''))) = 0 then raise exception 'Role title is required' using errcode = '22023'; end if;
  if p_review_by is null or p_review_by < current_date then raise exception 'Review date must be today or later' using errcode = '22023'; end if;
  if jsonb_typeof(coalesce(p_competencies,'[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_competencies,'[]'::jsonb)) = 0 then
    raise exception 'At least one competency is required' using errcode = '22023';
  end if;

  insert into standards(employer_org_id, sector_id, role_title, review_by)
  values(v_org, p_sector_id, btrim(p_role_title), p_review_by)
  returning id into v_id;

  for v_item in select * from jsonb_array_elements(p_competencies) loop
    if not exists (
      select 1 from competencies c
      where c.id = v_item->>'competency_id' and c.sector_id = p_sector_id
    ) then raise exception 'Competency is not part of this sector: %', v_item->>'competency_id' using errcode = '22023'; end if;
    if coalesce((v_item->>'importance')::int,0) not between 1 and 3 then raise exception 'Importance must be 1-3' using errcode = '22023'; end if;
    if coalesce((v_item->>'level')::int,0) not between 1 and 4 then raise exception 'Level must be 1-4' using errcode = '22023'; end if;
    insert into standard_competencies(standard_id, competency_id, importance, level)
    values(v_id, v_item->>'competency_id', (v_item->>'importance')::int, (v_item->>'level')::int);
  end loop;
  return v_id;
end $$;

create or replace function public.publish_project(
  p_sector_id text,
  p_title text,
  p_description text,
  p_kind text,
  p_hours_estimate int,
  p_competencies jsonb
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_org uuid := public.approved_org('employer');
  v_id uuid;
  v_item jsonb;
begin
  if v_org is null then raise exception 'Only approved employers can publish projects' using errcode = '42501'; end if;
  if not exists(select 1 from sectors where id=p_sector_id and active) then raise exception 'Sector is not active' using errcode='22023'; end if;
  if length(btrim(coalesce(p_title,'')))=0 or length(btrim(coalesce(p_description,'')))=0 then raise exception 'Title and description are required' using errcode='22023'; end if;
  if p_kind not in ('project','challenge') then raise exception 'Invalid project kind' using errcode='22023'; end if;
  if jsonb_typeof(coalesce(p_competencies,'[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_competencies,'[]'::jsonb))=0 then raise exception 'At least one competency is required' using errcode='22023'; end if;

  insert into projects(employer_org_id, sector_id, title, description, kind, hours_estimate)
  values(v_org,p_sector_id,btrim(p_title),btrim(p_description),p_kind,p_hours_estimate)
  returning id into v_id;

  for v_item in select * from jsonb_array_elements(p_competencies) loop
    if not exists(select 1 from competencies where id=v_item->>'competency_id' and sector_id=p_sector_id) then
      raise exception 'Competency is not part of this sector: %',v_item->>'competency_id' using errcode='22023';
    end if;
    insert into project_competencies(project_id,competency_id) values(v_id,v_item->>'competency_id');
  end loop;
  return v_id;
end $$;

create or replace function public.publish_internship(
  p_sector_id text,
  p_title text,
  p_description text,
  p_location text,
  p_starts_on date,
  p_duration_weeks int,
  p_slots int,
  p_stipend_note text,
  p_application_deadline date,
  p_competencies jsonb
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_org uuid := public.approved_org('employer');
  v_id uuid;
  v_item jsonb;
begin
  if v_org is null then raise exception 'Only approved employers can publish internships' using errcode='42501'; end if;
  if not exists(select 1 from sectors where id=p_sector_id and active) then raise exception 'Sector is not active' using errcode='22023'; end if;
  if length(btrim(coalesce(p_title,'')))=0 or length(btrim(coalesce(p_description,'')))=0 then raise exception 'Title and description are required' using errcode='22023'; end if;
  if coalesce(p_slots,0) < 1 then raise exception 'At least one slot is required' using errcode='22023'; end if;
  if p_application_deadline is not null and p_starts_on is not null and p_application_deadline > p_starts_on then raise exception 'Application deadline cannot be after the start date' using errcode='22023'; end if;
  if jsonb_typeof(coalesce(p_competencies,'[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_competencies,'[]'::jsonb))=0 then raise exception 'At least one competency is required' using errcode='22023'; end if;

  insert into internships(employer_org_id,sector_id,title,description,location,starts_on,duration_weeks,slots,stipend_note,application_deadline)
  values(v_org,p_sector_id,btrim(p_title),btrim(p_description),btrim(coalesce(p_location,'')),p_starts_on,p_duration_weeks,p_slots,btrim(coalesce(p_stipend_note,'')),p_application_deadline)
  returning id into v_id;

  for v_item in select * from jsonb_array_elements(p_competencies) loop
    if not exists(select 1 from competencies where id=v_item->>'competency_id' and sector_id=p_sector_id) then
      raise exception 'Competency is not part of this sector: %',v_item->>'competency_id' using errcode='22023';
    end if;
    insert into internship_competencies(internship_id,competency_id) values(v_id,v_item->>'competency_id');
  end loop;
  return v_id;
end $$;

create or replace function public.start_project_evidence(p_project uuid)
returns uuid
language plpgsql security definer set search_path=public
as $$
declare
  v_student uuid := auth.uid();
  v_project projects%rowtype;
  v_id uuid;
begin
  if v_student is null or public.my_role() <> 'student' then raise exception 'Only students can start projects' using errcode='42501'; end if;
  select * into v_project from projects where id=p_project and status='open';
  if not found then raise exception 'Project is not available' using errcode='P0002'; end if;
  select id into v_id from evidence where student_id=v_student and project_id=p_project limit 1;
  if v_id is not null then return v_id; end if;

  insert into evidence(student_id,student_name,project_id,context_title,sector_id,verifier_org_id,title)
  select v_student,p.full_name,v_project.id,v_project.title,v_project.sector_id,v_project.employer_org_id,v_project.title
  from profiles p where p.id=v_student
  returning id into v_id;

  insert into evidence_competencies(evidence_id,competency_id)
  select v_id,competency_id from project_competencies where project_id=p_project;
  return v_id;
end $$;

create or replace function public.apply_to_internship(p_internship uuid,p_cover_note text default '')
returns uuid
language plpgsql security definer set search_path=public
as $$
declare
  v_student uuid:=auth.uid();
  v_item internships%rowtype;
  v_id uuid;
  v_taken int;
begin
  if v_student is null or public.my_role() <> 'student' then raise exception 'Only students can apply' using errcode='42501'; end if;
  select * into v_item from internships where id=p_internship and status='open' for update;
  if not found then raise exception 'Internship is not open' using errcode='P0002'; end if;
  if v_item.application_deadline is not null and v_item.application_deadline < current_date then raise exception 'The application deadline has passed' using errcode='22023'; end if;
  select count(*) into v_taken from internship_applications where internship_id=p_internship and status in ('offered','accepted','completed');
  if v_taken >= v_item.slots then raise exception 'All internship slots are filled' using errcode='23514'; end if;

  insert into internship_applications(internship_id,student_id,student_name,cover_note)
  select p_internship,v_student,p.full_name,btrim(coalesce(p_cover_note,''))
  from profiles p where p.id=v_student
  on conflict(internship_id,student_id) do update set cover_note=excluded.cover_note, status='applied', updated_at=now()
  returning id into v_id;
  return v_id;
end $$;

revoke all on function public.publish_standard(text,text,date,jsonb) from public;
revoke all on function public.publish_project(text,text,text,text,int,jsonb) from public;
revoke all on function public.publish_internship(text,text,text,text,date,int,int,text,date,jsonb) from public;
revoke all on function public.start_project_evidence(uuid) from public;
revoke all on function public.apply_to_internship(uuid,text) from public;
grant execute on function public.publish_standard(text,text,date,jsonb) to authenticated;
grant execute on function public.publish_project(text,text,text,text,int,jsonb) to authenticated;
grant execute on function public.publish_internship(text,text,text,text,date,int,int,text,date,jsonb) to authenticated;
grant execute on function public.start_project_evidence(uuid) to authenticated;
grant execute on function public.apply_to_internship(uuid,text) to authenticated;
