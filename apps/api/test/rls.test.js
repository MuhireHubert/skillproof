import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resetDb, makePool, mkUser, approveOrgOf, q, qAnon, rejects } from './helpers.js';

const pool = makePool();
const U = {}; // users by handle
const S = {}; // shared ids

const DIAG = 'mechanics-engine-diagnostics';
const BRAKES = 'mechanics-brakes-and-suspension';
const SAFETY = 'mechanics-workshop-safety';

before(async () => {
  await resetDb();
  await pool.query("insert into public.app_admins (email) values ('boss@x.rw')");
  U.boss = await mkUser(pool, 'boss@x.rw', { role: 'student', full_name: 'Boss' });
  U.ada = await mkUser(pool, 'ada@x.rw', { role: 'student', full_name: 'Ada Uwase' });
  U.bea = await mkUser(pool, 'bea@x.rw', { role: 'student', full_name: 'Bea Mukamana' });
  U.acme = await mkUser(pool, 'acme@x.rw', { role: 'employer', full_name: 'Eric', org_name: 'Acme Garage', sector_ids: ['mechanics'] });
  U.rival = await mkUser(pool, 'rival@x.rw', { role: 'employer', full_name: 'Rita', org_name: 'Rival Motors', sector_ids: ['mechanics'] });
  U.pending = await mkUser(pool, 'pending@x.rw', { role: 'employer', full_name: 'Pat', org_name: 'Pending Ltd', sector_ids: ['mechanics'] });
  U.college = await mkUser(pool, 'college@x.rw', { role: 'institution', full_name: 'Dr K', org_name: 'Kigali Tech College', sector_ids: ['mechanics'] });
  U.other = await mkUser(pool, 'other@x.rw', { role: 'institution', full_name: 'Dr O', org_name: 'Other College' });
  U.reg = await mkUser(pool, 'reg@x.rw', { role: 'regulator', full_name: 'Reg', org_name: 'Vocational Board', sector_ids: ['mechanics'] });
  for (const h of ['acme', 'rival', 'college', 'other', 'reg']) await approveOrgOf(pool, U[h]);
});
after(() => pool.end());

describe('signup and account protection', () => {
  it('creates profiles and pending organisations, ignores forged roles and unknown sectors', async () => {
    const forged = await mkUser(pool, 'forged@x.rw', { role: 'admin', full_name: 'Mallory', sector_ids: ['nope', 'law'] });
    const [p] = await pool.query('select role, org_id, sector_ids from public.profiles where id = $1', [forged.id]).then((r) => r.rows);
    assert.equal(p.role, 'student');
    assert.equal(p.org_id, null);
    assert.deepEqual(p.sector_ids, ['law']);
    const [o] = (await pool.query("select status, type, name from public.organizations where name = 'Pending Ltd'")).rows;
    assert.deepEqual([o.status, o.type], ['pending', 'employer']);
  });

  it('blocks users from changing their role, organisation or email', async () => {
    await rejects(q(pool, U.ada, "update public.profiles set role = 'employer' where id = $1", [U.ada.id]), '42501', 'role');
    await rejects(q(pool, U.ada, 'update public.profiles set org_id = (select id from public.organizations limit 1) where id = $1', [U.ada.id]), '42501', 'org');
    await q(pool, U.ada, "update public.profiles set headline = 'Aspiring mechanic' where id = $1", [U.ada.id]);
  });

  it('blocks an employer from approving their own organisation but lets an admin do it', async () => {
    await rejects(q(pool, U.pending, "update public.organizations set status = 'approved' where id = public.my_org()"), '42501');
    await q(pool, U.boss, "update public.organizations set status = 'approved' where name = 'Pending Ltd'");
    await q(pool, U.boss, "update public.organizations set status = 'pending' where name = 'Pending Ltd'");
  });

  it('keeps people from reading each other', async () => {
    const seen = await q(pool, U.ada, 'select id from public.profiles');
    assert.deepEqual(seen.map((r) => r.id), [U.ada.id]);
    assert.equal((await q(pool, U.college, 'select id from public.profiles')).length, 1);
  });
});

describe('lockdown', () => {
  it('denies anon and non-admins access to internal tables and functions', async () => {
    await rejects(qAnon(pool, 'select * from public.profiles'), '42501', 'anon profiles');
    await rejects(q(pool, U.ada, 'select * from public.outbox'), '42501', 'outbox');
    await rejects(q(pool, U.ada, 'select * from public.app_admins'), '42501', 'admins');
    await rejects(qAnon(pool, "select public.review_evidence(gen_random_uuid(), 'verified')"), '42501', 'anon rpc');
    await rejects(q(pool, U.ada, "select public.complete_external_verification('x', null, null, null, null, 'verified', '{}', 3, '', 'link')"), '42501', 'service fn');
    assert.ok((await qAnon(pool, 'select count(*)::int as n from public.sectors'))[0].n === 8);
  });
});

describe('projects and employer-verified evidence', () => {
  it('only approved employers can post projects', async () => {
    await rejects(q(pool, U.pending, "insert into public.projects (employer_org_id, sector_id, title, description) values (public.my_org(), 'mechanics', 'x', 'y')"), '42501', 'pending');
    await rejects(q(pool, U.ada, "insert into public.projects (employer_org_id, sector_id, title, description) values (gen_random_uuid(), 'mechanics', 'x', 'y')"), '42501', 'student');
    const [p] = await q(pool, U.acme, "insert into public.projects (employer_org_id, sector_id, title, description, hours_estimate) values (public.my_org(), 'mechanics', 'Brake service on a Hilux', 'Full brake service', 12) returning id");
    S.project = p.id;
    await q(pool, U.acme, 'insert into public.project_competencies values ($1, $2), ($1, $3)', [S.project, BRAKES, SAFETY]);
    await rejects(q(pool, U.rival, 'insert into public.project_competencies values ($1, $2)', [S.project, DIAG]), '42501', 'rival tags acme project');
  });

  it('links evidence to the project, hides it from everyone but the student and the verifier', async () => {
    const [e] = await q(pool, U.ada, "insert into public.evidence (student_id, project_id, title, description, hours) values ($1, $2, 'Hilux brakes', 'Replaced pads', 6) returning id, verifier_org_id, sector_id, student_name, context_title", [U.ada.id, S.project]);
    S.ev = e.id;
    assert.equal(e.sector_id, 'mechanics');
    assert.equal(e.student_name, 'Ada Uwase');
    assert.equal(e.context_title, 'Brake service on a Hilux');
    assert.ok(e.verifier_org_id);
    await q(pool, U.ada, 'insert into public.evidence_competencies (evidence_id, competency_id) values ($1, $2), ($1, $3)', [S.ev, BRAKES, SAFETY]);
    await rejects(q(pool, U.ada, 'insert into public.evidence_competencies (evidence_id, competency_id, rating) values ($1, $2, 4)', [S.ev, DIAG]), '42501', 'self-rating');
    await rejects(q(pool, U.bea, 'insert into public.evidence_competencies (evidence_id, competency_id) values ($1, $2)', [S.ev, DIAG]), '42501', 'tag others evidence');
    await q(pool, U.ada, "update public.evidence set status = 'submitted' where id = $1", [S.ev]);
    assert.equal((await q(pool, U.acme, 'select id from public.evidence')).length, 1);
    for (const who of ['rival', 'bea', 'college', 'reg']) assert.equal((await q(pool, U[who], 'select id from public.evidence')).length, 0, who);
    assert.equal((await qAnon(pool, 'select id from public.evidence')).length, 0);
    const n = await q(pool, U.acme, "select title from public.notifications where kind = 'evidence_submitted'");
    assert.equal(n.length, 1);
  });

  it('stops students from verifying themselves or editing verification fields', async () => {
    await rejects(q(pool, U.ada, "update public.evidence set status = 'verified' where id = $1", [S.ev]), '42501', 'status');
    await rejects(q(pool, U.ada, "update public.evidence set verifier_note = 'great' where id = $1", [S.ev]), '42501', 'note');
    await rejects(q(pool, U.ada, "update public.evidence set assurance = 'org_verified' where id = $1", [S.ev]), '42501', 'assurance');
    await rejects(q(pool, U.ada, 'update public.evidence set verifier_org_id = null where id = $1', [S.ev]), '42501', 'org');
    await rejects(q(pool, U.ada, "insert into public.evidence (student_id, sector_id, title, status) values ($1, 'mechanics', 'fake', 'verified')", [U.ada.id]), '42501', 'insert verified');
  });

  it('only the owning approved employer can review, and every competency needs a rating', async () => {
    await rejects(q(pool, U.rival, "select public.review_evidence($1, 'verified', '', '{}')", [S.ev]), 'P0002', 'rival');
    await rejects(q(pool, U.pending, "select public.review_evidence($1, 'verified', '', '{}')", [S.ev]), '42501', 'pending');
    await rejects(q(pool, U.ada, "select public.review_evidence($1, 'verified', '', '{}')", [S.ev]), '42501', 'student');
    await rejects(q(pool, U.acme, "select public.review_evidence($1, 'verified', '', $2::jsonb)", [S.ev, JSON.stringify({ [BRAKES]: 3 })]), '22023', 'missing rating');
    await rejects(q(pool, U.acme, "select public.review_evidence($1, 'revision', '', '{}')", [S.ev]), '22023', 'note required');
    await q(pool, U.acme, "select public.review_evidence($1, 'verified', 'Solid work', $2::jsonb, $3::jsonb)", [S.ev, JSON.stringify({ [BRAKES]: 3, [SAFETY]: 4 }), JSON.stringify({ 'pro-communication': 3, 'pro-bogus': 2 })]);
    const [e] = await q(pool, U.ada, 'select status, assurance, verified_by_org_name, verified_at from public.evidence where id = $1', [S.ev]);
    assert.deepEqual([e.status, e.assurance, e.verified_by_org_name], ['verified', 'org_verified', 'Acme Garage']);
    assert.ok(e.verified_at);
    const rows = await q(pool, U.ada, 'select competency_id, rating from public.evidence_competencies where evidence_id = $1 order by competency_id', [S.ev]);
    assert.deepEqual(rows.map((r) => [r.competency_id, r.rating]), [[BRAKES, 3], [SAFETY, 4], ['pro-communication', 3]]);
    assert.equal((await q(pool, U.ada, "select id from public.notifications where kind = 'evidence_verified'")).length, 1);
    await rejects(q(pool, U.acme, "select public.review_evidence($1, 'declined', 'x', '{}')", [S.ev]), '22023', 'already verified');
  });

  it('freezes verified evidence except for showing or hiding it', async () => {
    await rejects(q(pool, U.ada, "update public.evidence set title = 'Changed' where id = $1", [S.ev]), '42501');
    assert.equal((await q(pool, U.ada, 'delete from public.evidence where id = $1 returning id', [S.ev])).length, 0, 'verified work cannot be deleted');
    await q(pool, U.ada, 'update public.evidence set is_public = true where id = $1', [S.ev]);
    assert.equal((await qAnon(pool, 'select id from public.evidence')).length, 1, 'anon sees public verified work');
    assert.equal((await qAnon(pool, 'select rating from public.evidence_competencies where rating is not null')).length, 3);
    const rec = await qAnon(pool, 'select * from public.competency_record($1)', [U.ada.id]);
    assert.equal(rec.find((r) => r.competency_id === SAFETY).best_level, 4);
  });

  it('exposes only opted-in profiles through the public view', async () => {
    assert.equal((await qAnon(pool, 'select * from public.public_profiles')).length, 0);
    await q(pool, U.ada, "update public.profiles set public_profile = true, headline = 'Mechanic apprentice' where id = $1", [U.ada.id]);
    const rows = await qAnon(pool, 'select * from public.public_profiles');
    assert.equal(rows.length, 1);
    assert.deepEqual(Object.keys(rows[0]).sort(), ['full_name', 'headline', 'id', 'sector_ids', 'slug']);
  });
});

describe('outside verifiers: link and USSD', () => {
  it('only self-logged work can go to an outside supervisor', async () => {
    await rejects(q(pool, U.ada, "select * from public.request_external_verification($1, 'Sam', 'Chef', '')", [S.ev]), '22023', 'employer-reviewed');
    const [e] = await q(pool, U.bea, "insert into public.evidence (student_id, sector_id, title, description, hours) values ($1, 'mechanics', 'Gearbox rebuild', 'At uncle''s garage', 8) returning id", [U.bea.id]);
    S.self = e.id;
    await rejects(q(pool, U.bea, "select * from public.request_external_verification($1, 'Sam', 'Owner', '0788123456')", [S.self]), '22023', 'no competencies');
    await q(pool, U.bea, 'insert into public.evidence_competencies (evidence_id, competency_id) values ($1, $2), ($1, $3)', [S.self, DIAG, SAFETY]);
    await rejects(q(pool, U.ada, "select * from public.request_external_verification($1, 'Sam', 'Owner', '')", [S.self]), 'P0002', 'not owner');
    const [r] = await q(pool, U.bea, "select * from public.request_external_verification($1, 'Sam', 'Owner', '0788123456')", [S.self]);
    S.token = r.token; S.code = r.short_code;
    assert.match(r.short_code, /^\d{6}$/);
    assert.ok(r.token.length >= 30 && !/[+/=]/.test(r.token));
    const [ob] = (await pool.query("select channel, recipient, body from public.outbox where recipient = '250788123456'")).rows;
    assert.equal(ob.channel, 'sms');
    assert.ok(ob.body.includes('/v/' + r.token));
    assert.equal((await q(pool, U.bea, 'select id from public.verification_requests')).length, 1);
    assert.equal((await q(pool, U.ada, 'select id from public.verification_requests')).length, 0);
  });

  it('USSD sign-off works only from the registered phone, once', async () => {
    const call = (phone) => pool.query("select public.complete_external_verification(null, $1, $2, null, null, 'verified', null, 3, '', 'ussd')", [S.code, phone]);
    await rejects(call('+250788999999'), 'SP003', 'wrong phone');
    await call('+250788123456');
    const [e] = (await pool.query('select status, assurance, verified_by_name from public.evidence where id = $1', [S.self])).rows;
    assert.deepEqual([e.status, e.assurance, e.verified_by_name], ['verified', 'ussd_attested', 'Sam']);
    const ratings = (await pool.query('select rating from public.evidence_competencies where evidence_id = $1', [S.self])).rows;
    assert.ok(ratings.every((r) => r.rating === 3));
    await rejects(call('+250788123456'), 'SP001', 'reuse');
  });

  it('link sign-off needs a valid token and complete ratings, and marks the assurance level', async () => {
    const [e] = await q(pool, U.bea, "insert into public.evidence (student_id, sector_id, title, description, status) values ($1, 'mechanics', 'Brake bleed', 'Bled brakes', 'draft') returning id", [U.bea.id]);
    await q(pool, U.bea, 'insert into public.evidence_competencies (evidence_id, competency_id) values ($1, $2)', [e.id, BRAKES]);
    const [r] = await q(pool, U.bea, "select * from public.request_external_verification($1, 'Joe', 'Foreman', '')", [e.id]);
    const call = (token, decision, ratings, note = '') => pool.query("select public.complete_external_verification($1, null, null, null, null, $2, $3::jsonb, null, $4, 'link')", [token, decision, JSON.stringify(ratings), note]);
    await rejects(call('bogus', 'verified', {}), 'SP001', 'bad token');
    await rejects(call(r.token, 'verified', {}), 'SP002', 'missing rating');
    await rejects(call(r.token, 'declined', {}, ''), 'SP002', 'note required');
    await call(r.token, 'verified', { [BRAKES]: 2 });
    const [row] = (await pool.query('select assurance, verified_by_name, verified_by_role from public.evidence where id = $1', [e.id])).rows;
    assert.deepEqual([row.assurance, row.verified_by_name, row.verified_by_role], ['external_attested', 'Joe', 'Foreman']);
    await pool.query("update public.verification_requests set used_at = null, expires_at = now() - interval '1 day' where token = $1", [r.token]);
    await rejects(call(r.token, 'verified', { [BRAKES]: 2 }), 'SP001', 'expired');
  });
});

describe('internships, hiring and talent discovery', () => {
  it('runs an internship from application to verified evidence', async () => {
    const [i] = await q(pool, U.acme, "insert into public.internships (employer_org_id, sector_id, title, description, slots, application_deadline) values (public.my_org(), 'mechanics', 'Workshop intern', 'Six weeks', 2, current_date + 7) returning id", []);
    S.intern = i.id;
    await q(pool, U.acme, 'insert into public.internship_competencies values ($1, $2), ($1, $3)', [S.intern, DIAG, SAFETY]);
    const [a] = await q(pool, U.ada, "insert into public.internship_applications (internship_id, student_id, cover_note) values ($1, $2, 'Keen') returning id, student_name, status", [S.intern, U.ada.id]);
    S.app = a.id;
    assert.deepEqual([a.student_name, a.status], ['Ada Uwase', 'applied']);
    await rejects(q(pool, U.bea, "insert into public.internship_applications (internship_id, student_id, status) values ($1, $2, 'accepted')", [S.intern, U.bea.id]), '42501', 'forged status');
    assert.equal((await q(pool, U.acme, "select id from public.notifications where kind = 'application_received'")).length, 1);
    assert.equal((await q(pool, U.rival, 'select 1 from public.internship_applications where id = $1', [S.app])).length, 0, 'rival cannot see applications');
    await rejects(q(pool, U.ada, "update public.internship_applications set status = 'accepted' where id = $1", [S.app]), '22023', 'accept before offer');
    await rejects(q(pool, U.acme, "update public.internship_applications set status = 'accepted' where id = $1", [S.app]), '22023', 'employer accepting');
    await q(pool, U.acme, "update public.internship_applications set status = 'shortlisted' where id = $1", [S.app]);
    await q(pool, U.acme, "update public.internship_applications set status = 'offered' where id = $1", [S.app]);
    assert.ok((await q(pool, U.ada, "select id from public.notifications where kind = 'application_offered'")).length >= 1);
    await q(pool, U.ada, "update public.internship_applications set status = 'accepted' where id = $1", [S.app]);
    await rejects(q(pool, U.rival, "select public.complete_internship($1, '{}')", [S.app]), 'P0002', 'rival completes');
    await rejects(q(pool, U.acme, "select public.complete_internship($1, $2::jsonb)", [S.app, JSON.stringify({ [DIAG]: 3 })]), '22023', 'missing rating');
    const [c] = await q(pool, U.acme, 'select public.complete_internship($1, $2::jsonb, $3::jsonb, $4, 120) as ev', [S.app, JSON.stringify({ [DIAG]: 3, [SAFETY]: 3 }), JSON.stringify({ 'pro-reliability': 4 }), 'Reliable and safe']);
    const [ev] = await q(pool, U.ada, 'select status, assurance, hours, context_title from public.evidence where id = $1', [c.ev]);
    assert.deepEqual([ev.status, ev.assurance, Number(ev.hours), ev.context_title], ['verified', 'org_verified', 120, 'Workshop intern']);
    assert.equal((await q(pool, U.ada, 'select status from public.internship_applications where id = $1', [S.app]))[0].status, 'completed');
  });

  it('rejects applications to closed or expired internships', async () => {
    const [i] = await q(pool, U.acme, "insert into public.internships (employer_org_id, sector_id, title, description, application_deadline) values (public.my_org(), 'mechanics', 'Old', 'x', current_date - 1) returning id");
    await rejects(q(pool, U.bea, 'insert into public.internship_applications (internship_id, student_id) values ($1, $2)', [i.id, U.bea.id]), '22023', 'expired');
  });

  it('shows only discoverable students to approved employers', async () => {
    const find = (who) => q(pool, U[who], "select * from public.discover_talent('mechanics', array[$1]::text[], 3)", [SAFETY]);
    assert.equal((await find('acme')).length, 0, 'not discoverable yet');
    await q(pool, U.ada, 'update public.profiles set discoverable = true where id = $1', [U.ada.id]);
    const hits = await find('acme');
    assert.equal(hits.length, 1);
    assert.equal(hits[0].full_name, 'Ada Uwase');
    assert.ok(hits[0].matched >= 1);
    assert.equal(hits[0].email, undefined);
    await rejects(find('pending'), '42501', 'pending');
    await rejects(find('ada'), '42501', 'student');
  });

  it('moves a candidate through the pipeline and records a hire only through the hire action', async () => {
    const [p] = await q(pool, U.acme, "insert into public.talent_pipeline (employer_org_id, student_id) values (public.my_org(), $1) returning id, stage, student_name", [U.ada.id]);
    S.pipe = p.id;
    assert.deepEqual([p.stage, p.student_name], ['shortlisted', 'Ada Uwase']);
    assert.equal((await q(pool, U.ada, 'select id from public.talent_pipeline')).length, 0, 'hidden while shortlisted');
    await rejects(q(pool, U.bea, 'insert into public.talent_pipeline (employer_org_id, student_id) values (gen_random_uuid(), $1)', [U.bea.id]), '42501', 'student inserts');
    await rejects(q(pool, U.acme, "update public.talent_pipeline set stage = 'hired' where id = $1", [S.pipe]), '42501', 'direct hire');
    await rejects(q(pool, U.acme, "select public.hire_student($1, 'Mechanic')", [U.ada.id]), '22023', 'not interviewing');
    await q(pool, U.acme, "update public.talent_pipeline set stage = 'invited' where id = $1", [S.pipe]);
    assert.equal((await q(pool, U.ada, 'select stage from public.talent_pipeline')).length, 1, 'visible once invited');
    await q(pool, U.acme, "update public.talent_pipeline set stage = 'interviewing' where id = $1", [S.pipe]);
    const [h] = await q(pool, U.acme, "select public.hire_student($1, 'Junior mechanic') as id", [U.ada.id]);
    S.employment = h.id;
    const [emp] = await q(pool, U.ada, 'select job_title, employer_confirmed, source from public.employments');
    assert.deepEqual([emp.job_title, emp.employer_confirmed, emp.source], ['Junior mechanic', true, 'pipeline']);
    assert.equal((await q(pool, U.ada, 'select status from public.outcomes'))[0].status, 'employed');
    await rejects(q(pool, U.acme, "update public.talent_pipeline set stage = 'offered' where id = $1", [S.pipe]), '22023', 'hired is final');
    await rejects(q(pool, U.ada, 'update public.employments set employer_confirmed = false where id = $1', [S.employment]), '42501', 'unconfirm');
    await q(pool, U.ada, "update public.employments set related_to_field = 'directly' where id = $1", [S.employment]);
  });

  it('lets students record their own employment as unconfirmed', async () => {
    await rejects(q(pool, U.bea, "insert into public.employments (student_id, job_title, source, employer_confirmed) values ($1, 'Boss', 'self_reported', true)", [U.bea.id]), '42501');
    await q(pool, U.bea, "insert into public.employments (student_id, job_title, employer_name, source) values ($1, 'Apprentice', 'Uncle Garage', 'self_reported')", [U.bea.id]);
  });
});

describe('curriculum, assessments, standards and gap analysis', () => {
  it('lets an approved institution build programmes, courses and competency maps', async () => {
    await rejects(q(pool, U.acme, "insert into public.programmes (institution_org_id, name) values (public.my_org(), 'x')"), '42501', 'employer');
    const [p] = await q(pool, U.college, "insert into public.programmes (institution_org_id, name, sector_id, level) values (public.my_org(), 'Diploma in Automotive Technology', 'mechanics', 'Diploma') returning id");
    S.prog = p.id;
    const [c] = await q(pool, U.college, "insert into public.courses (programme_id, code, name) values ($1, 'AUT101', 'Engine systems') returning id", [S.prog]);
    S.course = c.id;
    await q(pool, U.college, 'insert into public.course_competencies values ($1, $2, 2), ($1, $3, 4)', [S.course, DIAG, SAFETY]);
    await rejects(q(pool, U.other, 'insert into public.course_competencies values ($1, $2, 1)', [S.course, BRAKES]), '42501', 'other college');
  });

  it('handles enrolment requests and confirmation', async () => {
    await rejects(q(pool, U.ada, "insert into public.enrollments (student_id, institution_org_id, programme_id, status) values ($1, (select id from public.organizations where name = 'Other College'), $2, 'requested')", [U.ada.id, S.prog]), '42501', 'programme mismatch');
    const [en] = await q(pool, U.ada, "insert into public.enrollments (student_id, institution_org_id, programme_id) values ($1, (select institution_org_id from public.programmes where id = $2), $2) returning id, student_name", [U.ada.id, S.prog]);
    S.enr = en.id;
    assert.equal(en.student_name, 'Ada Uwase');
    await rejects(q(pool, U.ada, "update public.enrollments set status = 'confirmed' where id = $1", [S.enr]), '42501', 'self confirm');
    assert.equal((await q(pool, U.other, 'select id from public.enrollments')).length, 0);
    await q(pool, U.college, "update public.enrollments set status = 'confirmed', start_year = 2024 where id = $1", [S.enr]);
    await rejects(q(pool, U.college, "update public.enrollments set status = 'requested' where id = $1", [S.enr]), '22023', 'backwards');
  });

  it('records assessment results for enrolled students only and feeds the competency record', async () => {
    const [a] = await q(pool, U.college, "insert into public.assessments (owner_org_id, sector_id, course_id, title, kind) values (public.my_org(), 'mechanics', $1, 'Engine diagnostics practical', 'practical') returning id", [S.course]);
    S.assess = a.id;
    await q(pool, U.college, 'insert into public.assessment_competencies values ($1, $2, 3)', [S.assess, DIAG]);
    await rejects(q(pool, U.college, "select public.record_assessment_result($1, $2, '{}'::jsonb)", [S.assess, U.ada.id]), '22023', 'no levels');
    await rejects(q(pool, U.college, "select public.record_assessment_result($1, $2, $3::jsonb)", [S.assess, U.bea.id, JSON.stringify({ [DIAG]: 3 })]), '22023', 'not enrolled');
    await rejects(q(pool, U.college, "select public.record_assessment_result($1, $2, $3::jsonb)", [S.assess, U.ada.id, JSON.stringify({ [BRAKES]: 3 })]), '22023', 'not in assessment');
    await rejects(q(pool, U.other, "select public.record_assessment_result($1, $2, $3::jsonb)", [S.assess, U.ada.id, JSON.stringify({ [DIAG]: 3 })]), 'P0002', 'wrong org');
    const [r] = await q(pool, U.college, "select public.record_assessment_result($1, $2, $3::jsonb, 'Good') as id", [S.assess, U.ada.id, JSON.stringify({ [DIAG]: 4 })]);
    S.result = r.id;
    assert.equal((await q(pool, U.ada, "select id from public.notifications where kind = 'assessment_result'")).length, 1);
    assert.equal((await q(pool, U.bea, 'select id from public.assessment_results')).length, 0);
    assert.equal((await qAnon(pool, 'select id from public.assessment_results')).length, 0, 'private until published');
    await rejects(q(pool, U.ada, "update public.assessment_results set note = 'edited' where id = $1", [S.result]), '42501', 'edit');
    await q(pool, U.ada, 'update public.assessment_results set is_public = true where id = $1', [S.result]);
    assert.equal((await qAnon(pool, 'select id from public.assessment_results')).length, 1);
    const rec = await q(pool, U.ada, 'select * from public.competency_record($1)', [U.ada.id]);
    const diag = rec.find((x) => x.competency_id === DIAG);
    assert.equal(diag.best_level, 4);
    assert.equal(diag.assessment_count, 1);
  });

  it('computes demand from standards, projects and internships, and the institution gap', async () => {
    const [s] = await q(pool, U.acme, "insert into public.standards (employer_org_id, sector_id, role_title, review_by) values (public.my_org(), 'mechanics', 'Junior mechanic', current_date + 90) returning id");
    S.std = s.id;
    await q(pool, U.acme, 'insert into public.standard_competencies values ($1, $2, 3, 3), ($1, $3, 2, 3), ($1, $4, 1, 2)', [S.std, DIAG, BRAKES, SAFETY]);
    await rejects(q(pool, U.rival, 'insert into public.standard_competencies values ($1, $2, 1, 1)', [S.std, DIAG]), '42501', 'rival edits standard');
    const demand = await q(pool, U.ada, "select * from public.competency_demand('mechanics')");
    assert.equal(demand[0].competency_id, DIAG);
    assert.ok(demand.find((d) => d.competency_id === BRAKES).essential === 0);
    const gap = await q(pool, U.college, "select * from public.competency_gap('mechanics')");
    const by = Object.fromEntries(gap.map((g) => [g.competency_id, g.status]));
    assert.equal(by[BRAKES], 'gap', 'no course teaches brakes');
    assert.equal(by[DIAG], 'partial', 'coverage 2 < required 3');
    assert.equal(by[SAFETY], 'covered');
    await rejects(q(pool, U.acme, "select * from public.competency_gap('mechanics')"), '42501', 'employer');
    await rejects(q(pool, U.ada, "select * from public.competency_gap('mechanics')"), '42501', 'student');
  });

  it('records institution responses and tells the employer', async () => {
    await q(pool, U.college, "insert into public.standard_responses (standard_id, institution_org_id, status, note) values ($1, public.my_org(), 'planned', 'Adding brakes lab') returning id", [S.std]);
    await rejects(q(pool, U.college, "insert into public.standard_responses (standard_id, institution_org_id, status) values ($1, gen_random_uuid(), 'adopted')", [S.std]), '42501', 'spoof org');
    assert.equal((await q(pool, U.acme, "select id from public.notifications where kind = 'standard_response'")).length, 1);
    await q(pool, U.college, "insert into public.curriculum_actions (institution_org_id, programme_id, competency_id, source, title) values (public.my_org(), $1, $2, 'skills_gap', 'Add brakes lab')", [S.prog, BRAKES]);
    assert.equal((await q(pool, U.other, 'select id from public.curriculum_actions')).length, 0);
  });
});

describe('graduate outcomes and employer feedback (consent and k-anonymity)', () => {
  const grads = [];
  it('keeps individual outcomes, feedback and requests away from institutions', async () => {
    for (const t of ['outcomes', 'employer_feedback', 'verification_requests', 'internship_applications']) {
      assert.equal((await q(pool, U.college, 'select * from public.' + t)).length, 0, t);
    }
    // the only evidence an institution can ever see is work a student chose to publish
    assert.equal((await q(pool, U.college, 'select id from public.evidence where not is_public')).length, 0, 'private evidence');
  });

  it('suppresses small groups and respects consent', async () => {
    await q(pool, U.college, "update public.enrollments set status = 'graduated', graduated_on = date '2025-06-30' where id = $1", [S.enr]);
    await q(pool, U.ada, "insert into public.outcomes (student_id, status, share_with_institution) values ($1, 'employed', true) on conflict (student_id) do update set share_with_institution = true", [U.ada.id]);
    await pool.query("update public.employments set started_on = date '2025-08-15' where student_id = $1", [U.ada.id]);
    let [row] = await q(pool, U.college, 'select * from public.outcome_summary()');
    assert.equal(row.respondents, 1);
    assert.equal(row.suppressed, true);
    assert.equal(row.employed, null);
    for (let i = 1; i <= 5; i++) {
      const u = await mkUser(pool, 'grad' + i + '@x.rw', { role: 'student', full_name: 'Grad ' + i });
      grads.push(u);
      await pool.query("insert into public.enrollments (student_id, institution_org_id, programme_id, status, graduated_on) select $1, institution_org_id, id, 'graduated', date '2025-06-30' from public.programmes where id = $2", [u.id, S.prog]);
      await q(pool, u, "insert into public.outcomes (student_id, status, share_with_institution) values ($1, $2, $3)", [u.id, i === 5 ? 'seeking' : 'employed', i !== 4]);
      await pool.query("insert into public.employments (student_id, job_title, sector_id, started_on, related_to_field, source) values ($1, 'Tech', 'mechanics', date '2025-08-15', $2, 'self_reported')", [u.id, i <= 2 ? 'directly' : 'partly']);
    }
    [row] = await q(pool, U.college, 'select * from public.outcome_summary($1)', [S.prog]);
    assert.equal(row.graduates, 6);
    assert.equal(row.respondents, 5, 'grad4 did not consent');
    assert.equal(row.suppressed, false);
    assert.equal(row.employed, 4, 'ada and three consenting graduates');
    assert.equal(row.seeking, 1);
    assert.equal(Number(row.avg_days_to_work), 46);
    assert.equal((await q(pool, U.other, 'select * from public.outcome_summary()')).length, 0, 'another institution sees nothing of this cohort');
    await rejects(q(pool, U.acme, 'select * from public.outcome_summary()'), '42501', 'employer');
  });

  it('lets employers give feedback only about people they employed or hosted', async () => {
    const fb = (who, student, extra = {}) => q(pool, U[who], 'select public.submit_feedback($1, $2, $3, $4, $5, $6, $7::jsonb) as id',
      [student, extra.emp ?? null, extra.app ?? null, 'mostly', true, 'Good', JSON.stringify(extra.levels ?? { [DIAG]: { observed: 2, expected: 3 } })]);
    await rejects(fb('rival', U.ada.id, { emp: S.employment }), '42501', 'rival');
    await rejects(fb('acme', U.bea.id, { emp: S.employment }), '42501', 'wrong student');
    await rejects(q(pool, U.ada, "select public.submit_feedback($1, null, $2, 'ready', true)", [U.ada.id, S.app]), '42501', 'student');
    await fb('acme', U.ada.id, { emp: S.employment });
    assert.equal((await q(pool, U.ada, 'select id from public.employer_feedback')).length, 1, 'student can read own feedback');
    assert.equal((await q(pool, U.rival, 'select id from public.employer_feedback')).length, 0);
    assert.equal((await q(pool, U.acme, 'select feedback_id from public.feedback_competencies')).length, 1);
  });

  it('aggregates feedback only once enough consenting graduates are covered', async () => {
    let [prep] = await q(pool, U.college, 'select * from public.feedback_preparedness()');
    assert.equal(prep.suppressed, true);
    assert.equal((await q(pool, U.college, 'select * from public.feedback_summary()')).length, 0);
    for (const g of grads) {
      const [emp] = (await pool.query("select id from public.employments where student_id = $1", [g.id])).rows;
      await pool.query("update public.employments set employer_org_id = (select org_id from public.profiles where id = $1) where id = $2", [U.acme.id, emp.id]);
      await q(pool, U.acme, 'select public.submit_feedback($1, $2, null, $3, $4, $5, $6::jsonb)', [g.id, emp.id, 'ready', true, '', JSON.stringify({ [DIAG]: { observed: 2, expected: 3 }, [SAFETY]: { observed: 3, expected: 3 } })]);
    }
    [prep] = await q(pool, U.college, 'select * from public.feedback_preparedness()');
    assert.equal(prep.suppressed, false);
    assert.equal(prep.responses, 5, 'grad4 has not consented, ada is enrolled and consented');
    const sum = await q(pool, U.college, 'select * from public.feedback_summary()');
    const diag = sum.find((s) => s.competency_id === DIAG);
    assert.equal(Number(diag.shortfall), 1);
    assert.equal(sum.find((s) => s.competency_id === SAFETY), undefined, 'only four responses for safety, below the minimum group');
  });
});

describe('regulation', () => {
  it('scores progress against requirements and reports institution-level compliance', async () => {
    const [r] = await q(pool, U.reg, "insert into public.requirements (regulator_org_id, sector_id, title, min_hours, min_level) values (public.my_org(), 'mechanics', 'Licensing: practical hours', 100, 3) returning id");
    S.req = r.id;
    await q(pool, U.reg, 'insert into public.requirement_competencies values ($1, $2), ($1, $3)', [S.req, DIAG, SAFETY]);
    await rejects(q(pool, U.acme, "insert into public.requirements (regulator_org_id, sector_id, title) values (public.my_org(), 'mechanics', 'x')"), '42501', 'employer');
    const mine = await q(pool, U.ada, 'select * from public.my_requirement_progress()');
    assert.equal(mine.length, 1);
    assert.equal(mine[0].total_competencies, 2);
    assert.equal(mine[0].met_competencies, 2, 'diag 4 (assessment) and safety 4 (evidence)');
    assert.equal(Number(mine[0].hours), 126, '6 project hours + 120 internship hours');
    assert.equal(mine[0].met, true);
    const comp = await q(pool, U.reg, 'select * from public.regulator_compliance($1)', [S.req]);
    assert.equal(comp.length, 1);
    assert.equal(comp[0].institution_name, 'Kigali Tech College');
    assert.equal(comp[0].students, 6);
    assert.equal(comp[0].meeting, 1);
    await rejects(q(pool, U.college, 'select * from public.regulator_compliance($1)', [S.req]), '42501', 'institution');
  });
});

describe('media, dashboards and reminders', () => {
  it('scopes storage to the owner and to public evidence', async () => {
    await rejects(q(pool, U.ada, "insert into public.evidence_media (evidence_id, storage_path, kind) values ($1, $2, 'image')", [S.ev, U.ada.id + '/' + S.ev + '/photo.jpg']), '42501', 'media on verified evidence');
    const [d] = await q(pool, U.ada, "insert into public.evidence (student_id, sector_id, title) values ($1, 'mechanics', 'Draft') returning id", [U.ada.id]);
    const path = U.ada.id + '/' + d.id + '/photo.jpg';
    await q(pool, U.ada, "insert into storage.objects (bucket_id, name, owner) values ('evidence-media', $1, $2)", [path, U.ada.id]);
    await q(pool, U.ada, "insert into public.evidence_media (evidence_id, storage_path, kind) values ($1, $2, 'image')", [d.id, path]);
    await rejects(q(pool, U.ada, "insert into public.evidence_media (evidence_id, storage_path, kind) values ($1, $2, 'image')", [d.id, U.bea.id + '/x/photo.jpg']), '42501', 'foreign path');
    await rejects(q(pool, U.bea, "insert into storage.objects (bucket_id, name, owner) values ('evidence-media', $1, $2)", [U.ada.id + '/other.jpg', U.bea.id]), '42501', 'upload into another folder');
    assert.equal((await q(pool, U.ada, "select name from storage.objects where bucket_id = 'evidence-media'")).length, 1);
    assert.equal((await q(pool, U.bea, "select name from storage.objects where bucket_id = 'evidence-media'")).length, 0);
    assert.equal((await qAnon(pool, "select name from storage.objects where bucket_id = 'evidence-media'")).length, 0);
  });

  it('returns role-specific dashboard numbers', async () => {
    const [a] = await q(pool, U.acme, 'select public.dashboard_stats() as s');
    assert.equal(a.s.role, 'employer');
    assert.ok('to_review' in a.s && 'pipeline' in a.s);
    const [b] = await q(pool, U.boss, 'select public.dashboard_stats() as s');
    assert.ok(b.s.admin && 'pending_orgs' in b.s.admin);
    const [c] = await q(pool, U.college, 'select public.dashboard_stats() as s');
    assert.ok('standards_awaiting_response' in c.s);
    assert.equal((await q(pool, U.ada, 'select public.dashboard_stats() as s'))[0].s.admin, undefined);
  });

  it('lets people read and mark only their own notifications', async () => {
    const mine = await q(pool, U.ada, 'select id from public.notifications');
    assert.ok(mine.length > 0);
    await q(pool, U.ada, 'update public.notifications set read_at = now() where id = $1', [mine[0].id]);
    await rejects(q(pool, U.ada, "update public.notifications set title = 'x' where id = $1", [mine[0].id]), '42501', 'edit title');
    const theirs = await pool.query('select id from public.notifications where user_id = $1 limit 1', [U.acme.id]);
    assert.equal((await q(pool, U.ada, 'update public.notifications set read_at = now() where id = $1 returning id', [theirs.rows[0].id])).length, 0);
  });
});
