-- Kargo Hiring Dashboard — initial schema.
-- Apply with `npm run db:migrate` (needs DATABASE_URL) or paste into the Supabase SQL editor.

create extension if not exists pgcrypto;

do $$ begin
  create type candidate_role as enum ('PM', 'SPM');
exception when duplicate_object then null; end $$;

do $$ begin
  create type email_type as enum ('invite', 'reject');
exception when duplicate_object then null; end $$;

do $$ begin
  create type candidate_status as enum ('draft', 'confirmed_sent');
exception when duplicate_object then null; end $$;

create table if not exists rubric_versions (
  id          uuid primary key default gen_random_uuid(),
  role        candidate_role not null,
  content     text not null,
  created_at  timestamptz not null default now()
);

create table if not exists candidates (
  id                   uuid primary key default gen_random_uuid(),
  role                 candidate_role not null,
  file_name            text not null,

  -- name / email / phone. NEVER sent to Gemini.
  personal_details     jsonb not null default '{}'::jsonb,

  cv_raw_text          text not null,
  cv_redacted_text     text not null,       -- the only CV text any AI call may see

  extracted_profile    jsonb,               -- AI call 1
  category_scores      jsonb,               -- AI call 2: {"A":x,...,"F":x}
  score_justifications jsonb,               -- AI call 2: {"A":"...",...,"F":"..."}
  total_score          numeric(4,2),
  rubric_version_id    uuid references rubric_versions(id),

  brief                text,                -- AI call 3 (top N only)
  email_subject        text,
  email_body           text,
  email_type           email_type,
  email_edited         boolean not null default false,

  status               candidate_status not null default 'draft',
  sent_at              timestamptz,
  sent_to              text,
  resend_message_id    text,

  processing_error     text,
  created_at           timestamptz not null default now()
);

create index if not exists candidates_role_score_idx
  on candidates (role, total_score desc nulls last);

-- Audit log: the exact payload of every Gemini call, so "no PII in AI calls" is inspectable.
create table if not exists ai_calls (
  id                  uuid primary key default gen_random_uuid(),
  candidate_id        uuid references candidates(id) on delete cascade,
  step                text not null check (step in ('extract', 'score', 'draft')),
  model               text not null,
  system_instruction  text not null,
  contents            text not null,
  response_schema     jsonb not null,
  pii_check           jsonb not null,       -- result of the pre-send PII guard
  status              text not null check (status in ('sent', 'ok', 'error', 'blocked')),
  response_text       text,
  error               text,
  latency_ms          integer,
  created_at          timestamptz not null default now()
);

create index if not exists ai_calls_candidate_idx on ai_calls (candidate_id, created_at desc);

-- Lock everything down: no policies means only the service role (server-side) can read/write.
alter table candidates      enable row level security;
alter table rubric_versions enable row level security;
alter table ai_calls        enable row level security;

-- Make PostgREST (supabase-js) see new tables immediately.
notify pgrst, 'reload schema';
