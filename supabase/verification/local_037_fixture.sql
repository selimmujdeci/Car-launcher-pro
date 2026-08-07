-- =====================================================================
-- local_037_fixture.sql — 037 için YEREL/GEÇİCİ ŞEMA KURULUMU.
--
-- Production şemasının TAMAMI değildir: 037'nin dokunduğu yüzeyi
-- (profiles · companies · anon/authenticated rolleri · Supabase varsayılan
-- anon GRANT'i) üretimdeki gibi kurar ki migration GERÇEKTEN koşturulup
-- doğrulanabilsin. Yalnız geçici test veritabanında kullanılır.
-- =====================================================================

-- Supabase rolleri (yerel kurulumda yok — üretimdekiyle aynı adlarla kurulur).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon')          THEN CREATE ROLE anon          NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role')  THEN CREATE ROLE service_role  NOLOGIN; END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.companies (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.profiles (
  id         uuid PRIMARY KEY,
  role       text NOT NULL DEFAULT 'individual',
  company_id uuid REFERENCES public.companies(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- FAZ 2 kapsamı: head unit'in anon key ile kullandığı tablolar.
-- 037 bunlara DOKUNMAMALI — test tam olarak bunu doğrular.
CREATE TABLE IF NOT EXISTS public.vehicles (
  id             text PRIMARY KEY,
  owner_id       uuid,
  company_id     uuid,
  e2e_public_key text
);

CREATE TABLE IF NOT EXISTS public.vehicle_commands (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id text NOT NULL,
  status     text NOT NULL DEFAULT 'pending'
);

-- Üretimdeki durum: RLS AÇIK ...
ALTER TABLE public.companies        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicles         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_commands ENABLE ROW LEVEL SECURITY;

-- ... ama `anon` Supabase varsayılanı yüzünden GRANT taşıyor (R4 bulgusu).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.companies        TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles         TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vehicles         TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vehicle_commands TO anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.companies        TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles         TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vehicles         TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vehicle_commands TO authenticated;

GRANT ALL ON public.companies        TO service_role;
GRANT ALL ON public.profiles         TO service_role;
GRANT ALL ON public.vehicles         TO service_role;
GRANT ALL ON public.vehicle_commands TO service_role;
