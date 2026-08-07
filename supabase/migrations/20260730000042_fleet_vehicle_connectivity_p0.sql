-- =====================================================================
-- Migration 042: FLEET VEHICLE CONNECTIVITY P0
--
-- ⚠️  BU MIGRATION PRODUCTION'A UYGULANMADI (033–041 ile aynı durumda).
--     Yerel doğrulama ortamında koşulmak üzere hazırlanmıştır.
--
-- ── NEDEN VAR (ölçülen kusurlar) ─────────────────────────────────────
-- 1. `push_vehicle_event` hız için `coalesce(NULLIF(payload->>'speed',''), 0)`
--    kullanıyordu → payload'da hız YOKSA veritabanına **0 km/h** yazılıyordu.
--    "Bilinmiyor" ile "ölçülen sıfır" aynı değere düşüyor ve Fleet UI durmuş
--    bir aracı 0 km/h diye GÖSTERİYORDU. (fuel/temp/rpm için koruma zaten
--    vardı: `CASE WHEN NULLIF(...) IS NULL THEN t.x ELSE EXCLUDED.x END`.)
-- 2. GPS `accuracy` HİÇBİR kolona yazılmıyordu → konum kalitesi sorgulanamaz.
-- 3. Tazelik tek alandan (`updated_at`) türetiliyordu: GPS eski ama heartbeat
--    yeni olduğunda konum "canlı" görünüyordu. Sinyal başına gözlem damgası yok.
-- 4. `observed_at` (gözlem anı) ile `received_at` (sunucu kabul anı) ayrımı yok →
--    istemci saati tek otorite durumundaydı.
-- 5. Fleet, VIN / marka / model / fingerprint / aktif OBD protokolünü GÖREMİYOR.
--
-- ── NE YAPMAZ ────────────────────────────────────────────────────────
-- · Harici GPS · geofence · route history · Driver DNA · Deep Scan genişletmesi
--   · araç kapalıyken canlı takip → KAPSAM DIŞI.
-- · 033–041 geçmişine DOKUNMAZ. Yalnız ileri değişiklik yapar.
-- · Raw `api_key` okumaya izin VERMEZ; hiçbir yeni fonksiyon anahtarı DÖNDÜRMEZ.
-- · `pair_vehicle_to_user` · ownership · transfer · realtime · offline kuyruk
--   sözleşmelerine DOKUNMAZ.
-- =====================================================================

BEGIN;

-- ── 0. ÖN KOŞULLAR (fail-closed) ─────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='vehicles') THEN
    RAISE EXCEPTION '042 DURDU: public.vehicles YOK';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='vehicle_telemetry') THEN
    RAISE EXCEPTION '042 DURDU: public.vehicle_telemetry YOK';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='push_vehicle_event'
  ) THEN
    RAISE EXCEPTION '042 DURDU: push_vehicle_event YOK (migration 034 uygulanmamış)';
  END IF;
END $$;

-- ── 1. TAZELİK VE KALİTE KOLONLARI (hepsi NULLABLE → geriye uyumlu) ──
ALTER TABLE public.vehicle_telemetry
  ADD COLUMN IF NOT EXISTS accuracy_m        double precision,
  ADD COLUMN IF NOT EXISTS observed_at       timestamptz,
  ADD COLUMN IF NOT EXISTS received_at       timestamptz,
  ADD COLUMN IF NOT EXISTS gps_observed_at   timestamptz,
  ADD COLUMN IF NOT EXISTS obd_observed_at   timestamptz,
  ADD COLUMN IF NOT EXISTS health_observed_at timestamptz,
  ADD COLUMN IF NOT EXISTS telemetry_source  text,
  ADD COLUMN IF NOT EXISTS location_source   text;

-- Kaynak enum'ı KISITLA (serbest metin yerine sözleşme). Harici GPS bu paketin
-- kapsamı dışında ama enum ileriye açık bırakıldı.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.vehicle_telemetry'::regclass AND conname='vehicle_telemetry_source_allowed'
  ) THEN
    ALTER TABLE public.vehicle_telemetry
      ADD CONSTRAINT vehicle_telemetry_source_allowed CHECK (
        telemetry_source IS NULL OR telemetry_source IN
          ('HEAD_UNIT_GPS','HEAD_UNIT_OBD','EXTERNAL_GPS','UNKNOWN')
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.vehicle_telemetry'::regclass AND conname='vehicle_telemetry_location_source_allowed'
  ) THEN
    ALTER TABLE public.vehicle_telemetry
      ADD CONSTRAINT vehicle_telemetry_location_source_allowed CHECK (
        location_source IS NULL OR location_source IN
          ('HEAD_UNIT_GPS','EXTERNAL_GPS','UNKNOWN')
      );
  END IF;
END $$;

-- `vehicle_locations` geçmişine de doğruluk + kaynak (analiz/rota için).
ALTER TABLE public.vehicle_locations
  ADD COLUMN IF NOT EXISTS accuracy_m      double precision,
  ADD COLUMN IF NOT EXISTS observed_at     timestamptz,
  ADD COLUMN IF NOT EXISTS location_source text;

CREATE INDEX IF NOT EXISTS vehicle_telemetry_observed_at_idx
  ON public.vehicle_telemetry (observed_at DESC);

-- ── 2. ARAÇ KİMLİK ÖZETİ ─────────────────────────────────────────────
-- AYRI TABLO seçildi (en az riskli, geriye uyumlu): `vehicles` üzerinde
-- kolon patlaması olmaz, RLS ayrı yönetilir, kimlik çatışması sayacı
-- telemetriden bağımsız yaşar. VIN SAHİPLİK OTORİTESİ DEĞİLDİR — yalnız
-- gözlemdir; ownership `vehicles.owner_id`/`company_id`'de kalır.
CREATE TABLE IF NOT EXISTS public.vehicle_identity (
  vehicle_id           uuid PRIMARY KEY REFERENCES public.vehicles(id) ON DELETE CASCADE,
  vin                  text,
  -- VIN'in NEREDEN geldiği. `OBD_MODE09` = 0902 yanıtı; `UNVERIFIED` = kaynak
  -- doğrulanmadı. `verified` gibi bir bayrak UYDURULMAZ.
  vin_source           text,
  vin_observed_at      timestamptz,
  make                 text,
  model                text,
  model_year           smallint,
  -- Ham fingerprint TAŞINMAZ: sürümlü hash + özet.
  fingerprint_hash     text,
  fingerprint_version  smallint,
  active_obd_protocol  text,
  -- 0.00–1.00 arası sınırlı güven. İlk kayıt düşük başlar, tekrar eden aynı
  -- gözlemle artar; çatışmada DÜŞÜRÜLÜR (bounded politika).
  identity_confidence  numeric(3,2) NOT NULL DEFAULT 0.00,
  identity_updated_at  timestamptz NOT NULL DEFAULT now(),
  -- Şüpheli kimlik değişimi sayacı — sessiz overwrite YOK.
  identity_conflict_count integer NOT NULL DEFAULT 0,
  last_conflict_at     timestamptz,
  last_conflict_reason text,
  created_at           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT vehicle_identity_confidence_range
    CHECK (identity_confidence >= 0 AND identity_confidence <= 1),
  CONSTRAINT vehicle_identity_vin_source_allowed
    CHECK (vin_source IS NULL OR vin_source IN ('OBD_MODE09','MANUAL','UNVERIFIED')),
  CONSTRAINT vehicle_identity_vin_shape
    CHECK (vin IS NULL OR length(vin) BETWEEN 11 AND 17)
);

CREATE INDEX IF NOT EXISTS vehicle_identity_vin_idx ON public.vehicle_identity (vin);

-- ── 3. push_vehicle_event — DÜRÜST YAZMA ─────────────────────────────
-- 034 gövdesiyle AYNI; farklar YALNIZ:
--   (a) `speed` artık coalesce(...,0) DEĞİL → yoksa eski değer KORUNUR,
--   (b) accuracy / observed_at / received_at / kaynak alanları yazılır,
--   (c) `vehicle_locations`'a doğruluk + kaynak eklenir.
-- Kapsam/yetki/rate-limit/boyut kapıları DEĞİŞMEDİ.
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
  WHERE coalesce(api_key_hash, api_key) = p_api_key;
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

-- ── 4. KİMLİK KAYDI RPC — api_key auth, anahtar DÖNDÜRMEZ ────────────
-- Bounded güven politikası:
--   · İlk kayıt            → confidence 0.50 (VIN varsa 0.70)
--   · Aynı VIN tekrar      → +0.10 (üst sınır 0.95; 1.00 ASLA — mutlak iddia yok)
--   · VIN/fingerprint çatışması → conflict sayacı +1, confidence 0.30'a DÜŞER,
--     ESKİ GÜVENİLİR KAYIT KORUNUR (yeni VIN yazılmaz), sebep kaydedilir.
CREATE OR REPLACE FUNCTION public.record_vehicle_identity(
  p_api_key             text,
  p_vin                 text    DEFAULT NULL,
  p_vin_source          text    DEFAULT NULL,
  p_make                text    DEFAULT NULL,
  p_model               text    DEFAULT NULL,
  p_model_year          int     DEFAULT NULL,
  p_fingerprint_hash    text    DEFAULT NULL,
  p_fingerprint_version int     DEFAULT NULL,
  p_active_obd_protocol text    DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_vehicle_id uuid;
  v_existing   public.vehicle_identity%ROWTYPE;
  v_vin        text := NULLIF(btrim(coalesce(p_vin, '')), '');
  v_src        text := NULLIF(btrim(coalesce(p_vin_source, '')), '');
  v_conflict   boolean := false;
  v_reason     text := NULL;
  v_conf       numeric(3,2);
BEGIN
  SELECT id INTO v_vehicle_id FROM public.vehicles
   WHERE coalesce(api_key_hash, api_key) = p_api_key;
  IF v_vehicle_id IS NULL THEN
    RAISE EXCEPTION 'invalid_api_key' USING ERRCODE='P0001';
  END IF;

  IF v_src IS NOT NULL AND v_src NOT IN ('OBD_MODE09','MANUAL','UNVERIFIED') THEN
    v_src := 'UNVERIFIED';   -- doğrulanmamış kaynak "verified" gibi işaretlenmez
  END IF;
  IF v_vin IS NOT NULL AND length(v_vin) NOT BETWEEN 11 AND 17 THEN
    v_vin := NULL;           -- biçimi tutmayan VIN kabul EDİLMEZ (null = bilinmiyor)
    v_src := NULL;
  END IF;

  SELECT * INTO v_existing FROM public.vehicle_identity
   WHERE vehicle_id = v_vehicle_id FOR UPDATE;

  IF NOT FOUND THEN
    v_conf := CASE WHEN v_vin IS NOT NULL THEN 0.70 ELSE 0.50 END;
    INSERT INTO public.vehicle_identity (
      vehicle_id, vin, vin_source, vin_observed_at, make, model, model_year,
      fingerprint_hash, fingerprint_version, active_obd_protocol,
      identity_confidence, identity_updated_at
    ) VALUES (
      v_vehicle_id, v_vin, v_src,
      CASE WHEN v_vin IS NOT NULL THEN now() ELSE NULL END,
      NULLIF(btrim(coalesce(p_make,'')),''), NULLIF(btrim(coalesce(p_model,'')),''),
      p_model_year, NULLIF(btrim(coalesce(p_fingerprint_hash,'')),''),
      p_fingerprint_version, NULLIF(btrim(coalesce(p_active_obd_protocol,'')),''),
      v_conf, now()
    );
    RETURN jsonb_build_object('state','CREATED','conflict',false,'identityConfidence',v_conf);
  END IF;

  -- ÇATIŞMA TESPİTİ — sessiz overwrite YASAK.
  IF v_vin IS NOT NULL AND v_existing.vin IS NOT NULL AND v_vin <> v_existing.vin THEN
    v_conflict := true; v_reason := 'VIN_MISMATCH';
  ELSIF p_fingerprint_hash IS NOT NULL AND v_existing.fingerprint_hash IS NOT NULL
        AND p_fingerprint_hash <> v_existing.fingerprint_hash THEN
    v_conflict := true; v_reason := 'FINGERPRINT_MISMATCH';
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
    RETURNING identity_confidence INTO v_conf;

    RETURN jsonb_build_object(
      'state','IDENTITY_CONFLICT','conflict',true,'reason',v_reason,
      'identityConfidence',v_conf);
  END IF;

  -- Uyumlu gözlem → bounded güven artışı (1.00 ASLA).
  v_conf := LEAST(0.95, v_existing.identity_confidence + 0.10);

  UPDATE public.vehicle_identity
     SET vin                 = coalesce(v_vin, vin),
         vin_source          = coalesce(v_src, vin_source),
         vin_observed_at     = CASE WHEN v_vin IS NOT NULL THEN now() ELSE vin_observed_at END,
         make                = coalesce(NULLIF(btrim(coalesce(p_make,'')),''), make),
         model               = coalesce(NULLIF(btrim(coalesce(p_model,'')),''), model),
         model_year          = coalesce(p_model_year, model_year),
         fingerprint_hash    = coalesce(NULLIF(btrim(coalesce(p_fingerprint_hash,'')),''), fingerprint_hash),
         fingerprint_version = coalesce(p_fingerprint_version, fingerprint_version),
         active_obd_protocol = coalesce(NULLIF(btrim(coalesce(p_active_obd_protocol,'')),''), active_obd_protocol),
         identity_confidence = v_conf,
         identity_updated_at = now()
   WHERE vehicle_id = v_vehicle_id;

  RETURN jsonb_build_object('state','UPDATED','conflict',false,'identityConfidence',v_conf);
END;
$fn$;

-- ── 5. FLEET OKUMA RPC — kimlik özeti (VIN maskeli) ──────────────────
-- Ham VIN yerine SON 6 HANE döner (mevcut gizlilik politikası ile uyumlu).
CREATE OR REPLACE FUNCTION public.list_company_vehicle_identity()
RETURNS TABLE (
  vehicle_id uuid, vin_masked text, vin_source text, vin_observed_at timestamptz,
  make text, model text, model_year smallint,
  fingerprint_hash_short text, fingerprint_version smallint,
  active_obd_protocol text, identity_confidence numeric,
  identity_updated_at timestamptz, identity_conflict_count integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
#variable_conflict use_column
DECLARE
  v_uid uuid := auth.uid();
  v_co  uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE='P0001'; END IF;
  SELECT p.company_id INTO v_co FROM public.profiles p WHERE p.id = v_uid;

  RETURN QUERY
    SELECT vi.vehicle_id,
           CASE WHEN vi.vin IS NULL THEN NULL
                ELSE '•••' || right(vi.vin, 6) END,
           vi.vin_source, vi.vin_observed_at,
           vi.make, vi.model, vi.model_year,
           CASE WHEN vi.fingerprint_hash IS NULL THEN NULL
                ELSE left(vi.fingerprint_hash, 12) END,
           vi.fingerprint_version, vi.active_obd_protocol,
           vi.identity_confidence, vi.identity_updated_at, vi.identity_conflict_count
      FROM public.vehicle_identity vi
      JOIN public.vehicles v ON v.id = vi.vehicle_id
     WHERE v.owner_id = v_uid
        OR (v.company_id IS NOT NULL AND v_co IS NOT NULL AND v.company_id = v_co)
     LIMIT 200;   -- BOUNDED
END;
$fn$;

-- ── 6. RLS + GRANT ───────────────────────────────────────────────────
ALTER TABLE public.vehicle_identity ENABLE ROW LEVEL SECURITY;

-- İstemci DOĞRUDAN yazamaz; okuma yalnız kapsam içinde.
REVOKE ALL ON public.vehicle_identity FROM PUBLIC, anon;
GRANT SELECT ON public.vehicle_identity TO authenticated;
GRANT ALL    ON public.vehicle_identity TO service_role;

DROP POLICY IF EXISTS vehicle_identity_scope_read ON public.vehicle_identity;
CREATE POLICY vehicle_identity_scope_read ON public.vehicle_identity
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.vehicles v
    WHERE v.id = vehicle_identity.vehicle_id
      AND (v.owner_id = auth.uid()
           OR (v.company_id IS NOT NULL
               AND v.company_id = (SELECT p.company_id FROM public.profiles p WHERE p.id = auth.uid())))
  ));

-- `record_vehicle_identity` api_key ile kimliklenir → cihaz çağırır (anon yolu).
-- `push_vehicle_event` ile AYNI güven modeli; anahtar DÖNDÜRMEZ.
REVOKE ALL ON FUNCTION public.record_vehicle_identity(text,text,text,text,text,int,text,int,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_vehicle_identity(text,text,text,text,text,int,text,int,text)
  TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.list_company_vehicle_identity() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_company_vehicle_identity() TO authenticated, service_role;

-- ── 7. DOĞRULAMA (fail-closed) ───────────────────────────────────────
DO $$
DECLARE
  v_missing text;
  v_leak    int;
BEGIN
  -- Kolonlar
  SELECT string_agg(c, ', ') INTO v_missing FROM (
    SELECT c FROM unnest(ARRAY['accuracy_m','observed_at','received_at',
      'gps_observed_at','obd_observed_at','health_observed_at',
      'telemetry_source','location_source']) AS c
    WHERE NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='vehicle_telemetry' AND column_name=c)
  ) q;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '042 DOĞRULAMA DÜŞTÜ: vehicle_telemetry kolonları eksik: %', v_missing;
  END IF;

  -- `speed` artık coalesce(...,0) İÇERMEMELİ (bilinmeyen 0 olmamalı)
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='push_vehicle_event'
      AND pg_get_functiondef(p.oid) ILIKE '%coalesce(NULLIF(v_payload->>''speed''%'
  ) THEN
    RAISE EXCEPTION '042 DOĞRULAMA DÜŞTÜ: push_vehicle_event hâlâ hızı 0 ile dolduruyor';
  END IF;

  -- anon, kimlik tablosunu OKUYAMAZ / YAZAMAZ
  IF has_table_privilege('anon','public.vehicle_identity','SELECT')
     OR has_table_privilege('anon','public.vehicle_identity','INSERT') THEN
    RAISE EXCEPTION '042 DOĞRULAMA DÜŞTÜ: anon vehicle_identity erişimi var';
  END IF;

  -- Okuma RPC'si anon'a KAPALI
  IF has_function_privilege('anon','public.list_company_vehicle_identity()','EXECUTE') THEN
    RAISE EXCEPTION '042 DOĞRULAMA DÜŞTÜ: anon list_company_vehicle_identity çalıştırabiliyor';
  END IF;

  -- SECURITY DEFINER + sabit search_path
  SELECT count(*) INTO v_leak
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public'
    AND p.proname IN ('record_vehicle_identity','list_company_vehicle_identity','push_vehicle_event')
    AND (NOT p.prosecdef
         OR p.proconfig IS NULL
         OR array_to_string(p.proconfig,',') NOT ILIKE '%search_path%');
  IF v_leak > 0 THEN
    RAISE EXCEPTION '042 DOĞRULAMA DÜŞTÜ: % fonksiyonda SECURITY DEFINER/search_path eksik', v_leak;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public'
                 AND tablename='vehicle_identity' AND rowsecurity) THEN
    RAISE EXCEPTION '042 DOĞRULAMA DÜŞTÜ: vehicle_identity RLS kapalı';
  END IF;

  RAISE NOTICE '042 OK: tazelik/kaynak kolonları · bilinmeyen≠0 · kimlik özeti + RLS · anon kapalı.';
END $$;

COMMIT;

-- =====================================================================
-- FORWARD-FIX NOTU: bu migration yalnız NULLABLE kolon ekler, yeni tablo
-- yaratır ve `push_vehicle_event` gövdesini dürüstleştirir. Mevcut satırlar
-- DEĞİŞTİRİLMEZ (backfill YOK — geçmiş `0` değerleri "ölçülen 0" mu
-- "bilinmiyor" mu ayırt edilemez; sahte veri üretmemek için dokunulmadı).
-- =====================================================================
