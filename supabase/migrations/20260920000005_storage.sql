-- Private bucket for evidence photos, video and documents.
-- Files live under "<student uuid>/<evidence uuid>/<file>". Read access follows evidence visibility.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('evidence-media', 'evidence-media', false, 52428800,
        array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime', 'application/pdf'])
on conflict (id) do update set
  public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.can_read_media(p_path text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.evidence_media m join public.evidence e on e.id = m.evidence_id
    where m.storage_path = p_path and (
      e.student_id = auth.uid()
      or (e.is_public and e.status = 'verified')
      or (e.verifier_org_id is not null and e.verifier_org_id = public.approved_org('employer'))
      or public.is_admin())
  );
$$;

drop policy if exists evidence_media_upload on storage.objects;
create policy evidence_media_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'evidence-media' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists evidence_media_select on storage.objects;
create policy evidence_media_select on storage.objects for select to anon, authenticated
  using (bucket_id = 'evidence-media' and ((storage.foldername(name))[1] = auth.uid()::text or public.can_read_media(name)));
drop policy if exists evidence_media_remove on storage.objects;
create policy evidence_media_remove on storage.objects for delete to authenticated
  using (bucket_id = 'evidence-media' and (storage.foldername(name))[1] = auth.uid()::text);
