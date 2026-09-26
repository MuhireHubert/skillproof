import { Router } from 'express';
import { z } from 'zod';
import { withService } from '../db.js';
import { signMediaUrls } from '../storage.js';

const submitBody = z.object({
  verifierName: z.string().max(120).optional(),
  verifierRole: z.string().max(120).optional(),
  decision: z.enum(['verified', 'revision', 'declined']),
  ratings: z.record(z.string().max(80), z.coerce.number().int().min(1).max(4)).default({}),
  note: z.string().max(2000).optional(),
});

// Public endpoints used by a supervisor who has no account. The unguessable token is the credential.
export function verifyRoutes({ pool, config, limiter, fetchImpl }) {
  const r = Router();

  r.get('/:token', limiter, async (req, res) => {
    const data = await withService(pool, async (c) => {
      const head = (await c.query(
        `select vr.verifier_name, vr.verifier_role, vr.expires_at, e.id as evidence_id, e.title, e.description,
                e.link, e.hours, e.student_name, e.evidence_type, s.name as sector_name, s.verifier_label
           from public.verification_requests vr
           join public.evidence e on e.id = vr.evidence_id
           join public.sectors s on s.id = e.sector_id
          where vr.token = $1 and vr.used_at is null and vr.expires_at > now() and e.status = 'submitted'`,
        [req.params.token])).rows[0];
      if (!head) return null;
      const competencies = (await c.query(
        `select c.id, c.name from public.evidence_competencies ec join public.competencies c on c.id = ec.competency_id
          where ec.evidence_id = $1 order by c.name`, [head.evidence_id])).rows;
      const media = (await c.query(
        'select storage_path, kind, caption from public.evidence_media where evidence_id = $1 order by created_at', [head.evidence_id])).rows;
      return { head, competencies, media };
    });
    if (!data) return res.status(410).json({ error: 'This verification link is invalid or has expired' });
    const signed = await signMediaUrls({
      supabaseUrl: config.supabaseUrl, serviceKey: config.serviceKey, fetchImpl,
      paths: data.media.map((m) => m.storage_path),
    });
    const urlByPath = new Map(signed.map((s) => [s.path, s.url]));
    const { evidence_id, ...head } = data.head;
    res.json({
      ...head,
      competencies: data.competencies,
      media: data.media.map((m) => ({ kind: m.kind, caption: m.caption, url: urlByPath.get(m.storage_path) || null })),
    });
  });

  r.post('/:token', limiter, async (req, res) => {
    const b = submitBody.parse(req.body);
    await withService(pool, (c) => c.query(
      'select public.complete_external_verification($1, null, null, $2, $3, $4, $5::jsonb, null, $6, $7)',
      [req.params.token, b.verifierName || null, b.verifierRole || null, b.decision, JSON.stringify(b.ratings), b.note || '', 'link']));
    res.json({ ok: true });
  });

  return r;
}
