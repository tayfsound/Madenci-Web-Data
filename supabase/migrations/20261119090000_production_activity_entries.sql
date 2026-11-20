-- One daily production report can carry multiple Excel activity columns.
-- Existing entry types and rows remain unchanged.
begin;

alter table public.entries drop constraint if exists entries_entry_type_check;
alter table public.entries add constraint entries_entry_type_check
  check (entry_type in ('drilling','material','ore','loder','production'));

commit;
