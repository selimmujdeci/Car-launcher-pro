-- ═══════════════════════════════════════
-- 20260424000009 — PART 1: Tablolar + Fonksiyonlar
-- ═══════════════════════════════════════

-- status enum varsa text'e çevir
do $$ begin
  if exists (
    select 1 from information_schema.columns
    where table_name='vehicle_commands' and column_name='status' and udt_name='command_status'
  ) then
    alter table vehicle_commands alter column status type text using status::text;
  end if;
end $$;

-- vehicle_pairings
create table if not exists vehicle_pairings (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  role       text not null default 'owner' check (role in ('owner','driver','observer')),
  paired_at  timestamptz not null default now(),
  unique (user_id, vehicle_id)
);
alter table vehicle_pairings enable row level security;

-- vehicle_telemetry
create table if not exists vehicle_telemetry (
  id         uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null unique references vehicles(id) on delete cascade,
  lat        double precision,
  lng        double precision,
  speed      real not null default 0 check (speed >= 0 and speed <= 300),
  fuel       real not null default 0 check (fuel >= 0 and fuel <= 100),
  rpm        integer not null default 0 check (rpm >= 0 and rpm <= 10000),
  temp       real not null default 0 check (temp >= -40 and temp <= 150),
  is_online  boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table vehicle_telemetry enable row level security;
create index if not exists idx_vehicle_telemetry_ts on vehicle_telemetry(updated_at desc);

-- Fonksiyonlar
create or replace function is_paired(p_user uuid, p_vehicle uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from vehicle_pairings where user_id=p_user and vehicle_id=p_vehicle);
$$;

create or replace function is_vehicle_owner(p_vehicle uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from vehicles where id=p_vehicle and owner_id=auth.uid());
$$;

create or replace function pair_vehicle_by_code(p_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_vehicle_id uuid;
begin
  select id into v_vehicle_id from vehicles where pairing_code = upper(p_code);
  if v_vehicle_id is null then raise exception 'Geçersiz kod: %', p_code; end if;
  insert into vehicle_pairings (user_id, vehicle_id)
  values (auth.uid(), v_vehicle_id) on conflict (user_id, vehicle_id) do nothing;
  return v_vehicle_id;
end;
$$;

-- Realtime
do $$ begin
  begin alter publication supabase_realtime add table vehicle_commands;  exception when others then null; end;
  begin alter publication supabase_realtime add table route_commands;    exception when others then null; end;
  begin alter publication supabase_realtime add table vehicle_locations; exception when others then null; end;
  begin alter publication supabase_realtime add table vehicle_telemetry; exception when others then null; end;
end $$;
