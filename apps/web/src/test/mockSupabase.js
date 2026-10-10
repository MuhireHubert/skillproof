// A tiny in-memory stand-in for supabase-js used by the render smoke tests.
// Every query resolves with plausible sample rows so each screen renders its "has data" branch.
const now = new Date().toISOString();
const later = new Date(Date.now() + 864e5 * 30).toISOString().slice(0, 10);
const DIAG = 'mechanics-engine-diagnostics';
const SAFETY = 'mechanics-workshop-safety';

export const state = { role: 'student', admin: false, noProfile: false };

const sectors = [{ id: 'mechanics', name: 'Mechanics', archetype: 'handson', verifier_label: 'Workshop supervisor', evidence_types: ['Logged repair job'], active: true },
  { id: 'tech', name: 'Technology', archetype: 'project', verifier_label: 'Lead', evidence_types: [], active: true }];
const competencies = [
  { id: DIAG, sector_id: 'mechanics', name: 'Engine diagnostics', category: 'technical' },
  { id: SAFETY, sector_id: 'mechanics', name: 'Workshop safety', category: 'technical' },
  { id: 'pro-communication', sector_id: null, name: 'Communication', category: 'professional' },
];
const org = (type) => ({ id: 'org1', type, name: 'Test Org', status: 'approved', sector_ids: ['mechanics'] });
const ecs = (rating) => [{ competency_id: DIAG, rating }, { competency_id: SAFETY, rating }];
const evidence = (over) => ({ id: 'e1', student_id: 'u1', student_name: 'Ada Uwase', project_id: 'p1', context_title: 'Brake service', sector_id: 'mechanics', verifier_org_id: 'org1', evidence_type: '', title: 'Hilux brakes', description: 'Replaced pads', link: 'https://example.com', hours: 6, status: 'submitted', verifier_note: '', verified_at: now, verified_by_name: 'Eric', verified_by_org_name: 'Test Org', assurance: 'org_verified', is_public: false, created_at: now, updated_at: now, evidence_competencies: ecs(null), evidence_media: [], ...over });

function tables() {
  const std = { id: 's1', employer_org_id: 'org2', organizations: { name: 'Acme Garage' }, sector_id: 'mechanics', role_title: 'Junior mechanic', review_by: later, version: 1, status: 'published', standard_competencies: [{ competency_id: DIAG, importance: 3, level: 3 }], standard_responses: [{ status: 'planned', note: 'Adding a lab', organizations: { name: 'College' } }], created_at: now };
  const app = { id: 'a1', internship_id: 'i1', student_id: 'u1', student_name: 'Ada Uwase', status: 'accepted', cover_note: 'Keen', created_at: now, internships: { title: 'Workshop intern', sector_id: 'mechanics', organizations: { name: 'Acme Garage' } } };
  return {
    sectors, competencies,
    notifications: [{ id: 'n1', title: 'Your work was verified', body: 'Hilux brakes', link: '/evidence', read_at: null, created_at: now }],
    projects: [{ id: 'p1', employer_org_id: 'org1', organizations: { name: 'Acme Garage' }, sector_id: 'mechanics', title: 'Brake service', description: 'Full service', kind: 'project', hours_estimate: 12, status: 'open', created_at: now, project_competencies: [{ competency_id: DIAG }] }],
    internships: [{ id: 'i1', employer_org_id: 'org1', organizations: { name: 'Acme Garage' }, sector_id: 'mechanics', title: 'Workshop intern', description: 'Six weeks', location: 'Kigali', slots: 2, status: 'open', created_at: now, application_deadline: later, internship_competencies: [{ competency_id: DIAG }], internship_applications: [app] }],
    internship_applications: [app],
    evidence: [evidence({}), evidence({ id: 'e2', status: 'verified', is_public: true, evidence_competencies: ecs(3) })],
    assessments: [{ id: 'as1', owner_org_id: 'org1', sector_id: 'mechanics', title: 'Engine practical', description: 'Hands-on', kind: 'practical', course_id: null, created_at: now, assessment_competencies: [{ competency_id: DIAG, target_level: 3 }], assessment_results: [{ id: 'r1', student_id: 'u1', student_name: 'Ada Uwase', assessed_at: now, note: 'Good', assessment_result_levels: [{ competency_id: DIAG, level: 3 }] }] }],
    assessment_results: [{ id: 'r1', assessment_title: 'Engine practical', owner_org_name: 'College', assessor_name: 'Dr K', assessed_at: now, note: 'Good', is_public: false, assessment_result_levels: [{ competency_id: DIAG, level: 3 }] }],
    standards: [std],
    programmes: [{ id: 'pr1', institution_org_id: 'org1', organizations: { name: 'College' }, name: 'Diploma in Automotive', sector_id: 'mechanics', level: 'Diploma', created_at: now, courses: [{ id: 'c1', code: 'AUT101', name: 'Engine systems', description: 'Syllabus', course_competencies: [{ competency_id: DIAG, coverage_level: 2 }] }] }],
    courses: [{ id: 'c1', name: 'Engine systems', code: 'AUT101' }],
    enrollments: ['requested', 'confirmed', 'graduated'].map((status, i) => ({ id: 'en' + i, student_id: 'u1', student_name: 'Ada Uwase', status, created_at: now, graduated_on: null, programmes: { name: 'Diploma in Automotive' }, organizations: { name: 'College' } })),
    talent_pipeline: [{ id: 't1', employer_org_id: 'org1', organizations: { name: 'Acme Garage' }, student_id: 'u1', student_name: 'Ada Uwase', stage: 'interviewing', source: 'discovery', updated_at: now }],
    employments: [{ id: 'em1', student_id: 'u1', student_name: 'Ada Uwase', job_title: 'Junior mechanic', employer_name: 'Acme', sector_id: 'mechanics', started_on: '2025-08-15', related_to_field: 'directly', employer_confirmed: true }],
    employer_feedback: [{ id: 'f1', student_name: 'Ada Uwase', organizations: { name: 'Acme Garage' }, preparedness: 'mostly', would_hire_again: true, comment: 'Solid', created_at: now, feedback_competencies: [{ competency_id: DIAG, observed_level: 2, expected_level: 3 }] }],
    requirements: [{ id: 'rq1', title: 'Practical hours', sector_id: 'mechanics', min_hours: 100, min_level: 3, description: '', requirement_competencies: [{ competency_id: DIAG }] }],
    curriculum_actions: [{ id: 'ca1', title: 'Add brakes lab', source: 'skills_gap', competency_id: DIAG, status: 'proposed', note: '', created_at: now, programmes: { name: 'Diploma in Automotive' } }],
    organizations: [{ ...org('employer'), status: 'pending', created_at: now, profiles: [{ full_name: 'Eric', email: 'e@x.rw' }] }],
    evidence_media: [], verification_requests: [], public_profiles: [{ id: 'u1', slug: 'test', full_name: 'Ada Uwase', headline: 'Apprentice', sector_ids: ['mechanics'] }],
  };
}

function singles() {
  return {
    profiles: profile(),
    public_profiles: { id: 'u1', slug: 'test', full_name: 'Ada Uwase', headline: 'Apprentice', sector_ids: ['mechanics'] },
    evidence: evidence({ id: 'e1', project_id: null, verifier_org_id: null, context_title: '', status: 'draft' }),
  };
}

export function profile() {
  if (state.noProfile) return null;
  const r = state.role;
  return { id: 'u1', role: r, full_name: 'Test User', email: 't@x.rw', org_id: r === 'student' ? null : 'org1', sector_ids: ['mechanics'], headline: '', public_profile: false, discoverable: false, slug: 'test-user', organizations: r === 'student' ? null : org(r) };
}

const rpcs = () => ({
  dashboard_stats: { role: state.role, unread: 1, evidence: { verified: 2, submitted: 1 }, applications: 1, results: 1, pipeline: state.role === 'student' ? 2 : { shortlisted: 2 }, open_projects: 1, open_internships: 1, to_review: 2, new_applications: 1, standards_due: 0, enrolment_requests: 1, students: 3, programmes: 1, standards_awaiting_response: 2, open_actions: 1, requirements: 1, ...(state.admin ? { admin: { pending_orgs: 1, verified_evidence: 5, outbox_pending: 0, users: { student: 4 } } } : {}) },
  competency_record: [{ competency_id: DIAG, name: 'Engine diagnostics', best_level: 4, evidence_count: 1, assessment_count: 1, last_at: now }],
  competency_demand: [{ competency_id: DIAG, name: 'Engine diagnostics', score: 6, essential: 1, standards: 1, avg_level: 3, employers: 1, projects: 1, internships: 1 }],
  competency_gap: [{ competency_id: DIAG, name: 'Engine diagnostics', score: 6, avg_level: 3, coverage: 2, courses: 1, status: 'partial' }, { competency_id: SAFETY, name: 'Workshop safety', score: 3, avg_level: 2, coverage: null, courses: 0, status: 'gap' }],
  outcome_summary: [{ programme_id: 'pr1', programme_name: 'Diploma in Automotive', graduates: 8, respondents: 6, employed: 4, further_study: 1, seeking: 1, directly: 3, partly: 1, unrelated: 0, avg_days_to_work: 46, suppressed: false }, { programme_id: 'pr2', programme_name: 'Small programme', graduates: 2, respondents: 1, suppressed: true }],
  feedback_preparedness: [{ responses: 6, ready: 2, mostly: 3, partly: 1, not_ready: 0, would_hire_again: 5, suppressed: false }],
  feedback_summary: [{ competency_id: DIAG, name: 'Engine diagnostics', responses: 6, avg_observed: 2, avg_expected: 3, shortfall: 1 }],
  my_requirement_progress: [{ requirement_id: 'rq1', title: 'Practical hours', sector_id: 'mechanics', regulator: 'Board', hours: 60, min_hours: 100, met_competencies: 1, total_competencies: 2, met: false }],
  regulator_compliance: [{ institution_org_id: 'org1', institution_name: 'College', students: 6, meeting: 2, avg_hours: 80 }],
  admin_list_admins: [{ admin_email: 'admin@example.com' }],
  admin_get_settings: [{ setting_key: 'outcomes_min_group', setting_value: '5' }, { setting_key: 'default_country_code', setting_value: '250' }, { setting_key: 'public_app_url', setting_value: 'https://muhirehubert.github.io/skillproof' }],
  admin_report_summary: { users_by_role: { student: 4, employer: 2 }, organisations_by_status: { pending: 1, approved: 2 }, sectors: { total: 2, active: 2 }, competencies: { total: 3, active: 3 }, evidence_by_status: { submitted: 1, verified: 2 }, projects: { total: 2, open: 1 }, internships: { total: 1, open: 1 }, verified_evidence: 2 },
  discover_talent: [{ student_id: 'u1', full_name: 'Ada Uwase', headline: 'Apprentice', slug: 'test', matched: 2, evidence_count: 3, best: { [DIAG]: 4, [SAFETY]: 3 }, in_pipeline: false }],
});

function builder(table) {
  const st = { single: false };
  const proxy = new Proxy(function () {}, {
    get(_, prop) {
      if (prop === 'then') {
        const value = st.single ? (singles()[table] ?? null) : (tables()[table] ?? []);
        return (res, rej) => Promise.resolve({ data: value, error: null }).then(res, rej);
      }
      if (prop === 'maybeSingle' || prop === 'single') return () => { st.single = true; return proxy; };
      return () => proxy;
    },
  });
  return proxy;
}

export const supabase = {
  from: (t) => builder(t),
  rpc: (name) => Promise.resolve({ data: rpcs()[name] ?? [], error: null }),
  channel: () => { const ch = { on: () => ch, subscribe: () => ch }; return ch; },
  removeChannel: async () => {},
  auth: {
    getSession: async () => ({ data: { session: state.signedOut ? null : { access_token: 't', user: { id: 'u1' } } } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signOut: async () => {}, signInWithPassword: async () => ({ error: null }), signUp: async () => ({ data: { session: null }, error: null }), resetPasswordForEmail: async () => ({ error: null }),
  },
  storage: { from: () => ({ createSignedUrls: async (paths) => ({ data: paths.map((p) => ({ path: p, signedUrl: 'https://x/' + p })) }), upload: async () => ({ error: null }), remove: async () => ({}) }) },
};
export const configured = true;
