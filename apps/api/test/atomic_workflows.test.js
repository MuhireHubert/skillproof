import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resetDb, makePool, mkUser, approveOrgOf, q, rejects } from './helpers.js';

const pool = makePool();
const DIAG = 'mechanics-engine-diagnostics';
const SAFETY = 'mechanics-workshop-safety';
const BAD = 'not-a-real-competency';
const P = () => JSON.stringify;

const U = {};

before(async () => {
  await resetDb();
  U.student = await mkUser(pool, 'atomic-student@x.rw', { role: 'student', full_name: 'Atomic Student' });
  U.employer = await mkUser(pool, 'atomic-employer@x.rw', { role: 'employer', full_name: 'Atomic Employer', org_name: 'Atomic Garage', sector_ids: ['mechanics'] });
  await approveOrgOf(pool, U.employer);
});

after(async () => { await pool.end(); });

describe('atomic business workflows', () => {
  it('publishes a standard atomically and rolls back invalid competency input', async () => {
    await rejects(
      q(pool, U.employer,
        'select public.publish_standard($1,$2,$3,$4::jsonb)',
        ['mechanics', 'Junior Mechanic', '2027-01-01', P([
          { competency_id: DIAG, importance: 3, level: 3 },
          { competency_id: BAD, importance: 2, level: 2 },
        ])]),
      '22023'
    );
    const standards = await q(pool, U.employer, "select count(*)::int as n from public.standards where role_title = 'Junior Mechanic'");
    assert.equal(standards[0].n, 0);

    const rows = await q(pool, U.employer,
      'select public.publish_standard($1,$2,$3,$4::jsonb) as id',
      ['mechanics', 'Junior Mechanic', '2027-01-01', P([{ competency_id: DIAG, importance: 3, level: 3 }, { competency_id: SAFETY, importance: 2, level: 2 }])]);
    assert.ok(rows[0].id);
    const links = await q(pool, U.employer, 'select count(*)::int as n from public.standard_competencies where standard_id=$1', [rows[0].id]);
    assert.equal(links[0].n, 2);
  });

  it('creates a project atomically and lets a student start exactly one evidence record', async () => {
    const rows = await q(pool, U.employer,
      'select public.publish_project($1,$2,$3,$4,$5,$6::jsonb) as id',
      ['mechanics', 'Brake diagnostics challenge', 'Diagnose the braking fault and document the repair.', 'challenge', 8, P([{ competency_id: DIAG }, { competency_id: SAFETY }])]);
    const projectId = rows[0].id;
    const studentEvidence = await q(pool, U.student, 'select public.start_project_evidence($1) as id', [projectId]);
    assert.ok(studentEvidence[0].id);
    const again = await q(pool, U.student, 'select public.start_project_evidence($1) as id', [projectId]);
    assert.equal(again[0].id, studentEvidence[0].id);
    const evidence = await q(pool, U.student, 'select status, verifier_org_id from public.evidence where id=$1', [studentEvidence[0].id]);
    assert.equal(evidence[0].status, 'draft');
    assert.ok(evidence[0].verifier_org_id);
  });

  it('enforces internship capacity in the same transaction as an application', async () => {
    const rows = await q(pool, U.employer,
      'select public.publish_internship($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb) as id',
      ['mechanics', 'Workshop placement', 'Eight-week supervised workshop placement.', 'Kigali', '2027-01-10', 8, 1, '', '2027-01-01', P([{ competency_id: DIAG }])]);
    const internshipId = rows[0].id;
    const app = await q(pool, U.student, 'select public.apply_to_internship($1,$2) as id', [internshipId, 'I would like to learn through supervised work.']);
    assert.ok(app[0].id);
    const again = await q(pool, U.student, 'select public.apply_to_internship($1,$2) as id', [internshipId, 'Updated note.']);
    assert.equal(again[0].id, app[0].id);

    await q(pool, U.employer, "update public.internship_applications set status='accepted' where id=$1", [app[0].id]);
    const other = await mkUser(pool, 'atomic-other@x.rw', { role: 'student', full_name: 'Other Student' });
    await rejects(
      q(pool, other, 'select public.apply_to_internship($1,$2)', [internshipId, 'Please consider me.']),
      '23514'
    );
  });
});
