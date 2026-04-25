-- Exercises: user-scoped JSON definitions for cross-device library sync.
-- Run in Supabase SQL Editor or via supabase db push if using CLI.

create table if not exists public.exercises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  data jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists exercises_user_id_created_at_idx
  on public.exercises (user_id, created_at asc);

alter table public.exercises enable row level security;

create policy "exercises_select_own"
  on public.exercises
  for select
  using (auth.uid() = user_id);

create policy "exercises_insert_own"
  on public.exercises
  for insert
  with check (auth.uid() = user_id);

create policy "exercises_update_own"
  on public.exercises
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "exercises_delete_own"
  on public.exercises
  for delete
  using (auth.uid() = user_id);
