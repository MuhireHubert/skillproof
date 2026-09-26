import { Router } from 'express';
import crypto from 'node:crypto';
import { withService } from '../db.js';

const LEVEL_MENU = [
  ['1', 'Works independently to workplace standard', 3],
  ['2', 'Works with light supervision', 2],
  ['3', 'Still learning, needs guidance', 1],
];
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '.' : s);

// Africa's Talking style: text is the "*"-joined history of answers. Reply starts with CON (continue) or END.
// The sign-off is only accepted from the phone number the student registered for the supervisor.
export async function handleUssd(pool, { text = '', phoneNumber = '' }) {
  const parts = String(text).split('*').filter((p, i, a) => !(i === 0 && a.length === 1 && p === ''));
  if (parts.length === 0) return 'CON SkillProof supervisor sign-off\nEnter the 6-digit code the student gave you:';
  const code = parts[0].trim();
  if (!/^\d{6}$/.test(code)) return 'END That code is not valid. Dial again and enter the 6-digit code.';

  const row = await withService(pool, async (c) => (await c.query(
    `select vr.verifier_contact, public.normalize_contact($2) as caller, e.student_name, e.title
       from public.verification_requests vr join public.evidence e on e.id = vr.evidence_id
      where vr.short_code = $1 and vr.used_at is null and vr.expires_at > now() and e.status = 'submitted'`,
    [code, phoneNumber])).rows[0]);
  if (!row) return 'END That code is invalid or has expired.';
  if (!row.verifier_contact || row.verifier_contact.includes('@')) return 'END This code cannot be used by phone. Use the link the student shared.';
  if (row.verifier_contact !== row.caller) return 'END This code is registered to a different phone number.';

  if (parts.length === 1) {
    const menu = LEVEL_MENU.map(([k, label]) => k + ' ' + label).join('\n');
    return 'CON ' + clip(row.student_name, 24) + ': ' + clip(row.title, 40) + '\nRate their work:\n' + menu + '\n4 Decline';
  }
  const choice = parts[1].trim();
  const level = LEVEL_MENU.find(([k]) => k === choice);
  if (!level && choice !== '4') return 'END Invalid choice. Dial again to retry.';
  try {
    await withService(pool, (c) => c.query(
      'select public.complete_external_verification(null, $1, $2, null, null, $3, null, $4, $5, $6)',
      [code, phoneNumber, level ? 'verified' : 'declined', level ? level[2] : null,
       level ? '' : 'Declined by the supervisor by phone', 'ussd']));
  } catch (err) {
    if (err.code === 'SP001') return 'END That code is invalid or has expired.';
    if (err.code === 'SP003') return 'END This code is registered to a different phone number.';
    throw err;
  }
  return level ? 'END Thank you. Your sign-off has been recorded.' : 'END Recorded. The student has been told the work was declined.';
}

export function ussdRoutes({ pool, config, limiter }) {
  const r = Router();
  r.post('/', limiter, async (req, res) => {
    if (config.ussdSecret) {
      const given = Buffer.from(String(req.query.key || ''));
      const want = Buffer.from(config.ussdSecret);
      if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return res.status(403).type('text/plain').send('END Not allowed');
    }
    let out;
    try {
      out = await handleUssd(pool, { text: req.body.text, phoneNumber: req.body.phoneNumber });
    } catch (err) {
      console.error('ussd error', err);
      out = 'END Something went wrong. Please try again later.';
    }
    res.type('text/plain').send(out);
  });
  return r;
}
