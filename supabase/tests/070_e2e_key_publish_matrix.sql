-- ═══════════════════════════════════════════════════════════════════════════
-- 070  E2E AÇIK ANAHTAR YAYINI MATRİSİ  (P0-001B)
--
--   npm run test:e2ekey
--
-- ── NE KANITLAR ───────────────────────────────────────────────────────────
-- `lock · unlock · horn · alarm_on · alarm_off · lights_on · clear_dtc`
-- komutları araçta E2E zarfı ŞART koşar; zarf da aracın yayınladığı açık
-- anahtarla üretilir. O anahtar üretimde HİÇ yayınlanamıyordu (kolon yoktu ve
-- kolon eklense bile araç anon bağlandığı için RLS UPDATE'i engelliyordu).
--
--   HALKA 1  geçerli anahtar yayınlanır ve OKUNABİLİR
--   HALKA 2  geçersiz api_key → istisna, hiçbir satır yazılmaz
--   HALKA 3  BOZUK biçim reddedilir ve kolon KİRLETİLMEZ (fail-closed)
--   HALKA 4  desteklenmeyen algoritma reddedilir
--   HALKA 5  bir araç BAŞKA aracın anahtarını EZEMEZ (MITM kapısı)
--   HALKA 6  aynı anahtar tekrar yayınlanınca damga İLERLEMEZ, rotasyon ölçülür
--   HALKA 7  yetki yüzeyi: PUBLIC kapalı · anon açık (cihaz yayın yapabilmeli)
--
-- Yalnız YEREL veritabanında koşar ve `ROLLBACK` ile biter.
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on
\pset pager off

BEGIN;

CREATE TEMP TABLE ek (k text PRIMARY KEY, v text);

/* Gerçek biçimde P-256 SPKI base64 (124 karakter) — uzunluk ve alfabe
   kapısının GERÇEK bir anahtarı elemediğini de kanıtlar. */
DO $setup$
DECLARE
  c uuid; v1 uuid; v2 uuid;
  k1 text := gen_random_uuid()::text;
  k2 text := gen_random_uuid()::text;
BEGIN
  INSERT INTO public.companies (name) VALUES ('E2E_TEST_CO') RETURNING id INTO c;
  INSERT INTO public.vehicles (company_id, name, api_key_hash)
  VALUES (c, 'E2E_ARAC_1', k1) RETURNING id INTO v1;
  INSERT INTO public.vehicles (company_id, name, api_key_hash)
  VALUES (c, 'E2E_ARAC_2', k2) RETURNING id INTO v2;

  INSERT INTO ek VALUES
    ('v1', v1::text), ('v2', v2::text), ('k1', k1), ('k2', k2),
    ('key_a', 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE' || replace(encode(gen_random_bytes(66),'base64'), E'\n', '')),
    ('key_b', 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE' || replace(encode(gen_random_bytes(66),'base64'), E'\n', ''));
END
$setup$;

-- ═════════════════════════════════════════════════════════════════════════
-- HALKA 1 — YAYIN ÇALIŞIR VE OKUNABİLİR
-- Bu halka düşerse fiziksel komutların tamamı ölü kalır.
-- ═════════════════════════════════════════════════════════════════════════
DO $ring1$
DECLARE res jsonb; v1 uuid; k1 text; key_a text; stored text;
BEGIN
  SELECT v::uuid INTO v1 FROM ek WHERE k='v1';
  SELECT v INTO k1     FROM ek WHERE k='k1';
  SELECT v INTO key_a  FROM ek WHERE k='key_a';

  res := public.publish_device_public_key(k1, key_a);
  IF coalesce((res->>'ok')::boolean, false) <> true THEN
    RAISE EXCEPTION 'HALKA 1 DUSTU: yayin reddedildi → %', res;
  END IF;

  SELECT e2e_public_key INTO stored FROM public.vehicles WHERE id = v1;
  IF stored IS DISTINCT FROM key_a THEN
    RAISE EXCEPTION 'HALKA 1 DUSTU: anahtar kolona yazilmadi';
  END IF;

  IF (SELECT e2e_key_alg FROM public.vehicles WHERE id=v1) <> 'ECDH-P256-AES-GCM-256' THEN
    RAISE EXCEPTION 'HALKA 1 DUSTU: algoritma yazilmadi';
  END IF;
  IF (SELECT e2e_key_published_at FROM public.vehicles WHERE id=v1) IS NULL THEN
    RAISE EXCEPTION 'HALKA 1 DUSTU: yayin damgasi bos';
  END IF;
  IF coalesce((res->>'rotated')::boolean, false) <> true THEN
    RAISE EXCEPTION 'HALKA 1 DUSTU: ilk yayin rotated=true olmali';
  END IF;

  RAISE NOTICE 'HALKA 1 GECTI — acik anahtar yayinlaniyor ve okunuyor';
END
$ring1$;

-- ═════════════════════════════════════════════════════════════════════════
-- HALKA 2 — GEÇERSİZ api_key REDDEDİLİR
-- ═════════════════════════════════════════════════════════════════════════
DO $ring2$
DECLARE ok boolean := false; key_a text; before_cnt int; after_cnt int;
BEGIN
  SELECT v INTO key_a FROM ek WHERE k='key_a';
  SELECT count(*) INTO before_cnt FROM public.vehicles WHERE e2e_public_key IS NOT NULL;

  BEGIN
    PERFORM public.publish_device_public_key('sahte-anahtar-yok', key_a);
  EXCEPTION WHEN OTHERS THEN
    ok := SQLERRM ILIKE '%invalid_api_key%';
  END;

  IF NOT ok THEN
    RAISE EXCEPTION 'HALKA 2 DUSTU: gecersiz api_key ile yayin KABUL EDILDI';
  END IF;

  SELECT count(*) INTO after_cnt FROM public.vehicles WHERE e2e_public_key IS NOT NULL;
  IF after_cnt <> before_cnt THEN
    RAISE EXCEPTION 'HALKA 2 DUSTU: gecersiz cagri satir yazdi';
  END IF;

  RAISE NOTICE 'HALKA 2 GECTI — gecersiz kimlikle yayin yapilamiyor';
END
$ring2$;

-- ═════════════════════════════════════════════════════════════════════════
-- HALKA 3 — BOZUK BİÇİM REDDEDİLİR, KOLON KİRLETİLMEZ
--
-- Çöp bir değer yazılırsa telefon onu "yayınlanmış" sanır, `importKey`
-- patlar ve komut "şifrelenemedi" ile ölür — sessiz bir ölü uç doğardı.
-- ═════════════════════════════════════════════════════════════════════════
DO $ring3$
DECLARE res jsonb; v2 uuid; k2 text; bozuk text;
BEGIN
  SELECT v::uuid INTO v2 FROM ek WHERE k='v2';
  SELECT v INTO k2       FROM ek WHERE k='k2';

  FOREACH bozuk IN ARRAY ARRAY[
    'kisa',                                   -- çok kısa
    'bu bosluk iceriyor ve base64 degil!!',   -- alfabe dışı
    repeat('A', 600)                          -- tavanı aşan
  ] LOOP
    res := public.publish_device_public_key(k2, bozuk);
    IF coalesce((res->>'ok')::boolean, true) <> false
       OR res->>'reason' <> 'INVALID_KEY_FORMAT' THEN
      RAISE EXCEPTION 'HALKA 3 DUSTU: bozuk anahtar KABUL EDILDI → %', left(bozuk, 20);
    END IF;
  END LOOP;

  IF (SELECT e2e_public_key FROM public.vehicles WHERE id = v2) IS NOT NULL THEN
    RAISE EXCEPTION 'HALKA 3 DUSTU: reddedilen deger kolona YAZILDI';
  END IF;

  RAISE NOTICE 'HALKA 3 GECTI — bozuk anahtar reddediliyor, kolon temiz';
END
$ring3$;

-- ═════════════════════════════════════════════════════════════════════════
-- HALKA 4 — DESTEKLENMEYEN ALGORİTMA REDDEDİLİR
-- ═════════════════════════════════════════════════════════════════════════
DO $ring4$
DECLARE res jsonb; k2 text; key_b text;
BEGIN
  SELECT v INTO k2    FROM ek WHERE k='k2';
  SELECT v INTO key_b FROM ek WHERE k='key_b';

  res := public.publish_device_public_key(k2, key_b, 'RSA-2048-OAEP');
  IF coalesce((res->>'ok')::boolean, true) <> false
     OR res->>'reason' <> 'UNSUPPORTED_ALG' THEN
    RAISE EXCEPTION 'HALKA 4 DUSTU: taninmayan algoritma kabul edildi → %', res;
  END IF;

  RAISE NOTICE 'HALKA 4 GECTI — algoritma beyaz listesi calisiyor';
END
$ring4$;

-- ═════════════════════════════════════════════════════════════════════════
-- HALKA 5 — BİR ARAÇ BAŞKA ARACIN ANAHTARINI EZEMEZ
--
-- Ezebilseydi saldırgan kendi açık anahtarını kurbanın satırına yazıp
-- o araca giden komutları çözebilirdi (aktif MITM).
-- ═════════════════════════════════════════════════════════════════════════
DO $ring5$
DECLARE v1 uuid; k2 text; key_a text; key_b text;
BEGIN
  SELECT v::uuid INTO v1 FROM ek WHERE k='v1';
  SELECT v INTO k2       FROM ek WHERE k='k2';
  SELECT v INTO key_a    FROM ek WHERE k='key_a';
  SELECT v INTO key_b    FROM ek WHERE k='key_b';

  -- Araç 2 kendi anahtarıyla yayın yapar; araç 1'in satırı DEĞİŞMEMELİ.
  PERFORM public.publish_device_public_key(k2, key_b);

  IF (SELECT e2e_public_key FROM public.vehicles WHERE id = v1) IS DISTINCT FROM key_a THEN
    RAISE EXCEPTION 'HALKA 5 DUSTU: baska aracin anahtari EZILDI (MITM acik)';
  END IF;

  RAISE NOTICE 'HALKA 5 GECTI — arac yalniz KENDI satirini yaziyor';
END
$ring5$;

-- ═════════════════════════════════════════════════════════════════════════
-- HALKA 6 — AYNI ANAHTAR TEKRAR: DAMGA İLERLEMEZ, ROTASYON ÖLÇÜLÜR
--
-- Her bağlantıda damgayı tazelemek "anahtar bu an üretildi" yalanı olurdu;
-- gözlem yüzeyi bayat anahtarı taze sanardı.
-- ═════════════════════════════════════════════════════════════════════════
DO $ring6$
DECLARE res jsonb; v1 uuid; k1 text; key_a text; key_b text; t0 timestamptz; t1 timestamptz;
BEGIN
  SELECT v::uuid INTO v1 FROM ek WHERE k='v1';
  SELECT v INTO k1       FROM ek WHERE k='k1';
  SELECT v INTO key_a    FROM ek WHERE k='key_a';
  SELECT v INTO key_b    FROM ek WHERE k='key_b';

  SELECT e2e_key_published_at INTO t0 FROM public.vehicles WHERE id=v1;

  res := public.publish_device_public_key(k1, key_a);          -- AYNI anahtar
  IF coalesce((res->>'rotated')::boolean, true) <> false THEN
    RAISE EXCEPTION 'HALKA 6 DUSTU: ayni anahtar rotasyon sayildi';
  END IF;

  SELECT e2e_key_published_at INTO t1 FROM public.vehicles WHERE id=v1;
  IF t1 IS DISTINCT FROM t0 THEN
    RAISE EXCEPTION 'HALKA 6 DUSTU: ayni anahtarda damga ILERLEDI (bayat anahtar taze gorunur)';
  END IF;

  res := public.publish_device_public_key(k1, key_b);          -- FARKLI anahtar
  IF coalesce((res->>'rotated')::boolean, false) <> true THEN
    RAISE EXCEPTION 'HALKA 6 DUSTU: gercek rotasyon olculmedi';
  END IF;

  RAISE NOTICE 'HALKA 6 GECTI — rotasyon dogru olculuyor, damga yalan soylemiyor';
END
$ring6$;

-- ═════════════════════════════════════════════════════════════════════════
-- HALKA 7 — YETKİ YÜZEYİ
-- ═════════════════════════════════════════════════════════════════════════
DO $ring7$
BEGIN
  IF has_function_privilege('public', 'public.publish_device_public_key(text, text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'HALKA 7 DUSTU: yayin ucu PUBLIC''e acik';
  END IF;
  /* anon KALDIRILAMAZ: araç oturumsuz bağlanır. Bu satır düşerse hiçbir
     araç anahtarını yayınlayamaz ve fiziksel komutlar yeniden ölür. */
  IF NOT has_function_privilege('anon', 'public.publish_device_public_key(text, text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'HALKA 7 DUSTU: anon yayin yapamiyor — fiziksel komutlar olur';
  END IF;

  RAISE NOTICE 'HALKA 7 GECTI — yetki yuzeyi dogru';
END
$ring7$;

SELECT '7 HALKA DA GECTI' AS sonuc;

ROLLBACK;
