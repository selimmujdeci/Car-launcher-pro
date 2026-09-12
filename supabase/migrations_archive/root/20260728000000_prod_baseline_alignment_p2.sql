-- =====================================================================
-- DÜZELTİCİ 065-P4: PROD BASELINE HİZALAMA — FAZ 2 (filo katmanı öncesi)
--
-- ── NEDEN (temiz Postgres'te ÖLÇÜLDÜ + prod salt-okunur doğrulandı) ──
-- 033'ten (`enable_individual_ownership_schema`) itibaren başlayan filo /
-- sürücü / AI katmanı, website baseline'ının nesnelerine dayanır. Kök
-- zincirde bu nesneleri yaratan HİÇBİR migration yoktur; bugüne dek
-- prod'da website zinciri onları sağladığı için kusur görünmemiştir.
-- Temiz bir ortamda ölçülen kırılmalar (sırayla):
--   · 033 → "033 ÖN KONTROL: beklenen kolonlar eksik. Bulunan: {}"
--            (public.profiles YOK · vehicle_locations.company_id YOK)
--   · 033 → "033 SON KONTROL: company_id index kayboldu"
--            (idx_vehicle_loc_company YOK)
--   · 045 → 'column "lat" does not exist'
--            (vehicle_telemetry.lat/lng YOK)
-- Ayrıca 034 `vehicles.pairing_code` ve `vehicle_linking_codes`, 036/039
-- `vehicle_pairings`, 033–039 `auth_company_id()` kullanır.
--
-- ── OTORİTE: PROD ────────────────────────────────────────────────────
-- Tüm tanımlar canlı `Carospro` şemasından SALT-OKUNUR okunmuştur
-- (information_schema · pg_constraint · pg_indexes · pg_policies ·
-- pg_get_functiondef). Uydurma tanım YOKTUR.
--
-- ── GARANTİLER ───────────────────────────────────────────────────────
--   · İDEMPOTENT · PROD'DA NO-OP (her nesne IF NOT EXISTS ile korunur)
--   · VERİ YAZMAZ · Mevcut migration'lar DEĞİŞTİRİLMEDİ
--   · KAPSAM DAR: yalnız kök zincirin GERÇEKTEN kullandığı baseline
--     nesneleri kurulur. Prod'da olup zincirin dokunmadığı website
--     yüzeyleri (notifications · telemetry_events · route_commands ·
--     command_logs · vehicle_push_tokens ve bazı vehicles kolonları)
--     BİLİNÇLİ olarak KURULMAZ — onların sahibi website zinciridir.
--     Bu ayrışma docs/DEVICE_VALIDATION_LEDGER.md #582'de kayıtlıdır.
-- =====================================================================

BEGIN;

-- ── 1. profiles (website/001_init) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.profiles (
  id         uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  full_name  text,
  role       text NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')),
  created_at timestamptz NOT NULL DEFAULT now(),
  avatar_url text
);
CREATE INDEX IF NOT EXISTS idx_profiles_company_id ON public.profiles(company_id);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- ── 2. vehicle_pairings (website/20260424000009_command_bus) ─────────
CREATE TABLE IF NOT EXISTS public.vehicle_pairings (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  role       text NOT NULL DEFAULT 'owner' CHECK (role IN ('owner','driver','observer')),
  paired_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, vehicle_id)
);
ALTER TABLE public.vehicle_pairings ENABLE ROW LEVEL SECURITY;

-- ── 3. vehicle_linking_codes (website/20260425000001_linking_codes) ──
CREATE TABLE IF NOT EXISTS public.vehicle_linking_codes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL UNIQUE REFERENCES public.vehicles(id) ON DELETE CASCADE,
  code       text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '5 minutes'),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.vehicle_linking_codes ENABLE ROW LEVEL SECURITY;

-- ── 4. vehicles.pairing_code (prod: NOT NULL + UNIQUE + üretilen varsayılan)
ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS pairing_code text
  DEFAULT upper(left(replace(gen_random_uuid()::text, '-', ''), 6));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid='public.vehicles'::regclass AND conname='vehicles_pairing_code_key'
  ) THEN
    -- Yalnız çakışan/boş değer YOKSA kurulabilir; aksi hâlde sessizce atlanır
    -- (mevcut ortamda veri düzeltmesi bu migration'ın işi DEĞİLDİR).
    IF NOT EXISTS (
      SELECT 1 FROM public.vehicles WHERE pairing_code IS NULL
      UNION ALL
      SELECT 1 FROM (SELECT pairing_code FROM public.vehicles
                      GROUP BY pairing_code HAVING count(*) > 1) d
    ) THEN
      ALTER TABLE public.vehicles ADD CONSTRAINT vehicles_pairing_code_key UNIQUE (pairing_code);
      ALTER TABLE public.vehicles ALTER COLUMN pairing_code SET NOT NULL;
    ELSE
      RAISE NOTICE '065-P4: pairing_code UNIQUE/NOT NULL ATLANDI — mevcut veride boş/çakışan değer var';
    END IF;
  END IF;
END $$;

-- ── 5. vehicle_locations: company_id + heading_deg + index ───────────
-- (tablo migration 017 tarafından kurulur; prod'daki karşılığı website/001'dir)
ALTER TABLE public.vehicle_locations
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE;
ALTER TABLE public.vehicle_locations
  ADD COLUMN IF NOT EXISTS heading_deg real;
CREATE INDEX IF NOT EXISTS idx_vehicle_loc_company ON public.vehicle_locations(company_id);

-- Prod'da company_id NOT NULL'dır ve migration 033 onu DROP NOT NULL yapar.
-- Boş tabloda prod'un uygulama-öncesi hâli birebir kurulur; veri varsa
-- (NULL içeren satır) kısıt EKLENMEZ — 033 sonrası son durum zaten nullable'dır.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='vehicle_locations'
                AND column_name='company_id' AND is_nullable='YES')
     AND NOT EXISTS (SELECT 1 FROM public.vehicle_locations WHERE company_id IS NULL)
  THEN
    ALTER TABLE public.vehicle_locations ALTER COLUMN company_id SET NOT NULL;
  END IF;
END $$;

-- ── 6. vehicle_telemetry: lat/lng/is_online (prod'da var) ────────────
ALTER TABLE public.vehicle_telemetry ADD COLUMN IF NOT EXISTS lat       double precision;
ALTER TABLE public.vehicle_telemetry ADD COLUMN IF NOT EXISTS lng       double precision;
ALTER TABLE public.vehicle_telemetry ADD COLUMN IF NOT EXISTS is_online boolean NOT NULL DEFAULT false;

-- ── 7. Baseline yardımcı fonksiyonları (prod gövdeleriyle BİREBİR) ───
CREATE OR REPLACE FUNCTION public.auth_company_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  select company_id from profiles where id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.is_paired(p_user uuid, p_vehicle uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  select exists (select 1 from vehicle_pairings where user_id=p_user and vehicle_id=p_vehicle);
$$;

CREATE OR REPLACE FUNCTION public.is_vehicle_owner(p_vehicle uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  select exists (select 1 from vehicles where id=p_vehicle and owner_id=auth.uid());
$$;

-- ── 8. Baseline RLS politikaları (prod pg_policies'ten BİREBİR) ──────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                  AND tablename='profiles' AND policyname='profiles: kendi kaydı') THEN
    CREATE POLICY "profiles: kendi kaydı" ON public.profiles
      FOR ALL USING (id = auth.uid()) WITH CHECK (id = auth.uid());
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                  AND tablename='profiles' AND policyname='profiles: şirket üyelerini gör') THEN
    CREATE POLICY "profiles: şirket üyelerini gör" ON public.profiles
      FOR SELECT USING (company_id = public.auth_company_id());
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                  AND tablename='profiles' AND policyname='company_isolation_select_profiles') THEN
    CREATE POLICY "company_isolation_select_profiles" ON public.profiles
      FOR SELECT USING (company_id = public.auth_company_id());
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                  AND tablename='profiles' AND policyname='company_isolation_mutate_profiles') THEN
    CREATE POLICY "company_isolation_mutate_profiles" ON public.profiles
      FOR ALL USING (company_id = public.auth_company_id())
      WITH CHECK (company_id = public.auth_company_id());
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                  AND tablename='vehicle_pairings' AND policyname='pairings: kendi eslesmeleri') THEN
    CREATE POLICY "pairings: kendi eslesmeleri" ON public.vehicle_pairings
      FOR SELECT USING (user_id = auth.uid());
  END IF;
END $$;
-- NOT: prod'da `vehicle_linking_codes` üzerinde POLİTİKA YOKTUR (RLS açık,
-- erişim yalnız SECURITY DEFINER RPC'lerden) — burada da kurulmaz.

-- ── 9. SON DOĞRULAMA (fail-closed) ───────────────────────────────────
DO $$
DECLARE
  v_missing text[] := '{}';
BEGIN
  IF to_regclass('public.profiles')              IS NULL THEN v_missing := v_missing || 'profiles';              END IF;
  IF to_regclass('public.vehicle_pairings')      IS NULL THEN v_missing := v_missing || 'vehicle_pairings';      END IF;
  IF to_regclass('public.vehicle_linking_codes') IS NULL THEN v_missing := v_missing || 'vehicle_linking_codes'; END IF;
  IF to_regprocedure('public.auth_company_id()') IS NULL THEN v_missing := v_missing || 'auth_company_id()';     END IF;
  IF array_length(v_missing,1) IS NOT NULL THEN
    RAISE EXCEPTION '065-P4 DOĞRULAMA: eksik nesneler: %', v_missing;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='vehicle_locations' AND column_name='company_id') THEN
    RAISE EXCEPTION '065-P4 DOĞRULAMA: vehicle_locations.company_id yok';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                  WHERE schemaname='public' AND indexname='idx_vehicle_loc_company') THEN
    RAISE EXCEPTION '065-P4 DOĞRULAMA: idx_vehicle_loc_company yok';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='vehicle_telemetry' AND column_name='lat') THEN
    RAISE EXCEPTION '065-P4 DOĞRULAMA: vehicle_telemetry.lat yok';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='vehicles' AND column_name='pairing_code') THEN
    RAISE EXCEPTION '065-P4 DOĞRULAMA: vehicles.pairing_code yok';
  END IF;

  RAISE NOTICE '065-P4 OK: prod baseline faz-2 hizalandı (profiles · pairings · linking_codes · pairing_code · konum/telemetri kolonları · yardımcı fonksiyonlar)';
END $$;

COMMIT;
