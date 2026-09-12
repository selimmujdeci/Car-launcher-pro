-- ═══════════════════════════════════════════════════════
-- 002_remote_commands.sql — Komut veriyolu tabloları
-- Idempotent: defalarca çalıştırılabilir
-- ═══════════════════════════════════════════════════════

-- ── vehicle_commands ──────────────────────────────────────
create table if not exists vehicle_commands (
  id                    uuid primary key default gen_random_uuid(),
  vehicle_id            uuid not null references vehicles(id) on delete cascade,
  company_id            uuid references companies(id) on delete cascade,
  sender_id             uuid references auth.users(id) on delete set null,
  created_by            uuid references auth.users(id) on delete set null,
  type                  text not null,
  payload               jsonb not null default '{}'::jsonb,
  status                text not null default 'pending'
                          check (status in (
                            'pending','accepted','executing',
                            'completed','failed','expired','rejected'
                          )),
  nonce                 text not null default gen_random_uuid()::text,
  ttl                   timestamptz not null default (now() + interval '5 minutes'),
  error_message         text,
  critical_auth_verified boolean not null default false,
  accepted_at           timestamptz,
  executed_at           timestamptz,
  finished_at           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint nonce_vehicle_unique unique (vehicle_id, nonce)
);

alter table vehicle_commands enable row level security;

drop trigger if exists trg_commands_updated_at on vehicle_commands;
create trigger trg_commands_updated_at
  before update on vehicle_commands
  for each row execute function fn_set_updated_at();

create index if not exists idx_vcmd_vehicle_status on vehicle_commands(vehicle_id, status);
create index if not exists idx_vcmd_ttl            on vehicle_commands(ttl);

-- ── route_commands ────────────────────────────────────────
create table if not exists route_commands (
  id              uuid primary key default gen_random_uuid(),
  command_id      uuid references vehicle_commands(id) on delete cascade,
  vehicle_id      uuid not null references vehicles(id) on delete cascade,
  lat             double precision not null check (lat between -90 and 90),
  lng             double precision not null check (lng between -180 and 180),
  address_name    text,
  provider_intent text not null default 'google_maps'
                    check (provider_intent in ('google_maps','yandex','waze','apple_maps')),
  created_at      timestamptz not null default now()
);

alter table route_commands enable row level security;

-- ── command_logs ──────────────────────────────────────────
create table if not exists command_logs (
  id         uuid primary key default gen_random_uuid(),
  command_id uuid references vehicle_commands(id) on delete set null,
  vehicle_id uuid references vehicles(id) on delete set null,
  actor_id   uuid references auth.users(id) on delete set null,
  event      text not null,
  details    jsonb,
  created_at timestamptz not null default now()
);

alter table command_logs enable row level security;

-- ── Stale komutları expire et ─────────────────────────────
create or replace function expire_stale_commands()
returns integer language plpgsql security definer set search_path = public as $$
declare cnt integer;
begin
  update vehicle_commands
  set status = 'expired', updated_at = now()
  where status in ('pending','accepted','executing') and ttl < now();
  get diagnostics cnt = row_count;
  return cnt;
end;
$$;
