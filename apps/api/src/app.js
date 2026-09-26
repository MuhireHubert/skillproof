import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import { ZodError } from 'zod';
import { createAuth } from './auth.js';
import { aiRoutes } from './routes/ai.js';
import { verifyRoutes } from './routes/verify.js';
import { ussdRoutes } from './routes/ussd.js';
import { reportRoutes } from './routes/reports.js';

const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
function wrapRouter(router) {
  // Express 4 does not catch rejected promises; wrap every handler.
  router.stack.forEach((layer) => {
    if (layer.route) layer.route.stack.forEach((l) => { l.handle = asyncRoute(l.handle); });
  });
  return router;
}

export function createApp({ pool, config, llm = null, fetchImpl = fetch, limits = {} }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigin }));

  const make = (windowMs, max, keyByUser = false) => {
    const opts = { windowMs, limit: max, standardHeaders: 'draft-7', legacyHeaders: false };
    if (keyByUser) opts.keyGenerator = (req) => (req.user ? 'u:' + req.user.id : 'ip');
    return rateLimit(opts);
  };
  const publicLimiter = make(15 * 60 * 1000, limits.public ?? 60);
  const exportLimiter = make(15 * 60 * 1000, limits.exports ?? 30);
  const aiLimiter = make(60 * 60 * 1000, limits.ai ?? 20, true);
  const requireUser = createAuth(config);

  app.get('/health', asyncRoute(async (req, res) => {
    await pool.query('select 1');
    res.json({ ok: true });
  }));

  app.use('/ussd', express.urlencoded({ extended: false, limit: '10kb' }), wrapRouter(ussdRoutes({ pool, config, limiter: publicLimiter })));
  app.use(express.json({ limit: '100kb' }));
  app.use('/api/verify', wrapRouter(verifyRoutes({ pool, config, limiter: publicLimiter, fetchImpl })));
  app.use('/api/ai', wrapRouter(aiRoutes({ pool, llm, requireUser, limiter: aiLimiter })));
  app.use('/api/reports', wrapRouter(reportRoutes({ pool, requireUser, limiter: exportLimiter })));

  app.use((req, res) => res.status(404).json({ error: 'Not found' }));

  // Maps database and validation errors to safe responses.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof ZodError) return res.status(400).json({ error: 'Invalid request', details: err.issues.map((i) => i.path.join('.') + ': ' + i.message) });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
    const code = err.code;
    if (code === 'SP001') return res.status(410).json({ error: err.message });
    if (code === 'SP002') return res.status(400).json({ error: err.message });
    if (code === 'SP003') return res.status(403).json({ error: err.message });
    if (code === '42501') return res.status(403).json({ error: err.message });
    if (code === 'P0002') return res.status(404).json({ error: err.message });
    if (code === '22023') return res.status(400).json({ error: err.message });
    if (typeof code === 'string' && code.startsWith('23')) return res.status(409).json({ error: 'That change conflicts with existing data' });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  });
  return app;
}
