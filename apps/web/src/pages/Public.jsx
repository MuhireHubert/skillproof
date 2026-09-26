import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useCatalog } from '../catalog.jsx';
import { api } from '../lib/api.js';
import { supabase } from '../lib/supabase.js';
import { useAsync, unwrap } from '../lib/hooks.js';
import { fmtDate, isHttpUrl } from '../lib/format.js';
import { Async, Button, Card, Chip, Empty, Field, Input, LevelLegend, LevelSelect, LevelRow, Notice, Seal, Textarea, VerifiedStamp, useAction } from '../ui.jsx';
import { AssuranceBadge, CompetencyRecord, MediaGrid, RatingsBlock } from './shared.jsx';

function PublicShell({ children }) {
  return (
    <div className="min-h-screen">
      <header className="bg-ink text-white"><div className="mx-auto flex min-h-14 max-w-4xl items-center gap-2.5 px-5 font-display text-xl font-extrabold"><Seal size={26} className="text-[#6FD3AE]" />SkillProof</div></header>
      <main className="mx-auto max-w-4xl px-5 pb-16 pt-8">{children}</main>
    </div>
  );
}

// Opt-in portfolio: only work the student marked public, only verified.
export function PublicProfile() {
  const { slug } = useParams();
  const { sectorName } = useCatalog();
  const state = useAsync(async () => {
    const p = unwrap(await supabase.from('public_profiles').select('*').eq('slug', slug).maybeSingle());
    if (!p) return null;
    const [record, evidence, results] = await Promise.all([
      supabase.rpc('competency_record', { p_student: p.id }).then(unwrap),
      supabase.from('evidence').select('*, evidence_competencies(competency_id, rating), evidence_media(*)')
        .eq('student_id', p.id).eq('is_public', true).eq('status', 'verified').order('verified_at', { ascending: false }).then(unwrap),
      supabase.from('assessment_results').select('*, assessment_result_levels(competency_id, level)')
        .eq('student_id', p.id).eq('is_public', true).order('assessed_at', { ascending: false }).then(unwrap),
    ]);
    return { p, record, evidence, results };
  }, [slug]);
  const { compName } = useCatalog();

  return (
    <PublicShell>
      <Async state={state}>
        {(d) => !d ? <Empty>This profile isn't available. It may be private or the link may be wrong.</Empty> : (
          <>
            <h1>{d.p.full_name}</h1>
            {d.p.headline && <p className="mt-2 text-lg text-ink-soft">{d.p.headline}</p>}
            <div className="mt-2 flex flex-wrap gap-1.5">{(d.p.sector_ids || []).map((s) => <Chip key={s}>{sectorName(s)}</Chip>)}</div>
            <h3 className="mb-2 mt-8">Verified competency record</h3>
            <CompetencyRecord rows={d.record} />
            <h3 className="mb-2 mt-8">Verified work</h3>
            {!d.evidence.length && <Empty>No public work yet.</Empty>}
            {d.evidence.map((e) => (
              <Card key={e.id} status="verified">
                <div className="flex items-start justify-between gap-3">
                  <div><h3>{e.title}</h3><p className="text-sm text-ink-soft">{sectorName(e.sector_id)}{e.hours > 0 ? ', ' + e.hours + ' hours' : ''}{e.context_title ? ', ' + e.context_title : ''}</p></div>
                  <VerifiedStamp date={e.verified_at} />
                </div>
                <p className="my-2">{e.description}</p>
                {e.link && isHttpUrl(e.link) && <p><a href={e.link} target="_blank" rel="noreferrer noopener">Open the work</a></p>}
                <MediaGrid media={e.evidence_media} />
                <RatingsBlock rows={e.evidence_competencies} />
                <div className="mt-2"><AssuranceBadge evidence={e} /></div>
                {e.verifier_note && <Notice tone="info"><strong>Note from the verifier: </strong>{e.verifier_note}</Notice>}
              </Card>
            ))}
            {d.results.length > 0 && <h3 className="mb-2 mt-8">Assessments</h3>}
            {d.results.map((r) => (
              <Card key={r.id} status="verified">
                <h3>{r.assessment_title}</h3>
                <p className="text-sm text-ink-soft">Assessed by {r.owner_org_name}, {fmtDate(r.assessed_at)}</p>
                {r.assessment_result_levels.map((l) => <LevelRow key={l.competency_id} name={compName(l.competency_id)} level={l.level} />)}
                {r.note && <p className="mt-2 text-sm">{r.note}</p>}
              </Card>
            ))}
          </>
        )}
      </Async>
    </PublicShell>
  );
}

// A supervisor without an account signs off work through this page (or by USSD).
export function VerifierSignoff() {
  const { token } = useParams();
  const [run, busy] = useAction();
  const [done, setDone] = useState('');
  const [form, setForm] = useState({ name: '', role: '', note: '', ratings: {} });
  const state = useAsync(() => api.get('/api/verify/' + encodeURIComponent(token), false), [token]);

  async function send(decision) {
    const ratings = {};
    for (const [k, v] of Object.entries(form.ratings)) if (v) ratings[k] = v;
    const ok = await run(async () => {
      const comps = state.data.competencies;
      if (decision === 'verified' && comps.some((c) => !ratings[c.id])) throw new Error('Rate every competency before verifying.');
      if (decision !== 'verified' && !form.note.trim()) throw new Error('Add a note so the student knows what happens next.');
      await api.post('/api/verify/' + encodeURIComponent(token), { decision, ratings, note: form.note, verifierName: form.name, verifierRole: form.role }, false);
    });
    if (ok) setDone(decision);
  }

  return (
    <PublicShell>
      {done ? (
        <Notice tone="ok"><strong>Thank you.</strong> {done === 'verified' ? 'Your sign-off has been recorded on the student’s profile.' : 'The student has been told what happens next.'}</Notice>
      ) : (
        <Async state={state}>
          {(d) => (
            <>
              <h2>Verify {d.student_name}'s work</h2>
              <p className="mb-4 text-ink-soft">Requested for {d.verifier_name}{d.verifier_role ? ' (' + d.verifier_role + ')' : ''}. No account needed. Your name is shown on the student's record.</p>
              <Card>
                <h3>{d.title}</h3>
                <p className="text-sm text-ink-soft">{d.sector_name}{d.evidence_type ? ', ' + d.evidence_type : ''}{Number(d.hours) > 0 ? ', ' + d.hours + ' hours' : ''}</p>
                <p className="my-2 whitespace-pre-wrap">{d.description}</p>
                {d.link && isHttpUrl(d.link) && <p><a href={d.link} target="_blank" rel="noreferrer noopener">Open the work</a></p>}
                <div className="my-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {d.media.filter((m) => m.url).map((m, i) => m.kind === 'image'
                    ? <a key={i} href={m.url} target="_blank" rel="noreferrer"><img src={m.url} alt={m.caption || 'Evidence photo'} className="h-28 w-full rounded object-cover" /></a>
                    : m.kind === 'video' ? <video key={i} src={m.url} controls className="h-28 w-full rounded bg-black" />
                    : <a key={i} href={m.url} target="_blank" rel="noreferrer" className="flex h-28 items-center justify-center rounded border border-line text-sm">Open document</a>)}
                </div>
              </Card>
              <LevelLegend />
              <h3 className="mb-2">Rate what they showed</h3>
              {d.competencies.map((c) => (
                <div key={c.id} className="mb-2 grid items-center gap-2 sm:grid-cols-[1fr_220px]">
                  <span>{c.name}</span>
                  <LevelSelect placeholder="Select level" value={form.ratings[c.id] || ''} onChange={(v) => setForm({ ...form, ratings: { ...form.ratings, [c.id]: v } })} aria-label={'Level for ' + c.name} />
                </div>
              ))}
              <div className="mt-4 grid gap-x-4 sm:grid-cols-2">
                <Field label="Your name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={d.verifier_name} /></Field>
                <Field label="Your role"><Input value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} placeholder={d.verifier_role || d.verifier_label} /></Field>
              </div>
              <Field label="Note to the student"><Textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="What went well, and what would move them up a level?" /></Field>
              <div className="flex flex-wrap gap-2">
                <Button variant="go" disabled={busy} onClick={() => send('verified')}>Verify</Button>
                <Button variant="ghost" disabled={busy} onClick={() => send('revision')}>Request changes</Button>
                <Button variant="danger" disabled={busy} onClick={() => send('declined')}>Decline</Button>
              </div>
              <p className="mt-4 text-xs text-ink-soft">Sign-offs from outside supervisors are labelled as attested by a supervisor, separate from employer-verified work.</p>
            </>
          )}
        </Async>
      )}
      <p className="mt-8 text-sm"><Link to="/auth">SkillProof home</Link></p>
    </PublicShell>
  );
}
