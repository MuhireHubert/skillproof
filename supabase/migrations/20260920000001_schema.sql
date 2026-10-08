-- SkillProof schema (Supabase / Postgres 15+).
--
-- One sector-neutral object chain:
--   Student -> Competency -> Evidence -> Assessment -> Project -> Employer
--   -> Internship -> Employment -> Outcome -> Feedback
-- Only the data in `sectors` and `competencies` (the framework) changes by sector.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- =============================================================== platform
create table if not exists public.app_admins (email text primary key check (email = lower(email)));
create table if not exists public.app_settings (key text primary key, value text not null);
insert into public.app_settings (key, value) values
  ('outcomes_min_group', '5'),                 -- k-anonymity floor for analytics about people
  ('default_country_code', '250'),             -- normalises local phone numbers
  ('public_app_url', 'http://localhost:5173')  -- used in verification links
on conflict (key) do nothing;

-- ====================================================== competency framework
create table if not exists public.sectors (
  id text primary key,
  name text not null,
  archetype text not null check (archetype in ('project', 'regulated', 'handson')),
  verifier_label text not null,
  evidence_types text[] not null default '{}',
  active boolean not null default true
);

create table if not exists public.competencies (
  id text primary key,
  sector_id text references public.sectors (id) on delete cascade,  -- null = cross-sector professional competency
  name text not null,
  description text not null default '',
  category text not null default 'technical' check (category in ('technical', 'professional')),
  level_descriptors jsonb,                                          -- optional: 4 strings, overrides the default rubric
  check ((category = 'professional') = (sector_id is null))
);
create index if not exists competencies_sector_idx on public.competencies (sector_id);

-- =========================================================== people and orgs
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('employer', 'institution', 'regulator')),
  name text not null check (length(btrim(name)) > 0),
  sector_ids text[] not null default '{}',
  status text not null default 'pending' check (status in ('pending', 'approved', 'suspended')),
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('student', 'employer', 'institution', 'regulator')),
  full_name text not null,
  email text,
  org_id uuid references public.organizations (id),
  headline text not null default '',
  sector_ids text[] not null default '{}',
  public_profile boolean not null default false,   -- shareable portfolio page
  discoverable boolean not null default false,     -- appears in employer talent search
  slug text not null unique,
  created_at timestamptz not null default now(),
  check ((role = 'student') = (org_id is null))
);
create index if not exists profiles_org_idx on public.profiles (org_id);

-- ========================================== university: curriculum and cohorts
create table if not exists public.programmes (
  id uuid primary key default gen_random_uuid(),
  institution_org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  sector_id text references public.sectors (id),
  level text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists programmes_org_idx on public.programmes (institution_org_id);

create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  programme_id uuid not null references public.programmes (id) on delete cascade,
  code text not null default '',
  name text not null,
  description text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists courses_programme_idx on public.courses (programme_id);

create table if not exists public.course_competencies (          -- curriculum <-> competencies
  course_id uuid not null references public.courses (id) on delete cascade,
  competency_id text not null references public.competencies (id) on delete cascade,
  coverage_level int not null check (coverage_level between 1 and 4),
  primary key (course_id, competency_id)
);

create table if not exists public.enrollments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  student_name text not null default '',
  institution_org_id uuid not null references public.organizations (id) on delete cascade,
  programme_id uuid not null references public.programmes (id) on delete cascade,
  status text not null default 'requested' check (status in ('requested', 'confirmed', 'graduated', 'withdrawn')),
  start_year int,
  graduated_on date,
  created_at timestamptz not null default now(),
  unique (student_id, institution_org_id, programme_id)
);
create index if not exists enrollments_org_idx on public.enrollments (institution_org_id, status);

create table if not exists public.curriculum_actions (           -- the "curriculum improvement" end of the loop
  id uuid primary key default gen_random_uuid(),
  institution_org_id uuid not null references public.organizations (id) on delete cascade,
  programme_id uuid references public.programmes (id) on delete set null,
  course_id uuid references public.courses (id) on delete set null,
  competency_id text references public.competencies (id) on delete set null,
  source text not null default 'other' check (source in ('skills_gap', 'employer_feedback', 'standard', 'regulator', 'other')),
  title text not null,
  note text not null default '',
  status text not null default 'proposed' check (status in ('proposed', 'in_progress', 'done', 'declined')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================ industry standards
create table if not exists public.standards (
  id uuid primary key default gen_random_uuid(),
  employer_org_id uuid not null references public.organizations (id) on delete cascade,
  sector_id text not null references public.sectors (id),
  role_title text not null check (length(btrim(role_title)) > 0),
  review_by date not null,
  version int not null default 1,
  status text not null default 'published' check (status in ('published', 'retired')),
  last_confirmed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists standards_sector_idx on public.standards (sector_id, status);

create table if not exists public.standard_competencies (
  standard_id uuid not null references public.standards (id) on delete cascade,
  competency_id text not null references public.competencies (id) on delete cascade,
  importance int not null check (importance between 1 and 3),
  level int not null check (level between 1 and 4),
  primary key (standard_id, competency_id)
);

create table if not exists public.standard_responses (
  id uuid primary key default gen_random_uuid(),
  standard_id uuid not null references public.standards (id) on delete cascade,
  institution_org_id uuid not null references public.organizations (id) on delete cascade,
  status text not null check (status in ('adopted', 'adapted', 'planned', 'declined')),
  programme_id uuid references public.programmes (id) on delete set null,
  note text not null default '',
  updated_at timestamptz not null default now(),
  unique (standard_id, institution_org_id)
);

-- ================================================ assessments (course or employer)
create table if not exists public.assessments (
  id uuid primary key default gen_random_uuid(),
  owner_org_id uuid not null references public.organizations (id) on delete cascade,
  sector_id text not null references public.sectors (id),
  course_id uuid references public.courses (id) on delete set null,
  title text not null check (length(btrim(title)) > 0),
  description text not null default '',
  kind text not null default 'practical' check (kind in ('exam', 'practical', 'project', 'oral', 'portfolio_review', 'workplace_observation')),
  created_at timestamptz not null default now()
);
create index if not exists assessments_owner_idx on public.assessments (owner_org_id);

create table if not exists public.assessment_competencies (
  assessment_id uuid not null references public.assessments (id) on delete cascade,
  competency_id text not null references public.competencies (id) on delete cascade,
  target_level int not null default 3 check (target_level between 1 and 4),
  primary key (assessment_id, competency_id)
);

create table if not exists public.assessment_results (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.assessments (id) on delete cascade,
  assessment_title text not null default '',
  student_id uuid not null references public.profiles (id) on delete cascade,
  student_name text not null default '',
  assessor_id uuid references public.profiles (id) on delete set null,
  assessor_name text not null default '',
  owner_org_name text not null default '',
  note text not null default '',
  is_public boolean not null default false,
  assessed_at timestamptz not null default now(),
  unique (assessment_id, student_id)
);
create index if not exists assessment_results_student_idx on public.assessment_results (student_id);

create table if not exists public.assessment_result_levels (
  result_id uuid not null references public.assessment_results (id) on delete cascade,
  competency_id text not null references public.competencies (id) on delete cascade,
  level int not null check (level between 1 and 4),
  primary key (result_id, competency_id)
);

-- ============================================= employers: projects, internships
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  employer_org_id uuid not null references public.organizations (id) on delete cascade,
  sector_id text not null references public.sectors (id),
  title text not null check (length(btrim(title)) > 0),
  description text not null,
  kind text not null default 'project' check (kind in ('project', 'challenge')),
  hours_estimate int,
  status text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now()
);
create index if not exists projects_idx on public.projects (status, sector_id);

create table if not exists public.project_competencies (
  project_id uuid not null references public.projects (id) on delete cascade,
  competency_id text not null references public.competencies (id) on delete cascade,
  primary key (project_id, competency_id)
);

create table if not exists public.internships (
  id uuid primary key default gen_random_uuid(),
  employer_org_id uuid not null references public.organizations (id) on delete cascade,
  sector_id text not null references public.sectors (id),
  title text not null check (length(btrim(title)) > 0),
  description text not null,
  location text not null default '',
  starts_on date,
  duration_weeks int,
  slots int not null default 1 check (slots > 0),
  stipend_note text not null default '',
  application_deadline date,
  status text not null default 'open' check (status in ('open', 'closed', 'filled')),
  created_at timestamptz not null default now()
);
create index if not exists internships_idx on public.internships (status, sector_id);

create table if not exists public.internship_competencies (
  internship_id uuid not null references public.internships (id) on delete cascade,
  competency_id text not null references public.competencies (id) on delete cascade,
  primary key (internship_id, competency_id)
);

create table if not exists public.internship_applications (
  id uuid primary key default gen_random_uuid(),
  internship_id uuid not null references public.internships (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  student_name text not null default '',
  cover_note text not null default '',
  status text not null default 'applied'
    check (status in ('applied', 'shortlisted', 'offered', 'accepted', 'declined', 'withdrawn', 'completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (internship_id, student_id)
);
create index if not exists internship_applications_student_idx on public.internship_applications (student_id);

-- ================================================================== evidence
create table if not exists public.evidence (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  student_name text not null default '',
  project_id uuid references public.projects (id) on delete set null,
  internship_application_id uuid references public.internship_applications (id) on delete set null,
  context_title text not null default '',            -- project or internship title, denormalised
  sector_id text not null references public.sectors (id),
  verifier_org_id uuid references public.organizations (id),   -- set when tied to an employer's project/internship
  evidence_type text not null default '',
  title text not null check (length(btrim(title)) > 0),
  description text not null default '',
  link text not null default '' check (link = '' or link ~* '^https?://\S+$'),
  hours numeric(6, 1) not null default 0 check (hours >= 0),
  status text not null default 'draft' check (status in ('draft', 'submitted', 'verified', 'revision', 'declined')),
  verifier_note text not null default '',
  verified_at timestamptz,
  verified_by_name text not null default '',
  verified_by_role text not null default '',
  verified_by_org_name text not null default '',
  assurance text check (assurance in ('org_verified', 'external_attested', 'ussd_attested')),
  is_public boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists evidence_student_idx on public.evidence (student_id, created_at desc);
create index if not exists evidence_org_idx on public.evidence (verifier_org_id, status);
create index if not exists evidence_public_idx on public.evidence (student_id) where is_public and status = 'verified';

create table if not exists public.evidence_competencies (
  evidence_id uuid not null references public.evidence (id) on delete cascade,
  competency_id text not null references public.competencies (id) on delete cascade,
  rating int check (rating between 1 and 4),   -- null until verified
  primary key (evidence_id, competency_id)
);

-- an assessment result can point at the evidence it judged
alter table public.assessment_results
  add column if not exists evidence_id uuid references public.evidence (id) on delete set null;

create table if not exists public.evidence_media (
  id uuid primary key default gen_random_uuid(),
  evidence_id uuid not null references public.evidence (id) on delete cascade,
  storage_path text not null unique,
  kind text not null check (kind in ('image', 'video', 'document')),
  caption text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists evidence_media_idx on public.evidence_media (evidence_id);

create table if not exists public.verification_requests (
  id uuid primary key default gen_random_uuid(),
  evidence_id uuid not null references public.evidence (id) on delete cascade,
  token text not null unique,
  short_code text not null,
  verifier_name text not null,
  verifier_role text not null default '',
  verifier_contact text not null default '',    -- normalised phone digits or lower-case email
  expires_at timestamptz not null,
  used_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists verification_active_code_idx on public.verification_requests (short_code) where used_at is null;
create index if not exists verification_evidence_idx on public.verification_requests (evidence_id);

create table if not exists public.evidence_events (
  id bigserial primary key,
  evidence_id uuid not null references public.evidence (id) on delete cascade,
  actor uuid,
  action text not null,
  meta jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- ===================================== talent discovery, hiring, employment
create table if not exists public.talent_pipeline (
  id uuid primary key default gen_random_uuid(),
  employer_org_id uuid not null references public.organizations (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  student_name text not null default '',
  stage text not null default 'shortlisted'
    check (stage in ('shortlisted', 'invited', 'assessing', 'interviewing', 'offered', 'hired', 'rejected')),
  source text not null default 'discovery' check (source in ('discovery', 'project', 'internship', 'assessment')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employer_org_id, student_id)
);

create table if not exists public.employments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  student_name text not null default '',
  employer_org_id uuid references public.organizations (id) on delete set null,
  employer_name text not null default '',
  job_title text not null check (length(btrim(job_title)) > 0),
  sector_id text references public.sectors (id),
  related_to_field text check (related_to_field in ('directly', 'partly', 'not')),
  started_on date,
  ended_on date,
  source text not null default 'self_reported' check (source in ('pipeline', 'internship', 'self_reported')),
  employer_confirmed boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists employments_student_idx on public.employments (student_id);

create table if not exists public.outcomes (                      -- graduate tracking: status + consent
  student_id uuid primary key references public.profiles (id) on delete cascade,
  status text not null check (status in ('studying', 'seeking', 'employed', 'self_employed', 'further_study', 'not_seeking')),
  share_with_institution boolean not null default false,
  updated_at timestamptz not null default now()
);

-- ================================================================ feedback
create table if not exists public.employer_feedback (
  id uuid primary key default gen_random_uuid(),
  employer_org_id uuid not null references public.organizations (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  student_name text not null default '',
  employment_id uuid references public.employments (id) on delete set null,
  internship_application_id uuid references public.internship_applications (id) on delete set null,
  preparedness text not null check (preparedness in ('ready', 'mostly', 'partly', 'not_ready')),
  would_hire_again boolean not null,
  comment text not null default '',
  created_at timestamptz not null default now(),
  check (employment_id is not null or internship_application_id is not null)
);
create index if not exists employer_feedback_student_idx on public.employer_feedback (student_id);

create table if not exists public.feedback_competencies (
  feedback_id uuid not null references public.employer_feedback (id) on delete cascade,
  competency_id text not null references public.competencies (id) on delete cascade,
  observed_level int not null check (observed_level between 1 and 4),
  expected_level int check (expected_level between 1 and 4),
  primary key (feedback_id, competency_id)
);

-- ================================================================ regulation
create table if not exists public.requirements (
  id uuid primary key default gen_random_uuid(),
  regulator_org_id uuid not null references public.organizations (id) on delete cascade,
  sector_id text not null references public.sectors (id),
  title text not null,
  description text not null default '',
  min_hours numeric(6, 1) not null default 0,
  min_level int not null default 3 check (min_level between 1 and 4),
  created_at timestamptz not null default now()
);

create table if not exists public.requirement_competencies (
  requirement_id uuid not null references public.requirements (id) on delete cascade,
  competency_id text not null references public.competencies (id) on delete cascade,
  primary key (requirement_id, competency_id)
);

-- ================================================ notifications and outbound
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null,
  title text not null,
  body text not null default '',
  link text not null default '',
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);

create table if not exists public.outbox (
  id bigserial primary key,
  channel text not null check (channel in ('sms', 'email')),
  recipient text not null,
  subject text not null default '',
  body text not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  attempts int not null default 0,
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists outbox_pending_idx on public.outbox (id) where status = 'pending';
