import { useState } from 'react';
import { useAuth } from '../auth.jsx';
import { useCatalog } from '../catalog.jsx';
import { supabase } from '../lib/supabase.js';
import { useAsync, unwrap } from '../lib/hooks.js';
import { ROLE_LABEL, fmtDate } from '../lib/format.js';
import { Async, Button, Card, Chip, Empty, Field, Input, PageHeader, Panel, Pill, SectorSelect, Stat, Textarea, useAction } from '../ui.jsx';

export default function Admin() {
  const { isAdmin } = useAuth();
  const { sectors, competencies, sectorName } = useCatalog();
  const [run, busy] = useAction();
  const orgs = useAsync(async () => unwrap(await supabase.from('organizations').select('*, profiles(full_name, email)').order('created_at', { ascending: false })), []);
  const stats = useAsync(async () => unwrap(await supabase.rpc('dashboard_stats')), []);
  const [c, setC] = useState({ sector: '', name: '', description: '' });

  if (!isAdmin) return <Empty>This section is for platform administrators.</Empty>;

  const setStatus = (o, status) => run(async () => {
    unwrap(await supabase.from('organizations').update({ status }).eq('id', o.id));
    orgs.reload();
  }, 'Saved.');

  const addCompetency = () => run(async () => {
    if (!c.sector || !c.name.trim()) throw new Error('Pick a sector and enter a name.');
    const slug = c.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    unwrap(await supabase.from('competencies').insert({ id: c.sector + '-' + slug, sector_id: c.sector, name: c.name.trim(), description: c.description.trim() }));
    setC({ ...c, name: '', description: '' });
  }, 'Competency added. Reload to see it everywhere.');

  return (
    <>
      <PageHeader title="Admin and verification" sub="Approve organisations before they can publish, verify, assess or hire. Extend the competency framework." />
      <Async state={stats}>{(s) => s.admin && (
        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Pending organisations" value={s.admin.pending_orgs} tone="alert" />
          <Stat label="Verified work" value={s.admin.verified_evidence} />
          <Stat label="Queued SMS/email" value={s.admin.outbox_pending} />
          <Stat label="Students" value={(s.admin.users || {}).student} />
        </div>
      )}</Async>

      <h3 className="mb-2">Organisations</h3>
      <Async state={orgs}>{(list) => !list.length ? <Empty>No organisations yet.</Empty> : list.map((o) => (
        <Card key={o.id} status={o.status === 'approved' ? 'verified' : o.status === 'pending' ? 'submitted' : 'declined'}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3>{o.name}</h3>
              <p className="text-sm text-ink-soft">{ROLE_LABEL[o.type]}, registered {fmtDate(o.created_at)}{o.profiles && o.profiles[0] ? ', contact ' + o.profiles[0].full_name + ' (' + o.profiles[0].email + ')' : ''}</p>
              <div className="mt-1 flex flex-wrap gap-1.5">{(o.sector_ids || []).map((s) => <Chip key={s}>{sectorName(s)}</Chip>)}</div>
            </div>
            <Pill tone={o.status === 'approved' ? 'ok' : o.status === 'pending' ? 'wait' : 'no'}>{o.status}</Pill>
          </div>
          <div className="mt-3 flex gap-2">
            {o.status !== 'approved' && <Button small variant="go" disabled={busy} onClick={() => setStatus(o, 'approved')}>Approve</Button>}
            {o.status !== 'suspended' && <Button small variant="danger" disabled={busy} onClick={() => setStatus(o, 'suspended')}>Suspend</Button>}
          </div>
        </Card>
      ))}</Async>

      <Panel title="Competency framework" className="mt-8">
        <p className="mb-3 text-sm text-ink-soft">{sectors.length} sectors, {competencies.length} competencies. Add a competency to any sector; standards, projects and assessments pick it up immediately.</p>
        <div className="grid gap-x-4 sm:grid-cols-2">
          <Field label="Sector"><SectorSelect value={c.sector} onChange={(sector) => setC({ ...c, sector })} placeholder="Choose a sector" /></Field>
          <Field label="Competency name"><Input value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} /></Field>
        </div>
        <Field label="Description (optional)"><Textarea rows={2} value={c.description} onChange={(e) => setC({ ...c, description: e.target.value })} /></Field>
        <Button disabled={busy} onClick={addCompetency}>Add competency</Button>
      </Panel>
    </>
  );
}
