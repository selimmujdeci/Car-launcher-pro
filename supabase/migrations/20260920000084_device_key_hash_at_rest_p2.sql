-- 20260920000084_device_key_hash_at_rest_p2.sql
-- ══════════════════════════════════════════════════════════════════════════
-- MRI WAVE 3 — F-06/K: CİHAZ ANAHTARI AT-REST HASH (071'in AŞAMA 2'si)
-- "STORED HASH != LOGIN TOKEN"
--
-- DURUM: PREPARED — NOT APPLIED. Bu dosya üretime UYGULANMAMIŞTIR.
-- GERİ DÖNÜŞSÜZ VERİ DÖNÜŞÜMÜ içerir; yedek kolon ile korunur (bkz. §2).
--
-- ── GERÇEK (HEAD üzerinde yeniden ölçüldü) ────────────────────────────────
-- 071 (2026-08-22) ölçmüştü: `vehicles.api_key_hash` 834/834 satırda DÜZ METİN
-- UUID tutar; Aşama 2 (yerinde hash) HİÇ yazılmadı. Bugün 12 cihaz RPC'si
-- kimliği şu ifadeyle çözer:
--     api_key_hash = sha256(p_api_key)  OR  coalesce(api_key_hash, api_key) = p_api_key
-- İkinci dal "dev fallback" DEĞİL, üretimin TEK çalışan yoludur (kolon düz).
-- Sonuç: kolonu okuyan (DB sızıntısı, yedek, log) anahtarı DOĞRUDAN kullanır.
-- `upload_vehicle_trip` (074) ise YALNIZ düz dalı taşır — hash'e geçince o da
-- kırılırdı; bu dosya onu da hash dalına taşır.
--
-- 083 eşleşmiş istemcinin kolonu OKUMASINI kapattı (kolon yetkisi). Bu dosya
-- kolonun İÇERİĞİNİ credential olmaktan çıkarır: saklanan = sha256(anahtar).
-- Cihaz HÂLÂ ham anahtarı gönderir (değişiklik YOK); sunucu sha256 dalıyla
-- eşler. Saklanan hash'i `p_api_key` olarak gönderen REDDEDİLİR:
-- sha256(H) ≠ H ve düz dal artık yoktur.
--
-- ── NEDEN DİNAMİK YENİDEN YAZIM ───────────────────────────────────────────
-- 071'in dersi: 12 fonksiyonun gövdesini elle kopyalamak üretim kimlik
-- doğrulamasını tek satır hatayla öldürür. Bu dosya `pg_get_functiondef()`
-- ile MEVCUT tanımı alır, YALNIZ karşılaştırma ifadesini regex ile daraltır ve
-- yeniden yaratır. Sonra HİÇBİR public fonksiyonda düz karşılaştırma
-- kalmadığını ve 12 fonksiyonun hepsinde hash dalı olduğunu DOĞRULAR.
--
-- ── UYUMLULUK ─────────────────────────────────────────────────────────────
-- ESKİ APK + YENİ DB : cihaz ham anahtar gönderir → sha256 dalı eşler → ÇALIŞIR.
-- YENİ APK + ESKİ DB : APK değişmedi → aynı.
-- Web `verifyApiKey(raw, api_key_hash)` = sha256(raw)===kolon → 071'in
-- öngördüğü gibi DOĞRU hâle gelir (o rotalar zaten 410 ile kapalı).
--
-- ── GERİ ALMA ─────────────────────────────────────────────────────────────
-- `api_key_plain_backup` (istemciye KAPALI; 083 kolon listesi yeni kolonu
-- otomatik dışarıda bırakır) ham değeri tutar. Aşama 3 (ayrı tur, saha
-- doğrulaması sonrası) yedeği düşürür. Geri alma = kolonu yedekten doldurup
-- düz dalı geri koymak — o da ayrı, onaylı bir dosya olmalıdır.
--
-- KOLON DÜŞÜRÜLMEZ · SATIR SİLİNMEZ · RLS DEĞİŞMEZ · CİHAZ DEĞİŞMEZ.
-- ══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 0. ÖN KOŞULLAR ────────────────────────────────────────────────────────
DO $pre$
DECLARE v_sema text; v_plain int; v_hashed int;
BEGIN
  SELECT n.nspname INTO v_sema
  FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'pgcrypto';
  IF v_sema IS DISTINCT FROM 'extensions' THEN
    RAISE EXCEPTION '084 ÖN KOŞUL: pgcrypto `extensions` şemasında değil (%) — digest() dalları çözülemez.', coalesce(v_sema,'YOK');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='vehicles' AND column_name='api_key_hash') THEN
    RAISE EXCEPTION '084 ÖN KOŞUL: vehicles.api_key_hash YOK.';
  END IF;
  IF to_regprocedure('public.push_vehicle_event(text,text,jsonb)') IS NULL
     OR to_regprocedure('public.fetch_pending_vehicle_commands(text,integer,integer)') IS NULL
     OR to_regprocedure('public.register_vehicle(text,text)') IS NULL THEN
    RAISE EXCEPTION '084 ÖN KOŞUL: cihaz RPC''leri eksik — 071/069/072 uygulanmamış.';
  END IF;
  /* Denklik kanıtı: sha256(x::bytea) = digest(x,'sha256') (071 & 082 iki
     farklı yazım kullanır; ikisi de aynı baytları hash'lemeli). */
  IF encode(sha256('probe-key'::bytea), 'hex') <> encode(extensions.digest('probe-key', 'sha256'), 'hex')
     OR encode(sha256('probe-key'::bytea), 'hex') <> encode(sha256(convert_to('probe-key', 'UTF8')), 'hex') THEN
    RAISE EXCEPTION '084 ÖN KOŞUL: sha256 yazımları eşdeğer değil.';
  END IF;
  SELECT count(*) FILTER (WHERE coalesce(api_key_hash, api_key) IS NOT NULL AND (api_key_hash IS NULL OR api_key_hash !~ '^[0-9a-f]{64}$')),
         count(*) FILTER (WHERE api_key_hash ~ '^[0-9a-f]{64}$')
    INTO v_plain, v_hashed
  FROM public.vehicles;
  RAISE NOTICE '084 ÖNCESİ: düz anahtarlı satır = %, hash''li satır = %', v_plain, v_hashed;
END
$pre$;

-- ── 1. YEDEK KOLON (istemciye KAPALI) ─────────────────────────────────────
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS api_key_plain_backup text;
REVOKE ALL (api_key_plain_backup) ON public.vehicles FROM anon, authenticated, PUBLIC;
COMMENT ON COLUMN public.vehicles.api_key_plain_backup IS
  '084 geri alma yedeği: hash''lenmeden önceki ham cihaz anahtarı. İstemciye '
  'KAPALI. Aşama 3''te (saha doğrulaması sonrası, ayrı dosya) DÜŞÜRÜLÜR.';

-- ── 2. VERİ: düz anahtar → sha256 (ham değer yedeğe) ──────────────────────
UPDATE public.vehicles
   SET api_key_plain_backup = coalesce(api_key_plain_backup, coalesce(api_key_hash, api_key)),
       api_key_hash         = encode(sha256(convert_to(coalesce(api_key_hash, api_key), 'UTF8')), 'hex'),
       api_key              = NULL
 WHERE coalesce(api_key_hash, api_key) IS NOT NULL
   AND (api_key_hash IS NULL OR api_key_hash !~ '^[0-9a-f]{64}$');

/* Zaten hash'li satırda ayrıca düz `api_key` kalmışsa onu da yedekle ve sil —
   hiçbir fonksiyon artık `api_key` kolonunu okumayacak. */
UPDATE public.vehicles
   SET api_key_plain_backup = coalesce(api_key_plain_backup, api_key),
       api_key              = NULL
 WHERE api_key IS NOT NULL;

-- ── 3. FONKSİYONLAR: düz dal kaldırılır, hash dalı garanti edilir ──────────
DO $rewrite$
DECLARE
  r        record;
  v_def    text;
  v_new    text;
  v_count  int := 0;
  v_sha    constant text := 'api_key_hash = encode(sha256(p_api_key::bytea), ''hex'')';
BEGIN
  FOR r IN
    SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS args, p.prosrc
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prosrc ~ 'p_api_key'
       AND (p.prosrc ~ 'coalesce\(api_key_hash,\s*api_key\)\s*=\s*p_api_key'
            OR p.prosrc ~ 'api_key_hash\s*=\s*p_api_key'
            OR p.prosrc ~ '\mapi_key\s*=\s*p_api_key')
     ORDER BY p.proname
  LOOP
    v_def := pg_get_functiondef(r.oid);
    v_new := v_def;
    -- (a) "… OR coalesce(api_key_hash, api_key) = p_api_key"  → kaldır
    v_new := regexp_replace(v_new, '\s+OR\s+coalesce\(api_key_hash,\s*api_key\)\s*=\s*p_api_key', '', 'g');
    -- (b) "… OR api_key_hash = p_api_key OR api_key = p_api_key" → kaldır
    v_new := regexp_replace(v_new, '\s+OR\s+api_key_hash\s*=\s*p_api_key\s+OR\s+api_key\s*=\s*p_api_key', '', 'g');
    -- (c) "… OR api_key_hash = p_api_key" → kaldır
    v_new := regexp_replace(v_new, '\s+OR\s+api_key_hash\s*=\s*p_api_key', '', 'g');
    -- (d) tek başına düz karşılaştırma (upload_vehicle_trip) → hash dalı
    v_new := regexp_replace(v_new, 'coalesce\(api_key_hash,\s*api_key\)\s*=\s*p_api_key', v_sha, 'g');

    IF v_new = v_def THEN
      RAISE EXCEPTION '084 YENİDEN YAZIM: %(%) desen eşleşmedi — elle incele', r.proname, r.args;
    END IF;
    IF v_new !~ 'sha256\(p_api_key' AND v_new !~ 'digest\(p_api_key' THEN
      RAISE EXCEPTION '084 YENİDEN YAZIM: %(%) hash dalı olmadan kalırdı — DURDU', r.proname, r.args;
    END IF;
    EXECUTE v_new;
    v_count := v_count + 1;
    RAISE NOTICE '084 daraltıldı: %(%)', r.proname, r.args;
  END LOOP;
  /* Sayı kapı DEĞİLDİR (ilk uygulamada 13, yeniden uygulamada 0..n olabilir —
     083 tekrar uygulanırsa yalnız increment_command_retry çift-okumayla gelir).
     Gerçek kapı §5: hiçbir çağrılabilir fonksiyonda düz dal kalmadı ve 13 cihaz
     RPC'sinin hepsinde hash dalı var. */
  RAISE NOTICE '084: % fonksiyon daraltıldı', v_count;
END
$rewrite$;

-- ── 4. register_vehicle: yeni cihazda HASH saklanır, ham anahtar BİR KEZ döner ─
DO $reg$
DECLARE v_def text; v_new text; v_oid oid := to_regprocedure('public.register_vehicle(text,text)');
BEGIN
  v_def := pg_get_functiondef(v_oid);
  IF v_def LIKE '%encode(sha256(convert_to(v_api_key%' THEN
    RAISE NOTICE '084: register_vehicle zaten hash saklıyor';
    RETURN;
  END IF;
  IF (length(v_def) - length(replace(v_def, 'p_device_id, v_api_key)', ''))) / length('p_device_id, v_api_key)') <> 1 THEN
    RAISE EXCEPTION '084 register_vehicle: INSERT deseni tam bir kez bulunmalıydı — elle incele';
  END IF;
  v_new := replace(v_def, 'p_device_id, v_api_key)',
                   'p_device_id, encode(sha256(convert_to(v_api_key, ''UTF8'')), ''hex''))');
  EXECUTE v_new;
END
$reg$;

-- ── 4b. pair_vehicle(text): uykudaki düz-anahtar yolu KAPATILIR ──────────
-- Taban fonksiyonu: eşleştirme koduyla aracın HAM anahtarını çağırana
-- döndürür ve anahtarsız araca DÜZ metin anahtar YAZAR. Çağıranı yok
-- (`/api/pwa/pair` 410 ile kapalı; kanonik yol `pair_vehicle_to_user`).
-- anon/authenticated zaten çağıramıyordu; service_role da kapatılır — hash
-- sonrası bu gövde ya hash'i "api_key" diye döndürür ya da düz anahtar
-- yazardı. DROP EDİLMEZ (072 kuralı), yalnız çağrılamaz hâle gelir.
DO $pv$
BEGIN
  IF to_regprocedure('public.pair_vehicle(text)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.pair_vehicle(text) FROM PUBLIC, anon, authenticated, service_role;
  END IF;
END
$pv$;

-- ── 5. DOĞRULAMA (fail-closed) ────────────────────────────────────────────
DO $verify$
DECLARE n int; bad text; v_plain int;
BEGIN
  SELECT count(*) INTO v_plain FROM public.vehicles
   WHERE coalesce(api_key_hash, api_key) IS NOT NULL AND (api_key_hash IS NULL OR api_key_hash !~ '^[0-9a-f]{64}$');
  IF v_plain > 0 THEN RAISE EXCEPTION '084 DOĞRULAMA: % satır hâlâ düz anahtar taşıyor', v_plain; END IF;
  IF EXISTS (SELECT 1 FROM public.vehicles WHERE api_key IS NOT NULL) THEN
    RAISE EXCEPTION '084 DOĞRULAMA: api_key kolonu boşaltılmadı';
  END IF;
  /* yedek ile hash tutarlı mı */
  SELECT count(*) INTO n FROM public.vehicles
   WHERE api_key_plain_backup IS NOT NULL
     AND api_key_hash <> encode(sha256(convert_to(api_key_plain_backup, 'UTF8')), 'hex');
  IF n > 0 THEN RAISE EXCEPTION '084 DOĞRULAMA: % satırda hash ≠ sha256(yedek)', n; END IF;

  /* hiçbir public fonksiyonda düz karşılaştırma kalmadı */
  /* (hiçbir rolün çağıramadığı uykudaki gövdeler — pair_vehicle — hariç) */
  SELECT string_agg(p.proname, ', ') INTO bad
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND (p.prosrc ~ 'coalesce\(api_key_hash,\s*api_key\)'
          OR p.prosrc ~ 'api_key_hash\s*=\s*p_api_key'
          OR p.prosrc ~ '\mapi_key\s*=\s*p_api_key')
     AND (has_function_privilege('anon', p.oid, 'EXECUTE')
          OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
          OR has_function_privilege('service_role', p.oid, 'EXECUTE'));
  IF bad IS NOT NULL THEN RAISE EXCEPTION '084 DOĞRULAMA: düz karşılaştırma duruyor: %', bad; END IF;

  /* 12 cihaz fonksiyonunun hepsinde hash dalı var */
  SELECT string_agg(f, ', ') INTO bad
    FROM unnest(ARRAY['delete_geofence_zone','fetch_pending_vehicle_commands','get_active_driver_assignment',
                      'get_geofence_zones','publish_device_public_key','push_geofence_zone','push_vehicle_event',
                      'record_vehicle_identity','refresh_linking_code','register_vehicle_push_token',
                      'update_command_status','upload_vehicle_trip','increment_command_retry']) AS f
   WHERE NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                      WHERE n.nspname='public' AND p.proname = f
                        AND (p.prosrc ~ 'sha256\(p_api_key' OR p.prosrc ~ 'digest\(p_api_key'));
  IF bad IS NOT NULL THEN RAISE EXCEPTION '084 DOĞRULAMA: hash dalı olmayan cihaz RPC''si: %', bad; END IF;

  /* register_vehicle artık düz anahtar SAKLAMAZ */
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='register_vehicle'
                  AND prosrc LIKE '%encode(sha256(convert_to(v_api_key%') THEN
    RAISE EXCEPTION '084 DOĞRULAMA: register_vehicle hash saklamıyor';
  END IF;

  /* yedek kolon istemciye kapalı */
  IF has_column_privilege('authenticated', 'public.vehicles', 'api_key_plain_backup', 'SELECT')
     OR has_column_privilege('anon', 'public.vehicles', 'api_key_plain_backup', 'SELECT') THEN
    RAISE EXCEPTION '084 DOĞRULAMA: yedek kolon istemciye açık';
  END IF;
  RAISE NOTICE '084 OK: cihaz anahtarı at-rest sha256; düz dal yok; register_vehicle hash saklıyor.';
END
$verify$;

COMMIT;
