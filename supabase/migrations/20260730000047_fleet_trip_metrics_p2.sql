-- ═══════════════════════════════════════════════════════════════════════════
-- 047 — FLEET TRIP METRICS P2
--
-- YALNIZ İLERİ MIGRATION. 033–046 geçmişi DEĞİŞTİRİLMEZ.
-- Mevcut 046 satırları BOZULMAZ (tüm yeni kolonlar NULLABLE).
--
-- ── NEDEN ────────────────────────────────────────────────────────────────
-- P1'de her metrik tek bir değer olarak saklanıyordu ve provenance yalnız
-- ÜÇ alanda (`distance_source`, `fuel_source`, `cost_source`) vardı.
-- §2 gereği **her metriğin kendi provenance'ı** olmalı: tek genel
-- "trip estimated" bayrağı yeterli DEĞİLDİR — bir trip'in mesafesi ölçülmüş,
-- yakıtı tahmini, RPM'i hiç yok olabilir.
--
-- ── EKLENENLER ───────────────────────────────────────────────────────────
--   · metrik başına provenance kolonları
--   · yakıt YÜZDE ölçümü (litre DEĞİL — dönüşüm ayrı ve DERIVED)
--   · yakıt birimi + para birimi + birim fiyat SNAPSHOT'ı ve kaynağı
--   · bilinmeyen süre (`unknown_time_min`) — idle'dan AYRI kova
--   · kapsama kanıtı (confidence denetlenebilir olsun)
--   · `metrics_version` — alan kümesi sürümü
--   · `VERY_HIGH` confidence (046 CHECK kısıtı bunu REDDEDİYORDU)
--
-- ── KORUNANLAR ───────────────────────────────────────────────────────────
--   · `(vehicle_id, trip_key)` UNIQUE ve dedupe/revizyon davranışı
--   · RLS, tenant isolation, anon kilidi
--   · SECURITY DEFINER + sabit `search_path`
--   · `COALESCE(EXCLUDED.x, t.x)` → NULL eski güvenilir metriği EZMEZ
--   · KOORDİNAT KOLONU YOK (rota geçmişi kapsam dışı)
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. YENİ KOLONLAR (hepsi NULLABLE — geriye uyumlu) ───────────────────
ALTER TABLE public.vehicle_trips
  -- Bilinmeyen süre: idle'dan AYRI. "Veri yoktu" ile "duruyordu" bir değildir.
  ADD COLUMN IF NOT EXISTS unknown_time_min integer,

  -- Yakıt ÖLÇÜMÜ yüzde puandır; litre DÖNÜŞÜMDÜR (depo kapasitesine bağlı).
  ADD COLUMN IF NOT EXISTS fuel_used_percent numeric(5,2),
  ADD COLUMN IF NOT EXISTS fuel_unit text,
  ADD COLUMN IF NOT EXISTS fuel_reject_reason text,

  -- Fiyat SNAPSHOT'ı: trip kapandıktan sonra fiyat değişse maliyet DEĞİŞMEZ.
  ADD COLUMN IF NOT EXISTS fuel_unit_price numeric(12,4),
  ADD COLUMN IF NOT EXISTS currency text,
  ADD COLUMN IF NOT EXISTS price_source text,
  ADD COLUMN IF NOT EXISTS price_captured_at timestamptz,

  -- Metrik başına provenance (§2).
  ADD COLUMN IF NOT EXISTS duration_source text,
  ADD COLUMN IF NOT EXISTS avg_speed_source text,
  ADD COLUMN IF NOT EXISTS max_speed_source text,
  ADD COLUMN IF NOT EXISTS idle_source text,
  ADD COLUMN IF NOT EXISTS moving_source text,
  ADD COLUMN IF NOT EXISTS stop_count_source text,
  ADD COLUMN IF NOT EXISTS max_rpm_source text,
  ADD COLUMN IF NOT EXISTS max_temp_source text,
  ADD COLUMN IF NOT EXISTS speed_violation_source text,
  ADD COLUMN IF NOT EXISTS harsh_brake_source text,
  ADD COLUMN IF NOT EXISTS harsh_accel_source text,

  -- Confidence kanıtı — türetme DENETLENEBİLİR olsun.
  ADD COLUMN IF NOT EXISTS confidence_limited_by text,
  ADD COLUMN IF NOT EXISTS speed_sample_count integer,
  ADD COLUMN IF NOT EXISTS obd_coverage numeric(4,3),
  ADD COLUMN IF NOT EXISTS time_coverage numeric(4,3),
  ADD COLUMN IF NOT EXISTS data_gap_count integer,
  ADD COLUMN IF NOT EXISTS source_switch_count integer,

  ADD COLUMN IF NOT EXISTS metrics_version integer;

-- ── 2. KISITLAR ─────────────────────────────────────────────────────────
DO $$
DECLARE
  c text;
  v_sources text := '''MEASURED'',''DERIVED'',''ESTIMATED'',''UNAVAILABLE''';
BEGIN
  -- (a) `VERY_HIGH` 046'da REDDEDİLİYORDU — kısıt genişletilir.
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='vehicle_trips_confidence_valid') THEN
    ALTER TABLE public.vehicle_trips DROP CONSTRAINT vehicle_trips_confidence_valid;
  END IF;
  ALTER TABLE public.vehicle_trips
    ADD CONSTRAINT vehicle_trips_confidence_valid
    CHECK (confidence IN ('VERY_HIGH','HIGH','MEDIUM','LOW','UNKNOWN'));

  -- (b) Her provenance kolonu YALNIZ dört sınıftan biri olabilir (veya NULL).
  FOR c IN SELECT unnest(ARRAY[
    'duration_source','avg_speed_source','max_speed_source','idle_source',
    'moving_source','stop_count_source','max_rpm_source','max_temp_source',
    'speed_violation_source','harsh_brake_source','harsh_accel_source'
  ]) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'vt_' || c || '_valid'
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.vehicle_trips ADD CONSTRAINT %I CHECK (%I IS NULL OR %I IN (%s))',
        'vt_' || c || '_valid', c, c, v_sources);
    END IF;
  END LOOP;

  -- (c) Fiyat kaynağı enum'u.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='vehicle_trips_price_source_valid') THEN
    ALTER TABLE public.vehicle_trips
      ADD CONSTRAINT vehicle_trips_price_source_valid
      CHECK (price_source IS NULL OR price_source IN
             ('USER_DEFINED','DEFAULT_FALLBACK','UNAVAILABLE'));
  END IF;

  -- (d) Yakıt birimi: yüzde ölçümü ile litre dönüşümü KARIŞMASIN.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='vehicle_trips_fuel_unit_valid') THEN
    ALTER TABLE public.vehicle_trips
      ADD CONSTRAINT vehicle_trips_fuel_unit_valid
      CHECK (fuel_unit IS NULL OR fuel_unit IN ('L','PERCENT'));
  END IF;

  -- (e) Yeni sayısal alanlar negatif olamaz; kapsama 0–1 arası.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='vehicle_trips_p2_nonnegative') THEN
    ALTER TABLE public.vehicle_trips
      ADD CONSTRAINT vehicle_trips_p2_nonnegative CHECK (
        (unknown_time_min   IS NULL OR unknown_time_min   >= 0) AND
        (fuel_used_percent  IS NULL OR (fuel_used_percent >= 0 AND fuel_used_percent <= 100)) AND
        (fuel_unit_price    IS NULL OR fuel_unit_price    >= 0) AND
        (speed_sample_count IS NULL OR speed_sample_count >= 0) AND
        (data_gap_count     IS NULL OR data_gap_count     >= 0) AND
        (source_switch_count IS NULL OR source_switch_count >= 0) AND
        (obd_coverage  IS NULL OR (obd_coverage  >= 0 AND obd_coverage  <= 1)) AND
        (time_coverage IS NULL OR (time_coverage >= 0 AND time_coverage <= 1))
      );
  END IF;

  -- (f) SÜRE INVARYANTI: moving + idle + unknown süreyi AŞAMAZ.
  --     Dakika yuvarlaması nedeniyle 3 dakikalık tolerans (her kova ±1 dk).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='vehicle_trips_duration_invariant') THEN
    ALTER TABLE public.vehicle_trips
      ADD CONSTRAINT vehicle_trips_duration_invariant CHECK (
        duration_min IS NULL
        OR (coalesce(moving_time_min,0) + coalesce(idle_time_min,0)
            + coalesce(unknown_time_min,0)) <= duration_min + 3
      );
  END IF;
END $$;

-- ── 2b. PROVENANCE OKUYUCU (yardımcı) ───────────────────────────────────
--
-- NEDEN AYRI FONKSİYON: 047 provenance'ı ONBİR yeni kolonda taşıyor. Aynı
-- daraltma mantığını her kolon için tekrar yazmak, birinde unutulduğunda
-- sessizce uydurma değer yazılması demektir.
--
-- SÖZLEŞME: tanınmayan / boş / NULL girdi → **NULL** (uydurma YOK).
-- `NULL` dönmesi kasıtlıdır: yazma RPC'sinde `coalesce(_trip_source(...), kolon)`
-- ile kullanıldığında **eksik provenance eski güvenilir değeri EZMEZ**.
-- Bu yüzden NOT NULL olan üç eski kolonda (`distance_source`, `fuel_source`,
-- `cost_source`) INSERT tarafında ayrıca `coalesce(..., 'UNAVAILABLE')` gerekir.
CREATE OR REPLACE FUNCTION public._trip_source(p_raw text)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $fn$
  SELECT CASE
           WHEN btrim(coalesce(p_raw, '')) IN
                ('MEASURED','DERIVED','ESTIMATED','UNAVAILABLE')
           THEN btrim(p_raw)
           ELSE NULL
         END;
$fn$;

REVOKE ALL ON FUNCTION public._trip_source(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._trip_source(text) TO anon, authenticated, service_role;

-- ── 3. YAZMA RPC — P2 alanları (dedupe/revizyon DAVRANIŞI AYNI) ─────────
CREATE OR REPLACE FUNCTION public.upload_vehicle_trip(
  p_api_key       text,
  p_trip_key      text,
  p_trip_id       text        DEFAULT NULL,
  p_revision      integer     DEFAULT 1,
  p_started_at_ms bigint      DEFAULT NULL,
  p_ended_at_ms   bigint      DEFAULT NULL,
  p_metrics       jsonb       DEFAULT '{}'::jsonb,
  p_score         integer     DEFAULT NULL,
  p_confidence    text        DEFAULT NULL,
  p_sources       jsonb       DEFAULT '{}'::jsonb,
  p_events        jsonb       DEFAULT '[]'::jsonb,
  p_provenance    jsonb       DEFAULT '{}'::jsonb,
  p_price         jsonb       DEFAULT '{}'::jsonb,
  p_coverage      jsonb       DEFAULT '{}'::jsonb,
  p_metrics_version integer   DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $fn$
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
   WHERE coalesce(api_key_hash, api_key) = p_api_key;
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
$fn$;

-- ── 4. OKUMA RPC — P2 alanları eklendi (kapsam/RLS AYNI) ────────────────
DROP FUNCTION IF EXISTS public.list_vehicle_trips(uuid, integer);

CREATE OR REPLACE FUNCTION public.list_vehicle_trips(p_vehicle_id uuid, p_limit integer DEFAULT 50)
RETURNS TABLE (
  trip_key text, trip_id text, revision integer,
  started_at timestamptz, ended_at timestamptz,
  distance_km numeric, duration_min integer,
  avg_speed_kmh numeric, max_speed_kmh numeric,
  fuel_used_l numeric, fuel_used_percent numeric, fuel_unit text,
  estimated_cost numeric,
  idle_time_min integer, moving_time_min integer, unknown_time_min integer,
  stop_count integer,
  max_rpm integer, max_engine_temp_c numeric, speed_violations integer,
  harsh_brake_count integer, harsh_accel_count integer,
  score smallint, confidence text, confidence_limited_by text,
  distance_source text, fuel_source text, cost_source text,
  duration_source text, avg_speed_source text, max_speed_source text,
  idle_source text, moving_source text, stop_count_source text,
  max_rpm_source text, max_temp_source text, speed_violation_source text,
  harsh_brake_source text, harsh_accel_source text,
  fuel_unit_price numeric, currency text, price_source text,
  price_captured_at timestamptz,
  speed_sample_count integer, obd_coverage numeric, time_coverage numeric,
  data_gap_count integer, source_switch_count integer,
  metrics_version integer, received_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
#variable_conflict use_column
DECLARE
  v_uid uuid := auth.uid();
  v_co  uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;   -- fail-closed
  SELECT company_id INTO v_co FROM public.profiles WHERE id = v_uid;

  RETURN QUERY
  SELECT t.trip_key, t.trip_id, t.revision, t.started_at, t.ended_at,
         t.distance_km, t.duration_min, t.avg_speed_kmh, t.max_speed_kmh,
         t.fuel_used_l, t.fuel_used_percent, t.fuel_unit, t.estimated_cost,
         t.idle_time_min, t.moving_time_min, t.unknown_time_min, t.stop_count,
         t.max_rpm, t.max_engine_temp_c, t.speed_violations,
         t.harsh_brake_count, t.harsh_accel_count,
         t.score, t.confidence, t.confidence_limited_by,
         t.distance_source, t.fuel_source, t.cost_source,
         t.duration_source, t.avg_speed_source, t.max_speed_source,
         t.idle_source, t.moving_source, t.stop_count_source,
         t.max_rpm_source, t.max_temp_source, t.speed_violation_source,
         t.harsh_brake_source, t.harsh_accel_source,
         t.fuel_unit_price, t.currency, t.price_source, t.price_captured_at,
         t.speed_sample_count, t.obd_coverage, t.time_coverage,
         t.data_gap_count, t.source_switch_count,
         t.metrics_version, t.received_at
    FROM public.vehicle_trips t
    JOIN public.vehicles v ON v.id = t.vehicle_id
   WHERE t.vehicle_id = p_vehicle_id
     AND (v.owner_id = v_uid OR (v_co IS NOT NULL AND v.company_id = v_co))
   ORDER BY t.started_at DESC
   LIMIT LEAST(GREATEST(coalesce(p_limit, 50), 1), 200);
END;
$fn$;

-- ── 4b. ESKİ (P1) YAZMA İMZASINI DÜŞÜR ──────────────────────────────────
--
-- NEDEN: `upload_vehicle_trip` yeni parametrelerle ayrı bir OVERLOAD olarak
-- oluşur; 046'nın 11 parametreli imzası kendiliğinden KAYBOLMAZ. İki imza
-- bırakmak iki tehlike doğurur:
--   1. Eski imzayı çağıran bir yol P2 alanlarını (provenance · fiyat
--      snapshot · kapsama) SESSİZCE düşürür — trip yüklenir ama dürüstlük
--      etiketleri kaybolur. Bu, P2'nin ortadan kalkması demektir.
--   2. PostgREST aday fonksiyon seçiminde belirsizliğe düşebilir.
--
-- GÜVENLİ: 046 hiçbir ortama uygulanmadı (bkz. P1 raporu B8) → sahada eski
-- imzayı çağıran istemci YOKTUR. Tablo, veri ve dedupe davranışı AYNEN kalır;
-- düşürülen yalnız fonksiyon imzasıdır.
DROP FUNCTION IF EXISTS public.upload_vehicle_trip(
  text, text, text, integer, bigint, bigint, jsonb, integer, text, jsonb, jsonb);

-- ── 5. İZİNLER (P1 ile AYNI politika) ───────────────────────────────────
REVOKE ALL ON FUNCTION public.upload_vehicle_trip(
  text,text,text,integer,bigint,bigint,jsonb,integer,text,jsonb,jsonb,jsonb,jsonb,jsonb,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upload_vehicle_trip(
  text,text,text,integer,bigint,bigint,jsonb,integer,text,jsonb,jsonb,jsonb,jsonb,jsonb,integer)
  TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.list_vehicle_trips(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_vehicle_trips(uuid, integer)
  TO authenticated, service_role;

-- ── 6. DOĞRULAMA (fail-closed) ──────────────────────────────────────────
DO $$
DECLARE v_def text; v_missing text;
BEGIN
  -- (a) Yeni kolonlar var mı?
  SELECT string_agg(c, ', ') INTO v_missing FROM (
    SELECT c FROM unnest(ARRAY[
      'unknown_time_min','fuel_used_percent','fuel_unit','fuel_unit_price',
      'currency','price_source','price_captured_at','duration_source',
      'max_rpm_source','speed_violation_source','harsh_brake_source',
      'confidence_limited_by','speed_sample_count','obd_coverage',
      'time_coverage','data_gap_count','source_switch_count','metrics_version'
    ]) AS c
    WHERE NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name='vehicle_trips' AND column_name=c)
  ) q;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '047 HATA: kolonlar eksik: %', v_missing;
  END IF;

  -- (b) Yeni kolonların HEPSİ NULLABLE olmalı (bilinmeyen 0 YAZILMAZ).
  SELECT string_agg(column_name, ', ') INTO v_missing
    FROM information_schema.columns
   WHERE table_schema='public' AND table_name='vehicle_trips'
     AND column_name IN ('unknown_time_min','fuel_used_percent','fuel_unit_price',
                         'obd_coverage','time_coverage','metrics_version','max_rpm_source')
     AND is_nullable = 'NO';
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '047 HATA: yeni kolonlar NOT NULL: %', v_missing;
  END IF;

  -- (c) `VERY_HIGH` artık KABUL edilmeli.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname='vehicle_trips_confidence_valid'
       AND pg_get_constraintdef(oid) LIKE '%VERY_HIGH%'
  ) THEN
    RAISE EXCEPTION '047 HATA: VERY_HIGH confidence hala reddediliyor';
  END IF;

  -- (d) DEDUPE kısıtı KORUNMUŞ olmalı.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='vehicle_trips_key_unique') THEN
    RAISE EXCEPTION '047 HATA: dedupe UNIQUE kisiti kayboldu';
  END IF;

  -- (e) KOORDİNAT KOLONU eklenmemiş olmalı.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='vehicle_trips'
       AND (column_name IN ('lat','lng','latitude','longitude') OR column_name ILIKE '%coord%')
  ) THEN
    RAISE EXCEPTION '047 HATA: koordinat kolonu eklendi (kapsam disi)';
  END IF;

  -- (f) RLS + anon kilidi KORUNMUŞ olmalı.
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='vehicle_trips' AND rowsecurity
  ) THEN
    RAISE EXCEPTION '047 HATA: RLS kapali';
  END IF;
  IF has_table_privilege('anon','public.vehicle_trips','SELECT') THEN
    RAISE EXCEPTION '047 HATA: anon SELECT yetkisi acik';
  END IF;
  IF has_function_privilege('anon','public.list_vehicle_trips(uuid,integer)','EXECUTE') THEN
    RAISE EXCEPTION '047 HATA: anon okuma RPC yetkisi acik';
  END IF;

  -- (g) Yazma RPC: DEFINER + search_path + dedupe hükmü + COALESCE koruması.
  -- NOT: `pg_get_function_identity_arguments` parametre İSİMLERİNİ de
  -- döndürür (`p_price jsonb, ...`) — yalnız tip dizisine göre desen
  -- yazmak ASLA eşleşmez. P2 imzasını ayırt eden şey `p_metrics_version`
  -- parametresidir; onu arıyoruz.
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='upload_vehicle_trip'
     AND pg_get_function_identity_arguments(p.oid) LIKE '%p_metrics_version integer%'
   LIMIT 1;
  IF v_def IS NULL THEN
    RAISE EXCEPTION '047 HATA: yeni upload_vehicle_trip imzasi yok';
  END IF;
  IF v_def NOT LIKE '%SECURITY DEFINER%' OR v_def NOT LIKE '%search_path%' THEN
    RAISE EXCEPTION '047 HATA: DEFINER/search_path eksik';
  END IF;
  IF v_def NOT LIKE '%DUPLICATE%' THEN
    RAISE EXCEPTION '047 HATA: dedupe hukmu kayboldu';
  END IF;

  -- (g2) TEK yazma imzası kalmalı — eski overload P2 alanlarını düşürürdü.
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public' AND p.proname='upload_vehicle_trip') <> 1 THEN
    RAISE EXCEPTION '047 HATA: upload_vehicle_trip birden fazla imzaya sahip';
  END IF;

  -- (h) BAĞIMLILIK CANLI ÇALIŞIYOR MU.
  --
  -- NEDEN GEREKLİ: plpgsql gövdesi CREATE anında DERLENMEZ (geç bağlanma).
  -- `upload_vehicle_trip` içindeki `public._trip_source(...)` çağrısı bu
  -- fonksiyon YOKSA bile migration'ı GEÇİRİR ve hata ancak ilk gerçek
  -- yüklemede (`42883 undefined_function`) ortaya çıkar — yani sahada,
  -- sessizce, HER trip yüklemesi ölerek. Metne bakan denetim bunu YAKALAMAZ;
  -- fonksiyonu ÇAĞIRMAK gerekir.
  IF public._trip_source('MEASURED')    IS DISTINCT FROM 'MEASURED'
  OR public._trip_source('DERIVED')     IS DISTINCT FROM 'DERIVED'
  OR public._trip_source('ESTIMATED')   IS DISTINCT FROM 'ESTIMATED'
  OR public._trip_source('UNAVAILABLE') IS DISTINCT FROM 'UNAVAILABLE'
  THEN
    RAISE EXCEPTION '047 HATA: _trip_source gecerli sinifi geri vermiyor';
  END IF;
  -- Tanınmayan/boş/NULL girdi UYDURULMAMALI → NULL.
  IF public._trip_source('MEASURED_ISH') IS NOT NULL
  OR public._trip_source('')             IS NOT NULL
  OR public._trip_source(NULL)           IS NOT NULL
  THEN
    RAISE EXCEPTION '047 HATA: _trip_source taninmayan degeri uyduruyor';
  END IF;

  RAISE NOTICE '047 OK: metrik provenance + yakit yuzde/birim + fiyat snapshot + unknown sure + kapsama + VERY_HIGH · dedupe ve RLS korundu.';
END $$;

COMMIT;
