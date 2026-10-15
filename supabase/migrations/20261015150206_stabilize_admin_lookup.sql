-- Existing RLS helper must work from RPCs with an empty search_path.
-- Preserve its existing ownership lookup and privileges.
alter function public.is_admin() set search_path = public, pg_temp;
