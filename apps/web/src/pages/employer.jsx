import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { useCatalog } from '../catalog.jsx';
import { api } from '../lib/api.js';
import { supabase } from '../lib/supabase.js';
import { useAsync, unwrap } from '../lib/hooks.js';
import { IMPORTANCE, LEVELS, PIPELINE_STAGES, PREPAREDNESS, RESPONSE_STATUS, fmtDate, isHttpUrl, isoInDays } from '../lib/format.js';
import {
  Async, Button, Card, CheckChip, Chip, CompetencyChecks, Empty, Field, Input, LevelLegend, LevelRow, LevelSelect, Notice,
  PageHeader, Panel, Pill, Select, SectorSelect, StatusPill, Textarea, VerifiedStamp, useAction,
} from '../ui.jsx';
import { AssuranceBadge, MediaGrid, RatingsBlock } from './shared.jsx';

const firstSector = (org, sectors) => (org && org.sector_ids && org.sector_ids[0]) || (sectors[0] && sectors[0].id) || '';

/* ------------------------------------------------------------ standards */
export function EmployerStandards() {
  const { profile, org } = useAuth();
  const { sectors, forSector, sectorName, compName } = useCatalog();
  const [run, busy] = useAction();
  const [f, setF] = useState({ role: '', sector: firstSector(org, sectors), reviewBy: isoInDays(180), rows: {}, jobPost: '' });
  const list = useAsync(async () => unwrap(await supabase.from('standards')
    .select('*, standard_competencies(competency_id, importance, level), standard_responses(status, note, organizations(name))')
    .eq('employer_org_id', profile.org_id).neq('status', 'retired').order('created_at', { ascending: false })), []);

  const setRow = (id, patch) => setF({ ...f, rows: { ...f.rows, [id]: { on: false, importance: 2, level: 3, ...f.rows[id], ...patch } } });

  const draft = () => run(async () => {
    if (f.jobPost.trim().length < 20) throw new Error('Paste a job description (at least a couple of sentences).');
    const r = await api.post('/api/ai/draft-standard', { sectorId: f.sector, jobPost: f.jobPost });
    const rows = {};
    r.competencies.forEach((c) => { rows[c.competencyId] = { on: true, importance: c.importance, level: c.level }; });
    setF({ ...f, role: f.role || r.roleTitle || '', rows });
  }, 'Drafted. Review the suggestions before publishing.');

  const publish = () => run(async () => {
    const picked = Object.entries(f.rows).filter(([, v]) => v.on);
    if (!f.role.trim()) throw new Error('Enter the role this standard describes.');
    if (!picked.length) throw new Error('Tick at least one competency.');
    const [s] = unwrap(await supabase.from('standards').insert({ employer_org_id: profile.org_id, sector_id: f.sector, role_title: f.role.trim(), review_by: f.reviewBy }).select('id'));
    unwrap(await supabase.from('standard_competencies').insert(picked.map(([id, v]) => ({ standard_id: s.id, competency_id: id, importance: v.importance, level: v.level }))));
    setF({ ...f, role: '', rows: {}, jobPost: '' });
    list.reload();
  }, 'Standard published.');

  const confirm = (s) => run(async () => {
    unwrap(await supabase.from('standards').update({ review_by: isoInDays(180), last_confirmed_at: new Date().toISOString(), version: s.version + 1 }).eq('id', s.id));
    list.reload();
  }, 'Confirmed for another six months.');
  const retire = (s) => run(async () => {
    if (!window.confirm('Retire this standard?')) return false;
    unwrap(await supabase.from('standards').update({ status: 'retired' }).eq('id', s.id));
    list.reload();
  });
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <PageHeader title="Industry standards" sub="Tell institutions what a competent hire looks like today. They respond with how they'll teach it. Confirm each standard regularly so it stays current." />
      <Panel title="Publish a standard">
        <div className="grid gap-x-4 sm:grid-cols-3">
          <Field label="Role"><Input value={f.role} maxLength={100} onChange={(e) => setF({ ...f, role: e.target.value })} placeholder="e.g. Junior mechanic" /></Field>
          <Field label="Sector"><SectorSelect value={f.sector} onChange={(sector) => setF({ ...f, sector, rows: {} })} /></Field>
          <Field label="Review by" hint="When you'll confirm it's still current."><Input type="date" value={f.reviewBy} onChange={(e) => setF({ ...f, reviewBy: e.target.value })} /></Field>
        </div>
        <details className="mb-4 rounded border border-line p-3">
          <summary className="cursor-pointer text-sm font-semibold">Draft from a job description (AI)</summary>
          <p className="my-2 text-xs text-ink-soft">The suggestions only use this sector's competencies and are always yours to edit.</p>
          <Textarea rows={5} aria-label="Job description" value={f.jobPost} onChange={(e) => setF({ ...f, jobPost: e.target.value })} placeholder="Paste a job advert or role description" />
          <Button small className="mt-2" disabled={busy} onClick={draft}>Suggest competencies</Button>
        </details>
        <span className="label">Competencies, how important, and the level expected on day one</span>
        <div className="mb-4">
          {forSector(f.sector).map((c) => {
            const r = f.rows[c.id] || { on: false, importance: 2, level: 3 };
            return (
              <div key={c.id} className="grid items-center gap-2 border-t border-[#EDF1F6] py-1.5 sm:grid-cols-[minmax(200px,1fr)_160px_160px]">
                <CheckChip checked={r.on} onChange={(on) => setRow(c.id, { on })}>{c.name}</CheckChip>
                <Select aria-label={'Importance of ' + c.name} value={r.importance} onChange={(e) => setRow(c.id, { importance: Number(e.target.value) })} options={IMPORTANCE} />
                <LevelSelect aria-label={'Level for ' + c.name} value={r.level} onChange={(level) => setRow(c.id, { level: level || 3 })} />
              </div>
            );
          })}
        </div>
        <Button variant="go" disabled={busy} onClick={publish}>Publish standard</Button>
      </Panel>

      <h3 className="mb-2">Your standards</h3>
      <Async state={list}>{(rows) => !rows.length ? <Empty>No standards yet. Publish your first one above.</Empty> : rows.map((s) => {
        const due = s.review_by <= today;
        return (
          <Card key={s.id} status={due ? 'submitted' : 'verified'}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div><h3>{s.role_title}</h3><p className="text-sm text-ink-soft">{sectorName(s.sector_id)}, version {s.version}</p></div>
              {due ? <Pill tone="wait">Review due</Pill> : <Chip>Review by {fmtDate(s.review_by)}</Chip>}
            </div>
            <div className="my-2 flex flex-wrap gap-1.5">
              {[...s.standard_competencies].sort((a, b) => b.importance - a.importance).map((c) => (
                <Chip key={c.competency_id} tone={c.importance === 3 ? 'strong' : c.importance === 2 ? 'mid' : undefined}>{compName(c.competency_id)}, level {c.level}</Chip>
              ))}
            </div>
            <h4 className="mb-1 mt-3 text-sm">Institution responses</h4>
            {!s.standard_responses.length && <p className="text-sm text-ink-soft">No institution has responded yet.</p>}
            {s.standard_responses.map((r, i) => (
              <p key={i} className="text-sm"><strong>{r.organizations ? r.organizations.name : 'An institution'}: {RESPONSE_STATUS.find((x) => x.v === r.status)?.n}. </strong>{r.note}</p>
            ))}
            <div className="mt-3 flex gap-2">
              <Button small variant="ghost" disabled={busy} onClick={() => confirm(s)}>Confirm still current</Button>
              <Button small variant="danger" disabled={busy} onClick={() => retire(s)}>Retire</Button>
            </div>
          </Card>
        );
      })}</Async>
    </>
  );
}

/* ------------------------------------------------------------- projects */
export function EmployerProjects() {
  const { profile, org } = useAuth();
  const { sectors, sectorName, compName } = useCatalog();
  const [run, busy] = useAction();
  const blank = { title: '', sector: firstSector(org, sectors), kind: 'project', hours: '', description: '', comps: [] };
  const [f, setF] = useState(blank);
  const list = useAsync(async () => unwrap(await supabase.from('projects').select('*, project_competencies(competency_id)').eq('employer_org_id', profile.org_id).order('created_at', { ascending: false })), []);

  const publish = () => run(async () => {
    if (!f.title.trim() || !f.description.trim()) throw new Error('Add a title and a description.');
    if (!f.comps.length) throw new Error('Pick at least one competency.');
    const [p] = unwrap(await supabase.from('projects').insert({ employer_org_id: profile.org_id, sector_id: f.sector, title: f.title.trim(), description: f.description.trim(), kind: f.kind, hours_estimate: f.hours ? Number(f.hours) : null }).select('id'));
    unwrap(await supabase.from('project_competencies').insert(f.comps.map((c) => ({ project_id: p.id, competency_id: c }))));
    setF({ ...blank, sector: f.sector });
    list.reload();
  }, 'Project published.');
  const toggle = (p) => run(async () => { unwrap(await supabase.from('projects').update({ status: p.status === 'open' ? 'closed' : 'open' }).eq('id', p.id)); list.reload(); });

  return (
    <>
      <PageHeader title="Projects" sub="Post real work for students. When they submit it, you review and verify what they showed." />
      <Panel title="Post a project">
        <div className="grid gap-x-4 sm:grid-cols-2">
          <Field label="Title"><Input maxLength={120} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Brake service on a Hilux" /></Field>
          <Field label="Sector"><SectorSelect value={f.sector} onChange={(sector) => setF({ ...f, sector, comps: [] })} /></Field>
          <Field label="Kind"><Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} options={[{ v: 'project', n: 'Project' }, { v: 'challenge', n: 'Challenge' }]} /></Field>
          <Field label="Estimated hours"><Input type="number" min="0" value={f.hours} onChange={(e) => setF({ ...f, hours: e.target.value })} /></Field>
        </div>
        <Field label="Description" hint="What needs doing and what a good result looks like."><Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <div className="mb-4"><span className="label">Competencies this work demands</span><CompetencyChecks sectorId={f.sector} value={f.comps} onChange={(comps) => setF({ ...f, comps })} /></div>
        <Button variant="go" disabled={busy} onClick={publish}>Publish project</Button>
      </Panel>
      <h3 className="mb-2">Your projects</h3>
      <Async state={list}>{(rows) => !rows.length ? <Empty>Nothing posted yet.</Empty> : rows.map((p) => (
        <Card key={p.id} status={p.status === 'open' ? 'verified' : 'draft'}>
          <div className="flex flex-wrap items-start justify-between gap-2"><h3>{p.title}</h3><Pill tone={p.status === 'open' ? 'ok' : 'plain'}>{p.status}</Pill></div>
          <p className="text-sm text-ink-soft">{sectorName(p.sector_id)}, {p.kind}, posted {fmtDate(p.created_at)}</p>
          <p className="my-2 whitespace-pre-wrap">{p.description}</p>
          <div className="mb-3 flex flex-wrap gap-1.5">{p.project_competencies.map((c) => <Chip key={c.competency_id}>{compName(c.competency_id)}</Chip>)}</div>
          <Button small variant="ghost" disabled={busy} onClick={() => toggle(p)}>{p.status === 'open' ? 'Close' : 'Reopen'}</Button>
        </Card>
      ))}</Async>
    </>
  );
}

/* ---------------------------------------------------------- internships */
export function EmployerInternships() {
  const { profile, org } = useAuth();
  const { sectors, sectorName, compName } = useCatalog();
  const [run, busy] = useAction();
  const blank = { title: '', sector: firstSector(org, sectors), location: '', starts: '', weeks: '', slots: 1, deadline: '', stipend: '', description: '', comps: [] };
  const [f, setF] = useState(blank);
  const list = useAsync(async () => unwrap(await supabase.from('internships')
    .select('*, internship_competencies(competency_id), internship_applications(id, student_id, student_name, status, cover_note, created_at)')
    .eq('employer_org_id', profile.org_id).order('created_at', { ascending: false })), []);

  const publish = () => run(async () => {
    if (!f.title.trim() || !f.description.trim()) throw new Error('Add a title and a description.');
    if (!f.comps.length) throw new Error('Pick at least one competency.');
    const [i] = unwrap(await supabase.from('internships').insert({
      employer_org_id: profile.org_id, sector_id: f.sector, title: f.title.trim(), description: f.description.trim(), location: f.location.trim(),
      starts_on: f.starts || null, duration_weeks: f.weeks ? Number(f.weeks) : null, slots: Number(f.slots) || 1, stipend_note: f.stipend.trim(), application_deadline: f.deadline || null,
    }).select('id'));
    unwrap(await supabase.from('internship_competencies').insert(f.comps.map((c) => ({ internship_id: i.id, competency_id: c }))));
    setF({ ...blank, sector: f.sector });
    list.reload();
  }, 'Internship published.');
  const setInternship = (i, status) => run(async () => { unwrap(await supabase.from('internships').update({ status }).eq('id', i.id)); list.reload(); });
  const setApp = (a, status) => run(async () => { unwrap(await supabase.from('internship_applications').update({ status }).eq('id', a.id)); list.reload(); }, 'Updated. The student has been notified.');
  const shortlist = (a) => run(async () => {
    const { error } = await supabase.from('talent_pipeline').insert({ employer_org_id: profile.org_id, student_id: a.student_id, source: 'internship' });
    if (error && error.code !== '23505') throw error;
  }, 'Added to your talent pipeline.');

  return (
    <>
      <PageHeader title="Internships" sub="Host placements, choose from applicants, and sign off the work at the end. Completed placements become verified evidence." />
      <Panel title="Post an internship">
        <div className="grid gap-x-4 sm:grid-cols-3">
          <Field label="Title"><Input maxLength={120} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
          <Field label="Sector"><SectorSelect value={f.sector} onChange={(sector) => setF({ ...f, sector, comps: [] })} /></Field>
          <Field label="Location"><Input value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></Field>
          <Field label="Starts"><Input type="date" value={f.starts} onChange={(e) => setF({ ...f, starts: e.target.value })} /></Field>
          <Field label="Weeks"><Input type="number" min="1" value={f.weeks} onChange={(e) => setF({ ...f, weeks: e.target.value })} /></Field>
          <Field label="Places"><Input type="number" min="1" value={f.slots} onChange={(e) => setF({ ...f, slots: e.target.value })} /></Field>
          <Field label="Apply by"><Input type="date" value={f.deadline} onChange={(e) => setF({ ...f, deadline: e.target.value })} /></Field>
          <Field label="Stipend or support" className="sm:col-span-2"><Input value={f.stipend} onChange={(e) => setF({ ...f, stipend: e.target.value })} placeholder="e.g. Transport and lunch provided" /></Field>
        </div>
        <Field label="Description"><Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <div className="mb-4"><span className="label">Competencies the placement builds</span><CompetencyChecks sectorId={f.sector} value={f.comps} onChange={(comps) => setF({ ...f, comps })} /></div>
        <Button variant="go" disabled={busy} onClick={publish}>Publish internship</Button>
      </Panel>

      <h3 className="mb-2">Your internships</h3>
      <Async state={list}>{(rows) => !rows.length ? <Empty>Nothing posted yet.</Empty> : rows.map((i) => (
        <Card key={i.id} status={i.status === 'open' ? 'verified' : 'draft'}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div><h3>{i.title}</h3><p className="text-sm text-ink-soft">{sectorName(i.sector_id)}, {i.slots} place{i.slots > 1 ? 's' : ''}{i.application_deadline ? ', apply by ' + fmtDate(i.application_deadline) : ''}</p></div>
            <div className="flex items-center gap-2"><Pill tone={i.status === 'open' ? 'ok' : 'plain'}>{i.status}</Pill>
              <Button small variant="ghost" disabled={busy} onClick={() => setInternship(i, i.status === 'open' ? 'closed' : 'open')}>{i.status === 'open' ? 'Close' : 'Reopen'}</Button></div>
          </div>
          <div className="my-2 flex flex-wrap gap-1.5">{i.internship_competencies.map((c) => <Chip key={c.competency_id}>{compName(c.competency_id)}</Chip>)}</div>
          <h4 className="mb-1 mt-3 text-sm">Applicants ({i.internship_applications.length})</h4>
          {!i.internship_applications.length && <p className="text-sm text-ink-soft">No applications yet.</p>}
          {i.internship_applications.map((a) => (
            <ApplicantRow key={a.id} a={a} internship={i} busy={busy} setApp={setApp} shortlist={shortlist} reload={list.reload} compName={compName} />
          ))}
        </Card>
      ))}</Async>
    </>
  );
}

function ApplicantRow({ a, internship, busy, setApp, shortlist, reload, compName }) {
  const { professional } = useCatalog();
  const [open, setOpen] = useState(false);
  const [ratings, setRatings] = useState({});
  const [pro, setPro] = useState({});
  const [hours, setHours] = useState('');
  const [note, setNote] = useState('');
  const [run, b2] = useAction();

  const complete = () => run(async () => {
    const need = internship.internship_competencies.map((c) => c.competency_id);
    if (need.some((id) => !ratings[id])) throw new Error('Rate every competency before completing the placement.');
    const proOut = {};
    Object.entries(pro).forEach(([k, v]) => { if (v) proOut[k] = v; });
    unwrap(await supabase.rpc('complete_internship', { p_application: a.id, p_ratings: ratings, p_pro: proOut, p_note: note, p_hours: Number(hours) || 0 }));
    setOpen(false); reload();
  }, 'Placement completed and recorded as verified evidence.');

  return (
    <div className="mb-2 rounded border border-line p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span><strong>{a.student_name}</strong> <span className="text-sm text-ink-soft">applied {fmtDate(a.created_at)}</span>{a.cover_note && <span className="block text-sm">"{a.cover_note}"</span>}</span>
        <Pill tone={['accepted', 'completed', 'offered'].includes(a.status) ? 'ok' : ['declined', 'withdrawn'].includes(a.status) ? 'no' : 'wait'}>{a.status}</Pill>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {a.status === 'applied' && <Button small variant="ghost" disabled={busy} onClick={() => setApp(a, 'shortlisted')}>Shortlist</Button>}
        {['applied', 'shortlisted'].includes(a.status) && <Button small variant="go" disabled={busy} onClick={() => setApp(a, 'offered')}>Offer place</Button>}
        {['applied', 'shortlisted', 'offered'].includes(a.status) && <Button small variant="danger" disabled={busy} onClick={() => setApp(a, 'declined')}>Decline</Button>}
        {a.status === 'accepted' && <Button small onClick={() => setOpen(!open)}>{open ? 'Close' : 'Complete placement'}</Button>}
        {a.status === 'completed' && <Link to="/feedback" className="text-sm">Give employer feedback</Link>}
        {!['declined', 'withdrawn'].includes(a.status) && <Button small variant="ghost" disabled={busy} onClick={() => shortlist(a)}>Add to talent pipeline</Button>}
      </div>
      {open && (
        <div className="mt-3 border-t border-line pt-3">
          <LevelLegend />
          {internship.internship_competencies.map((c) => (
            <div key={c.competency_id} className="mb-2 grid items-center gap-2 sm:grid-cols-[1fr_220px]">
              <span>{compName(c.competency_id)}</span>
              <LevelSelect placeholder="Select level" value={ratings[c.competency_id] || ''} onChange={(v) => setRatings({ ...ratings, [c.competency_id]: v })} aria-label={'Level for ' + compName(c.competency_id)} />
            </div>
          ))}
          <h4 className="mb-1 mt-3 text-sm">Professional competencies (optional)</h4>
          {professional.map((c) => (
            <div key={c.id} className="mb-2 grid items-center gap-2 sm:grid-cols-[1fr_220px]">
              <span>{c.name}</span>
              <LevelSelect placeholder="Not rated" value={pro[c.id] || ''} onChange={(v) => setPro({ ...pro, [c.id]: v })} aria-label={'Level for ' + c.name} />
            </div>
          ))}
          <div className="grid gap-x-4 sm:grid-cols-[160px_1fr]">
            <Field label="Hours completed"><Input type="number" min="0" value={hours} onChange={(e) => setHours(e.target.value)} /></Field>
            <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What they did well" /></Field>
          </div>
          <Button variant="go" disabled={b2} onClick={complete}>Complete and verify</Button>
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- review */
export function Review() {
  const { profile } = useAuth();
  const state = useAsync(async () => {
    const rows = unwrap(await supabase.from('evidence').select('*, evidence_competencies(competency_id, rating), evidence_media(*)').eq('verifier_org_id', profile.org_id));
    return rows.sort((a, b) => (a.status === 'submitted' ? 0 : 1) - (b.status === 'submitted' ? 0 : 1) || new Date(b.updated_at) - new Date(a.updated_at));
  }, []);
  return (
    <>
      <PageHeader title="Review queue" sub="Rate what the student showed against each competency. Your ratings are what appear on their verified record." />
      <LevelLegend />
      <Async state={state}>{(rows) => !rows.length ? <Empty>No submissions yet. They appear here when students respond to your projects.</Empty> : rows.map((e) => <ReviewCard key={e.id} e={e} reload={state.reload} />)}</Async>
    </>
  );
}

function ReviewCard({ e, reload }) {
  const { compName, professional, competencies } = useCatalog();
  const [ratings, setRatings] = useState({});
  const [pro, setPro] = useState({});
  const [note, setNote] = useState('');
  const [run, busy] = useAction();
  const proIds = new Set(competencies.filter((c) => c.category === 'professional').map((c) => c.id));
  const tech = e.evidence_competencies.filter((c) => !proIds.has(c.competency_id));

  const decide = (status) => run(async () => {
    if (status === 'verified' && tech.some((c) => !ratings[c.competency_id])) throw new Error('Rate every competency before verifying.');
    if (status !== 'verified' && !note.trim()) throw new Error('Add a note so the student knows what happens next.');
    const proOut = {};
    Object.entries(pro).forEach(([k, v]) => { if (v) proOut[k] = v; });
    unwrap(await supabase.rpc('review_evidence', { p_evidence: e.id, p_status: status, p_note: note, p_ratings: ratings, p_pro: proOut }));
    reload();
  }, 'Saved. The student has been notified.');

  return (
    <Card status={e.status}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><h3>{e.title}</h3><p className="text-sm text-ink-soft">{e.student_name}, {e.context_title}, {Number(e.hours) > 0 ? e.hours + ' hours, ' : ''}{fmtDate(e.created_at)}</p></div>
        {e.status === 'verified' ? <VerifiedStamp date={e.verified_at} /> : <StatusPill status={e.status} />}
      </div>
      <p className="my-2 whitespace-pre-wrap">{e.description}</p>
      {e.link && isHttpUrl(e.link) && <p><a href={e.link} target="_blank" rel="noreferrer noopener">Open the work</a></p>}
      <MediaGrid media={e.evidence_media} />
      {e.status !== 'submitted' ? (
        <>
          {e.status === 'verified' && <RatingsBlock rows={e.evidence_competencies} />}
          {e.verifier_note && <Notice tone="info"><strong>Your note: </strong>{e.verifier_note}</Notice>}
          <AssuranceBadge evidence={e} />
        </>
      ) : (
        <div className="mt-3 border-t border-line pt-3">
          <h4 className="mb-2">Rate the competencies they showed</h4>
          {tech.map((c) => (
            <div key={c.competency_id} className="mb-2 grid items-center gap-2 sm:grid-cols-[1fr_220px]">
              <span>{compName(c.competency_id)}</span>
              <LevelSelect placeholder="Select level" value={ratings[c.competency_id] || ''} onChange={(v) => setRatings({ ...ratings, [c.competency_id]: v })} aria-label={'Level for ' + compName(c.competency_id)} />
            </div>
          ))}
          <h4 className="mb-1 mt-3 text-sm">Professional competencies (optional)</h4>
          {professional.map((c) => (
            <div key={c.id} className="mb-2 grid items-center gap-2 sm:grid-cols-[1fr_220px]">
              <span>{c.name}</span>
              <LevelSelect placeholder="Not rated" value={pro[c.id] || ''} onChange={(v) => setPro({ ...pro, [c.id]: v })} aria-label={'Level for ' + c.name} />
            </div>
          ))}
          <Field label="Note to the student" className="mt-3"><Textarea rows={3} value={note} onChange={(ev) => setNote(ev.target.value)} placeholder="What went well, and what would move them up a level?" /></Field>
          <div className="flex flex-wrap gap-2">
            <Button variant="go" disabled={busy} onClick={() => decide('verified')}>Verify</Button>
            <Button variant="ghost" disabled={busy} onClick={() => decide('revision')}>Request changes</Button>
            <Button variant="danger" disabled={busy} onClick={() => decide('declined')}>Decline</Button>
          </div>
        </div>
      )}
    </Card>
  );
}

/* --------------------------------------------------------------- talent */
export function Talent() {
  const { profile, org } = useAuth();
  const { sectors } = useCatalog();
  const [run, busy] = useAction();
  const [q, setQ] = useState({ sector: firstSector(org, sectors), comps: [], min: 3 });
  const [results, setResults] = useState(null);
  const pipeline = useAsync(async () => unwrap(await supabase.from('talent_pipeline').select('*').eq('employer_org_id', profile.org_id).order('updated_at', { ascending: false })), []);

  const search = () => run(async () => {
    const rows = unwrap(await supabase.rpc('discover_talent', { p_sector: q.sector, p_competencies: q.comps, p_min_level: Number(q.min) || 1 }));
    const pub = rows.length ? unwrap(await supabase.from('public_profiles').select('id').in('id', rows.map((r) => r.student_id))) : [];
    setResults({ rows, pub: new Set(pub.map((p) => p.id)) });
  });
  const add = (r) => run(async () => {
    const { error } = await supabase.from('talent_pipeline').insert({ employer_org_id: profile.org_id, student_id: r.student_id, source: 'discovery' });
    if (error) { if (error.code === '23505') throw new Error('Already in your pipeline.'); throw error; }
    pipeline.reload();
    setResults((cur) => ({ ...cur, rows: cur.rows.map((x) => (x.student_id === r.student_id ? { ...x, in_pipeline: true } : x)) }));
  }, 'Added to your pipeline.');

  return (
    <>
      <PageHeader title="Talent" sub="Discover students by proven competencies, assess them, host them, and hire. Only students who opted in appear, and you see verified levels, not CVs." />
      <Panel title="Discover">
        <div className="grid gap-x-4 sm:grid-cols-2">
          <Field label="Sector"><SectorSelect value={q.sector} onChange={(sector) => setQ({ ...q, sector, comps: [] })} /></Field>
          <Field label="Minimum verified level"><LevelSelect value={q.min} onChange={(min) => setQ({ ...q, min: min || 1 })} /></Field>
        </div>
        <div className="mb-4"><span className="label">Must show (optional)</span><CompetencyChecks sectorId={q.sector} value={q.comps} onChange={(comps) => setQ({ ...q, comps })} /></div>
        <Button disabled={busy} onClick={search}>Search</Button>
        {results && (
          <div className="mt-5">
            {!results.rows.length && <Empty>No matching students yet. Try a lower level or fewer competencies.</Empty>}
            {results.rows.map((r) => (
              <Card key={r.student_id}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div><h3>{r.full_name}</h3>{r.headline && <p className="text-sm text-ink-soft">{r.headline}</p>}</div>
                  <Chip>{r.matched} matching competenc{r.matched === 1 ? 'y' : 'ies'}, {r.evidence_count} verified pieces</Chip>
                </div>
                <BestLevels best={r.best} />
                <div className="mt-2 flex flex-wrap gap-2">
                  {r.in_pipeline ? <Pill tone="plain">In your pipeline</Pill> : <Button small disabled={busy} onClick={() => add(r)}>Add to pipeline</Button>}
                  {results.pub.has(r.student_id) && <Link to={'/p/' + r.slug} className="text-sm" target="_blank">View portfolio</Link>}
                </div>
              </Card>
            ))}
          </div>
        )}
      </Panel>

      <h3 className="mb-2">Your pipeline</h3>
      <Async state={pipeline}>{(rows) => !rows.length ? <Empty>No candidates yet. Add people from discovery or from internship applicants.</Empty> : (
        <>
          <p className="mb-3 text-sm text-ink-soft">Moving someone to "invited" or beyond tells them you are interested. To assess a candidate, use <Link to="/assessments">Assessments</Link>.</p>
          {rows.map((p) => <PipelineRow key={p.id} p={p} reload={pipeline.reload} />)}
        </>
      )}</Async>
    </>
  );
}

function BestLevels({ best }) {
  const { compName } = useCatalog();
  const entries = Object.entries(best || {}).sort((a, b) => b[1] - a[1]).slice(0, 5);
  return <div className="my-2">{entries.map(([id, lvl]) => <LevelRow key={id} name={compName(id)} level={lvl} />)}</div>;
}

function PipelineRow({ p, reload }) {
  const [run, busy] = useAction();
  const [open, setOpen] = useState(false);
  const [job, setJob] = useState('');
  const [start, setStart] = useState(new Date().toISOString().slice(0, 10));
  const setStage = (stage) => run(async () => { unwrap(await supabase.from('talent_pipeline').update({ stage }).eq('id', p.id)); reload(); });
  const hire = () => run(async () => {
    if (!job.trim()) throw new Error('Enter the job title.');
    unwrap(await supabase.rpc('hire_student', { p_student: p.student_id, p_job_title: job, p_started_on: start }));
    setOpen(false); reload();
  }, 'Hire recorded. Their employment and outcome are updated.');
  const remove = () => run(async () => { unwrap(await supabase.from('talent_pipeline').delete().eq('id', p.id)); reload(); });

  return (
    <Card status={p.stage === 'hired' ? 'verified' : p.stage === 'rejected' ? 'declined' : 'submitted'}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span><strong>{p.student_name}</strong> <span className="text-sm text-ink-soft">via {p.source}, updated {fmtDate(p.updated_at)}</span></span>
        {p.stage === 'hired' ? <Pill tone="ok">Hired</Pill> : (
          <div className="flex flex-wrap items-center gap-2">
            <select className="input w-40" aria-label={'Stage for ' + p.student_name} value={p.stage} onChange={(e) => setStage(e.target.value)} disabled={busy}>
              {PIPELINE_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            {['interviewing', 'offered'].includes(p.stage) && <Button small variant="go" onClick={() => setOpen(!open)}>Record hire</Button>}
            <Button small variant="ghost" disabled={busy} onClick={remove}>Remove</Button>
          </div>
        )}
      </div>
      {p.stage === 'hired' && <p className="mt-2 text-sm"><Link to="/feedback">Give employer feedback</Link> once they've settled in. It helps their institution improve.</p>}
      {open && (
        <div className="mt-3 grid items-end gap-x-3 border-t border-line pt-3 sm:grid-cols-[1fr_180px_auto]">
          <Field label="Job title" className="mb-0"><Input value={job} onChange={(e) => setJob(e.target.value)} /></Field>
          <Field label="Start date" className="mb-0"><Input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          <Button variant="go" disabled={busy} onClick={hire}>Confirm hire</Button>
        </div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------- feedback */
export function Feedback() {
  const { profile } = useAuth();
  const { compName, sectorName } = useCatalog();
  const [run, busy] = useAction();
  const [who, setWho] = useState('');
  const [f, setF] = useState({ prepared: 'mostly', again: true, comment: '', comps: [], levels: {} });
  const state = useAsync(async () => {
    const jobs = unwrap(await supabase.from('employments').select('id, student_id, student_name, job_title, sector_id').eq('employer_org_id', profile.org_id));
    const hosted = unwrap(await supabase.from('internship_applications').select('id, student_id, student_name, status, internships(title, sector_id)').in('status', ['accepted', 'completed']));
    const past = unwrap(await supabase.from('employer_feedback').select('*, feedback_competencies(competency_id, observed_level, expected_level)').eq('employer_org_id', profile.org_id).order('created_at', { ascending: false }));
    const people = [
      ...jobs.map((j) => ({ key: 'e:' + j.id, student: j.student_id, employment: j.id, application: null, label: j.student_name + ', employed as ' + j.job_title, sector: j.sector_id })),
      ...hosted.map((h) => ({ key: 'a:' + h.id, student: h.student_id, employment: null, application: h.id, label: h.student_name + ', intern: ' + (h.internships ? h.internships.title : ''), sector: h.internships ? h.internships.sector_id : '' })),
    ];
    return { people, past };
  }, []);

  const person = state.data && state.data.people.find((p) => p.key === who);
  const submit = () => run(async () => {
    if (!person) throw new Error('Choose who this feedback is about.');
    const levels = {};
    f.comps.forEach((id) => { const l = f.levels[id] || {}; if (l.observed) levels[id] = { observed: l.observed, expected: l.expected || null }; });
    unwrap(await supabase.rpc('submit_feedback', {
      p_student: person.student, p_employment: person.employment, p_application: person.application,
      p_preparedness: f.prepared, p_would_hire_again: f.again, p_comment: f.comment, p_levels: levels,
    }));
    setWho(''); setF({ prepared: 'mostly', again: true, comment: '', comps: [], levels: {} });
    state.reload();
  }, 'Feedback sent. The person can see it, and their institution sees only combined results.');
  const setLevel = (id, k, v) => setF({ ...f, levels: { ...f.levels, [id]: { ...(f.levels[id] || {}), [k]: v } } });

  return (
    <>
      <PageHeader title="Employer feedback" sub="How well did their education prepare them? Individual feedback goes to the person. Institutions only see combined results, for groups of five or more consenting graduates." />
      <Async state={state}>{({ people, past }) => (
        <>
          <Panel title="Give feedback">
            {!people.length ? <Empty>You can give feedback on people you've hired or hosted as interns. None yet.</Empty> : (
              <>
                <Field label="About"><Select value={who} onChange={(e) => setWho(e.target.value)} placeholder="Choose a person" options={people.map((p) => ({ v: p.key, n: p.label }))} /></Field>
                {person && (
                  <>
                    <div className="grid gap-x-4 sm:grid-cols-2">
                      <Field label="How ready were they?"><Select value={f.prepared} onChange={(e) => setF({ ...f, prepared: e.target.value })} options={PREPAREDNESS} /></Field>
                      <div className="mb-4 self-end"><CheckChip checked={f.again} onChange={(again) => setF({ ...f, again })}>I would hire another graduate like this</CheckChip></div>
                    </div>
                    <div className="mb-3"><span className="label">Competencies you observed{person.sector ? ' (' + sectorName(person.sector) + ')' : ''}</span>
                      <CompetencyChecks sectorId={person.sector} value={f.comps} onChange={(comps) => setF({ ...f, comps })} /></div>
                    {f.comps.map((id) => (
                      <div key={id} className="mb-2 grid items-center gap-2 sm:grid-cols-[1fr_190px_190px]">
                        <span>{compName(id)}</span>
                        <LevelSelect placeholder="Level observed" value={(f.levels[id] || {}).observed || ''} onChange={(v) => setLevel(id, 'observed', v)} aria-label={'Observed level for ' + compName(id)} />
                        <LevelSelect placeholder="Level you expected" value={(f.levels[id] || {}).expected || ''} onChange={(v) => setLevel(id, 'expected', v)} aria-label={'Expected level for ' + compName(id)} />
                      </div>
                    ))}
                    <Field label="Comment" className="mt-3"><Textarea rows={3} value={f.comment} onChange={(e) => setF({ ...f, comment: e.target.value })} /></Field>
                    <Button variant="go" disabled={busy} onClick={submit}>Send feedback</Button>
                  </>
                )}
              </>
            )}
          </Panel>
          <h3 className="mb-2">Feedback you've given</h3>
          {!past.length && <Empty>None yet.</Empty>}
          {past.map((p) => (
            <Card key={p.id}>
              <p><strong>{p.student_name}</strong>: {PREPAREDNESS.find((x) => x.v === p.preparedness)?.n}{p.would_hire_again ? ', would hire again' : ''} <span className="text-sm text-ink-soft">{fmtDate(p.created_at)}</span></p>
              {p.comment && <p className="text-sm">{p.comment}</p>}
              {p.feedback_competencies.map((c) => <LevelRow key={c.competency_id} name={compName(c.competency_id)} level={c.observed_level} extra={c.expected_level ? 'expected ' + c.expected_level : ''} />)}
            </Card>
          ))}
        </>
      )}</Async>
    </>
  );
}
