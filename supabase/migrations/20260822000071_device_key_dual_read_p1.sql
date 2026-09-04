-- ═══════════════════════════════════════════════════════════════════════════
-- 071  CİHAZ ANAHTARI — AŞAMA 1: ÇİFT OKUMA (davranış DEĞİŞMEZ)
--
-- ── BULGU (devir raporu · RISK-01) ────────────────────────────────────────
-- `vehicles.api_key_hash` kolonu **adına rağmen HASH TUTMUYOR**:
-- `register_vehicle` `gen_random_uuid()::text` üretip kolona AYNEN yazıyor ve
-- aynı değeri cihaza döndürüyor. Üretim ölçümü (2026-08-22):
--     834/834 satır UUID biçimli · SHA-256 biçimli **0**
-- Yani veritabanı sızarsa 834 aracın cihaz kimliği DOĞRUDAN kullanılabilir.
--
-- ── NEDEN ÜÇ AŞAMA ────────────────────────────────────────────────────────
-- Bu ÜRETİM KİMLİK DOĞRULAMASIDIR. Kolonu tek hamlede hash'lemek geri
-- alınamaz bir dönüşümdür: bir fonksiyon atlanırsa o cihazlar bir daha ASLA
-- doğrulanamaz (düz metin kaybolduğu için kurtarma da yoktur).
--   AŞAMA 1 (bu dosya) : okuma yüzeyi GENİŞLETİLİR — sha256 biçimi KABUL
--                        edilir, eski düz biçim AYNEN çalışmaya devam eder.
--                        Veri DEĞİŞMEZ. Hiçbir cihaz etkilenmez.
--   AŞAMA 2 (ayrı)     : yedek kolon + kolonun YERİNDE hash'lenmesi +
--                        `register_vehicle`ın hash saklaması.
--   AŞAMA 3 (ayrı)     : düz metin dalının kaldırılması + yedeğin düşürülmesi.
--
-- ── AŞAMA 2 NEDEN CİHAZ-ŞEFFAF OLACAK ─────────────────────────────────────
-- Cihaz bugün ham UUID `V`yi saklıyor ve gönderiyor; sunucu `V`yi saklıyor.
-- Aşama 2 kolonu `sha256(V)` yapar. Cihaz HÂLÂ `V` gönderir ve Aşama 1'de
-- eklenen dal `sha256(V) = saklanan` ile eşleşir. **Cihazda hiçbir değişiklik
-- gerekmez** — bu, aşamalı geçişin tüm nedenidir.
--
-- ── YAN ETKİ: BUG-001 KENDİLİĞİNDEN KAPANIR ───────────────────────────────
-- `api/pwa/command`, `api/pwa/dtc-result` ve `api/vehicle/update` rotaları
-- `verifyApiKey(rawKey, api_key_hash)` yani `sha256(rawKey) = kolon`
-- karşılaştırması yapıyor ve kolon düz metin tuttuğu için ASLA eşleşmiyordu.
-- Aşama 2'den sonra bu karşılaştırma DOĞRU hâle gelir.
--
-- ── BU DOSYA NASIL ÜRETİLDİ ───────────────────────────────────────────────
-- Fonksiyon gövdeleri ELLE YAZILMADI. `pg_get_functiondef()` ile üretimden
-- TAM tanım alındı ve YALNIZ karşılaştırma ifadesi değiştirildi. 12 fonksiyonun
-- iş mantığını elle kopyalamak, tek satır kaçırmakla üretim kimlik
-- doğrulamasını bozardı.
--
-- KAPSAM: aşağıdaki 8 fonksiyon yalnız düz karşılaştırma yapıyordu.
--   `fetch_pending_vehicle_commands` ve `update_command_status` ZATEN çift
--   okuma yapıyor (bu geçiş daha önce başlatılmış) — DOKUNULMADI.
--   `register_vehicle` AŞAMA 2'de ele alınacak.
--
-- `sha256()` PostgreSQL YERLEŞİĞİDİR; `pgcrypto.digest()` KULLANILMADI çünkü
-- o eklenti `extensions` şemasındadır ve dar `search_path`li fonksiyonlarda
-- BULUNAMAZ. Denklik üretimde doğrulandı: `sha256(x) = digest(x,'sha256')`.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── delete_geofence_zone ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.delete_geofence_zone(p_api_key text, p_zone_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_vehicle_id uuid;
BEGIN
  SELECT id INTO v_vehicle_id
  FROM public.vehicles
  WHERE (api_key_hash = encode(sha256(p_api_key::bytea), 'hex') OR coalesce(api_key_hash, api_key) = p_api_key);
  IF v_vehicle_id IS NULL THEN
    RAISE EXCEPTION 'invalid_api_key' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.vehicle_geofences
  SET is_active = false, updated_at = now()
  WHERE vehicle_id = v_vehicle_id::text
    AND id = p_zone_id;
END;
$function$;

-- ── get_active_driver_assignment ────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_active_driver_assignment(p_api_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_veh uuid;
  v_co  uuid;
  r     record;
BEGIN
  SELECT id, company_id INTO v_veh, v_co FROM public.vehicles
   WHERE (api_key_hash = encode(sha256(p_api_key::bytea), 'hex') OR coalesce(api_key_hash, api_key) = p_api_key);
  IF v_veh IS NULL THEN
    RAISE EXCEPTION 'invalid_api_key' USING ERRCODE='P0001';
  END IF;
  /* Bireysel araçta sürücü modeli yok → UNKNOWN (uydurma YOK). */
  IF v_co IS NULL THEN
    RETURN jsonb_build_object('status','UNKNOWN','reason','NOT_COMPANY_VEHICLE');
  END IF;

  SELECT a.id, a.driver_id, a.starts_at, a.ends_at, a.source,
         a.confidence, a.revision, d.display_name, d.status AS driver_status
    INTO r
    FROM public.vehicle_driver_assignments a
    JOIN public.fleet_drivers d ON d.id = a.driver_id
   WHERE a.vehicle_id = v_veh
     AND a.company_id = v_co
     AND a.status IN ('SCHEDULED','ACTIVE')
     AND a.starts_at <= now()
     AND (a.ends_at IS NULL OR a.ends_at > now())
   ORDER BY a.starts_at DESC
   LIMIT 1;

  IF r IS NULL OR r.driver_status <> 'ACTIVE' THEN
    RETURN jsonb_build_object('status','UNKNOWN','reason','NO_ACTIVE_ASSIGNMENT');
  END IF;

  /* HASSAS ALAN YOK: ehliyet · telefon · e-posta · employee_code · user id. */
  RETURN jsonb_build_object(
    'status','ACTIVE',
    'driverId', r.driver_id,
    'assignmentId', r.id,
    'assignmentRevision', r.revision,
    'displayName', r.display_name,
    'source', r.source,
    'confidence', r.confidence,
    'validFrom', r.starts_at,
    'validUntil', r.ends_at,
    'capturedAt', now()
  );
END;
$function$;

-- ── get_geofence_zones ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_geofence_zones(p_api_key text)
 RETURNS SETOF vehicle_geofences
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_vehicle_id uuid;
BEGIN
  SELECT id INTO v_vehicle_id
  FROM public.vehicles
  WHERE (api_key_hash = encode(sha256(p_api_key::bytea), 'hex') OR coalesce(api_key_hash, api_key) = p_api_key);
  IF v_vehicle_id IS NULL THEN
    RAISE EXCEPTION 'invalid_api_key' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
    SELECT *
    FROM public.vehicle_geofences
    WHERE vehicle_id = v_vehicle_id::text
      AND is_active = true;
END;
$function$;

-- ── push_geofence_zone ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.push_geofence_zone(p_api_key text, p_zone jsonb)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_vehicle_id uuid;
  v_zone_id    text;
BEGIN
  -- api_key → araç (push_vehicle_event 026 ile birebir aynı auth)
  SELECT id INTO v_vehicle_id
  FROM public.vehicles
  WHERE (api_key_hash = encode(sha256(p_api_key::bytea), 'hex') OR coalesce(api_key_hash, api_key) = p_api_key);
  IF v_vehicle_id IS NULL THEN
    RAISE EXCEPTION 'invalid_api_key' USING ERRCODE = 'P0001';
  END IF;

  -- zone.id yoksa üret (client 'default' verir; polygon çizimleri uuid alır)
  v_zone_id := coalesce(NULLIF(p_zone->>'id', ''), gen_random_uuid()::text);

  INSERT INTO public.vehicle_geofences AS g (
    id, vehicle_id, name, type, polygon, center, radius_m, is_active, updated_at
  )
  VALUES (
    v_zone_id,
    v_vehicle_id::text,                                              -- TEXT kolona açık cast
    p_zone->>'name',
    p_zone->>'type',
    CASE WHEN jsonb_typeof(p_zone->'polygon') = 'array' THEN p_zone->'polygon' ELSE NULL END,
    CASE WHEN jsonb_typeof(p_zone->'center')  IN ('array','object') THEN p_zone->'center' ELSE NULL END,
    NULLIF(p_zone->>'radius_m', '')::numeric,
    coalesce((p_zone->>'is_active')::boolean, true),
    now()
  )
  ON CONFLICT (vehicle_id, id) DO UPDATE SET
    name      = EXCLUDED.name,
    type      = EXCLUDED.type,
    polygon   = EXCLUDED.polygon,
    center    = EXCLUDED.center,
    radius_m  = EXCLUDED.radius_m,
    is_active = EXCLUDED.is_active,
    updated_at = now();

  RETURN v_zone_id;
END;
$function$;

-- ── push_vehicle_event ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.push_vehicle_event(p_api_key text, p_type text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c_log_types   constant text[]   := ARRAY['critical_error','crash','log','obd_diag','support_snapshot','ota_event','voice_diag'];
  c_max_bytes   constant integer  := 65536;
  c_rate_window constant interval := interval '60 seconds';
  c_rate_max    constant integer  := 30;
  v_vehicle_id  uuid;
  v_company_id  uuid;
  v_owner_id    uuid;
  v_event_id    uuid;
  v_payload     jsonb;
  v_store       jsonb;
  v_recent      integer;
  v_lat         double precision;
  v_lng         double precision;
  v_acc         double precision;
  v_obs         timestamptz;
  v_gps_obs     timestamptz;
  v_obd_obs     timestamptz;
  v_src         text;
  v_loc_src     text;
BEGIN
  SELECT id, company_id, owner_id INTO v_vehicle_id, v_company_id, v_owner_id
  FROM public.vehicles
  WHERE (api_key_hash = encode(sha256(p_api_key::bytea), 'hex') OR coalesce(api_key_hash, api_key) = p_api_key);
  IF v_vehicle_id IS NULL THEN
    RAISE EXCEPTION 'invalid_api_key' USING ERRCODE='P0001';
  END IF;

  v_payload := coalesce(p_payload, '{}'::jsonb);

  IF p_type = ANY (c_log_types) THEN
    SELECT count(*) INTO v_recent
    FROM public.vehicle_events
    WHERE vehicle_id = v_vehicle_id::text
      AND type = ANY (c_log_types)
      AND created_at > now() - c_rate_window;
    IF v_recent >= c_rate_max THEN
      RETURN NULL;
    END IF;
  END IF;

  v_store := v_payload;
  IF octet_length(v_payload::text) > c_max_bytes THEN
    v_store := jsonb_strip_nulls(jsonb_build_object(
      'truncated', true,
      'type',      p_type,
      'ctx',       left(v_payload->>'ctx',  256),
      'msg',       left(v_payload->>'msg', 2048),
      'errorCode', v_payload->>'errorCode'
    ));
  END IF;

  INSERT INTO public.vehicle_events (vehicle_id, type, metadata)
  VALUES (v_vehicle_id::text, p_type, v_store)
  RETURNING id INTO v_event_id;

  v_lat := NULLIF(v_payload->>'lat', '')::double precision;
  v_lng := NULLIF(v_payload->>'lng', '')::double precision;
  IF NOT public.location_in_range(v_lat, v_lng) THEN
    v_lat := NULL; v_lng := NULL;
  END IF;
  v_acc := NULLIF(v_payload->>'accuracyM', '')::double precision;

  -- Gözlem damgaları: istemci epoch ms verir. İSTEMCİ SAATİ TEK OTORİTE DEĞİL —
  -- `received_at` daima sunucu `now()`'ıdır ve gelecekteki damga kırpılır.
  v_obs := LEAST(
    now(),
    coalesce(to_timestamp((NULLIF(v_payload->>'observedAt','')::bigint) / 1000.0), now())
  );
  v_gps_obs := LEAST(now(), to_timestamp((NULLIF(v_payload->>'gpsObservedAt','')::bigint) / 1000.0));
  v_obd_obs := LEAST(now(), to_timestamp((NULLIF(v_payload->>'obdObservedAt','')::bigint) / 1000.0));

  v_src := NULLIF(v_payload->>'source', '');
  IF v_src IS NOT NULL AND v_src NOT IN ('HEAD_UNIT_GPS','HEAD_UNIT_OBD','EXTERNAL_GPS','UNKNOWN') THEN
    v_src := 'UNKNOWN';   -- bilinmeyen kaynak adı UYDURULMAZ, UNKNOWN'a düşer
  END IF;
  v_loc_src := NULLIF(v_payload->>'locationSource', '');
  IF v_loc_src IS NOT NULL AND v_loc_src NOT IN ('HEAD_UNIT_GPS','EXTERNAL_GPS','UNKNOWN') THEN
    v_loc_src := 'UNKNOWN';
  END IF;

  IF v_lat IS NOT NULL AND v_lng IS NOT NULL
     AND (v_company_id IS NOT NULL OR (v_company_id IS NULL AND v_owner_id IS NOT NULL)) THEN
    INSERT INTO public.vehicle_locations
      (vehicle_id, company_id, lat, lng, heading_deg, accuracy_m, observed_at, location_source)
    VALUES (v_vehicle_id, v_company_id, v_lat, v_lng,
            NULLIF(v_payload->>'heading', '')::double precision,
            v_acc, coalesce(v_gps_obs, v_obs), v_loc_src);
  END IF;

  INSERT INTO public.vehicle_telemetry AS t
    (vehicle_id, lat, lng, speed, fuel, temp, rpm, is_online, updated_at,
     accuracy_m, observed_at, received_at, gps_observed_at, obd_observed_at,
     telemetry_source, location_source)
  VALUES (
    v_vehicle_id,
    v_lat,
    v_lng,
    -- DÜZELTME 042: coalesce(...,0) KALDIRILDI. Bilinmeyen hız artık NULL'dır.
    NULLIF(v_payload->>'speed', '')::double precision,
    NULLIF(v_payload->>'fuel',  '')::double precision,
    NULLIF(v_payload->>'temp',  '')::double precision,
    NULLIF(v_payload->>'rpm',   '')::double precision,
    true,
    now(),
    v_acc, v_obs, now(), v_gps_obs, v_obd_obs, v_src, v_loc_src
  )
  ON CONFLICT (vehicle_id) DO UPDATE SET
    -- Bilinmeyen YENİ değer, bilinen ESKİ değeri ASLA ezmez.
    lat        = COALESCE(EXCLUDED.lat, t.lat),
    lng        = COALESCE(EXCLUDED.lng, t.lng),
    speed      = COALESCE(EXCLUDED.speed, t.speed),
    fuel       = COALESCE(EXCLUDED.fuel,  t.fuel),
    temp       = COALESCE(EXCLUDED.temp,  t.temp),
    rpm        = COALESCE(EXCLUDED.rpm,   t.rpm),
    accuracy_m = COALESCE(EXCLUDED.accuracy_m, t.accuracy_m),
    is_online  = true,
    updated_at = now(),
    received_at = now(),
    observed_at        = GREATEST(COALESCE(EXCLUDED.observed_at, t.observed_at), COALESCE(t.observed_at, EXCLUDED.observed_at)),
    gps_observed_at    = GREATEST(COALESCE(EXCLUDED.gps_observed_at, t.gps_observed_at), COALESCE(t.gps_observed_at, EXCLUDED.gps_observed_at)),
    obd_observed_at    = GREATEST(COALESCE(EXCLUDED.obd_observed_at, t.obd_observed_at), COALESCE(t.obd_observed_at, EXCLUDED.obd_observed_at)),
    telemetry_source   = COALESCE(EXCLUDED.telemetry_source, t.telemetry_source),
    location_source    = COALESCE(EXCLUDED.location_source,  t.location_source);

  -- `system_health` olayı sağlık tazeliğini damgalar (ayrı sinyal).
  IF p_type = 'system_health' THEN
    UPDATE public.vehicle_telemetry
       SET health_observed_at = coalesce(v_obs, now())
     WHERE vehicle_id = v_vehicle_id;
  END IF;

  RETURN v_event_id;
END;
$function$;

-- ── record_vehicle_identity ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_vehicle_identity(p_api_key text, p_vin text DEFAULT NULL::text, p_vin_source text DEFAULT NULL::text, p_make text DEFAULT NULL::text, p_model text DEFAULT NULL::text, p_model_year integer DEFAULT NULL::integer, p_fingerprint_hash text DEFAULT NULL::text, p_fingerprint_version text DEFAULT NULL::text, p_active_obd_protocol text DEFAULT NULL::text, p_vehicle_generation text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_vehicle_id uuid;
  v_existing   public.vehicle_identity%ROWTYPE;
  v_vin        text := NULLIF(btrim(coalesce(p_vin, '')), '');
  v_src        text := NULLIF(btrim(coalesce(p_vin_source, '')), '');
  v_fp         text := NULLIF(btrim(coalesce(p_fingerprint_hash, '')), '');
  v_fpv        text := NULLIF(btrim(coalesce(p_fingerprint_version, '')), '');
  v_proto      text := NULLIF(btrim(coalesce(p_active_obd_protocol, '')), '');
  v_gen        text := NULLIF(btrim(coalesce(p_vehicle_generation, '')), '');
  v_make       text := NULLIF(btrim(coalesce(p_make, '')), '');
  v_model      text := NULLIF(btrim(coalesce(p_model, '')), '');
  v_conflict   boolean := false;
  v_reason     text := NULL;
  v_conf       numeric(3,2);
  v_rev        integer;
  v_proto_chg  boolean := false;
  v_changed    boolean := false;
BEGIN
  -- Kimlik doğrulama: api_key → araç. Sahiplik BURADA belirlenmez.
  SELECT id INTO v_vehicle_id FROM public.vehicles
   WHERE (api_key_hash = encode(sha256(p_api_key::bytea), 'hex') OR coalesce(api_key_hash, api_key) = p_api_key);
  IF v_vehicle_id IS NULL THEN
    RAISE EXCEPTION 'invalid_api_key' USING ERRCODE='P0001';
  END IF;

  -- Doğrulanmamış kaynak "verified" gibi işaretlenmez.
  IF v_src IS NOT NULL AND v_src NOT IN ('OBD_MODE09','MANUAL','UNVERIFIED') THEN
    v_src := 'UNVERIFIED';
  END IF;
  -- Biçimi tutmayan VIN KABUL EDİLMEZ (null = bilinmiyor; kısaltma/tamamlama YOK).
  IF v_vin IS NOT NULL AND length(v_vin) NOT BETWEEN 11 AND 17 THEN
    v_vin := NULL;
    v_src := NULL;
  END IF;
  -- Kaynaksız VIN veya VIN'siz kaynak taşınmaz.
  IF v_vin IS NULL THEN v_src := NULL; END IF;
  -- Parmak izi hash'i yoksa sürümü de anlamsızdır.
  IF v_fp IS NULL THEN v_fpv := NULL; END IF;

  SELECT * INTO v_existing FROM public.vehicle_identity
   WHERE vehicle_id = v_vehicle_id FOR UPDATE;

  -- ── İLK KAYIT ────────────────────────────────────────────────────────
  IF NOT FOUND THEN
    v_conf := CASE WHEN v_vin IS NOT NULL THEN 0.70 ELSE 0.50 END;
    INSERT INTO public.vehicle_identity (
      vehicle_id, vin, vin_source, vin_observed_at, make, model, model_year,
      fingerprint_hash, fingerprint_version, active_obd_protocol,
      vehicle_generation, identity_confidence, identity_revision, identity_updated_at
    ) VALUES (
      v_vehicle_id, v_vin, v_src,
      CASE WHEN v_vin IS NOT NULL THEN now() ELSE NULL END,
      v_make, v_model, p_model_year, v_fp, v_fpv, v_proto, v_gen,
      v_conf, 1, now()
    );
    RETURN jsonb_build_object(
      'state','CREATED','conflict',false,
      'identityConfidence',v_conf,'identityRevision',1);
  END IF;

  -- ── ÇAKIŞMA TESPİTİ — sessiz overwrite YASAK ─────────────────────────
  -- YALNIZ değer→BAŞKA değer çakışmadır; NULL→değer ÖĞRENMEDİR.
  IF v_vin IS NOT NULL AND v_existing.vin IS NOT NULL AND v_vin <> v_existing.vin THEN
    v_conflict := true; v_reason := 'VIN_MISMATCH';
  ELSIF v_fp IS NOT NULL AND v_existing.fingerprint_hash IS NOT NULL
        AND v_fp <> v_existing.fingerprint_hash THEN
    -- Parmak izi ŞEMA SÜRÜMÜ değiştiyse hash farkı ARAÇ DEĞİŞİMİ DEĞİLDİR
    -- (aynı araç, farklı hesaplama) → çakışma İLAN EDİLMEZ.
    IF v_fpv IS NOT NULL AND v_existing.fingerprint_version IS NOT NULL
       AND v_fpv <> v_existing.fingerprint_version THEN
      v_conflict := false;
    ELSE
      v_conflict := true; v_reason := 'FINGERPRINT_MISMATCH';
    END IF;
  END IF;

  IF v_conflict THEN
    -- ESKİ GÜVENİLİR KAYIT KORUNUR: vin/fingerprint DEĞİŞTİRİLMEZ.
    UPDATE public.vehicle_identity
       SET identity_conflict_count = identity_conflict_count + 1,
           last_conflict_at        = now(),
           last_conflict_reason    = v_reason,
           identity_confidence     = 0.30,
           identity_updated_at     = now()
     WHERE vehicle_id = v_vehicle_id
    RETURNING identity_confidence, identity_revision INTO v_conf, v_rev;

    RETURN jsonb_build_object(
      'state','IDENTITY_CONFLICT','conflict',true,'reason',v_reason,
      'identityConfidence',v_conf,'identityRevision',v_rev);
  END IF;

  -- ── PROTOKOL DEĞİŞİMİ → revision++ (çakışma DEĞİL) ───────────────────
  v_proto_chg := v_proto IS NOT NULL
             AND v_existing.active_obd_protocol IS NOT NULL
             AND v_proto <> v_existing.active_obd_protocol;

  -- ── GERÇEK DEĞİŞİM VAR MI (UNCHANGED kapısı) ─────────────────────────
  -- Aynı kimliğin tekrar bildirilmesi YENİ KANIT DEĞİLDİR → güven artmaz.
  v_changed := v_proto_chg
    OR (v_vin  IS NOT NULL AND v_existing.vin  IS NULL)
    OR (v_fp   IS NOT NULL AND v_existing.fingerprint_hash IS NULL)
    OR (v_proto IS NOT NULL AND v_existing.active_obd_protocol IS NULL)
    OR (v_make IS NOT NULL AND v_existing.make IS NULL)
    OR (v_model IS NOT NULL AND v_existing.model IS NULL)
    OR (p_model_year IS NOT NULL AND v_existing.model_year IS NULL)
    OR (v_gen  IS NOT NULL AND v_existing.vehicle_generation IS NULL)
    OR (v_fpv  IS NOT NULL AND v_existing.fingerprint_version IS DISTINCT FROM v_fpv);

  IF NOT v_changed THEN
    -- Güven SABİT kalır, revizyon ARTMAZ, yalnız görülme anı damgalanır.
    UPDATE public.vehicle_identity
       SET identity_updated_at = now()
     WHERE vehicle_id = v_vehicle_id
    RETURNING identity_confidence, identity_revision INTO v_conf, v_rev;

    RETURN jsonb_build_object(
      'state','UNCHANGED','conflict',false,
      'identityConfidence',v_conf,'identityRevision',v_rev);
  END IF;

  -- ── UYUMLU YENİ KANIT → bounded güven artışı (1.00 ASLA) ─────────────
  v_conf := LEAST(0.95, v_existing.identity_confidence + 0.10);

  UPDATE public.vehicle_identity
     SET vin                 = coalesce(v_vin, vin),
         vin_source          = coalesce(v_src, vin_source),
         vin_observed_at     = CASE WHEN v_vin IS NOT NULL THEN now() ELSE vin_observed_at END,
         make                = coalesce(v_make, make),
         model               = coalesce(v_model, model),
         model_year          = coalesce(p_model_year, model_year),
         -- Şema sürümü değiştiyse hash GÜNCELLENİR (aynı araç, yeni hesaplama).
         fingerprint_hash    = coalesce(v_fp, fingerprint_hash),
         fingerprint_version = coalesce(v_fpv, fingerprint_version),
         active_obd_protocol = coalesce(v_proto, active_obd_protocol),
         vehicle_generation  = coalesce(v_gen, vehicle_generation),
         identity_confidence = v_conf,
         identity_revision   = identity_revision + CASE WHEN v_proto_chg THEN 1 ELSE 0 END,
         protocol_change_count   = protocol_change_count + CASE WHEN v_proto_chg THEN 1 ELSE 0 END,
         last_protocol_change_at = CASE WHEN v_proto_chg THEN now() ELSE last_protocol_change_at END,
         identity_updated_at = now()
   WHERE vehicle_id = v_vehicle_id
  RETURNING identity_revision INTO v_rev;

  RETURN jsonb_build_object(
    'state', CASE WHEN v_proto_chg THEN 'PROTOCOL_CHANGED' ELSE 'UPDATED' END,
    'conflict', false,
    'identityConfidence', v_conf,
    'identityRevision', v_rev);
END;
$function$;

-- ── refresh_linking_code ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.refresh_linking_code(p_api_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ DECLARE v_vehicle_id uuid; v_code text; v_expires_at timestamptz; BEGIN SELECT id

  INTO v_vehicle_id FROM vehicles WHERE (api_key_hash = encode(sha256(p_api_key::bytea), 'hex') OR api_key_hash = p_api_key OR api_key = p_api_key) LIMIT 1; IF v_vehicle_id IS NULL

   THEN RAISE EXCEPTION 'Geçersiz API anahtarı'; END IF; LOOP v_code := lpad((floor(random() * 1000000))::int::text, 6,

  '0'); EXIT WHEN NOT EXISTS (SELECT 1 FROM vehicle_linking_codes WHERE code = v_code AND expires_at > now() AND

  vehicle_id != v_vehicle_id); END LOOP; v_expires_at := now() + interval '5 minutes'; INSERT INTO vehicle_linking_codes

   (vehicle_id, code, expires_at) VALUES (v_vehicle_id, v_code, v_expires_at) ON CONFLICT (vehicle_id) DO UPDATE SET

  code = excluded.code, expires_at = excluded.expires_at; RETURN jsonb_build_object('linking_code', v_code,

  'expires_at', v_expires_at); END; $function$;

-- ── upload_vehicle_trip ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.upload_vehicle_trip(p_api_key text, p_trip_key text, p_trip_id text DEFAULT NULL::text, p_revision integer DEFAULT 1, p_started_at_ms bigint DEFAULT NULL::bigint, p_ended_at_ms bigint DEFAULT NULL::bigint, p_metrics jsonb DEFAULT '{}'::jsonb, p_score integer DEFAULT NULL::integer, p_confidence text DEFAULT NULL::text, p_sources jsonb DEFAULT '{}'::jsonb, p_events jsonb DEFAULT '[]'::jsonb, p_provenance jsonb DEFAULT '{}'::jsonb, p_price jsonb DEFAULT '{}'::jsonb, p_coverage jsonb DEFAULT '{}'::jsonb, p_metrics_version integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_vehicle_id uuid;
  v_key        text := NULLIF(btrim(coalesce(p_trip_key, '')), '');
  v_existing   public.vehicle_trips%ROWTYPE;
  v_started    timestamptz;
  v_ended      timestamptz;
  v_rev        integer := GREATEST(1, coalesce(p_revision, 1));
  v_conf       text;
  v_dist_src   text;
  v_fuel_src   text;
  v_cost_src   text;
  v_dist       numeric;
  v_price_src  text;
  v_fuel_unit  text;
BEGIN
  SELECT id INTO v_vehicle_id FROM public.vehicles
   WHERE (api_key_hash = encode(sha256(p_api_key::bytea), 'hex') OR coalesce(api_key_hash, api_key) = p_api_key);
  IF v_vehicle_id IS NULL THEN
    RAISE EXCEPTION 'invalid_api_key' USING ERRCODE='P0001';
  END IF;

  IF v_key IS NULL THEN
    RETURN jsonb_build_object('state','REJECTED','reason','MISSING_TRIP_KEY','serverRevision',NULL);
  END IF;

  -- İstemci saati OTORİTE DEĞİL.
  v_started := LEAST(now(), coalesce(to_timestamp(p_started_at_ms / 1000.0), now()));
  v_ended   := CASE WHEN p_ended_at_ms IS NULL THEN NULL
                    ELSE LEAST(now(), to_timestamp(p_ended_at_ms / 1000.0)) END;
  IF v_ended IS NOT NULL AND v_ended < v_started THEN v_ended := v_started; END IF;

  -- Enum daraltma — `VERY_HIGH` artık GEÇERLİ.
  v_conf := coalesce(NULLIF(btrim(coalesce(p_confidence,'')),''), 'UNKNOWN');
  IF v_conf NOT IN ('VERY_HIGH','HIGH','MEDIUM','LOW','UNKNOWN') THEN v_conf := 'UNKNOWN'; END IF;

  v_dist_src := public._trip_source(p_sources->>'distance');
  v_fuel_src := public._trip_source(p_sources->>'fuel');
  v_cost_src := public._trip_source(p_sources->>'cost');

  v_price_src := NULLIF(btrim(coalesce(p_price->>'source','')),'');
  IF v_price_src IS NOT NULL AND v_price_src NOT IN
     ('USER_DEFINED','DEFAULT_FALLBACK','UNAVAILABLE') THEN
    v_price_src := 'UNAVAILABLE';
  END IF;

  v_fuel_unit := NULLIF(btrim(coalesce(p_metrics->>'fuelUnit','')),'');
  IF v_fuel_unit IS NOT NULL AND v_fuel_unit NOT IN ('L','PERCENT') THEN
    v_fuel_unit := NULL;
  END IF;

  v_dist := NULLIF(p_metrics->>'distanceKm','')::numeric;
  IF v_dist IS NULL OR v_dist <= 0 THEN
    RETURN jsonb_build_object('state','REJECTED','reason','NO_DISTANCE','serverRevision',NULL);
  END IF;

  SELECT * INTO v_existing FROM public.vehicle_trips
   WHERE vehicle_id = v_vehicle_id AND trip_key = v_key FOR UPDATE;

  -- ── DEDUPE (P1 davranışı AYNEN) ──────────────────────────────────────
  IF FOUND THEN
    IF v_rev <= v_existing.revision THEN
      RETURN jsonb_build_object('state','DUPLICATE','reason','SAME_OR_LOWER_REVISION',
                                'serverRevision', v_existing.revision);
    END IF;

    -- Düzeltme: NULL eski GÜVENİLİR metriği EZMEZ (COALESCE).
    UPDATE public.vehicle_trips SET
      trip_id           = coalesce(NULLIF(btrim(coalesce(p_trip_id,'')),''), trip_id),
      revision          = v_rev,
      started_at        = v_started,
      ended_at          = coalesce(v_ended, ended_at),
      distance_km       = coalesce(v_dist, distance_km),
      duration_min      = coalesce(NULLIF(p_metrics->>'durationMin','')::integer, duration_min),
      avg_speed_kmh     = coalesce(NULLIF(p_metrics->>'averageSpeedKmh','')::numeric, avg_speed_kmh),
      max_speed_kmh     = coalesce(NULLIF(p_metrics->>'maximumSpeedKmh','')::numeric, max_speed_kmh),
      fuel_used_l       = coalesce(NULLIF(p_metrics->>'fuelUsedL','')::numeric, fuel_used_l),
      estimated_cost    = coalesce(NULLIF(p_metrics->>'estimatedCost','')::numeric, estimated_cost),
      idle_time_min     = coalesce(NULLIF(p_metrics->>'idleTimeMin','')::integer, idle_time_min),
      moving_time_min   = coalesce(NULLIF(p_metrics->>'movingTimeMin','')::integer, moving_time_min),
      unknown_time_min  = coalesce(NULLIF(p_metrics->>'unknownTimeMin','')::integer, unknown_time_min),
      stop_count        = coalesce(NULLIF(p_metrics->>'stopCount','')::integer, stop_count),
      max_rpm           = coalesce(NULLIF(p_metrics->>'maxRpm','')::integer, max_rpm),
      max_engine_temp_c = coalesce(NULLIF(p_metrics->>'maxEngineTempC','')::numeric, max_engine_temp_c),
      speed_violations  = coalesce(NULLIF(p_metrics->>'speedViolations','')::integer, speed_violations),
      harsh_brake_count = coalesce(NULLIF(p_metrics->>'harshBrakeCount','')::integer, harsh_brake_count),
      harsh_accel_count = coalesce(NULLIF(p_metrics->>'harshAccelCount','')::integer, harsh_accel_count),
      fuel_used_percent = coalesce(NULLIF(p_metrics->>'fuelUsedPercent','')::numeric, fuel_used_percent),
      fuel_unit         = coalesce(v_fuel_unit, fuel_unit),
      fuel_reject_reason = coalesce(NULLIF(btrim(coalesce(p_metrics->>'fuelRejectReason','')),''), fuel_reject_reason),
      score             = coalesce(p_score::smallint, score),
      confidence        = v_conf,
      distance_source   = coalesce(v_dist_src, distance_source),
      fuel_source       = coalesce(v_fuel_src, fuel_source),
      cost_source       = coalesce(v_cost_src, cost_source),
      duration_source   = coalesce(public._trip_source(p_provenance->>'duration'), duration_source),
      avg_speed_source  = coalesce(public._trip_source(p_provenance->>'avgSpeed'), avg_speed_source),
      max_speed_source  = coalesce(public._trip_source(p_provenance->>'maxSpeed'), max_speed_source),
      idle_source       = coalesce(public._trip_source(p_provenance->>'idle'), idle_source),
      moving_source     = coalesce(public._trip_source(p_provenance->>'moving'), moving_source),
      stop_count_source = coalesce(public._trip_source(p_provenance->>'stopCount'), stop_count_source),
      max_rpm_source    = coalesce(public._trip_source(p_provenance->>'maxRpm'), max_rpm_source),
      max_temp_source   = coalesce(public._trip_source(p_provenance->>'maxTemp'), max_temp_source),
      speed_violation_source = coalesce(public._trip_source(p_provenance->>'speedViolation'), speed_violation_source),
      harsh_brake_source = coalesce(public._trip_source(p_provenance->>'harshBrake'), harsh_brake_source),
      harsh_accel_source = coalesce(public._trip_source(p_provenance->>'harshAccel'), harsh_accel_source),
      fuel_unit_price   = coalesce(NULLIF(p_price->>'unitPrice','')::numeric, fuel_unit_price),
      currency          = coalesce(NULLIF(btrim(coalesce(p_price->>'currency','')),''), currency),
      price_source      = coalesce(v_price_src, price_source),
      price_captured_at = coalesce(
        CASE WHEN p_price->>'capturedAtMs' IS NULL THEN NULL
             ELSE LEAST(now(), to_timestamp((p_price->>'capturedAtMs')::bigint / 1000.0)) END,
        price_captured_at),
      confidence_limited_by = coalesce(NULLIF(btrim(coalesce(p_coverage->>'limitedBy','')),''), confidence_limited_by),
      speed_sample_count = coalesce(NULLIF(p_coverage->>'speedSampleCount','')::integer, speed_sample_count),
      obd_coverage      = coalesce(NULLIF(p_coverage->>'obdCoverage','')::numeric, obd_coverage),
      time_coverage     = coalesce(NULLIF(p_coverage->>'timeCoverage','')::numeric, time_coverage),
      data_gap_count    = coalesce(NULLIF(p_coverage->>'dataGapCount','')::integer, data_gap_count),
      source_switch_count = coalesce(NULLIF(p_coverage->>'sourceSwitchCount','')::integer, source_switch_count),
      metrics_version   = coalesce(p_metrics_version, metrics_version),
      events            = CASE WHEN jsonb_typeof(p_events)='array' AND p_events <> '[]'::jsonb
                               THEN p_events ELSE events END,
      updated_at        = now()
     WHERE vehicle_id = v_vehicle_id AND trip_key = v_key;

    RETURN jsonb_build_object('state','UPDATED','reason',NULL,'serverRevision', v_rev);
  END IF;

  -- ── İLK YAZIM ────────────────────────────────────────────────────────
  INSERT INTO public.vehicle_trips (
    vehicle_id, trip_key, trip_id, revision, started_at, ended_at,
    distance_km, duration_min, avg_speed_kmh, max_speed_kmh,
    fuel_used_l, estimated_cost, idle_time_min, moving_time_min,
    unknown_time_min, stop_count, max_rpm, max_engine_temp_c, speed_violations,
    harsh_brake_count, harsh_accel_count,
    fuel_used_percent, fuel_unit, fuel_reject_reason,
    score, confidence, distance_source, fuel_source, cost_source,
    duration_source, avg_speed_source, max_speed_source, idle_source, moving_source,
    stop_count_source, max_rpm_source, max_temp_source, speed_violation_source,
    harsh_brake_source, harsh_accel_source,
    fuel_unit_price, currency, price_source, price_captured_at,
    confidence_limited_by, speed_sample_count, obd_coverage, time_coverage,
    data_gap_count, source_switch_count, metrics_version, events
  ) VALUES (
    v_vehicle_id, v_key, NULLIF(btrim(coalesce(p_trip_id,'')),''), v_rev, v_started, v_ended,
    v_dist,
    NULLIF(p_metrics->>'durationMin','')::integer,
    NULLIF(p_metrics->>'averageSpeedKmh','')::numeric,
    NULLIF(p_metrics->>'maximumSpeedKmh','')::numeric,
    NULLIF(p_metrics->>'fuelUsedL','')::numeric,
    NULLIF(p_metrics->>'estimatedCost','')::numeric,
    NULLIF(p_metrics->>'idleTimeMin','')::integer,
    NULLIF(p_metrics->>'movingTimeMin','')::integer,
    NULLIF(p_metrics->>'unknownTimeMin','')::integer,
    NULLIF(p_metrics->>'stopCount','')::integer,
    NULLIF(p_metrics->>'maxRpm','')::integer,
    NULLIF(p_metrics->>'maxEngineTempC','')::numeric,
    NULLIF(p_metrics->>'speedViolations','')::integer,
    NULLIF(p_metrics->>'harshBrakeCount','')::integer,
    NULLIF(p_metrics->>'harshAccelCount','')::integer,
    NULLIF(p_metrics->>'fuelUsedPercent','')::numeric,
    v_fuel_unit,
    NULLIF(btrim(coalesce(p_metrics->>'fuelRejectReason','')),''),
    /* Bu üç kolon 046'da NOT NULL: `_trip_source` NULL dönerse (istemci
       provenance göndermediyse) DEFAULT devreye GİRMEZ — açık NULL ihlal
       olur. İlk yazımda dürüst taban değer `UNAVAILABLE`'dır.
       (UPDATE tarafında ise NULL kasıtlıdır: eskiyi EZMEZ.) */
    p_score::smallint, v_conf,
    coalesce(v_dist_src, 'UNAVAILABLE'),
    coalesce(v_fuel_src, 'UNAVAILABLE'),
    coalesce(v_cost_src, 'UNAVAILABLE'),
    public._trip_source(p_provenance->>'duration'),
    public._trip_source(p_provenance->>'avgSpeed'),
    public._trip_source(p_provenance->>'maxSpeed'),
    public._trip_source(p_provenance->>'idle'),
    public._trip_source(p_provenance->>'moving'),
    public._trip_source(p_provenance->>'stopCount'),
    public._trip_source(p_provenance->>'maxRpm'),
    public._trip_source(p_provenance->>'maxTemp'),
    public._trip_source(p_provenance->>'speedViolation'),
    public._trip_source(p_provenance->>'harshBrake'),
    public._trip_source(p_provenance->>'harshAccel'),
    NULLIF(p_price->>'unitPrice','')::numeric,
    NULLIF(btrim(coalesce(p_price->>'currency','')),''),
    v_price_src,
    CASE WHEN p_price->>'capturedAtMs' IS NULL THEN NULL
         ELSE LEAST(now(), to_timestamp((p_price->>'capturedAtMs')::bigint / 1000.0)) END,
    NULLIF(btrim(coalesce(p_coverage->>'limitedBy','')),''),
    NULLIF(p_coverage->>'speedSampleCount','')::integer,
    NULLIF(p_coverage->>'obdCoverage','')::numeric,
    NULLIF(p_coverage->>'timeCoverage','')::numeric,
    NULLIF(p_coverage->>'dataGapCount','')::integer,
    NULLIF(p_coverage->>'sourceSwitchCount','')::integer,
    p_metrics_version,
    CASE WHEN jsonb_typeof(p_events)='array' THEN p_events ELSE '[]'::jsonb END
  );

  RETURN jsonb_build_object('state','CREATED','reason',NULL,'serverRevision', v_rev);
END;
$function$;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- DOĞRULAMA (fail-closed) — kapsam gerçekten genişledi mi
-- ═══════════════════════════════════════════════════════════════════════════
DO $verify$
DECLARE n integer; bad text;
BEGIN
  /* Hedeflenen 8 fonksiyonun HEPSİ sha256 dalını taşımalı. */
  SELECT count(*), string_agg(p.proname, ', ')
    INTO n, bad
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public'
     AND p.proname IN ('delete_geofence_zone','get_active_driver_assignment',
                       'get_geofence_zones','push_geofence_zone','push_vehicle_event',
                       'record_vehicle_identity','refresh_linking_code','upload_vehicle_trip')
     AND p.prosrc NOT LIKE '%sha256(p_api_key%';
  IF n > 0 THEN
    RAISE EXCEPTION '071 DOGRULAMA: % fonksiyon sha256 dalini ALMAMIS: %', n, bad;
  END IF;

  /* Eski düz dal KORUNMALI — kaldırılırsa mevcut cihazlar ANINDA düşer. */
  SELECT count(*), string_agg(p.proname, ', ')
    INTO n, bad
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public'
     AND p.proname IN ('delete_geofence_zone','get_active_driver_assignment',
                       'get_geofence_zones','push_geofence_zone','push_vehicle_event',
                       'record_vehicle_identity','upload_vehicle_trip')
     AND p.prosrc NOT LIKE '%coalesce(api_key_hash, api_key) = p_api_key%';
  IF n > 0 THEN
    RAISE EXCEPTION
      '071 DOGRULAMA: % fonksiyonda ESKI dal KAYBOLMUS: % . Asama 1 EKLEMELIDIR; '
      'eski dali kaldirmak mevcut cihazlari aninda duserirdi.', n, bad;
  END IF;

  /* Veri DEĞİŞMEMELİ: bu aşamada hiçbir satır hash'lenmez. */
  SELECT count(*) INTO n FROM public.vehicles WHERE api_key_hash ~ '^[0-9a-f]{64}$';
  IF n > 0 THEN
    RAISE EXCEPTION '071 DOGRULAMA: % satir hash bicimine donmus — Asama 1 VERI DEGISTIRMEZ', n;
  END IF;

  RAISE NOTICE '071 DOGRULAMA GECTI: 8 fonksiyon cift okuma yapiyor, eski dal korundu, veri degismedi';
END
$verify$;
