import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { supabase } from '../lib/supabase.js';
import { BrandMark, Button, Field, Input, LevelRow, Notice, Seal, Select, SectorChecks, useAction } from '../ui.jsx';

const ROLES = [
  { v: 'student', n: "I'm a student or graduate" },
  { v: 'employer', n: 'I represent an employer' },
  { v: 'institution', n: 'I represent a university, college or training institute' },
  { v: 'regulator', n: 'I represent a regulator or professional body' },
];

const appRedirectUrl = () => `${window.location.origin}${import.meta.env.BASE_URL}`;
const isEmailLimit = (message = '') => /email rate limit|rate limit exceeded|too many requests/i.test(message);

export default function AuthPage() {
  const { session, recovery, clearRecovery } = useAuth();
  const [mode, setMode] = useState(recovery ? 'recovery' : 'signin');
  const [f, setF] = useState({ email: '', password: '', newPassword: '', role: 'student', name: '', org: '', sectors: [] });
  const [note, setNote] = useState('');
  const [emailCooldown, setEmailCooldown] = useState(0);
  const [run, busy] = useAction();
  const set = (k) => (e) => setF((old) => ({ ...old, [k]: e.target.value }));

  useEffect(() => {
    if (recovery) setMode('recovery');
  }, [recovery]);

  useEffect(() => {
    if (emailCooldown <= 0) return undefined;
    const timer = window.setTimeout(() => setEmailCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [emailCooldown]);

  if (session && !recovery && mode !== 'recovery') return <Navigate to="/" replace />;

  async function submit(e) {
    e.preventDefault();
    if (mode === 'recovery') {
      if (f.newPassword.length < 8) return run(async () => { throw new Error('Choose a password with at least 8 characters.'); });
      await run(async () => {
        const { error } = await supabase.auth.updateUser({ password: f.newPassword });
        if (error) throw new Error(error.message);
        setF((old) => ({ ...old, password: '', newPassword: '' }));
        setNote('Your password has been updated. You can now continue to SkillProof.');
        setMode('signin');
        clearRecovery();
      });
      return;
    }

    if (!f.email.trim() || (mode !== 'reset' && !f.password)) {
      return run(async () => { throw new Error(mode === 'reset' ? 'Enter your email address.' : 'Enter your email and password.'); });
    }
    if (mode === 'signup') {
      if (!f.name.trim()) return run(async () => { throw new Error('Enter your name.'); });
      if (f.role !== 'student' && !f.org.trim()) return run(async () => { throw new Error("Enter your organisation's name."); });
    }

    await run(async () => {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email: f.email.trim(), password: f.password });
        if (error) throw new Error(error.message);
        return;
      }

      if (mode === 'reset') {
        if (emailCooldown > 0) throw new Error(`Please wait ${emailCooldown} seconds before requesting another email.`);
        const { error } = await supabase.auth.resetPasswordForEmail(f.email.trim(), { redirectTo: appRedirectUrl() });
        if (error) {
          if (isEmailLimit(error.message)) {
            setEmailCooldown(60);
            setNote('SkillProof has reached the email provider’s sending limit. Please wait before trying again. If this continues, the platform administrator needs to configure a custom SMTP provider in Supabase.');
            return;
          }
          throw new Error(error.message);
        }
        setEmailCooldown(60);
        setNote('If this email belongs to a SkillProof account, a password reset link will be sent. Check your inbox and spam folder.');
        return;
      }

      const { data, error } = await supabase.auth.signUp({
        email: f.email.trim(),
        password: f.password,
        options: {
          emailRedirectTo: appRedirectUrl(),
          data: { role: f.role, full_name: f.name.trim(), org_name: f.org.trim(), sector_ids: f.sectors },
        },
      });
      if (error) {
        if (isEmailLimit(error.message)) {
          setEmailCooldown(60);
          setNote('SkillProof has reached the email provider’s sending limit. Please wait before trying again. If this continues, the platform administrator needs to configure a custom SMTP provider in Supabase.');
          return;
        }
        throw new Error(error.message);
      }
      if (!data.session) setNote('Your account request has been received. Check your email for the confirmation link. The link will return you to SkillProof.');
    });
  }

  const isReset = mode === 'reset';
  const isRecovery = mode === 'recovery';
  const isSignup = mode === 'signup';
  const title = isRecovery ? 'Choose a new password' : isReset ? 'Reset your password' : isSignup ? 'Create your account' : 'Sign in';

  return (
    <div className="auth-shell mx-auto grid max-w-6xl gap-10 px-5 py-10 lg:grid-cols-[1.1fr_.9fr] lg:py-14">
      <div className="auth-intro">
        <div className="mb-7 flex items-center gap-3 font-display text-xl font-extrabold"><BrandMark size={38} className="shadow-sm" /><span>SkillProof<span className="ml-2 text-xs font-semibold uppercase tracking-[.16em] text-[#A7B9AF]">Skills. Evidence. Opportunity.</span></span></div>
        <p className="mb-3 text-sm font-bold uppercase tracking-[.16em] text-[#D6A85B]">A better signal for talent</p>
        <h1 className="max-w-xl text-white">Good work should speak for itself.</h1>
        <p className="mt-4 max-w-xl text-lg leading-relaxed text-[#D7E1DC]">Connect what people learn with what they can demonstrate—and give employers a clearer view of real ability.</p>
        <article className="auth-example mt-8 max-w-lg rounded-xl p-5">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div><p className="mb-1 text-xs font-bold uppercase tracking-wider text-[#6D8379]">Example portfolio item</p><h3>Stock-tracking app for a hardware shop</h3><p className="mt-1 text-sm text-[#5E6E66]">Project evidence reviewed by a supervisor</p></div>
            <div className="flex flex-col items-center text-xs font-semibold text-[#27634F]"><Seal size={42} />Verified</div>
          </div>
          <LevelRow name="Databases and data modelling" level={3} />
          <LevelRow name="Testing and debugging" level={2} />
          <LevelRow name="Communication" level={3} />
        </article>
      </div>

      <form onSubmit={submit} className="auth-form self-start rounded-xl border border-[#DDE5DF] bg-white p-6 shadow-xl sm:p-8">
        <div className="mb-1 text-xs font-bold uppercase tracking-[.14em] text-[#6D8379]">Your workspace</div>
        <h2 className="mb-5">{title}</h2>
        {note && <Notice tone={note.toLowerCase().includes('limit') ? 'wait' : 'info'}>{note}</Notice>}
        {!isRecovery && <Field label="Email address"><Input type="email" autoComplete="email" value={f.email} onChange={set('email')} required /></Field>}
        {isRecovery ? (
          <Field label="New password" hint="Use at least 8 characters."><Input type="password" autoComplete="new-password" value={f.newPassword} onChange={set('newPassword')} minLength={8} required /></Field>
        ) : !isReset && <Field label="Password"><Input type="password" autoComplete={isSignup ? 'new-password' : 'current-password'} value={f.password} onChange={set('password')} required minLength={isSignup ? 8 : undefined} /></Field>}
        {isSignup && (
          <>
            <Field label="I am"><Select value={f.role} onChange={set('role')} options={ROLES} /></Field>
            <Field label="Your name"><Input autoComplete="name" value={f.name} onChange={set('name')} required /></Field>
            {f.role !== 'student' && <Field label="Organisation name"><Input value={f.org} onChange={set('org')} required /></Field>}
            <div className="mb-5">
              <span className="label">{f.role === 'student' ? 'Sectors you care about' : f.role === 'employer' ? 'Sectors you hire in' : 'Sectors you cover'}</span>
              <SectorChecks value={f.sectors} onChange={(sectors) => setF((old) => ({ ...old, sectors }))} />
            </div>
          </>
        )}
        <Button type="submit" disabled={busy || ((isReset || isSignup) && emailCooldown > 0)} className="w-full py-2.5">
          {busy ? 'Please wait…' : isRecovery ? 'Update password' : isReset ? (emailCooldown > 0 ? `Try again in ${emailCooldown}s` : 'Send reset link') : isSignup ? (emailCooldown > 0 ? `Try again in ${emailCooldown}s` : 'Create account') : 'Sign in'}
        </Button>
        {!isRecovery && (
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[#E8EDE9] pt-4 text-sm">
            <button type="button" className="linkbtn" onClick={() => { setMode(isSignup ? 'signin' : 'signup'); setNote(''); }}>{isSignup ? 'Already registered? Sign in' : 'Create an account'}</button>
            {mode === 'signin' && <button type="button" className="linkbtn" onClick={() => { setMode('reset'); setNote(''); }}>Forgot password?</button>}
            {isReset && <button type="button" className="linkbtn" onClick={() => { setMode('signin'); setNote(''); }}>Back to sign in</button>}
          </div>
        )}
        {isSignup && f.role !== 'student' && <p className="mt-4 text-xs leading-relaxed text-[#66766D]">Organisation workspaces start in pending status. A platform administrator must approve the organisation before it can publish or verify records.</p>}
        {isSignup && <p className="mt-4 text-xs leading-relaxed text-[#66766D]">By creating an account, you agree to provide accurate information and only share evidence you are authorised to use.</p>}
      </form>
    </div>
  );
}
