-- =====================================================================
-- DÜZELTİCİ 065-P3: vehicle_events — PROD'UN GERÇEK HALİNİ GERİ KUR
--
-- ── NEDEN (salt-okunur prod ölçümü + kendi migration'ımızın itirafı) ──
-- `20260427000012_vehicle_events_rls_fix.sql` `vehicle_id`'yi `text → uuid`
-- çevirir, FK ekler ve politikaları `vehicle_users` üzerinden yeniden yazar.
-- Bu migration CANLIYA HİÇ UYGULANMADI. Prod'da ölçülen gerçek:
--     · vehicle_events.vehicle_id  = text     (uuid DEĞİL)
--     · fk_vehicle_events_vehicle  = YOK
--     · politikalar                = sentry_mode'un iki politikası (owner_id yolu)
--     · public.vehicle_users tablosu = YOK
--
-- Bu sapma zaten 2026-07-06'da ölçülmüş ve `20260706000026_fix_push_vehicle_
-- event_text_vehicle_id.sql` başlığında yazılmıştır: *"Canlı public.
-- vehicle_events.vehicle_id kolonu TEXT (elle kurulmuş şema)"*. O migration
-- RPC'yi `v_vehicle_id::text` ile TEXT kolona göre düzeltir.
--
-- ── KUSURUN ÜRÜN SONUCU (düzeltilmezse) ──────────────────────────────
-- Zincir sıfırdan kurulan YENİ bir ortamda `vehicle_id` uuid olurdu; ama
-- 025/026 RPC'leri `::text` ile yazıyor → `push_vehicle_event` ÇALIŞMA
-- ANINDA patlar (text → uuid atama cast'i yok) ve tanı/olay akışı ölür.
-- Yani prod ile yeni ortam SESSİZCE ayrışırdı. Otorite prod'dur.
--
-- ── BU DOSYA NE YAPAR ────────────────────────────────────────────────
-- 012'nin etkisini prod'un gerçek durumuna geri alır: FK kaldır, kolonu
-- `text`e döndür, 012'nin politikalarını kaldır, sentry politikalarını
-- prod'daki tanımlarının BİREBİR AYNISIYLA kur.
--
-- ── GARANTİLER ───────────────────────────────────────────────────────
--   · PROD'DA NO-OP — her adım "zaten hedef durumda mı" diye ölçer.
--   · VERİ KAYBI YOK — uuid → text dönüşümü kayıpsızdır (metin gösterimi).
--   · Mevcut migration'ların hiçbiri değiştirilmemiştir.
-- =====================================================================

BEGIN;

ALTER TABLE public.vehicle_events DROP CONSTRAINT IF EXISTS fk_vehicle_events_vehicle;
DROP POLICY IF EXISTS "user_select_vehicle_events" ON public.vehicle_events;
DROP POLICY IF EXISTS "user_insert_vehicle_events" ON public.vehicle_events;

DO $$
DECLARE
  v_udt text;
BEGIN
  SELECT udt_name INTO v_udt
    FROM information_schema.columns
   WHERE table_schema='public' AND table_name='vehicle_events' AND column_name='vehicle_id';

  IF v_udt IS NULL THEN
    RAISE EXCEPTION '065-P3 DURDU: public.vehicle_events.vehicle_id yok — yanlış şema';
  END IF;

  IF v_udt <> 'text' THEN
    ALTER TABLE public.vehicle_events
      ALTER COLUMN vehicle_id TYPE text USING vehicle_id::text;
    RAISE NOTICE '065-P3: vehicle_events.vehicle_id % → text (prod ile hizalandı)', v_udt;
  END IF;
END $$;

-- Prod'daki iki politikanın BİREBİR tanımı (pg_policies'ten okundu).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname='public' AND tablename='vehicle_events'
                    AND policyname='Kendi araç olaylarını oku') THEN
    CREATE POLICY "Kendi araç olaylarını oku"
      ON public.vehicle_events FOR SELECT TO authenticated
      USING (vehicle_id IN (SELECT v.id::text FROM public.vehicles v WHERE v.owner_id = auth.uid()));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname='public' AND tablename='vehicle_events'
                    AND policyname='Kendi aracı için olay ekle') THEN
    CREATE POLICY "Kendi aracı için olay ekle"
      ON public.vehicle_events FOR INSERT TO authenticated
      WITH CHECK (vehicle_id IN (SELECT v.id::text FROM public.vehicles v WHERE v.owner_id = auth.uid()));
  END IF;
END $$;

-- ── SON DOĞRULAMA (fail-closed) ──────────────────────────────────────
DO $$
DECLARE
  v_pol int;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='vehicle_events'
       AND column_name='vehicle_id' AND udt_name='text'
  ) THEN
    RAISE EXCEPTION '065-P3 DOĞRULAMA: vehicle_id text DEĞİL';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_vehicle_events_vehicle') THEN
    RAISE EXCEPTION '065-P3 DOĞRULAMA: fk_vehicle_events_vehicle hâlâ duruyor';
  END IF;

  SELECT count(*) INTO v_pol FROM pg_policies
   WHERE schemaname='public' AND tablename='vehicle_events'
     AND policyname IN ('Kendi araç olaylarını oku','Kendi aracı için olay ekle');
  IF v_pol <> 2 THEN
    RAISE EXCEPTION '065-P3 DOĞRULAMA: sentry politikaları eksik (bulunan=%)', v_pol;
  END IF;

  RAISE NOTICE '065-P3 OK: vehicle_events prod gerçeğine geri hizalandı (text · FK yok · sentry politikaları)';
END $$;

COMMIT;
