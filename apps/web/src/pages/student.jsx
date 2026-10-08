import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { useAuth } from '../auth.jsx';
import { useCatalog } from '../catalog.jsx';
import { supabase } from '../lib/supabase.js';
import { useAsync, unwrap } from '../lib/hooks.js';
import { PREPAREDNESS, STATUS, fmtDate, isHttpUrl, mediaKind, safeName } from '../lib/format.js';
import {
  Async, Button, Card, CheckChip, Chip, CompetencyChecks, Empty, Field, Input, LevelRow, Notice, PageHeader, Panel, Pill,
  SectorChecks, SectorSelect, Select, StatusPill, Textarea, VerifiedStamp, useAction,
} from '../ui.jsx';
import { AssuranceBadge, CompetencyRecord, MediaGrid, RatingsBlock } from './shared.jsx';

/* ------------------------------------------------------------- projects */
export function StudentProjects() {
  const { profile } = useAuth();
  const { sectorName, compName } = useCatalog();
  const nav = useNavigate();
  const [sector, setSector] = useState((profile.sector_ids || [])[0] || '');
  const [run, busy] = useAction();
  const state = useAsync(async () => {
    const projects = unwrap(await supabase.from('projects').select('*, organizations(name), project_competencies(competency_id)').eq('status', 'open').order('created_at', { ascending: false }));
    const mine = unwrap(await supabase.from('evidence').select('id, project_id, status').eq('student_id', profile.id).not('project_id', 'is', null));
    return { projects, started: Object.fromEntries(mine.map((e) => [e.project_id, e])) };
  }, []);

  const start = (p) => run(async () => {
    const evidenceId = unwrap(await supabase.rpc('start_project_evidence', { p_project: p.id }));
    nav('/evidence/' + evidenceId);
  });

  return (
    <>
      <PageHeader title="Projects" sub="Real work set by employers. Complete it, attach proof, and the employer verifies what you showed." />
      <div className="mb-4 max-w-xs"><Field label="Sector"><SectorSelect value={sector} onChange={setSector} placeholder="All sectors" /></Field></div>
      <Async state={state}>{({ projects, started }) => {
        const shown = projects.filter((p) => !sector || p.sector_id === sector);
        if (!shown.length) return <Empty>No open projects in this sector yet. Check back soon or pick another sector.</Empty>;
        return shown.map((p) => (
          <Card key={p.id}>
            <div className="flex flex-wrap items-start justify-between gap-2"><h3>{p.title}</h3><Chip>{sectorName(p.sector_id)}</Chip></div>
            <p className="text-sm text-ink-soft">Set by <strong>{p.organizations ? p.organizations.name : 'an employer'}</strong>, {p.kind}{p.hours_estimate ? ', about ' + p.hours_estimate + ' hours' : ''}</p>
            <p className="my-2 whitespace-pre-wrap">{p.description}</p>
            <div className="mb-3 flex flex-wrap gap-1.5">{p.project_competencies.map((c) => <Chip key={c.competency_id}>{compName(c.competency_id)}</Chip>)}</div>
            {started[p.id]
              ? <div className="flex items-center gap-3"><StatusPill status={started[p.id].status} /><Link to={'/evidence/' + started[p.id].id}>Open your work</Link></div>
              : <Button small disabled={busy} onClick={() => start(p)}>Start this project</Button>}
          </Card>
        ));
      }}</Async>
    </>
  );
}

/* ---------------------------------------------------------- internships */
export function StudentInternships() {
  const { profile } = useAuth();
  const { sectorName, compName } = useCatalog();
  const nav = useNavigate();
  const [run, busy] = useAction();
  const [notes, setNotes] = useState({});
  const state = useAsync(async () => {
    const open = unwrap(await supabase.from('internships').select('*, organizations(name), internship_competencies(competency_id)').eq('status', 'open').order('created_at', { ascending: false }));
    const apps = unwrap(await supabase.from('internship_applications').select('*, internships(title, sector_id, organizations(name))').eq('student_id', profile.id).order('created_at', { ascending: false }));
    return { open, apps };
  }, []);

  const apply = (i) => run(async () => {
    unwrap(await supabase.rpc('apply_to_internship', { p_internship: i.id, p_cover_note: (notes[i.id] || '').trim() }));
    state.reload();
  }, 'Application sent.');
  const setStatus = (a, status) => run(async () => { unwrap(await supabase.from('internship_applications').update({ status }).eq('id', a.id)); state.reload(); }, 'Updated.');
  const logWork = (a) => run(async () => {
    const [e] = unwrap(await supabase.from('evidence').insert({ student_id: profile.id, internship_application_id: a.id, sector_id: a.internships.sector_id, title: 'Internship: ' + a.internships.title }).select('id'));
    nav('/evidence/' + e.id);
  });

  return (
    <>
      <PageHeader title="Internships" sub="Apply for placements. When you complete one, the employer signs off your work and it joins your evidence profile." />
      <Async state={state}>{({ open, apps }) => {
        const applied = new Set(apps.map((a) => a.internship_id));
        return (
          <>
            {apps.length > 0 && <h3 className="mb-2">Your applications</h3>}
            {apps.map((a) => (
              <Card key={a.id} status={a.status === 'accepted' || a.status === 'completed' ? 'verified' : a.status === 'declined' || a.status === 'withdrawn' ? 'declined' : 'submitted'}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div><h3>{a.internships ? a.internships.title : 'Internship'}</h3><p className="text-sm text-ink-soft">{a.internships && a.internships.organizations ? a.internships.organizations.name : ''}, applied {fmtDate(a.created_at)}</p></div>
                  <Pill tone={['accepted', 'completed', 'offered'].includes(a.status) ? 'ok' : ['declined', 'withdrawn'].includes(a.status) ? 'no' : 'wait'}>{a.status}</Pill>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {a.status === 'offered' && <><Button small variant="go" disabled={busy} onClick={() => setStatus(a, 'accepted')}>Accept offer</Button><Button small variant="danger" disabled={busy} onClick={() => setStatus(a, 'declined')}>Decline offer</Button></>}
                  {a.status === 'accepted' && <Button small disabled={busy} onClick={() => logWork(a)}>Log placement work</Button>}
                  {['applied', 'shortlisted', 'offered'].includes(a.status) && <Button small variant="ghost" disabled={busy} onClick={() => setStatus(a, 'withdrawn')}>Withdraw</Button>}
                </div>
              </Card>
            ))}
            <h3 className="mb-2 mt-6">Open internships</h3>
            {!open.length && <Empty>No open internships right now.</Empty>}
            {open.map((i) => (
              <Card key={i.id}>
                <div className="flex flex-wrap items-start justify-between gap-2"><h3>{i.title}</h3><Chip>{sectorName(i.sector_id)}</Chip></div>
                <p className="text-sm text-ink-soft">{i.organizations ? i.organizations.name : ''}{i.location ? ', ' + i.location : ''}{i.duration_weeks ? ', ' + i.duration_weeks + ' weeks' : ''}{i.starts_on ? ', starts ' + fmtDate(i.starts_on) : ''}{i.application_deadline ? ', apply by ' + fmtDate(i.application_deadline) : ''}</p>
                <p className="my-2 whitespace-pre-wrap">{i.description}</p>
                {i.stipend_note && <p className="mb-2 text-sm"><strong>Support: </strong>{i.stipend_note}</p>}
                <div className="mb-3 flex flex-wrap gap-1.5">{i.internship_competencies.map((c) => <Chip key={c.competency_id}>{compName(c.competency_id)}</Chip>)}</div>
                {applied.has(i.id) ? <Pill tone="plain">You have applied</Pill> : (
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="min-w-[240px] flex-1"><Input placeholder="A line about why you're a fit (optional)" aria-label="Cover note" value={notes[i.id] || ''} onChange={(e) => setNotes({ ...notes, [i.id]: e.target.value })} /></div>
                    <Button small disabled={busy} onClick={() => apply(i)}>Apply</Button>
                  </div>
                )}
              </Card>
            ))}
          </>
        );
      }}</Async>
    </>
  );
}

/* ------------------------------------------------------------- evidence */
export function MyEvidence() {
  const { profile } = useAuth();
  const { sectorName } = useCatalog();
  const nav = useNavigate();
  const [run, busy] = useAction();
  const [f, setF] = useState({ sector: (profile.sector_ids || [])[0] || '', title: '' });
  const state = useAsync(async () => unwrap(await supabase.from('evidence').select('*, evidence_competencies(competency_id, rating)').eq('student_id', profile.id).order('created_at', { ascending: false })), []);

  const create = () => run(async () => {
    if (!f.sector || !f.title.trim()) throw new Error('Choose a sector and give the work a title.');
    const [e] = unwrap(await supabase.from('evidence').insert({ student_id: profile.id, sector_id: f.sector, title: f.title.trim() }).select('id'));
    nav('/evidence/' + e.id);
  });

  return (
    <>
      <PageHeader title="Evidence" sub="Everything you've done that shows what you can do: projects, placements and work you logged yourself." />
      <Panel title="Log work you did yourself">
        <p className="mb-3 text-sm text-ink-soft">For work outside an employer's project, such as a job, workshop or family business. You then ask a supervisor to verify it by link or phone.</p>
        <div className="grid gap-x-4 sm:grid-cols-2">
          <Field label="Sector"><SectorSelect value={f.sector} onChange={(sector) => setF({ ...f, sector })} placeholder="Choose a sector" /></Field>
          <Field label="What did you do?"><Input value={f.title} maxLength={120} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Rebuilt a gearbox" /></Field>
        </div>
        <Button disabled={busy} onClick={create}>Start a new record</Button>
      </Panel>
      <Async state={state}>{(list) => !list.length ? <Empty>Nothing yet. Start a project or log your own work.</Empty> : list.map((e) => (
        <Card key={e.id} status={e.status}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div><h3><Link to={'/evidence/' + e.id} className="text-ink no-underline hover:underline">{e.title}</Link></h3>
              <p className="text-sm text-ink-soft">{sectorName(e.sector_id)}{e.context_title ? ', ' + e.context_title : ', self-logged'}{Number(e.hours) > 0 ? ', ' + e.hours + ' hours' : ''}</p></div>
            {e.status === 'verified' ? <VerifiedStamp date={e.verified_at} /> : <StatusPill status={e.status} />}
          </div>
          {e.verifier_note && e.status !== 'verified' && <Notice tone="info"><strong>Note: </strong>{e.verifier_note}</Notice>}
        </Card>
      ))}</Async>
    </>
  );
}

function MediaEditor({ evidence, editable, onChanged }) {
  const { profile } = useAuth();
  const [run, busy] = useAction();
  const media = evidence.evidence_media || [];
  const signed = useAsync(async () => {
    if (!media.length) return {};
    const { data } = await supabase.storage.from('evidence-media').createSignedUrls(media.map((m) => m.storage_path), 3600);
    return Object.fromEntries((data || []).filter((d) => d.signedUrl).map((d) => [d.path, d.signedUrl]));
  }, [media.map((m) => m.id).join('|')]);
  const urls = signed.data || {};

  const upload = (files) => run(async () => {
    for (const file of Array.from(files)) {
      if (file.size > 50 * 1024 * 1024) throw new Error(file.name + ' is over the 50 MB limit.');
      const path = profile.id + '/' + evidence.id + '/' + crypto.randomUUID() + '-' + safeName(file.name);
      const up = await supabase.storage.from('evidence-media').upload(path, file, { contentType: file.type });
      if (up.error) throw new Error(up.error.message);
      unwrap(await supabase.from('evidence_media').insert({ evidence_id: evidence.id, storage_path: path, kind: mediaKind(file.type), caption: '' }));
    }
    onChanged();
  }, 'Uploaded.');
  const remove = (m) => run(async () => {
    await supabase.storage.from('evidence-media').remove([m.storage_path]);
    unwrap(await supabase.from('evidence_media').delete().eq('id', m.id));
    onChanged();
  });

  return (
    <div className="mb-4">
      <span className="label">Photos, video and documents</span>
      <div className="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {media.map((m) => (
          <div key={m.id} className="relative">
            {urls[m.storage_path] && m.kind === 'image' ? <img src={urls[m.storage_path]} alt="" className="h-28 w-full rounded object-cover" />
              : urls[m.storage_path] && m.kind === 'video' ? <video src={urls[m.storage_path]} controls className="h-28 w-full rounded bg-black" />
              : <div className="flex h-28 items-center justify-center rounded border border-line text-sm text-ink-soft">{m.kind}</div>}
            {editable && <button type="button" className="absolute right-1 top-1 rounded bg-white/90 px-2 text-xs text-no" onClick={() => remove(m)} aria-label="Remove file">Remove</button>}
          </div>
        ))}
      </div>
      {editable && <input type="file" multiple disabled={busy} accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,application/pdf" aria-label="Add files" onChange={(e) => { if (e.target.files.length) upload(e.target.files); e.target.value = ''; }} />}
      {editable && <p className="mt-1 text-xs text-ink-soft">Up to 50 MB each. Photos of the finished job are the strongest proof for hands-on work.</p>}
    </div>
  );
}

function VerificationPanel({ evidence, requests, onChanged }) {
  const [f, setF] = useState({ name: '', role: '', contact: '' });
  const [fresh, setFresh] = useState(null);
  const [run, busy] = useAction();
  const ussd = import.meta.env.VITE_USSD_CODE || '';
  const link = (t) => window.location.origin + '/v/' + t;
  const open = requests.filter((r) => !r.used_at && new Date(r.expires_at) > new Date());

  const request = () => run(async () => {
    const [r] = unwrap(await supabase.rpc('request_external_verification', { p_evidence: evidence.id, p_name: f.name, p_role: f.role, p_contact: f.contact }));
    setFresh(r);
    onChanged();
  }, 'Request created. Share the link or code with your supervisor.');

  const Share = ({ token, code, expires }) => (
    <div className="mt-3 flex flex-wrap items-center gap-4 rounded border border-line p-3">
      <QRCodeSVG value={link(token)} size={104} />
      <div className="min-w-[220px] flex-1 text-sm">
        <p className="break-all"><strong>Link: </strong>{link(token)}</p>
        <p className="mt-1"><strong>Phone code: </strong><span className="font-mono text-lg tracking-widest">{code}</span>{ussd && <> (dial {ussd})</>}</p>
        <p className="mt-1 text-ink-soft">Expires {fmtDate(expires)}. Codes only work from the phone number you entered.</p>
        <Button small variant="ghost" className="mt-2" onClick={() => navigator.clipboard && navigator.clipboard.writeText(link(token))}>Copy link</Button>
      </div>
    </div>
  );

  return (
    <Panel title="Ask a supervisor to verify this">
      <p className="mb-3 text-sm text-ink-soft">Someone who saw the work, such as a workshop lead, chef, teacher or client. They don't need an account. A record they sign is labelled as supervisor-attested.</p>
      <div className="grid gap-x-4 sm:grid-cols-3">
        <Field label="Their name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Their role"><Input value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} placeholder="e.g. Workshop lead" /></Field>
        <Field label="Phone or email" hint="Phone lets them sign by USSD."><Input value={f.contact} onChange={(e) => setF({ ...f, contact: e.target.value })} placeholder="0788 000 000" /></Field>
      </div>
      <Button disabled={busy} onClick={request}>Create verification request</Button>
      {fresh && <Share token={fresh.token} code={fresh.short_code} expires={fresh.expires_at} />}
      {open.filter((r) => !fresh || r.token !== fresh.token).map((r) => (
        <div key={r.id}><p className="mt-4 text-sm font-semibold">Waiting on {r.verifier_name}</p><Share token={r.token} code={r.short_code} expires={r.expires_at} /></div>
      ))}
    </Panel>
  );
}

export function EvidenceEditor() {
  const { id } = useParams();
  const { profile } = useAuth();
  const { sectorName, sector, competencies } = useCatalog();
  const [run, busy] = useAction();
  const state = useAsync(async () => {
    const e = unwrap(await supabase.from('evidence').select('*, evidence_competencies(competency_id, rating), evidence_media(*)').eq('id', id).maybeSingle());
    const requests = e && !e.verifier_org_id && e.status !== 'verified' ? unwrap(await supabase.from('verification_requests').select('*').eq('evidence_id', id).order('created_at', { ascending: false })) : [];
    return { e, requests };
  }, [id]);

  return (
    <Async state={state}>{({ e, requests }) => {
      if (!e) return <Empty>That record wasn't found. <Link to="/evidence">Back to evidence</Link></Empty>;
      const pro = new Set(competencies.filter((c) => c.category === 'professional').map((c) => c.id));
      return (
        <>
          <p className="mb-3 text-sm"><Link to="/evidence">Back to evidence</Link></p>
          <PageHeader title={e.title} sub={sectorName(e.sector_id) + (e.context_title ? ', ' + e.context_title : ', logged by you')}
            action={e.status === 'verified' ? <VerifiedStamp date={e.verified_at} /> : <StatusPill status={e.status} />} />
          {e.verifier_note && <Notice tone={e.status === 'declined' ? 'bad' : 'info'}><strong>{e.verified_by_name || 'Reviewer'}: </strong>{e.verifier_note}</Notice>}
          {e.status === 'verified'
            ? <VerifiedView e={e} reload={state.reload} />
            : e.status === 'submitted'
              ? <Submitted e={e} run={run} busy={busy} reload={state.reload} requests={requests} />
              : <EvidenceForm key={e.updated_at} e={e} sectorObj={sector(e.sector_id)} pro={pro} profile={profile} reload={state.reload} />}
          {!e.verifier_org_id && (e.status === 'draft' || e.status === 'submitted') && e.evidence_competencies.length > 0 && (
            <VerificationPanel evidence={e} requests={requests} onChanged={state.reload} />
          )}
        </>
      );
    }}</Async>
  );
}

function Submitted({ e, run, busy, reload, requests }) {
  const back = () => run(async () => { unwrap(await supabase.from('evidence').update({ status: 'draft' }).eq('id', e.id)); reload(); }, 'Moved back to draft.');
  const { compName } = useCatalog();
  return (
    <Panel>
      <p className="mb-2">{e.description}</p>
      <div className="mb-3 flex flex-wrap gap-1.5">{e.evidence_competencies.map((c) => <Chip key={c.competency_id}>{compName(c.competency_id)}</Chip>)}</div>
      <MediaGrid media={e.evidence_media} />
      <Notice tone="wait">{e.verifier_org_id ? 'The employer has been notified and will review this.' : requests.length ? 'Waiting for your supervisor to sign off.' : 'Submitted. Create a verification request below.'}</Notice>
      <Button variant="ghost" small disabled={busy} onClick={back}>Withdraw to edit</Button>
    </Panel>
  );
}

function EvidenceForm({ e, sectorObj, pro, profile, reload }) {
  const [f, setF] = useState({
    title: e.title, description: e.description, link: e.link, hours: e.hours, type: e.evidence_type,
    comps: e.evidence_competencies.filter((c) => !pro.has(c.competency_id)).map((c) => c.competency_id),
  });
  const [run, busy] = useAction();
  const current = e.evidence_competencies.map((c) => c.competency_id);
  const types = (sectorObj && sectorObj.evidence_types) || [];

  const save = (status) => run(async () => {
    if (!f.title.trim()) throw new Error('Give the work a title.');
    if (f.link && !isHttpUrl(f.link)) throw new Error('Links must start with http:// or https://');
    if (status === 'submitted') {
      if (!f.description.trim()) throw new Error('Describe what you did before submitting.');
      if (!f.comps.length) throw new Error('Pick at least one competency this work shows.');
    }
    unwrap(await supabase.from('evidence').update({ title: f.title.trim(), description: f.description.trim(), link: f.link.trim(), hours: Number(f.hours) || 0, evidence_type: f.type, status }).eq('id', e.id));
    const drop = current.filter((c) => !f.comps.includes(c));
    const add = f.comps.filter((c) => !current.includes(c));
    if (drop.length) unwrap(await supabase.from('evidence_competencies').delete().eq('evidence_id', e.id).in('competency_id', drop));
    if (add.length) unwrap(await supabase.from('evidence_competencies').insert(add.map((c) => ({ evidence_id: e.id, competency_id: c }))));
    reload();
  }, status === 'submitted' ? 'Submitted for review.' : 'Saved.');

  const withdraw = () => run(async () => {
    if (!window.confirm('Delete this record?')) return false;
    unwrap(await supabase.from('evidence').delete().eq('id', e.id));
    window.location.assign('/evidence');
  });

  return (
    <Panel>
      <Field label="Title"><Input maxLength={120} value={f.title} onChange={(ev) => setF({ ...f, title: ev.target.value })} /></Field>
      <Field label="What you did" hint="Your part, what you used, and the result."><Textarea rows={5} value={f.description} onChange={(ev) => setF({ ...f, description: ev.target.value })} /></Field>
      <div className="grid gap-x-4 sm:grid-cols-3">
        <Field label="Link (optional)"><Input type="url" value={f.link} onChange={(ev) => setF({ ...f, link: ev.target.value })} placeholder="https://" /></Field>
        <Field label="Hours worked"><Input type="number" min="0" step="0.5" value={f.hours} onChange={(ev) => setF({ ...f, hours: ev.target.value })} /></Field>
        <Field label="Type of work"><Select value={f.type} onChange={(ev) => setF({ ...f, type: ev.target.value })} placeholder="Choose" options={types.map((t) => ({ v: t, n: t }))} /></Field>
      </div>
      <div className="mb-4"><span className="label">Competencies this work shows</span><CompetencyChecks sectorId={e.sector_id} value={f.comps} onChange={(comps) => setF({ ...f, comps })} /></div>
      <MediaEditor evidence={e} editable onChanged={reload} />
      <div className="flex flex-wrap gap-2">
        <Button variant="ghost" disabled={busy} onClick={() => save('draft')}>Save draft</Button>
        {e.verifier_org_id && <Button variant="go" disabled={busy} onClick={() => save('submitted')}>Submit for employer review</Button>}
        {!e.verifier_org_id && <Button variant="go" disabled={busy} onClick={() => save('draft').then((ok) => ok && window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }))}>Save and ask a supervisor below</Button>}
        <Button variant="danger" disabled={busy} onClick={withdraw}>Delete</Button>
      </div>
    </Panel>
  );
}

function VerifiedView({ e, reload }) {
  const [run] = useAction();
  const toggle = (on) => run(async () => { unwrap(await supabase.from('evidence').update({ is_public: on }).eq('id', e.id)); reload(); }, on ? 'Shown on your public profile.' : 'Hidden from your public profile.');
  return (
    <Panel>
      <p className="mb-2 whitespace-pre-wrap">{e.description}</p>
      {e.link && isHttpUrl(e.link) && <p className="mb-2"><a href={e.link} target="_blank" rel="noreferrer noopener">Open the work</a></p>}
      <MediaGrid media={e.evidence_media} />
      <RatingsBlock rows={e.evidence_competencies} />
      <div className="my-3"><AssuranceBadge evidence={e} /></div>
      <CheckChip checked={e.is_public} onChange={toggle}>Show on my public profile</CheckChip>
      <p className="mt-1 text-xs text-ink-soft">Verified work is locked. Only you decide whether it appears on your portfolio.</p>
    </Panel>
  );
}

/* --------------------------------------------------------- assessments */
export function StudentAssessments() {
  const { profile } = useAuth();
  const { compName } = useCatalog();
  const [run] = useAction();
  const state = useAsync(async () => unwrap(await supabase.from('assessment_results').select('*, assessment_result_levels(competency_id, level)').eq('student_id', profile.id).order('assessed_at', { ascending: false })), []);
  const toggle = (r, on) => run(async () => { unwrap(await supabase.from('assessment_results').update({ is_public: on }).eq('id', r.id)); state.reload(); });
  return (
    <>
      <PageHeader title="Assessments" sub="Results from your institution and from employers. Each one feeds your competency record." />
      <Async state={state}>{(list) => !list.length ? <Empty>No results yet. When an instructor or employer assesses you, it appears here.</Empty> : list.map((r) => (
        <Card key={r.id} status="verified">
          <h3>{r.assessment_title}</h3>
          <p className="text-sm text-ink-soft">{r.owner_org_name}, assessed by {r.assessor_name}, {fmtDate(r.assessed_at)}</p>
          {r.assessment_result_levels.map((l) => <LevelRow key={l.competency_id} name={compName(l.competency_id)} level={l.level} />)}
          {r.note && <p className="mt-2 text-sm">{r.note}</p>}
          <div className="mt-3"><CheckChip checked={r.is_public} onChange={(on) => toggle(r, on)}>Show on my public profile</CheckChip></div>
        </Card>
      ))}</Async>
    </>
  );
}

/* ------------------------------------------------------------- journey */
const OUTCOME_STATUS = [
  { v: 'studying', n: 'Still studying' }, { v: 'seeking', n: 'Looking for work' }, { v: 'employed', n: 'Employed' },
  { v: 'self_employed', n: 'Self-employed' }, { v: 'further_study', n: 'Further study' }, { v: 'not_seeking', n: 'Not looking' },
];
const RELATED = [{ v: 'directly', n: 'Directly related to my field' }, { v: 'partly', n: 'Partly related' }, { v: 'not', n: 'Not related' }];

export function Journey() {
  return (
    <>
      <PageHeader title="Your journey" sub="From enrolment to employment. This is what lets your institution and employers see how well the pathway works." />
      <Enrolments />
      <Requirements />
      <Interest />
      <OutcomePanel />
      <FeedbackReceived />
    </>
  );
}

function Enrolments() {
  const { profile } = useAuth();
  const [run, busy] = useAction();
  const [pick, setPick] = useState('');
  const state = useAsync(async () => {
    const mine = unwrap(await supabase.from('enrollments').select('*, programmes(name), organizations(name)').eq('student_id', profile.id).order('created_at', { ascending: false }));
    const progs = unwrap(await supabase.from('programmes').select('id, name, institution_org_id, organizations(name)'));
    return { mine, progs: progs.filter((p) => p.organizations) };
  }, []);
  const request = () => run(async () => {
    const p = state.data.progs.find((x) => x.id === pick);
    if (!p) throw new Error('Choose a programme.');
    unwrap(await supabase.from('enrollments').insert({ student_id: profile.id, institution_org_id: p.institution_org_id, programme_id: p.id, status: 'requested' }));
    setPick(''); state.reload();
  }, 'Request sent to the institution.');
  return (
    <Panel title="Enrolment">
      <Async state={state}>{({ mine, progs }) => (
        <>
          {mine.map((m) => (
            <div key={m.id} className="mb-2 flex flex-wrap items-center justify-between gap-2 border-b border-[#EDF1F6] pb-2">
              <span><strong>{m.programmes ? m.programmes.name : 'Programme'}</strong>, {m.organizations ? m.organizations.name : ''}{m.graduated_on ? ', graduated ' + fmtDate(m.graduated_on) : ''}</span>
              <Pill tone={m.status === 'confirmed' || m.status === 'graduated' ? 'ok' : m.status === 'withdrawn' ? 'no' : 'wait'}>{m.status}</Pill>
            </div>
          ))}
          {!mine.length && <p className="mb-3 text-sm text-ink-soft">You haven't linked an institution yet. Enrolling lets teachers assess you and lets your institution learn from graduate outcomes (only with your consent).</p>}
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[260px] flex-1"><Field label="Request enrolment" className="mb-0"><Select value={pick} onChange={(e) => setPick(e.target.value)} placeholder="Choose a programme" options={progs.map((p) => ({ v: p.id, n: p.name + ', ' + p.organizations.name }))} /></Field></div>
            <Button disabled={busy || !pick} onClick={request}>Send request</Button>
          </div>
        </>
      )}</Async>
    </Panel>
  );
}

function Requirements() {
  const state = useAsync(async () => unwrap(await supabase.rpc('my_requirement_progress')), []);
  return (
    <Async state={state}>{(list) => !list.length ? null : (
      <Panel title="Licensing and accreditation progress">
        {list.map((r) => (
          <div key={r.requirement_id} className="mb-3">
            <div className="flex flex-wrap items-center justify-between gap-2"><strong>{r.title}</strong><Pill tone={r.met ? 'ok' : 'wait'}>{r.met ? 'Requirement met' : 'In progress'}</Pill></div>
            <p className="text-sm text-ink-soft">{r.regulator}: {Number(r.hours)} of {Number(r.min_hours)} verified hours, {r.met_competencies} of {r.total_competencies} competencies at the required level.</p>
            <div className="mt-1 h-2.5 overflow-hidden rounded-sm bg-[#E6ECF4]"><div className="h-full bg-ok" style={{ width: Math.min(100, r.min_hours > 0 ? (r.hours / r.min_hours) * 100 : 100) + '%' }} /></div>
          </div>
        ))}
      </Panel>
    )}</Async>
  );
}

function Interest() {
  const { profile } = useAuth();
  const state = useAsync(async () => unwrap(await supabase.from('talent_pipeline').select('*, organizations(name)').eq('student_id', profile.id)), []);
  return (
    <Async state={state}>{(list) => !list.length ? null : (
      <Panel title="Employers interested in you">
        {list.map((p) => <p key={p.id} className="mb-1"><strong>{p.organizations ? p.organizations.name : 'An employer'}</strong>: {p.stage} <span className="text-sm text-ink-soft">(updated {fmtDate(p.updated_at)})</span></p>)}
      </Panel>
    )}</Async>
  );
}

function OutcomePanel() {
  const { profile } = useAuth();
  const [run, busy] = useAction();
  const [emp, setEmp] = useState({ job: '', employer: '', sector: '', start: '', related: '' });
  const state = useAsync(async () => ({
    outcome: unwrap(await supabase.from('outcomes').select('*').eq('student_id', profile.id).maybeSingle()),
    jobs: unwrap(await supabase.from('employments').select('*').eq('student_id', profile.id).order('started_on', { ascending: false, nullsFirst: false })),
  }), []);
  const [o, setO] = useState(null);
  const cur = o || (state.data && state.data.outcome) || { status: 'studying', share_with_institution: false };

  const saveOutcome = () => run(async () => {
    unwrap(await supabase.from('outcomes').upsert({ student_id: profile.id, status: cur.status, share_with_institution: cur.share_with_institution }, { onConflict: 'student_id' }));
    state.reload();
  }, 'Saved.');
  const addJob = () => run(async () => {
    if (!emp.job.trim()) throw new Error('Enter your job title.');
    unwrap(await supabase.from('employments').insert({ student_id: profile.id, job_title: emp.job.trim(), employer_name: emp.employer.trim(), sector_id: emp.sector || null, started_on: emp.start || null, related_to_field: emp.related || null }));
    setEmp({ job: '', employer: '', sector: '', start: '', related: '' }); state.reload();
  }, 'Added.');
  const setRelated = (j, v) => run(async () => { unwrap(await supabase.from('employments').update({ related_to_field: v || null }).eq('id', j.id)); state.reload(); });

  return (
    <Panel title="Where you are now">
      <Async state={state}>{({ jobs }) => (
        <>
          <div className="grid items-end gap-x-4 sm:grid-cols-2">
            <Field label="Status"><Select value={cur.status} onChange={(e) => setO({ ...cur, status: e.target.value })} options={OUTCOME_STATUS} /></Field>
            <div className="mb-4"><CheckChip checked={cur.share_with_institution} onChange={(on) => setO({ ...cur, share_with_institution: on })}>Share my outcome anonymously with my institution</CheckChip></div>
          </div>
          <p className="mb-3 text-xs text-ink-soft">Your institution only ever sees combined figures for groups of five or more graduates, never your name. It helps them improve the courses.</p>
          <Button disabled={busy} onClick={saveOutcome}>Save</Button>
          <h4 className="mb-2 mt-6">Jobs</h4>
          {jobs.map((j) => (
            <div key={j.id} className="mb-2 flex flex-wrap items-center justify-between gap-2 border-b border-[#EDF1F6] pb-2">
              <span><strong>{j.job_title}</strong>{j.employer_name ? ', ' + j.employer_name : ''}{j.started_on ? ', from ' + fmtDate(j.started_on) : ''} {j.employer_confirmed && <Pill tone="ok">Confirmed by employer</Pill>}</span>
              <select className="input w-56" aria-label={'Relevance of ' + j.job_title} value={j.related_to_field || ''} onChange={(e) => setRelated(j, e.target.value)}>
                <option value="">Relevance to your field</option>{RELATED.map((r) => <option key={r.v} value={r.v}>{r.n}</option>)}
              </select>
            </div>
          ))}
          <div className="mt-3 grid gap-x-4 sm:grid-cols-3">
            <Field label="Job title"><Input value={emp.job} onChange={(e) => setEmp({ ...emp, job: e.target.value })} /></Field>
            <Field label="Employer"><Input value={emp.employer} onChange={(e) => setEmp({ ...emp, employer: e.target.value })} /></Field>
            <Field label="Started"><Input type="date" value={emp.start} onChange={(e) => setEmp({ ...emp, start: e.target.value })} /></Field>
            <Field label="Sector"><SectorSelect value={emp.sector} onChange={(sector) => setEmp({ ...emp, sector })} placeholder="Choose" /></Field>
            <Field label="Relevance"><Select value={emp.related} onChange={(e) => setEmp({ ...emp, related: e.target.value })} placeholder="Choose" options={RELATED} /></Field>
          </div>
          <Button variant="ghost" disabled={busy} onClick={addJob}>Add a job</Button>
        </>
      )}</Async>
    </Panel>
  );
}

function FeedbackReceived() {
  const { profile } = useAuth();
  const { compName } = useCatalog();
  const state = useAsync(async () => unwrap(await supabase.from('employer_feedback').select('*, organizations(name), feedback_competencies(competency_id, observed_level, expected_level)').eq('student_id', profile.id).order('created_at', { ascending: false })), []);
  return (
    <Async state={state}>{(list) => !list.length ? null : (
      <Panel title="Feedback from employers">
        {list.map((f) => (
          <div key={f.id} className="mb-3 border-b border-[#EDF1F6] pb-3">
            <p><strong>{f.organizations ? f.organizations.name : 'An employer'}</strong>: {PREPAREDNESS.find((p) => p.v === f.preparedness)?.n}{f.would_hire_again ? ', would hire again' : ''} <span className="text-sm text-ink-soft">{fmtDate(f.created_at)}</span></p>
            {f.comment && <p className="text-sm">{f.comment}</p>}
            {f.feedback_competencies.map((c) => <LevelRow key={c.competency_id} name={compName(c.competency_id)} level={c.observed_level} extra={c.expected_level ? 'expected ' + c.expected_level : ''} />)}
          </div>
        ))}
      </Panel>
    )}</Async>
  );
}

/* -------------------------------------------------------------- profile */
export function Profile() {
  const { profile, refresh } = useAuth();
  const [run, busy] = useAction();
  const [f, setF] = useState({ name: profile.full_name, headline: profile.headline, sectors: profile.sector_ids || [], pub: profile.public_profile, disc: profile.discoverable });
  const record = useAsync(async () => unwrap(await supabase.rpc('competency_record', { p_student: profile.id })), []);
  const url = window.location.origin + '/p/' + profile.slug;

  const save = () => run(async () => {
    if (!f.name.trim()) throw new Error('Enter your name.');
    unwrap(await supabase.from('profiles').update({ full_name: f.name.trim(), headline: f.headline.trim(), sector_ids: f.sectors, public_profile: f.pub, discoverable: f.disc }).eq('id', profile.id));
    await refresh();
  }, 'Profile saved.');

  return (
    <>
      <PageHeader title="Profile" sub="Your competency record is built from verified work and assessments. You decide who can see it." />
      <Panel>
        <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Headline" hint="One line employers see first."><Input maxLength={140} value={f.headline} onChange={(e) => setF({ ...f, headline: e.target.value })} placeholder="e.g. Final-year automotive student, strong on diagnostics" /></Field>
        <div className="mb-4"><span className="label">Sectors you care about</span><SectorChecks value={f.sectors} onChange={(sectors) => setF({ ...f, sectors })} /></div>
        <div className="mb-2"><CheckChip checked={f.pub} onChange={(pub) => setF({ ...f, pub })}>Make my portfolio public</CheckChip></div>
        <p className="mb-3 text-xs text-ink-soft">Only work and assessments you mark as public appear on it.</p>
        {f.pub && <Notice tone="info">Your public link: <a href={url}>{url}</a> <Button small variant="ghost" className="ml-2" onClick={() => navigator.clipboard && navigator.clipboard.writeText(url)}>Copy</Button></Notice>}
        <div className="mb-2"><CheckChip checked={f.disc} onChange={(disc) => setF({ ...f, disc })}>Let employers find me in talent search</CheckChip></div>
        <p className="mb-4 text-xs text-ink-soft">Employers see your name, headline and verified competency levels. They never see your email or private work. You can switch this off any time.</p>
        <Button disabled={busy} onClick={save}>Save profile</Button>
      </Panel>
      <h3 className="mb-2">Your verified competency record</h3>
      <Async state={record}>{(rows) => <CompetencyRecord rows={rows} />}</Async>
    </>
  );
}
