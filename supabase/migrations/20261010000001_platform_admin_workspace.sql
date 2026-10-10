-- SkillProof platform administration: dedicated controls, secure RPCs and audit trail.
-- Apply after the existing schema / RLS / lockdown migrations.

alter table public.competencies
  add column if not exists active boolean not null default true;

create table if not exists public.admin_audit_logs (
  id bigint generated always as identity primary key,
  actor_email text not null default 'system',
  action text not null,
  entity_type text not null,
  entity_id text not null default '',
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);
create index if not exists admin_audit_logs_created_idx on public.admin_audit_logs (created_at desc);
create index if not exists admin_audit_logs_entity_idx on public.admin_audit_logs (entity_type, entity_id, created_at desc);
alter table public.admin_audit_logs enable row level security;
drop policy if exists admin_audit_logs_read on public.admin_audit_logs;
create policy admin_audit_logs_read on public.admin_audit_logs
  for select to authenticated using (public.is_admin());
revoke all on public.admin_audit_logs from anon, authenticated;
grant select on public.admin_audit_logs to authenticated;
revoke insert, update, delete, truncate, references, trigger on public.admin_audit_logs from anon, authenticated;

create or replace function public.write_admin_audit_log()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  old_row jsonb;
  new_row jsonb;
  entity text;
  actor text;
  action_name text;
begin
  if tg_op <> 'INSERT' then old_row := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then new_row := to_jsonb(new); end if;
  entity := coalesce(new_row ->> 'id', old_row ->> 'id',
                     new_row ->> 'email', old_row ->> 'email',
                     new_row ->> 'key', old_row ->> 'key', '');
  actor := lower(coalesce(auth.jwt() ->> 'email', 'system'));
  action_name := lower(tg_op);
  insert into public.admin_audit_logs(actor_email, action, entity_type, entity_id, old_data, new_data)
  values (actor, action_name, tg_table_name, entity, old_row, new_row);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists audit_sectors_changes on public.sectors;
create trigger audit_sectors_changes after insert or update or delete on public.sectors
  for each row execute function public.write_admin_audit_log();
drop trigger if exists audit_competencies_changes on public.competencies;
create trigger audit_competencies_changes after insert or update or delete on public.competencies
  for each row execute function public.write_admin_audit_log();
drop trigger if exists audit_organizations_changes on public.organizations;
create trigger audit_organizations_changes after insert or update or delete on public.organizations
  for each row execute function public.write_admin_audit_log();
drop trigger if exists audit_app_settings_changes on public.app_settings;
create trigger audit_app_settings_changes after insert or update or delete on public.app_settings
  for each row execute function public.write_admin_audit_log();
drop trigger if exists audit_app_admins_changes on public.app_admins;
create trigger audit_app_admins_changes after insert or update or delete on public.app_admins
  for each row execute function public.write_admin_audit_log();

-- Return the settings only to an authenticated platform administrator.
create or replace function public.admin_get_settings()
returns table(setting_key text, setting_value text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Platform administrator access required' using errcode = '42501'; end if;
  return query select s.key, s.value from public.app_settings s order by s.key;
end $$;

create or replace function public.admin_update_setting(p_key text, p_value text)
returns void language plpgsql security definer set search_path = public as $$
declare k text := btrim(coalesce(p_key, '')); v text := btrim(coalesce(p_value, ''));
begin
  if not public.is_admin() then raise exception 'Platform administrator access required' using errcode = '42501'; end if;
  if k not in ('outcomes_min_group', 'default_country_code', 'public_app_url') then
    raise exception 'This setting is not editable from the admin workspace' using errcode = '22023';
  end if;
  if k = 'outcomes_min_group' and (v !~ '^([5-9]|[1-9][0-9]{1,2})$' or v::int > 100) then
    raise exception 'Minimum reporting group must be between 5 and 100' using errcode = '22023';
  end if;
  if k = 'default_country_code' and v !~ '^[0-9]{1,4}$' then
    raise exception 'Country calling code must contain 1 to 4 digits' using errcode = '22023';
  end if;
  if k = 'public_app_url' and v !~ '^https://[^[:space:]]+$' then
    raise exception 'Public app URL must start with https://' using errcode = '22023';
  end if;
  insert into public.app_settings(key, value) values (k, v)
  on conflict (key) do update set value = excluded.value;
end $$;

-- Administrator changes are server-side only. An account must exist and have a confirmed email.
create or replace function public.admin_set_admin(p_email text, p_enabled boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare target text := lower(btrim(coalesce(p_email, ''))); confirmed boolean; total_admins int;
begin
  if not public.is_admin() then raise exception 'Platform administrator access required' using errcode = '42501'; end if;
  if target = '' or target !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Enter a valid email address' using errcode = '22023';
  end if;
  if p_enabled then
    select (u.email_confirmed_at is not null) into confirmed from auth.users u where lower(u.email) = target;
    if confirmed is distinct from true then
      raise exception 'The account must exist and have a confirmed email before admin access can be granted' using errcode = '22023';
    end if;
    insert into public.app_admins(email) values (target) on conflict (email) do nothing;
  else
    if target = lower(coalesce(auth.jwt() ->> 'email', '')) then
      raise exception 'You cannot revoke your own administrator access here' using errcode = '22023';
    end if;
    select count(*) into total_admins from public.app_admins;
    if total_admins <= 1 and exists (select 1 from public.app_admins where email = target) then
      raise exception 'The last platform administrator cannot be removed' using errcode = '22023';
    end if;
    delete from public.app_admins where email = target;
  end if;
  return jsonb_build_object('email', target, 'enabled', p_enabled);
end $$;

create or replace function public.admin_list_admins()
returns table(admin_email text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Platform administrator access required' using errcode = '42501'; end if;
  return query select a.email from public.app_admins a order by a.email;
end $$;

create or replace function public.admin_report_summary()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare result jsonb;
begin
  if not public.is_admin() then raise exception 'Platform administrator access required' using errcode = '42501'; end if;
  select jsonb_build_object(
    'users_by_role', coalesce((select jsonb_object_agg(role, n) from (select role, count(*)::int n from public.profiles group by role) q), '{}'::jsonb),
    'organisations_by_status', coalesce((select jsonb_object_agg(status, n) from (select status, count(*)::int n from public.organizations group by status) q), '{}'::jsonb),
    'sectors', jsonb_build_object('total', (select count(*)::int from public.sectors), 'active', (select count(*)::int from public.sectors where active)),
    'competencies', jsonb_build_object('total', (select count(*)::int from public.competencies), 'active', (select count(*)::int from public.competencies where active)),
    'evidence_by_status', coalesce((select jsonb_object_agg(status, n) from (select status, count(*)::int n from public.evidence group by status) q), '{}'::jsonb),
    'projects', jsonb_build_object('total', (select count(*)::int from public.projects), 'open', (select count(*)::int from public.projects where status = 'open')),
    'internships', jsonb_build_object('total', (select count(*)::int from public.internships), 'open', (select count(*)::int from public.internships where status = 'open')),
    'verified_evidence', (select count(*)::int from public.evidence where status = 'verified')
  ) into result;
  return result;
end $$;

revoke all on function public.write_admin_audit_log() from public, anon, authenticated;
revoke all on function public.admin_get_settings() from public, anon, authenticated;
revoke all on function public.admin_update_setting(text, text) from public, anon, authenticated;
revoke all on function public.admin_set_admin(text, boolean) from public, anon, authenticated;
revoke all on function public.admin_list_admins() from public, anon, authenticated;
revoke all on function public.admin_report_summary() from public, anon, authenticated;
grant execute on function public.admin_get_settings() to authenticated;
grant execute on function public.admin_update_setting(text, text) to authenticated;
grant execute on function public.admin_set_admin(text, boolean) to authenticated;
grant execute on function public.admin_list_admins() to authenticated;
grant execute on function public.admin_report_summary() to authenticated;
