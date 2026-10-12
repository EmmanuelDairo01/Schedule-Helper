-- Settle database schema
-- Run this entire file in Supabase Dashboard > SQL Editor.
-- This schema keeps recurring task definitions separate from their dated occurrences.

create extension if not exists pgcrypto;

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 180),
  recurrence_days integer[] null, -- PostgreSQL weekday numbers: Sunday=0 ... Saturday=6; NULL means one-time
  recurrence_until date null,
  start_date date null,
  default_start_time time null,
  default_end_time time null,
  created_at timestamptz not null default now(),
  constraint valid_recurrence_days check (recurrence_days is null or (cardinality(recurrence_days) > 0 and recurrence_days <@ array[0,1,2,3,4,5,6]::integer[]))
);

create table if not exists public.task_occurrences (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  scheduled_date date null,
  start_time time null,
  end_time time null,
  status text not null default 'todo' check (status in ('todo','in_progress','done')),
  completed_at timestamptz null,
  created_at timestamptz not null default now(),
  -- A recurring series has at most one occurrence per scheduled date.
  constraint task_occurrence_task_date_unique unique (task_id, scheduled_date),
  constraint valid_occurrence_time check (start_time is null or end_time is null or end_time > start_time),
  constraint completed_timestamp_consistent check ((status = 'done' and completed_at is not null) or (status <> 'done' and completed_at is null))
);

create index if not exists tasks_user_id_idx on public.tasks(user_id);
create index if not exists occurrences_user_date_idx on public.task_occurrences(user_id, scheduled_date);
create index if not exists occurrences_user_status_idx on public.task_occurrences(user_id, status);

alter table public.tasks enable row level security;
alter table public.task_occurrences enable row level security;

drop policy if exists "Users can manage their own tasks" on public.tasks;
create policy "Users can manage their own tasks" on public.tasks
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users can manage their own occurrences" on public.task_occurrences;
create policy "Users can manage their own occurrences" on public.task_occurrences
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.tasks to authenticated;
grant select, insert, update, delete on public.task_occurrences to authenticated;
