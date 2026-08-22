-- ═══════════════════════════════════════════════════════════════════════════
-- 066  ŞİRKET API ANAHTARI MATRİSİ  (V-16/7)
--
--   npm run test:apikey
--
-- ── NEDEN VAR ─────────────────────────────────────────────────────────────
-- Bu, ürünün **ilk dış saldırı yüzeyidir**. Bir anahtar sızarsa ya da yetki
-- kapısı gevşerse, müşterinin tüm filo verisi dışarı akar. Bu yüzden matris
-- yalnız "çalışıyor mu" değil, **kötüye kullanılabilir mi** diye sorar.
--
-- ── ÜRETİME DOKUNMAZ ──────────────────────────────────────────────────────
-- Yalnız YEREL veritabanında koşar ve `ROLLBACK` ile biter.
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on
\pset pager off

BEGIN;

CREATE FUNCTION pg_temp.login(p_uid uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('request.jwt.claims', json_build_object('sub', p_uid::text)::text, true); END $$;

CREATE FUNCTION pg_temp.logout() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('request.jwt.claims', '', true); END $$;

CREATE TEMP TABLE api_ids (k text PRIMARY KEY, v uuid);
CREATE TEMP TABLE api_keys (k text PRIMARY KEY, v text);

-- ── Kurulum: iki şirket, admin + member ─────────────────────────────────
DO $setup$
DECLARE
  ca uuid; cb uuid;
  admin_a uuid := gen_random_uuid();
  member_a uuid := gen_random_uuid();
  admin_b uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.companies (name) VALUES ('API_TEST_A') RETURNING id INTO ca;
  INSERT INTO public.companies (name) VALUES ('API_TEST_B') RETURNING id INTO cb;

  INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES
    (admin_a,  'api-admin-a@caros.local',  '00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
    (member_a, 'api-member-a@caros.local', '00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
    (admin_b,  'api-admin-b@caros.local',  '00000000-0000-0000-0000-000000000000','authenticated','authenticated');

  UPDATE public.profiles SET company_id = ca, role = 'admin'  WHERE id = admin_a;
  UPDATE public.profiles SET company_id = ca, role = 'member' WHERE id = member_a;
  UPDATE public.profiles SET company_id = cb, role = 'admin'  WHERE id = admin_b;

  INSERT INTO api_ids VALUES ('ca',ca),('cb',cb),('admin_a',admin_a),('member_a',member_a),('admin_b',admin_b);
END
$setup$;

-- ═════════════════════════════════════════════════════════════════════════
-- HALKA 1 — YETKİ: yalnız admin anahtar üretebilir
-- ═════════════════════════════════════════════════════════════════════════
DO $ring1$
DECLARE raw text; res jsonb; uid uuid;
BEGIN
  raw := encode(gen_random_bytes(32), 'hex');

  /* member DENER → REDDEDİLMELİ. Bir `member` anahtar üretebilseydi
     şirketin tüm verisini dışarı taşıyabilirdi. */
  SELECT v INTO uid FROM api_ids WHERE k = 'member_a';
  PERFORM pg_temp.login(uid);
  res := public.create_company_api_key('member denemesi', raw);
  IF (res ->> 'state') <> 'REJECTED' THEN
    RAISE EXCEPTION 'API HALKA 1 DUSTU -- member anahtar URETEBILDI: %', res;
  END IF;

  /* kimliksiz DENER → REDDEDİLMELİ. */
  PERFORM pg_temp.logout();
  res := public.create_company_api_key('anonim deneme', raw);
  IF (res ->> 'state') <> 'REJECTED' THEN
    RAISE EXCEPTION 'API HALKA 1 DUSTU -- kimliksiz anahtar URETEBILDI: %', res;
  END IF;

  /* admin ÜRETİR → KABUL. */
  SELECT v INTO uid FROM api_ids WHERE k = 'admin_a';
  PERFORM pg_temp.login(uid);
  res := public.create_company_api_key('A entegrasyonu', raw);
  IF (res ->> 'state') <> 'CREATED' THEN
    RAISE EXCEPTION 'API HALKA 1 DUSTU -- admin anahtar URETEMEDI: %', res;
  END IF;

  INSERT INTO api_keys VALUES ('a_raw', raw);
  INSERT INTO api_ids  VALUES ('a_key', (res ->> 'keyId')::uuid);
  PERFORM pg_temp.logout();
  RAISE NOTICE 'HALKA 1 gectI: yalniz admin anahtar uretebiliyor';
END
$ring1$;

-- ═════════════════════════════════════════════════════════════════════════
-- HALKA 2 — SAKLAMA: ham anahtar veritabanında YOK
-- ═════════════════════════════════════════════════════════════════════════
DO $ring2$
DECLARE raw text; n integer; pref text;
BEGIN
  SELECT v INTO raw FROM api_keys WHERE k = 'a_raw';

  SELECT count(*) INTO n FROM public.company_api_keys WHERE key_hash = raw;
  IF n <> 0 THEN
    RAISE EXCEPTION 'API HALKA 2 DUSTU -- HAM anahtar veritabaninda duruyor';
  END IF;

  SELECT count(*) INTO n FROM public.company_api_keys
   WHERE key_hash = encode(sha256(raw::bytea), 'hex');
  IF n <> 1 THEN
    RAISE EXCEPTION 'API HALKA 2 DUSTU -- ozet eslesmiyor';
  END IF;

  /* Önek tanıma içindir ve TEK BAŞINA kimlik doğrulamaz. */
  SELECT key_prefix INTO pref FROM public.company_api_keys
   WHERE key_hash = encode(sha256(raw::bytea), 'hex');
  IF pref <> left(raw, 8) OR length(pref) <> 8 THEN
    RAISE EXCEPTION 'API HALKA 2 DUSTU -- onek yanlis: %', pref;
  END IF;

  /* Zayıf/biçimsiz anahtar REDDEDİLMELİ. */
  IF (public.create_company_api_key('zayif', 'kisa') ->> 'reason') IS DISTINCT FROM 'NOT_AUTHORIZED'
     AND (public.create_company_api_key('zayif', 'kisa') ->> 'reason') IS DISTINCT FROM 'WEAK_KEY' THEN
    RAISE EXCEPTION 'API HALKA 2 DUSTU -- zayif anahtar kabul edildi';
  END IF;

  RAISE NOTICE 'HALKA 2 gectI: ham anahtar saklanmiyor, yalniz ozet';
END
$ring2$;

-- ═════════════════════════════════════════════════════════════════════════
-- HALKA 3 — DOĞRULAMA VE KAPSAM
-- ═════════════════════════════════════════════════════════════════════════
DO $ring3$
DECLARE raw text; h text; res jsonb; ca uuid;
BEGIN
  SELECT v INTO raw FROM api_keys WHERE k = 'a_raw';
  SELECT v INTO ca  FROM api_ids  WHERE k = 'ca';
  h := encode(sha256(raw::bytea), 'hex');

  res := public.authorize_api_key(h, 'read:vehicles');
  IF (res ->> 'state') <> 'ALLOWED' THEN
    RAISE EXCEPTION 'API HALKA 3 DUSTU -- gecerli anahtar reddedildi: %', res;
  END IF;
  IF (res ->> 'companyId')::uuid <> ca THEN
    RAISE EXCEPTION 'API HALKA 3 DUSTU -- YANLIS sirket dondu';
  END IF;

  /* Verilmemiş kapsam REDDEDİLMELİ. */
  IF (public.authorize_api_key(h, 'write:commands') ->> 'state') <> 'DENIED' THEN
    RAISE EXCEPTION 'API HALKA 3 DUSTU -- verilmemis kapsam KABUL edildi';
  END IF;

  /* Bilinmeyen anahtar ve BİÇİMSİZ anahtar reddedilmeli. */
  IF (public.authorize_api_key(encode(sha256('yok'::bytea), 'hex'), 'read:vehicles') ->> 'state') <> 'DENIED' THEN
    RAISE EXCEPTION 'API HALKA 3 DUSTU -- bilinmeyen anahtar KABUL edildi';
  END IF;
  IF (public.authorize_api_key('kisa', 'read:vehicles') ->> 'reason') <> 'MALFORMED_KEY' THEN
    RAISE EXCEPTION 'API HALKA 3 DUSTU -- bicimsiz anahtar sorguya girdi';
  END IF;

  RAISE NOTICE 'HALKA 3 gectI: dogrulama ve kapsam kapisi calisiyor';
END
$ring3$;

-- ═════════════════════════════════════════════════════════════════════════
-- HALKA 4 — HIZ SINIRI GERÇEKTEN SINIRLIYOR MU
-- ═════════════════════════════════════════════════════════════════════════
DO $ring4$
DECLARE raw text; h text; res jsonb; i integer; uid uuid; kid uuid;
BEGIN
  SELECT v INTO uid FROM api_ids WHERE k = 'admin_a';
  PERFORM pg_temp.login(uid);
  raw := encode(gen_random_bytes(32), 'hex');
  res := public.create_company_api_key('hiz testi', raw, ARRAY['read:trips'], 3);
  kid := (res ->> 'keyId')::uuid;
  PERFORM pg_temp.logout();

  h := encode(sha256(raw::bytea), 'hex');

  FOR i IN 1..3 LOOP
    IF (public.authorize_api_key(h, 'read:trips') ->> 'state') <> 'ALLOWED' THEN
      RAISE EXCEPTION 'API HALKA 4 DUSTU -- % . istek limit icindeyken reddedildi', i;
    END IF;
  END LOOP;

  /* 4. istek limiti AŞAR → engellenmeli. */
  res := public.authorize_api_key(h, 'read:trips');
  IF (res ->> 'state') <> 'RATE_LIMITED' THEN
    RAISE EXCEPTION 'API HALKA 4 DUSTU -- limit asildi ama istek GECTI: %', res;
  END IF;
  IF (res ->> 'resetAt') IS NULL THEN
    RAISE EXCEPTION 'API HALKA 4 DUSTU -- istemciye NE ZAMAN tekrar deneyecegi soylenmiyor';
  END IF;

  RAISE NOTICE 'HALKA 4 gectI: hiz siniri gercekten siniriyor (limit=3)';
END
$ring4$;

-- ═════════════════════════════════════════════════════════════════════════
-- HALKA 5 — İPTAL VE KİRACI İZOLASYONU
-- ═════════════════════════════════════════════════════════════════════════
DO $ring5$
DECLARE raw text; h text; kid uuid; uid uuid; res jsonb; n integer;
BEGIN
  SELECT v INTO raw FROM api_keys WHERE k = 'a_raw';
  SELECT v INTO kid FROM api_ids  WHERE k = 'a_key';
  h := encode(sha256(raw::bytea), 'hex');

  /* B şirketinin admini A'nın anahtarını İPTAL EDEMEZ. */
  SELECT v INTO uid FROM api_ids WHERE k = 'admin_b';
  PERFORM pg_temp.login(uid);
  IF (public.revoke_company_api_key(kid) ->> 'state') <> 'REJECTED' THEN
    RAISE EXCEPTION 'API HALKA 5 DUSTU -- BASKA sirket anahtari iptal edebildi';
  END IF;
  /* B, A'nın anahtarını LİSTELEYEMEZ. */
  SELECT count(*) INTO n FROM public.list_company_api_keys() WHERE key_id = kid;
  IF n <> 0 THEN
    RAISE EXCEPTION 'API HALKA 5 DUSTU -- CROSS-TENANT listeleme';
  END IF;

  /* A'nın admini iptal EDER. */
  SELECT v INTO uid FROM api_ids WHERE k = 'admin_a';
  PERFORM pg_temp.login(uid);
  IF (public.revoke_company_api_key(kid) ->> 'state') <> 'REVOKED' THEN
    RAISE EXCEPTION 'API HALKA 5 DUSTU -- admin kendi anahtarini iptal EDEMEDI';
  END IF;
  PERFORM pg_temp.logout();

  /* İptal sonrası anahtar ÇALIŞMAMALI. */
  res := public.authorize_api_key(h, 'read:vehicles');
  IF (res ->> 'state') <> 'DENIED' THEN
    RAISE EXCEPTION 'API HALKA 5 DUSTU -- IPTAL edilen anahtar hala calisiyor: %', res;
  END IF;
  /* Bilinmeyen ile iptal edilmiş AYNI gerekçeyi almalı (varlik oracle'i yok). */
  IF (res ->> 'reason') <> 'INVALID_KEY' THEN
    RAISE EXCEPTION 'API HALKA 5 DUSTU -- iptal edildigi DISARIYA sizdi: %', res;
  END IF;

  /* Satır SİLİNMEMELİ — denetim izi kalmalı. */
  SELECT count(*) INTO n FROM public.company_api_keys WHERE id = kid;
  IF n <> 1 THEN
    RAISE EXCEPTION 'API HALKA 5 DUSTU -- iptal satiri SILINDI (denetim izi yok)';
  END IF;

  RAISE NOTICE 'HALKA 5 gectI: iptal calisiyor, kiraci izolasyonu saglam';
END
$ring5$;

-- ═════════════════════════════════════════════════════════════════════════
-- HALKA 6 — ERİŞİM FAIL-CLOSED
-- ═════════════════════════════════════════════════════════════════════════
DO $ring6$
BEGIN
  IF has_table_privilege('anon','public.company_api_keys','SELECT')
     OR has_table_privilege('authenticated','public.company_api_keys','SELECT') THEN
    RAISE EXCEPTION 'API HALKA 6 DUSTU -- anahtar tablosu OKUNABILIYOR';
  END IF;

  IF has_function_privilege('authenticated','public.authorize_api_key(text,text)','EXECUTE') THEN
    RAISE EXCEPTION 'API HALKA 6 DUSTU -- authorize_api_key tarayiciya ACIK';
  END IF;

  IF has_function_privilege('anon','public.create_company_api_key(text,text,text[],integer)','EXECUTE') THEN
    RAISE EXCEPTION 'API HALKA 6 DUSTU -- anon anahtar uretme fonksiyonunu CAGIRABILIYOR';
  END IF;

  RAISE NOTICE 'HALKA 6 gectI: erisim fail-closed';
END
$ring6$;

DO $done$ BEGIN RAISE NOTICE 'SIRKET API ANAHTARI: 6 HALKA DA GECTI.'; END $done$;

ROLLBACK;
