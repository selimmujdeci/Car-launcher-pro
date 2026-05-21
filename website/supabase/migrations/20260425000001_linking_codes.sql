-- ═══════════════════════════════════════════════════════
-- 20260425000001_linking_codes.sql
-- Geçici araç bağlama kodları + register_vehicle RPC
-- Idempotent: defalarca çalıştırılabilir
-- ═══════════════════════════════════════════════════════

-- Geçici bağlama kodları tablosu (5 dakika TTL)
create table if not exists vehicle_linking_codes (
  id         uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  code       text not null,
  expires_at timestamptz not null default (now() + interval '5 minutes'),
  created_at timestamptz not null default now(),
  unique (vehicle_id),
  unique (code)
);
alter table vehicle_linking_codes enable row level security;

-- ── register_vehicle ──────────────────────────────────────
-- Araç launcher'ı ilk açılışta çağırır.
-- Aracı oluşturur (veya bulur), 6 haneli bağlama kodu üretir.
-- coalesce(api_key_hash, api_key): eski araçlarda api_key kolonu dolu olabilir.
drop function if exists public.register_vehicle(text, text);
create or replace function public.register_vehicle(p_device_id text, p_name text default 'Araç')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_vehicle_id uuid;
  v_api_key    text;
  v_code       text;
  v_expires_at timestamptz;
begin
  -- Mevcut aracı device_name (device_id) ile bul; her iki api_key kolonunu dene
  select id, coalesce(api_key_hash, api_key)
  into   v_vehicle_id, v_api_key
  from   vehicles
  where  device_name = p_device_id
  limit  1;

  if v_vehicle_id is null then
    -- Yeni araç oluştur
    v_api_key := gen_random_uuid()::text;
    insert into vehicles (name, device_name, api_key_hash)
    values (p_name, p_device_id, v_api_key)
    returning id into v_vehicle_id;
  end if;

  -- 6 haneli sayısal bağlama kodu üret (çakışmadan kaçın)
  loop
    v_code := lpad((floor(random() * 1000000))::int::text, 6, '0');
    exit when not exists (
      select 1 from vehicle_linking_codes
      where code = v_code and expires_at > now()
    );
  end loop;

  v_expires_at := now() + interval '5 minutes';

  insert into vehicle_linking_codes (vehicle_id, code, expires_at)
  values (v_vehicle_id, v_code, v_expires_at)
  on conflict (vehicle_id) do update
    set code = excluded.code, expires_at = excluded.expires_at;

  return jsonb_build_object(
    'vehicle_id',   v_vehicle_id,
    'api_key',      v_api_key,
    'linking_code', v_code,
    'expires_at',   v_expires_at
  );
end;
$$;

-- ── refresh_linking_code ──────────────────────────────────
-- Kod süresi dolunca launcher yeni kod ister (api_key ile auth).
-- Her iki api_key kolonunu kontrol eder (api_key_hash veya api_key).
create or replace function public.refresh_linking_code(p_api_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_vehicle_id uuid;
  v_code       text;
  v_expires_at timestamptz;
begin
  select id into v_vehicle_id
  from   vehicles
  where  api_key_hash = p_api_key or api_key = p_api_key
  limit  1;

  if v_vehicle_id is null then
    raise exception 'Geçersiz API anahtarı';
  end if;

  loop
    v_code := lpad((floor(random() * 1000000))::int::text, 6, '0');
    exit when not exists (
      select 1 from vehicle_linking_codes
      where code = v_code and expires_at > now() and vehicle_id != v_vehicle_id
    );
  end loop;

  v_expires_at := now() + interval '5 minutes';

  insert into vehicle_linking_codes (vehicle_id, code, expires_at)
  values (v_vehicle_id, v_code, v_expires_at)
  on conflict (vehicle_id) do update
    set code = excluded.code, expires_at = excluded.expires_at;

  return jsonb_build_object('linking_code', v_code, 'expires_at', v_expires_at);
end;
$$;

-- Süresi dolmuş geçici kodları temizle
create or replace function cleanup_expired_linking_codes()
returns integer language plpgsql security definer set search_path = public as $$
declare cnt integer;
begin
  delete from vehicle_linking_codes where expires_at < now();
  get diagnostics cnt = row_count;
  return cnt;
end;
$$;
