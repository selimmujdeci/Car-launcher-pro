-- 20260920000083_critical_command_server_authority.sql
-- ══════════════════════════════════════════════════════════════════════════
-- MRI WAVE 3 — N-2 + N-3 + F-06
-- KRİTİK KOMUT YETKİSİ SUNUCUDA · PIN DOĞRULAYICI · ARAÇ VERİSİ KOLON/YAZMA YETKİSİ
--
-- DURUM: PREPARED — NOT APPLIED. Bu dosya üretime UYGULANMAMIŞTIR.
--
-- ── N-2 · KÖK NEDEN (HEAD üzerinde yeniden ölçüldü) ──────────────────────
-- `fn_enforce_critical_pin` (baseline:891) `NEW.critical_auth_verified = true`
-- ise geçiyordu. `vehicle_commands` INSERT politikası (`commands: gonderebilir`)
-- eşleşmiş HER kullanıcıya açık ve kolon kısıtı yok → PWA `critical_auth_verified:
-- true` yazıp PIN kapısını kendi kendine açıyordu (`commandService.ts:265`,
-- `RemoteCommandPanel.tsx:42`). Üstüne PWA'nın PIN'i YALNIZ localStorage'da
-- (`criticalAuth.ts`) — `set_vehicle_pin` hiç çağrılmıyor → sunucuda PIN yok →
-- trigger "PIN tanımlı değil" deyip zaten geçiyordu. Yani PIN tiyatroydu.
--
-- ── N-3 · KÖK NEDEN ──────────────────────────────────────────────────────
-- `critical_pin_hash` = tuzsuz SHA-256(PIN) ve `verify_and_send_critical_command`
-- istemciden HASH alıp saklananla karşılaştırıyordu (`p_pin_hash`). 4 haneli
-- PIN'in tüm uzayı 10⁴; hash'i okuyan çevrimdışı saniyede kırar. Hash'i okuyan
-- ayrıca hash'i PIN YERİNE gönderebilirdi (pass-the-hash). Ve eşleşmiş
-- kullanıcı `vehicles` satırını TÜM kolonlarıyla okuyabiliyordu (F-06).
--
-- ── F-06 · KÖK NEDEN ─────────────────────────────────────────────────────
-- `vehicles: owner veya şirket select` satırı `is_paired` ile açıyor, tablo
-- GRANT'i tüm kolonları kapsıyor → eşleşmiş telefon `api_key`, `api_key_hash`,
-- `critical_pin_hash`, `pairing_code` okuyabiliyordu. Eşleşmiş kullanıcı ayrıca
-- `vehicle_telemetry` INSERT/UPDATE, `vehicle_locations` INSERT,
-- `vehicle_commands` UPDATE (status=completed dâhil) yapabiliyordu; sahip
-- `vehicle_events` INSERT edebiliyordu. Bunların hiçbirinin ÜRÜNDE istemci
-- yazıcısı yok (tarandı: tek meşru yazıcı `push_vehicle_event` /
-- `update_command_status` — api_key kimlikli SECURITY DEFINER). Ayrıca
-- `increment_command_retry(uuid,text)` KİMLİKSİZ ve anon'a açıktı: herkes
-- herhangi bir komutu `failed`a çekebiliyordu.
--
-- ── TASARIM ──────────────────────────────────────────────────────────────
-- 1. TEK kritik-komut listesi: `is_critical_command_type()` — trigger ve RPC
--    aynı fonksiyonu okur (PWA listesi ile parite testi: website/src/__tests__).
-- 2. Trigger istemci iddiasına BAKMAZ. Kritik komut YALNIZ aynı transaction
--    içinde `verify_and_send_critical_command`ın kurduğu işlem-yerel GUC
--    (`caros.critical_pin_ok = vehicle_id`) varsa girer; kolon değeri
--    SUNUCU tarafından yazılır. GUC PostgREST üzerinden kurulamaz (set_config
--    açık RPC değildir; her istek ayrı transaction).
-- 3. PIN doğrulayıcı: pgcrypto `crypt(pin, gen_salt('bf'))` — tuzlu, uyarlanabilir.
--    Ham PIN sunucuya TLS içinde gelir; sunucu doğrular, hash HİÇ istemciye
--    inmez. Eski SHA-256 biçimi TANINIR ve doğru PIN'de yerinde bcrypt'e
--    yükseltilir (yanlış PIN yükseltmez). Sonsuz legacy kabulü yok: yükseltme
--    ilk doğru girişte kesin.
-- 4. Çevrimiçi kaba kuvvet: `vehicle_events` (mevcut tablo, şema değişikliği
--    YOK) `critical_pin_failed` kayıtları — 15 dk'da ≥5 → `pin_locked`.
-- 5. Kolon yetkisi: `vehicles` için tablo SELECT/INSERT/UPDATE geri alınır,
--    AÇIK kolon listesi verilir (PostgREST `select=*` KULLANILMIYOR — tarandı).
-- 6. Araç gerçeği yazma yetkisi anon/authenticated'dan alınır; okuma aynen.
-- 7. `increment_command_retry` api_key kimliği ister; kimliksiz imza kapatılır.
--
-- Fail-closed: kritik komut + sunucu kanıtı yok → INSERT REDDEDİLİR
-- (aracın PIN'i olsun olmasın). PIN kayıtlı değilse RPC `pin_not_set` döner;
-- istemci `set_vehicle_pin` ile kaydeder ve yeniden gönderir.
--
-- VERİ SİLİNMEZ · KOLON DÜŞÜRÜLMEZ · TABLO YARATILMAZ · api_key biçimi DEĞİŞMEZ
-- (o 084'ün işi). Migration/DB/Edge/Vercel deploy YOK.
-- ══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 0. ÖN KOŞULLAR (fail-closed) ──────────────────────────────────────────
DO $pre$
DECLARE v_sema text; v_probe text;
BEGIN
  SELECT n.nspname INTO v_sema
  FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname = 'pgcrypto';
  IF v_sema IS NULL THEN
    RAISE EXCEPTION '083 ÖN KOŞUL: pgcrypto kurulu değil — bcrypt PIN doğrulayıcı çalışamaz.';
  END IF;
  IF v_sema <> 'extensions' THEN
    RAISE EXCEPTION '083 ÖN KOŞUL: pgcrypto beklenmedik şemada (%) — extensions.crypt çözümlenemez.', v_sema;
  END IF;
  IF to_regclass('public.vehicles') IS NULL OR to_regclass('public.vehicle_commands') IS NULL THEN
    RAISE EXCEPTION '083 ÖN KOŞUL: vehicles / vehicle_commands YOK — yanlış şema.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='vehicles' AND column_name='critical_pin_hash') THEN
    RAISE EXCEPTION '083 ÖN KOŞUL: vehicles.critical_pin_hash YOK.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    RAISE EXCEPTION '083 ÖN KOŞUL: anon/authenticated rolleri yok — Supabase değil.';
  END IF;
  /* bcrypt gerçekten çalışıyor mu (search_path/şema kazası burada yakalanır) */
  v_probe := extensions.crypt('1234', extensions.gen_salt('bf', 10));
  IF extensions.crypt('1234', v_probe) <> v_probe OR extensions.crypt('1235', v_probe) = v_probe THEN
    RAISE EXCEPTION '083 ÖN KOŞUL: bcrypt round-trip tutarsız.';
  END IF;
END
$pre$;

-- ── 1. TEK KRİTİK KOMUT LİSTESİ ───────────────────────────────────────────
-- Trigger ve RPC bu fonksiyonu okur. PWA listesi (`commandService.ts
-- CRITICAL_COMMANDS`) buradan SAPMAMALI — parite testi website tarafında.
CREATE OR REPLACE FUNCTION public.is_critical_command_type(p_type text)
RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = public
AS $fn$
  SELECT p_type IN ('unlock', 'alarm_off');
$fn$;
REVOKE ALL ON FUNCTION public.is_critical_command_type(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_critical_command_type(text) TO anon, authenticated, service_role;

-- ── 2. TRIGGER: İSTEMCİ İDDİASI YOK, SUNUCU KANITI VAR ────────────────────
CREATE OR REPLACE FUNCTION public.fn_enforce_critical_pin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_proof text;
BEGIN
  IF NOT public.is_critical_command_type(NEW.type) THEN
    /* Kritik olmayan komutta bu bayrağın anlamı yok; istemci true yazsa da
       DÜRÜST değer false'tur. */
    NEW.critical_auth_verified := false;
    RETURN NEW;
  END IF;

  /* Tek geçerli kanıt: aynı transaction'da verify_and_send_critical_command'ın
     kurduğu işlem-yerel GUC. İstemci iddiası (NEW.critical_auth_verified)
     OKUNMAZ. */
  v_proof := current_setting('caros.critical_pin_ok', true);
  IF v_proof IS NOT NULL AND v_proof <> '' AND v_proof = NEW.vehicle_id::text THEN
    NEW.critical_auth_verified := true;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'critical_pin_required: Bu komut sunucu tarafında PIN doğrulaması gerektirir.'
    USING ERRCODE = 'P0001';
END;
$fn$;
-- Trigger baseline'da vardır (BEFORE INSERT); fonksiyon gövdesi değişti, trigger aynen kalır.

-- ── 3. PIN KAYDI: bcrypt, sunucu tarafında ────────────────────────────────
-- Eski imza `set_vehicle_pin(uuid, text /*p_pin_hash*/)` hash kabul ediyordu
-- (pass-the-hash). Üründe ÇAĞIRANI YOK (tarandı) → DROP.
DROP FUNCTION IF EXISTS public.set_vehicle_pin(uuid, text);

CREATE OR REPLACE FUNCTION public.set_vehicle_pin(
  p_vehicle_id  uuid,
  p_pin         text,
  p_current_pin text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid      uuid := auth.uid();
  v_stored   text;
  v_is_owner boolean;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated');
  END IF;
  IF NOT (public.is_vehicle_owner(p_vehicle_id) OR public.is_paired(v_uid, p_vehicle_id)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Yetkisiz erişim.');
  END IF;
  IF p_pin IS NULL OR p_pin !~ '^[0-9]{4,8}$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PIN 4–8 rakam olmalı.');
  END IF;

  SELECT critical_pin_hash INTO v_stored FROM public.vehicles WHERE id = p_vehicle_id FOR UPDATE;
  v_is_owner := public.is_vehicle_owner(p_vehicle_id);

  /* PIN zaten varsa: sahip değiştirebilir (mevcut davranış korunur);
     sahip olmayan eşleşmiş kullanıcı MEVCUT PIN'i kanıtlamak zorundadır.
     Aksi hâlde eşleşmiş bir telefon PIN'i sıfırlayıp ikinci faktörü
     anlamsızlaştırırdı. */
  IF v_stored IS NOT NULL AND NOT v_is_owner THEN
    IF p_current_pin IS NULL OR NOT public._critical_pin_matches(v_stored, p_current_pin) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'pin_mismatch');
    END IF;
  END IF;

  UPDATE public.vehicles
     SET critical_pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf', 10))
   WHERE id = p_vehicle_id;

  RETURN jsonb_build_object('ok', true);
END;
$fn$;
REVOKE ALL ON FUNCTION public.set_vehicle_pin(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_vehicle_pin(uuid, text, text) TO authenticated, service_role;

-- ── 3b. Doğrulayıcı karşılaştırma (tek yer) ──────────────────────────────
-- Eski biçim: 64 hex = tuzsuz SHA-256(PIN). Yeni biçim: bcrypt ('$2a$…').
-- Hash'in kendisi PIN yerine GEÇMEZ: sha256(H) ≠ H, crypt(H, S) ≠ S.
CREATE OR REPLACE FUNCTION public._critical_pin_matches(p_stored text, p_pin text)
RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = public
AS $fn$
  SELECT CASE
    WHEN p_stored IS NULL OR p_pin IS NULL THEN false
    WHEN p_stored ~ '^[0-9a-f]{64}$'
      THEN lower(p_stored) = encode(sha256(convert_to(p_pin, 'UTF8')), 'hex')
    WHEN p_stored LIKE '$2%'
      THEN extensions.crypt(p_pin, p_stored) = p_stored
    ELSE false
  END;
$fn$;
REVOKE ALL ON FUNCTION public._critical_pin_matches(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._critical_pin_matches(text, text) TO service_role;

-- ── 4. KRİTİK KOMUT: doğrula + yetkilendir + yarat, TEK transaction ─────────
-- Eski imza (…, p_pin_hash text, …) DROP: aynı tip imzasıyla parametre adı
-- değiştirilemez ve hash kabul eden yol kalmamalı. Eski PWA bu adla çağırırsa
-- PostgREST "fonksiyon bulunamadı" döner (fail-closed; PWA yenilenince geçer).
DROP FUNCTION IF EXISTS public.verify_and_send_critical_command(uuid, text, jsonb, text, text, timestamptz);

CREATE OR REPLACE FUNCTION public.verify_and_send_critical_command(
  p_vehicle_id uuid,
  p_type       text,
  p_payload    jsonb,
  p_pin        text,
  p_nonce      text DEFAULT NULL,
  p_ttl        timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  c_max_ttl    constant interval := interval '5 minutes';   -- N-7 ile aynı pencere
  c_lock_win   constant interval := interval '15 minutes';
  c_lock_max   constant integer  := 5;
  v_uid        uuid := auth.uid();
  v_stored     text;
  v_fail_count integer;
  v_command_id uuid;
  v_ttl        timestamptz;
  v_nonce      text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated');
  END IF;
  IF NOT (public.is_vehicle_owner(p_vehicle_id) OR public.is_paired(v_uid, p_vehicle_id)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Yetkisiz erişim.');
  END IF;
  IF NOT public.is_critical_command_type(p_type) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Bu komut kritik değil.');
  END IF;

  SELECT critical_pin_hash INTO v_stored FROM public.vehicles WHERE id = p_vehicle_id FOR UPDATE;
  IF v_stored IS NULL THEN
    /* Fail-closed: PIN kayıtlı değilken kritik komut GİRMEZ. İstemci
       set_vehicle_pin ile kaydeder, sonra yeniden dener. */
    RETURN jsonb_build_object('ok', false, 'error', 'pin_not_set');
  END IF;

  /* Çevrimiçi kaba kuvvet kilidi — mevcut vehicle_events, şema değişikliği yok. */
  SELECT count(*) INTO v_fail_count
  FROM public.vehicle_events
  WHERE vehicle_id = p_vehicle_id::text
    AND type = 'critical_pin_failed'
    AND created_at > now() - c_lock_win;
  IF v_fail_count >= c_lock_max THEN
    RETURN jsonb_build_object('ok', false, 'error', 'pin_locked');
  END IF;

  IF p_pin IS NULL OR NOT public._critical_pin_matches(v_stored, p_pin) THEN
    INSERT INTO public.vehicle_events (vehicle_id, type, metadata)
    VALUES (p_vehicle_id::text, 'critical_pin_failed', jsonb_build_object('uid', v_uid, 'cmd', p_type));
    RETURN jsonb_build_object('ok', false, 'error', 'Yanlış PIN.');
  END IF;

  /* Eski SHA-256 doğrulayıcı → doğru PIN kanıtlandı → yerinde bcrypt'e yükselt.
     Yanlış PIN buraya ulaşamaz. */
  IF v_stored ~ '^[0-9a-f]{64}$' THEN
    UPDATE public.vehicles
       SET critical_pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf', 10))
     WHERE id = p_vehicle_id;
  END IF;

  v_ttl   := LEAST(coalesce(p_ttl, now() + c_max_ttl), now() + c_max_ttl);
  v_nonce := coalesce(p_nonce, gen_random_uuid()::text);

  /* Sunucu kanıtı: işlem-yerel, yalnız bu araç, yalnız bu transaction. */
  PERFORM set_config('caros.critical_pin_ok', p_vehicle_id::text, true);
  INSERT INTO public.vehicle_commands (vehicle_id, sender_id, created_by, type, payload, nonce, ttl, critical_auth_verified)
  VALUES (p_vehicle_id, v_uid, v_uid, p_type, coalesce(p_payload, '{}'::jsonb), v_nonce, v_ttl, true)
  RETURNING id INTO v_command_id;
  PERFORM set_config('caros.critical_pin_ok', '', true);

  RETURN jsonb_build_object('ok', true, 'command_id', v_command_id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.verify_and_send_critical_command(uuid, text, jsonb, text, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_and_send_critical_command(uuid, text, jsonb, text, text, timestamptz) TO authenticated, service_role;

-- ── 5. vehicles: KOLON DÜZEYİ YETKİ (F-06) ────────────────────────────────
-- Tablo düzeyi SELECT/INSERT/UPDATE varken kolon REVOKE etkisizdir; doğru
-- yol tablo yetkisini alıp AÇIK kolon listesi vermektir. Liste bu anda
-- mevcut kolonlardan türetilir; SONRADAN EKLENEN kolon istemciye OTOMATİK
-- AÇILMAZ (bilinçli: yeni kolon = yeni karar). Tablo yorumuna yazılır.
DO $cols$
DECLARE
  c_secret   constant text[] := ARRAY['api_key','api_key_hash','critical_pin_hash','pairing_code'];
  c_no_write constant text[] := ARRAY['id','created_at','updated_at','revision',
                                      'e2e_public_key','e2e_key_alg','e2e_key_published_at'];
  v_sel  text; v_ins text; v_upd text;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
    INTO v_sel
    FROM information_schema.columns
   WHERE table_schema='public' AND table_name='vehicles'
     AND column_name <> ALL (c_secret);
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
    INTO v_ins
    FROM information_schema.columns
   WHERE table_schema='public' AND table_name='vehicles'
     AND column_name <> ALL (c_secret)
     AND column_name <> ALL (ARRAY['revision','e2e_public_key','e2e_key_alg','e2e_key_published_at']);
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
    INTO v_upd
    FROM information_schema.columns
   WHERE table_schema='public' AND table_name='vehicles'
     AND column_name <> ALL (c_secret)
     AND column_name <> ALL (c_no_write);

  REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLE public.vehicles FROM anon, authenticated;
  EXECUTE format('GRANT SELECT (%s) ON public.vehicles TO anon, authenticated', v_sel);
  EXECUTE format('GRANT INSERT (%s) ON public.vehicles TO authenticated', v_ins);
  EXECUTE format('GRANT UPDATE (%s) ON public.vehicles TO authenticated', v_upd);
  GRANT DELETE ON TABLE public.vehicles TO authenticated;   -- 'vehicles: owner delete' politikası aynen
  RAISE NOTICE '083 vehicles kolon yetkisi: SELECT[%] INSERT[%] UPDATE[%]', v_sel, v_ins, v_upd;
END
$cols$;

COMMENT ON TABLE public.vehicles IS
  'İstemci (anon/authenticated) yetkisi KOLON düzeyindedir (083). api_key, '
  'api_key_hash, critical_pin_hash, pairing_code istemciye HİÇ açık değildir; '
  'e2e_* ve revision yalnız RPC/trigger yazar. YENİ KOLON eklerken istemcinin '
  'okuması/yazması gerekiyorsa AÇIKÇA GRANT verilmelidir.';

-- ── 6. ARAÇ GERÇEĞİ: istemci YAZAMAZ (F-06) ──────────────────────────────
-- Meşru yazıcılar SECURITY DEFINER RPC'lerdir (push_vehicle_event,
-- update_command_status, upload_vehicle_trip …); tablo sahibi olarak
-- politikadan etkilenmezler.
DROP POLICY IF EXISTS "telemetry_snap: insert"                       ON public.vehicle_telemetry;
DROP POLICY IF EXISTS "telemetry_snap: update"                       ON public.vehicle_telemetry;
DROP POLICY IF EXISTS "locations: yazma"                             ON public.vehicle_locations;
DROP POLICY IF EXISTS "company_isolation_mutate_vehicle_locations"   ON public.vehicle_locations;
DROP POLICY IF EXISTS "Kendi aracı için olay ekle"                   ON public.vehicle_events;
DROP POLICY IF EXISTS "commands: guncelleyebilir"                    ON public.vehicle_commands;

REVOKE INSERT, UPDATE, DELETE ON TABLE public.vehicle_telemetry FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.vehicle_locations FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.vehicle_events    FROM anon, authenticated;
REVOKE UPDATE, DELETE         ON TABLE public.vehicle_commands  FROM anon, authenticated;

-- vehicle_commands INSERT: yalnız İSTEK kolonları. status/result/*_at/retry
-- gibi araç-gerçeği kolonları istemci tarafından yazılamaz.
-- `critical_auth_verified` uyumluluk için listede KALIR (eski PWA gönderiyor)
-- ama değeri trigger tarafından EZİLİR — istemci iddiası hiçbir şey yapmaz.
REVOKE INSERT ON TABLE public.vehicle_commands FROM anon, authenticated;
GRANT INSERT (vehicle_id, company_id, issuer_id, sender_id, created_by, type, payload, nonce, ttl, critical_auth_verified)
  ON public.vehicle_commands TO anon, authenticated;

-- ── 7. increment_command_retry: api_key kimliği ŞART ──────────────────────
-- Eski (uuid,text) imzası kimliksizdi ve anon'a açıktı. Kapatılır (DROP
-- edilmez: service_role için kalır). Araç istemcisi yeni imzayı çağırır
-- (commandListener.incrementRetry). Eski APK'da çağrı hata döner, çökmez;
-- yalnız retry sayacı ilerlemez (komut TTL ile düşer) — güvenlik etkisi yok.
REVOKE ALL ON FUNCTION public.increment_command_retry(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_command_retry(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.increment_command_retry(p_api_key text, p_command_id uuid, p_error text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_vehicle_id  uuid;
  v_retry_count integer;
  c_max_retry   constant integer := 3;
BEGIN
  IF p_api_key IS NULL OR length(btrim(p_api_key)) = 0 THEN
    RAISE EXCEPTION 'Geçersiz api_key' USING ERRCODE = 'P0001';
  END IF;
  /* Kimlik çözümü diğer cihaz RPC'leriyle BİREBİR aynı ifade (071); 084 bu
     ifadeyi tüm fonksiyonlarda birlikte daraltır. */
  SELECT id INTO v_vehicle_id FROM public.vehicles
   WHERE (api_key_hash = encode(sha256(p_api_key::bytea), 'hex') OR coalesce(api_key_hash, api_key) = p_api_key)
   LIMIT 1;
  IF v_vehicle_id IS NULL THEN
    RAISE EXCEPTION 'Geçersiz api_key' USING ERRCODE = 'P0001';
  END IF;

  SELECT retry_count INTO v_retry_count
    FROM public.vehicle_commands
   WHERE id = p_command_id AND vehicle_id = v_vehicle_id;
  IF v_retry_count IS NULL THEN RETURN; END IF;   -- başka aracın komutu / yok → sessiz

  IF v_retry_count + 1 >= c_max_retry THEN
    UPDATE public.vehicle_commands
       SET status = 'failed', error_message = coalesce(p_error, 'Max retry aşıldı'),
           finished_at = now(), updated_at = now()
     WHERE id = p_command_id AND vehicle_id = v_vehicle_id;
  ELSE
    UPDATE public.vehicle_commands
       SET retry_count = retry_count + 1, last_attempt_at = now(),
           error_message = p_error, updated_at = now()
     WHERE id = p_command_id AND vehicle_id = v_vehicle_id;
  END IF;
END;
$fn$;
REVOKE ALL ON FUNCTION public.increment_command_retry(text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_command_retry(text, uuid, text) TO anon, authenticated, service_role;

-- ── 8. DOĞRULAMA (fail-closed) ────────────────────────────────────────────
DO $verify$
DECLARE n int; bad text;
BEGIN
  IF has_column_privilege('authenticated', 'public.vehicles', 'critical_pin_hash', 'SELECT')
     OR has_column_privilege('authenticated', 'public.vehicles', 'api_key', 'SELECT')
     OR has_column_privilege('authenticated', 'public.vehicles', 'api_key_hash', 'SELECT')
     OR has_column_privilege('anon', 'public.vehicles', 'api_key_hash', 'SELECT') THEN
    RAISE EXCEPTION '083 DOĞRULAMA: gizli vehicles kolonu hâlâ istemciye açık';
  END IF;
  IF NOT has_column_privilege('authenticated', 'public.vehicles', 'e2e_public_key', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'public.vehicles', 'name', 'SELECT') THEN
    RAISE EXCEPTION '083 DOĞRULAMA [YAN HASAR]: gerekli vehicles kolonu kapanmış';
  END IF;
  IF has_column_privilege('authenticated', 'public.vehicles', 'critical_pin_hash', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.vehicles', 'api_key_hash', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.vehicles', 'e2e_public_key', 'UPDATE') THEN
    RAISE EXCEPTION '083 DOĞRULAMA: gizli/RPC-sahipli kolon istemci UPDATE''ine açık';
  END IF;
  IF has_table_privilege('authenticated', 'public.vehicle_telemetry', 'INSERT')
     OR has_table_privilege('authenticated', 'public.vehicle_locations', 'INSERT')
     OR has_table_privilege('authenticated', 'public.vehicle_events', 'INSERT')
     OR has_table_privilege('authenticated', 'public.vehicle_commands', 'UPDATE') THEN
    RAISE EXCEPTION '083 DOĞRULAMA: araç gerçeği tablosu istemciye yazılabilir kaldı';
  END IF;
  IF has_column_privilege('authenticated', 'public.vehicle_commands', 'status', 'INSERT')
     OR has_column_privilege('authenticated', 'public.vehicle_commands', 'result', 'INSERT') THEN
    RAISE EXCEPTION '083 DOĞRULAMA: vehicle_commands gerçek kolonu INSERT''e açık';
  END IF;
  IF NOT has_column_privilege('authenticated', 'public.vehicle_commands', 'payload', 'INSERT') THEN
    RAISE EXCEPTION '083 DOĞRULAMA [YAN HASAR]: komut isteği yazılamaz';
  END IF;
  IF has_function_privilege('anon', 'public.increment_command_retry(uuid,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.increment_command_retry(uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION '083 DOĞRULAMA: kimliksiz increment_command_retry hâlâ açık';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
             WHERE n.nspname='public' AND p.proname IN ('set_vehicle_pin','verify_and_send_critical_command')
               AND pg_get_function_identity_arguments(p.oid) LIKE '%p_pin_hash%') THEN
    RAISE EXCEPTION '083 DOĞRULAMA: hash kabul eden PIN imzası duruyor';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trigger_enforce_critical_pin'
                 AND tgrelid='public.vehicle_commands'::regclass AND NOT tgisinternal) THEN
    RAISE EXCEPTION '083 DOĞRULAMA: trigger_enforce_critical_pin YOK';
  END IF;
  SELECT count(*) INTO n FROM pg_policies WHERE schemaname='public'
    AND policyname IN ('telemetry_snap: insert','telemetry_snap: update','locations: yazma',
                       'company_isolation_mutate_vehicle_locations','Kendi aracı için olay ekle',
                       'commands: guncelleyebilir');
  IF n > 0 THEN RAISE EXCEPTION '083 DOĞRULAMA: % istemci yazma politikası duruyor', n; END IF;
  RAISE NOTICE '083 OK: kritik komut yetkisi sunucuda; PIN bcrypt; vehicles kolon yetkisi; araç gerçeği istemciye kapalı.';
END
$verify$;

COMMIT;
