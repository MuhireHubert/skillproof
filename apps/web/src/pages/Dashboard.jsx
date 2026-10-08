import { Link } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { supabase } from '../lib/supabase.js';
import { useAsync, unwrap } from '../lib/hooks.js';
import { Async, Button, Card, Empty, Panel, Stat } from '../ui.jsx';
import { CompetencyRecord } from './shared.jsx';

const roleCopy = {
  student: ['Student workspace', 'Build evidence, complete assessments, apply for internships and keep your verified record current.'],
  employer: ['Employer workspace', 'Define the skills you hire for, create real work, review evidence, discover candidates and record employment outcomes.'],
  institution: ['Institution workspace', 'Connect industry demand to programmes, assess students, track outcomes and turn evidence into curriculum actions.'],
  regulator: ['Regulatory workspace', 'Publish requirements and monitor institution compliance using the same competency and outcome records.'],
};

const actions = {
  student: [
    ['/projects', 'Find real projects', 'Complete employer-set work and submit evidence.'],
    ['/internships', 'Apply for internships', 'Find placements and manage your applications.'],
    ['/evidence', 'Build evidence', 'Log work you have done and request verification.'],
    ['/assessments', 'View assessments', 'See assessed competencies and results.'],
  ],
  employer: [
    ['/standards', 'Define a hiring standard', 'Set the competencies and levels required for a role.'],
    ['/projects', 'Publish real work', 'Give students practical work that can become verified evidence.'],
    ['/talent', 'Discover talent', 'Search opted-in candidates using verified competency levels.'],
    ['/review', 'Review submissions', 'Rate evidence and verify what students actually demonstrated.'],
  ],
  institution: [
    ['/standards', 'Respond to industry', 'Map employer standards to your programmes.'],
    ['/programmes', 'Build the curriculum map', 'Create programmes, courses and competency coverage.'],
    ['/gap', 'Find skill gaps', 'Compare employer demand with curriculum coverage.'],
    ['/actions', 'Run curriculum actions', 'Turn evidence into tracked curriculum changes.'],
  ],
  regulator: [
    ['/requirements', 'Publish requirements', 'Define requirements institutions need to meet.'],
    ['/compliance', 'Review compliance', 'Monitor progress against published requirements.'],
    ['/network', 'Network view', 'See privacy-safe sector activity across the platform.'],
  ],
};

function sum(obj) { return Object.values(obj || {}).reduce((a, b) => a + Number(b || 0), 0); }

export default function Dashboard() {
  const { role, profile, org, isAdmin } = useAuth();
  const state = useAsync(async () => {
    const stats = unwrap(await supabase.rpc('dashboard_stats'));
    const record = role === 'student'
      ? unwrap(await supabase.rpc('competency_record', { p_student: profile.id }))
      : [];
    return { stats, record };
  }, [role, profile.id]);

  const [title, subtitle] = roleCopy[role] || ['Workspace', ''];
  const quick = actions[role] || [];

  return (
    <>
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-1 text-xs font-bold uppercase tracking-[0.16em] text-ink-soft">SkillProof</p>
          <h1>{title}</h1>
          <p className="mt-1 max-w-3xl text-ink-soft">{subtitle}</p>
        </div>
        <div className="text-sm text-ink-soft">{org ? org.name : 'Personal account'}</div>
      </div>

      <Async state={state}>
        {({ stats, record }) => (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {role === 'student' && <>
                <Stat label="Verified work" value={stats.evidence?.verified || 0} to="/evidence" />
                <Stat label="Awaiting review" value={stats.evidence?.submitted || 0} to="/evidence" />
                <Stat label="Applications" value={stats.applications || 0} to="/internships" />
                <Stat label="Assessment results" value={stats.results || 0} to="/assessments" />
              </>}
              {role === 'employer' && <>
                <Stat label="Work to review" value={stats.to_review || 0} to="/review" tone="alert" />
                <Stat label="New applications" value={stats.new_applications || 0} to="/internships" tone="alert" />
                <Stat label="Open projects" value={stats.open_projects || 0} to="/projects" />
                <Stat label="Candidates" value={sum(stats.pipeline)} to="/talent" />
              </>}
              {role === 'institution' && <>
                <Stat label="Enrolment requests" value={stats.enrolment_requests || 0} to="/enrollments" tone="alert" />
                <Stat label="Standards awaiting response" value={stats.standards_awaiting_response || 0} to="/standards" tone="alert" />
                <Stat label="Open curriculum actions" value={stats.open_actions || 0} to="/actions" />
                <Stat label="Programmes" value={stats.programmes || 0} to="/programmes" />
              </>}
              {role === 'regulator' && <Stat label="Published requirements" value={stats.requirements || 0} to="/requirements" />}
              {isAdmin && <Stat label="Organisations awaiting approval" value={stats.admin?.pending_orgs || 0} to="/admin" tone="alert" />}
            </div>

            <Panel title="Do next" className="mt-8">
              <div className="grid gap-3 md:grid-cols-2">
                {quick.map(([to, label, desc]) => (
                  <Card key={to}>
                    <h3>{label}</h3>
                    <p className="my-2 text-sm text-ink-soft">{desc}</p>
                    <Link to={to}><Button small>Open</Button></Link>
                  </Card>
                ))}
              </div>
            </Panel>

            {role === 'student' && (
              <Panel title="Verified competency record" className="mt-8">
                {record.length ? <CompetencyRecord rows={record.slice(0, 10)} /> : <Empty>Your competency record will appear as soon as assessed or verified work is recorded.</Empty>}
                <p className="mt-3 text-sm"><Link to="/profile">Open your full profile and portfolio</Link></p>
              </Panel>
            )}

            {role === 'employer' && (
              <Panel title="The operating loop" className="mt-8">
                <div className="grid gap-3 md:grid-cols-5">
                  {['Standards', 'Real work', 'Assessment', 'Evidence', 'Hiring'].map((x, i) => (
                    <div key={x} className="rounded border border-line p-3">
                      <div className="mb-1 text-xs font-bold text-ink-soft">0{i + 1}</div>
                      <strong>{x}</strong>
                      <p className="mt-1 text-xs text-ink-soft">{[
                        'Define what good looks like.',
                        'Create projects and placements.',
                        'Measure candidates against competencies.',
                        'Verify demonstrated ability.',
                        'Move proven people into employment.',
                      ][i]}</p>
                    </div>
                  ))}
                </div>
              </Panel>
            )}
          </>
        )}
      </Async>
    </>
  );
}
