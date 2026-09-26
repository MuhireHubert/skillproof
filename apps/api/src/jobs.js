import { withService } from './db.js';

// Nudges employers whose published standards are due for review (once per 30 days per standard).
export async function runReminders(pool) {
  return withService(pool, async (c) => {
    const { rowCount } = await c.query(
      `insert into public.notifications (user_id, kind, title, body, link)
       select p.id, 'standard_review_due', 'Standard due for review: ' || s.role_title, 'Review by ' || s.review_by, '/standards'
         from public.standards s join public.profiles p on p.org_id = s.employer_org_id
        where s.status = 'published' and s.review_by <= current_date + 14
          and not exists (select 1 from public.notifications n
                           where n.user_id = p.id and n.kind = 'standard_review_due'
                             and n.title = 'Standard due for review: ' || s.role_title
                             and n.created_at > now() - interval '30 days')`);
    return { created: rowCount };
  });
}

export function hasProviders(config) {
  return Boolean((config.atApiKey && config.atUsername) || config.resendApiKey);
}

export function createSender(config, fetchImpl = fetch) {
  const senders = {};
  if (config.atApiKey && config.atUsername) {
    senders.sms = async ({ recipient, body }) => {
      const form = new URLSearchParams({ username: config.atUsername, to: '+' + recipient, message: body });
      if (config.atSenderId) form.set('from', config.atSenderId);
      const res = await fetchImpl('https://api.africastalking.com/version1/messaging', {
        method: 'POST',
        headers: { apiKey: config.atApiKey, accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
        body: form,
      });
      if (!res.ok) throw new Error('SMS provider returned ' + res.status);
    };
  }
  if (config.resendApiKey) {
    senders.email = async ({ recipient, subject, body }) => {
      const res = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: 'Bearer ' + config.resendApiKey, 'content-type': 'application/json' },
        body: JSON.stringify({ from: config.emailFrom, to: [recipient], subject, text: body }),
      });
      if (!res.ok) throw new Error('Email provider returned ' + res.status);
    };
  }
  return (msg) => {
    const s = senders[msg.channel];
    if (!s) throw new Error('No provider configured for ' + msg.channel);
    return s(msg);
  };
}

// Sends queued SMS/email. Rows are locked with SKIP LOCKED so several workers can run safely.
export async function flushOutbox(pool, send, limit = 20) {
  return withService(pool, async (c) => {
    const { rows } = await c.query(
      "select * from public.outbox where status = 'pending' and attempts < 5 order by id limit $1 for update skip locked", [limit]);
    let sent = 0;
    let failed = 0;
    for (const m of rows) {
      try {
        await send(m);
        await c.query("update public.outbox set status = 'sent', sent_at = now(), attempts = attempts + 1, error = null where id = $1", [m.id]);
        sent++;
      } catch (err) {
        const dead = m.attempts + 1 >= 5;
        await c.query('update public.outbox set attempts = attempts + 1, error = $2, status = $3 where id = $1',
          [m.id, String(err.message).slice(0, 300), dead ? 'failed' : 'pending']);
        failed++;
      }
    }
    return { sent, failed };
  });
}
