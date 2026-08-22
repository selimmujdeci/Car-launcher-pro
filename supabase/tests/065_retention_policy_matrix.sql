-- ═══════════════════════════════════════════════════════════════════════════
-- 065  SAKLAMA POLİTİKASI MATRİSİ  (V-16/3)
--
--   npm run test:retention
--
-- ── NEDEN VAR ─────────────────────────────────────────────────────────────
-- Bir saklama politikasında iki ayrı hata sınıfı vardır ve NAİF BİR TEST
-- YALNIZ BİRİNİ görür:
--   ① ESKİ veri SİLİNMİYOR  → tablo sonsuz büyür (eski `vehicle_trips` durumu)
--   ② YENİ veri SİLİNİYOR   → müşteri verisi KAYBOLUR (çok daha kötüsü)
-- Bu yüzden her tabloda sınırın **İKİ TARAFI** da ölçülür: eşiğin hemen
-- dışındaki satır GİTMELİ, hemen içindeki satır KALMALI.
--
-- ── ÜRETİME DOKUNMAZ ──────────────────────────────────────────────────────
-- Yalnız YEREL veritabanında koşar ve `ROLLBACK` ile biter.
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on
\pset pager off

BEGIN;

CREATE TEMP TABLE ret_ids (k text PRIMARY KEY, v uuid);

DO $setup$
DECLARE c uuid; v uuid; api text;
BEGIN
  INSERT INTO public.companies (name) VALUES ('RET_TEST_CO') RETURNING id INTO c;
  api := 'ret_test_' || replace(gen_random_uuid()::text, '-', '');
  INSERT INTO public.vehicles (company_id, name, api_key)
  VALUES (c, 'RET_TEST_VEHICLE', api) RETURNING id INTO v;
  INSERT INTO ret_ids VALUES ('company', c), ('vehicle', v);
END
$setup$;

-- ═════════════════════════════════════════════════════════════════════════
-- HALKA 1 — POLİTİKA TABLOSU TEK OTORİTE
-- ═════════════════════════════════════════════════════════════════════════
DO $ring1$
DECLARE n integer; d integer;
BEGIN
  SELECT count(*) INTO n FROM public.retention_policy;
  IF n < 5 THEN
    RAISE EXCEPTION 'SAKLAMA HALKA 1 DUSTU -- politika tablosu eksik (% satir)', n;
  END IF;

  /* Vaadin kendisi: sürüş geçmişi 90 gün. */
  SELECT retain_days INTO d FROM public.retention_policy WHERE table_name = 'vehicle_trips';
  IF d IS DISTINCT FROM 90 THEN
    RAISE EXCEPTION 'SAKLAMA HALKA 1 DUSTU -- vehicle_trips % gun (Enterprise vaadi 90)', d;
  END IF;

  /* Politika satırı SİLİNSE bile fonksiyon sonsuz saklamaya DÜŞMEZ. */
  IF public._retention_days('boyle_bir_tablo_yok', 42) <> 42 THEN
    RAISE EXCEPTION 'SAKLAMA HALKA 1 DUSTU -- kayit yokken cagiranin varsayilani kullanilmiyor';
  END IF;
  RAISE NOTICE 'HALKA 1 gectI: politika tablosu tek otorite';
END
$ring1$;

-- ═════════════════════════════════════════════════════════════════════════
-- HALKA 2 — SINIRIN İKİ TARAFI (asıl kilit)
-- ═════════════════════════════════════════════════════════════════════════
DO $ring2$
DECLARE
  veh uuid; res jsonb;
  old_trip uuid; new_trip uuid;
  old_loc uuid;  new_loc uuid;
  n integer;
BEGIN
  SELECT v INTO veh FROM ret_ids WHERE k = 'vehicle';

  /* vehicle_trips: 90 gün → 100 gün önce BİTEN gitmeli, 10 gün önceki KALMALI. */
  INSERT INTO public.vehicle_trips (vehicle_id, trip_key, started_at, ended_at, distance_km)
  VALUES (veh, 'ret_old', now() - interval '101 days', now() - interval '100 days', 10)
  RETURNING id INTO old_trip;
  INSERT INTO public.vehicle_trips (vehicle_id, trip_key, started_at, ended_at, distance_km)
  VALUES (veh, 'ret_new', now() - interval '11 days', now() - interval '10 days', 12)
  RETURNING id INTO new_trip;

  /* SÜREN yolculuk (ended_at NULL) ESKİ başlamış olsa bile DOKUNULMAMALI. */
  INSERT INTO public.vehicle_trips (vehicle_id, trip_key, started_at, ended_at, distance_km)
  VALUES (veh, 'ret_running', now() - interval '200 days', NULL, 5);

  /* vehicle_locations: 30 gün → 40 gün önceki gitmeli, 5 gün önceki KALMALI. */
  INSERT INTO public.vehicle_locations (vehicle_id, lat, lng, created_at)
  VALUES (veh, 39.9, 32.8, now() - interval '40 days') RETURNING id INTO old_loc;
  INSERT INTO public.vehicle_locations (vehicle_id, lat, lng, created_at)
  VALUES (veh, 39.9, 32.8, now() - interval '5 days') RETURNING id INTO new_loc;

  res := public.cleanup_old_telemetry();
  RAISE NOTICE 'temizlik sonucu: %', res;

  /* ① ESKİ GİTTİ Mİ */
  SELECT count(*) INTO n FROM public.vehicle_trips WHERE id = old_trip;
  IF n <> 0 THEN
    RAISE EXCEPTION 'SAKLAMA HALKA 2 DUSTU -- 100 gunluk yolculuk SILINMEDI (sonsuz buyume)';
  END IF;
  SELECT count(*) INTO n FROM public.vehicle_locations WHERE id = old_loc;
  IF n <> 0 THEN
    RAISE EXCEPTION 'SAKLAMA HALKA 2 DUSTU -- 40 gunluk konum SILINMEDI';
  END IF;

  /* ② YENİ KALDI MI — bu, veri kaybı kilidi; daha kritik olan bu. */
  SELECT count(*) INTO n FROM public.vehicle_trips WHERE id = new_trip;
  IF n <> 1 THEN
    RAISE EXCEPTION 'SAKLAMA HALKA 2 DUSTU -- 10 gunluk yolculuk SILINDI (VERI KAYBI)';
  END IF;
  SELECT count(*) INTO n FROM public.vehicle_locations WHERE id = new_loc;
  IF n <> 1 THEN
    RAISE EXCEPTION 'SAKLAMA HALKA 2 DUSTU -- 5 gunluk konum SILINDI (VERI KAYBI)';
  END IF;

  /* ③ SÜREN yolculuk korunmalı */
  SELECT count(*) INTO n FROM public.vehicle_trips
   WHERE vehicle_id = veh AND ended_at IS NULL;
  IF n <> 1 THEN
    RAISE EXCEPTION 'SAKLAMA HALKA 2 DUSTU -- SUREN yolculuk silindi (aktif seyahat kayboldu)';
  END IF;

  RAISE NOTICE 'HALKA 2 gectI: esik disi silindi, esik ici KORUNDU, suren yolculuk dokunulmadi';
END
$ring2$;

-- ═════════════════════════════════════════════════════════════════════════
-- HALKA 3 — POLİTİKA GERÇEKTEN ETKİLİ Mİ (tablo tiyatro değil)
-- ═════════════════════════════════════════════════════════════════════════
DO $ring3$
DECLARE veh uuid; t uuid; n integer;
BEGIN
  SELECT v INTO veh FROM ret_ids WHERE k = 'vehicle';

  INSERT INTO public.vehicle_trips (vehicle_id, trip_key, started_at, ended_at, distance_km)
  VALUES (veh, 'ret_policy_probe', now() - interval '21 days', now() - interval '20 days', 7)
  RETURNING id INTO t;

  /* 90 gün politikasıyla 20 günlük yolculuk KALMALI. */
  PERFORM public.cleanup_old_telemetry();
  SELECT count(*) INTO n FROM public.vehicle_trips WHERE id = t;
  IF n <> 1 THEN
    RAISE EXCEPTION 'SAKLAMA HALKA 3 DUSTU -- 20 gunluk yolculuk 90 gun politikasiyla silindi';
  END IF;

  /* Politika 7 güne çekilince AYNI satır gitmeli — süreler gerçekten
     tablodan okunuyor demektir, gövdeye gömülü DEĞİL. */
  UPDATE public.retention_policy SET retain_days = 7 WHERE table_name = 'vehicle_trips';
  PERFORM public.cleanup_old_telemetry();
  SELECT count(*) INTO n FROM public.vehicle_trips WHERE id = t;
  IF n <> 0 THEN
    RAISE EXCEPTION
      'SAKLAMA HALKA 3 DUSTU -- politika 7 gune cekildi ama 20 gunluk yolculuk DURUYOR. '
      'Sureler tablodan OKUNMUYOR; tablo TIYATRO demektir.';
  END IF;

  RAISE NOTICE 'HALKA 3 gectI: sureler gercekten politika tablosundan okunuyor';
END
$ring3$;

-- ═════════════════════════════════════════════════════════════════════════
-- HALKA 4 — ERİŞİM FAIL-CLOSED
-- ═════════════════════════════════════════════════════════════════════════
DO $ring4$
DECLARE n integer;
BEGIN
  IF has_table_privilege('anon', 'public.retention_policy', 'SELECT')
     OR has_table_privilege('authenticated', 'public.retention_policy', 'SELECT') THEN
    RAISE EXCEPTION 'SAKLAMA HALKA 4 DUSTU -- politika tablosu anon/authenticated tarafindan OKUNABILIYOR';
  END IF;

  IF has_function_privilege('anon', 'public.cleanup_old_telemetry()', 'EXECUTE') THEN
    RAISE EXCEPTION 'SAKLAMA HALKA 4 DUSTU -- anon TEMIZLIGI CALISTIRABILIYOR (veri silme yetkisi!)';
  END IF;

  SELECT count(*) INTO n FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'public' AND c.relname = 'retention_policy' AND c.relrowsecurity;
  IF n <> 1 THEN
    RAISE EXCEPTION 'SAKLAMA HALKA 4 DUSTU -- RLS kapali';
  END IF;

  RAISE NOTICE 'HALKA 4 gectI: erisim fail-closed';
END
$ring4$;

DO $done$ BEGIN RAISE NOTICE 'SAKLAMA POLITIKASI: 4 HALKA DA GECTI.'; END $done$;

ROLLBACK;
