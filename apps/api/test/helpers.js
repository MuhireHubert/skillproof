import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withUser } from '../src/db.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const sqlDir = path.resolve(here, '../../../supabase');
export const TEST_URL = process.env.TEST_DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/skillproof_test';

// Rebuilds the test database from the real migrations (plus the Supabase shim and seed).
export async function resetDb() {
  const c = new pg.Client({ connectionString: TEST_URL });
  await c.connect();
  const files = [
    'tests/shim.sql',
    ...fs.readdirSync(path.join(sqlDir, 'migrations')).sort().map((f) => 'migrations/' + f),
    'seed.sql',
  ];
  for (const f of files) await c.query(fs.readFileSync(path.join(sqlDir, f), 'utf8'));
  await c.end();
}

export const makePool = () => new pg.Pool({ connectionString: TEST_URL, max: 8 });

export async function mkUser(pool, email, meta = {}) {
  const { rows } = await pool.query('insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id', [email, JSON.stringify(meta)]);
  return { id: rows[0].id, email };
}
export async function approveOrgOf(pool, user) {
  await pool.query("update public.organizations set status = 'approved' where id = (select org_id from public.profiles where id = $1)", [user.id]);
}

// Run one statement as a signed-in user (RLS applies) and return the rows.
export async function q(pool, user, sql, params = []) {
  return withUser(pool, user, async (c) => (await c.query(sql, params)).rows);
}
// Run as the anonymous role.
export async function qAnon(pool, sql, params = []) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('set local role anon');
    const r = await client.query(sql, params);
    await client.query('commit');
    return r.rows;
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
// Assert that a promise rejects with the given SQLSTATE.
export async function rejects(promise, code, label = '') {
  try {
    await promise;
  } catch (e) {
    if (e.code !== code) throw new Error(label + ' expected SQLSTATE ' + code + ' but got ' + e.code + ': ' + e.message);
    return e;
  }
  throw new Error(label + ' expected SQLSTATE ' + code + ' but the statement succeeded');
}
