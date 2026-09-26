import { useState } from 'react';
import { useAuth } from '../auth.jsx';
import { useCatalog } from '../catalog.jsx';
import { api } from '../lib/api.js';
import { supabase } from '../lib/supabase.js';
import { useAsync, unwrap } from '../lib/hooks.js';
import { LEVELS, PREPAREDNESS, RESPONSE_STATUS, fmtDate, levelName } from '../lib/format.js';
import {
  Async, Button, Card, CheckChip, Chip, Empty, Field, Input, LevelSelect, Notice, PageHeader, Panel, Pill, Select, SectorSelect, Textarea, useAction,
} from '../ui.jsx';

const firstSector = (org, sectors) => (org && org.sector_ids && org.sector_ids[0]) || (sectors[0] && sectors[0].id) || '';

/* ------------------------------------------------ employer standards */
export function InstitutionStandards() {
  const { profile, org } = useAuth();
  const { sectorName, compName } = useCatalog();
  const [sector, setSector] = useState((org && org.sector_ids[0]) || '');
  const state = useAsync(async () => ({
    standards: unwrap(await supabase.from('standards').select('*, organizations(name), standard_competencies(competency_id, importance, level)').eq('status', 'published').order('created_at', { ascending: false })),
    mine: unwrap(await supabase.from('standard_responses').select('*').eq('institution_org_id', profile.org_id)),
    programmes: unwrap(await supabase.from('programmes').select('id, name').eq('institution_org_id', profile.org_id)),
  }), []);

  return (
    <>
      <PageHeader title="Employer standards" sub="What employers say a competent hire needs today. Record how your programmes respond so employers can see the loop close." />
      <div className="mb-4 max-w-xs"><Field label="Sector"><SectorSelect value={sector} onChange={setSector} placeholder="All sectors" /></Field></div>
      <Async state={state}>{({ standards, mine, programmes }) => {
        const shown = standards.filter((s) => !sector || s.sector_id === sector);
        if (!shown.length) return <Empty>No employer standards in this sector yet.</Empty>;
        return shown.map((s) => <StandardResponse key={s.id} s={s} existing={mine.find((m) => m.standard_id === s.id)} programmes={programmes} sectorName={sectorName} compName={compName} onSaved={state.reload} />);
      }}</Async>
    </>
  );
}

function StandardResponse({ s, existing, programmes, sectorName, compName, onSaved }) {
  const { profile } = useAuth();
  const [run, busy] = useAction();
  const [f, setF] = useState({ status: existing ? existing.status : 'planned', programme: existing && existing.programme_id ? existing.programme_id : '', note: existing ? existing.note : '' });
  const save = () => run(async () => {
    unwrap(await supabase.from('standard_responses').upsert({ standard_id: s.id, institution_org_id: profile.org_id, status: f.status, programme_id: f.programme || null, note: f.note.trim() }, { onConflict: 'standard_id,institution_org_id' }));
    onSaved();
  }, 'Response saved. The employer can see it.');
  const today = new Date().toISOString().slice(0, 10);
  return (
    <Card status={existing ? 'verified' : 'submitted'}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><h3>{s.role_title}</h3><p className="text-sm text-ink-soft">From <strong>{s.organizations ? s.organizations.name : 'an employer'}</strong>, {sectorName(s.sector_id)}, version {s.version}</p></div>
        {s.review_by < today ? <Pill tone="wait">Review overdue</Pill> : <Chip>Review by {fmtDate(s.review_by)}</Chip>}
      </div>
      <div className="my-2 flex flex-wrap gap-1.5">
        {[...s.standard_competencies].sort((a, b) => b.importance - a.importance).map((c) => <Chip key={c.competency_id} tone={c.importance === 3 ? 'strong' : c.importance === 2 ? 'mid' : undefined}>{compName(c.competency_id)}, level {c.level}</Chip>)}
      </div>
      <div className="mt-3 border-t border-line pt-3">
        <h4 className="mb-2">Your response</h4>
        <div className="grid gap-x-4 sm:grid-cols-2">
          <Field label="Status"><Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} options={RESPONSE_STATUS} /></Field>
          <Field label="Programme affected"><Select value={f.programme} onChange={(e) => setF({ ...f, programme: e.target.value })} placeholder="Not specific" options={programmes.map((p) => ({ v: p.id, n: p.name }))} /></Field>
        </div>
        <Field label="Note" hint="Which courses change, or why not."><Textarea rows={2} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        <Button small disabled={busy} onClick={save}>{existing ? 'Update response' : 'Save response'}</Button>
      </div>
    </Card>
  );
}

/* ----------------------------------------------------------- demand */
export function Demand() {
  const { org } = useAuth();
  const { sectors } = useCatalog();
  const [sector, setSector] = useState(firstSector(org, sectors));
  const state = useAsync(async () => (sector ? unwrap(await supabase.rpc('competency_demand', { p_sector: sector })) : []), [sector]);
  return (
    <>
      <PageHeader title="Skills demand" sub="What employers ask for in a sector, from the standards they publish and the projects and internships they post." />
      <div className="mb-4 max-w-xs"><Field label="Sector"><SectorSelect value={sector} onChange={setSector} /></Field></div>
      <Async state={state}>{(rows) => {
        if (!rows.length) return <Empty>No employer input for this sector yet. Ask employers to publish a standard.</Empty>;
        const max = rows[0].score || 1;
        return rows.map((r) => {
          const bits = [];
          if (r.standards) bits.push('Essential in ' + r.essential + ' of ' + r.standards + ' standards');
          if (r.avg_level) bits.push('expected level ' + levelName(Math.round(r.avg_level)));
          if (r.projects) bits.push(r.projects + (r.projects === 1 ? ' project' : ' projects'));
          if (r.internships) bits.push(r.internships + (r.internships === 1 ? ' internship' : ' internships'));
          return (
            <div key={r.competency_id} className="grid items-center gap-3 border-t border-[#EDF1F6] py-2.5 sm:grid-cols-[minmax(180px,1fr)_2fr]">
              <div><strong>{r.name}</strong><div className="text-xs text-ink-soft">{bits.join(', ')}{r.employers ? ', ' + r.employers + ' employer' + (r.employers > 1 ? 's' : '') : ''}</div></div>
              <div className="h-3 overflow-hidden rounded-sm bg-[#E6ECF4]"><div className="h-full bg-ink" style={{ width: Math.round((r.score / max) * 100) + '%' }} /></div>
            </div>
          );
        });
      }}</Async>
    </>
  );
}

/* -------------------------------------------------------------- gap */
export function Gap() {
  const { profile, org } = useAuth();
  const { sectors } = useCatalog();
  const [run, busy] = useAction();
  const [sector, setSector] = useState(firstSector(org, sectors));
  const state = useAsync(async () => (sector ? unwrap(await supabase.rpc('competency_gap', { p_sector: sector })) : []), [sector]);

  const act = (r) => run(async () => {
    unwrap(await supabase.from('curriculum_actions').insert({ institution_org_id: profile.org_id, competency_id: r.competency_id, source: 'skills_gap', title: 'Address ' + (r.status === 'gap' ? 'gap' : 'shortfall') + ': ' + r.name }));
  }, 'Added to your curriculum actions.');
  const tone = { gap: 'no', partial: 'wait', covered: 'ok' };

  return (
    <>
      <PageHeader title="Skill gap analysis" sub="Employer demand against what your courses cover. Map competencies to your courses under Programmes to see this fill in."
        action={<Button variant="ghost" small onClick={() => run(() => api.download('/api/reports/gap.csv?sector=' + encodeURIComponent(sector), 'skill-gap-' + sector + '.csv'))}>Download CSV</Button>} />
      <div className="mb-4 max-w-xs"><Field label="Sector"><SectorSelect value={sector} onChange={setSector} /></Field></div>
      <Async state={state}>{(rows) => !rows.length ? <Empty>No employer demand recorded for this sector yet.</Empty> : rows.map((r) => (
        <div key={r.competency_id} className="flex flex-wrap items-center justify-between gap-3 border-t border-[#EDF1F6] py-2.5">
          <div><strong>{r.name}</strong>
            <div className="text-xs text-ink-soft">Employers expect level {r.avg_level ? Math.round(r.avg_level) : 'not stated'}; your courses reach {r.coverage ? 'level ' + r.coverage + ' (' + r.courses + ' course' + (r.courses > 1 ? 's' : '') + ')' : 'nothing yet'}</div></div>
          <div className="flex items-center gap-2">
            <Pill tone={tone[r.status]}>{r.status === 'gap' ? 'Not covered' : r.status === 'partial' ? 'Below expected level' : 'Covered'}</Pill>
            {r.status !== 'covered' && <Button small variant="ghost" disabled={busy} onClick={() => act(r)}>Create action</Button>}
          </div>
        </div>
      ))}</Async>
    </>
  );
}

/* ------------------------------------------------------- programmes */
export function Programmes() {
  const { profile, org } = useAuth();
  const { sectors, sectorName } = useCatalog();
  const [run, busy] = useAction();
  const [f, setF] = useState({ name: '', sector: firstSector(org, sectors), level: '' });
  const state = useAsync(async () => unwrap(await supabase.from('programmes').select('*, courses(*, course_competencies(competency_id, coverage_level))').eq('institution_org_id', profile.org_id).order('created_at', { ascending: false })), []);
  const create = () => run(async () => {
    if (!f.name.trim() || !f.sector) throw new Error('Enter a programme name and choose its sector.');
    unwrap(await supabase.from('programmes').insert({ institution_org_id: profile.org_id, name: f.name.trim(), sector_id: f.sector, level: f.level.trim() }));
    setF({ ...f, name: '', level: '' }); state.reload();
  }, 'Programme created.');
  return (
    <>
      <PageHeader title="Programmes and curriculum" sub="Programmes, their courses, and the competencies each course develops. This is the curriculum side of the map that skill-gap analysis reads." />
      <Panel title="Add a programme">
        <div className="grid gap-x-4 sm:grid-cols-3">
          <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Diploma in Automotive Technology" /></Field>
          <Field label="Sector"><SectorSelect value={f.sector} onChange={(sector) => setF({ ...f, sector })} /></Field>
          <Field label="Level"><Input value={f.level} onChange={(e) => setF({ ...f, level: e.target.value })} placeholder="Diploma, degree, certificate" /></Field>
        </div>
        <Button disabled={busy} onClick={create}>Add programme</Button>
      </Panel>
      <Async state={state}>{(rows) => !rows.length ? <Empty>No programmes yet.</Empty> : rows.map((p) => <ProgrammeCard key={p.id} p={p} sectorName={sectorName} reload={state.reload} />)}</Async>
    </>
  );
}

function ProgrammeCard({ p, sectorName, reload }) {
  const { compName } = useCatalog();
  const [run, busy] = useAction();
  const [c, setC] = useState({ code: '', name: '', description: '' });
  const [mapping, setMapping] = useState(null);
  const add = () => run(async () => {
    if (!c.name.trim()) throw new Error('Enter the course name.');
    unwrap(await supabase.from('courses').insert({ programme_id: p.id, code: c.code.trim(), name: c.name.trim(), description: c.description.trim() }));
    setC({ code: '', name: '', description: '' }); reload();
  }, 'Course added.');
  return (
    <Card status="verified">
      <div className="flex flex-wrap items-start justify-between gap-2"><h3>{p.name}</h3><Chip>{sectorName(p.sector_id)}{p.level ? ', ' + p.level : ''}</Chip></div>
      {p.courses.map((co) => (
        <div key={co.id} className="mt-3 rounded border border-line p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <strong>{co.code ? co.code + ' ' : ''}{co.name}</strong>
            <Button small variant="ghost" onClick={() => setMapping(mapping === co.id ? null : co.id)}>{mapping === co.id ? 'Close' : 'Map competencies'}</Button>
          </div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {!co.course_competencies.length && <span className="text-sm text-ink-soft">No competencies mapped yet.</span>}
            {co.course_competencies.map((x) => <Chip key={x.competency_id}>{compName(x.competency_id)}, level {x.coverage_level}</Chip>)}
          </div>
          {mapping === co.id && <CourseMapper course={co} sectorId={p.sector_id} onSaved={() => { setMapping(null); reload(); }} />}
        </div>
      ))}
      <div className="mt-4 grid items-end gap-x-3 sm:grid-cols-[120px_1fr_auto]">
        <Field label="Code" className="mb-0"><Input value={c.code} onChange={(e) => setC({ ...c, code: e.target.value })} /></Field>
        <Field label="New course" className="mb-0"><Input value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} /></Field>
        <Button variant="ghost" disabled={busy} onClick={add}>Add course</Button>
      </div>
    </Card>
  );
}

function CourseMapper({ course, sectorId, onSaved }) {
  const { forSector, compName } = useCatalog();
  const [run, busy] = useAction();
  const [rows, setRows] = useState(() => Object.fromEntries(course.course_competencies.map((c) => [c.competency_id, c.coverage_level])));
  const [syllabus, setSyllabus] = useState(course.description || '');
  const chosen = Object.keys(rows);

  const suggest = () => run(async () => {
    const r = await api.post('/api/ai/map-course', { sectorId, courseName: course.name, syllabus });
    const next = { ...rows };
    r.competencies.forEach((c) => { next[c.competencyId] = c.coverageLevel; });
    setRows(next);
  }, 'Suggestions added. Check them, then save.');
  const save = () => run(async () => {
    unwrap(await supabase.from('course_competencies').delete().eq('course_id', course.id));
    if (chosen.length) unwrap(await supabase.from('course_competencies').insert(chosen.map((id) => ({ course_id: course.id, competency_id: id, coverage_level: rows[id] }))));
    if (syllabus.trim() !== (course.description || '')) unwrap(await supabase.from('courses').update({ description: syllabus.trim() }).eq('id', course.id));
    onSaved();
  }, 'Mapping saved.');

  return (
    <div className="mt-3 border-t border-line pt-3">
      <details className="mb-3 rounded border border-line p-3" open={Boolean(course.description)}>
        <summary className="cursor-pointer text-sm font-semibold">Syllabus and AI suggestions</summary>
        <Textarea rows={4} aria-label="Syllabus" className="mt-2" value={syllabus} onChange={(e) => setSyllabus(e.target.value)} placeholder="Paste the syllabus or learning outcomes" />
        <Button small className="mt-2" disabled={busy} onClick={suggest}>Suggest competencies</Button>
        <p className="mt-1 text-xs text-ink-soft">Suggestions are drafts. You decide what the course really teaches.</p>
      </details>
      <span className="label">Competencies this course develops, and the level it reaches</span>
      {forSector(sectorId).map((c) => (
        <div key={c.id} className="mb-1.5 flex flex-wrap items-center gap-3">
          <CheckChip checked={chosen.includes(c.id)} onChange={(on) => { const n = { ...rows }; if (on) n[c.id] = n[c.id] || 2; else delete n[c.id]; setRows(n); }}>{c.name}</CheckChip>
          {chosen.includes(c.id) && <select className="input w-44" aria-label={'Coverage of ' + c.name} value={rows[c.id]} onChange={(e) => setRows({ ...rows, [c.id]: Number(e.target.value) })}>{LEVELS.map((l) => <option key={l.v} value={l.v}>{l.v} {l.n}</option>)}</select>}
        </div>
      ))}
      {chosen.filter((id) => !forSector(sectorId).some((c) => c.id === id)).map((id) => <Chip key={id}>{compName(id)}</Chip>)}
      <Button className="mt-3" variant="go" disabled={busy} onClick={save}>Save mapping</Button>
    </div>
  );
}

/* ------------------------------------------------------- enrolments */
export function Enrolments() {
  const [run, busy] = useAction();
  const state = useAsync(async () => unwrap(await supabase.from('enrollments').select('*, programmes(name)').order('created_at', { ascending: false })), []);
  const set = (e, patch) => run(async () => { unwrap(await supabase.from('enrollments').update(patch).eq('id', e.id)); state.reload(); }, 'Updated.');
  return (
    <>
      <PageHeader title="Enrolments" sub="Confirm students so you can assess them and see (with their consent) how graduates fare." />
      <Async state={state}>{(rows) => {
        if (!rows.length) return <Empty>No enrolment requests yet. Students request enrolment from their Journey page.</Empty>;
        const groups = [['requested', 'Requests'], ['confirmed', 'Enrolled'], ['graduated', 'Graduated'], ['withdrawn', 'Withdrawn']];
        return groups.map(([status, title]) => {
          const list = rows.filter((r) => r.status === status);
          if (!list.length) return null;
          return (
            <div key={status} className="mb-6">
              <h3 className="mb-2">{title} ({list.length})</h3>
              {list.map((e) => (
                <Card key={e.id} status={status === 'requested' ? 'submitted' : status === 'withdrawn' ? 'declined' : 'verified'}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span><strong>{e.student_name}</strong>, {e.programmes ? e.programmes.name : ''} <span className="text-sm text-ink-soft">requested {fmtDate(e.created_at)}{e.graduated_on ? ', graduated ' + fmtDate(e.graduated_on) : ''}</span></span>
                    <div className="flex gap-2">
                      {status === 'requested' && <><Button small variant="go" disabled={busy} onClick={() => set(e, { status: 'confirmed' })}>Confirm</Button><Button small variant="danger" disabled={busy} onClick={() => set(e, { status: 'withdrawn' })}>Decline</Button></>}
                      {status === 'confirmed' && <><Button small disabled={busy} onClick={() => set(e, { status: 'graduated' })}>Mark graduated</Button><Button small variant="ghost" disabled={busy} onClick={() => set(e, { status: 'withdrawn' })}>Withdraw</Button></>}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          );
        });
      }}</Async>
    </>
  );
}

/* --------------------------------------------------------- outcomes */
export function Outcomes() {
  const { profile } = useAuth();
  const [run, busy] = useAction();
  const state = useAsync(async () => ({
    outcomes: unwrap(await supabase.rpc('outcome_summary', { p_programme: null })),
    prep: unwrap(await supabase.rpc('feedback_preparedness', { p_programme: null }))[0],
    shortfalls: unwrap(await supabase.rpc('feedback_summary', { p_programme: null })),
  }), []);
  const act = (r) => run(async () => {
    unwrap(await supabase.from('curriculum_actions').insert({ institution_org_id: profile.org_id, competency_id: r.competency_id, source: 'employer_feedback', title: 'Employers report a shortfall: ' + r.name }));
  }, 'Added to your curriculum actions.');
  const pct = (n, d) => (d ? Math.round((n / d) * 100) + '%' : '0%');

  return (
    <>
      <PageHeader title="Graduate outcomes and employer feedback" sub="Combined results only. Graduates choose whether to share, and any group smaller than the minimum size is hidden so no one can be identified."
        action={<div className="flex gap-2">
          <Button small variant="ghost" onClick={() => run(() => api.download('/api/reports/outcomes.csv', 'outcomes.csv'))}>Outcomes CSV</Button>
          <Button small variant="ghost" onClick={() => run(() => api.download('/api/reports/feedback.csv', 'feedback.csv'))}>Feedback CSV</Button>
        </div>} />
      <Async state={state}>{({ outcomes, prep, shortfalls }) => (
        <>
          <h3 className="mb-2">Outcomes by programme</h3>
          {!outcomes.length && <Empty>Add programmes and confirm students to start tracking outcomes.</Empty>}
          {outcomes.map((o) => (
            <Card key={o.programme_id} status={o.suppressed ? 'draft' : 'verified'}>
              <h3>{o.programme_name}</h3>
              <p className="text-sm text-ink-soft">{o.graduates} graduate{o.graduates === 1 ? '' : 's'}, {o.respondents} sharing outcomes</p>
              {o.suppressed ? <Notice tone="info">Too few graduates have shared outcomes to show results without identifying anyone. Results appear once enough have.</Notice> : (
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
                  <Metric label="In work" value={pct(o.employed, o.respondents)} />
                  <Metric label="Further study" value={pct(o.further_study, o.respondents)} />
                  <Metric label="Still looking" value={pct(o.seeking, o.respondents)} />
                  <Metric label="Job directly related" value={pct(o.directly, o.employed || 0)} />
                  <Metric label="Days to first job" value={o.avg_days_to_work === null ? 'n/a' : o.avg_days_to_work} />
                </div>
              )}
            </Card>
          ))}

          <h3 className="mb-2 mt-8">How well prepared were graduates?</h3>
          {!prep || prep.suppressed ? <Empty>Not enough employer feedback on consenting graduates yet.</Empty> : (
            <Card status="verified">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                {PREPAREDNESS.map((p) => <Metric key={p.v} label={p.n} value={pct(prep[p.v === 'not_ready' ? 'not_ready' : p.v], prep.responses)} />)}
                <Metric label="Would hire again" value={pct(prep.would_hire_again, prep.responses)} />
              </div>
              <p className="mt-2 text-xs text-ink-soft">{prep.responses} employer responses</p>
            </Card>
          )}

          <h3 className="mb-2 mt-8">Where employers found shortfalls</h3>
          {!shortfalls.length ? <Empty>No competency has enough feedback to show yet.</Empty> : shortfalls.map((r) => (
            <div key={r.competency_id} className="flex flex-wrap items-center justify-between gap-3 border-t border-[#EDF1F6] py-2.5">
              <div><strong>{r.name}</strong><div className="text-xs text-ink-soft">Employers expected {r.avg_expected ?? 'n/a'}, observed {r.avg_observed}, from {r.responses} responses</div></div>
              <div className="flex items-center gap-2">
                <Pill tone={Number(r.shortfall) > 0.5 ? 'no' : Number(r.shortfall) > 0 ? 'wait' : 'ok'}>{Number(r.shortfall) > 0 ? 'Shortfall ' + Number(r.shortfall).toFixed(1) : 'Meets expectations'}</Pill>
                {Number(r.shortfall) > 0 && <Button small variant="ghost" disabled={busy} onClick={() => act(r)}>Create action</Button>}
              </div>
            </div>
          ))}
        </>
      )}</Async>
    </>
  );
}
const Metric = ({ label, value }) => <div className="rounded border border-line p-3"><div className="font-display text-2xl font-extrabold">{value}</div><div className="text-xs text-ink-soft">{label}</div></div>;

/* ---------------------------------------------------------- actions */
const ACTION_STATUS = [{ v: 'proposed', n: 'Proposed' }, { v: 'in_progress', n: 'In progress' }, { v: 'done', n: 'Done' }, { v: 'declined', n: 'Declined' }];
const SOURCES = { skills_gap: 'Skills gap', employer_feedback: 'Employer feedback', standard: 'Industry standard', regulator: 'Regulator', other: 'Other' };

export function Actions() {
  const { profile } = useAuth();
  const { compName } = useCatalog();
  const [run, busy] = useAction();
  const [f, setF] = useState({ title: '', source: 'standard', note: '', programme: '' });
  const state = useAsync(async () => ({
    actions: unwrap(await supabase.from('curriculum_actions').select('*, programmes(name)').eq('institution_org_id', profile.org_id).order('created_at', { ascending: false })),
    programmes: unwrap(await supabase.from('programmes').select('id, name').eq('institution_org_id', profile.org_id)),
  }), []);
  const add = () => run(async () => {
    if (!f.title.trim()) throw new Error('Describe the change.');
    unwrap(await supabase.from('curriculum_actions').insert({ institution_org_id: profile.org_id, title: f.title.trim(), source: f.source, note: f.note.trim(), programme_id: f.programme || null }));
    setF({ ...f, title: '', note: '' }); state.reload();
  }, 'Action added.');
  const patch = (a, p) => run(async () => { unwrap(await supabase.from('curriculum_actions').update(p).eq('id', a.id)); state.reload(); });

  return (
    <>
      <PageHeader title="Curriculum actions" sub="The end of the loop: what you are changing because of employer standards, skill gaps, graduate outcomes and feedback." />
      <Panel title="Add an action">
        <div className="grid gap-x-4 sm:grid-cols-3">
          <Field label="Change" className="sm:col-span-2"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Add a brake systems lab to Year 2" /></Field>
          <Field label="Source"><Select value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} options={Object.entries(SOURCES).map(([v, n]) => ({ v, n }))} /></Field>
        </div>
        <Field label="Note"><Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        <Button disabled={busy} onClick={add}>Add action</Button>
      </Panel>
      <Async state={state}>{({ actions }) => !actions.length ? <Empty>No actions yet. Create them from the skill gap and outcomes screens, or add your own above.</Empty> : actions.map((a) => (
        <Card key={a.id} status={a.status === 'done' ? 'verified' : a.status === 'declined' ? 'declined' : 'submitted'}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div><h3>{a.title}</h3><p className="text-sm text-ink-soft">{SOURCES[a.source]}{a.competency_id ? ', ' + compName(a.competency_id) : ''}{a.programmes ? ', ' + a.programmes.name : ''}, {fmtDate(a.created_at)}</p></div>
            <select className="input w-40" aria-label={'Status of ' + a.title} value={a.status} disabled={busy} onChange={(e) => patch(a, { status: e.target.value })}>{ACTION_STATUS.map((s) => <option key={s.v} value={s.v}>{s.n}</option>)}</select>
          </div>
          {a.note && <p className="mt-1 text-sm">{a.note}</p>}
        </Card>
      ))}</Async>
    </>
  );
}
