import { useState } from 'react';
import { useAuth } from '../auth.jsx';
import { useCatalog } from '../catalog.jsx';
import { supabase } from '../lib/supabase.js';
import { useAsync, unwrap } from '../lib/hooks.js';
import { LEVELS, fmtDate } from '../lib/format.js';
import { Async, Button, Card, Chip, CheckChip, Empty, Field, Input, LevelLegend, LevelRow, LevelSelect, PageHeader, Panel, Select, SectorSelect, Textarea, useAction } from '../ui.jsx';

const KINDS = [
  { v: 'exam', n: 'Exam' }, { v: 'practical', n: 'Practical' }, { v: 'project', n: 'Project' },
  { v: 'oral', n: 'Oral' }, { v: 'portfolio_review', n: 'Portfolio review' }, { v: 'workplace_observation', n: 'Workplace observation' },
];

// Used by both institutions (course assessments) and employers (workplace assessments).
export default function AssessmentsManager() {
  const { profile, org, role } = useAuth();
  const { forSector, compName, sectorName } = useCatalog();
  const [run, busy] = useAction();
  const [f, setF] = useState({ title: '', kind: 'practical', sector: (org && org.sector_ids[0]) || '', description: '', course: '', targets: {} });

  const data = useAsync(async () => {
    const assessments = unwrap(await supabase.from('assessments')
      .select('*, assessment_competencies(competency_id, target_level), assessment_results(id, student_id, student_name, assessed_at, note, assessment_result_levels(competency_id, level))')
      .eq('owner_org_id', profile.org_id).order('created_at', { ascending: false }));
    let courses = [];
    let people = [];
    if (role === 'institution') {
      courses = unwrap(await supabase.from('courses').select('id, name, code, programmes!inner(institution_org_id)').eq('programmes.institution_org_id', profile.org_id));
      people = unwrap(await supabase.from('enrollments').select('student_id, student_name').in('status', ['confirmed', 'graduated']));
    } else {
      const [p, a] = await Promise.all([
        supabase.from('talent_pipeline').select('student_id, student_name').then(unwrap),
        supabase.from('internship_applications').select('student_id, student_name').in('status', ['accepted', 'completed']).then(unwrap),
      ]);
      people = [...p, ...a];
    }
    const seen = new Map(people.map((x) => [x.student_id, x.student_name]));
    return { assessments, courses, people: [...seen].map(([id, name]) => ({ v: id, n: name })) };
  }, [profile.org_id, role]);

  const chosen = Object.keys(f.targets);
  const toggle = (id, on) => {
    const t = { ...f.targets };
    if (on) t[id] = t[id] || 3; else delete t[id];
    setF({ ...f, targets: t });
  };

  const create = () => run(async () => {
    if (!f.title.trim() || !f.sector) throw new Error('Enter a title and choose a sector.');
    if (!chosen.length) throw new Error('Pick at least one competency this assessment measures.');
    const [a] = unwrap(await supabase.from('assessments').insert({
      owner_org_id: profile.org_id, sector_id: f.sector, title: f.title.trim(), description: f.description.trim(), kind: f.kind, course_id: f.course || null,
    }).select('id'));
    unwrap(await supabase.from('assessment_competencies').insert(chosen.map((c) => ({ assessment_id: a.id, competency_id: c, target_level: f.targets[c] }))));
    setF({ ...f, title: '', description: '', targets: {} });
    data.reload();
  }, 'Assessment created.');

  return (
    <>
      <PageHeader title="Assessments" sub={role === 'institution'
        ? 'Define assessments tied to courses and competencies, then record results. Results go straight into each student’s competency record.'
        : 'Assess candidates and interns against the competencies you care about. Results join their competency record.'} />
      <Panel title="Create an assessment">
        <div className="grid gap-x-4 sm:grid-cols-2">
          <Field label="Title"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
          <Field label="Kind"><Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} options={KINDS} /></Field>
          <Field label="Sector"><SectorSelect value={f.sector} onChange={(sector) => setF({ ...f, sector, targets: {} })} placeholder="Choose a sector" /></Field>
          {role === 'institution' && (
            <Field label="Course (optional)">
              <Select value={f.course} onChange={(e) => setF({ ...f, course: e.target.value })} placeholder="Not tied to a course"
                options={((data.data && data.data.courses) || []).map((c) => ({ v: c.id, n: (c.code ? c.code + ' ' : '') + c.name }))} />
            </Field>
          )}
        </div>
        <Field label="What is assessed"><Textarea rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <div className="mb-4">
          <span className="label">Competencies measured, with the target level</span>
          {forSector(f.sector).map((c) => (
            <div key={c.id} className="mb-1.5 flex flex-wrap items-center gap-3">
              <CheckChip checked={chosen.includes(c.id)} onChange={(on) => toggle(c.id, on)}>{c.name}</CheckChip>
              {chosen.includes(c.id) && <select aria-label={'Target level for ' + c.name} className="input w-44" value={f.targets[c.id]} onChange={(e) => setF({ ...f, targets: { ...f.targets, [c.id]: Number(e.target.value) } })}>{LEVELS.map((l) => <option key={l.v} value={l.v}>{l.v} {l.n}</option>)}</select>}
            </div>
          ))}
        </div>
        <Button variant="go" disabled={busy} onClick={create}>Create assessment</Button>
      </Panel>

      <Async state={data}>{(d) => !d.assessments.length ? <Empty>No assessments yet.</Empty> : d.assessments.map((a) => (
        <AssessmentCard key={a.id} a={a} people={d.people} sectorName={sectorName} compName={compName} onSaved={data.reload} />
      ))}</Async>
    </>
  );
}

function AssessmentCard({ a, people, sectorName, compName, onSaved }) {
  const [open, setOpen] = useState(false);
  const [student, setStudent] = useState('');
  const [levels, setLevels] = useState({});
  const [note, setNote] = useState('');
  const [run, busy] = useAction();

  const save = () => run(async () => {
    if (!student) throw new Error('Choose a student.');
    const out = {};
    for (const [k, v] of Object.entries(levels)) if (v) out[k] = v;
    if (!Object.keys(out).length) throw new Error('Record at least one competency level.');
    unwrap(await supabase.rpc('record_assessment_result', { p_assessment: a.id, p_student: student, p_levels: out, p_note: note }));
    setOpen(false); setStudent(''); setLevels({}); setNote('');
    onSaved();
  }, 'Result recorded. The student has been notified.');

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><h3>{a.title}</h3><p className="text-sm text-ink-soft">{KINDS.find((k) => k.v === a.kind)?.n}, {sectorName(a.sector_id)}</p></div>
        <Button small onClick={() => setOpen(!open)}>{open ? 'Close' : 'Record a result'}</Button>
      </div>
      {a.description && <p className="my-1">{a.description}</p>}
      <div className="flex flex-wrap gap-1.5">{a.assessment_competencies.map((c) => <Chip key={c.competency_id}>{compName(c.competency_id)}, target {c.target_level}</Chip>)}</div>
      {open && (
        <div className="mt-4 border-t border-line pt-4">
          <LevelLegend />
          <Field label="Student">
            <Select value={student} onChange={(e) => setStudent(e.target.value)} placeholder={people.length ? 'Choose a student' : 'No eligible students yet'} options={people} />
          </Field>
          {a.assessment_competencies.map((c) => (
            <div key={c.competency_id} className="mb-2 grid items-center gap-2 sm:grid-cols-[1fr_220px]">
              <span>{compName(c.competency_id)} <small className="text-ink-soft">(target {c.target_level})</small></span>
              <LevelSelect placeholder="Not assessed" value={levels[c.competency_id] || ''} onChange={(v) => setLevels({ ...levels, [c.competency_id]: v })} aria-label={'Level for ' + compName(c.competency_id)} />
            </div>
          ))}
          <Field label="Note"><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          <Button variant="go" disabled={busy} onClick={save}>Save result</Button>
        </div>
      )}
      {a.assessment_results.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-semibold">{a.assessment_results.length} result{a.assessment_results.length > 1 ? 's' : ''}</summary>
          {a.assessment_results.map((r) => (
            <div key={r.id} className="mt-2 rounded border border-line p-3">
              <p className="font-semibold">{r.student_name} <span className="font-normal text-ink-soft">{fmtDate(r.assessed_at)}</span></p>
              {r.assessment_result_levels.map((l) => <LevelRow key={l.competency_id} name={compName(l.competency_id)} level={l.level} />)}
              {r.note && <p className="mt-1 text-sm">{r.note}</p>}
            </div>
          ))}
        </details>
      )}
    </Card>
  );
}
