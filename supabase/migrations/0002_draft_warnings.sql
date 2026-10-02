-- Grounding/tone checks on AI call 3 that still failed after a retry; shown next to the draft.
alter table candidates add column if not exists draft_warnings jsonb not null default '[]'::jsonb;
notify pgrst, 'reload schema';
