-- Run once in the Supabase SQL editor after the migrations and seed.

-- 1. Who is a platform administrator (lower-case email; the account must confirm its email).
insert into public.app_admins (email) values ('you@example.com') on conflict do nothing;

-- 2. Public URL of the web app (used in verifier links sent by SMS/email) and the USSD short code.
update public.app_settings set value = 'https://app.example.com' where key = 'public_app_url';
insert into public.app_settings (key, value) values ('ussd_code', '*123#') on conflict (key) do update set value = excluded.value;

-- 3. Optional: change the minimum group size for anonymised graduate analytics (default 5).
-- update public.app_settings set value = '5' where key = 'outcomes_min_group';
