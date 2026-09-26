import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { supabase } from '../lib/supabase.js';
import { Button, Field, Input, LevelRow, Notice, Seal, Select, SectorChecks, useAction } from '../ui.jsx';

const ROLES = [
  { v: 'student', n: "I'm a student or graduate" },
  { v: 'employer', n: 'I represent an employer' },
  { v: 'institution', n: 'I represent a university, college or training institute' },
  { v: 'regulator', n: 'I represent a regulator or professional body' },
];

export default function AuthPage() {
  const { session } = useAuth();
  const [mode, setMode] = useState('signin');
  const [f, setF] = useState({ email: '', password: '', role: 'student', name: '', org: '', sectors: [] });
  const [note, setNote] = useState('');
  const [run, busy] = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  if (session) return <Navigate to="/" replace />;

  async function submit(e) {
    e.preventDefault();
    if (!f.email.trim() || !f.password) return run(async () => { throw new Error('Enter your email and password.'); });
    if (mode === 'signup') {
      if (!f.name.trim()) return run(async () => { throw new Error('Enter your name.'); });
      if (f.role !== 'student' && !f.org.trim()) return run(async () => { throw new Error("Enter your organisation's name."); });
    }
    await run(async () => {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email: f.email.trim(), password: f.password });
        if (error) throw new Error(error.message);
      } else {
        const { data, error } = await supabase.auth.signUp({
          email: f.email.trim(), password: f.password,
          options: { data: { role: f.role, full_name: f.name.trim(), org_name: f.org.trim(), sector_ids: f.sectors } },
        });
        if (error) throw new Error(error.message);
        if (!data.session) setNote('Check your email for a confirmation link, then sign in.');
      }
    });
  }

  return (
    <div className="mx-auto grid max-w-6xl gap-12 px-5 py-14 lg:grid-cols-[1.2fr_1fr]">
      <div>
        <div className="mb-6 flex items-center gap-2.5 font-display text-xl font-extrabold"><Seal size={28} />SkillProof</div>
        <h1>Show what you can do, verified by the people who hire.</h1>
        <p className="mt-4 max-w-xl text-lg text-ink-soft">Industry sets the standards, universities teach and assess against them, students build verified evidence, employers discover and hire, and the outcomes flow back into the curriculum.</p>
        <article className="mt-8 max-w-lg rounded border border-l-[5px] border-line border-l-ok bg-white p-4">
          <div className="flex items-start justify-between gap-3">
            <div><h3>Stock-tracking app for a hardware shop</h3><p className="text-sm text-ink-soft">Example record. Signed off by the shop owner.</p></div>
            <div className="flex flex-col items-center text-xs font-semibold text-ok"><Seal size={44} />Verified</div>
          </div>
          <div className="mt-2">
            <LevelRow name="Databases and data modelling" level={3} />
            <LevelRow name="Testing and debugging" level={2} />
            <LevelRow name="Communication" level={3} />
          </div>
        </article>
      </div>
      <form onSubmit={submit} className="self-start rounded border border-line bg-white p-6">
        <h2 className="mb-4">{mode === 'signin' ? 'Sign in' : 'Create your account'}</h2>
        {note && <Notice tone="ok">{note}</Notice>}
        <Field label="Email"><Input type="email" autoComplete="email" value={f.email} onChange={set('email')} /></Field>
        <Field label="Password"><Input type="password" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} value={f.password} onChange={set('password')} /></Field>
        {mode === 'signup' && (
          <>
            <Field label="I am"><Select value={f.role} onChange={set('role')} options={ROLES} /></Field>
            <Field label="Your name"><Input autoComplete="name" value={f.name} onChange={set('name')} /></Field>
            {f.role !== 'student' && <Field label="Organisation name"><Input value={f.org} onChange={set('org')} /></Field>}
            <div className="mb-4">
              <span className="label">{f.role === 'student' ? 'Sectors you care about' : f.role === 'employer' ? 'Sectors you hire in' : 'Sectors you cover'}</span>
              <SectorChecks value={f.sectors} onChange={(sectors) => setF({ ...f, sectors })} />
            </div>
          </>
        )}
        <Button type="submit" disabled={busy}>{mode === 'signin' ? 'Sign in' : 'Create account'}</Button>
        <p className="mt-4 text-sm">
          <button type="button" className="linkbtn" onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setNote(''); }}>{mode === 'signin' ? 'New here? Create an account' : 'Already registered? Sign in'}</button>
          {mode === 'signin' && <> · <button type="button" className="linkbtn" onClick={async () => {
            if (!f.email.trim()) return run(async () => { throw new Error('Enter your email first.'); });
            await run(async () => { const { error } = await supabase.auth.resetPasswordForEmail(f.email.trim()); if (error) throw new Error(error.message); }, 'Password reset link sent.');
          }}>Forgot password?</button></>}
        </p>
        {mode === 'signup' && f.role !== 'student' && <p className="mt-3 text-xs text-ink-soft">Organisation accounts are reviewed by the platform team before they can publish, verify or record anything.</p>}
      </form>
    </div>
  );
}
