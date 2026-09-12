-- =====================================================================
-- local_baseline_fixture.sql — SUPABASE-BENZERİ YEREL BASELINE ŞEMA.
--
-- AMAÇ: migration 033–037 zincirinin GERÇEKTEN uygulanabileceği ve
-- gerçek RLS/privilege matrisinin GERÇEK SQL ile koşturulabileceği bir
-- geçici veritabanı kurmak. Yalnız geçici konteynerde kullanılır.
--
-- ⚠️ Bu, production şemasının birebir kopyası DEĞİLDİR. Migration zincirinin
-- dokunduğu yüzeyi (tablolar · kolonlar · RLS · roller · auth.uid()) üretimdeki
-- sözleşmeye uygun kurar. Farklar rapora yazılır — "production doğrulandı"
-- ANLAMINA GELMEZ.
-- =====================================================================

-- ── Roller (Supabase'de hazır gelir) ─────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon')          THEN CREATE ROLE anon          NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role')  THEN CREATE ROLE service_role  NOLOGIN BYPASSRLS; END IF;
END $$;

-- ── auth şeması ve auth.uid() ────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text,
  raw_user_meta_data jsonb DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

/**
 * auth.uid() — Supabase'deki davranışın birebir aynısı: kimlik JWT
 * claim'lerinden okunur, ASLA fonksiyon argümanından değil.
 * Yerelde `request.jwt.claims` GUC'u ile taklit edilir.
 */
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql STABLE
AS $$
  SELECT NULLIF(
    current_setting('request.jwt.claims', true)::jsonb ->> 'sub',
    ''
  )::uuid
$$;

CREATE OR REPLACE FUNCTION auth.role()
RETURNS text
LANGUAGE sql STABLE
AS $$
  SELECT COALESCE(
    current_setting('request.jwt.claims', true)::jsonb ->> 'role',
    'anon'
  )
$$;

GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid()  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.role() TO anon, authenticated, service_role;

-- ── Filo tabloları ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.companies (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- profiles.company_id üretimde NOT NULL'dı; 033 onu DROP NOT NULL yapar.
-- Baseline bu yüzden NOT NULL kurulur → 033 gerçekten iş yapar.
CREATE TABLE IF NOT EXISTS public.profiles (
  id         uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name  text,
  role       text NOT NULL DEFAULT 'member',
  company_id uuid NOT NULL REFERENCES public.companies(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.vehicles (
  -- Migration 036 `assign_vehicle_to_company(p_vehicle_id uuid)` ve
  -- `list_company_vehicles() RETURNS TABLE(vehicle_id uuid, ...)` ile UYUMLU.
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text,
  plate          text,
  owner_id       uuid REFERENCES auth.users(id),
  company_id     uuid REFERENCES public.companies(id),
  api_key        text,
  e2e_public_key text,
  last_seen      timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.vehicle_pairings (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role       text NOT NULL DEFAULT 'owner',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vehicle_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.vehicle_linking_codes (
  code       text PRIMARY KEY,
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.vehicle_locations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id),
  lat        double precision,
  lon        double precision,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.vehicle_commands (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id  uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  status      text NOT NULL DEFAULT 'pending',
  ttl         timestamptz,
  retry_count int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.vehicle_events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id text NOT NULL,
  type       text NOT NULL,
  payload    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.vehicle_telemetry (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  payload    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ── Index'ler ────────────────────────────────────────────────────────
-- Migration 033 "company_id index kayboldu" SON KONTROL'ü ile korunuyor:
-- NOT NULL kaldırılırken index'in düşmediğini doğruluyor. Baseline bu
-- yüzden index'leri üretimdeki gibi kurmak ZORUNDA.
CREATE INDEX IF NOT EXISTS profiles_company_id_idx          ON public.profiles(company_id);
CREATE INDEX IF NOT EXISTS vehicle_locations_company_id_idx ON public.vehicle_locations(company_id);
CREATE INDEX IF NOT EXISTS vehicles_company_id_idx          ON public.vehicles(company_id);
CREATE INDEX IF NOT EXISTS vehicles_owner_id_idx            ON public.vehicles(owner_id);
CREATE INDEX IF NOT EXISTS vehicle_commands_vehicle_idx     ON public.vehicle_commands(vehicle_id, status);
CREATE INDEX IF NOT EXISTS vehicle_locations_vehicle_idx    ON public.vehicle_locations(vehicle_id);

-- ── RLS AÇIK (üretimdeki gibi) ───────────────────────────────────────
ALTER TABLE public.companies             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicles              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_pairings      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_linking_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_locations     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_commands      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_events        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_telemetry     ENABLE ROW LEVEL SECURITY;

-- ── Politikalar (üretim sözleşmesinin yerel karşılığı) ───────────────
-- Kendi profilini okur/günceller.
DROP POLICY IF EXISTS profiles_self_read ON public.profiles;
CREATE POLICY profiles_self_read ON public.profiles
  FOR SELECT TO authenticated USING (id = auth.uid());

DROP POLICY IF EXISTS profiles_self_update ON public.profiles;
CREATE POLICY profiles_self_update ON public.profiles
  FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- Kendi şirketini okur.
DROP POLICY IF EXISTS companies_member_read ON public.companies;
CREATE POLICY companies_member_read ON public.companies
  FOR SELECT TO authenticated
  USING (id = (SELECT p.company_id FROM public.profiles p WHERE p.id = auth.uid()));

-- Sahibi olduğu VEYA şirketine ait aracı okur.
DROP POLICY IF EXISTS vehicles_scope_read ON public.vehicles;
CREATE POLICY vehicles_scope_read ON public.vehicles
  FOR SELECT TO authenticated
  USING (
    owner_id = auth.uid()
    OR (company_id IS NOT NULL
        AND company_id = (SELECT p.company_id FROM public.profiles p WHERE p.id = auth.uid()))
  );

-- Sahibi olduğu aracı günceller (isim/plaka gibi metadata).
DROP POLICY IF EXISTS vehicles_owner_update ON public.vehicles;
CREATE POLICY vehicles_owner_update ON public.vehicles
  FOR UPDATE TO authenticated
  USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

-- Kendi eşleştirmesini okur.
DROP POLICY IF EXISTS pairings_self_read ON public.vehicle_pairings;
CREATE POLICY pairings_self_read ON public.vehicle_pairings
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- Erişebildiği aracın konumunu okur.
DROP POLICY IF EXISTS locations_scope_read ON public.vehicle_locations;
CREATE POLICY locations_scope_read ON public.vehicle_locations
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.vehicles v
    WHERE v.id = vehicle_locations.vehicle_id
      AND (v.owner_id = auth.uid()
           OR (v.company_id IS NOT NULL
               AND v.company_id = (SELECT p.company_id FROM public.profiles p WHERE p.id = auth.uid())))
  ));

-- Erişebildiği aracın komutlarını okur.
DROP POLICY IF EXISTS commands_scope_read ON public.vehicle_commands;
CREATE POLICY commands_scope_read ON public.vehicle_commands
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.vehicles v
    WHERE v.id = vehicle_commands.vehicle_id
      AND (v.owner_id = auth.uid()
           OR (v.company_id IS NOT NULL
               AND v.company_id = (SELECT p.company_id FROM public.profiles p WHERE p.id = auth.uid())))
  ));

-- vehicle_linking_codes: HİÇBİR istemci politikası YOK (yalnız RPC okur).
-- vehicle_events / vehicle_telemetry: istemci politikası YOK (RPC ile yazılır).

-- ── GRANT (Supabase varsayılanı — R4'ün kaynağı) ─────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'companies','profiles','vehicles','vehicle_pairings','vehicle_linking_codes',
    'vehicle_locations','vehicle_commands','vehicle_events','vehicle_telemetry'
  ] LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO anon', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- ── Test verisi (deterministik UUID'ler) ─────────────────────────────
INSERT INTO public.companies (id, name) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Alfa Filo'),
  ('22222222-2222-2222-2222-222222222222', 'Beta Filo')
ON CONFLICT DO NOTHING;

INSERT INTO auth.users (id, email) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'admin-alfa@test'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'member-alfa@test'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'observer-alfa@test'),
  ('aaaaaaaa-0000-0000-0000-000000000004', 'admin2-alfa@test'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'admin-beta@test'),
  ('cccccccc-0000-0000-0000-000000000001', 'individual@test'),
  ('cccccccc-0000-0000-0000-000000000002', 'individual2@test')
ON CONFLICT DO NOTHING;

INSERT INTO public.profiles (id, full_name, role, company_id) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Admin Alfa',    'admin',    '11111111-1111-1111-1111-111111111111'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'Member Alfa',   'member',   '11111111-1111-1111-1111-111111111111'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'Observer Alfa', 'observer', '11111111-1111-1111-1111-111111111111'),
  ('aaaaaaaa-0000-0000-0000-000000000004', 'Admin2 Alfa',   'admin',    '11111111-1111-1111-1111-111111111111'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'Admin Beta',    'admin',    '22222222-2222-2222-2222-222222222222')
ON CONFLICT DO NOTHING;

INSERT INTO public.vehicles (id, name, plate, owner_id, company_id, api_key) VALUES
  ('dddd0001-0000-0000-0000-000000000001', 'Alfa Araç 1',  '34ABC01', 'aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'key-alfa-1'),
  ('dddd0002-0000-0000-0000-000000000002', 'Beta Araç 1',  '34XYZ01', 'bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'key-beta-1'),
  ('dddd0003-0000-0000-0000-000000000003', 'Bireysel Araç','34IND01', 'cccccccc-0000-0000-0000-000000000001', NULL, 'key-indiv-1'),
  ('dddd0004-0000-0000-0000-000000000004', 'Sahipsiz Araç','34NON01', NULL, NULL, 'key-unowned')
ON CONFLICT DO NOTHING;

INSERT INTO public.vehicle_pairings (vehicle_id, user_id, role) VALUES
  ('dddd0001-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'owner'),
  ('dddd0003-0000-0000-0000-000000000003', 'cccccccc-0000-0000-0000-000000000001', 'owner')
ON CONFLICT DO NOTHING;

INSERT INTO public.vehicle_locations (vehicle_id, company_id, lat, lon) VALUES
  ('dddd0001-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 41.0, 29.0),
  ('dddd0002-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 39.9, 32.8)
ON CONFLICT DO NOTHING;

INSERT INTO public.vehicle_commands (vehicle_id, status) VALUES
  ('dddd0001-0000-0000-0000-000000000001', 'pending'),
  ('dddd0002-0000-0000-0000-000000000002', 'pending')
ON CONFLICT DO NOTHING;

INSERT INTO public.vehicle_linking_codes (code, vehicle_id, expires_at) VALUES
  ('CODE-ALFA', 'dddd0001-0000-0000-0000-000000000001', now() + interval '10 minutes'),
  ('CODE-EXP',  'dddd0003-0000-0000-0000-000000000003', now() - interval '1 minute')
ON CONFLICT DO NOTHING;
