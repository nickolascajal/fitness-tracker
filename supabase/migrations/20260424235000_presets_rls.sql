-- Presets: user-scoped JSON presets for cross-device sync.

create table if not exists public.presets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  data jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists presets_user_id_created_at_idx
  on public.presets (user_id, created_at asc);

alter table public.presets enable row level security;

create policy "presets_select_own"
  on public.presets
  for select
  using (auth.uid() = user_id);

create policy "presets_insert_own"
  on public.presets
  for insert
  with check (auth.uid() = user_id);

create policy "presets_update_own"
  on public.presets
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "presets_delete_own"
  on public.presets
  for delete
  using (auth.uid() = user_id);
