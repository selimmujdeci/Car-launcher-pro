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
create or replace function register_vehicle(p_device_id text, p_name text default 'Araç')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_vehicle_id uuid;
  v_api_key    text;
  v_code       text;
  v_expires_at timestamptz;
begin
  -- Mevcut aracı device_name (device_id) ile bul
  select id, api_key_hash into v_vehicle_id, v_api_key
  from vehicles where device_name = p_device_id limit 1;

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
create or replace function refresh_linking_code(p_api_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_vehicle_id uuid;
  v_code       text;
  v_expires_at timestamptz;
begin
  select id into v_vehicle_id from vehicles where api_key_hash = p_api_key limit 1;
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

-- ── pair_vehicle (güncellendi) ────────────────────────────
-- Geçici kod VEYA kalıcı pairing_code ile eşleşir.
create or replace function pair_vehicle(p_pairing_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_vehicle_id uuid;
  v_code       text;
begin
  v_code := upper(trim(p_pairing_code));

  -- 1. Geçici bağlama kodunda ara
  select vehicle_id into v_vehicle_id
  from vehicle_linking_codes
  where code = v_code and expires_at > now()
  limit 1;

  -- 2. Bulunamazsa kalıcı pairing_code'da ara
  if v_vehicle_id is null then
    select id into v_vehicle_id
    from vehicles
    where upper(pairing_code) = v_code and owner_id is null
    limit 1;
  end if;

  if v_vehicle_id is null then
    return jsonb_build_object(
      'success', false,
      'message', 'Geçersiz eşleşme kodu veya araç başka bir kullanıcıya bağlı.'
    );
  end if;

  -- Sahibi ata
  update vehicles set owner_id = auth.uid(), updated_at = now()
  where id = v_vehicle_id;

  -- Pairing kaydı
  insert into vehicle_pairings (user_id, vehicle_id, role)
  values (auth.uid(), v_vehicle_id, 'owner')
  on conflict (user_id, vehicle_id) do nothing;

  -- Kullanılan geçici kodu sil
  delete from vehicle_linking_codes where vehicle_id = v_vehicle_id;

  return jsonb_build_object('success', true, 'vehicle_id', v_vehicle_id);
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
