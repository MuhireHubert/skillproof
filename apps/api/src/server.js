import { loadConfig } from './config.js';
import { createPool } from './db.js';
import { createApp } from './app.js';
import { createLlm } from './llm.js';
import { runReminders, flushOutbox, createSender, hasProviders } from './jobs.js';

const config = loadConfig();
if (!config.databaseUrl) throw new Error('DATABASE_URL is required');
const pool = createPool(config.databaseUrl);
const llm = createLlm({ apiKey: config.anthropicApiKey, model: config.anthropicModel });
const app = createApp({ pool, config, llm });

app.listen(config.port, () => console.log('SkillProof API listening on ' + config.port));

if (config.enableJobs) {
  const send = hasProviders(config) ? createSender(config) : null;
  const safe = (name, fn) => () => fn().catch((e) => console.error('job ' + name + ' failed', e.message));
  setInterval(safe('reminders', () => runReminders(pool)), 6 * 60 * 60 * 1000);
  if (send) setInterval(safe('outbox', () => flushOutbox(pool, send)), 30 * 1000);
  console.log('Background jobs enabled' + (send ? '' : ' (no SMS/email provider configured, outbox not flushed)'));
}
