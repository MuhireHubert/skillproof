import { useMemo, useState } from 'react';
import { useAuth } from '../auth.jsx';
import { useCatalog } from '../catalog.jsx';
import { supabase } from '../lib/supabase.js';
import { useAsync, unwrap } from '../lib/hooks.js';
import { ROLE_LABEL, fmtDate } from '../lib/format.js';
import { Async, Button, Card, Chip, Empty, Field, Input, PageHeader, Panel, Pill, Stat, Textarea, Select, Notice, useAction } from '../ui.jsx';

const TABS = [
  ['overview', 'Overview'],
  ['sectors', 'Sectors'],
  ['competencies', 'Competencies'],
  ['organisations', 'Organisations'],
  ['users', 'Users & admins'],
  ['reports', 'Reports'],
  ['audit', 'Audit history'],
  ['settings', 'Settings'],
];
const blankSector = { name: '', archetype: 'project', verifier_label: '', evidence_types: '', active: true };
const blankCompetency = { sector_id: '', category: 'technical', name: '', description: '', active: true };
const slug = (value) => value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function DataError({ error }) {
  return error ? <Notice tone="wait">{error.message || String(error)}</Notice> : null;
}

function Metric({ label, value, hint }) {
  return <div className="rounded-xl border border-line bg-white p-4"><div className="text-sm text-ink-soft">{label}</div><div className="mt-1 text-2xl font-semibold tabular-nums">{value ?? '—'}</div>{hint && <div className="mt-1 text-xs text-ink-soft">{hint}</div>}</div>;
}

export default function Admin() {
  const { isAdmin, session, signOut } = useAuth();
  const { reload: reloadCatalog } = useCatalog();
  const [tab, setTab] = useState('overview');
  const [run, busy] = useAction();
  const [sectorForm, setSectorForm] = useState(null);
  const [competencyForm, setCompetencyForm] = useState(null);
  const [adminEmail, setAdminEmail] = useState('');
  const [settingsDraft, setSettingsDraft] = useState({});
  const [notice, setNotice] = useState('');

  const stats = useAsync(async () => unwrap(await supabase.rpc('dashboard_stats')), []);
  const sectors = useAsync(async () => unwrap(await supabase.from('sectors').select('*').order('name')), []);
  const competencies = useAsync(async () => unwrap(await supabase.from('competencies').select('*').order('name')), []);
  const orgs = useAsync(async () => unwrap(await supabase.from('organizations').select('*, profiles(full_name, email)').order('created_at', { ascending: false })), []);
  const profiles = useAsync(async () => unwrap(await supabase.from('profiles').select('id, role, full_name, email, sector_ids, created_at, org_id').order('created_at', { ascending: false }).limit(300)), []);
  const admins = useAsync(async () => unwrap(await supabase.rpc('admin_list_admins')), []);
  const report = useAsync(async () => unwrap(await supabase.rpc('admin_report_summary')), []);
  const audit = useAsync(async () => unwrap(await supabase.from('admin_audit_logs').select('*').order('created_at', { ascending: false }).limit(150)), []);
  const settings = useAsync(async () => unwrap(await supabase.rpc('admin_get_settings')), []);

  const sectorRows = sectors.data || [];
  const competencyRows = competencies.data || [];
  const sectorMap = useMemo(() => new Map(sectorRows.map((s) => [s.id, s.name])), [sectorRows]);
  const sectorOptions = sectorRows.map((s) => ({ v: s.id, n: s.name + (s.active ? '' : ' (inactive)') }));
  const refreshAll = () => {
    stats.reload(); sectors.reload(); competencies.reload(); orgs.reload(); profiles.reload();
    admins.reload(); report.reload(); audit.reload(); settings.reload(); reloadCatalog();
  };

  if (!isAdmin) return <div className="mx-auto max-w-xl p-10"><h1>Administrator access required</h1><p className="mt-2 text-ink-soft">This workspace is only available to approved SkillProof platform administrators.</p><Button className="mt-4" onClick={() => window.location.assign(import.meta.env.BASE_URL)}>Return to SkillProof</Button></div>;

  const doAction = (fn, success) => run(async () => {
    setNotice('');
    await fn();
    setNotice(success);
    refreshAll();
  }, success);

  const saveSector = () => doAction(async () => {
    const f = sectorForm;
    if (!f?.name.trim() || !f.verifier_label.trim()) throw new Error('Enter a sector name and verification label.');
    const payload = {
      name: f.name.trim(),
      archetype: f.archetype,
      verifier_label: f.verifier_label.trim(),
      evidence_types: f.evidence_types.split(',').map((v) => v.trim()).filter(Boolean),
      active: Boolean(f.active),
    };
    if (f.id) unwrap(await supabase.from('sectors').update(payload).eq('id', f.id));
    else {
      const id = slug(f.name);
      if (!id) throw new Error('Use a sector name containing letters or numbers.');
      unwrap(await supabase.from('sectors').insert({ id, ...payload }));
    }
    setSectorForm(null);
  }, 'Sector saved. The active catalogue has been refreshed.');

  const saveCompetency = () => doAction(async () => {
    const f = competencyForm;
    if (!f?.name.trim()) throw new Error('Enter a competency name.');
    if (f.category === 'technical' && !f.sector_id) throw new Error('Choose a sector for a technical competency.');
    const payload = {
      name: f.name.trim(),
      description: f.description.trim(),
      category: f.category,
      sector_id: f.category === 'professional' ? null : f.sector_id,
      active: Boolean(f.active),
    };
    if (f.id) unwrap(await supabase.from('competencies').update(payload).eq('id', f.id));
    else {
      const id = (f.category === 'professional' ? 'pro-' : f.sector_id + '-') + slug(f.name);
      if (!id || id.endsWith('-')) throw new Error('Use a competency name containing letters or numbers.');
      unwrap(await supabase.from('competencies').insert({ id, ...payload }));
    }
    setCompetencyForm(null);
  }, 'Competency saved. The active framework has been refreshed.');

  const setOrganisationStatus = (org, status) => doAction(async () => {
    unwrap(await supabase.from('organizations').update({ status }).eq('id', org.id));
  }, org.name + ' marked ' + status + '.');

  const setAdministrator = (email, enabled) => doAction(async () => {
    unwrap(await supabase.rpc('admin_set_admin', { p_email: email, p_enabled: enabled }));
    setAdminEmail('');
  }, enabled ? 'Administrator access granted.' : 'Administrator access revoked.');

  const saveSetting = (key) => doAction(async () => {
    const value = settingsDraft[key] ?? (settings.data || []).find((s) => s.setting_key === key)?.setting_value ?? '';
    unwrap(await supabase.rpc('admin_update_setting', { p_key: key, p_value: value }));
  }, 'Setting saved.');

  const settingsRows = settings.data || [];
  const reportData = report.data || {};
  const userCounts = reportData.users_by_role || {};
  const orgCounts = reportData.organisations_by_status || {};
  const evidenceCounts = reportData.evidence_by_status || {};

  return (
    <div className="min-h-screen">
      <header className="mb-7 rounded-xl bg-ink p-5 text-white sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><p className="text-xs font-bold uppercase tracking-[.16em] text-[#D6A85B]">SkillProof · Platform operations</p><h1 className="mt-2 text-white">Administrator workspace</h1><p className="mt-2 max-w-2xl text-sm text-[#D7E1DC]">Manage the official sector catalogue, competency framework, organisations, platform access and operational settings.</p><p className="mt-3 text-xs text-[#D7E1DC]">Signed in as {session?.user?.email || 'platform administrator'}</p></div>
          <Button variant="ghost" className="border border-white/30 text-white hover:bg-white/10" onClick={signOut}>Sign out</Button>
        </div>
      </header>

      <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-line" aria-label="Administrator sections">
        {TABS.map(([id, label]) => <button key={id} type="button" onClick={() => setTab(id)} className={'whitespace-nowrap border-b-[3px] px-3 py-3 text-sm font-semibold ' + (tab === id ? 'border-ok text-ink' : 'border-transparent text-ink-soft hover:text-ink')}>{label}</button>)}
      </nav>
      {notice && <Notice tone="ok">{notice}</Notice>}

      {tab === 'overview' && <>
        <PageHeader title="Platform overview" sub="A high-level view of SkillProof operations and the actions that need attention." />
        <Async state={stats}>{(s) => <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Metric label="Pending organisations" value={s.admin?.pending_orgs ?? 0} hint="Require platform review" />
          <Metric label="Verified evidence" value={s.admin?.verified_evidence ?? 0} />
          <Metric label="Pending outbound messages" value={s.admin?.outbox_pending ?? 0} />
          <Metric label="Registered profiles" value={Object.values(s.admin?.users || {}).reduce((a, n) => a + Number(n || 0), 0)} />
        </div>}</Async>
        <div className="grid gap-4 md:grid-cols-2">
          <Panel title="Framework status"><div className="grid grid-cols-2 gap-3"><Metric label="Active sectors" value={sectorRows.filter((s) => s.active).length} /><Metric label="Active competencies" value={competencyRows.filter((c) => c.active !== false).length} /></div><Button className="mt-4" onClick={() => setTab('sectors')}>Manage sectors</Button> <Button variant="ghost" className="mt-4" onClick={() => setTab('competencies')}>Manage competencies</Button></Panel>
          <Panel title="Governance queue"><Metric label="Pending organisations" value={(orgs.data || []).filter((o) => o.status === 'pending').length} /><Button className="mt-4" onClick={() => setTab('organisations')}>Review organisations</Button></Panel>
        </div>
        <div className="mt-6 flex flex-wrap gap-2"><Button variant="ghost" onClick={refreshAll}>Refresh data</Button><Button variant="ghost" onClick={() => setTab('reports')}>Open reports</Button><Button variant="ghost" onClick={() => setTab('audit')}>Review audit history</Button></div>
      </>}

      {tab === 'sectors' && <>
        <PageHeader title="Sector catalogue" sub="Only active sectors appear in registration and sector selectors. Deactivation preserves historical records." />
        <div className="mb-4 flex flex-wrap gap-2"><Button onClick={() => setSectorForm({ ...blankSector })}>Add sector</Button><Button variant="ghost" onClick={() => { sectors.reload(); reloadCatalog(); }}>Refresh catalogue</Button></div>
        {sectorForm && <Panel title={sectorForm.id ? 'Edit sector' : 'Add sector'} className="mb-5">
          <div className="grid gap-x-4 sm:grid-cols-2">
            <Field label="Sector name"><Input value={sectorForm.name} onChange={(e) => setSectorForm({ ...sectorForm, name: e.target.value })} placeholder="e.g. Agriculture" /></Field>
            <Field label="Framework type"><Select value={sectorForm.archetype} onChange={(e) => setSectorForm({ ...sectorForm, archetype: e.target.value })} options={[{v:'project',n:'Project-based'}, {v:'regulated',n:'Regulated profession'}, {v:'handson',n:'Hands-on / practical'}]} /></Field>
            <Field label="Verification label"><Input value={sectorForm.verifier_label} onChange={(e) => setSectorForm({ ...sectorForm, verifier_label: e.target.value })} placeholder="e.g. Field supervisor" /></Field>
            <Field label="Evidence types" hint="Separate items with commas. Example: Portfolio, practical demonstration"><Input value={sectorForm.evidence_types} onChange={(e) => setSectorForm({ ...sectorForm, evidence_types: e.target.value })} /></Field>
          </div>
          <label className="mb-4 flex items-center gap-2 text-sm"><input type="checkbox" checked={sectorForm.active} onChange={(e) => setSectorForm({ ...sectorForm, active: e.target.checked })} /> Publish this sector for user selection</label>
          <div className="flex gap-2"><Button disabled={busy} onClick={saveSector}>Save sector</Button><Button variant="ghost" onClick={() => setSectorForm(null)}>Cancel</Button></div>
          {sectorForm.id && <p className="mt-3 text-xs text-ink-soft">Sector identifier is fixed after creation to protect links to existing records.</p>}
        </Panel>}
        <Async state={sectors}>{(rows) => !rows.length ? <Empty>No sectors found. Add the first sector above.</Empty> : <div className="overflow-x-auto rounded-xl border border-line bg-white"><table className="w-full text-left text-sm"><thead className="bg-paper text-ink-soft"><tr><th className="p-3">Sector</th><th className="p-3">Framework</th><th className="p-3">Verification</th><th className="p-3">Evidence types</th><th className="p-3">Status</th><th className="p-3">Actions</th></tr></thead><tbody>{rows.map((s) => <tr key={s.id} className="border-t border-line"><td className="p-3"><strong>{s.name}</strong><div className="text-xs text-ink-soft">{s.id}</div></td><td className="p-3">{s.archetype}</td><td className="p-3">{s.verifier_label}</td><td className="p-3">{(s.evidence_types || []).join(', ') || '—'}</td><td className="p-3"><Pill tone={s.active ? 'ok' : 'no'}>{s.active ? 'Active' : 'Inactive'}</Pill></td><td className="p-3"><div className="flex flex-wrap gap-1"><Button small variant="ghost" onClick={() => setSectorForm({ ...s, evidence_types: (s.evidence_types || []).join(', ') })}>Edit</Button><Button small variant={s.active ? 'danger' : 'go'} disabled={busy} onClick={() => doAction(async () => { unwrap(await supabase.from('sectors').update({ active: !s.active }).eq('id', s.id)); }, s.name + (s.active ? ' deactivated.' : ' activated.'))}>{s.active ? 'Deactivate' : 'Activate'}</Button></div></td></tr>)}</tbody></table></div>}</Async>
      </>}

      {tab === 'competencies' && <>
        <PageHeader title="Competency framework" sub="Maintain technical competencies per sector and professional competencies shared across sectors. Retiring a competency keeps existing evidence intact." />
        <div className="mb-4 flex flex-wrap gap-2"><Button onClick={() => setCompetencyForm({ ...blankCompetency })}>Add competency</Button><Button variant="ghost" onClick={() => competencies.reload()}>Refresh</Button></div>
        {competencyForm && <Panel title={competencyForm.id ? 'Edit competency' : 'Add competency'} className="mb-5">
          <div className="grid gap-x-4 sm:grid-cols-2">
            <Field label="Competency name"><Input value={competencyForm.name} onChange={(e) => setCompetencyForm({ ...competencyForm, name: e.target.value })} /></Field>
            <Field label="Category"><Select value={competencyForm.category} onChange={(e) => setCompetencyForm({ ...competencyForm, category: e.target.value, sector_id: e.target.value === 'professional' ? '' : competencyForm.sector_id })} options={[{v:'technical',n:'Technical / sector-specific'}, {v:'professional',n:'Professional / cross-sector'}]} /></Field>
            {competencyForm.category === 'technical' && <Field label="Sector"><Select value={competencyForm.sector_id} onChange={(e) => setCompetencyForm({ ...competencyForm, sector_id: e.target.value })} options={sectorOptions} placeholder="Choose sector" /></Field>}
          </div>
          <Field label="Description"><Textarea rows={3} value={competencyForm.description} onChange={(e) => setCompetencyForm({ ...competencyForm, description: e.target.value })} /></Field>
          <label className="mb-4 flex items-center gap-2 text-sm"><input type="checkbox" checked={competencyForm.active} onChange={(e) => setCompetencyForm({ ...competencyForm, active: e.target.checked })} /> Available for new assessments and framework selections</label>
          <div className="flex gap-2"><Button disabled={busy} onClick={saveCompetency}>Save competency</Button><Button variant="ghost" onClick={() => setCompetencyForm(null)}>Cancel</Button></div>
          {competencyForm.id && <p className="mt-3 text-xs text-ink-soft">Competency identifier is fixed to preserve existing evidence and assessment references.</p>}
        </Panel>}
        <Async state={competencies}>{(rows) => !rows.length ? <Empty>No competencies yet. Add one above.</Empty> : <div className="overflow-x-auto rounded-xl border border-line bg-white"><table className="w-full text-left text-sm"><thead className="bg-paper text-ink-soft"><tr><th className="p-3">Competency</th><th className="p-3">Sector / scope</th><th className="p-3">Description</th><th className="p-3">Status</th><th className="p-3">Actions</th></tr></thead><tbody>{rows.map((c) => <tr key={c.id} className="border-t border-line"><td className="p-3"><strong>{c.name}</strong><div className="text-xs text-ink-soft">{c.id}</div></td><td className="p-3">{c.category === 'professional' ? 'Cross-sector' : sectorMap.get(c.sector_id) || c.sector_id}</td><td className="p-3">{c.description || '—'}</td><td className="p-3"><Pill tone={c.active === false ? 'no' : 'ok'}>{c.active === false ? 'Inactive' : 'Active'}</Pill></td><td className="p-3"><div className="flex flex-wrap gap-1"><Button small variant="ghost" onClick={() => setCompetencyForm({ ...c, active: c.active !== false })}>Edit</Button><Button small variant={c.active === false ? 'go' : 'danger'} disabled={busy} onClick={() => doAction(async () => { unwrap(await supabase.from('competencies').update({ active: c.active === false }).eq('id', c.id)); }, c.name + (c.active === false ? ' activated.' : ' retired.'))}>{c.active === false ? 'Activate' : 'Retire'}</Button></div></td></tr>)}</tbody></table></div>}</Async>
      </>}

      {tab === 'organisations' && <>
        <PageHeader title="Organisation governance" sub="Approve organisations before they can publish, verify, assess or hire. Suspended organisations lose approved-organisation access." />
        <Async state={orgs}>{(rows) => !rows.length ? <Empty>No organisations registered yet.</Empty> : <div className="space-y-3">{rows.map((o) => <Card key={o.id}><div className="flex flex-wrap items-start justify-between gap-3"><div><h3>{o.name}</h3><p className="mt-1 text-sm text-ink-soft">{ROLE_LABEL[o.type] || o.type} · Registered {fmtDate(o.created_at)}</p>{o.profiles?.[0] && <p className="text-sm text-ink-soft">Contact: {o.profiles[0].full_name} ({o.profiles[0].email})</p>}<div className="mt-2 flex flex-wrap gap-1.5">{(o.sector_ids || []).map((id) => <Chip key={id}>{sectorMap.get(id) || id}</Chip>)}</div></div><Pill tone={o.status === 'approved' ? 'ok' : o.status === 'suspended' ? 'no' : 'wait'}>{o.status}</Pill></div><div className="mt-3 flex flex-wrap gap-2">{o.status !== 'approved' && <Button small variant="go" disabled={busy} onClick={() => setOrganisationStatus(o, 'approved')}>Approve</Button>}{o.status !== 'pending' && <Button small variant="ghost" disabled={busy} onClick={() => setOrganisationStatus(o, 'pending')}>Return to pending</Button>}{o.status !== 'suspended' && <Button small variant="danger" disabled={busy} onClick={() => setOrganisationStatus(o, 'suspended')}>Suspend</Button>}</div></Card>)}</div>}</Async>
      </>}

      {tab === 'users' && <>
        <PageHeader title="Users and administrators" sub="Review account profiles and manage platform-level administrator privileges. Only confirmed Supabase accounts can be promoted." />
        <Panel title="Grant administrator access" className="mb-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end"><div className="flex-1"><Field label="Confirmed account email"><Input type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} placeholder="person@example.com" /></Field></div><Button disabled={busy || !adminEmail.trim()} onClick={() => setAdministrator(adminEmail, true)}>Grant admin access</Button></div>
          <p className="text-xs text-ink-soft">The database checks that the account exists and its email is confirmed. Never grant admin access based only on a name supplied during registration.</p>
        </Panel>
        <Panel title="Current platform administrators" className="mb-5">
          <Async state={admins}>{(rows) => !rows.length ? <Empty>No administrators found.</Empty> : <div className="space-y-2">{rows.map((a) => <div key={a.admin_email} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line p-3"><div><strong>{a.admin_email}</strong>{a.admin_email === session?.user?.email?.toLowerCase() && <span className="ml-2 text-xs text-ink-soft">(you)</span>}</div><Button small variant="danger" disabled={busy || a.admin_email === session?.user?.email?.toLowerCase() || rows.length < 2} onClick={() => setAdministrator(a.admin_email, false)}>Revoke</Button></div>)}</div>}</Async>
        </Panel>
        <Panel title="Registered profiles">
          <Async state={profiles}>{(rows) => !rows.length ? <Empty>No profiles found. Platform admins without a profile are still able to use this workspace.</Empty> : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-paper text-ink-soft"><tr><th className="p-3">Person</th><th className="p-3">Role</th><th className="p-3">Sectors</th><th className="p-3">Registered</th></tr></thead><tbody>{rows.map((p) => <tr key={p.id} className="border-t border-line"><td className="p-3"><strong>{p.full_name}</strong><div className="text-xs text-ink-soft">{p.email || p.id}</div></td><td className="p-3">{ROLE_LABEL[p.role] || p.role}</td><td className="p-3">{(p.sector_ids || []).map((id) => sectorMap.get(id) || id).join(', ') || '—'}</td><td className="p-3">{fmtDate(p.created_at)}</td></tr>)}</tbody></table></div>}</Async>
        </Panel>
      </>}

      {tab === 'reports' && <>
        <PageHeader title="Platform reports" sub="Aggregate operational metrics for planning. These counts are not individual performance judgements." />
        <Async state={report}>{(r) => <div className="space-y-5">
          <Panel title="Users by role"><div className="grid grid-cols-2 gap-3 md:grid-cols-4">{Object.entries(r.users_by_role || {}).map(([k,v]) => <Metric key={k} label={ROLE_LABEL[k] || k} value={v} />)}</div></Panel>
          <Panel title="Organisations by status"><div className="grid grid-cols-2 gap-3 md:grid-cols-3">{Object.entries(r.organisations_by_status || {}).map(([k,v]) => <Metric key={k} label={k} value={v} />)}</div></Panel>
          <Panel title="Framework"><div className="grid grid-cols-2 gap-3 md:grid-cols-4"><Metric label="All sectors" value={r.sectors?.total} /><Metric label="Active sectors" value={r.sectors?.active} /><Metric label="All competencies" value={r.competencies?.total} /><Metric label="Active competencies" value={r.competencies?.active} /></div></Panel>
          <Panel title="Evidence by status"><div className="grid grid-cols-2 gap-3 md:grid-cols-4">{Object.entries(r.evidence_by_status || {}).map(([k,v]) => <Metric key={k} label={k} value={v} />)}</div></Panel>
          <Panel title="Projects and internships"><div className="grid grid-cols-2 gap-3 md:grid-cols-4"><Metric label="Projects total" value={r.projects?.total} /><Metric label="Projects open" value={r.projects?.open} /><Metric label="Internships total" value={r.internships?.total} /><Metric label="Internships open" value={r.internships?.open} /></div></Panel>
          <Button variant="ghost" onClick={() => report.reload()}>Refresh report</Button>
        </div>}</Async>
      </>}

      {tab === 'audit' && <>
        <PageHeader title="Audit history" sub="Administrative changes are recorded automatically by database triggers. Recent records appear first." />
        <Async state={audit}>{(rows) => !rows.length ? <Empty>No administrative changes have been recorded yet.</Empty> : <div className="overflow-x-auto rounded-xl border border-line bg-white"><table className="w-full text-left text-sm"><thead className="bg-paper text-ink-soft"><tr><th className="p-3">When</th><th className="p-3">Actor</th><th className="p-3">Action</th><th className="p-3">Record</th><th className="p-3">Change details</th></tr></thead><tbody>{rows.map((a) => <tr key={a.id} className="border-t border-line align-top"><td className="p-3 whitespace-nowrap">{new Date(a.created_at).toLocaleString()}</td><td className="p-3">{a.actor_email}</td><td className="p-3">{a.action}</td><td className="p-3">{a.entity_type}<div className="text-xs text-ink-soft">{a.entity_id}</div></td><td className="max-w-sm p-3"><details><summary className="cursor-pointer text-ok-ink">View snapshot</summary><pre className="mt-2 max-w-sm overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify({ before: a.old_data, after: a.new_data }, null, 2)}</pre></details></td></tr>)}</tbody></table></div>}</Async>
        <Button className="mt-4" variant="ghost" onClick={() => audit.reload()}>Refresh audit history</Button>
      </>}

      {tab === 'settings' && <>
        <PageHeader title="Operational settings" sub="Only explicitly supported platform-wide settings are editable here. Sensitive secrets belong in provider dashboards, never in this table." />
        <Async state={settings}>{(rows) => <div className="max-w-3xl space-y-4">{rows.map((s) => <Panel key={s.setting_key} title={s.setting_key}><div className="flex flex-col gap-3 sm:flex-row sm:items-end"><div className="flex-1"><Field label="Value" hint={s.setting_key === 'outcomes_min_group' ? 'Must be 5–100 to protect privacy in aggregate reports.' : s.setting_key === 'default_country_code' ? 'Digits only, for example 250.' : 'Must be an HTTPS URL.'}><Input value={settingsDraft[s.setting_key] ?? s.setting_value} onChange={(e) => setSettingsDraft((old) => ({ ...old, [s.setting_key]: e.target.value }))} /></Field></div><Button disabled={busy || (settingsDraft[s.setting_key] ?? s.setting_value) === s.setting_value} onClick={() => saveSetting(s.setting_key)}>Save setting</Button></div></Panel>)}</div>}</Async>
        <p className="mt-4 text-sm text-ink-soft">SMTP credentials, API secrets and service-role keys are intentionally not managed here. Configure those in the relevant provider or deployment settings.</p>
      </>}
    </div>
  );
}
