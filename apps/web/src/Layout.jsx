import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import { supabase } from './lib/supabase.js';
import { useAsync, unwrap } from './lib/hooks.js';
import { ROLE_LABEL, cx, fmtDate } from './lib/format.js';
import { Notice, Seal } from './ui.jsx';

export const NAV = {
  student: [['/', 'Dashboard'], ['/projects', 'Projects'], ['/internships', 'Internships'], ['/evidence', 'Evidence'], ['/assessments', 'Assessments'], ['/journey', 'Journey'], ['/profile', 'Profile']],
  employer: [['/', 'Dashboard'], ['/network', 'Network'], ['/standards', 'Standards'], ['/projects', 'Projects'], ['/internships', 'Internships'], ['/review', 'Review'], ['/talent', 'Talent'], ['/assessments', 'Assessments'], ['/feedback', 'Feedback']],
  institution: [['/', 'Dashboard'], ['/network', 'Network'], ['/standards', 'Standards'], ['/demand', 'Demand'], ['/gap', 'Skill gap'], ['/programmes', 'Programmes'], ['/enrollments', 'Enrolments'], ['/assessments', 'Assessments'], ['/outcomes', 'Outcomes'], ['/actions', 'Actions']],
  regulator: [['/', 'Dashboard'], ['/network', 'Network'], ['/requirements', 'Requirements'], ['/compliance', 'Compliance']],
};

function Bell() {
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const list = useAsync(async () => unwrap(await supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(15)), [open]);
  const items = list.data || [];
  const unread = items.filter((n) => !n.read_at).length;

  async function openItem(n) {
    if (!n.read_at) await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', n.id);
    setOpen(false);
    if (n.link) nav(n.link);
  }
  async function readAll() {
    await supabase.from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null);
    list.reload();
  }
  return (
    <div className="relative">
      <button type="button" className="relative rounded px-2 py-1 text-white hover:bg-white/10" aria-label={'Notifications, ' + unread + ' unread'} onClick={() => setOpen(!open)}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
        {unread > 0 && <span className="absolute -right-0.5 -top-0.5 rounded-full bg-[#6FD3AE] px-1.5 text-[10px] font-bold text-ink">{unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 max-h-96 w-80 overflow-auto rounded border border-line bg-white text-ink shadow-lg">
          <div className="flex items-center justify-between border-b border-line px-3 py-2 text-sm font-semibold">
            Notifications {unread > 0 && <button type="button" className="linkbtn text-xs" onClick={readAll}>Mark all read</button>}
          </div>
          {items.length === 0 && <p className="p-4 text-sm text-ink-soft">Nothing yet.</p>}
          {items.map((n) => (
            <button key={n.id} type="button" onClick={() => openItem(n)} className={cx('block w-full border-b border-[#EDF1F6] px-3 py-2 text-left text-sm hover:bg-paper', !n.read_at && 'bg-ok-bg/40')}>
              <span className="block font-semibold">{n.title}</span>
              {n.body && <span className="block text-ink-soft">{n.body}</span>}
              <span className="text-xs text-ink-soft">{fmtDate(n.created_at)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Layout() {
  const { profile, org, role, isAdmin, signOut } = useAuth();
  const tabs = [...(NAV[role] || [])];
  if (isAdmin) tabs.push(['/admin', 'Admin']);
  return (
    <div className="min-h-screen">
      <header className="bg-ink text-white">
        <div className="mx-auto flex min-h-14 max-w-6xl items-center justify-between gap-4 px-5">
          <div className="flex items-center gap-2.5 font-display text-xl font-extrabold"><Seal size={26} className="text-[#6FD3AE]" />SkillProof</div>
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden opacity-85 sm:inline">{profile.full_name}{org ? ', ' + org.name : ''} ({ROLE_LABEL[role]})</span>
            <Bell />
            <button type="button" className="underline" onClick={signOut}>Sign out</button>
          </div>
        </div>
      </header>
      <nav className="border-b border-line bg-white" aria-label="Sections">
        <div className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-5">
          {tabs.map(([to, label]) => (
            <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => cx('whitespace-nowrap border-b-[3px] px-3.5 pb-[11px] pt-3.5 text-sm font-semibold no-underline', isActive ? 'border-ok text-ink' : 'border-transparent text-ink-soft hover:text-ink')}>{label}</NavLink>
          ))}
        </div>
      </nav>
      <main className="mx-auto max-w-6xl px-5 pb-16 pt-7">
        {org && org.status !== 'approved' && (
          <Notice tone="wait"><strong>{org.status === 'suspended' ? 'Suspended. ' : 'Awaiting approval. '}</strong>
            {org.status === 'suspended' ? 'Contact the platform team.' : 'You can look around, but you can\'t publish, verify or record anything until the platform team approves your organisation.'}</Notice>
        )}
        <Outlet />
      </main>
    </div>
  );
}
