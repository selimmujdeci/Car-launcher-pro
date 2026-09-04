-- ═══════════════════════════════════════════════════════════════════════════
-- 068  CİHAZ ANAHTARI ÇİFT OKUMA MATRİSİ  (RISK-01 · Aşama 1)
--
--   npm run test:devicekey
--
-- ── NEDEN VAR ─────────────────────────────────────────────────────────────
-- Bu ÜRETİM KİMLİK DOĞRULAMASIDIR ve dönüşüm GERİ ALINAMAZ: kolon bir kez
-- hash'lenirse düz metin kaybolur; bir fonksiyon atlanmışsa o cihazlar bir
-- daha ASLA doğrulanamaz.
--
-- Bu yüzden matris yalnız "yeni biçim çalışıyor mu" diye bakmaz. Asıl soru
-- ikisidir:
--   ① ESKİ biçim HÂLÂ çalışıyor mu?   (Aşama 1 EKLEMELİDİR — kırmamalı)
--   ② AŞAMA 2 uygulanınca cihaz ANAHTARINI DEĞİŞTİRMEDEN çalışmaya devam
--      ediyor mu?  (cihaz-şeffaflık — geçişin tüm dayanağı)
--
-- ② HALKA 4'te GERÇEKTEN simüle edilir: kolon yerinde hash'lenir ve AYNI
-- ham anahtarla doğrulama tekrar denenir. Bu kanıt olmadan Aşama 2
-- üretimde ÇALIŞTIRILMAMALIDIR.
--
-- Yalnız YEREL veritabanında koşar ve `ROLLBACK` ile biter.
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on
\pset pager off

BEGIN;

CREATE TEMP TABLE dk (k text PRIMARY KEY, v text);

-- ── Kurulum: üretimdeki ÜÇ satır biçimini de üret ────────────────────────
DO $setup$
DECLARE
  c uuid; v_legacy uuid; v_both uuid; v_new uuid;
  key_legacy text := gen_random_uuid()::text;   -- yalnız api_key dolu   (4 satır)
  key_both   text := gen_random_uuid()::text;   -- iki kolon AYNI değer  (56 satır)
  key_hashed text := gen_random_uuid()::text;   -- yalnız api_key_hash   (778 satır)
BEGIN
  INSERT INTO public.companies (name) VALUES ('DK_TEST_CO') RETURNING id INTO c;

  /* ÜRETİMDEKİ BİÇİM 1 — yalnız `api_key` (4 satır bu hâlde). */
  INSERT INTO public.vehicles (company_id, name, api_key)
  VALUES (c, 'DK_LEGACY', key_legacy) RETURNING id INTO v_legacy;

  /* ÜRETİMDEKİ BİÇİM 2 — iki kolon da dolu ve AYNI (56 satır). */
  INSERT INTO public.vehicles (company_id, name, api_key, api_key_hash)
  VALUES (c, 'DK_BOTH', key_both, key_both) RETURNING id INTO v_both;

  /* ÜRETİMDEKİ BİÇİM 3 — yalnız `api_key_hash`, DÜZ METİN (778 satır). */
  INSERT INTO public.vehicles (company_id, name, api_key_hash)
  VALUES (c, 'DK_HASHCOL', key_hashed) RETURNING id INTO v_new;

  INSERT INTO dk VALUES
    ('company', c::text), ('v_legacy', v_legacy::text), ('v_both', v_both::text),
    ('v_new', v_new::text), ('key_legacy', key_legacy), ('key_both', key_both),
    ('key_hashed', key_hashed);
END
$setup$;

-- ═════════════════════════════════════════════════════════════════════════
-- HALKA 1 — ESKİ BİÇİM HÂLÂ ÇALIŞIYOR (regresyon kapısı)
--
-- Aşama 1 EKLEMELİDİR. Bu halka düşerse üretimdeki TÜM cihazlar anında
-- kimlik doğrulayamaz hâle gelir.
-- ═════════════════════════════════════════════════════════════════════════
DO $ring1$
DECLARE res jsonb; k text; expect uuid;
BEGIN
  FOR k, expect IN
    SELECT 'key_legacy', (SELECT v FROM dk WHERE k='v_legacy')::uuid UNION ALL
    SELECT 'key_both',   (SELECT v FROM dk WHERE k='v_both')::uuid   UNION ALL
    SELECT 'key_hashed', (SELECT v FROM dk WHERE k='v_new')::uuid
  LOOP
    res := public.get_active_driver_assignment((SELECT v FROM dk WHERE dk.k = k));
    /* "Atama yok" DOĞRU cevaptır; aranan şey anahtarın TANINMASIDIR.
       Tanınmasaydı fonksiyon `invalid_api_key` FIRLATIRDI. */
    IF res IS NULL THEN
      RAISE EXCEPTION 'CIHAZ ANAHTARI HALKA 1 DUSTU -- % biciminde ESKI anahtar TANINMADI', k;
    END IF;
  END LOOP;
  RAISE NOTICE 'HALKA 1 gectI: uc uretim biciminde de ESKI anahtar hala calisiyor';
END
$ring1$;

-- ═════════════════════════════════════════════════════════════════════════
-- HALKA 2 — YANLIŞ ANAHTAR REDDEDİLİYOR (kapı gevşemedi)
-- ═════════════════════════════════════════════════════════════════════════
DO $ring2$
DECLARE ok boolean := false;
BEGIN
  BEGIN
    PERFORM public.get_active_driver_assignment(gen_random_uuid()::text);
  EXCEPTION WHEN OTHERS THEN ok := true;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'CIHAZ ANAHTARI HALKA 2 DUSTU -- BILINMEYEN anahtar kabul edildi';
  END IF;

  /* Boş ve biçimsiz anahtar da geçmemeli. */
  ok := false;
  BEGIN PERFORM public.get_active_driver_assignment(''); EXCEPTION WHEN OTHERS THEN ok := true; END;
  IF NOT ok THEN
    RAISE EXCEPTION 'CIHAZ ANAHTARI HALKA 2 DUSTU -- BOS anahtar kabul edildi';
  END IF;

  RAISE NOTICE 'HALKA 2 gectI: yanlis/bos anahtar reddediliyor';
END
$ring2$;

-- ═════════════════════════════════════════════════════════════════════════
-- HALKA 3 — SHA-256 BİÇİMİ ARTIK KABUL EDİLİYOR (ileri kapı)
--
-- Kolon hash tutuyorsa cihazın gönderdiği HAM anahtar eşleşmelidir.
-- ═════════════════════════════════════════════════════════════════════════
DO $ring3$
DECLARE raw text; vid uuid; res jsonb;
BEGIN
  raw := (SELECT v FROM dk WHERE k = 'key_hashed');
  vid := (SELECT v FROM dk WHERE k = 'v_new')::uuid;

  /* Bu satırı Aşama 2 sonrası hâline getir: kolonda ARTIK hash var. */
  UPDATE public.vehicles
     SET api_key_hash = encode(sha256(raw::bytea), 'hex')
   WHERE id = vid;

  res := public.get_active_driver_assignment(raw);
  IF res IS NULL THEN
    RAISE EXCEPTION
      'CIHAZ ANAHTARI HALKA 3 DUSTU -- kolon hash tutarken HAM anahtar TANINMADI. '
      'Asama 2 uygulanirsa bu cihaz bir daha ASLA dogrulanamaz.';
  END IF;

  RAISE NOTICE 'HALKA 3 gectI: kolon hash tutarken ham anahtar taniniyor';
END
$ring3$;

-- ═════════════════════════════════════════════════════════════════════════
-- HALKA 4 — AŞAMA 2 SİMÜLASYONU: CİHAZ-ŞEFFAFLIK (bu dosyanın ASIL kanıtı)
--
-- Üretimdeki dönüşümün AYNISI uygulanır ve HER üretim biçimindeki cihaz,
-- anahtarını DEĞİŞTİRMEDEN doğrulanmaya devam etmelidir.
-- ═════════════════════════════════════════════════════════════════════════
DO $ring4$
DECLARE n integer; k text; res jsonb;
BEGIN
  /* AŞAMA 2 DÖNÜŞÜMÜ — üretimde çalıştırılacak olanla BİREBİR aynı:
     ① hash kolonu boş olan satırlarda düz `api_key` oraya taşınır
     ② UUID biçimli her değer YERİNDE hash'lenir
     Zaten sha256 biçiminde olan satır TEKRAR hash'lenmez (çift hash cihazı
     kilitlerdi) — bu yüzden filtre BİÇİME bakar, doluluğa değil. */
  UPDATE public.vehicles
     SET api_key_hash = api_key
   WHERE api_key_hash IS NULL AND api_key IS NOT NULL
     AND company_id = (SELECT v FROM dk WHERE k = 'company')::uuid;

  UPDATE public.vehicles
     SET api_key_hash = encode(sha256(api_key_hash::bytea), 'hex')
   WHERE api_key_hash ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     AND company_id = (SELECT v FROM dk WHERE k = 'company')::uuid;

  /* Artık ÜÇ satırın da kolonu sha256 olmalı. */
  SELECT count(*) INTO n FROM public.vehicles
   WHERE company_id = (SELECT v FROM dk WHERE k = 'company')::uuid
     AND api_key_hash !~ '^[0-9a-f]{64}$';
  IF n > 0 THEN
    RAISE EXCEPTION 'CIHAZ ANAHTARI HALKA 4 DUSTU -- % satir hash bicimine GECMEDI', n;
  END IF;

  /* ASIL KANIT: cihazlar AYNI ham anahtarla hâlâ doğrulanıyor mu. */
  FOREACH k IN ARRAY ARRAY['key_legacy','key_both','key_hashed'] LOOP
    res := public.get_active_driver_assignment((SELECT v FROM dk WHERE dk.k = k));
    IF res IS NULL THEN
      RAISE EXCEPTION
        'CIHAZ ANAHTARI HALKA 4 DUSTU -- Asama 2 sonrasi % biciminde cihaz KILITLENDI. '
        'Uretimde calistirilirsa o araclar geri getirilemez.', k;
    END IF;
  END LOOP;

  /* Yanlış anahtar hâlâ reddedilmeli — dönüşüm kapıyı gevşetmemeli. */
  n := 0;
  BEGIN PERFORM public.get_active_driver_assignment(gen_random_uuid()::text);
  EXCEPTION WHEN OTHERS THEN n := 1; END;
  IF n = 0 THEN
    RAISE EXCEPTION 'CIHAZ ANAHTARI HALKA 4 DUSTU -- donusum sonrasi BILINMEYEN anahtar kabul edildi';
  END IF;

  RAISE NOTICE 'HALKA 4 gectI: ASAMA 2 CIHAZ-SEFFAF — uc bicimde de anahtar degismeden calisiyor';
END
$ring4$;

-- ═════════════════════════════════════════════════════════════════════════
-- HALKA 5 — YÜKLEME YOLU DA AYNI KAPIDAN GEÇİYOR
--
-- Tek bir fonksiyonu sınamak yetmez: kimlik doğrulayan HER yol aynı
-- dönüşümden sağ çıkmalı.
-- ═════════════════════════════════════════════════════════════════════════
DO $ring5$
DECLARE raw text; res jsonb; t0 bigint;
BEGIN
  raw := (SELECT v FROM dk WHERE k = 'key_hashed');
  t0  := (extract(epoch FROM now()) * 1000)::bigint - 3600000;

  res := public.upload_vehicle_trip(
    raw, 'dk_trip_1', 'dk_trip_1', 1, t0, t0 + 300000,
    jsonb_build_object('distanceKm', 5.0, 'durationMin', 5, 'maxSpeedKmh', 60),
    70, 'HIGH', jsonb_build_object('distance','MEASURED'), '[]'::jsonb,
    jsonb_build_object('distance_source','MEASURED'), NULL, NULL, 1);

  IF (res ->> 'state') = 'REJECTED' THEN
    RAISE EXCEPTION 'CIHAZ ANAHTARI HALKA 5 DUSTU -- yukleme reddedildi: %', res;
  END IF;

  /* `push_vehicle_event` de aynı kapıyı kullanır. */
  BEGIN
    PERFORM public.push_vehicle_event(raw, 'dk_test', '{}'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'CIHAZ ANAHTARI HALKA 5 DUSTU -- push_vehicle_event anahtari TANIMADI';
  END;

  RAISE NOTICE 'HALKA 5 gectI: yukleme ve olay yollari da donusumden sag cikti';
END
$ring5$;

DO $done$ BEGIN RAISE NOTICE 'CIHAZ ANAHTARI: 5 HALKA DA GECTI.'; END $done$;

ROLLBACK;
