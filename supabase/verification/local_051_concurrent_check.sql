-- ═══════════════════════════════════════════════════════════════════════════
-- 051 — EŞZAMANLI TTL KAPANIŞI · DENETİM
--
-- Tohumlamadan ve İKİ PARALEL `settle_expired_presence_history()`
-- çağrısından SONRA koşar. Kanıtlanan:
--
--   K1  hiçbir açık+süresi geçmiş segment KALMADI (iş bitti)
--   K2  kapanan her segment TUTARLI (yarım kapanış yok)
--   K3  kapanış anı UYDURULMADI (her segment kendi TTL'inde kapandı)
--   K4  hepsi TTL_EXPIRED ile kapandı (yarışta gerekçe karışmadı)
--
-- Paralel çağrıların DÖNDÜRDÜĞÜ sayıların toplamı kabuk tarafında
-- denetlenir: toplam, tohumlanan segment sayısını AŞMAMALIDIR — aşarsa
-- aynı segment iki kez kapatılmış (çift sayım) demektir.
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on
\pset pager off

DO $check$
DECLARE
  v_fail int := 0;
  v_open int; v_bad int; v_wrong int; v_reason int; v_total int;
BEGIN
  SELECT count(*) INTO v_total
    FROM public.vehicle_driver_presence_history h
    JOIN public.vehicles v ON v.id = h.vehicle_id
   WHERE v.plate LIKE 'P51C-%';

  SELECT count(*) INTO v_open
    FROM public.vehicle_driver_presence_history h
    JOIN public.vehicles v ON v.id = h.vehicle_id
   WHERE v.plate LIKE 'P51C-%' AND h.expired_at IS NULL;

  IF v_open = 0 AND v_total > 0 THEN
    RAISE NOTICE 'K1   % segmentin TAMAMI kapandi (acik kalan yok)           PASS', v_total;
  ELSE v_fail:=v_fail+1;
    RAISE WARNING 'K1   % segmentten % si hala acik FAIL', v_total, v_open; END IF;

  SELECT count(*) INTO v_bad
    FROM public.vehicle_driver_presence_history h
    JOIN public.vehicles v ON v.id = h.vehicle_id
   WHERE v.plate LIKE 'P51C-%'
     AND h.expired_at IS NOT NULL
     AND (h.duration_ms IS NULL OR h.close_reason IS NULL);

  IF v_bad = 0 THEN
    RAISE NOTICE 'K2   yarim kapanis YOK (sure+gerekce her satirda)          PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'K2   % yarim kapanis FAIL', v_bad; END IF;

  SELECT count(*) INTO v_wrong
    FROM public.vehicle_driver_presence_history h
    JOIN public.vehicles v ON v.id = h.vehicle_id
   WHERE v.plate LIKE 'P51C-%'
     AND (h.expired_at IS DISTINCT FROM h.expires_at
          OR h.duration_ms IS DISTINCT FROM
             public._presence_duration_ms(h.detected_at, h.expires_at));

  IF v_wrong = 0 THEN
    RAISE NOTICE 'K3   kapanis ani UYDURULMADI (her segment kendi TTL inde)  PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'K3   % segmentte uydurma kapanis FAIL', v_wrong; END IF;

  SELECT count(*) INTO v_reason
    FROM public.vehicle_driver_presence_history h
    JOIN public.vehicles v ON v.id = h.vehicle_id
   WHERE v.plate LIKE 'P51C-%' AND h.close_reason IS DISTINCT FROM 'TTL_EXPIRED';

  IF v_reason = 0 THEN
    RAISE NOTICE 'K4   hepsi TTL_EXPIRED ile kapandi (gerekce karismadi)     PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'K4   % segmentte yanlis gerekce FAIL', v_reason; END IF;

  IF v_fail = 0 THEN
    RAISE NOTICE '051 ESZAMANLI KAPANIS: TUM KONTROLLER GECTI';
  ELSE
    RAISE EXCEPTION '051 ESZAMANLI KAPANIS: % KONTROL DUSTU', v_fail;
  END IF;
END
$check$;

-- Temizlik.
DELETE FROM public.vehicle_driver_presence_history WHERE driver_id IN
  (SELECT id FROM public.fleet_drivers WHERE display_name LIKE 'P51C %');
DELETE FROM public.vehicle_driver_presence WHERE driver_id IN
  (SELECT id FROM public.fleet_drivers WHERE display_name LIKE 'P51C %');
DELETE FROM public.fleet_drivers WHERE display_name LIKE 'P51C %';
DELETE FROM public.vehicles WHERE plate LIKE 'P51C-%';
