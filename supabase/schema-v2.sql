-- v2: serverless-safe auth state (required for Vercel/serverless hosting).
-- Run in the Supabase SQL editor, same as schema.sql.

create table if not exists otp_codes (
  email    text primary key,
  hash     text not null,
  expires  timestamptz not null,
  attempts int not null default 0,
  sent_at  timestamptz not null default now()
);

create table if not exists presence (
  email     text primary key,
  last_seen timestamptz not null default now()
);

alter table otp_codes enable row level security;
alter table presence enable row level security;
