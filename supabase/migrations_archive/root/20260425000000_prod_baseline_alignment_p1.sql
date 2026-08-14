-- =====================================================================
-- DÜZELTİCİ 065-P1: PROD BASELINE HİZALAMA — FAZ 1
--
-- ── NEDEN (prod'dan SALT-OKUNUR ölçüldü, 2026-08-14) ─────────────────
-- Bu depoda İKİ ayrı migration dizini aynı veritabanına uygulanmıştır:
--     supabase/migrations           (bu zincir — kök)
--     website/supabase/migrations   (baseline zinciri)
-- Canlı `Carospro` projesinin `supabase_migrations.schema_migrations`
-- defterinde 12 kayıt vardır ve bunların 10'u WEBSITE zincirine aittir
-- (001_init · 002_remote_commands · 20260424000009_command_bus …).
-- Yani prod'un TABANI website zincirinden gelir; kök zincir onun ÜZERİNE
-- elle uygulanmıştır.
--
-- Sonuç: kök zincir bugüne dek website tabanının varlığını SESSİZCE
-- varsaymıştır ve TEMİZ bir ortamda 11. migration'da kırılır:
--     20260426_sentry_mode.sql → ERROR: column "owner_id" does not exist
-- Ölçüm: `vehicles.owner_id` kolonunu kök zincirdeki HİÇBİR migration
-- yaratmaz; onu `website/supabase/migrations/001_init.sql` yaratır.
--
-- ── BU DOSYA NE YAPAR ────────────────────────────────────────────────
--   1. `vehicles.owner_id`     — prod'daki gerçek haliyle (uuid, nullable,
--      FK auth.users ON DELETE SET NULL, idx_vehicles_owner_id).
--   2. `vehicles.api_key_hash` — prod'da var (website 001), kök zincirde yok;
--      migration 024 (`fix_push_vehicle_event_api_key`) buna bağımlıdır.
--   3. Kök zincirin KENDİ İÇİNDE çakışan iki eski RPC aşırı-yüklemesini
--      kaldırır (aşağıda ayrıntı). Her ikisi de PROD'DA YOKTUR → prod'da
--      bu adımlar NO-OP'tur ve fail-closed guard ile korunmuştur.
--
-- ── GARANTİLER ───────────────────────────────────────────────────────
--   · İDEMPOTENT — ikinci koşuda değişiklik üretmez.
--   · PROD'DA NO-OP — prod zaten hedef durumdadır (ölçüldü).
--   · VERİ YAZMAZ — backfill yok, mevcut değerlere dokunmaz.
--   · Mevcut migration'ların HİÇBİRİ değiştirilmemiştir.
-- =====================================================================

BEGIN;

-- ── 1. vehicles.owner_id (prod'un gerçek tanımı) ─────────────────────
ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS owner_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.vehicles'::regclass
       AND contype  = 'f'
       AND conname  = 'vehicles_owner_id_fkey'
  ) THEN
    ALTER TABLE public.vehicles
      ADD CONSTRAINT vehicles_owner_id_fkey
      FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_vehicles_owner_id ON public.vehicles(owner_id);

-- ── 2. vehicles.api_key_hash (prod'da var; migration 024 kullanır) ───
ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS api_key_hash text;

-- ── 3a. Eski update_command_status aşırı-yüklemesi ───────────────────
-- Migration 006 `(text,uuid,text,timestamptz)` imzasını kurar; migration 011
-- `(text,uuid,text,text,timestamptz,timestamptz,timestamptz)` imzasıyla
-- CREATE OR REPLACE yapar → iki AYRI fonksiyon oluşur → 011'in sonundaki
-- niteliksiz `GRANT EXECUTE ON FUNCTION public.update_command_status`
-- `42725: function name is not unique` ile DÜŞER.
-- Prod'da yalnız 7 parametreli sürüm vardır → burası prod'da NO-OP.
DROP FUNCTION IF EXISTS public.update_command_status(text, uuid, text, timestamptz);

-- ── 3b. Eski push_vehicle_event aşırı-yüklemesi ──────────────────────
-- Migration 003 `(text,text,jsonb) RETURNS jsonb` kurar (public.events'e yazar);
-- migration 012 aynı imzayı `RETURNS uuid` ile yeniden tanımlamak ister →
-- `42P13: cannot change return type of existing function`.
-- ⚠️ PROD'DA AYNI İMZA VARDIR ama `RETURNS uuid`'dir (canlı, çalışan RPC).
-- Bu yüzden koşulsuz DROP YASAKTIR — yalnız dönüş tipi `jsonb` ise düşürülür.
DO $$
DECLARE
  v_oid oid := to_regprocedure('public.push_vehicle_event(text,text,jsonb)');
BEGIN
  IF v_oid IS NOT NULL
     AND (SELECT prorettype FROM pg_proc WHERE oid = v_oid) = 'jsonb'::regtype
  THEN
    DROP FUNCTION public.push_vehicle_event(text, text, jsonb);
    RAISE NOTICE '065-P1: eski push_vehicle_event(jsonb dönüşlü) düşürüldü';
  END IF;
END $$;

-- ── 4. SON DOĞRULAMA (fail-closed) ───────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='vehicles'
       AND column_name='owner_id' AND udt_name='uuid'
  ) THEN
    RAISE EXCEPTION '065-P1 DOĞRULAMA: vehicles.owner_id (uuid) kurulamadı';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='vehicles'
       AND column_name='api_key_hash' AND udt_name='text'
  ) THEN
    RAISE EXCEPTION '065-P1 DOĞRULAMA: vehicles.api_key_hash (text) kurulamadı';
  END IF;

  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public' AND p.proname='update_command_status') > 1 THEN
    RAISE EXCEPTION '065-P1 DOĞRULAMA: update_command_status hâlâ birden çok imzalı';
  END IF;

  RAISE NOTICE '065-P1 OK: prod baseline faz-1 hizalandı (owner_id · api_key_hash · aşırı-yükleme temizliği)';
END $$;

COMMIT;
