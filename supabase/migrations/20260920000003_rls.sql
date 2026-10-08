-- Row-level security. Default is deny: a table with RLS enabled and no policy is closed.
-- Institutions never read individual evidence, outcomes or feedback rows; they use the
-- aggregate functions in the next migration (which enforce consent and a minimum group size).

alter table public.app_admins enable row level security;
alter table public.app_settings enable row level security;
alter table public.sectors enable row level security;
alter table public.competencies enable row level security;
alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.programmes enable row level security;
alter table public.courses enable row level security;
alter table public.course_competencies enable row level security;
alter table public.enrollments enable row level security;
alter table public.curriculum_actions enable row level security;
alter table public.standards enable row level security;
alter table public.standard_competencies enable row level security;
alter table public.standard_responses enable row level security;
alter table public.assessments enable row level security;
alter table public.assessment_competencies enable row level security;
alter table public.assessment_results enable row level security;
alter table public.assessment_result_levels enable row level security;
alter table public.projects enable row level security;
alter table public.project_competencies enable row level security;
alter table public.internships enable row level security;
alter table public.internship_competencies enable row level security;
alter table public.internship_applications enable row level security;
alter table public.evidence enable row level security;
alter table public.evidence_competencies enable row level security;
alter table public.evidence_media enable row level security;
alter table public.verification_requests enable row level security;
alter table public.evidence_events enable row level security;
alter table public.talent_pipeline enable row level security;
alter table public.employments enable row level security;
alter table public.outcomes enable row level security;
alter table public.employer_feedback enable row level security;
alter table public.feedback_competencies enable row level security;
alter table public.requirements enable row level security;
alter table public.requirement_competencies enable row level security;
alter table public.notifications enable row level security;
alter table public.outbox enable row level security;

-- ------------------------------------------------------------ framework
drop policy if exists sectors_read on public.sectors;
create policy sectors_read on public.sectors for select to anon, authenticated using (true);
drop policy if exists sectors_admin on public.sectors;
create policy sectors_admin on public.sectors for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists competencies_read on public.competencies;
create policy competencies_read on public.competencies for select to anon, authenticated using (true);
drop policy if exists competencies_admin on public.competencies;
create policy competencies_admin on public.competencies for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------- people and orgs
drop policy if exists org_read on public.organizations;
create policy org_read on public.organizations for select to authenticated
  using (status = 'approved' or id = public.my_org() or public.is_admin());
drop policy if exists org_update on public.organizations;
create policy org_update on public.organizations for update to authenticated
  using (id = public.my_org() or public.is_admin()) with check (id = public.my_org() or public.is_admin());

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or (org_id is not null and org_id = public.my_org()) or public.is_admin());
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- ------------------------------------------------------ university: teaching
drop policy if exists programmes_read on public.programmes;
create policy programmes_read on public.programmes for select to authenticated using (true);
drop policy if exists programmes_write on public.programmes;
create policy programmes_write on public.programmes for all to authenticated
  using (institution_org_id = public.approved_org('institution'))
  with check (institution_org_id = public.approved_org('institution'));

drop policy if exists courses_read on public.courses;
create policy courses_read on public.courses for select to authenticated using (true);
drop policy if exists courses_write on public.courses;
create policy courses_write on public.courses for all to authenticated
  using (exists (select 1 from public.programmes p where p.id = programme_id and p.institution_org_id = public.approved_org('institution')))
  with check (exists (select 1 from public.programmes p where p.id = programme_id and p.institution_org_id = public.approved_org('institution')));

drop policy if exists course_competencies_read on public.course_competencies;
create policy course_competencies_read on public.course_competencies for select to authenticated using (true);
drop policy if exists course_competencies_write on public.course_competencies;
create policy course_competencies_write on public.course_competencies for all to authenticated
  using (exists (select 1 from public.courses c join public.programmes p on p.id = c.programme_id
                 where c.id = course_id and p.institution_org_id = public.approved_org('institution')))
  with check (exists (select 1 from public.courses c join public.programmes p on p.id = c.programme_id
                      where c.id = course_id and p.institution_org_id = public.approved_org('institution')));

drop policy if exists enrollments_read on public.enrollments;
create policy enrollments_read on public.enrollments for select to authenticated
  using (student_id = auth.uid() or institution_org_id = public.approved_org('institution') or public.is_admin());
drop policy if exists enrollments_insert on public.enrollments;
create policy enrollments_insert on public.enrollments for insert to authenticated
  with check (student_id = auth.uid() and public.my_role() = 'student' and status = 'requested'
    and exists (select 1 from public.programmes p where p.id = programme_id and p.institution_org_id = enrollments.institution_org_id));
drop policy if exists enrollments_update on public.enrollments;
create policy enrollments_update on public.enrollments for update to authenticated
  using (student_id = auth.uid() or institution_org_id = public.approved_org('institution'))
  with check (student_id = auth.uid() or institution_org_id = public.approved_org('institution'));

drop policy if exists curriculum_actions_all on public.curriculum_actions;
create policy curriculum_actions_all on public.curriculum_actions for all to authenticated
  using (institution_org_id = public.approved_org('institution') or public.is_admin())
  with check (institution_org_id = public.approved_org('institution'));

-- ------------------------------------------------------- industry standards
drop policy if exists standards_read on public.standards;
create policy standards_read on public.standards for select to authenticated using (true);
drop policy if exists standards_write on public.standards;
create policy standards_write on public.standards for all to authenticated
  using (employer_org_id = public.approved_org('employer'))
  with check (employer_org_id = public.approved_org('employer'));

drop policy if exists standard_competencies_read on public.standard_competencies;
create policy standard_competencies_read on public.standard_competencies for select to authenticated using (true);
drop policy if exists standard_competencies_write on public.standard_competencies;
create policy standard_competencies_write on public.standard_competencies for all to authenticated
  using (exists (select 1 from public.standards s where s.id = standard_id and s.employer_org_id = public.approved_org('employer')))
  with check (exists (select 1 from public.standards s where s.id = standard_id and s.employer_org_id = public.approved_org('employer')));

drop policy if exists standard_responses_read on public.standard_responses;
create policy standard_responses_read on public.standard_responses for select to authenticated using (true);
drop policy if exists standard_responses_write on public.standard_responses;
create policy standard_responses_write on public.standard_responses for all to authenticated
  using (institution_org_id = public.approved_org('institution'))
  with check (institution_org_id = public.approved_org('institution'));

-- ------------------------------------------------------------- assessments
drop policy if exists assessments_read on public.assessments;
create policy assessments_read on public.assessments for select to authenticated using (true);
drop policy if exists assessments_write on public.assessments;
create policy assessments_write on public.assessments for all to authenticated
  using (owner_org_id = public.my_approved_org()) with check (owner_org_id = public.my_approved_org());

drop policy if exists assessment_competencies_read on public.assessment_competencies;
create policy assessment_competencies_read on public.assessment_competencies for select to authenticated using (true);
drop policy if exists assessment_competencies_write on public.assessment_competencies;
create policy assessment_competencies_write on public.assessment_competencies for all to authenticated
  using (exists (select 1 from public.assessments a where a.id = assessment_id and a.owner_org_id = public.my_approved_org()))
  with check (exists (select 1 from public.assessments a where a.id = assessment_id and a.owner_org_id = public.my_approved_org()));

-- Results are written through record_assessment_result(). Students may only publish or hide them.
-- Helper so anonymous readers of public results never need access to the assessments table itself.
create or replace function public.owns_assessment(p_assessment uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.assessments a where a.id = p_assessment and a.owner_org_id = public.my_approved_org());
$$;
drop policy if exists assessment_results_read on public.assessment_results;
create policy assessment_results_read on public.assessment_results for select to anon, authenticated
  using (is_public
    or student_id = auth.uid()
    or public.owns_assessment(assessment_id)
    or public.is_admin());
drop policy if exists assessment_results_publish on public.assessment_results;
create policy assessment_results_publish on public.assessment_results for update to authenticated
  using (student_id = auth.uid()) with check (student_id = auth.uid());
drop policy if exists assessment_result_levels_read on public.assessment_result_levels;
create policy assessment_result_levels_read on public.assessment_result_levels for select to anon, authenticated
  using (exists (select 1 from public.assessment_results r where r.id = result_id));

-- ------------------------------------------------- employers: projects, internships
drop policy if exists projects_read on public.projects;
create policy projects_read on public.projects for select to authenticated using (true);
drop policy if exists projects_write on public.projects;
create policy projects_write on public.projects for all to authenticated
  using (employer_org_id = public.approved_org('employer')) with check (employer_org_id = public.approved_org('employer'));
drop policy if exists project_competencies_read on public.project_competencies;
create policy project_competencies_read on public.project_competencies for select to authenticated using (true);
drop policy if exists project_competencies_write on public.project_competencies;
create policy project_competencies_write on public.project_competencies for all to authenticated
  using (exists (select 1 from public.projects p where p.id = project_id and p.employer_org_id = public.approved_org('employer')))
  with check (exists (select 1 from public.projects p where p.id = project_id and p.employer_org_id = public.approved_org('employer')));

drop policy if exists internships_read on public.internships;
create policy internships_read on public.internships for select to authenticated using (true);
drop policy if exists internships_write on public.internships;
create policy internships_write on public.internships for all to authenticated
  using (employer_org_id = public.approved_org('employer')) with check (employer_org_id = public.approved_org('employer'));
drop policy if exists internship_competencies_read on public.internship_competencies;
create policy internship_competencies_read on public.internship_competencies for select to authenticated using (true);
drop policy if exists internship_competencies_write on public.internship_competencies;
create policy internship_competencies_write on public.internship_competencies for all to authenticated
  using (exists (select 1 from public.internships i where i.id = internship_id and i.employer_org_id = public.approved_org('employer')))
  with check (exists (select 1 from public.internships i where i.id = internship_id and i.employer_org_id = public.approved_org('employer')));

drop policy if exists applications_read on public.internship_applications;
create policy applications_read on public.internship_applications for select to authenticated
  using (student_id = auth.uid()
    or exists (select 1 from public.internships i where i.id = internship_id and i.employer_org_id = public.approved_org('employer'))
    or public.is_admin());
drop policy if exists applications_insert on public.internship_applications;
create policy applications_insert on public.internship_applications for insert to authenticated
  with check (student_id = auth.uid() and public.my_role() = 'student' and status = 'applied');
drop policy if exists applications_update on public.internship_applications;
create policy applications_update on public.internship_applications for update to authenticated
  using (student_id = auth.uid()
    or exists (select 1 from public.internships i where i.id = internship_id and i.employer_org_id = public.approved_org('employer')))
  with check (student_id = auth.uid()
    or exists (select 1 from public.internships i where i.id = internship_id and i.employer_org_id = public.approved_org('employer')));

-- ---------------------------------------------------------------- evidence
drop policy if exists evidence_read on public.evidence;
create policy evidence_read on public.evidence for select to anon, authenticated
  using (student_id = auth.uid()
    or (is_public and status = 'verified')
    or (verifier_org_id is not null and verifier_org_id = public.approved_org('employer'))
    or public.is_admin());
drop policy if exists evidence_insert on public.evidence;
create policy evidence_insert on public.evidence for insert to authenticated
  with check (student_id = auth.uid() and public.my_role() = 'student'
    and status in ('draft', 'submitted') and verified_at is null and assurance is null
    and verifier_note = '' and is_public = false);
drop policy if exists evidence_update on public.evidence;
create policy evidence_update on public.evidence for update to authenticated
  using (student_id = auth.uid()) with check (student_id = auth.uid());
drop policy if exists evidence_delete on public.evidence;
create policy evidence_delete on public.evidence for delete to authenticated
  using (student_id = auth.uid() and status <> 'verified');

drop policy if exists evidence_competencies_read on public.evidence_competencies;
create policy evidence_competencies_read on public.evidence_competencies for select to anon, authenticated
  using (exists (select 1 from public.evidence e where e.id = evidence_id));
drop policy if exists evidence_competencies_insert on public.evidence_competencies;
create policy evidence_competencies_insert on public.evidence_competencies for insert to authenticated
  with check (rating is null
    and exists (select 1 from public.evidence e where e.id = evidence_id and e.student_id = auth.uid() and e.status <> 'verified'));
drop policy if exists evidence_competencies_delete on public.evidence_competencies;
create policy evidence_competencies_delete on public.evidence_competencies for delete to authenticated
  using (exists (select 1 from public.evidence e where e.id = evidence_id and e.student_id = auth.uid() and e.status <> 'verified'));

drop policy if exists evidence_media_read on public.evidence_media;
create policy evidence_media_read on public.evidence_media for select to anon, authenticated
  using (exists (select 1 from public.evidence e where e.id = evidence_id));
drop policy if exists evidence_media_insert on public.evidence_media;
create policy evidence_media_insert on public.evidence_media for insert to authenticated
  with check (storage_path like auth.uid()::text || '/%'
    and exists (select 1 from public.evidence e where e.id = evidence_id and e.student_id = auth.uid() and e.status <> 'verified'));
drop policy if exists evidence_media_delete on public.evidence_media;
create policy evidence_media_delete on public.evidence_media for delete to authenticated
  using (exists (select 1 from public.evidence e where e.id = evidence_id and e.student_id = auth.uid() and e.status <> 'verified'));

drop policy if exists verification_requests_read on public.verification_requests;
create policy verification_requests_read on public.verification_requests for select to authenticated
  using (exists (select 1 from public.evidence e where e.id = evidence_id and e.student_id = auth.uid()));
drop policy if exists evidence_events_read on public.evidence_events;
create policy evidence_events_read on public.evidence_events for select to authenticated
  using (exists (select 1 from public.evidence e where e.id = evidence_id and e.student_id = auth.uid()) or public.is_admin());

-- ------------------------------------------ talent discovery, hiring, employment
drop policy if exists pipeline_read on public.talent_pipeline;
create policy pipeline_read on public.talent_pipeline for select to authenticated
  using (employer_org_id = public.approved_org('employer')
    or (student_id = auth.uid() and stage in ('invited', 'assessing', 'interviewing', 'offered', 'hired'))
    or public.is_admin());
drop policy if exists pipeline_insert on public.talent_pipeline;
create policy pipeline_insert on public.talent_pipeline for insert to authenticated
  with check (employer_org_id = public.approved_org('employer') and stage = 'shortlisted'
    and public.employer_can_reach_student(employer_org_id, student_id));
drop policy if exists pipeline_update on public.talent_pipeline;
create policy pipeline_update on public.talent_pipeline for update to authenticated
  using (employer_org_id = public.approved_org('employer')) with check (employer_org_id = public.approved_org('employer'));
drop policy if exists pipeline_delete on public.talent_pipeline;
create policy pipeline_delete on public.talent_pipeline for delete to authenticated
  using (employer_org_id = public.approved_org('employer') and stage <> 'hired');

drop policy if exists employments_read on public.employments;
create policy employments_read on public.employments for select to authenticated
  using (student_id = auth.uid() or employer_org_id = public.approved_org('employer') or public.is_admin());
drop policy if exists employments_insert on public.employments;
create policy employments_insert on public.employments for insert to authenticated
  with check (student_id = auth.uid() and public.my_role() = 'student'
    and source = 'self_reported' and employer_confirmed = false and employer_org_id is null);
drop policy if exists employments_update on public.employments;
create policy employments_update on public.employments for update to authenticated
  using (student_id = auth.uid()) with check (student_id = auth.uid());
drop policy if exists employments_delete on public.employments;
create policy employments_delete on public.employments for delete to authenticated
  using (student_id = auth.uid() and employer_confirmed = false);

drop policy if exists outcomes_own on public.outcomes;
create policy outcomes_own on public.outcomes for all to authenticated
  using (student_id = auth.uid() or public.is_admin()) with check (student_id = auth.uid() and public.my_role() = 'student');

-- ---------------------------------------------------------------- feedback
drop policy if exists feedback_read on public.employer_feedback;
create policy feedback_read on public.employer_feedback for select to authenticated
  using (student_id = auth.uid() or employer_org_id = public.approved_org('employer') or public.is_admin());
drop policy if exists feedback_competencies_read on public.feedback_competencies;
create policy feedback_competencies_read on public.feedback_competencies for select to authenticated
  using (exists (select 1 from public.employer_feedback f where f.id = feedback_id));

-- --------------------------------------------------------------- regulation
drop policy if exists requirements_read on public.requirements;
create policy requirements_read on public.requirements for select to authenticated using (true);
drop policy if exists requirements_write on public.requirements;
create policy requirements_write on public.requirements for all to authenticated
  using (regulator_org_id = public.approved_org('regulator')) with check (regulator_org_id = public.approved_org('regulator'));
drop policy if exists requirement_competencies_read on public.requirement_competencies;
create policy requirement_competencies_read on public.requirement_competencies for select to authenticated using (true);
drop policy if exists requirement_competencies_write on public.requirement_competencies;
create policy requirement_competencies_write on public.requirement_competencies for all to authenticated
  using (exists (select 1 from public.requirements r where r.id = requirement_id and r.regulator_org_id = public.approved_org('regulator')))
  with check (exists (select 1 from public.requirements r where r.id = requirement_id and r.regulator_org_id = public.approved_org('regulator')));

-- ------------------------------------------------------------ notifications
drop policy if exists notifications_read on public.notifications;
create policy notifications_read on public.notifications for select to authenticated using (user_id = auth.uid());
drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ------------------------------------------- public portfolio (opt-in, safe columns only)
-- Deliberately owned by the table owner so it bypasses RLS; it exposes only opted-in rows and no email.
create or replace view public.public_profiles as
  select id, slug, full_name, headline, sector_ids from public.profiles where public_profile;
