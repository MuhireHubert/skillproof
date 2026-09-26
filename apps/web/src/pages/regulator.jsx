import { useState } from 'react';
import { useAuth } from '../auth.jsx';
import { useCatalog } from '../catalog.jsx';
import { api } from '../lib/api.js';
import { supabase } from '../lib/supabase.js';
import { useAsync, unwrap } from '../lib/hooks.js';
import { Async, Button, Card, Chip, CompetencyChecks, Empty, Field, Input, LevelSelect, PageHeader, Panel, Select, SectorSelect, Textarea, useAction } from '../ui.jsx';

export function Requirements() {
  const { profile } = useAuth();
  const { sectorName, compName } = useCatalog();
  const [run, busy] = useAction();
  const [f, setF] = useState({ sector: '', title: '', description: '', hours: 0, level: 3, comps: [] });
  const list = useAsync(async () => unwrap(await supabase.from('requirements').select('*, requirement_competencies(competency_id)').order('created_at', { ascending: false })), []);

  const save = () => run(async () => {
    if (!f.sector || !f.title.trim()) throw new Error('Choose a sector and enter a title.');
    if (!f.comps.length) throw new Error('Pick at least one competency.');
    const [r] = unwrap(await supabase.from('requirements').insert({ sector_id: f.sector, title: f.title.trim(), description: f.description.trim(), min_hours: Number(f.hours) || 0, min_level: Number(f.level) || 3, regulator_org_id: profile.org_id }).select('id'));
    unwrap(await supabase.from('requirement_competencies').insert(f.comps.map((c) => ({ requirement_id: r.id, competency_id: c }))));
    setF({ ...f, title: '', description: '', comps: [] });
    list.reload();
  }, 'Requirement published.');

  return (
    <>
      <PageHeader title="Requirements" sub="Licensing or accreditation requirements: supervised hours plus competencies at a minimum level. Students see their progress; you see institution-level compliance." />
      <Panel title="Publish a requirement">
        <div className="grid gap-x-4 sm:grid-cols-2">
          <Field label="Title"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Practical hours for licensing" /></Field>
          <Field label="Sector"><SectorSelect value={f.sector} onChange={(sector) => setF({ ...f, sector, comps: [] })} placeholder="Choose a sector" /></Field>
          <Field label="Minimum verified hours"><Input type="number" min="0" value={f.hours} onChange={(e) => setF({ ...f, hours: e.target.value })} /></Field>
          <Field label="Minimum level for each competency"><LevelSelect value={f.level} onChange={(level) => setF({ ...f, level })} /></Field>
        </div>
        <Field label="Description"><Textarea rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <div className="mb-4"><span className="label">Required competencies</span><CompetencyChecks sectorId={f.sector} value={f.comps} onChange={(comps) => setF({ ...f, comps })} /></div>
        <Button variant="go" disabled={busy} onClick={save}>Publish requirement</Button>
      </Panel>
      <Async state={list}>{(rows) => !rows.length ? <Empty>No requirements yet.</Empty> : rows.map((r) => (
        <Card key={r.id} status="verified">
          <h3>{r.title}</h3>
          <p className="text-sm text-ink-soft">{sectorName(r.sector_id)}, at least {Number(r.min_hours)} verified hours, level {r.min_level} or higher</p>
          {r.description && <p className="my-1">{r.description}</p>}
          <div className="mt-2 flex flex-wrap gap-1.5">{r.requirement_competencies.map((c) => <Chip key={c.competency_id}>{compName(c.competency_id)}</Chip>)}</div>
        </Card>
      ))}</Async>
    </>
  );
}

export function Compliance() {
  const reqs = useAsync(async () => unwrap(await supabase.from('requirements').select('id, title, sector_id').order('title')), []);
  const [id, setId] = useState('');
  const [run] = useAction();
  const rows = useAsync(async () => (id ? unwrap(await supabase.rpc('regulator_compliance', { p_requirement: id })) : []), [id]);

  return (
    <>
      <PageHeader title="Compliance" sub="How many enrolled students at each institution currently meet a requirement, based on verified hours, verified work and assessments." />
      <Async state={reqs}>{(list) => (
        <div className="max-w-md"><Field label="Requirement"><Select value={id} onChange={(e) => setId(e.target.value)} placeholder="Choose a requirement" options={list.map((r) => ({ v: r.id, n: r.title }))} /></Field></div>
      )}</Async>
      {id && <Button variant="ghost" small className="mb-4" onClick={() => run(() => api.download('/api/reports/compliance.csv?requirement=' + id, 'compliance.csv'))}>Download CSV</Button>}
      {id && <Async state={rows}>{(list) => !list.length ? <Empty>No enrolled students in matching programmes yet.</Empty> : list.map((r) => {
        const pct = r.students ? Math.round((r.meeting / r.students) * 100) : 0;
        return (
          <Card key={r.institution_org_id} status={pct >= 80 ? 'verified' : pct >= 40 ? 'submitted' : 'declined'}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3>{r.institution_name}</h3>
              <span className="text-sm text-ink-soft">{r.meeting} of {r.students} students meet it ({pct}%), average {Number(r.avg_hours || 0)} verified hours</span>
            </div>
            <div className="mt-2 h-3 overflow-hidden rounded-sm bg-[#E6ECF4]"><div className="h-full bg-ink" style={{ width: pct + '%' }} /></div>
          </Card>
        );
      })}</Async>}
    </>
  );
}
