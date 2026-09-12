-- ═══════════════════════════════════════════════════════════════════════════
-- 074 — TRIP JOURNAL SUMMARY P1 (SEYİR DEFTERİ BULUT ÖZETİ)
--
-- YALNIZ İLERİ MIGRATION. 046/047 geçmişi DEĞİŞTİRİLMEZ.
--
-- ── AMAÇ ─────────────────────────────────────────────────────────────────
-- Cihazdaki kanonik Seyir Defteri (`tripJournalStore`) yolculuğun TAM
-- kanıtını tutar. Buluta yalnız KÜÇÜK bir özet gider. 046/047 metrikleri
-- zaten taşıyor; eksik olan üç şey vardı ve üçü de "Arabam Cebimde"
-- ekranında kullanıcının GÖRDÜĞÜ şeylerdi:
--
--   1. NEREDEN → NEREYE. Liste satırı "Tarsus → Mersin" der; bugün sunucuda
--      bunu söyleyecek TEK bir alan yok.
--   2. YOLCULUK NEDEN BİTTİ. `end_reason` olmadan "veri kesildiği için
--      kapandı" ile "araç park etti" AYNI görünür — biri ölçüm, öteki kanıt
--      kaybıdır.
--   3. NE ZAMAN TAMAMLANDI + hangi şema. `completed_at` cihazın yolculuğu
--      kapattığı andır; `received_at` sunucunun onu GÖRDÜĞÜ andır. Çevrimdışı
--      bir yolculukta ikisi saatlerce ayrışır ve `received_at`i "yolculuk
--      bitişi" diye göstermek YALAN olur.
--
-- ── KOORDİNAT YASAĞI SÜRÜYOR (pazarlıksız) ───────────────────────────────
-- `start_area`/`end_area` **METİNDİR** — enlem/boylam DEĞİL. Kaba alan adı
-- ("Tarsus") bir noktayı tarif etmez; koordinat eder. 046'nın (b) kapısı
-- koordinat kolonunu yasaklar ve bu migration o kapıyı GENİŞLETMEZ, aynen
-- yeniden doğrular. Tam rota · saniyelik GPS · ham CAN · sensör izi buluta
-- ASLA gelmez ve şema bunu yapısal olarak imkânsız kılar.
--
-- ── DEDUPE/REVİZYON DAVRANIŞI AYNI ───────────────────────────────────────
-- `(vehicle_id, trip_key)` UNIQUE ve revizyon hükmü DEĞİŞMEDİ: aynı/daha
-- düşük revizyon `DUPLICATE`, daha yüksek revizyon `UPDATED`. Yeni alanlar
-- da `coalesce(EXCLUDED, kolon)` sözleşmesine uyar — bilinmeyen alan eski
-- güvenilir değeri EZMEZ.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. YENİ KOLONLAR (hepsi NULLABLE — bilinmeyen `0`/`''` DEĞİLDİR) ────
ALTER TABLE public.vehicle_trips
  /* Kaba alan adı. METİN — koordinat DEĞİL. Çözülemezse NULL. */
  ADD COLUMN IF NOT EXISTS start_area text,
  ADD COLUMN IF NOT EXISTS end_area   text,
  /* Yolculuk NEDEN kapandı — `cleanClose` iddiasının denetlenebilir kanıtı. */
  ADD COLUMN IF NOT EXISTS end_reason text,
  /* Cihazın yolculuğu KAPATTIĞI an. `received_at` ile AYNI ŞEY DEĞİLDİR. */
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  /* Seyir defteri şema sürümü — `metrics_version`den AYRI eksen. */
  ADD COLUMN IF NOT EXISTS journal_schema_version integer;

-- Alan adı uzunluk kapısı: sınırsız metin depoya ve UI'ya taşar.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='vehicle_trips_area_len') THEN
    ALTER TABLE public.vehicle_trips
      ADD CONSTRAINT vehicle_trips_area_len CHECK (
        (start_area IS NULL OR char_length(start_area) <= 80) AND
        (end_area   IS NULL OR char_length(end_area)   <= 80)
      );
  END IF;

  -- Bitiş gerekçesi UYDURULAMAZ: tanınmayan değer yazılamaz.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='vehicle_trips_end_reason_valid') THEN
    ALTER TABLE public.vehicle_trips
      ADD CONSTRAINT vehicle_trips_end_reason_valid CHECK (
        end_reason IS NULL OR end_reason IN
          ('IDLE_WINDOW','DATA_SILENCE','SERVICE_STOPPED','DISCARDED_TOO_SHORT','UNKNOWN')
      );
  END IF;

  -- Tamamlanma anı başlangıçtan önce olamaz.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='vehicle_trips_completed_order') THEN
    ALTER TABLE public.vehicle_trips
      ADD CONSTRAINT vehicle_trips_completed_order CHECK (
        completed_at IS NULL OR completed_at >= started_at
      );
  END IF;
END $$;

-- ── 2. GEREKÇE DARALTMA YARDIMCISI ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public._trip_end_reason(p_raw text)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $fn$
  SELECT CASE
           WHEN btrim(coalesce(p_raw, '')) IN
                ('IDLE_WINDOW','DATA_SILENCE','SERVICE_STOPPED',
                 'DISCARDED_TOO_SHORT','UNKNOWN')
           THEN btrim(p_raw)
           ELSE NULL
         END;
$fn$;

REVOKE ALL ON FUNCTION public._trip_end_reason(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._trip_end_reason(text)
  TO anon, authenticated, service_role;

-- Kaba alan adı temizleyici: boşluk kırpar, 80 karaktere keser, boşsa NULL.
CREATE OR REPLACE FUNCTION public._trip_area(p_raw text)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $fn$
  SELECT NULLIF(left(btrim(coalesce(p_raw, '')), 80), '');
$fn$;

REVOKE ALL ON FUNCTION public._trip_area(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._trip_area(text)
  TO anon, authenticated, service_role;

-- ── 3. YAZMA RPC — `p_journal` eklendi (dedupe DAVRANIŞI AYNI) ──────────
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
  p_metrics_version integer   DEFAULT NULL,
  /* SEYİR DEFTERİ: startArea · endArea · endReason · completedAtMs ·
     schemaVersion. KOORDİNAT ALANI YOKTUR ve eklenemez. */
  p_journal       jsonb       DEFAULT '{}'::jsonb
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
  v_start_area text;
  v_end_area   text;
  v_end_reason text;
  v_completed  timestamptz;
  v_jschema    integer;
  v_eff_start  timestamptz;
BEGIN
  SELECT id INTO v_vehicle_id FROM public.vehicles
   WHERE coalesce(api_key_hash, api_key) = p_api_key;
  IF v_vehicle_id IS NULL THEN
    RAISE EXCEPTION 'invalid_api_key' USING ERRCODE='P0001';
  END IF;

  IF v_key IS NULL THEN
    RETURN jsonb_build_object('state','REJECTED','reason','MISSING_TRIP_KEY','serverRevision',NULL);
  END IF;

  /* İstemci saati OTORİTE DEĞİL: gelecekten gelen damga şimdiye kırpılır.
   *
   * ── DÜZELTİLEN KUSUR (046/047) ────────────────────────────────────────
   * Eskiden `v_started := LEAST(now(), coalesce(to_timestamp(...), now()))`
   * idi: istemci başlangıç damgası GÖNDERMEZSE `now()` yazılıyordu. Bir
   * REVİZYON düzeltmesi (yalnız skor/metrik gönderen ikinci çağrı)
   * yolculuğun BAŞLANGIÇ SAATİNİ sessizce "şimdi"ye taşıyordu — kullanıcı
   * Seyir Defteri'nde dün akşamki yolculuğu bugün öğlen başlamış görürdü.
   * Bu, tablodaki HER DİĞER alanın uyduğu `coalesce(yeni, eski)` sözleşmesine
   * de aykırıydı: bilinmeyen değer var olanı EZEMEZ.
   *
   * Artık damga yoksa `NULL` kalır; UPDATE'te eski değer korunur, INSERT'te
   * `now()` tabanına düşülür (ilk yazımda korunacak bir geçmiş yoktur).
   */
  v_started := CASE WHEN p_started_at_ms IS NULL THEN NULL
                    ELSE LEAST(now(), to_timestamp(p_started_at_ms / 1000.0)) END;
  v_ended   := CASE WHEN p_ended_at_ms IS NULL THEN NULL
                    ELSE LEAST(now(), to_timestamp(p_ended_at_ms / 1000.0)) END;

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

  -- ── SEYİR DEFTERİ ALANLARI ──────────────────────────────────────────
  v_start_area := public._trip_area(p_journal->>'startArea');
  v_end_area   := public._trip_area(p_journal->>'endArea');
  v_end_reason := public._trip_end_reason(p_journal->>'endReason');
  v_jschema    := NULLIF(p_journal->>'schemaVersion','')::integer;

  /* `completed_at` cihazın kapanış anıdır; gelecekten gelen damga şimdiye
     kırpılır. Başlangıçla tutarlılık (CHECK kısıtı) aşağıda, ETKİN başlangıç
     bilindikten sonra kurulur — çünkü bu çağrı başlangıç damgası taşımıyor
     olabilir ve o zaman ölçüt SATIRDAKİ mevcut değerdir. */
  v_completed := CASE WHEN p_journal->>'completedAtMs' IS NULL THEN NULL
                      ELSE LEAST(now(),
                             to_timestamp((p_journal->>'completedAtMs')::bigint / 1000.0))
                 END;

  v_dist := NULLIF(p_metrics->>'distanceKm','')::numeric;
  IF v_dist IS NULL OR v_dist <= 0 THEN
    RETURN jsonb_build_object('state','REJECTED','reason','NO_DISTANCE','serverRevision',NULL);
  END IF;

  SELECT * INTO v_existing FROM public.vehicle_trips
   WHERE vehicle_id = v_vehicle_id AND trip_key = v_key FOR UPDATE;

  -- ── DEDUPE (046/047 davranışı AYNEN) ────────────────────────────────
  IF FOUND THEN
    IF v_rev <= v_existing.revision THEN
      RETURN jsonb_build_object('state','DUPLICATE','reason','SAME_OR_LOWER_REVISION',
                                'serverRevision', v_existing.revision);
    END IF;

    /* ETKİN başlangıç: bu çağrı damga taşımıyorsa satırdaki değer geçerlidir.
       Bitiş ve tamamlanma anı ondan ÖNCEYE düşemez (zaman sırası kısıtları). */
    v_eff_start := coalesce(v_started, v_existing.started_at);
    IF v_ended     IS NOT NULL AND v_ended     < v_eff_start THEN v_ended     := v_eff_start; END IF;
    IF v_completed IS NOT NULL AND v_completed < v_eff_start THEN v_completed := v_eff_start; END IF;

    UPDATE public.vehicle_trips SET
      trip_id           = coalesce(NULLIF(btrim(coalesce(p_trip_id,'')),''), trip_id),
      revision          = v_rev,
      /* Bilinmeyen başlangıç damgası var olanı EZMEZ (bkz. yukarıdaki kusur). */
      started_at        = v_eff_start,
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
      /* Seyir defteri alanları — bilinmeyen eskiyi EZMEZ. */
      start_area        = coalesce(v_start_area, start_area),
      end_area          = coalesce(v_end_area,   end_area),
      end_reason        = coalesce(v_end_reason, end_reason),
      completed_at      = coalesce(v_completed,  completed_at),
      journal_schema_version = coalesce(v_jschema, journal_schema_version),
      events            = CASE WHEN jsonb_typeof(p_events)='array' AND p_events <> '[]'::jsonb
                               THEN p_events ELSE events END,
      updated_at        = now()
     WHERE vehicle_id = v_vehicle_id AND trip_key = v_key;

    RETURN jsonb_build_object('state','UPDATED','reason',NULL,'serverRevision', v_rev);
  END IF;

  -- ── İLK YAZIM ───────────────────────────────────────────────────────
  /* İlk yazımda korunacak bir geçmiş YOKTUR → damga yoksa `now()` tabanı. */
  v_eff_start := coalesce(v_started, now());
  IF v_ended     IS NOT NULL AND v_ended     < v_eff_start THEN v_ended     := v_eff_start; END IF;
  IF v_completed IS NOT NULL AND v_completed < v_eff_start THEN v_completed := v_eff_start; END IF;

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
    data_gap_count, source_switch_count, metrics_version,
    start_area, end_area, end_reason, completed_at, journal_schema_version,
    events
  ) VALUES (
    v_vehicle_id, v_key, NULLIF(btrim(coalesce(p_trip_id,'')),''), v_rev, v_eff_start, v_ended,
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
    v_start_area, v_end_area, v_end_reason, v_completed, v_jschema,
    CASE WHEN jsonb_typeof(p_events)='array' THEN p_events ELSE '[]'::jsonb END
  );

  RETURN jsonb_build_object('state','CREATED','reason',NULL,'serverRevision', v_rev);
END;
$fn$;

-- ── 3b. ESKİ (P2) YAZMA İMZASINI DÜŞÜR ──────────────────────────────────
--
-- 047'nin gerekçesiyle AYNI: iki imza bırakmak, eski imzayı çağıran bir
-- yolun seyir defteri alanlarını SESSİZCE düşürmesine yol açar (trip
-- yüklenir ama "nereden nereye" ve bitiş gerekçesi kaybolur). Ayrıca
-- PostgREST aday fonksiyon seçiminde belirsizliğe düşebilir.
DROP FUNCTION IF EXISTS public.upload_vehicle_trip(
  text,text,text,integer,bigint,bigint,jsonb,integer,text,jsonb,jsonb,jsonb,jsonb,jsonb,integer);

-- ── 4. OKUMA RPC — seyir defteri alanları eklendi (KAPSAM/RLS AYNI) ─────
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
  metrics_version integer,
  start_area text, end_area text, end_reason text,
  completed_at timestamptz, journal_schema_version integer,
  received_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
#variable_conflict use_column
DECLARE
  v_uid uuid := auth.uid();
  v_co  uuid;
BEGIN
  -- FAIL-CLOSED: oturum yoksa SATIR YOK. `anon` bu fonksiyonu zaten
  -- çalıştıramaz (aşağıdaki REVOKE), bu ikinci kapıdır.
  IF v_uid IS NULL THEN RETURN; END IF;
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
         t.data_gap_count, t.source_switch_count, t.metrics_version,
         t.start_area, t.end_area, t.end_reason,
         t.completed_at, t.journal_schema_version,
         t.received_at
    FROM public.vehicle_trips t
    JOIN public.vehicles v ON v.id = t.vehicle_id
   /* KAPSAM: istemci `p_vehicle_id`yi DEĞİŞTİRSE BİLE sahip/şirket kapısını
      aşamaz — araç kimliği yetkiyi ÜRETMEZ, yalnız daraltır. */
   WHERE t.vehicle_id = p_vehicle_id
     AND (v.owner_id = v_uid OR (v_co IS NOT NULL AND v.company_id = v_co))
   ORDER BY t.started_at DESC
   LIMIT LEAST(GREATEST(coalesce(p_limit, 50), 1), 200);
END;
$fn$;

-- ── 5. İZİNLER (046/047 politikası AYNEN) ───────────────────────────────
REVOKE ALL ON FUNCTION public.upload_vehicle_trip(
  text,text,text,integer,bigint,bigint,jsonb,integer,text,jsonb,jsonb,jsonb,jsonb,jsonb,integer,jsonb)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upload_vehicle_trip(
  text,text,text,integer,bigint,bigint,jsonb,integer,text,jsonb,jsonb,jsonb,jsonb,jsonb,integer,jsonb)
  TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.list_vehicle_trips(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_vehicle_trips(uuid, integer)
  TO authenticated, service_role;

-- ── 6. DOĞRULAMA (fail-closed) ──────────────────────────────────────────
DO $$
DECLARE v_def text; v_missing text;
BEGIN
  -- (a) Yeni kolonlar var ve NULLABLE (bilinmeyen `0`/`''` YAZILMAZ)
  SELECT string_agg(c, ', ') INTO v_missing FROM unnest(ARRAY[
    'start_area','end_area','end_reason','completed_at','journal_schema_version'
  ]) AS c
   WHERE NOT EXISTS (
     SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='vehicle_trips' AND column_name=c);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '074 HATA: seyir defteri kolonlari eksik: %', v_missing;
  END IF;

  SELECT string_agg(column_name, ', ') INTO v_missing
    FROM information_schema.columns
   WHERE table_schema='public' AND table_name='vehicle_trips'
     AND column_name IN ('start_area','end_area','end_reason','completed_at',
                         'journal_schema_version')
     AND is_nullable = 'NO';
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '074 HATA: seyir defteri kolonlari NOT NULL: %', v_missing;
  END IF;

  -- (b) KOORDİNAT YASAĞI SÜRÜYOR — 046(b) kapısı AYNEN yeniden doğrulanır.
  --     Tam rota buluta GELMEZ; alan adı METİNDİR, nokta DEĞİL.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='vehicle_trips'
       AND (column_name IN ('lat','lng','latitude','longitude',
                            'start_lat','start_lng','end_lat','end_lng',
                            'route','polyline','route_trace','gps_trace')
            OR column_name ILIKE '%coord%'
            OR column_name ILIKE '%polyline%')
  ) THEN
    RAISE EXCEPTION '074 HATA: vehicle_trips koordinat/rota kolonu tasiyor (kapsam disi)';
  END IF;

  -- (c) Alan adı METİN olmalı (sayısal olsaydı koordinat taşıyabilirdi)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='vehicle_trips'
       AND column_name IN ('start_area','end_area')
       AND data_type NOT IN ('text','character varying')
  ) THEN
    RAISE EXCEPTION '074 HATA: start_area/end_area metin DEGIL';
  END IF;

  -- (d) Bitiş gerekçesi uydurulamaz
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='vehicle_trips_end_reason_valid') THEN
    RAISE EXCEPTION '074 HATA: end_reason CHECK kisiti yok (gerekce uydurulabilir)';
  END IF;

  -- (e) Dedupe kısıtı DOKUNULMADI
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='vehicle_trips_key_unique') THEN
    RAISE EXCEPTION '074 HATA: (vehicle_id, trip_key) UNIQUE kisiti kayboldu (dedupe acik)';
  END IF;

  -- (f) RLS açık ve anon kapalı
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='vehicle_trips' AND rowsecurity
  ) THEN
    RAISE EXCEPTION '074 HATA: vehicle_trips RLS kapali';
  END IF;
  IF has_table_privilege('anon','public.vehicle_trips','SELECT') THEN
    RAISE EXCEPTION '074 HATA: anon vehicle_trips SELECT yetkisi acik';
  END IF;
  IF has_function_privilege('anon','public.list_vehicle_trips(uuid,integer)','EXECUTE') THEN
    RAISE EXCEPTION '074 HATA: anon trip okuma RPC yetkisi acik';
  END IF;

  -- (g) Yazma RPC DEFINER + sabit search_path + dedupe hükmü + tek imza
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='upload_vehicle_trip' LIMIT 1;
  IF v_def IS NULL OR v_def NOT LIKE '%SECURITY DEFINER%' OR v_def NOT LIKE '%search_path%' THEN
    RAISE EXCEPTION '074 HATA: upload_vehicle_trip DEFINER/search_path eksik';
  END IF;
  IF v_def NOT LIKE '%DUPLICATE%' THEN
    RAISE EXCEPTION '074 HATA: dedupe hukmu yok (ayni trip iki kez sayilabilir)';
  END IF;

  SELECT count(*)::text INTO v_missing
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='upload_vehicle_trip';
  IF v_missing <> '1' THEN
    RAISE EXCEPTION '074 HATA: upload_vehicle_trip % imza (eski imza seyir alanlarini sessizce duser)', v_missing;
  END IF;

  -- (h) Okuma RPC oturumsuz satır DÖNDÜRMEMELİ (fail-closed kanıtı)
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='list_vehicle_trips' LIMIT 1;
  IF v_def IS NULL OR v_def NOT LIKE '%auth.uid()%' OR v_def NOT LIKE '%owner_id%' THEN
    RAISE EXCEPTION '074 HATA: list_vehicle_trips sahiplik kapisi eksik';
  END IF;

  RAISE NOTICE '074 OK: seyir defteri ozeti (alan/gerekce/tamamlanma/sema) + dedupe KORUNDU · koordinat YOK · anon kapali.';
END $$;

COMMIT;
