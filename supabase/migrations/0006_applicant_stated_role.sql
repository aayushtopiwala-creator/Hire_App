-- The applicant's own role selection (here: a role marker in the file name) is a stated fact:
-- confirmed on import, never classified, never sent to Role review.
alter table candidates drop constraint if exists candidates_role_status_check;
alter table candidates add constraint candidates_role_status_check
  check (role_status in ('unclassified', 'needs_confirmation', 'auto_confirmed', 'founder_confirmed', 'applicant_stated'));

alter table candidates drop constraint if exists candidates_role_matches_status;
alter table candidates add constraint candidates_role_matches_status
  check ((role is not null) = (role_status in ('auto_confirmed', 'founder_confirmed', 'applicant_stated')));

notify pgrst, 'reload schema';
