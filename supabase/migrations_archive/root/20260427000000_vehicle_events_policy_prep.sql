-- =====================================================================
-- DÜZELTİCİ 065-P2: vehicle_events POLİTİKA HAZIRLIĞI (012 için)
--
-- ── NEDEN (temiz Postgres'te ÖLÇÜLDÜ) ────────────────────────────────
-- `20260427000012_vehicle_events_rls_fix.sql` ilk işi olarak
-- `ALTER TABLE public.vehicle_events ALTER COLUMN vehicle_id TYPE uuid`
-- yapar. Ama `20260426_sentry_mode.sql` aynı kolona bağımlı İKİ politika
-- kurmuştur → PostgreSQL tip değişimini REDDEDER:
--     ERROR: cannot alter type of a column used in a policy definition
--     DETAIL: policy "Kendi araç olaylarını oku" ... depends on column "vehicle_id"
-- 012 politikaları kendisi düşürür ama SIRA YANLIŞTIR (DROP, ALTER'dan
-- SONRA gelir) → zincir bu noktada kırılır. 012 canlıya HİÇ uygulanmadığı
-- için bu kusur bugüne dek görünmemiştir.
--
-- ── PROD GERÇEĞİ (salt-okunur ölçüm) ─────────────────────────────────
-- Prod'da bu iki politika HÂLÂ YAŞIYOR ve `vehicle_events.vehicle_id`
-- HÂLÂ `text`. Yani prod 012'yi hiç almamıştır. Bu dosya prod'da
-- politikaları DÜŞÜRMEMELİDİR — aksi hâlde canlı erişim denetimi kalkardı.
-- Bu yüzden guard: yalnız 012'nin dünyasında (public.vehicle_users varken,
-- yani KÖK ZİNCİRDEN kurulmuş ortamda) ve kolon henüz `text` iken çalışır.
-- Prod'da `vehicle_users` YOKTUR → bu migration prod'da NO-OP'tur.
--
-- Politikalar `20260428000000_vehicle_events_text_restore.sql` tarafından
-- prod'daki tanımlarının BİREBİR AYNISIYLA geri kurulur.
-- =====================================================================

BEGIN;

DO $$
DECLARE
  v_udt text;
BEGIN
  SELECT udt_name INTO v_udt
    FROM information_schema.columns
   WHERE table_schema='public' AND table_name='vehicle_events' AND column_name='vehicle_id';

  IF v_udt IS NULL THEN
    RAISE EXCEPTION '065-P2 DURDU: public.vehicle_events.vehicle_id yok — yanlış şema';
  END IF;

  IF to_regclass('public.vehicle_users') IS NOT NULL AND v_udt <> 'uuid' THEN
    DROP POLICY IF EXISTS "Kendi araç olaylarını oku"  ON public.vehicle_events;
    DROP POLICY IF EXISTS "Kendi aracı için olay ekle" ON public.vehicle_events;
    RAISE NOTICE '065-P2: sentry politikaları geçici olarak kaldırıldı (012 tip değişimi için)';
  ELSE
    RAISE NOTICE '065-P2: NO-OP (prod/website tabanlı ortam — 012 dünyası değil)';
  END IF;
END $$;

COMMIT;
