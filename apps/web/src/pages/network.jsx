import { useMemo, useState } from 'react';
import { PageHeader, Panel, Pill, Stat, Meter, Loading, Empty } from '../ui.jsx';
import { supabase } from '../lib/supabase.js';
import { useAsync, unwrap } from '../lib/hooks.js';
import { fmtDate } from '../lib/format.js';

const views = ['Overview', 'Standards', 'Alignment', 'Outcomes'];

export default function Network() {
  const [view, setView] = useState('Overview');
  const summary = useAsync(async () => unwrap(await supabase.rpc('network_sector_summary')), []);
  const standards = useAsync(async () => unwrap(await supabase.rpc('network_standard_summary')), []);
  const data = summary.data || [];
  const standardData = standards.data || [];
  const totals = useMemo(() => data.reduce((a, s) => ({
    employers: a.employers + Number(s.employers || 0),
    institutions: Math.max(a.institutions, Number(s.institutions || 0)),
    standards: a.standards + Number(s.standards || 0),
    graduates: a.graduates + Number(s.graduates || 0),
    employed: a.employed + Number(s.employed || 0),
  }), { employers: 0, institutions: 0, standards: 0, graduates: 0, employed: 0 }), [data]);

  if (summary.loading) return <Loading />;
  if (summary.error) return <Empty>Network data could not be loaded. Check that the Version 4 database migration has been applied.</Empty>;

  return <>
    <PageHeader title="Industry network" sub="One shared view of industry demand, university alignment, student evidence and employment outcomes." />
    <div className="mb-5 flex flex-wrap gap-1 border-b border-line">
      {views.map(v => <button key={v} className={`border-b-2 px-3 py-2 text-sm font-semibold ${view === v ? 'border-ok text-ink' : 'border-transparent text-ink-soft'}`} onClick={() => setView(v)}>{v}</button>)}
    </div>

    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Stat label="Industry standards" value={totals.standards} />
      <Stat label="Employers represented" value={totals.employers} />
      <Stat label="Graduates tracked" value={totals.graduates} />
      <Stat label="Confirmed employed" value={totals.employed} />
    </div>

    {view === 'Overview' && <div className="mt-6 grid gap-6 lg:grid-cols-[1.5fr_1fr]">
      <Panel title="Sector activity">
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead><tr className="border-b border-line text-left text-ink-soft"><th className="pb-2">Sector</th><th className="pb-2">Employers</th><th className="pb-2">Institutions</th><th className="pb-2">Standards</th><th className="pb-2">Projects</th><th className="pb-2">Internships</th></tr></thead>
          <tbody>{data.map(s => <tr key={s.sector_id} className="border-b border-[#EDF1F6]"><td className="py-3 font-semibold">{s.sector_name}</td><td>{s.employers}</td><td>{s.institutions}</td><td>{s.standards}</td><td>{s.open_projects}</td><td>{s.open_internships}</td></tr>)}</tbody>
        </table></div>
      </Panel>
      <Panel title="The operating loop">
        <div className="space-y-3 text-sm">
          {['Industry defines demand and standards','Universities map programmes to competencies','Students build evidence through projects, assessment and internships','Employers discover, assess and hire','Outcomes and feedback become curriculum improvement actions'].map((x,i) => <div key={x} className="flex gap-3"><span className="font-display font-bold text-ink-soft">0{i+1}</span><span>{x}</span></div>)}
        </div>
      </Panel>
    </div>}

    {view === 'Standards' && <Panel title="Published standards" className="mt-6">
      {standards.loading ? <Loading /> : <div className="overflow-x-auto"><table className="w-full text-sm">
        <thead><tr className="border-b border-line text-left text-ink-soft"><th className="pb-2">Sector</th><th className="pb-2">Role</th><th className="pb-2">Version</th><th className="pb-2">Review</th><th className="pb-2">Institutions adopting</th></tr></thead>
        <tbody>{standardData.map(s => <tr key={s.sector_id + s.role_title} className="border-b border-[#EDF1F6]"><td className="py-3">{s.sector_name}</td><td className="py-3 font-semibold">{s.role_title}</td><td>v{s.version}</td><td>{fmtDate(s.review_by)}</td><td><Pill tone={Number(s.mapped_institutions) ? 'ok' : 'plain'}>{s.mapped_institutions}</Pill></td></tr>)}</tbody>
      </table></div>}
    </Panel>}

    {view === 'Alignment' && <Panel title="Network alignment" className="mt-6">
      <p className="mb-5 text-sm text-ink-soft">This view is intentionally aggregate. Institution-level users see their detailed curriculum mappings in Skill gap and Programmes; the network sees only privacy-safe sector activity.</p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{data.map(s => {
        const activity = Math.min(100, Number(s.standards)*8 + Number(s.open_projects)*2 + Number(s.open_internships)*3);
        return <div key={s.sector_id} className="rounded border border-line p-4"><div className="mb-2 flex justify-between"><strong>{s.sector_name}</strong><span className="text-sm text-ink-soft">{activity}%</span></div><Meter level={Math.max(1, Math.min(4, Math.ceil(activity/25)))} /><p className="mt-3 text-xs text-ink-soft">Standards {s.standards} · projects {s.open_projects} · internships {s.open_internships}</p></div>
      })}</div>
    </Panel>}

    {view === 'Outcomes' && <Panel title="Employment outcomes" className="mt-6">
      <div className="overflow-x-auto"><table className="w-full text-sm">
        <thead><tr className="border-b border-line text-left text-ink-soft"><th className="pb-2">Sector</th><th className="pb-2">Graduates</th><th className="pb-2">Confirmed employed</th><th className="pb-2">Observed rate</th></tr></thead>
        <tbody>{data.map(s => { const rate = Number(s.graduates) ? Math.round(Number(s.employed)/Number(s.graduates)*100) : 0; return <tr key={s.sector_id} className="border-b border-[#EDF1F6]"><td className="py-3 font-semibold">{s.sector_name}</td><td>{s.graduates}</td><td>{s.employed}</td><td><div className="flex items-center gap-2"><Meter level={Math.max(1, Math.min(4, Math.ceil(rate/25)))} /><span>{rate}%</span></div></td></tr> })}</tbody>
      </table></div>
    </Panel>}
  </>;
}
