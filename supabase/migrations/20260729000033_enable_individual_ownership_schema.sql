-- =====================================================================
-- Migration 033 (PRE-MIGRATION): BİREYSEL SAHİPLİK İÇİN ŞEMA HAZIRLIĞI
--
-- ── NEDEN (salt-okunur canlı envanterle KANITLANDI) ───────────────────
-- Canlı Supabase (`Carospro`) şemasında iki kolon `NOT NULL`:
--     public.profiles.company_id
--     public.vehicle_locations.company_id
-- Repo migration zinciri (`website/supabase/migrations/001_init.sql`) bu
-- kolonları NULLABLE tanımlar → canlı şema repo'dan SAPMIŞ (out-of-band
-- değişiklik). Migration 034 (bireysel sahiplik + GPS) nullable modele
-- dayanır; bu sapma giderilmeden 034 canlıda ÇALIŞMA ANINDA patlar:
--   · bireysel araç konumu `company_id = NULL` ile yazılamaz (NOT NULL ihlali)
--   · bireysel kullanıcı (`profiles.company_id IS NULL`) hiç var olamaz
--
-- ── KAPSAM: YALNIZ İKİ NOT NULL KISITI ───────────────────────────────
-- Bu migration BİLİNÇLİ olarak ŞUNLARI YAPMAZ:
--   · veri backfill YOK · otomatik şirket oluşturma YOK
--   · mevcut `company_id` DEĞERLERİNE dokunma YOK
--   · FK / index / tip değişikliği YOK
--   · policy / grant / sahiplik politikası yeniden yazımı YOK
-- Sahiplik ve erişim kararları 034'ün ve mevcut RLS'in işidir.
--
-- ── ÜÇ DEĞERLİ MANTIK GÜVENLİK NOTU (kritik) ─────────────────────────
-- `auth_company_id()` bireysel kullanıcıda NULL döner. Mevcut şirket
-- izolasyon politikaları `company_id = auth_company_id()` biçimindedir ve
-- SQL'de `NULL = NULL` → NULL (TRUE DEĞİL). Yani `company_id` NULL olan
-- satırlar şirket politikalarından HİÇ KİMSEYE görünmez; erişim yalnız
-- owner/paired politikalarından gelir. Nullability'yi kaldırmak bu yüzden
-- cross-tenant görünürlük AÇMAZ (kilit testleriyle doğrulandı).
--
-- İDEMPOTENT: `DROP NOT NULL` zaten nullable kolonda no-op'tur.
-- GERİ ALMA: `docs/db/ROLLBACK_20260729_individual_ownership.md`
-- =====================================================================

-- ── 1. ÖN DOĞRULAMA (fail-closed) ─────────────────────────────────────
DO $$
DECLARE
  r record;
  v_expected text[] := ARRAY['profiles.company_id', 'vehicle_locations.company_id'];
  v_seen     text[] := '{}';
BEGIN
  FOR r IN
    SELECT table_name, column_name, data_type, udt_name, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (table_name, column_name) IN (('profiles','company_id'), ('vehicle_locations','company_id'))
  LOOP
    -- Beklenmeyen TİP → DUR. Kolon uuid değilse bu migration yanlış şemadadır.
    IF r.udt_name <> 'uuid' THEN
      RAISE EXCEPTION '033 ÖN KONTROL: %.% tipi uuid DEĞİL (%) — fail-closed',
        r.table_name, r.column_name, r.udt_name;
    END IF;
    v_seen := v_seen || (r.table_name || '.' || r.column_name);
    RAISE NOTICE '033 ÖNCE: %.% is_nullable=%', r.table_name, r.column_name, r.is_nullable;
  END LOOP;

  -- Kolonlardan biri YOKSA → DUR (yanlış veritabanı / eksik zincir).
  IF NOT (v_seen @> v_expected) THEN
    RAISE EXCEPTION '033 ÖN KONTROL: beklenen kolonlar eksik. Bulunan: %', v_seen;
  END IF;
END $$;

-- ── 2. TEK DEĞİŞİKLİK: NOT NULL kısıtını kaldır ───────────────────────
-- Veri YAZILMAZ, tip DEĞİŞMEZ, FK ve index KORUNUR (ALTER ... DROP NOT NULL
-- yalnız katalogdaki attnotnull bayrağını düşürür; tablo yeniden yazılmaz).
ALTER TABLE public.profiles          ALTER COLUMN company_id DROP NOT NULL;
ALTER TABLE public.vehicle_locations ALTER COLUMN company_id DROP NOT NULL;

-- ── 3. SON DOĞRULAMA (fail-closed) ────────────────────────────────────
DO $$
DECLARE
  v_prof_null   text;
  v_loc_null    text;
  v_prof_fk     integer;
  v_loc_fk      integer;
  v_prof_idx    integer;
  v_loc_idx     integer;
BEGIN
  SELECT is_nullable INTO v_prof_null FROM information_schema.columns
   WHERE table_schema='public' AND table_name='profiles' AND column_name='company_id';
  SELECT is_nullable INTO v_loc_null FROM information_schema.columns
   WHERE table_schema='public' AND table_name='vehicle_locations' AND column_name='company_id';

  IF v_prof_null <> 'YES' OR v_loc_null <> 'YES' THEN
    RAISE EXCEPTION '033 SON KONTROL: nullability uygulanmadı (profiles=%, vehicle_locations=%)',
      v_prof_null, v_loc_null;
  END IF;

  -- FK'ler KORUNMALI (tenant bütünlüğü bu migration'da gevşetilmez)
  SELECT count(*) INTO v_prof_fk FROM pg_constraint
   WHERE conrelid = 'public.profiles'::regclass AND contype = 'f'
     AND conname = 'profiles_company_id_fkey';
  SELECT count(*) INTO v_loc_fk FROM pg_constraint
   WHERE conrelid = 'public.vehicle_locations'::regclass AND contype = 'f'
     AND conname = 'vehicle_locations_company_id_fkey';
  IF v_prof_fk < 1 OR v_loc_fk < 1 THEN
    RAISE EXCEPTION '033 SON KONTROL: company_id FK kayboldu (profiles=%, locations=%)',
      v_prof_fk, v_loc_fk;
  END IF;

  -- company_id index'leri KORUNMALI (sorgu planı regresyonu olmasın)
  SELECT count(*) INTO v_prof_idx FROM pg_indexes
   WHERE schemaname='public' AND tablename='profiles' AND indexdef LIKE '%company_id%';
  SELECT count(*) INTO v_loc_idx FROM pg_indexes
   WHERE schemaname='public' AND tablename='vehicle_locations' AND indexdef LIKE '%company_id%';
  IF v_prof_idx < 1 OR v_loc_idx < 1 THEN
    RAISE EXCEPTION '033 SON KONTROL: company_id index kayboldu (profiles=%, locations=%)',
      v_prof_idx, v_loc_idx;
  END IF;

  RAISE NOTICE '033 SONRA: profiles.company_id nullable=% · vehicle_locations.company_id nullable=% · FK ve index korundu',
    v_prof_null, v_loc_null;
END $$;

-- Elle doğrulama sorguları (uygulama sonrası):
--   SELECT table_name, column_name, is_nullable, udt_name
--     FROM information_schema.columns
--    WHERE table_schema='public'
--      AND (table_name, column_name) IN (('profiles','company_id'),('vehicle_locations','company_id'));
--   SELECT count(*) FILTER (WHERE company_id IS NULL) AS null_sayisi, count(*) AS toplam FROM public.profiles;
--   SELECT count(*) FILTER (WHERE company_id IS NULL) AS null_sayisi, count(*) AS toplam FROM public.vehicle_locations;
