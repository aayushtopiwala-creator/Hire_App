-- The AI audit log is a historical record: deleting a candidate must not delete what was sent to Gemini.
-- Snapshot the file name onto each call, then drop the cascading FK (candidate_id is kept as a plain reference).

alter table ai_calls add column if not exists candidate_label text;

update ai_calls a
set candidate_label = c.file_name
from candidates c
where a.candidate_id = c.id and a.candidate_label is null;

alter table ai_calls drop constraint if exists ai_calls_candidate_id_fkey;

create or replace function ai_calls_set_label() returns trigger language plpgsql as $$
begin
  if new.candidate_label is null and new.candidate_id is not null then
    select file_name into new.candidate_label from candidates where id = new.candidate_id;
  end if;
  return new;
end $$;

drop trigger if exists ai_calls_label on ai_calls;
create trigger ai_calls_label before insert on ai_calls
  for each row execute function ai_calls_set_label();

notify pgrst, 'reload schema';
