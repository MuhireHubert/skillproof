import { useCatalog } from '../catalog.jsx';
import { supabase } from '../lib/supabase.js';
import { useAsync } from '../lib/hooks.js';
import { ASSURANCE } from '../lib/format.js';
import { Empty, LevelRow, Pill } from '../ui.jsx';

// Photos, video and documents attached to evidence. URLs are short-lived signed links.
export function MediaGrid({ media }) {
  const paths = (media || []).map((m) => m.storage_path);
  const signed = useAsync(async () => {
    if (!paths.length) return {};
    const { data } = await supabase.storage.from('evidence-media').createSignedUrls(paths, 3600);
    return Object.fromEntries((data || []).filter((d) => d.signedUrl).map((d) => [d.path, d.signedUrl]));
  }, [paths.join('|')]);
  if (!paths.length) return null;
  const urls = signed.data || {};
  return (
    <div className="my-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
      {media.map((m) => {
        const url = urls[m.storage_path];
        if (!url) return <div key={m.id} className="flex h-28 items-center justify-center rounded bg-paper text-xs text-ink-soft">Loading…</div>;
        if (m.kind === 'image') return <a key={m.id} href={url} target="_blank" rel="noreferrer"><img src={url} alt={m.caption || 'Evidence photo'} className="h-28 w-full rounded object-cover" /></a>;
        if (m.kind === 'video') return <video key={m.id} src={url} controls className="h-28 w-full rounded bg-black object-cover" />;
        return <a key={m.id} href={url} target="_blank" rel="noreferrer" className="flex h-28 items-center justify-center rounded border border-line text-sm">Open document</a>;
      })}
    </div>
  );
}

export function AssuranceBadge({ evidence }) {
  if (!evidence.assurance) return null;
  const by = evidence.verified_by_org_name || evidence.verified_by_name;
  return <Pill tone={evidence.assurance === 'org_verified' ? 'ok' : 'rev'}>{ASSURANCE[evidence.assurance]}{by ? ': ' + by : ''}</Pill>;
}

// Ratings on one piece of evidence, professional competencies listed separately.
export function RatingsBlock({ rows }) {
  const { compName, competencies } = useCatalog();
  const pro = new Set(competencies.filter((c) => c.category === 'professional').map((c) => c.id));
  const rated = (rows || []).filter((r) => r.rating);
  const tech = rated.filter((r) => !pro.has(r.competency_id));
  const soft = rated.filter((r) => pro.has(r.competency_id));
  return (
    <div className="my-2">
      {tech.map((r) => <LevelRow key={r.competency_id} name={compName(r.competency_id)} level={r.rating} />)}
      {soft.length > 0 && <h4 className="mb-1 mt-3 text-sm">Professional competencies</h4>}
      {soft.map((r) => <LevelRow key={r.competency_id} name={compName(r.competency_id)} level={r.rating} />)}
    </div>
  );
}

// Best level per competency across verified evidence and assessments.
export function CompetencyRecord({ rows }) {
  if (!rows || !rows.length) return <Empty>Verified competencies appear here once work is signed off or assessed.</Empty>;
  return (
    <div>
      {rows.map((r) => (
        <LevelRow key={r.competency_id} name={r.name} level={r.best_level}
          extra={[r.evidence_count ? r.evidence_count + ' verified work' : '', r.assessment_count ? r.assessment_count + ' assessment' + (r.assessment_count > 1 ? 's' : '') : ''].filter(Boolean).join(', ')} />
      ))}
    </div>
  );
}
