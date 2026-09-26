# SkillProof

A sector-neutral platform that closes the degree-to-work gap. Industry sets standards, universities teach and assess against them, students build verified evidence, employers discover, assess, host and hire, and graduate outcomes and employer feedback flow back into the curriculum.

**Stack:** React + Vite + Tailwind (web), Node.js + Express (API), PostgreSQL on Supabase (data, auth, storage, row-level security).

```
industry standards ──► universities (curriculum ↔ competencies ↔ assessments)
        ▲                          │
        │                          ▼
 employer feedback ◄── employers ◄── students (learning → projects → assessments → internships → evidence profile)
        ▲                  │  discover → assess → intern → hire
        └──── graduate outcomes ◄──┘        …and back into curriculum actions
```

## One object chain, every sector

`Student → Competency → Evidence → Assessment → Project → Employer → Internship → Employment → Outcome → Feedback`

Only the data in `sectors` and `competencies` changes by sector. Eight sectors ship in `supabase/seed.sql` (technology, marketing, economics, law, education, hospitality, food and beverage, mechanics) plus five cross-sector professional competencies. Add a sector or competency with SQL or the Admin screen; nothing in the code changes.

## Modules and where they live

| Module | Where |
|---|---|
| Student / University / Employer portals | `apps/web/src/pages/student.jsx`, `institution.jsx`, `employer.jsx` (+ `regulator.jsx`, `Admin.jsx`) |
| Competency framework | tables `sectors`, `competencies`; admin screen |
| Industry standards and skills demand | `standards*`, `competency_demand()`; employer Standards, institution Demand |
| Curriculum ↔ competencies | `programmes`, `courses`, `course_competencies`; Programmes screen with AI-assisted mapping |
| Assessments | `assessments*`, `record_assessment_result()`; shared by institutions and employers |
| Projects and internships | `projects*`, `internships*`, `internship_applications`, `complete_internship()` |
| Evidence / portfolio | `evidence*`, photo/video in a private bucket, public portfolio at `/p/:slug` |
| Verification | employer review, outside-supervisor **link and QR**, **USSD** (`apps/api/src/routes/ussd.js`) |
| Talent discovery and hiring | `discover_talent()`, `talent_pipeline`, `hire_student()` |
| Graduate tracking | `enrollments`, `outcomes`, `employments`, consented analytics `outcome_summary()` |
| Employer feedback | `submit_feedback()`, `feedback_summary()`, `feedback_preparedness()` |
| University analytics, skills gap | `competency_gap()`, Outcomes screen, `curriculum_actions` (the improvement end of the loop) |
| Regulators | `requirements`, `my_requirement_progress()`, `regulator_compliance()` |
| Admin and verification | organisation approval, `app_admins` |
| Notifications | `notifications` (triggers), bell in the web app, `outbox` for SMS/email |
| Reporting | CSV exports in `apps/api/src/routes/reports.js` |

## Trust model (what the database enforces, not just the UI)

- Employer, institution and regulator accounts start **pending**; until an admin approves them they cannot publish, verify, assess, hire or read anything sensitive.
- Students cannot verify themselves. Verification fields are written only by security-definer functions; guard triggers reject direct edits. Verified work is frozen except for showing or hiding it.
- Three assurance levels are shown wherever work appears: **verified by the employer**, **attested by a supervisor (link)**, **attested by a supervisor (phone)**. Outside sign-off is only available for self-logged work, never to bypass an employer who set the project.
- USSD sign-off works only from the phone number the student registered for that supervisor. Codes and links are single-use and expire after 14 days.
- Institutions never read individual evidence, outcomes or feedback. They get aggregates that require the student's consent and a minimum group size (default 5); smaller groups are suppressed.
- Talent search shows only students who opted in, and only verified levels. No email addresses are exposed.
- AI output is untrusted: it can only pick competency ids that exist in the chosen sector, and values are range-checked.

## Setup

1. **Supabase project.** Create one. In Authentication, keep **Confirm email** on (admin identity relies on it).
2. **Database.** Apply `supabase/migrations/*.sql` in order (`supabase db push`, or paste each file into the SQL editor), then run `supabase/seed.sql`. Edit and run `supabase/admin_and_settings.example.sql` to add yourself as admin and set the public app URL.
3. **API.** `cp apps/api/.env.example apps/api/.env`, fill it in, then `cd apps/api && npm install && npm start`.
4. **Web.** `cp apps/web/.env.example apps/web/.env`, fill it in, then `cd apps/web && npm install && npm run dev`. For production, `npm run build` and host `dist/` on any static host with a single-page-app fallback (`public/_redirects` is included for Netlify and Cloudflare Pages).
5. **USSD (optional).** Register the callback `https://YOUR-API/ussd?key=YOUR_SECRET` with an Africa's Talking style gateway and set `VITE_USSD_CODE` in the web env so students see the code to dial.
6. **First run.** Sign up with your admin email, confirm it, open **Admin**, approve organisations as they register.

## Tests

`cd apps/api && npm test` rebuilds a local Postgres from the real migrations (plus `supabase/tests/shim.sql`, which stands in for Supabase's `auth` and `storage` schemas) and runs 50 tests: row-level security, guard triggers, every workflow, the analytics rules, the API, the link and USSD flows, jobs. It needs a local Postgres (`TEST_DATABASE_URL`, default `postgres://postgres:postgres@localhost:5432/skillproof_test`).

`cd apps/web && npm test` renders every screen for every role against a mocked Supabase client and checks the key actions send the right requests (40 tests).

**Not verified here, so check these first against your real project:** PostgREST embedded selects and the storage signed-URL calls against live Supabase; verifying real Supabase JWTs in the API; the Africa's Talking, Resend and Anthropic calls (request shapes are unit-tested, live calls are not); the end-to-end browser flow. Run the Supabase database linter too: `public_profiles` is intentionally a definer view (it exposes only opted-in rows and no email).

## Known gaps

- One login per organisation; there is no staff-invite flow yet (the data model already supports several members per organisation).
- Uploaded files are type- and size-limited but not virus-scanned.
- Rate limits are in-memory per API instance; use a shared store if you run several.
- No data-export or account-deletion self-service yet, and the interface is English only.
- USSD menus are English; add Kinyarwanda and French strings in `apps/api/src/routes/ussd.js`.
