# SkillProof production setup

This checklist is required before inviting real users. The frontend changes cannot override Supabase project-level email limits or securely grant platform administrator privileges by themselves.

## 1. Supabase Auth URL configuration

In **Supabase Dashboard → Authentication → URL Configuration**:

- Set **Site URL** to `https://muhirehubert.github.io/skillproof/`.
- Add `https://muhirehubert.github.io/skillproof/` to the allowed redirect URLs.
- If a custom domain is adopted later, add that exact production URL and update the app's production configuration.
- Do not leave the production Site URL pointing to `http://localhost:5173` or `http://localhost:3000`.

The web app now explicitly supplies its deployed app base URL for signup confirmation and password-reset emails. Local development will still use the local origin when running locally.

## 2. Bootstrap the platform administrator

The platform admin is intentionally separate from employer, institution and regulator accounts. Do not expose an “admin” role in public registration and do not grant admin rights from frontend code.

1. Create an account using the intended administrator email.
2. Confirm that email using the confirmation link.
3. In **Supabase Dashboard → SQL Editor**, run the following, replacing the example email with the confirmed administrator's email in lowercase:

```sql
insert into public.app_admins (email)
values ('replace-with-confirmed-admin-email@example.com')
on conflict (email) do nothing;
```

4. Sign out and sign back in. Administrators are routed to a dedicated `/admin` workspace and do not need a student or organisation profile.
5. The administrator workspace provides sector and competency lifecycle management, organisation governance, administrator grants/revocations, aggregate reports, audit history and selected operational settings.
6. Keep the list limited to trusted platform operators. To remove an administrator:

```sql
delete from public.app_admins
where email = lower('replace-with-confirmed-admin-email@example.com');
```

This one-time step is necessary because a platform admin must be granted by a trusted database operator; a public self-service admin signup would be a security vulnerability.

## 3. Reduce email delivery failures

Supabase's built-in email service has strict sending limits and is intended mainly for testing. The frontend now prevents rapid repeated reset requests and gives a clearer message when the provider reports a rate limit, but it cannot bypass the provider's server-side limit.

For production:

1. Configure a custom SMTP provider in **Supabase Dashboard → Project Settings / Authentication SMTP settings** (menu labels may vary).
2. Verify the sender domain with that provider and use a consistent sender address.
3. Set suitable per-hour limits with the provider and enable delivery/bounce logs.
4. Test signup confirmation and password recovery with a small set of consenting test accounts before launch.
5. Avoid repeatedly clicking resend or creating many test accounts in a short period.

## 4. Apply the database changes

Run migrations in order against the intended Supabase project, including `20261009000001_production_app_url.sql` and `20261010000001_platform_admin_workspace.sql`. The latter adds the competency active flag, admin audit log, secure admin-management/settings/reporting RPCs, and audit triggers. GitHub Pages deployment does not apply database migrations automatically. Verify that `public.app_settings.public_app_url` is `https://muhirehubert.github.io/skillproof`.

## 5. Production smoke test

- Register a student and confirm that the email returns to the deployed SkillProof site, not localhost.
- Register an organisation and verify that its sector selector opens, supports search, and keeps multiple selections visible.
- Trigger password reset, follow the link, set a new password, and sign in with it.
- Sign in as the seeded platform administrator and confirm the dedicated admin workspace opens without a student profile.
- Add a test sector, verify it appears in registration selectors, deactivate it, and verify it disappears from new selections while historical records remain.
- Add/edit/retire a test competency and verify active selectors update.
- Test organisation approval/suspension, admin grant/revocation safeguards, settings validation and audit records.
- Confirm the organisation status changes from pending to approved, then test an action that requires approval.
- Test on a narrow mobile viewport as well as desktop.
