-- Run this once in Supabase Dashboard -> SQL Editor.
create extension if not exists pgcrypto;

create table if not exists public.users (
  id text primary key,
  email text not null unique,
  username text not null,
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.sessions (
  token_hash text primary key,
  user_id text not null references public.users(id) on delete cascade,
  expires_at bigint not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_sessions_user on public.sessions(user_id);

create table if not exists public.conversations (
  id text not null,
  user_id text not null references public.users(id) on delete cascade,
  title text not null,
  data jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key(user_id,id)
);
create index if not exists idx_conversations_user on public.conversations(user_id,updated_at desc);

-- The application connects with the server-side DATABASE_URL. Never expose it as a VITE_ variable.
-- Keep these tables inaccessible through the public anon key; all access goes through the server.
alter table public.users enable row level security;
alter table public.sessions enable row level security;
alter table public.conversations enable row level security;
