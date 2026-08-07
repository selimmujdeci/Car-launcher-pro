-- ═══════════════════════════════════════════════════════════════════════════
-- 051 — EŞZAMANLI TTL KAPANIŞI · TOHUMLAMA
--
-- `local_051_presence_durability_p2.sql` tek oturumda koşar ve yarışı
-- DETERMİNİSTİK olarak yeniden üretir. Bu dosya ise GERÇEK eşzamanlılık
-- içindir: N ayrı araçta N açık + süresi geçmiş segment açar, sonra iki
-- ayrı psql süreci aynı anda `settle_expired_presence_history()` çağırır
-- (bkz. `local_051_concurrent_check.sql`).
--
-- NEDEN N ARAÇ: `vdph_single_open_per_vehicle` kısmi unique index bir
-- araçta yalnız TEK açık segmente izin verir — eşzamanlılık ölçmek için
-- açık segmentlerin FARKLI araçlarda olması ZORUNLUDUR.
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on
\pset pager off

-- Önceki koşumun artıkları.
DELETE FROM public.vehicle_driver_presence_history WHERE driver_id IN
  (SELECT id FROM public.fleet_drivers WHERE display_name LIKE 'P51C %');
DELETE FROM public.vehicle_driver_presence WHERE driver_id IN
  (SELECT id FROM public.fleet_drivers WHERE display_name LIKE 'P51C %');
DELETE FROM public.fleet_drivers WHERE display_name LIKE 'P51C %';
DELETE FROM public.vehicles WHERE plate LIKE 'P51C-%';

/* Başlangıç durumu NORMALİZE edilir: başka testlerden kalan açık+süresi
   geçmiş segment varsa kapatılır, böylece paralel koşumun döndürdüğü
   sayılar YALNIZ bu tohumun segmentlerini sayar (ölçüm kirlenmez). */
SELECT public.settle_expired_presence_history() AS pre_settled;

DO $seed$
DECLARE
  A_CO  uuid := 'f1eef1ee-0000-0000-0000-000000000001';
  A_ADM uuid := '1178d9db-413d-4f60-97c5-97bfc8393618';
  r     jsonb;
  d     uuid;
  v_id  uuid;
  N     int := 12;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', A_ADM)::text, true);
  r := public.create_fleet_driver('P51C Yaris', 'P51C-1'); d := (r->>'driverId')::uuid;

  FOR i IN 1..N LOOP
    v_id := gen_random_uuid();
    INSERT INTO public.vehicles (id, name, company_id, api_key, plate)
    VALUES (v_id, 'P51C Arac ' || i, A_CO, 'p51c-key-' || i, 'P51C-' || i);

    /* Süresi ZATEN geçmiş gözlem → açık ama ölmüş segment (bakım fonksiyonu
       tam olarak bunları kapatır). */
    INSERT INTO public.vehicle_driver_presence
      (company_id, vehicle_id, driver_id, source, confidence, detected_at, expires_at)
    VALUES (A_CO, v_id, d, 'NFC', 'VERY_HIGH',
            now() - interval '10 hours', now() - interval '2 hours');
  END LOOP;

  RAISE NOTICE 'SEED: % arac icin acik+suresi gecmis segment olusturuldu', N;
END
$seed$;

SELECT count(*) AS open_expired_seeded
  FROM public.vehicle_driver_presence_history
 WHERE expired_at IS NULL AND expires_at <= now();
