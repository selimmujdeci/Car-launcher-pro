-- ═══════════════════════════════════════════════════════════════════════════
-- 085  PUSH YETKİ MATRİSİ  (MRI Wave 4 · F-08)
--
--   npm run test:push
--
-- GERÇEK DAVRANIŞ: rol değiştirir (SET LOCAL ROLE), JWT claim kurar, RPC'leri
-- çağırır; GRANT/politika/fonksiyon SONUCUNU ölçer.
--
--   HALKA 1  ARAÇ TOKEN'I: eşleşmiş insan (sahip) okuyamaz/yazamaz/silemez;
--            anon okuyamaz/yazamaz
--   HALKA 2  ARAÇ TOKEN'I: geçerli cihaz anahtarı kendi token'ını kaydeder ve
--            günceller; geçersiz anahtar / saklanan hash (Wave 3 değişmezi) /
--            başka aracın anahtarı → kendi aracına yazar, A'ya yazamaz
--            (imza vehicle_id almaz — yapısal)
--   HALKA 3  LEGACY: kullanıcı-kimlikli register_push_token(uuid) hiçbir istemci
--            rolüne açık değil
--   HALKA 4  SUNUCU (service_role): token okur/siler (wake fonksiyonunun yolu)
--   HALKA 5  TARAYICI ABONELİĞİ: A kendi aboneliğini yazar/okur/siler; B, A'nın
--            aboneliğini göremez/değiştiremez/silemez; A, B adına yazamaz;
--            anon hiçbir şey yapamaz
--   HALKA 6  İKİ DEPO AYRI: araç token tablosunda user_id yok, abonelik
--            tablosunda vehicle_id/fcm_token yok (semantik karışma yapısal olarak
--            imkânsız)
--
-- Yalnız YEREL veritabanında koşar ve `ROLLBACK` ile biter.
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on
\pset pager off

BEGIN;

CREATE TEMP TABLE ek (k text PRIMARY KEY, v text);

CREATE OR REPLACE FUNCTION pg_temp.as_user(p_role text, p_uid uuid, p_sql text)
RETURNS text LANGUAGE plpgsql AS $h$
DECLARE r text;
BEGIN
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  PERFORM set_config('request.jwt.claims',
    CASE WHEN p_uid IS NULL THEN '' ELSE json_build_object('sub', p_uid, 'role', p_role)::text END, true);
  BEGIN
    EXECUTE p_sql INTO r;
  EXCEPTION WHEN OTHERS THEN
    r := 'ERR:' || SQLSTATE || ':' || left(SQLERRM, 120);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  RETURN r;
END $h$;

DO $setup$
DECLARE
  ua uuid := gen_random_uuid(); ub uuid := gen_random_uuid();
  va uuid; vb uuid;
  ka text := gen_random_uuid()::text; kb text := gen_random_uuid()::text;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (ua, 'a085@test.local'), (ub, 'b085@test.local');
  INSERT INTO public.profiles (id, role) VALUES (ua, 'individual'), (ub, 'individual') ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.vehicles (name, owner_id, api_key_hash)
    VALUES ('ARAC_A', ua, encode(sha256(convert_to(ka,'UTF8')),'hex')) RETURNING id INTO va;
  INSERT INTO public.vehicles (name, owner_id, api_key_hash)
    VALUES ('ARAC_B', ub, encode(sha256(convert_to(kb,'UTF8')),'hex')) RETURNING id INTO vb;
  INSERT INTO public.vehicle_pairings (user_id, vehicle_id, role) VALUES (ua, va, 'owner'), (ub, vb, 'owner');
  /* A aracının mevcut cihaz token'ı (sunucu tarafı fixture) */
  INSERT INTO public.vehicle_push_tokens (vehicle_id, fcm_token, platform) VALUES (va, 'fcm-A-existing', 'android');
  INSERT INTO ek VALUES ('ua', ua::text), ('ub', ub::text), ('va', va::text), ('vb', vb::text), ('ka', ka), ('kb', kb);
END
$setup$;

-- ═════════════════════════════════════════════════════════════════════════
-- HALKA 1 — İNSAN İSTEMCİSİ ARAÇ TOKEN'INA DOKUNAMAZ
-- ═════════════════════════════════════════════════════════════════════════
DO $ring1$
DECLARE ua uuid; va uuid; r text;
BEGIN
  SELECT v::uuid INTO ua FROM ek WHERE k='ua'; SELECT v::uuid INTO va FROM ek WHERE k='va';
  r := pg_temp.as_user('authenticated', ua, format($q$SELECT count(*)::text FROM public.vehicle_push_tokens WHERE vehicle_id = %L$q$, va));
  IF r NOT LIKE 'ERR:42501%' THEN RAISE EXCEPTION 'HALKA 1 DÜŞTÜ: eşleşmiş sahip araç token''ını okudu: %', r; END IF;
  r := pg_temp.as_user('authenticated', ua, format($q$INSERT INTO public.vehicle_push_tokens (vehicle_id, fcm_token, platform) VALUES (%L, 'fcm-from-phone', 'android') RETURNING id::text$q$, va));
  IF r NOT LIKE 'ERR:42501%' THEN RAISE EXCEPTION 'HALKA 1 DÜŞTÜ: eşleşmiş sahip kendi telefonunu araç token''ı yaptı: %', r; END IF;
  r := pg_temp.as_user('authenticated', ua, format($q$UPDATE public.vehicle_push_tokens SET fcm_token = 'hijack' WHERE vehicle_id = %L RETURNING id::text$q$, va));
  IF r NOT LIKE 'ERR:42501%' THEN RAISE EXCEPTION 'HALKA 1 DÜŞTÜ: eşleşmiş sahip araç token''ını değiştirdi: %', r; END IF;
  r := pg_temp.as_user('authenticated', ua, format($q$DELETE FROM public.vehicle_push_tokens WHERE vehicle_id = %L RETURNING id::text$q$, va));
  IF r NOT LIKE 'ERR:42501%' THEN RAISE EXCEPTION 'HALKA 1 DÜŞTÜ: eşleşmiş sahip araç token''ını sildi (wake susturma): %', r; END IF;
  r := pg_temp.as_user('anon', NULL, format($q$SELECT count(*)::text FROM public.vehicle_push_tokens WHERE vehicle_id = %L$q$, va));
  IF r NOT LIKE 'ERR:42501%' THEN RAISE EXCEPTION 'HALKA 1 DÜŞTÜ: anon araç token''ını okudu: %', r; END IF;
  r := pg_temp.as_user('anon', NULL, format($q$INSERT INTO public.vehicle_push_tokens (vehicle_id, fcm_token, platform) VALUES (%L, 'x', 'android') RETURNING id::text$q$, va));
  IF r NOT LIKE 'ERR:42501%' THEN RAISE EXCEPTION 'HALKA 1 DÜŞTÜ: anon araç token''ı yazdı: %', r; END IF;
  IF (SELECT fcm_token FROM public.vehicle_push_tokens WHERE vehicle_id = va) <> 'fcm-A-existing' THEN
    RAISE EXCEPTION 'HALKA 1 DÜŞTÜ: token satırı değişti';
  END IF;
  RAISE NOTICE 'HALKA 1 GEÇTİ — insan istemcisi (eşleşmiş sahip / anon) araç token''ına dokunamıyor';
END
$ring1$;

-- ═════════════════════════════════════════════════════════════════════════
-- HALKA 2 — CİHAZ KİMLİĞİ KENDİ TOKEN'INI YÖNETİR
-- ═════════════════════════════════════════════════════════════════════════
DO $ring2$
DECLARE va uuid; vb uuid; ka text; kb text; r text; stored text; n int;
BEGIN
  SELECT v::uuid INTO va FROM ek WHERE k='va'; SELECT v::uuid INTO vb FROM ek WHERE k='vb';
  SELECT v INTO ka FROM ek WHERE k='ka'; SELECT v INTO kb FROM ek WHERE k='kb';

  -- 2a. geçerli anahtar (anon rolünde — araç oturumsuz) → kendi aracına yazar
  r := pg_temp.as_user('anon', NULL, format($q$SELECT public.register_vehicle_push_token(%L, 'fcm-A-new', 'android')::text$q$, ka));
  IF (r::jsonb->>'ok') <> 'true' THEN RAISE EXCEPTION 'HALKA 2a DÜŞTÜ: araç kendi token''ını kaydedemedi: %', r; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.vehicle_push_tokens WHERE vehicle_id = va AND fcm_token = 'fcm-A-new') THEN
    RAISE EXCEPTION 'HALKA 2a DÜŞTÜ: satır yazılmadı';
  END IF;
  -- 2b. aynı token yeniden → güncelleme (duplicate satır yok)
  r := pg_temp.as_user('anon', NULL, format($q$SELECT public.register_vehicle_push_token(%L, 'fcm-A-new', 'ios')::text$q$, ka));
  IF (r::jsonb->>'ok') <> 'true' THEN RAISE EXCEPTION 'HALKA 2b DÜŞTÜ: %', r; END IF;
  SELECT count(*) INTO n FROM public.vehicle_push_tokens WHERE vehicle_id = va AND fcm_token = 'fcm-A-new';
  IF n <> 1 OR (SELECT platform FROM public.vehicle_push_tokens WHERE vehicle_id = va AND fcm_token = 'fcm-A-new') <> 'ios' THEN
    RAISE EXCEPTION 'HALKA 2b DÜŞTÜ: idempotent güncelleme bozuk (n=%)', n;
  END IF;
  -- 2c. geçersiz / boş anahtar → istisna (HTTP 200 sahte başarı yok)
  FOREACH r IN ARRAY ARRAY['', '   ', 'bogus-key'] LOOP
    IF pg_temp.as_user('anon', NULL, format($q$SELECT public.register_vehicle_push_token(%L, 'fcm-x', 'android')::text$q$, r)) NOT LIKE 'ERR:P0001%' THEN
      RAISE EXCEPTION 'HALKA 2c DÜŞTÜ: geçersiz anahtar [%] kabul edildi', r;
    END IF;
  END LOOP;
  -- 2d. Wave 3 değişmezi: saklanan hash anahtar yerine geçmez
  SELECT api_key_hash INTO stored FROM public.vehicles WHERE id = va;
  r := pg_temp.as_user('anon', NULL, format($q$SELECT public.register_vehicle_push_token(%L, 'fcm-hash', 'android')::text$q$, stored));
  IF r NOT LIKE 'ERR:P0001%' THEN RAISE EXCEPTION 'HALKA 2d DÜŞTÜ: saklanan hash ile token kaydedildi: %', r; END IF;
  -- 2e. B aracının anahtarı A'ya yazamaz: imza vehicle_id ALMAZ → kendi aracına yazar
  r := pg_temp.as_user('anon', NULL, format($q$SELECT public.register_vehicle_push_token(%L, 'fcm-B-1', 'android')::text$q$, kb));
  IF (r::jsonb->>'ok') <> 'true' THEN RAISE EXCEPTION 'HALKA 2e DÜŞTÜ: %', r; END IF;
  IF EXISTS (SELECT 1 FROM public.vehicle_push_tokens WHERE vehicle_id = va AND fcm_token = 'fcm-B-1') THEN
    RAISE EXCEPTION 'HALKA 2e DÜŞTÜ: B anahtarı A aracına token yazdı';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.vehicle_push_tokens WHERE vehicle_id = vb AND fcm_token = 'fcm-B-1') THEN
    RAISE EXCEPTION 'HALKA 2e DÜŞTÜ: B kendi aracına yazamadı';
  END IF;
  RAISE NOTICE 'HALKA 2 GEÇTİ — araç token''ı yalnız doğrulanmış cihaz anahtarıyla, yalnız kendi aracına';
END
$ring2$;

-- ═════════════════════════════════════════════════════════════════════════
-- HALKA 3 — KULLANICI-KİMLİKLİ LEGACY KAYIT KAPALI
-- ═════════════════════════════════════════════════════════════════════════
DO $ring3$
DECLARE ua uuid; va uuid; r text;
BEGIN
  SELECT v::uuid INTO ua FROM ek WHERE k='ua'; SELECT v::uuid INTO va FROM ek WHERE k='va';
  IF to_regprocedure('public.register_push_token(uuid,text,text)') IS NOT NULL THEN
    r := pg_temp.as_user('authenticated', ua, format($q$SELECT public.register_push_token(%L, 'fcm-legacy', 'android')::text$q$, va));
    IF r NOT LIKE 'ERR:42501%' THEN RAISE EXCEPTION 'HALKA 3 DÜŞTÜ: eşleşmiş sahip kullanıcı-kimlikli araç token kaydı yapabildi: %', r; END IF;
    r := pg_temp.as_user('anon', NULL, format($q$SELECT public.register_push_token(%L, 'fcm-legacy', 'android')::text$q$, va));
    IF r NOT LIKE 'ERR:42501%' THEN RAISE EXCEPTION 'HALKA 3 DÜŞTÜ: anon legacy kayıt çağırdı: %', r; END IF;
    IF EXISTS (SELECT 1 FROM public.vehicle_push_tokens WHERE fcm_token = 'fcm-legacy') THEN
      RAISE EXCEPTION 'HALKA 3 DÜŞTÜ: legacy yol satır yazdı';
    END IF;
  END IF;
  RAISE NOTICE 'HALKA 3 GEÇTİ — register_push_token(uuid) hiçbir istemci rolüne açık değil';
END
$ring3$;

-- ═════════════════════════════════════════════════════════════════════════
-- HALKA 4 — SUNUCU (service_role) WAKE İÇİN OKUR / ÖLÜ TOKEN SİLER
-- ═════════════════════════════════════════════════════════════════════════
DO $ring4$
DECLARE va uuid; r text;
BEGIN
  SELECT v::uuid INTO va FROM ek WHERE k='va';
  r := pg_temp.as_user('service_role', NULL, format($q$SELECT string_agg(fcm_token, ',' ORDER BY fcm_token) FROM public.vehicle_push_tokens WHERE vehicle_id = %L$q$, va));
  IF r IS NULL OR r NOT LIKE '%fcm-A-existing%' THEN RAISE EXCEPTION 'HALKA 4 DÜŞTÜ [YAN HASAR]: wake fonksiyonu token okuyamıyor: %', r; END IF;
  r := pg_temp.as_user('service_role', NULL, format($q$DELETE FROM public.vehicle_push_tokens WHERE vehicle_id = %L AND fcm_token = 'fcm-A-existing' RETURNING id::text$q$, va));
  IF r LIKE 'ERR:%' OR r IS NULL THEN RAISE EXCEPTION 'HALKA 4 DÜŞTÜ [YAN HASAR]: ölü token silinemiyor: %', r; END IF;
  RAISE NOTICE 'HALKA 4 GEÇTİ — sunucu token okur ve yalnız (araç, token) satırını siler';
END
$ring4$;

-- ═════════════════════════════════════════════════════════════════════════
-- HALKA 5 — TARAYICI ABONELİĞİ: YALNIZ SAHİBİ
-- ═════════════════════════════════════════════════════════════════════════
DO $ring5$
DECLARE ua uuid; ub uuid; r text; sid text;
BEGIN
  SELECT v::uuid INTO ua FROM ek WHERE k='ua'; SELECT v::uuid INTO ub FROM ek WHERE k='ub';
  -- A kendi aboneliğini yazar
  r := pg_temp.as_user('authenticated', ua, format(
    $q$INSERT INTO public.push_subscriptions (user_id, endpoint, subscription) VALUES (%L, 'https://push.example/A', '{"keys":{"p256dh":"pA","auth":"aA"}}'::jsonb) RETURNING id::text$q$, ua));
  IF r LIKE 'ERR:%' THEN RAISE EXCEPTION 'HALKA 5 DÜŞTÜ [YAN HASAR]: A kendi aboneliğini yazamadı: %', r; END IF;
  sid := r;
  -- A kendi aboneliğini okur
  r := pg_temp.as_user('authenticated', ua, $q$SELECT count(*)::text FROM public.push_subscriptions$q$);
  IF r <> '1' THEN RAISE EXCEPTION 'HALKA 5 DÜŞTÜ: A kendi aboneliğini görmedi: %', r; END IF;
  -- B, A'nın aboneliğini GÖRMEZ
  r := pg_temp.as_user('authenticated', ub, $q$SELECT count(*)::text FROM public.push_subscriptions$q$);
  IF r <> '0' THEN RAISE EXCEPTION 'HALKA 5 DÜŞTÜ: B, A''nın aboneliğini gördü: %', r; END IF;
  -- B, A'nın aboneliğini değiştiremez / silemez (RLS: 0 satır etkilenir)
  r := pg_temp.as_user('authenticated', ub, format($q$UPDATE public.push_subscriptions SET subscription = '{}'::jsonb WHERE id = %L RETURNING id::text$q$, sid));
  IF r IS NOT NULL AND r NOT LIKE 'ERR:%' THEN RAISE EXCEPTION 'HALKA 5 DÜŞTÜ: B, A aboneliğini değiştirdi'; END IF;
  r := pg_temp.as_user('authenticated', ub, format($q$DELETE FROM public.push_subscriptions WHERE id = %L RETURNING id::text$q$, sid));
  IF r IS NOT NULL AND r NOT LIKE 'ERR:%' THEN RAISE EXCEPTION 'HALKA 5 DÜŞTÜ: B, A aboneliğini sildi'; END IF;
  IF (SELECT subscription->'keys'->>'auth' FROM public.push_subscriptions WHERE id = sid::uuid) <> 'aA' THEN
    RAISE EXCEPTION 'HALKA 5 DÜŞTÜ: abonelik değişti';
  END IF;
  -- A, B adına yazamaz
  r := pg_temp.as_user('authenticated', ua, format(
    $q$INSERT INTO public.push_subscriptions (user_id, endpoint, subscription) VALUES (%L, 'https://push.example/spoof', '{}'::jsonb) RETURNING id::text$q$, ub));
  IF r NOT LIKE 'ERR:42501%' THEN RAISE EXCEPTION 'HALKA 5 DÜŞTÜ: A, B adına abonelik yazdı: %', r; END IF;
  -- anon hiçbir şey yapamaz
  r := pg_temp.as_user('anon', NULL, $q$SELECT count(*)::text FROM public.push_subscriptions$q$);
  IF r NOT LIKE 'ERR:42501%' THEN RAISE EXCEPTION 'HALKA 5 DÜŞTÜ: anon abonelik okudu: %', r; END IF;
  -- A kendi aboneliğini siler (çıkış temizliği)
  r := pg_temp.as_user('authenticated', ua, format($q$DELETE FROM public.push_subscriptions WHERE id = %L RETURNING id::text$q$, sid));
  IF r <> sid THEN RAISE EXCEPTION 'HALKA 5 DÜŞTÜ [YAN HASAR]: A kendi aboneliğini silemedi: %', r; END IF;
  RAISE NOTICE 'HALKA 5 GEÇTİ — tarayıcı aboneliği yalnız sahibi tarafından yönetiliyor';
END
$ring5$;

-- ═════════════════════════════════════════════════════════════════════════
-- HALKA 6 — İKİ DEPO YAPISAL OLARAK AYRI
-- ═════════════════════════════════════════════════════════════════════════
DO $ring6$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='vehicle_push_tokens' AND column_name IN ('user_id','endpoint','subscription')) THEN
    RAISE EXCEPTION 'HALKA 6 DÜŞTÜ: araç token tablosu insan aboneliği alanı taşıyor';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='push_subscriptions' AND column_name IN ('vehicle_id','fcm_token','platform')) THEN
    RAISE EXCEPTION 'HALKA 6 DÜŞTÜ: abonelik tablosu araç token alanı taşıyor';
  END IF;
  RAISE NOTICE 'HALKA 6 GEÇTİ — vehicle_push_tokens ≠ push_subscriptions (şema düzeyinde)';
END
$ring6$;

\echo
\echo '  ✔ 085 PUSH YETKİ MATRİSİ: 6 HALKA DA GEÇTİ'
\echo

ROLLBACK;
