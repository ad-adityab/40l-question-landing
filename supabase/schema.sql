-- Ask the 40L: Supabase schema (tables only; the answer entries are loaded separately and are not in this repo).
-- Row Level Security is on with no policies, so the public anon key can read or write nothing.
-- Only the serverless functions, using the service key held in Vercel, can touch these tables.

create table if not exists public.answer_entries (
  id            text primary key,              -- e.g. qa-076
  topic         text not null,
  question      text not null,
  answer        text not null,
  source        text not null check (source in ('Policy','CAC','CAS')),
  keywords      text[] not null default '{}',
  ask_variants  text[] not null default '{}',
  active        boolean not null default true
);

create table if not exists public.exchanges (
  id             bigint generated always as identity primary key,
  created_at     timestamptz not null default now(),
  visitor_id     text not null,                -- random id made in the visitor's browser; no names or emails
  net_hash       text,                         -- one-way hash of network + day, only for the daily cap; no raw IP stored
  input          text not null,                -- the question as typed
  output         text,                         -- the answer shown
  outcome        text not null check (outcome in ('answered','not_found','refused','capped','error')),
  matched_ids    text[] not null default '{}', -- entries the answer cites
  candidate_ids  text[] not null default '{}', -- entries sent to Gemini
  input_tokens   integer not null default 0,
  output_tokens  integer not null default 0,
  model          text,
  latency_ms     integer
);

create index if not exists exchanges_visitor_idx on public.exchanges (visitor_id);
create index if not exists exchanges_created_idx on public.exchanges (created_at);
create index if not exists exchanges_net_idx     on public.exchanges (net_hash, created_at);

alter table public.answer_entries enable row level security;
alter table public.exchanges      enable row level security;
