-- ═══════════════════════════════════════════════════════
-- 001_init.sql — Temel şema
-- Idempotent: defalarca çalıştırılabilir
-- ═══════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ── companies ────────────────────────────────────────────
create table if not exists companies (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now()
);

-- ── profiles ─────────────────────────────────────────────
create table if not exists profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  company_id uuid references companies(id) on delete set null,
  full_name  text,
  role       text not null default 'driver'
               check (role in ('super_admin','admin','driver','member','viewer','operator')),
  avatar_url text,
  created_at timestamptz not null default now()
);

-- ── vehicles ─────────────────────────────────────────────
create table if not exists vehicles (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid references companies(id) on delete cascade,
  owner_id      uuid references auth.users(id) on delete set null,
  -- Temel bilgiler
  plate         text,
  license_plate text,
  name          text,
  brand         text,
  model         text,
  year          integer,
  fuel_type     text,
  vin           text unique,
  -- Durum
  status        text not null default 'active',
  current_km    integer not null default 0,
  odometer_km   integer not null default 0,
  ins_expiry    text,
  driver_name   text,
  -- Canlı veri
  speed         real,
  last_seen     timestamptz,
  device_name   text,
  -- Sistem
  api_key_hash  text,
  pairing_code  text unique not null
    default upper(left(replace(gen_random_uuid()::text,'-',''),6)),
  settings      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ── vehicle_locations ─────────────────────────────────────
create table if not exists vehicle_locations (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid references companies(id) on delete cascade,
  vehicle_id  uuid not null references vehicles(id) on delete cascade,
  lat         double precision not null,
  lng         double precision not null,
  heading_deg real,
  accuracy    real,
  created_at  timestamptz not null default now()
);

-- ── telemetry_events ──────────────────────────────────────
create table if not exists telemetry_events (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid references companies(id) on delete cascade,
  vehicle_id    uuid not null references vehicles(id) on delete cascade,
  speed_kmh     real not null default 0 check (speed_kmh >= 0 and speed_kmh <= 300),
  fuel_pct      real not null default 0 check (fuel_pct >= 0 and fuel_pct <= 100),
  engine_temp_c real not null default 0 check (engine_temp_c >= -40 and engine_temp_c <= 150),
  rpm           integer not null default 0 check (rpm >= 0 and rpm <= 10000),
  created_at    timestamptz not null default now()
);

-- ── notifications ─────────────────────────────────────────
create table if not exists notifications (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete cascade,
  vehicle_id uuid references vehicles(id) on delete set null,
  profile_id uuid references profiles(id) on delete set null,
  title      text not null,
  message    text not null,
  severity   text not null check (severity in ('info','warning','critical')),
  read_at    timestamptz,
  created_at timestamptz not null default now()
);

-- ── Mevcut tablolara eksik kolonları ekle (idempotent) ───
alter table if exists vehicles
  add column if not exists owner_id      uuid references auth.users(id) on delete set null,
  add column if not exists brand         text,
  add column if not exists model         text,
  add column if not exists year          integer,
  add column if not exists fuel_type     text,
  add column if not exists status        text not null default 'active',
  add column if not exists current_km    integer not null default 0,
  add column if not exists ins_expiry    text,
  add column if not exists speed         real,
  add column if not exists last_seen     timestamptz,
  add column if not exists device_name   text,
  add column if not exists license_plate text,
  add column if not exists vin           text,
  add column if not exists pairing_code  text,
  add column if not exists settings      jsonb not null default '{}'::jsonb,
  add column if not exists updated_at    timestamptz not null default now();

alter table if exists profiles
  add column if not exists avatar_url text;

-- pairing_code unique constraint (sadece yoksa ekle)
do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'vehicles_pairing_code_key'
  ) then
    update vehicles set pairing_code = upper(left(replace(gen_random_uuid()::text,'-',''),6))
    where pairing_code is null;
    alter table vehicles alter column pairing_code set not null;
    alter table vehicles add constraint vehicles_pairing_code_key unique (pairing_code);
  end if;
end $$;

-- ── indexes ───────────────────────────────────────────────
create index if not exists idx_profiles_company_id          on profiles(company_id);
create index if not exists idx_vehicles_company_id          on vehicles(company_id);
create index if not exists idx_vehicles_owner_id            on vehicles(owner_id);
create index if not exists idx_vehicle_loc_vid_ts           on vehicle_locations(vehicle_id, created_at desc);
create index if not exists idx_vehicle_loc_company          on vehicle_locations(company_id);
create index if not exists idx_telemetry_vid_ts             on telemetry_events(vehicle_id, created_at desc);
create index if not exists idx_telemetry_company            on telemetry_events(company_id);
create index if not exists idx_notifications_company_ts     on notifications(company_id, created_at desc);

-- ── RLS etkinleştir ───────────────────────────────────────
alter table companies         enable row level security;
alter table profiles          enable row level security;
alter table vehicles          enable row level security;
alter table vehicle_locations enable row level security;
alter table telemetry_events  enable row level security;
alter table notifications     enable row level security;

-- ── Yardımcı fonksiyonlar ─────────────────────────────────
create or replace function auth_company_id()
returns uuid language sql stable security definer set search_path = public as $$
  select company_id from profiles where id = auth.uid()
$$;

create or replace function fn_set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists trg_vehicles_updated_at on vehicles;
create trigger trg_vehicles_updated_at
  before update on vehicles
  for each row execute function fn_set_updated_at();

-- Kayıt sonrası otomatik profil oluştur
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, full_name)
  values (new.id, new.raw_user_meta_data->>'full_name')
  on conflict (id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ── Company izolasyon politikaları ───────────────────────
drop policy if exists "companies: kendi şirketini gör" on companies;
create policy "companies: kendi şirketini gör" on companies
  for select using (id = auth_company_id());

drop policy if exists "profiles: şirket izolasyonu select" on profiles;
create policy "profiles: şirket izolasyonu select" on profiles
  for select using (company_id = auth_company_id() or id = auth.uid());

drop policy if exists "profiles: şirket izolasyonu mutate" on profiles;
create policy "profiles: şirket izolasyonu mutate" on profiles
  for all using (id = auth.uid())
  with check (id = auth.uid());

drop policy if exists "vehicles: şirket izolasyonu select" on vehicles;
create policy "vehicles: şirket izolasyonu select" on vehicles
  for select using (company_id = auth_company_id() or owner_id = auth.uid());

drop policy if exists "vehicles: şirket izolasyonu mutate" on vehicles;
create policy "vehicles: şirket izolasyonu mutate" on vehicles
  for all using (company_id = auth_company_id() or owner_id = auth.uid())
  with check (company_id = auth_company_id() or owner_id = auth.uid());

drop policy if exists "locations: şirket izolasyonu select" on vehicle_locations;
create policy "locations: şirket izolasyonu select" on vehicle_locations
  for select using (company_id = auth_company_id());

drop policy if exists "locations: şirket izolasyonu mutate" on vehicle_locations;
create policy "locations: şirket izolasyonu mutate" on vehicle_locations
  for all using (company_id = auth_company_id())
  with check (company_id = auth_company_id());

drop policy if exists "telemetry: şirket izolasyonu select" on telemetry_events;
create policy "telemetry: şirket izolasyonu select" on telemetry_events
  for select using (company_id = auth_company_id());

drop policy if exists "telemetry: şirket izolasyonu mutate" on telemetry_events;
create policy "telemetry: şirket izolasyonu mutate" on telemetry_events
  for all using (company_id = auth_company_id())
  with check (company_id = auth_company_id());

drop policy if exists "notifications: şirket izolasyonu select" on notifications;
create policy "notifications: şirket izolasyonu select" on notifications
  for select using (company_id = auth_company_id());

drop policy if exists "notifications: şirket izolasyonu mutate" on notifications;
create policy "notifications: şirket izolasyonu mutate" on notifications
  for all using (company_id = auth_company_id())
  with check (company_id = auth_company_id());
