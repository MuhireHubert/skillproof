import pg from 'pg';

export function createPool(connectionString, opts = {}) {
  return new pg.Pool({ connectionString, max: 10, ...opts });
}

async function inTransaction(pool, setup, fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    if (setup) await setup(client);
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Runs fn as the signed-in user: same role and JWT claims PostgREST would use, so Row Level
// Security and the SQL functions' own checks apply exactly as they do for the web app.
export function withUser(pool, user, fn) {
  return inTransaction(
    pool,
    async (c) => {
      await c.query('set local role authenticated');
      await c.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: user.id, email: user.email, role: 'authenticated' }),
      ]);
    },
    fn,
  );
}

// Privileged connection (table owner). Only for flows where the caller has no account:
// link and USSD sign-off, scheduled jobs. Every such flow validates a secret itself.
export function withService(pool, fn) {
  return inTransaction(pool, null, fn);
}
