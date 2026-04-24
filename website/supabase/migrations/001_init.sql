-- ─────────────────────────────────────────────────────────────────
-- Car Launcher Pro — Database Schema
-- ─────────────────────────────────────────────────────────────────

-- vehicles: one row per Android device
create table if not exists vehicles (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  device_id    text unique not null,
  api_key_hash text not null,            -- SHA-256 of raw apiKey (never stored raw)
  created_at   timestamptz default now() not null
);

-- vehicle_users: user ↔ vehicle many-to-many
create table if not exists vehicle_users (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  role       text not null default 'owner' check (role in ('owner', 'viewer')),
  created_at timestamptz default now() not null,
  unique (user_id, vehicle_id)
);

-- linking_codes: ephemeral 6-digit codes (60 s TTL, single-use)
create table if not exists linking_codes (
  id         uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  code       text unique not null,
  expires_at timestamptz not null,
  used_at    timestamptz,               -- null = unused
  created_at timestamptz default now() not null
);

-- events: high-frequency telemetry (vehicle pushes here)
create table if not exists events (
  id          uuid primary key default gen_random_uuid(),
  vehicle_id  uuid not null references vehicles(id) on delete cascade,
  lat         double precision,
  lng         double precision,
  speed       real,
  fuel        real,
  engine_temp real,
  rpm         integer,
  created_at  timestamptz default now() not null
);

-- ─── Indexes ──────────────────────────────────────────────────────
create index if not exists idx_vehicle_users_user    on vehicle_users(user_id);
create index if not exists idx_vehicle_users_vehicle on vehicle_users(vehicle_id);
create index if not exists idx_linking_codes_code    on linking_codes(code);
create index if not exists idx_events_vehicle        on events(vehicle_id, created_at desc);

-- ─── Row Level Security ───────────────────────────────────────────
alter table vehicles      enable row level security;
alter table vehicle_users enable row level security;
alter table linking_codes enable row level security;
alter table events        enable row level security;

-- vehicles: user sees only vehicles they're linked to
create policy "user_sees_linked_vehicles"
  on vehicles for select
  using (
    id in (
      select vehicle_id from vehicle_users where user_id = auth.uid()
    )
  );

-- vehicle_users: user sees only their own links
create policy "user_sees_own_links"
  on vehicle_users for select
  using (user_id = auth.uid());

-- events: user sees events for their vehicles (for Realtime subscriptions)
create policy "user_sees_linked_events"
  on events for select
  using (
    vehicle_id in (
      select vehicle_id from vehicle_users where user_id = auth.uid()
    )
  );

-- linking_codes: no direct client access (API only via service_role)

-- ─── Auto-expire cleanup (optional cron via pg_cron) ─────────────
-- select cron.schedule('expire-linking-codes', '* * * * *',
--   $$delete from linking_codes where expires_at < now() - interval '5 minutes'$$
-- );
