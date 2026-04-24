-- Arabam Cebimde - Individual owner architecture
-- Replaces company/multi-tenant assumptions with owner-bound model

create extension if not exists pgcrypto;

-- Legacy compatibility cleanup
drop policy if exists "company_isolation_select_companies" on companies;
drop policy if exists "company_isolation_select_profiles" on profiles;
drop policy if exists "company_isolation_mutate_profiles" on profiles;
drop policy if exists "company_isolation_select_vehicles" on vehicles;
drop policy if exists "company_isolation_mutate_vehicles" on vehicles;
drop policy if exists "company_isolation_select_vehicle_locations" on vehicle_locations;
drop policy if exists "company_isolation_mutate_vehicle_locations" on vehicle_locations;
drop policy if exists "company_isolation_select_telemetry_events" on telemetry_events;
drop policy if exists "company_isolation_mutate_telemetry_events" on telemetry_events;
drop policy if exists "company_isolation_select_notifications" on notifications;
drop policy if exists "company_isolation_mutate_notifications" on notifications;

-- Profiles: owner-bound identity
alter table if exists profiles
  add column if not exists user_id uuid references auth.users(id) on delete cascade,
  add column if not exists avatar_url text;

update profiles set user_id = id where user_id is null;
alter table profiles alter column user_id set not null;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_user_id_unique'
  ) then
    alter table profiles add constraint profiles_user_id_unique unique (user_id);
  end if;
end $$;

-- Vehicles: switch from company_id to owner_id pairing
alter table if exists vehicles
  add column if not exists owner_id uuid references auth.users(id) on delete cascade,
  add column if not exists license_plate text,
  add column if not exists pairing_code text,
  add column if not exists settings jsonb not null default '{}'::jsonb;

update vehicles set owner_id = coalesce(owner_id, (select user_id from profiles limit 1))
where owner_id is null;

update vehicles set license_plate = coalesce(license_plate, plate);
update vehicles set pairing_code = coalesce(pairing_code, upper(left(replace(gen_random_uuid()::text, '-', ''), 6)));
alter table vehicles alter column owner_id set not null;
alter table vehicles alter column pairing_code set not null;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'vehicles_pairing_code_unique'
  ) then
    alter table vehicles add constraint vehicles_pairing_code_unique unique (pairing_code);
  end if;
end $$;

-- Command bus hardening
alter table if exists vehicle_commands
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists critical_auth_verified boolean not null default false;

update vehicle_commands set created_by = sender_id where created_by is null and sender_id is not null;
update vehicle_commands set created_by = auth.uid() where created_by is null;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='vehicle_commands' and column_name='sender_id'
  ) then
    alter table vehicle_commands drop column sender_id;
  end if;
end $$;

-- telemetry as latest snapshot table
create table if not exists vehicle_telemetry (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null unique references vehicles(id) on delete cascade,
  lat double precision,
  lng double precision,
  speed real not null default 0 check (speed >= 0 and speed <= 300),
  fuel real not null default 0 check (fuel >= 0 and fuel <= 100),
  rpm integer not null default 0 check (rpm >= 0 and rpm <= 10000),
  temp real not null default 0 check (temp >= -40 and temp <= 150),
  is_online boolean not null default false,
  updated_at timestamptz not null default now()
);

create index if not exists idx_vehicle_telemetry_updated_at on vehicle_telemetry(updated_at desc);

-- owner helper
create or replace function is_vehicle_owner(p_vehicle uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from vehicles v
    where v.id = p_vehicle and v.owner_id = auth.uid()
  );
$$;

alter table profiles enable row level security;
alter table vehicles enable row level security;
alter table vehicle_commands enable row level security;
alter table vehicle_telemetry enable row level security;

drop policy if exists "Owner Only Profiles Select" on profiles;
drop policy if exists "Owner Only Profiles Insert" on profiles;
drop policy if exists "Owner Only Profiles Update" on profiles;
drop policy if exists "Owner Only Profiles Delete" on profiles;
drop policy if exists "Owner Only Vehicles Select" on vehicles;
drop policy if exists "Owner Only Vehicles Insert" on vehicles;
drop policy if exists "Owner Only Vehicles Update" on vehicles;
drop policy if exists "Owner Only Vehicles Delete" on vehicles;
drop policy if exists "Owner Only Commands Select" on vehicle_commands;
drop policy if exists "Owner Only Commands Insert" on vehicle_commands;
drop policy if exists "Owner Only Commands Update" on vehicle_commands;
drop policy if exists "Owner Only Commands Delete" on vehicle_commands;
drop policy if exists "Owner Only Telemetry Select" on vehicle_telemetry;
drop policy if exists "Owner Only Telemetry Insert" on vehicle_telemetry;
drop policy if exists "Owner Only Telemetry Update" on vehicle_telemetry;
drop policy if exists "Owner Only Telemetry Delete" on vehicle_telemetry;

create policy "Owner Only Profiles Select" on profiles for select using (user_id = auth.uid());
create policy "Owner Only Profiles Insert" on profiles for insert with check (user_id = auth.uid());
create policy "Owner Only Profiles Update" on profiles for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Owner Only Profiles Delete" on profiles for delete using (user_id = auth.uid());

create policy "Owner Only Vehicles Select" on vehicles for select using (owner_id = auth.uid());
create policy "Owner Only Vehicles Insert" on vehicles for insert with check (owner_id = auth.uid());
create policy "Owner Only Vehicles Update" on vehicles for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "Owner Only Vehicles Delete" on vehicles for delete using (owner_id = auth.uid());

create policy "Owner Only Commands Select" on vehicle_commands for select using (is_vehicle_owner(vehicle_id));
create policy "Owner Only Commands Insert" on vehicle_commands for insert with check (is_vehicle_owner(vehicle_id) and created_by = auth.uid() and ttl > now());
create policy "Owner Only Commands Update" on vehicle_commands for update using (is_vehicle_owner(vehicle_id)) with check (is_vehicle_owner(vehicle_id));
create policy "Owner Only Commands Delete" on vehicle_commands for delete using (is_vehicle_owner(vehicle_id));

create policy "Owner Only Telemetry Select" on vehicle_telemetry for select using (is_vehicle_owner(vehicle_id));
create policy "Owner Only Telemetry Insert" on vehicle_telemetry for insert with check (is_vehicle_owner(vehicle_id));
create policy "Owner Only Telemetry Update" on vehicle_telemetry for update using (is_vehicle_owner(vehicle_id)) with check (is_vehicle_owner(vehicle_id));
create policy "Owner Only Telemetry Delete" on vehicle_telemetry for delete using (is_vehicle_owner(vehicle_id));

alter publication supabase_realtime add table vehicle_telemetry;
