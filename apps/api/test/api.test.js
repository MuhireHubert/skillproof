import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import { resetDb, makePool, mkUser, approveOrgOf, q } from './helpers.js';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { handleUssd } from '../src/routes/ussd.js';
import { extractJson, createLlm } from '../src/llm.js';
import { toCsv } from '../src/csv.js';
import { signMediaUrls } from '../src/storage.js';
import { runReminders, flushOutbox } from '../src/jobs.js';

const SECRET = 'test-secret-test-secret-test-secret-123';
const pool = makePool();
const U = {};
const servers = [];
const DIAG = 'mechanics-engine-diagnostics';
const SAFETY = 'mechanics-workshop-safety';

async function token(user) {
  return new SignJWT({ email: user.email })
    .setProtectedHeader({ alg: 'HS256' }).setSubject(user.id).setAudience('authenticated')
    .setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
}

async function start({ llm = null, fetchImpl, limits = { public: 1000, exports: 1000, ai: 1000 }, extra = {} } = {}) {
  const config = { ...loadConfig({}), jwtSecret: SECRET, supabaseUrl: 'https://proj.supabase.co', serviceKey: 'svc', ...extra };
  const app = createApp({ pool, config, llm, fetchImpl, limits });
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  servers.push(server);
  const base = 'http://127.0.0.1:' + server.address().port;
  const call = async (method, path, { user, body, form, headers = {} } = {}) => {
    const h = { ...headers };
    if (user) h.authorization = 'Bearer ' + (await token(user));
    let payload;
    if (body !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    if (form) { h['content-type'] = 'application/x-www-form-urlencoded'; payload = new URLSearchParams(form).toString(); }
    const res = await fetch(base + path, { method, headers: h, body: payload });
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = null; }
    return { status: res.status, json, text, headers: res.headers };
  };
  return { call };
}

// Creates a self-logged, submitted piece of evidence with an outside supervisor request.
async function pendingVerification(student, phone = '0788123456') {
  const [e] = await q(pool, student, "insert into public.evidence (student_id, sector_id, title, description) values ($1, 'mechanics', 'Clutch replacement', 'Full job') returning id", [student.id]);
  await q(pool, student, 'insert into public.evidence_competencies (evidence_id, competency_id) values ($1, $2), ($1, $3)', [e.id, DIAG, SAFETY]);
  const [r] = await q(pool, student, "select * from public.request_external_verification($1, 'Sam Foreman', 'Workshop lead', $2)", [e.id, phone]);
  return { evidenceId: e.id, token: r.token, code: r.short_code };
}

before(async () => {
  await resetDb();
  U.stu = await mkUser(pool, 'stu@x.rw', { role: 'student', full_name: 'Stu Dent' });
  U.acme = await mkUser(pool, 'acme@x.rw', { role: 'employer', full_name: 'Eric', org_name: 'Acme Garage', sector_ids: ['mechanics'] });
  U.pend = await mkUser(pool, 'pend@x.rw', { role: 'employer', full_name: 'Pat', org_name: 'Pending Ltd' });
  U.college = await mkUser(pool, 'college@x.rw', { role: 'institution', full_name: 'Dr K', org_name: 'Kigali Tech College', sector_ids: ['mechanics'] });
  await approveOrgOf(pool, U.acme);
  await approveOrgOf(pool, U.college);
});
after(async () => { for (const s of servers) s.close(); await pool.end(); });

describe('service basics', () => {
  it('reports health and rejects unauthenticated or forged requests', async () => {
    const { call } = await start();
    assert.equal((await call('GET', '/health')).status, 200);
    assert.equal((await call('POST', '/api/ai/draft-standard', { body: {} })).status, 401);
    const bad = await call('POST', '/api/ai/draft-standard', { headers: { authorization: 'Bearer not.a.jwt' }, body: {} });
    assert.equal(bad.status, 401);
    const wrongKey = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject(U.acme.id).setAudience('authenticated').sign(new TextEncoder().encode('another-secret-another-secret-12345'));
    assert.equal((await call('POST', '/api/ai/draft-standard', { headers: { authorization: 'Bearer ' + wrongKey }, body: {} })).status, 401);
    assert.equal((await call('GET', '/nope')).status, 404);
  });

  it('sets security headers and no server banner', async () => {
    const { call } = await start();
    const r = await call('GET', '/health');
    assert.equal(r.headers.get('x-powered-by'), null);
    assert.ok(r.headers.get('x-content-type-options'));
  });
});

describe('AI drafting (model output is untrusted)', () => {
  const fakeLlm = (out) => ({ json: async () => out });
  const body = { sectorId: 'mechanics', jobPost: 'We need a junior mechanic who can diagnose engines and work safely in a busy workshop.' };

  it('returns only competencies that exist in the sector, once each, with clamped values', async () => {
    const { call } = await start({ llm: fakeLlm({ roleTitle: 'Junior mechanic', competencies: [
      { competencyId: DIAG, importance: 3, level: 3, reason: 'core' },
      { competencyId: DIAG, importance: 1, level: 1 },
      { competencyId: 'tech-web-development', importance: 3, level: 3 },
      { competencyId: 'DROP TABLE', importance: 3, level: 3 },
      { competencyId: SAFETY, importance: 2, level: 3 },
    ] }) });
    const r = await call('POST', '/api/ai/draft-standard', { user: U.acme, body });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.competencies.map((c) => c.competencyId), [DIAG, SAFETY]);
    assert.equal(r.json.competencies[0].name, 'Engine diagnostics');
  });

  it('rejects out-of-range values from the model and non-employers', async () => {
    const { call } = await start({ llm: fakeLlm({ competencies: [{ competencyId: DIAG, importance: 9, level: 3 }] }) });
    assert.equal((await call('POST', '/api/ai/draft-standard', { user: U.acme, body })).status, 400);
    const ok = await start({ llm: fakeLlm({ competencies: [] }) });
    assert.equal((await ok.call('POST', '/api/ai/draft-standard', { user: U.stu, body })).status, 403);
    assert.equal((await ok.call('POST', '/api/ai/draft-standard', { user: U.pend, body })).status, 403);
    assert.equal((await ok.call('POST', '/api/ai/draft-standard', { user: U.acme, body: { sectorId: 'nope', jobPost: body.jobPost } })).status, 404);
    assert.equal((await ok.call('POST', '/api/ai/draft-standard', { user: U.acme, body: { sectorId: 'mechanics', jobPost: 'short' } })).status, 400);
  });

  it('says so when no model is configured, and maps courses for institutions only', async () => {
    const none = await start({ llm: null });
    assert.equal((await none.call('POST', '/api/ai/draft-standard', { user: U.acme, body })).status, 503);
    const { call } = await start({ llm: fakeLlm({ competencies: [{ competencyId: SAFETY, coverageLevel: 4 }, { competencyId: 'law-legal-research', coverageLevel: 2 }] }) });
    const payload = { sectorId: 'mechanics', courseName: 'Workshop practice', syllabus: 'Weekly practical sessions on workshop safety and tool use for all learners.' };
    const r = await call('POST', '/api/ai/map-course', { user: U.college, body: payload });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.competencies.map((c) => [c.competencyId, c.coverageLevel]), [[SAFETY, 4]]);
    assert.equal((await call('POST', '/api/ai/map-course', { user: U.acme, body: payload })).status, 403);
  });

  it('rate-limits AI calls per user', async () => {
    const { call } = await start({ llm: fakeLlm({ competencies: [] }), limits: { public: 1000, exports: 1000, ai: 2 } });
    const codes = [];
    for (let i = 0; i < 4; i++) codes.push((await call('POST', '/api/ai/draft-standard', { user: U.acme, body })).status);
    assert.deepEqual(codes, [200, 200, 429, 429]);
  });

  it('parses model output defensively and calls the Anthropic API correctly', async () => {
    assert.deepEqual(extractJson('Sure! ```json\n{"a": 1}\n``` done'), { a: 1 });
    assert.throws(() => extractJson('no json here'));
    let seen;
    const llm = createLlm({ apiKey: 'k', model: 'claude-sonnet-5', fetchImpl: async (url, init) => {
      seen = { url, init };
      return { ok: true, json: async () => ({ content: [{ type: 'text', text: '{"ok": true}' }] }) };
    } });
    assert.deepEqual(await llm.json({ system: 's', user: 'u' }), { ok: true });
    assert.equal(seen.url, 'https://api.anthropic.com/v1/messages');
    assert.equal(seen.init.headers['x-api-key'], 'k');
    assert.equal(JSON.parse(seen.init.body).model, 'claude-sonnet-5');
    assert.equal(createLlm({ apiKey: '', model: 'm' }), null);
  });
});

describe('outside-verifier link', () => {
  it('shows the work, accepts one sign-off, and refuses reuse', async () => {
    const fetchImpl = async () => ({ ok: true, json: async () => [{ path: 'x', signedURL: '/object/sign/evidence-media/x?token=t' }] });
    const { call } = await start({ fetchImpl });
    const v = await pendingVerification(U.stu);
    const view = await call('GET', '/api/verify/' + v.token);
    assert.equal(view.status, 200);
    assert.equal(view.json.title, 'Clutch replacement');
    assert.equal(view.json.student_name, 'Stu Dent');
    assert.deepEqual(view.json.competencies.map((c) => c.id).sort(), [DIAG, SAFETY]);
    assert.equal(view.json.verifier_name, 'Sam Foreman');
    assert.equal(view.json.evidence_id, undefined);
    assert.equal(view.json.verifier_contact, undefined);

    const incomplete = await call('POST', '/api/verify/' + v.token, { body: { decision: 'verified', ratings: { [DIAG]: 3 } } });
    assert.equal(incomplete.status, 400);
    const outOfRange = await call('POST', '/api/verify/' + v.token, { body: { decision: 'verified', ratings: { [DIAG]: 9, [SAFETY]: 3 } } });
    assert.equal(outOfRange.status, 400);
    const ok = await call('POST', '/api/verify/' + v.token, { body: { decision: 'verified', verifierName: 'Sam F.', ratings: { [DIAG]: 3, [SAFETY]: 4 }, note: 'Careful worker' } });
    assert.equal(ok.status, 200);
    const [e] = (await pool.query('select status, assurance, verified_by_name, verifier_note from public.evidence where id = $1', [v.evidenceId])).rows;
    assert.deepEqual([e.status, e.assurance, e.verified_by_name, e.verifier_note], ['verified', 'external_attested', 'Sam F.', 'Careful worker']);
    assert.equal((await call('POST', '/api/verify/' + v.token, { body: { decision: 'verified', ratings: { [DIAG]: 3, [SAFETY]: 4 } } })).status, 410);
    assert.equal((await call('GET', '/api/verify/' + v.token)).status, 410);
    assert.equal((await call('GET', '/api/verify/not-a-real-token')).status, 410);
  });

  it('lets a supervisor request changes or decline with a note', async () => {
    const { call } = await start();
    const v = await pendingVerification(U.stu);
    assert.equal((await call('POST', '/api/verify/' + v.token, { body: { decision: 'revision' } })).status, 400);
    assert.equal((await call('POST', '/api/verify/' + v.token, { body: { decision: 'revision', note: 'Add photos of the finished job' } })).status, 200);
    assert.equal((await pool.query('select status from public.evidence where id = $1', [v.evidenceId])).rows[0].status, 'revision');
  });

  it('rate-limits token guessing', async () => {
    const { call } = await start({ limits: { public: 3, exports: 1000, ai: 1000 } });
    const codes = [];
    for (let i = 0; i < 5; i++) codes.push((await call('GET', '/api/verify/guess' + i)).status);
    assert.deepEqual(codes, [410, 410, 410, 429, 429]);
  });

  it('signs media URLs with the service key and tolerates failure', async () => {
    let seen;
    const urls = await signMediaUrls({ supabaseUrl: 'https://p.supabase.co', serviceKey: 'svc', paths: ['a/b.jpg'],
      fetchImpl: async (u, init) => { seen = { u, init }; return { ok: true, json: async () => [{ path: 'a/b.jpg', signedURL: '/object/sign/evidence-media/a/b.jpg?token=abc' }] }; } });
    assert.equal(seen.u, 'https://p.supabase.co/storage/v1/object/sign/evidence-media');
    assert.equal(seen.init.headers.authorization, 'Bearer svc');
    assert.deepEqual(urls, [{ path: 'a/b.jpg', url: 'https://p.supabase.co/storage/v1/object/sign/evidence-media/a/b.jpg?token=abc' }]);
    assert.deepEqual(await signMediaUrls({ supabaseUrl: 'https://p.supabase.co', serviceKey: 'svc', paths: ['x'], fetchImpl: async () => ({ ok: false }) }), []);
    assert.deepEqual(await signMediaUrls({ supabaseUrl: '', serviceKey: '', paths: ['x'] }), []);
  });
});

describe('USSD sign-off', () => {
  it('walks a supervisor through the menu and records a phone-attested sign-off', async () => {
    const v = await pendingVerification(U.stu, '0788555000');
    assert.match(await handleUssd(pool, { text: '', phoneNumber: '+250788555000' }), /^CON .*6-digit code/s);
    assert.match(await handleUssd(pool, { text: 'abc', phoneNumber: '+250788555000' }), /^END .*not valid/);
    assert.match(await handleUssd(pool, { text: '000000', phoneNumber: '+250788555000' }), /^END .*invalid or has expired/);
    assert.match(await handleUssd(pool, { text: v.code, phoneNumber: '+250788999999' }), /^END .*different phone/);
    const menu = await handleUssd(pool, { text: v.code, phoneNumber: '+250788555000' });
    assert.match(menu, /^CON Stu Dent: Clutch replacement/);
    assert.match(menu, /1 Works independently/);
    assert.ok(menu.length < 182, 'fits a USSD screen');
    assert.match(await handleUssd(pool, { text: v.code + '*9', phoneNumber: '+250788555000' }), /^END Invalid choice/);
    assert.match(await handleUssd(pool, { text: v.code + '*1', phoneNumber: '+250788555000' }), /^END Thank you/);
    const [e] = (await pool.query('select status, assurance from public.evidence where id = $1', [v.evidenceId])).rows;
    assert.deepEqual([e.status, e.assurance], ['verified', 'ussd_attested']);
    const ratings = (await pool.query('select rating from public.evidence_competencies where evidence_id = $1', [v.evidenceId])).rows;
    assert.ok(ratings.every((r) => r.rating === 3));
    assert.match(await handleUssd(pool, { text: v.code + '*1', phoneNumber: '+250788555000' }), /^END .*invalid or has expired/);
  });

  it('records a decline, and refuses codes that were sent to an email address', async () => {
    const v = await pendingVerification(U.stu, '0788666000');
    assert.match(await handleUssd(pool, { text: v.code + '*4', phoneNumber: '+250788666000' }), /^END Recorded/);
    assert.equal((await pool.query('select status from public.evidence where id = $1', [v.evidenceId])).rows[0].status, 'declined');
    const mail = await pendingVerification(U.stu, 'sam@example.com');
    assert.match(await handleUssd(pool, { text: mail.code, phoneNumber: '+250788666000' }), /^END .*cannot be used by phone/);
  });

  it('serves the gateway endpoint as plain text and can require a shared secret', async () => {
    const v = await pendingVerification(U.stu, '0788777000');
    const open = await start();
    const r = await open.call('POST', '/ussd', { form: { sessionId: 's1', phoneNumber: '+250788777000', text: v.code } });
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /text\/plain/);
    assert.match(r.text, /^CON /);
    const locked = await start({ extra: { ussdSecret: 's3cret-value' } });
    assert.equal((await locked.call('POST', '/ussd', { form: { phoneNumber: '+250788777000', text: '' } })).status, 403);
    assert.equal((await locked.call('POST', '/ussd?key=wrong', { form: { phoneNumber: '+250788777000', text: '' } })).status, 403);
    assert.equal((await locked.call('POST', '/ussd?key=s3cret-value', { form: { phoneNumber: '+250788777000', text: '' } })).status, 200);
  });
});

describe('reports', () => {
  it('exports CSVs as the signed-in user and enforces roles', async () => {
    const { call } = await start();
    await q(pool, U.college, "insert into public.programmes (institution_org_id, name, sector_id) values (public.my_org(), 'Diploma in Automotive', 'mechanics')");
    const out = await call('GET', '/api/reports/outcomes.csv', { user: U.college });
    assert.equal(out.status, 200);
    assert.match(out.headers.get('content-type'), /text\/csv/);
    assert.match(out.text.split('\n')[0], /programme_name/);
    assert.match(out.text, /Diploma in Automotive/);
    assert.equal((await call('GET', '/api/reports/outcomes.csv', { user: U.acme })).status, 403);
    assert.equal((await call('GET', '/api/reports/outcomes.csv')).status, 401);
    assert.equal((await call('GET', '/api/reports/nothing.csv', { user: U.college })).status, 404);
    assert.equal((await call('GET', '/api/reports/gap.csv', { user: U.college })).status, 400);
    assert.equal((await call('GET', '/api/reports/gap.csv?sector=mechanics', { user: U.college })).status, 200);
    assert.equal((await call('GET', '/api/reports/pipeline.csv', { user: U.acme })).status, 200);
  });

  it('neutralises spreadsheet formulas and escapes CSV', () => {
    const csv = toCsv([{ a: '=HYPERLINK("x")', b: 'a,b', c: 'say "hi"', d: null, e: '@cmd' }]);
    assert.equal(csv.split('\n')[1], `'=HYPERLINK("x"),"a,b","say ""hi""",,'@cmd`.replace(`'=HYPERLINK("x")`, `"'=HYPERLINK(""x"")"`));
  });
});

describe('background jobs', () => {
  it('reminds employers about standards due for review once, not repeatedly', async () => {
    await q(pool, U.acme, "insert into public.standards (employer_org_id, sector_id, role_title, review_by) values (public.my_org(), 'mechanics', 'Junior mechanic', current_date + 5)");
    await q(pool, U.acme, "insert into public.standards (employer_org_id, sector_id, role_title, review_by) values (public.my_org(), 'mechanics', 'Senior mechanic', current_date + 200)");
    assert.equal((await runReminders(pool)).created, 1);
    assert.equal((await runReminders(pool)).created, 0);
    const n = await q(pool, U.acme, "select title from public.notifications where kind = 'standard_review_due'");
    assert.deepEqual(n.map((x) => x.title), ['Standard due for review: Junior mechanic']);
  });

  it('sends queued messages, retries failures and gives up after five attempts', async () => {
    await pool.query('delete from public.outbox');
    await pool.query("insert into public.outbox (channel, recipient, body) values ('sms', '250788000001', 'hello'), ('email', 'a@b.rw', 'hi')");
    const sent = [];
    const r = await flushOutbox(pool, async (m) => { if (m.channel === 'email') throw new Error('provider down'); sent.push(m.recipient); });
    assert.deepEqual([r.sent, r.failed], [1, 1]);
    assert.deepEqual(sent, ['250788000001']);
    for (let i = 0; i < 4; i++) await flushOutbox(pool, async () => { throw new Error('still down'); });
    const rows = (await pool.query('select recipient, status, attempts from public.outbox order by id')).rows;
    assert.deepEqual(rows.map((x) => [x.status, x.attempts]), [['sent', 1], ['failed', 5]]);
    assert.equal((await flushOutbox(pool, async () => {})).sent, 0);
  });
});
