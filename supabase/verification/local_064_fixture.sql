-- ============================================================================
-- local_064_fixture.sql — Migration 064 doğrulaması için MİNİMAL şema + veri.
--
-- `auth.uid()` gerçek Supabase'de JWT'den gelir; yerel doğrulamada
-- `current_setting('request.jwt.claim.sub')` üzerinden taklit edilir —
-- Supabase'in kendi tanımıyla AYNI davranış.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid()
);

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

CREATE TABLE IF NOT EXISTS public.companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text
);

CREATE TABLE IF NOT EXISTS public.profiles (
  id         uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.vehicles (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plate      text,
  owner_id   uuid,
  company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.vehicle_users (
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  PRIMARY KEY (vehicle_id, user_id)
);

-- Roller (Supabase'de hazır gelir).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA auth   TO anon, authenticated, service_role;
GRANT SELECT ON public.vehicle_users, public.vehicles, public.profiles TO authenticated;

-- ── Fikstür verisi ──────────────────────────────────────────────────────────
-- A: aracı eşleştirmiş kullanıcı · B: yabancı (başka şirket) · C: aynı şirket
INSERT INTO auth.users (id) VALUES
  ('11111111-1111-1111-1111-111111111111'),
  ('22222222-2222-2222-2222-222222222222'),
  ('33333333-3333-3333-3333-333333333333')
ON CONFLICT DO NOTHING;

INSERT INTO public.companies (id, name) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Filo A'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'Filo B')
ON CONFLICT DO NOTHING;

INSERT INTO public.profiles (id, company_id) VALUES
  ('11111111-1111-1111-1111-111111111111', NULL),
  ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-0000-0000-0000-000000000002'),
  ('33333333-3333-3333-3333-333333333333', 'aaaaaaaa-0000-0000-0000-000000000001')
ON CONFLICT DO NOTHING;

-- V1: A'nın eşleştirdiği bireysel araç · V2: Filo A'nın şirket aracı
INSERT INTO public.vehicles (id, plate, company_id) VALUES
  ('ffffffff-0000-0000-0000-000000000001', '34 AAA 001', NULL),
  ('ffffffff-0000-0000-0000-000000000002', '34 BBB 002', 'aaaaaaaa-0000-0000-0000-000000000001')
ON CONFLICT DO NOTHING;

INSERT INTO public.vehicle_users (vehicle_id, user_id) VALUES
  ('ffffffff-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111')
ON CONFLICT DO NOTHING;
