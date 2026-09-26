-- Final privilege lockdown. Supabase grants broad default privileges to the API roles and relies on
-- RLS; this migration narrows them so a missing policy can never become an open door.

-- ---- tables
revoke all on all tables in schema public from anon;
grant select on public.sectors, public.competencies, public.evidence, public.evidence_competencies,
                public.evidence_media, public.assessment_results, public.assessment_result_levels to anon;
grant select on public.public_profiles to anon, authenticated;
revoke all on public.app_admins, public.app_settings, public.outbox from authenticated;
revoke truncate, references, trigger on all tables in schema public from anon, authenticated;

-- ---- functions: nothing is callable unless listed here
revoke execute on all functions in schema public from public, anon, authenticated;

-- used inside policies and invoker-side guard triggers, so the API roles must be able to evaluate them
grant execute on function public.is_api_role(), public.is_admin(), public.my_org(), public.my_role(), public.approved_org(text),
  public.my_approved_org(), public.employer_can_reach_student(uuid, uuid), public.can_read_media(text),
  public.owns_assessment(uuid)
  to anon, authenticated;

-- callable workflows and analytics (each checks the caller itself)
grant execute on function
  public.review_evidence(uuid, text, text, jsonb, jsonb),
  public.request_external_verification(uuid, text, text, text),
  public.complete_internship(uuid, jsonb, jsonb, text, numeric),
  public.hire_student(uuid, text, date, text),
  public.discover_talent(text, text[], int),
  public.record_assessment_result(uuid, uuid, jsonb, text, uuid),
  public.submit_feedback(uuid, uuid, uuid, text, boolean, text, jsonb),
  public.competency_demand(text),
  public.competency_gap(text),
  public.outcome_summary(uuid),
  public.feedback_summary(uuid),
  public.feedback_preparedness(uuid),
  public.my_requirement_progress(),
  public.regulator_compliance(uuid),
  public.dashboard_stats()
  to authenticated;
grant execute on function public.competency_record(uuid) to anon, authenticated;

-- link/USSD sign-off is performed by the Node API only
grant execute on function public.complete_external_verification(text, text, text, text, text, text, jsonb, int, text, text)
  to service_role;
