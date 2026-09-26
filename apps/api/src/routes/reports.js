import { Router } from 'express';
import { z } from 'zod';
import { withUser } from '../db.js';
import { toCsv } from '../csv.js';

// CSV exports. They run as the signed-in user, so row-level security and the SQL functions'
// consent and minimum-group-size rules apply exactly as they do in the app.
const REPORTS = {
  outcomes: { sql: 'select * from public.outcome_summary(null)', params: () => [] },
  feedback: { sql: 'select * from public.feedback_summary(null)', params: () => [] },
  gap: { sql: 'select * from public.competency_gap($1)', params: (q) => [z.string().min(1).parse(q.sector)] },
  compliance: { sql: 'select * from public.regulator_compliance($1)', params: (q) => [z.string().uuid().parse(q.requirement)] },
  pipeline: {
    sql: 'select student_name, stage, source, created_at, updated_at from public.talent_pipeline order by updated_at desc',
    params: () => [],
  },
};

export function reportRoutes({ pool, requireUser, limiter }) {
  const r = Router();
  r.get('/:kind.csv', limiter, requireUser, async (req, res) => {
    const def = REPORTS[req.params.kind];
    if (!def) return res.status(404).json({ error: 'Unknown report' });
    const rows = await withUser(pool, req.user, async (c) => (await c.query(def.sql, def.params(req.query))).rows);
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', 'attachment; filename="' + req.params.kind + '.csv"');
    res.send(toCsv(rows));
  });
  return r;
}
