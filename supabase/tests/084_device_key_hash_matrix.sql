-- ═══════════════════════════════════════════════════════════════════════════
-- 084  CİHAZ ANAHTARI AT-REST HASH MATRİSİ  (MRI Wave 3 · F-06/K)
--
--   npm run test:devicekey
--
-- GERÇEK DAVRANIŞ: RPC'ler gerçekten çağrılır; saklanan hash'in credential
-- olmadığı ÖLÇÜLÜR.
--
--   HALKA 1  register_vehicle: ham anahtar BİR KEZ döner; saklanan = sha256(ham)
--   HALKA 2  ham anahtar → push_vehicle_event / fetch_pending / update_command_status /
--            register_vehicle_push_token / upload_vehicle_trip / increment_command_retry ÇALIŞIR
--   HALKA 3  saklanan hash'i anahtar gibi göndermek → HER RPC'de DENY (pass-the-hash yok)
--   HALKA 4  başka aracın ham anahtarı → başka araca yazamaz; boş/bozuk anahtar → DENY
--   HALKA 5  düz metin saklanmış (migrasyon dışı kalmış) anahtar ARTIK KABUL EDİLMEZ
--            (düz dal yok) — 084'ün veri adımı bu yüzden zorunludur
--   HALKA 6  yedek kolon ve hash istemciye kapalı; pair_vehicle(text) hiçbir role açık değil
--
-- Yalnız YEREL veritabanında koşar ve `ROLLBACK` ile biter.
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on
\pset pager off

BEGIN;

CREATE TEMP TABLE ek (k text PRIMARY KEY, v text);

CREATE OR REPLACE FUNCTION pg_temp.try(p_sql text) RETURNS text LANGUAGE plpgsql AS $h$
DECLARE r text;
BEGIN
  BEGIN EXECUTE p_sql INTO r;
  EXCEPTION WHEN OTHERS THEN r := 'ERR:' || SQLSTATE || ':' || left(SQLERRM, 100); END;
  RETURN r;
END $h$;

-- ═════════════════════════════════════════════════════════════════════════
-- HALKA 1 — register_vehicle HASH SAKLAR
-- ═════════════════════════════════════════════════════════════════════════
DO $ring1$
DECLARE j jsonb; raw text; vid uuid; stored text; raw2 text; vid2 uuid;
BEGIN
  j := public.register_vehicle('dev-084-A', 'ARAC_084_A');
  raw := j->>'api_key'; vid := (j->>'vehicle_id')::uuid;
  IF raw IS NULL OR vid IS NULL THEN RAISE EXCEPTION 'HALKA 1 DÜŞTÜ: ilk kayıt anahtar/araç döndürmedi: %', j; END IF;
  SELECT api_key_hash INTO stored FROM public.vehicles WHERE id = vid;
  IF stored = raw THEN RAISE EXCEPTION 'HALKA 1 DÜŞTÜ: anahtar DÜZ saklandı'; END IF;
  IF stored <> encode(sha256(convert_to(raw,'UTF8')),'hex') THEN RAISE EXCEPTION 'HALKA 1 DÜŞTÜ: saklanan ≠ sha256(ham)'; END IF;
  -- ikinci çağrı (mevcut cihaz) anahtar DÖNDÜRMEZ (072)
  j := public.register_vehicle('dev-084-A', 'ARAC_084_A');
  IF j ? 'api_key' THEN RAISE EXCEPTION 'HALKA 1 DÜŞTÜ: mevcut cihaza anahtar tekrar döndü'; END IF;

  j := public.register_vehicle('dev-084-B', 'ARAC_084_B');
  raw2 := j->>'api_key'; vid2 := (j->>'vehicle_id')::uuid;
  INSERT INTO ek VALUES ('raw', raw), ('vid', vid::text), ('stored', stored), ('raw2', raw2), ('vid2', vid2::text);
  RAISE NOTICE 'HALKA 1 GEÇTİ — register_vehicle sha256 saklıyor, ham anahtar bir kez dönüyor';
END
$ring1$;

-- ═════════════════════════════════════════════════════════════════════════
-- HALKA 2 — HAM ANAHTAR HER CİHAZ RPC'SİNDE ÇALIŞIR
-- ═════════════════════════════════════════════════════════════════════════
DO $ring2$
DECLARE raw text; vid uuid; ev uuid; cid uuid; r text; j jsonb; n int;
BEGIN
  SELECT v INTO raw FROM ek WHERE k='raw'; SELECT v::uuid INTO vid FROM ek WHERE k='vid';

  ev := public.push_vehicle_event(raw, 'heartbeat', jsonb_build_object('lat', 41.0, 'lng', 29.0, 'source', 'HEAD_UNIT_GPS'));
  IF ev IS NULL THEN RAISE EXCEPTION 'HALKA 2 DÜŞTÜ: push_vehicle_event ham anahtarla çalışmadı'; END IF;

  INSERT INTO public.vehicle_commands (vehicle_id, type, payload, nonce, ttl) VALUES (vid, 'horn', '{}', 'n084', now() + interval '5 min') RETURNING id INTO cid;
  SELECT count(*) INTO n FROM public.fetch_pending_vehicle_commands(raw, 3, 10);
  IF n < 1 THEN RAISE EXCEPTION 'HALKA 2 DÜŞTÜ: fetch_pending ham anahtarla komut görmedi'; END IF;

  PERFORM public.update_command_status(raw, cid, 'accepted', now(), NULL, NULL, NULL, NULL);
  IF (SELECT status FROM public.vehicle_commands WHERE id = cid) <> 'accepted' THEN
    RAISE EXCEPTION 'HALKA 2 DÜŞTÜ: update_command_status ham anahtarla yazmadı';
  END IF;

  PERFORM public.increment_command_retry(raw, cid, 'x');
  IF (SELECT retry_count FROM public.vehicle_commands WHERE id = cid) <> 1 THEN
    RAISE EXCEPTION 'HALKA 2 DÜŞTÜ: increment_command_retry ham anahtarla ilerlemedi';
  END IF;

  j := public.register_vehicle_push_token(raw, 'fcm-token-084-' || gen_random_uuid()::text, 'android');
  IF (j->>'ok') <> 'true' THEN RAISE EXCEPTION 'HALKA 2 DÜŞTÜ: register_vehicle_push_token ham anahtarla: %', j; END IF;

  r := pg_temp.try(format($q$SELECT public.upload_vehicle_trip(%L, 'trip-084', NULL, 1, %s, %s, '{}'::jsonb, NULL, NULL, '{}'::jsonb, '[]'::jsonb, '{}'::jsonb, NULL, NULL, 1, NULL)::text$q$,
                 raw, (extract(epoch from now())*1000)::bigint - 600000, (extract(epoch from now())*1000)::bigint));
  IF r LIKE 'ERR:P0001:invalid_api_key%' THEN RAISE EXCEPTION 'HALKA 2 DÜŞTÜ: upload_vehicle_trip ham anahtarı tanımadı (074 hash dalı yok)'; END IF;

  RAISE NOTICE 'HALKA 2 GEÇTİ — ham anahtar 6 cihaz RPC-sinde çalışıyor';
END
$ring2$;

-- ═════════════════════════════════════════════════════════════════════════
-- HALKA 3 — SAKLANAN HASH ≠ CREDENTIAL
-- ═════════════════════════════════════════════════════════════════════════
DO $ring3$
DECLARE stored text; vid uuid; cid uuid; r text;
BEGIN
  SELECT v INTO stored FROM ek WHERE k='stored'; SELECT v::uuid INTO vid FROM ek WHERE k='vid';
  SELECT id INTO cid FROM public.vehicle_commands WHERE vehicle_id = vid LIMIT 1;

  r := pg_temp.try(format($q$SELECT public.push_vehicle_event(%L, 'heartbeat', '{}'::jsonb)::text$q$, stored));
  IF r NOT LIKE 'ERR:P0001%' THEN RAISE EXCEPTION 'HALKA 3 DÜŞTÜ: hash push_vehicle_event-te geçti: %', r; END IF;
  r := pg_temp.try(format($q$SELECT count(*)::text FROM public.fetch_pending_vehicle_commands(%L, 3, 10)$q$, stored));
  IF r NOT LIKE 'ERR:%' THEN RAISE EXCEPTION 'HALKA 3 DÜŞTÜ: hash fetch_pending-de geçti: %', r; END IF;
  r := pg_temp.try(format($q$SELECT public.update_command_status(%L, %L::uuid, 'completed', NULL, NULL, now(), NULL, NULL)::text$q$, stored, cid));
  IF (SELECT status FROM public.vehicle_commands WHERE id = cid) = 'completed' THEN RAISE EXCEPTION 'HALKA 3 DÜŞTÜ: hash komut durumunu yazdı'; END IF;
  r := pg_temp.try(format($q$SELECT public.register_vehicle_push_token(%L, 'fcm-x', 'android')::text$q$, stored));
  IF r NOT LIKE 'ERR:P0001%' THEN RAISE EXCEPTION 'HALKA 3 DÜŞTÜ: hash push token kaydetti: %', r; END IF;
  r := pg_temp.try(format($q$SELECT public.increment_command_retry(%L, %L::uuid, 'x')::text$q$, stored, cid));
  IF r NOT LIKE 'ERR:P0001%' THEN RAISE EXCEPTION 'HALKA 3 DÜŞTÜ: hash retry ilerletti: %', r; END IF;
  r := pg_temp.try(format($q$SELECT public.refresh_linking_code(%L)::text$q$, stored));
  IF r NOT LIKE 'ERR:%' AND r NOT LIKE '%false%' THEN RAISE EXCEPTION 'HALKA 3 DÜŞTÜ: hash linking code üretti: %', r; END IF;

  RAISE NOTICE 'HALKA 3 GEÇTİ — saklanan hash hiçbir RPC-de anahtar yerine geçmiyor';
END
$ring3$;

-- ═════════════════════════════════════════════════════════════════════════
-- HALKA 4 — BAŞKA ARACIN ANAHTARI · BOŞ/BOZUK
-- ═════════════════════════════════════════════════════════════════════════
DO $ring4$
DECLARE raw2 text; vid uuid; cid uuid; r text;
BEGIN
  SELECT v INTO raw2 FROM ek WHERE k='raw2'; SELECT v::uuid INTO vid FROM ek WHERE k='vid';
  SELECT id INTO cid FROM public.vehicle_commands WHERE vehicle_id = vid LIMIT 1;

  r := pg_temp.try(format($q$SELECT public.update_command_status(%L, %L::uuid, 'completed', NULL, NULL, now(), NULL, NULL)::text$q$, raw2, cid));
  IF (SELECT status FROM public.vehicle_commands WHERE id = cid) = 'completed' THEN RAISE EXCEPTION 'HALKA 4 DÜŞTÜ: B anahtarı A komutunu yazdı'; END IF;
  r := pg_temp.try(format($q$SELECT count(*)::text FROM public.fetch_pending_vehicle_commands(%L, 3, 10)$q$, raw2));
  IF r <> '0' THEN RAISE EXCEPTION 'HALKA 4 DÜŞTÜ: B anahtarı A komutlarını gördü: %', r; END IF;

  FOREACH r IN ARRAY ARRAY['', '   ', 'not-a-key', '00000000-0000-0000-0000-000000000000'] LOOP
    IF pg_temp.try(format($q$SELECT public.push_vehicle_event(%L, 'heartbeat', '{}'::jsonb)::text$q$, r)) NOT LIKE 'ERR:%' THEN
      RAISE EXCEPTION 'HALKA 4 DÜŞTÜ: bozuk anahtar [%] kabul edildi', r;
    END IF;
  END LOOP;
  IF pg_temp.try($q$SELECT public.push_vehicle_event(NULL, 'heartbeat', '{}'::jsonb)::text$q$) NOT LIKE 'ERR:%' THEN
    RAISE EXCEPTION 'HALKA 4 DÜŞTÜ: NULL anahtar kabul edildi';
  END IF;
  RAISE NOTICE 'HALKA 4 GEÇTİ — yabancı/boş/bozuk anahtar reddediliyor';
END
$ring4$;

-- ═════════════════════════════════════════════════════════════════════════
-- HALKA 5 — DÜZ METİN SAKLAMA ÖLÜ
-- ═════════════════════════════════════════════════════════════════════════
DO $ring5$
DECLARE plain text := gen_random_uuid()::text; vid uuid; r text;
BEGIN
  INSERT INTO public.vehicles (name, api_key_hash) VALUES ('LEGACY_PLAIN_084', plain) RETURNING id INTO vid;
  r := pg_temp.try(format($q$SELECT public.push_vehicle_event(%L, 'heartbeat', '{}'::jsonb)::text$q$, plain));
  IF r NOT LIKE 'ERR:P0001%' THEN RAISE EXCEPTION 'HALKA 5 DÜŞTÜ: düz saklanmış anahtar hâlâ eşleşiyor (düz dal duruyor): %', r; END IF;
  RAISE NOTICE 'HALKA 5 GEÇTİ — düz dal yok; 084 veri adımı olmadan düz satır çalışmaz (bilinçli)';
END
$ring5$;

-- ═════════════════════════════════════════════════════════════════════════
-- HALKA 6 — YÜZEY
-- ═════════════════════════════════════════════════════════════════════════
DO $ring6$
BEGIN
  IF has_column_privilege('authenticated', 'public.vehicles', 'api_key_plain_backup', 'SELECT')
     OR has_column_privilege('authenticated', 'public.vehicles', 'api_key_hash', 'SELECT')
     OR has_column_privilege('anon', 'public.vehicles', 'api_key_plain_backup', 'SELECT') THEN
    RAISE EXCEPTION 'HALKA 6 DÜŞTÜ: anahtar/yedek kolonu istemciye açık';
  END IF;
  IF to_regprocedure('public.pair_vehicle(text)') IS NOT NULL AND (
       has_function_privilege('anon', 'public.pair_vehicle(text)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.pair_vehicle(text)', 'EXECUTE')
    OR has_function_privilege('service_role', 'public.pair_vehicle(text)', 'EXECUTE')) THEN
    RAISE EXCEPTION 'HALKA 6 DÜŞTÜ: pair_vehicle(text) çağrılabilir';
  END IF;
  IF EXISTS (SELECT 1 FROM public.vehicles WHERE api_key IS NOT NULL) THEN
    RAISE EXCEPTION 'HALKA 6 DÜŞTÜ: api_key kolonunda düz değer var';
  END IF;
  RAISE NOTICE 'HALKA 6 GEÇTİ — yedek/hash kapalı, uykudaki pair_vehicle kapalı';
END
$ring6$;

\echo
\echo '  ✔ 084 CİHAZ ANAHTARI MATRİSİ: 6 HALKA DA GEÇTİ'
\echo

ROLLBACK;
