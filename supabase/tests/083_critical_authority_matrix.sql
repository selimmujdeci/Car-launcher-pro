-- ═══════════════════════════════════════════════════════════════════════════
-- 083  KRİTİK KOMUT / PIN / ARAÇ VERİSİ YETKİ MATRİSİ  (MRI Wave 3: N-2 · N-3 · F-06)
--
--   npm run test:critical
--
-- GERÇEK DAVRANIŞ testidir: rol değiştirir (SET LOCAL ROLE), JWT claim kurar
-- (request.jwt.claims), politikaların/GRANT'lerin/trigger'ın/RPC'lerin
-- SONUCUNU ölçer. Kaynak metni grep ETMEZ.
--
--   HALKA 1  N-2: eşleşmiş istemci critical_auth_verified=true yazamaz (trigger
--            istemci iddiasını okumaz) — kritik komut doğrudan INSERT ile GİRMEZ
--   HALKA 2  N-2: PIN kayıtlı değil → RPC pin_not_set (fail-closed);
--            yanlış PIN → DENY; doğru PIN → ALLOW ve satır sunucu kanıtlı
--   HALKA 3  N-2: A aracının PIN'i B aracında geçmez; B hesabı A aracına kritik
--            komut veremez; kritik olmayan komut aynen çalışır (bayrak false)
--   HALKA 4  N-3: doğrulayıcı eşleşmiş/anon istemciye SELECT edilemez; hash'in
--            kendisi PIN yerine geçmez; eski SHA-256 doğru PIN'de bcrypt'e
--            yükselir, yanlış PIN yükseltmez; 5 hata → pin_locked
--   HALKA 5  F-06: api_key / api_key_hash / pairing_code eşleşmiş istemciye
--            kapalı; meşru kolonlar (name, e2e_public_key) açık; gizli kolon
--            UPDATE edilemez; meşru UPDATE (name) çalışır
--   HALKA 6  F-06: eşleşmiş istemci telemetry/location/event YAZAMAZ,
--            komut status'unu DEĞİŞTİREMEZ, INSERT'te status/result VEREMEZ;
--            meşru okuma yolları çalışır; araç RPC'si (api_key) hâlâ yazar
--   HALKA 7  F-06: kimliksiz increment_command_retry kapalı; api_key'li imza
--            yalnız KENDİ aracının komutunu ilerletir
--   HALKA 8  Çok hesap / çok araç: B, A'nın gizli kolonlarını okuyamaz, A adına
--            komut yaratamaz, A'nın telemetrisini yazamaz
--
-- Yalnız YEREL veritabanında koşar ve `ROLLBACK` ile biter.
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on
\pset pager off

BEGIN;

CREATE TEMP TABLE ek (k text PRIMARY KEY, v text);

/* Yardımcılar: bir rol + kullanıcı kimliğiyle bir ifade koş. */
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
  INSERT INTO auth.users (id, email) VALUES (ua, 'a083@test.local'), (ub, 'b083@test.local');
  -- auth.users trigger'ı profiles satırını zaten açar; yoksa aç.
  INSERT INTO public.profiles (id, role) VALUES (ua, 'individual'), (ub, 'individual') ON CONFLICT (id) DO NOTHING;
  /* Anahtar HASH'li saklanır (084 sonrası tek biçim; 083'te de sha256 dalı
     zaten vardır) — fixture düz metin depolamayı VARSAYMAZ. */
  INSERT INTO public.vehicles (name, owner_id, api_key_hash, e2e_public_key)
    VALUES ('ARAC_A', ua, encode(sha256(convert_to(ka,'UTF8')),'hex'), 'PUBKEY_A') RETURNING id INTO va;
  INSERT INTO public.vehicles (name, owner_id, api_key_hash)
    VALUES ('ARAC_B', ub, encode(sha256(convert_to(kb,'UTF8')),'hex')) RETURNING id INTO vb;
  INSERT INTO public.vehicle_pairings (user_id, vehicle_id, role) VALUES (ua, va, 'owner'), (ub, vb, 'owner');
  INSERT INTO ek VALUES ('ua', ua::text), ('ub', ub::text), ('va', va::text), ('vb', vb::text), ('ka', ka), ('kb', kb);
END
$setup$;

-- ═════════════════════════════════════════════════════════════════════════
-- HALKA 1 — İSTEMCİ İDDİASI HİÇBİR ŞEY AÇMAZ
-- ═════════════════════════════════════════════════════════════════════════
DO $ring1$
DECLARE ua uuid; va uuid; r text;
BEGIN
  SELECT v::uuid INTO ua FROM ek WHERE k='ua';
  SELECT v::uuid INTO va FROM ek WHERE k='va';

  -- 1a. PIN yokken bile kritik komut doğrudan INSERT ile GİRMEZ (istemci true yazsa da)
  r := pg_temp.as_user('authenticated', ua, format(
    $q$INSERT INTO public.vehicle_commands (vehicle_id, created_by, type, payload, nonce, ttl, critical_auth_verified)
       VALUES (%L, %L, 'unlock', '{}', 'n1', now() + interval '5 min', true) RETURNING id::text$q$, va, ua));
  IF r NOT LIKE 'ERR:P0001:critical_pin_required%' THEN
    RAISE EXCEPTION 'HALKA 1a DÜŞTÜ: istemci critical_auth_verified=true ile kritik komut soktu: %', r;
  END IF;

  -- 1b. alarm_off da kritik
  r := pg_temp.as_user('authenticated', ua, format(
    $q$INSERT INTO public.vehicle_commands (vehicle_id, created_by, type, payload, nonce, ttl, critical_auth_verified)
       VALUES (%L, %L, 'alarm_off', '{}', 'n2', now() + interval '5 min', true) RETURNING id::text$q$, va, ua));
  IF r NOT LIKE 'ERR:P0001:critical_pin_required%' THEN
    RAISE EXCEPTION 'HALKA 1b DÜŞTÜ: alarm_off istemci iddiasıyla girdi: %', r;
  END IF;

  -- 1c. service_role bile GUC kanıtı olmadan kritik komut sokamaz (tek kapı RPC)
  BEGIN
    INSERT INTO public.vehicle_commands (vehicle_id, type, payload, nonce, ttl, critical_auth_verified)
    VALUES (va, 'unlock', '{}', 'n3', now() + interval '5 min', true);
    RAISE EXCEPTION 'HALKA 1c DÜŞTÜ: sahip rolü GUC olmadan kritik komut soktu';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM NOT LIKE 'critical_pin_required%' THEN RAISE; END IF;
  END;

  IF EXISTS (SELECT 1 FROM public.vehicle_commands WHERE vehicle_id = va) THEN
    RAISE EXCEPTION 'HALKA 1 DÜŞTÜ: reddedilen komut satırı kalmış';
  END IF;
  RAISE NOTICE 'HALKA 1 GEÇTİ — istemci iddiası (critical_auth_verified) hiçbir kapıyı açmıyor';
END
$ring1$;

-- ═════════════════════════════════════════════════════════════════════════
-- HALKA 2 — PIN: KAYITSIZ → pin_not_set · YANLIŞ → DENY · DOĞRU → ALLOW
-- ═════════════════════════════════════════════════════════════════════════
DO $ring2$
DECLARE ua uuid; va uuid; r text; j jsonb; cid uuid; stored text; flag boolean;
BEGIN
  SELECT v::uuid INTO ua FROM ek WHERE k='ua';
  SELECT v::uuid INTO va FROM ek WHERE k='va';

  -- 2a. PIN kayıtlı değil → fail-closed pin_not_set (komut YOK)
  r := pg_temp.as_user('authenticated', ua, format(
    $q$SELECT public.verify_and_send_critical_command(%L, 'unlock', '{}'::jsonb, '1234', 'n-2a', now() + interval '5 min')::text$q$, va));
  j := r::jsonb;
  IF (j->>'ok') <> 'false' OR (j->>'error') <> 'pin_not_set' THEN
    RAISE EXCEPTION 'HALKA 2a DÜŞTÜ: PIN yokken kritik komut kabul edildi: %', r;
  END IF;

  -- 2b. anon PIN belirleyemez
  r := pg_temp.as_user('anon', NULL, format($q$SELECT public.set_vehicle_pin(%L, '1234')::text$q$, va));
  IF r NOT LIKE 'ERR:42501%' THEN
    RAISE EXCEPTION 'HALKA 2b DÜŞTÜ: anon set_vehicle_pin çağırabildi: %', r;
  END IF;

  -- 2c. eşleşmiş sahip PIN belirler → bcrypt biçimi, istemci hiç görmez
  r := pg_temp.as_user('authenticated', ua, format($q$SELECT public.set_vehicle_pin(%L, '1234')::text$q$, va));
  IF (r::jsonb->>'ok') <> 'true' THEN RAISE EXCEPTION 'HALKA 2c DÜŞTÜ: set_vehicle_pin: %', r; END IF;
  SELECT critical_pin_hash INTO stored FROM public.vehicles WHERE id = va;
  IF stored NOT LIKE '$2%' OR length(stored) < 50 THEN
    RAISE EXCEPTION 'HALKA 2c DÜŞTÜ: doğrulayıcı bcrypt değil: %', left(stored, 8);
  END IF;
  IF stored = encode(sha256(convert_to('1234','UTF8')),'hex') THEN
    RAISE EXCEPTION 'HALKA 2c DÜŞTÜ: doğrulayıcı tuzsuz SHA-256';
  END IF;

  -- 2d. yanlış PIN → DENY, komut yok
  r := pg_temp.as_user('authenticated', ua, format(
    $q$SELECT public.verify_and_send_critical_command(%L, 'unlock', '{}'::jsonb, '9999', 'n-2d', now() + interval '5 min')::text$q$, va));
  IF (r::jsonb->>'ok') <> 'false' THEN RAISE EXCEPTION 'HALKA 2d DÜŞTÜ: yanlış PIN kabul: %', r; END IF;
  IF EXISTS (SELECT 1 FROM public.vehicle_commands WHERE vehicle_id = va) THEN
    RAISE EXCEPTION 'HALKA 2d DÜŞTÜ: yanlış PIN ile komut satırı oluştu';
  END IF;

  -- 2e. doğru PIN → ALLOW, satır sunucu kanıtlı (critical_auth_verified=true, sender=uid)
  r := pg_temp.as_user('authenticated', ua, format(
    $q$SELECT public.verify_and_send_critical_command(%L, 'unlock', '{"k":1}'::jsonb, '1234', 'n-2e', now() + interval '5 min')::text$q$, va));
  j := r::jsonb;
  IF (j->>'ok') <> 'true' THEN RAISE EXCEPTION 'HALKA 2e DÜŞTÜ: doğru PIN reddedildi: %', r; END IF;
  cid := (j->>'command_id')::uuid;
  SELECT critical_auth_verified INTO flag FROM public.vehicle_commands WHERE id = cid AND vehicle_id = va AND sender_id = ua AND type = 'unlock';
  IF flag IS DISTINCT FROM true THEN RAISE EXCEPTION 'HALKA 2e DÜŞTÜ: komut satırı sunucu kanıtı taşımıyor'; END IF;

  -- 2f. GUC transaction sonrası sızmaz: RPC'den sonra doğrudan INSERT yine reddedilir
  r := pg_temp.as_user('authenticated', ua, format(
    $q$INSERT INTO public.vehicle_commands (vehicle_id, created_by, type, payload, nonce, ttl)
       VALUES (%L, %L, 'unlock', '{}', 'n-2f', now() + interval '5 min') RETURNING id::text$q$, va, ua));
  IF r NOT LIKE 'ERR:P0001:critical_pin_required%' THEN
    RAISE EXCEPTION 'HALKA 2f DÜŞTÜ: sunucu kanıtı RPC dışına sızdı: %', r;
  END IF;

  -- 2g. TTL sunucu tarafından 5 dk ile sınırlanır
  r := pg_temp.as_user('authenticated', ua, format(
    $q$SELECT public.verify_and_send_critical_command(%L, 'unlock', '{}'::jsonb, '1234', 'n-2g', now() + interval '3 hours')::text$q$, va));
  cid := (r::jsonb->>'command_id')::uuid;
  IF (SELECT ttl FROM public.vehicle_commands WHERE id = cid) > now() + interval '5 minutes 5 seconds' THEN
    RAISE EXCEPTION 'HALKA 2g DÜŞTÜ: istemci TTL''i sunucu penceresini aştı';
  END IF;

  RAISE NOTICE 'HALKA 2 GEÇTİ — PIN sunucuda doğrulanıyor: kayıtsız→pin_not_set, yanlış→DENY, doğru→ALLOW';
END
$ring2$;

-- ═════════════════════════════════════════════════════════════════════════
-- HALKA 3 — ARAÇ/HESAP SINIRI · KRİTİK OLMAYAN KOMUT
-- ═════════════════════════════════════════════════════════════════════════
DO $ring3$
DECLARE ua uuid; ub uuid; va uuid; vb uuid; r text; flag boolean;
BEGIN
  SELECT v::uuid INTO ua FROM ek WHERE k='ua'; SELECT v::uuid INTO ub FROM ek WHERE k='ub';
  SELECT v::uuid INTO va FROM ek WHERE k='va'; SELECT v::uuid INTO vb FROM ek WHERE k='vb';

  -- 3a. A'nın PIN'i B aracında geçmez (B'de PIN yok → pin_not_set; asla ALLOW değil)
  r := pg_temp.as_user('authenticated', ub, format(
    $q$SELECT public.verify_and_send_critical_command(%L, 'unlock', '{}'::jsonb, '1234', 'n-3a', now() + interval '5 min')::text$q$, vb));
  IF (r::jsonb->>'ok') <> 'false' THEN RAISE EXCEPTION 'HALKA 3a DÜŞTÜ: A PIN''i B aracında geçti: %', r; END IF;

  -- 3b. B hesabı A aracına (doğru PIN bilse bile) kritik komut veremez — eşleşme yok
  r := pg_temp.as_user('authenticated', ub, format(
    $q$SELECT public.verify_and_send_critical_command(%L, 'unlock', '{}'::jsonb, '1234', 'n-3b', now() + interval '5 min')::text$q$, va));
  IF (r::jsonb->>'ok') <> 'false' OR (r::jsonb->>'error') NOT LIKE 'Yetkisiz%' THEN
    RAISE EXCEPTION 'HALKA 3b DÜŞTÜ: yabancı hesap A aracına kritik komut verdi: %', r;
  END IF;

  -- 3c. anon RPC'yi çağıramaz
  r := pg_temp.as_user('anon', NULL, format(
    $q$SELECT public.verify_and_send_critical_command(%L, 'unlock', '{}'::jsonb, '1234', 'n-3c', now() + interval '5 min')::text$q$, va));
  IF r NOT LIKE 'ERR:42501%' THEN RAISE EXCEPTION 'HALKA 3c DÜŞTÜ: anon RPC çağırdı: %', r; END IF;

  -- 3d. kritik olmayan komut doğrudan INSERT ile aynen çalışır; bayrak istemci true dese de false
  r := pg_temp.as_user('authenticated', ua, format(
    $q$INSERT INTO public.vehicle_commands (vehicle_id, created_by, type, payload, nonce, ttl, critical_auth_verified)
       VALUES (%L, %L, 'lock', '{}', 'n-3d', now() + interval '5 min', true) RETURNING id::text$q$, va, ua));
  IF r LIKE 'ERR:%' THEN RAISE EXCEPTION 'HALKA 3d DÜŞTÜ [YAN HASAR]: kritik olmayan komut reddedildi: %', r; END IF;
  SELECT critical_auth_verified INTO flag FROM public.vehicle_commands WHERE id = r::uuid;
  IF flag THEN RAISE EXCEPTION 'HALKA 3d DÜŞTÜ: kritik olmayan komutta istemci iddiası korundu'; END IF;

  -- 3e. RPC kritik olmayan tip için kullanılamaz
  r := pg_temp.as_user('authenticated', ua, format(
    $q$SELECT public.verify_and_send_critical_command(%L, 'lock', '{}'::jsonb, '1234', 'n-3e', now() + interval '5 min')::text$q$, va));
  IF (r::jsonb->>'ok') <> 'false' THEN RAISE EXCEPTION 'HALKA 3e DÜŞTÜ: RPC kritik olmayan tipi kabul etti'; END IF;

  RAISE NOTICE 'HALKA 3 GEÇTİ — PIN yetkisi araç/hesap sınırını aşmıyor; kritik olmayan komut bozulmadı';
END
$ring3$;

-- ═════════════════════════════════════════════════════════════════════════
-- HALKA 4 — DOĞRULAYICI GİZLİ · HASH ≠ PIN · LEGACY YÜKSELTME · KİLİT
-- ═════════════════════════════════════════════════════════════════════════
DO $ring4$
DECLARE ua uuid; ub uuid; va uuid; vb uuid; r text; stored text; legacy text; i int;
BEGIN
  SELECT v::uuid INTO ua FROM ek WHERE k='ua'; SELECT v::uuid INTO ub FROM ek WHERE k='ub';
  SELECT v::uuid INTO va FROM ek WHERE k='va'; SELECT v::uuid INTO vb FROM ek WHERE k='vb';

  -- 4a. eşleşmiş sahip bile doğrulayıcıyı SELECT edemez (kolon yetkisi)
  r := pg_temp.as_user('authenticated', ua, format($q$SELECT critical_pin_hash FROM public.vehicles WHERE id = %L$q$, va));
  IF r NOT LIKE 'ERR:42501%' THEN RAISE EXCEPTION 'HALKA 4a DÜŞTÜ: eşleşmiş kullanıcı PIN doğrulayıcısını okudu: %', r; END IF;
  -- 4b. anon da okuyamaz
  r := pg_temp.as_user('anon', NULL, format($q$SELECT critical_pin_hash FROM public.vehicles WHERE id = %L$q$, va));
  IF r NOT LIKE 'ERR:42501%' THEN RAISE EXCEPTION 'HALKA 4b DÜŞTÜ: anon PIN doğrulayıcısını okudu: %', r; END IF;

  -- 4c. bcrypt hash'in kendisi PIN yerine geçmez (pass-the-hash)
  SELECT critical_pin_hash INTO stored FROM public.vehicles WHERE id = va;
  r := pg_temp.as_user('authenticated', ua, format(
    $q$SELECT public.verify_and_send_critical_command(%L, 'unlock', '{}'::jsonb, %L, 'n-4c', now() + interval '5 min')::text$q$, va, stored));
  IF (r::jsonb->>'ok') <> 'false' THEN RAISE EXCEPTION 'HALKA 4c DÜŞTÜ: bcrypt hash PIN yerine geçti'; END IF;

  -- 4d. LEGACY: B aracına eski biçim (tuzsuz SHA-256) doğrulayıcı koy
  legacy := encode(sha256(convert_to('2468','UTF8')),'hex');
  UPDATE public.vehicles SET critical_pin_hash = legacy WHERE id = vb;
  -- hash'in kendisi PIN yerine geçmez
  r := pg_temp.as_user('authenticated', ub, format(
    $q$SELECT public.verify_and_send_critical_command(%L, 'unlock', '{}'::jsonb, %L, 'n-4d', now() + interval '5 min')::text$q$, vb, legacy));
  IF (r::jsonb->>'ok') <> 'false' THEN RAISE EXCEPTION 'HALKA 4d DÜŞTÜ: legacy hash PIN yerine geçti'; END IF;
  -- yanlış PIN yükseltmez
  r := pg_temp.as_user('authenticated', ub, format(
    $q$SELECT public.verify_and_send_critical_command(%L, 'unlock', '{}'::jsonb, '0000', 'n-4d2', now() + interval '5 min')::text$q$, vb));
  IF (r::jsonb->>'ok') <> 'false' THEN RAISE EXCEPTION 'HALKA 4d DÜŞTÜ: legacy yanlış PIN kabul'; END IF;
  IF (SELECT critical_pin_hash FROM public.vehicles WHERE id = vb) <> legacy THEN
    RAISE EXCEPTION 'HALKA 4d DÜŞTÜ: yanlış PIN legacy doğrulayıcıyı değiştirdi';
  END IF;
  -- doğru PIN → ALLOW + yerinde bcrypt'e yükseltme
  r := pg_temp.as_user('authenticated', ub, format(
    $q$SELECT public.verify_and_send_critical_command(%L, 'unlock', '{}'::jsonb, '2468', 'n-4d3', now() + interval '5 min')::text$q$, vb));
  IF (r::jsonb->>'ok') <> 'true' THEN RAISE EXCEPTION 'HALKA 4d DÜŞTÜ: legacy doğru PIN reddedildi: %', r; END IF;
  SELECT critical_pin_hash INTO stored FROM public.vehicles WHERE id = vb;
  IF stored NOT LIKE '$2%' THEN RAISE EXCEPTION 'HALKA 4d DÜŞTÜ: legacy doğru PIN ile bcrypt''e yükselmedi'; END IF;
  -- yükseltme sonrası eski hash artık hiçbir şekilde geçmez, PIN geçer
  r := pg_temp.as_user('authenticated', ub, format(
    $q$SELECT public.verify_and_send_critical_command(%L, 'unlock', '{}'::jsonb, %L, 'n-4d4', now() + interval '5 min')::text$q$, vb, legacy));
  IF (r::jsonb->>'ok') <> 'false' THEN RAISE EXCEPTION 'HALKA 4d DÜŞTÜ: yükseltme sonrası legacy hash geçti'; END IF;

  -- 4e. Sahip olmayan eşleşmiş kullanıcı mevcut PIN'i kanıtlamadan değiştiremez
  INSERT INTO public.vehicle_pairings (user_id, vehicle_id, role) VALUES (ub, va, 'observer');
  r := pg_temp.as_user('authenticated', ub, format($q$SELECT public.set_vehicle_pin(%L, '5555')::text$q$, va));
  IF (r::jsonb->>'ok') <> 'false' THEN RAISE EXCEPTION 'HALKA 4e DÜŞTÜ: eşleşmiş gözlemci PIN''i sıfırladı'; END IF;
  r := pg_temp.as_user('authenticated', ub, format($q$SELECT public.set_vehicle_pin(%L, '5555', '1234')::text$q$, va));
  IF (r::jsonb->>'ok') <> 'true' THEN RAISE EXCEPTION 'HALKA 4e DÜŞTÜ: mevcut PIN kanıtıyla değişiklik reddedildi: %', r; END IF;
  r := pg_temp.as_user('authenticated', ua, format($q$SELECT public.set_vehicle_pin(%L, '1234', '5555')::text$q$, va));  -- geri al
  DELETE FROM public.vehicle_pairings WHERE user_id = ub AND vehicle_id = va;

  -- 4f. Çevrimiçi kaba kuvvet: 5 yanlış → pin_locked (doğru PIN bile geçmez)
  DELETE FROM public.vehicle_events WHERE vehicle_id = va::text AND type = 'critical_pin_failed';
  FOR i IN 1..5 LOOP
    r := pg_temp.as_user('authenticated', ua, format(
      $q$SELECT public.verify_and_send_critical_command(%L, 'unlock', '{}'::jsonb, '0001', %L, now() + interval '5 min')::text$q$, va, 'n-4f-' || i));
  END LOOP;
  r := pg_temp.as_user('authenticated', ua, format(
    $q$SELECT public.verify_and_send_critical_command(%L, 'unlock', '{}'::jsonb, '1234', 'n-4f-ok', now() + interval '5 min')::text$q$, va));
  IF (r::jsonb->>'error') IS DISTINCT FROM 'pin_locked' THEN RAISE EXCEPTION 'HALKA 4f DÜŞTÜ: 5 hata sonrası kilit yok: %', r; END IF;
  DELETE FROM public.vehicle_events WHERE vehicle_id = va::text AND type = 'critical_pin_failed';

  RAISE NOTICE 'HALKA 4 GEÇTİ — doğrulayıcı gizli, hash≠PIN, legacy güvenli yükseliyor, kaba kuvvet kilitleniyor';
END
$ring4$;

-- ═════════════════════════════════════════════════════════════════════════
-- HALKA 5 — vehicles KOLON YETKİSİ
-- ═════════════════════════════════════════════════════════════════════════
DO $ring5$
DECLARE ua uuid; va uuid; r text; c text;
BEGIN
  SELECT v::uuid INTO ua FROM ek WHERE k='ua'; SELECT v::uuid INTO va FROM ek WHERE k='va';

  FOREACH c IN ARRAY ARRAY['api_key','api_key_hash','critical_pin_hash','pairing_code'] LOOP
    r := pg_temp.as_user('authenticated', ua, format($q$SELECT %I::text FROM public.vehicles WHERE id = %L$q$, c, va));
    IF r NOT LIKE 'ERR:42501%' THEN RAISE EXCEPTION 'HALKA 5 DÜŞTÜ: eşleşmiş kullanıcı vehicles.% okudu: %', c, r; END IF;
    r := pg_temp.as_user('anon', NULL, format($q$SELECT %I::text FROM public.vehicles WHERE id = %L$q$, c, va));
    IF r NOT LIKE 'ERR:42501%' THEN RAISE EXCEPTION 'HALKA 5 DÜŞTÜ: anon vehicles.% okudu: %', c, r; END IF;
    r := pg_temp.as_user('authenticated', ua, format($q$UPDATE public.vehicles SET %I = 'X' WHERE id = %L RETURNING id::text$q$, c, va));
    IF r NOT LIKE 'ERR:42501%' THEN RAISE EXCEPTION 'HALKA 5 DÜŞTÜ: eşleşmiş kullanıcı vehicles.% yazdı: %', c, r; END IF;
  END LOOP;

  -- e2e_public_key: okunur (PWA şifreleme için gerekli), yazılamaz (RPC sahipli)
  r := pg_temp.as_user('authenticated', ua, format($q$SELECT e2e_public_key FROM public.vehicles WHERE id = %L$q$, va));
  IF r <> 'PUBKEY_A' THEN RAISE EXCEPTION 'HALKA 5 DÜŞTÜ [YAN HASAR]: e2e_public_key okunamadı: %', r; END IF;
  r := pg_temp.as_user('authenticated', ua, format($q$UPDATE public.vehicles SET e2e_public_key = 'MITM' WHERE id = %L RETURNING id::text$q$, va));
  IF r NOT LIKE 'ERR:42501%' THEN RAISE EXCEPTION 'HALKA 5 DÜŞTÜ: istemci e2e_public_key ezdi (MITM kapısı)'; END IF;

  -- meşru okuma/yazma (PWA vehicles.service + admin select listesi) çalışır
  r := pg_temp.as_user('authenticated', ua, format(
    $q$SELECT name || '|' || coalesce(plate,'') || '|' || odometer_km::text || '|' || coalesce(company_id::text,'') || '|' || revision::text FROM public.vehicles WHERE id = %L$q$, va));
  IF r LIKE 'ERR:%' THEN RAISE EXCEPTION 'HALKA 5 DÜŞTÜ [YAN HASAR]: meşru kolonlar okunamadı: %', r; END IF;
  r := pg_temp.as_user('authenticated', ua, format($q$UPDATE public.vehicles SET name = 'ARAC_A2', plate = '34ABC' WHERE id = %L RETURNING name$q$, va));
  IF r <> 'ARAC_A2' THEN RAISE EXCEPTION 'HALKA 5 DÜŞTÜ [YAN HASAR]: sahip name/plate güncelleyemedi: %', r; END IF;

  RAISE NOTICE 'HALKA 5 GEÇTİ — gizli kolonlar istemciye kapalı, meşru kolonlar açık';
END
$ring5$;

-- ═════════════════════════════════════════════════════════════════════════
-- HALKA 6 — ARAÇ GERÇEĞİ: İSTEMCİ YAZAMAZ, ARAÇ (api_key) YAZAR, OKUMA ÇALIŞIR
-- ═════════════════════════════════════════════════════════════════════════
DO $ring6$
DECLARE ua uuid; va uuid; ka text; r text; cid uuid; ev uuid;
BEGIN
  SELECT v::uuid INTO ua FROM ek WHERE k='ua'; SELECT v::uuid INTO va FROM ek WHERE k='va';
  SELECT v INTO ka FROM ek WHERE k='ka';

  -- 6a. telemetry / location / event fabrikasyonu KAPALI (sahip+eşleşmiş bile)
  r := pg_temp.as_user('authenticated', ua, format($q$INSERT INTO public.vehicle_telemetry (vehicle_id, speed) VALUES (%L, 250) RETURNING id::text$q$, va));
  IF r NOT LIKE 'ERR:42501%' THEN RAISE EXCEPTION 'HALKA 6a DÜŞTÜ: istemci telemetry yazdı: %', r; END IF;
  r := pg_temp.as_user('authenticated', ua, format($q$INSERT INTO public.vehicle_locations (vehicle_id, lat, lng) VALUES (%L, 41, 29) RETURNING id::text$q$, va));
  IF r NOT LIKE 'ERR:42501%' THEN RAISE EXCEPTION 'HALKA 6a DÜŞTÜ: istemci location yazdı: %', r; END IF;
  r := pg_temp.as_user('authenticated', ua, format($q$INSERT INTO public.vehicle_events (vehicle_id, type, metadata) VALUES (%L, 'fake', '{}') RETURNING id::text$q$, va::text));
  IF r NOT LIKE 'ERR:42501%' THEN RAISE EXCEPTION 'HALKA 6a DÜŞTÜ: istemci event yazdı: %', r; END IF;
  r := pg_temp.as_user('anon', NULL, format($q$INSERT INTO public.vehicle_telemetry (vehicle_id, speed) VALUES (%L, 250) RETURNING id::text$q$, va));
  IF r NOT LIKE 'ERR:42501%' THEN RAISE EXCEPTION 'HALKA 6a DÜŞTÜ: anon telemetry yazdı: %', r; END IF;

  -- 6b. komut STATUS'u istemci tarafından değiştirilemez; INSERT'te status/result verilemez
  SELECT id INTO cid FROM public.vehicle_commands WHERE vehicle_id = va AND type = 'lock' LIMIT 1;
  r := pg_temp.as_user('authenticated', ua, format($q$UPDATE public.vehicle_commands SET status = 'completed' WHERE id = %L RETURNING id::text$q$, cid));
  IF r NOT LIKE 'ERR:42501%' THEN RAISE EXCEPTION 'HALKA 6b DÜŞTÜ: istemci komutu completed yaptı: %', r; END IF;
  r := pg_temp.as_user('authenticated', ua, format($q$DELETE FROM public.vehicle_commands WHERE id = %L RETURNING id::text$q$, cid));
  IF r NOT LIKE 'ERR:42501%' THEN RAISE EXCEPTION 'HALKA 6b DÜŞTÜ: istemci komut sildi: %', r; END IF;
  r := pg_temp.as_user('authenticated', ua, format(
    $q$INSERT INTO public.vehicle_commands (vehicle_id, created_by, type, payload, nonce, ttl, status) VALUES (%L, %L, 'lock', '{}', 'n-6b', now() + interval '5 min', 'completed') RETURNING id::text$q$, va, ua));
  IF r NOT LIKE 'ERR:42501%' THEN RAISE EXCEPTION 'HALKA 6b DÜŞTÜ: istemci INSERT''te status verdi: %', r; END IF;
  r := pg_temp.as_user('authenticated', ua, format(
    $q$INSERT INTO public.vehicle_commands (vehicle_id, created_by, type, payload, nonce, ttl, result) VALUES (%L, %L, 'read_dtc', '{}', 'n-6b2', now() + interval '5 min', '{"fake":1}') RETURNING id::text$q$, va, ua));
  IF r NOT LIKE 'ERR:42501%' THEN RAISE EXCEPTION 'HALKA 6b DÜŞTÜ: istemci INSERT''te result verdi: %', r; END IF;

  -- 6c. MEŞRU ARAÇ YAZICISI (api_key RPC) hâlâ çalışır: event + location + komut durumu
  SELECT public.push_vehicle_event(ka, 'heartbeat', jsonb_build_object('lat', 41.0, 'lng', 29.0, 'source', 'HEAD_UNIT_GPS')) INTO ev;
  IF ev IS NULL THEN RAISE EXCEPTION 'HALKA 6c DÜŞTÜ [YAN HASAR]: push_vehicle_event yazamadı'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.vehicle_locations WHERE vehicle_id = va) THEN
    RAISE EXCEPTION 'HALKA 6c DÜŞTÜ [YAN HASAR]: araç konumu yazılmadı';
  END IF;
  PERFORM public.update_command_status(ka, cid, 'completed', now(), now(), now(), NULL, NULL);
  IF (SELECT status FROM public.vehicle_commands WHERE id = cid) <> 'completed' THEN
    RAISE EXCEPTION 'HALKA 6c DÜŞTÜ [YAN HASAR]: araç komut durumunu yazamadı';
  END IF;

  -- 6d. MEŞRU OKUMA: eşleşmiş kullanıcı komut/telemetri/konum/olay okur
  r := pg_temp.as_user('authenticated', ua, format($q$SELECT count(*)::text FROM public.vehicle_commands WHERE vehicle_id = %L$q$, va));
  IF r::int < 1 THEN RAISE EXCEPTION 'HALKA 6d DÜŞTÜ [YAN HASAR]: komut okunamadı: %', r; END IF;
  r := pg_temp.as_user('authenticated', ua, format($q$SELECT count(*)::text FROM public.vehicle_locations WHERE vehicle_id = %L$q$, va));
  IF r::int < 1 THEN RAISE EXCEPTION 'HALKA 6d DÜŞTÜ [YAN HASAR]: konum okunamadı: %', r; END IF;
  r := pg_temp.as_user('authenticated', ua, format($q$SELECT count(*)::text FROM public.vehicle_telemetry WHERE vehicle_id = %L$q$, va));
  IF r LIKE 'ERR:%' THEN RAISE EXCEPTION 'HALKA 6d DÜŞTÜ [YAN HASAR]: telemetri okunamadı: %', r; END IF;
  r := pg_temp.as_user('authenticated', ua, format($q$SELECT count(*)::text FROM public.vehicle_events WHERE vehicle_id = %L$q$, va::text));
  IF r::int < 1 THEN RAISE EXCEPTION 'HALKA 6d DÜŞTÜ [YAN HASAR]: olay okunamadı: %', r; END IF;
  -- DTC sonucu (result kolonu) eşleşmiş kullanıcıya okunur
  r := pg_temp.as_user('authenticated', ua, format($q$SELECT coalesce(result::text,'null') FROM public.vehicle_commands WHERE id = %L$q$, cid));
  IF r LIKE 'ERR:%' THEN RAISE EXCEPTION 'HALKA 6d DÜŞTÜ [YAN HASAR]: result okunamadı: %', r; END IF;

  RAISE NOTICE 'HALKA 6 GEÇTİ — istemci araç gerçeğini yazamıyor, araç RPC''si yazıyor, okuma yolları açık';
END
$ring6$;

-- ═════════════════════════════════════════════════════════════════════════
-- HALKA 7 — increment_command_retry KİMLİK İSTER
-- ═════════════════════════════════════════════════════════════════════════
DO $ring7$
DECLARE ua uuid; va uuid; vb uuid; ka text; kb text; r text; cid uuid; rc int;
BEGIN
  SELECT v::uuid INTO ua FROM ek WHERE k='ua'; SELECT v::uuid INTO va FROM ek WHERE k='va'; SELECT v::uuid INTO vb FROM ek WHERE k='vb';
  SELECT v INTO ka FROM ek WHERE k='ka'; SELECT v INTO kb FROM ek WHERE k='kb';
  INSERT INTO public.vehicle_commands (vehicle_id, type, payload, nonce, ttl) VALUES (va, 'horn', '{}', 'n-7', now() + interval '5 min') RETURNING id INTO cid;

  -- 7a. kimliksiz imza anon/authenticated'a kapalı
  r := pg_temp.as_user('anon', NULL, format($q$SELECT public.increment_command_retry(%L::uuid, 'x')::text$q$, cid));
  IF r NOT LIKE 'ERR:42501%' THEN RAISE EXCEPTION 'HALKA 7a DÜŞTÜ: anon kimliksiz retry çağırdı: %', r; END IF;
  r := pg_temp.as_user('authenticated', ua, format($q$SELECT public.increment_command_retry(%L::uuid, 'x')::text$q$, cid));
  IF r NOT LIKE 'ERR:42501%' THEN RAISE EXCEPTION 'HALKA 7a DÜŞTÜ: authenticated kimliksiz retry çağırdı: %', r; END IF;

  -- 7b. başka aracın anahtarı A'nın komutunu ilerletemez
  r := pg_temp.as_user('anon', NULL, format($q$SELECT public.increment_command_retry(%L, %L::uuid, 'x')::text$q$, kb, cid));
  SELECT retry_count INTO rc FROM public.vehicle_commands WHERE id = cid;
  IF rc <> 0 THEN RAISE EXCEPTION 'HALKA 7b DÜŞTÜ: B anahtarı A komutunu ilerletti'; END IF;
  -- 7c. geçersiz anahtar → istisna
  r := pg_temp.as_user('anon', NULL, format($q$SELECT public.increment_command_retry('bogus', %L::uuid, 'x')::text$q$, cid));
  IF r NOT LIKE 'ERR:P0001%' THEN RAISE EXCEPTION 'HALKA 7c DÜŞTÜ: geçersiz anahtar sessiz geçti: %', r; END IF;
  -- 7d. kendi anahtarı ilerletir (araç anon bağlanır)
  r := pg_temp.as_user('anon', NULL, format($q$SELECT public.increment_command_retry(%L, %L::uuid, 'x')::text$q$, ka, cid));
  SELECT retry_count INTO rc FROM public.vehicle_commands WHERE id = cid;
  IF rc <> 1 THEN RAISE EXCEPTION 'HALKA 7d DÜŞTÜ [YAN HASAR]: araç kendi komutunun retry''ını ilerletemedi: %', r; END IF;

  RAISE NOTICE 'HALKA 7 GEÇTİ — retry yalnız api_key kimliğiyle, yalnız kendi aracının komutunda';
END
$ring7$;

-- ═════════════════════════════════════════════════════════════════════════
-- HALKA 8 — ÇOK HESAP / ÇOK ARAÇ
-- ═════════════════════════════════════════════════════════════════════════
DO $ring8$
DECLARE ua uuid; ub uuid; va uuid; vb uuid; r text;
BEGIN
  SELECT v::uuid INTO ua FROM ek WHERE k='ua'; SELECT v::uuid INTO ub FROM ek WHERE k='ub';
  SELECT v::uuid INTO va FROM ek WHERE k='va'; SELECT v::uuid INTO vb FROM ek WHERE k='vb';

  -- B, A aracının satırını (meşru kolonlarıyla bile) görmez
  r := pg_temp.as_user('authenticated', ub, format($q$SELECT count(*)::text FROM public.vehicles WHERE id = %L$q$, va));
  IF r <> '0' THEN RAISE EXCEPTION 'HALKA 8 DÜŞTÜ: B, A aracını gördü: %', r; END IF;
  -- B, A adına komut yaratamaz (kritik olmayan bile)
  r := pg_temp.as_user('authenticated', ub, format(
    $q$INSERT INTO public.vehicle_commands (vehicle_id, created_by, type, payload, nonce, ttl) VALUES (%L, %L, 'lock', '{}', 'n-8', now() + interval '5 min') RETURNING id::text$q$, va, ub));
  IF r NOT LIKE 'ERR:42501%' THEN RAISE EXCEPTION 'HALKA 8 DÜŞTÜ: B, A aracına komut yazdı: %', r; END IF;
  -- B, A'nın komut/telemetri/konumunu okuyamaz
  r := pg_temp.as_user('authenticated', ub, format($q$SELECT count(*)::text FROM public.vehicle_commands WHERE vehicle_id = %L$q$, va));
  IF r <> '0' THEN RAISE EXCEPTION 'HALKA 8 DÜŞTÜ: B, A komutlarını okudu: %', r; END IF;
  r := pg_temp.as_user('authenticated', ub, format($q$SELECT count(*)::text FROM public.vehicle_locations WHERE vehicle_id = %L$q$, va));
  IF r <> '0' THEN RAISE EXCEPTION 'HALKA 8 DÜŞTÜ: B, A konumunu okudu: %', r; END IF;

  RAISE NOTICE 'HALKA 8 GEÇTİ — hesaplar arası sızma yok';
END
$ring8$;

\echo
\echo '  ✔ 083 KRİTİK YETKİ MATRİSİ: 8 HALKA DA GEÇTİ'
\echo

ROLLBACK;
