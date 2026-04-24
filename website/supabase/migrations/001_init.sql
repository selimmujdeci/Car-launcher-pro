create extension if not exists pgcrypto;

create table if not exists companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  full_name text,
  role text not null default 'member' check (role in ('admin', 'member')),
  created_at timestamptz not null default now()
);

create table if not exists vehicles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  plate text,
  name text not null,
  driver_name text,
  odometer_km integer not null default 0,
  api_key_hash text,
  created_at timestamptz not null default now()
);

create table if not exists vehicle_locations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  heading_deg real,
  created_at timestamptz not null default now()
);

create table if not exists telemetry_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  speed_kmh real not null default 0,
  fuel_pct real not null default 0,
  engine_temp_c real not null default 0,
  rpm integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  vehicle_id uuid references vehicles(id) on delete set null,
  profile_id uuid references profiles(id) on delete set null,
  title text not null,
  message text not null,
  severity text not null check (severity in ('info', 'warning', 'critical')),
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_profiles_company_id on profiles(company_id);
create index if not exists idx_vehicles_company_id on vehicles(company_id);
create index if not exists idx_vehicle_locations_vehicle_created on vehicle_locations(vehicle_id, created_at desc);
create index if not exists idx_vehicle_locations_company_id on vehicle_locations(company_id);
create index if not exists idx_telemetry_events_vehicle_created on telemetry_events(vehicle_id, created_at desc);
create index if not exists idx_telemetry_events_company_id on telemetry_events(company_id);
create index if not exists idx_notifications_company_created on notifications(company_id, created_at desc);

alter table companies enable row level security;
alter table profiles enable row level security;
alter table vehicles enable row level security;
alter table vehicle_locations enable row level security;
alter table telemetry_events enable row level security;
alter table notifications enable row level security;

create or replace function auth_company_id()
returns uuid
language sql
stable
as $$
  select p.company_id from profiles p where p.id = auth.uid()
$$;

create policy "company_isolation_select_companies"
  on companies for select
  using (id = auth_company_id());

create policy "company_isolation_select_profiles"
  on profiles for select
  using (company_id = auth_company_id());

create policy "company_isolation_mutate_profiles"
  on profiles for all
  using (company_id = auth_company_id())
  with check (company_id = auth_company_id());

create policy "company_isolation_select_vehicles"
  on vehicles for select
  using (company_id = auth_company_id());

create policy "company_isolation_mutate_vehicles"
  on vehicles for all
  using (company_id = auth_company_id())
  with check (company_id = auth_company_id());

create policy "company_isolation_select_vehicle_locations"
  on vehicle_locations for select
  using (company_id = auth_company_id());

create policy "company_isolation_mutate_vehicle_locations"
  on vehicle_locations for all
  using (company_id = auth_company_id())
  with check (company_id = auth_company_id());

create policy "company_isolation_select_telemetry_events"
  on telemetry_events for select
  using (company_id = auth_company_id());

create policy "company_isolation_mutate_telemetry_events"
  on telemetry_events for all
  using (company_id = auth_company_id())
  with check (company_id = auth_company_id());

create policy "company_isolation_select_notifications"
  on notifications for select
  using (company_id = auth_company_id());

create policy "company_isolation_mutate_notifications"
  on notifications for all
  using (company_id = auth_company_id())
  with check (company_id = auth_company_id());
