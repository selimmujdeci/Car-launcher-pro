-- ─────────────────────────────────────────────────────────────────────────────
-- Car Launcher Pro — Initial Schema
-- Multi-tenant: one user ↔ many companies via memberships
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Extensions ───────────────────────────────────────────────────────────────
create extension if not exists "pgcrypto";

-- ── Enums ────────────────────────────────────────────────────────────────────
create type membership_role  as enum ('super_admin', 'admin', 'operator', 'viewer');
create type vehicle_status   as enum ('active', 'idle', 'maintenance', 'offline');
create type fuel_type        as enum ('diesel', 'gasoline', 'electric', 'hybrid');
create type task_status      as enum ('open', 'in_progress', 'done', 'cancelled');
create type task_priority    as enum ('low', 'medium', 'high', 'critical');

-- ─────────────────────────────────────────────────────────────────────────────
-- companies
-- ─────────────────────────────────────────────────────────────────────────────
create table companies (
  id         uuid primary key default gen_random_uuid(),
  name       text        not null,
  slug       text        not null unique,            -- URL-safe identifier
  logo_url   text,
  created_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- users  (profile table — mirrors auth.users)
-- ─────────────────────────────────────────────────────────────────────────────
create table users (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text        not null,
  full_name   text        not null default '',
  avatar_url  text,
  phone       text,
  created_at  timestamptz not null default now()
);

-- Auto-populate on Supabase sign-up
create or replace function handle_new_auth_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.users (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_auth_user();

-- ─────────────────────────────────────────────────────────────────────────────
-- memberships  (user ↔ company, role lives here)
-- ─────────────────────────────────────────────────────────────────────────────
create table memberships (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid        not null references users    (id) on delete cascade,
  company_id  uuid        not null references companies (id) on delete cascade,
  role        membership_role not null default 'viewer',
  created_at  timestamptz not null default now(),

  unique (user_id, company_id)
);

create index memberships_user_id_idx    on memberships (user_id);
create index memberships_company_id_idx on memberships (company_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- vehicles
-- ─────────────────────────────────────────────────────────────────────────────
create table vehicles (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid         not null references companies (id) on delete cascade,
  plate       text         not null,
  brand       text         not null,
  model       text         not null,
  year        smallint     not null check (year >= 1900 and year <= 2100),
  fuel_type   fuel_type    not null,
  status      vehicle_status not null default 'idle',
  current_km  integer      not null default 0 check (current_km >= 0),
  driver_id   uuid         references users (id) on delete set null,
  ins_expiry  date,
  created_at  timestamptz  not null default now(),

  unique (company_id, plate)
);

create index vehicles_company_id_idx on vehicles (company_id);
create index vehicles_driver_id_idx  on vehicles (driver_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- tasks
-- ─────────────────────────────────────────────────────────────────────────────
create table tasks (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid          not null references companies (id) on delete cascade,
  vehicle_id   uuid          references vehicles (id) on delete set null,
  assigned_to  uuid          references users    (id) on delete set null,
  created_by   uuid          not null references users (id),
  title        text          not null,
  description  text,
  status       task_status   not null default 'open',
  priority     task_priority not null default 'medium',
  due_date     timestamptz,
  created_at   timestamptz   not null default now()
);

create index tasks_company_id_idx   on tasks (company_id);
create index tasks_vehicle_id_idx   on tasks (vehicle_id);
create index tasks_assigned_to_idx  on tasks (assigned_to);
create index tasks_status_idx       on tasks (status);

-- ─────────────────────────────────────────────────────────────────────────────
-- Row Level Security
-- ─────────────────────────────────────────────────────────────────────────────
alter table companies   enable row level security;
alter table users       enable row level security;
alter table memberships enable row level security;
alter table vehicles    enable row level security;
alter table tasks       enable row level security;

-- Helper: returns company IDs the current user belongs to
create or replace function my_company_ids()
returns setof uuid language sql security definer stable as $$
  select company_id from memberships where user_id = auth.uid()
$$;

-- Helper: returns the role of the current user in a given company
create or replace function my_role_in(p_company_id uuid)
returns membership_role language sql security definer stable as $$
  select role from memberships
  where user_id = auth.uid() and company_id = p_company_id
  limit 1
$$;

-- ── companies ────────────────────────────────────────────────────────────────
-- Members can read; only admins+ can update; no one inserts via RLS (use service role)
create policy "members can view their companies"
  on companies for select
  using (id in (select my_company_ids()));

create policy "admins can update their company"
  on companies for update
  using (my_role_in(id) in ('super_admin', 'admin'));

-- ── users ────────────────────────────────────────────────────────────────────
-- Users see themselves + co-members
create policy "user sees own profile"
  on users for select
  using (id = auth.uid());

create policy "co-members are visible"
  on users for select
  using (
    id in (
      select m.user_id from memberships m
      where m.company_id in (select my_company_ids())
    )
  );

create policy "user updates own profile"
  on users for update
  using (id = auth.uid());

-- ── memberships ──────────────────────────────────────────────────────────────
create policy "members view memberships of shared companies"
  on memberships for select
  using (company_id in (select my_company_ids()));

create policy "admins manage memberships"
  on memberships for all
  using (my_role_in(company_id) in ('super_admin', 'admin'));

-- ── vehicles ─────────────────────────────────────────────────────────────────
create policy "members view company vehicles"
  on vehicles for select
  using (company_id in (select my_company_ids()));

create policy "operators+ modify vehicles"
  on vehicles for insert with check (
    my_role_in(company_id) in ('super_admin', 'admin', 'operator')
  );

create policy "operators+ update vehicles"
  on vehicles for update
  using (my_role_in(company_id) in ('super_admin', 'admin', 'operator'));

create policy "admins delete vehicles"
  on vehicles for delete
  using (my_role_in(company_id) in ('super_admin', 'admin'));

-- ── tasks ────────────────────────────────────────────────────────────────────
create policy "members view company tasks"
  on tasks for select
  using (company_id in (select my_company_ids()));

create policy "operators+ create tasks"
  on tasks for insert with check (
    my_role_in(company_id) in ('super_admin', 'admin', 'operator')
    and created_by = auth.uid()
  );

create policy "operators+ update tasks"
  on tasks for update
  using (my_role_in(company_id) in ('super_admin', 'admin', 'operator'));

create policy "admins delete tasks"
  on tasks for delete
  using (my_role_in(company_id) in ('super_admin', 'admin'));
