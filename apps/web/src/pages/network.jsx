import { PageHeader, Panel, Pill, Stat, Meter } from '../ui.jsx';
import { useCatalog } from '../catalog.jsx';

const sectors = [
  { name: 'Technology', demand: 86, coverage: 72, employers: 34, gaps: 6 },
  { name: 'Agriculture', demand: 74, coverage: 61, employers: 21, gaps: 8 },
  { name: 'Finance', demand: 69, coverage: 77, employers: 28, gaps: 4 },
  { name: 'Hospitality', demand: 63, coverage: 58, employers: 17, gaps: 7 },
];

const standards = [
  { role: 'Software Engineer', sector: 'Technology', version: '3', mapped: '84%', review: '14 Nov 2026', status: 'Current' },
  { role: 'Digital Marketing Officer', sector: 'Marketing', version: '2', mapped: '76%', review: '02 Dec 2026', status: 'Current' },
  { role: 'Agribusiness Officer', sector: 'Agriculture', version: '1', mapped: '61%', review: '18 Jan 2027', status: 'Review due' },
];

const actions = [
  ['Cloud and deployment', 'Software Engineering', 'Industry standard', 'In progress'],
  ['Data analysis', 'Economics', 'Employer feedback', 'Proposed'],
  ['Food safety and HACCP', 'Food & Beverage', 'Industry standard', 'In progress'],
];

export default function Network() {
  const { sectors: catalogSectors } = useCatalog();
  return (
    <>
      <PageHeader
        title="Industry network"
        sub="A shared view of standards, competencies, curriculum alignment and employment outcomes across participating institutions."
        action={<Pill tone="plain">{catalogSectors.length} sectors configured</Pill>}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Industry standards" value="48" />
        <Stat label="Universities connected" value="12" />
        <Stat label="Employers participating" value="186" />
        <Stat label="Graduate outcomes" value="8,420" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.45fr_1fr]">
        <Panel title="Sector alignment">
          <p className="mb-4 text-sm text-ink-soft">Demand shows reported employer need; coverage shows how well participating programmes currently address that demand.</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-line text-left text-ink-soft"><th className="pb-2 font-medium">Sector</th><th className="pb-2 font-medium">Demand</th><th className="pb-2 font-medium">Curriculum coverage</th><th className="pb-2 font-medium">Employers</th><th className="pb-2 font-medium">Open gaps</th></tr></thead>
              <tbody>
                {sectors.map((s) => (
                  <tr key={s.name} className="border-b border-[#EDF1F6]">
                    <td className="py-3 font-semibold">{s.name}</td>
                    <td className="py-3"><div className="flex items-center gap-2"><Meter level={Math.ceil(s.demand / 25)} /><span>{s.demand}%</span></div></td>
                    <td className="py-3">{s.coverage}%</td><td className="py-3">{s.employers}</td>
                    <td className="py-3"><Pill tone={s.gaps > 6 ? 'wait' : 'plain'}>{s.gaps}</Pill></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="How the network works">
          <ol className="space-y-3 text-sm">
            {[
              ['01', 'Industry sets the expectation', 'Employers and sector bodies maintain role standards and competency requirements.'],
              ['02', 'Universities map their programmes', 'Courses and assessments are connected to the same competency framework.'],
              ['03', 'Students build evidence', 'Projects, assessments and placements create a record of demonstrated capability.'],
              ['04', 'Outcomes close the loop', 'Hiring and employer feedback inform the next curriculum review.'],
            ].map(([n, title, body]) => (
              <li key={n} className="grid grid-cols-[34px_1fr] gap-3">
                <span className="font-display text-sm font-bold text-ink-soft">{n}</span>
                <div><strong>{title}</strong><p className="mt-0.5 text-ink-soft">{body}</p></div>
              </li>
            ))}
          </ol>
        </Panel>
      </div>

      <Panel title="Published industry standards" className="mt-6">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-line text-left text-ink-soft"><th className="pb-2 font-medium">Role</th><th className="pb-2 font-medium">Sector</th><th className="pb-2 font-medium">Version</th><th className="pb-2 font-medium">Curriculum mapped</th><th className="pb-2 font-medium">Review</th><th className="pb-2 font-medium">Status</th></tr></thead>
            <tbody>{standards.map((s) => <tr key={s.role} className="border-b border-[#EDF1F6]"><td className="py-3 font-semibold">{s.role}</td><td className="py-3">{s.sector}</td><td className="py-3">v{s.version}</td><td className="py-3">{s.mapped}</td><td className="py-3">{s.review}</td><td className="py-3"><Pill tone={s.status === 'Current' ? 'ok' : 'wait'}>{s.status}</Pill></td></tr>)}</tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Curriculum actions">
        <div className="space-y-2">{actions.map(([skill, programme, source, status]) => <div key={skill} className="grid gap-2 rounded border border-line p-3 sm:grid-cols-[1.2fr_1fr_1fr_auto] sm:items-center"><strong>{skill}</strong><span className="text-sm text-ink-soft">{programme}</span><span className="text-sm text-ink-soft">{source}</span><Pill tone={status === 'In progress' ? 'rev' : 'wait'}>{status}</Pill></div>)}</div>
      </Panel>
    </>
  );
}
