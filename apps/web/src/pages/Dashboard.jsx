import { Link } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { supabase } from '../lib/supabase.js';
import { useAsync, unwrap } from '../lib/hooks.js';
import { Async, Panel, Stat } from '../ui.jsx';
import { CompetencyRecord } from './shared.jsx';

const sum = (o) => Object.values(o || {}).reduce((a, b) => a + Number(b), 0);

const LOOP = {
  student: 'Learn, do real projects, get assessed and verified, and build the evidence profile employers can trust.',
  employer: 'Publish the standards you hire against, set real projects and internships, then discover, assess and hire from proven evidence.',
  institution: 'See what industry needs, map it to your courses, assess students, and improve the curriculum from graduate outcomes and employer feedback.',
  regulator: 'Publish licensing requirements and watch how institutions and students measure up.',
};

export default function Dashboard() {
  const { role, profile } = useAuth();
  const state = useAsync(async () => {
    const stats = unwrap(await supabase.rpc('dashboard_stats'));
    const record = role === 'student' ? unwrap(await supabase.rpc('competency_record', { p_student: profile.id })) : [];
    return { stats, record };
  }, [role]);

  return (
    <>
      <h2>Welcome, {profile.full_name}</h2>
      <p className="mb-6 mt-1 max-w-2xl text-ink-soft">{LOOP[role]}</p>
      <Async state={state}>
        {({ stats: s, record }) => (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {role === 'student' && <>
                <Stat label="Verified pieces of work" value={(s.evidence || {}).verified} to="/evidence" />
                <Stat label="Awaiting review" value={(s.evidence || {}).submitted} to="/evidence" />
                <Stat label="Active applications" value={s.applications} to="/internships" />
                <Stat label="Assessment results" value={s.results} to="/assessments" />
                <Stat label="Employers interested" value={s.pipeline} to="/journey" />
              </>}
              {role === 'employer' && <>
                <Stat label="Work to review" value={s.to_review} to="/review" tone="alert" />
                <Stat label="New applications" value={s.new_applications} to="/internships" tone="alert" />
                <Stat label="Standards due for review" value={s.standards_due} to="/standards" tone="alert" />
                <Stat label="Open projects" value={s.open_projects} to="/projects" />
                <Stat label="Open internships" value={s.open_internships} to="/internships" />
                <Stat label="Candidates in pipeline" value={sum(s.pipeline)} to="/talent" />
              </>}
              {role === 'institution' && <>
                <Stat label="Enrolment requests" value={s.enrolment_requests} to="/enrollments" tone="alert" />
                <Stat label="Standards awaiting your response" value={s.standards_awaiting_response} to="/standards" tone="alert" />
                <Stat label="Curriculum actions open" value={s.open_actions} to="/actions" />
                <Stat label="Enrolled students" value={s.students} to="/enrollments" />
                <Stat label="Programmes" value={s.programmes} to="/programmes" />
              </>}
              {role === 'regulator' && <Stat label="Requirements published" value={s.requirements} to="/requirements" />}
              {s.admin && <>
                <Stat label="Organisations pending approval" value={s.admin.pending_orgs} to="/admin" tone="alert" />
                <Stat label="Verified pieces of work (platform)" value={s.admin.verified_evidence} />
              </>}
            </div>
            {role === 'student' && (
              <Panel title="Your competency record" className="mt-8">
                <CompetencyRecord rows={record.slice(0, 8)} />
                <p className="mt-3 text-sm"><Link to="/profile">See everything and share your portfolio</Link></p>
              </Panel>
            )}
          </>
        )}
      </Async>
    </>
  );
}
