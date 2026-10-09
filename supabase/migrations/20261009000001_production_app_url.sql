-- Production defaults for the current GitHub Pages deployment.
-- Keep this URL in sync with the deployed frontend and Supabase Auth URL allow-list.
update public.app_settings
set value = 'https://muhirehubert.github.io/skillproof'
where key = 'public_app_url'
  and value like 'http://localhost:%';

insert into public.app_settings (key, value)
values ('public_app_url', 'https://muhirehubert.github.io/skillproof')
on conflict (key) do nothing;
