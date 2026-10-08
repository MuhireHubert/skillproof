-- Version 4: privacy-safe network aggregates.
-- These functions expose counts and alignment summaries only; no student-level records.
create or replace function public.network_sector_summary()
returns table (
  sector_id text,
  sector_name text,
  employers bigint,
  institutions bigint,
  standards bigint,
  open_projects bigint,
  open_internships bigint,
  graduates bigint,
  employed bigint
)
language sql
security definer
set search_path = public
as $$
  select
    s.id,
    s.name,
    (select count(distinct o.id) from organizations o where o.type='employer' and o.status='approved' and s.id = any(o.sector_ids)),
    (select count(distinct o.id) from organizations o where o.type='institution' and o.status='approved' and s.id = any(o.sector_ids)),
    (select count(*) from standards st where st.sector_id=s.id and st.status='published'),
    (select count(*) from projects p where p.sector_id=s.id and p.status='open'),
    (select count(*) from internships i where i.sector_id=s.id and i.status='open'),
    (select count(*) from enrollments e join programmes p on p.id=e.programme_id where p.sector_id=s.id and e.status='graduated'),
    (select count(distinct e.student_id) from employments e where e.sector_id=s.id and e.employer_confirmed=true)
  from sectors s
  where s.active=true
  order by s.name;
$$;

create or replace function public.network_standard_summary()
returns table (
  sector_id text,
  sector_name text,
  role_title text,
  version int,
  review_by date,
  mapped_institutions bigint
)
language sql
security definer
set search_path = public
as $$
  select st.sector_id, s.name, st.role_title, st.version, st.review_by,
    (select count(*) from standard_responses sr where sr.standard_id=st.id and sr.status in ('adopted','adapted'))
  from standards st
  join sectors s on s.id=st.sector_id
  where st.status='published'
  order by s.name, st.role_title;
$$;

revoke all on function public.network_sector_summary() from public;
revoke all on function public.network_standard_summary() from public;
grant execute on function public.network_sector_summary() to authenticated;
grant execute on function public.network_standard_summary() to authenticated;
