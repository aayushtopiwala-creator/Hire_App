-- Mixed-role intake: CVs arrive without a role; an AI step guesses PM/SPM before any scoring.
-- `role` is now the CONFIRMED role (null until confirmed by the founder or auto-confirmed).

alter table candidates alter column role drop not null;

alter table candidates
  add column if not exists role_status text not null default 'founder_confirmed'
    check (role_status in ('unclassified', 'needs_confirmation', 'auto_confirmed', 'founder_confirmed')),
  add column if not exists role_guess candidate_role,
  add column if not exists role_confidence text check (role_confidence in ('high', 'medium', 'low')),
  add column if not exists role_reason text,
  add column if not exists role_signals jsonb,
  add column if not exists role_confirmed_at timestamptz,
  add column if not exists file_hash text;

-- A role must be set exactly when it is confirmed.
alter table candidates drop constraint if exists candidates_role_matches_status;
alter table candidates add constraint candidates_role_matches_status
  check ((role is not null) = (role_status in ('auto_confirmed', 'founder_confirmed')));

create unique index if not exists candidates_file_hash_key on candidates (file_hash) where file_hash is not null;

alter table ai_calls drop constraint if exists ai_calls_step_check;
alter table ai_calls add constraint ai_calls_step_check check (step in ('classify', 'extract', 'score', 'draft'));

notify pgrst, 'reload schema';
