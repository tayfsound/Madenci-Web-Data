-- Preserve the existing report types and allow the loder photo report.
begin;
alter table public.entries drop constraint entries_entry_type_check;
alter table public.entries add constraint entries_entry_type_check
  check (entry_type in ('drilling','material','ore','loder'));
commit;
