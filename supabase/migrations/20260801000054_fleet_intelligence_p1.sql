-- ═══════════════════════════════════════════════════════════════════════════
-- 054 — FLEET INTELLIGENCE ENGINE (P1)
--
-- YALNIZ İLERİ MIGRATION. 033–053 geçmişi DEĞİŞTİRİLMEZ.
--
-- ── BU MIGRATION AI ÜRETMEZ ──────────────────────────────────────────────
-- LLM YOK · model YOK · tahmin YOK · öneri YOK · doğal dil YOK.
-- Bir insight burada bir CÜMLE değil, bir **KANIT KÜMESİDİR**: hangi
-- araçlardan, hangi sürücülerden, hangi yolculuklardan ve hangi metriklerden
-- oluştuğu satır satır izlenebilir. `title`/`message`/`recommendation` gibi
-- bir kolon BİLİNÇLİ OLARAK YOKTUR.
--
-- ── ÜÇ FAIL-CLOSED KURALI ────────────────────────────────────────────────
--   1. **KANITSIZ INSIGHT YAYIMLANAMAZ:** `state='ACTIVE'` olabilmesi için
--      kanıt defterinde en az `INSIGHT_MIN_EVIDENCE` satır olmalı — trigger
--      bunu zorlar (uygulama hatası kanıtsız içgörü üretemez).
--   2. **TEK ARAÇTAN `HIGH` ÇIKMAZ:** güven kapısı araç sayısına bakar.
--      Bir aracın davranışı filo hakkında bir iddia değildir.
--   3. **UNKNOWN korunur:** ölçülmemiş kanıt (`value IS NULL` +
--      `provenance='UNKNOWN'`) kabul EDİLMEZ; `0` gibi davranmaz.
--
-- ── MEVCUT KATMANLARA DOKUNULMADI ────────────────────────────────────────
-- `driver_dna*`, `_dna_*`, `_trip_attribution_trigger`, `_resolve_*`,
-- `vehicle_trips` ve araç kimliği YENİDEN TANIMLANMAZ. Fleet Intelligence
-- onların ÇIKTISINI kanıt olarak okur; kararlarına KARIŞMAZ.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. İÇGÖRÜ DEFTERİ ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fleet_insight (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,

  type        text NOT NULL,
  source      text NOT NULL,
  state       text NOT NULL DEFAULT 'DRAFT',
  confidence  text NOT NULL DEFAULT 'UNKNOWN',

  /* Konu: içgörünün NEYE dair olduğu (araç/sürücü/filo). Dedupe kimliğinin
     parçasıdır — aynı konu için ikinci bir içgörü açılmaz, mevcut olan
     güncellenir. */
  subject_kind text NOT NULL DEFAULT 'FLEET',
  subject_id   uuid,

  /* Kanıt penceresi — süresiz içgörü YOKTUR. */
  window_start timestamptz NOT NULL,
  window_end   timestamptz NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,

  /* Sayaçlar KANIT DEFTERİNDEN türetilir (trigger yazar) — elle set edilemez. */
  evidence_count integer NOT NULL DEFAULT 0,
  vehicle_count  integer NOT NULL DEFAULT 0,
  driver_count   integer NOT NULL DEFAULT 0,
  trip_count     integer NOT NULL DEFAULT 0,
  measured_count integer NOT NULL DEFAULT 0,

  unknown_reason text,
  revision   integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fi_type_valid CHECK (type IN (
    'FUEL_OUTLIER','DRIVER_OUTLIER','VEHICLE_OUTLIER','MAINTENANCE_TREND',
    'TEMPERATURE_TREND','BATTERY_TREND','BRAKE_PATTERN','IDLE_PATTERN',
    'HIGH_UTILIZATION','LOW_UTILIZATION','DRIVER_CHANGE_PATTERN',
    'VEHICLE_CHANGE_PATTERN','UNKNOWN')),
  CONSTRAINT fi_source_valid CHECK (source IN (
    'TRIP_METRICS','DRIVER_DNA','FLEET_AGGREGATE','ATTRIBUTION','UNKNOWN')),
  CONSTRAINT fi_state_valid CHECK (state IN (
    'DRAFT','ACTIVE','EXPIRED','SUPERSEDED','RETRACTED')),
  CONSTRAINT fi_conf_valid CHECK (confidence IN (
    'VERY_HIGH','HIGH','MEDIUM','LOW','UNKNOWN')),
  CONSTRAINT fi_subject_valid CHECK (subject_kind IN ('FLEET','VEHICLE','DRIVER')),
  CONSTRAINT fi_window_valid CHECK (window_end > window_start),
  CONSTRAINT fi_expiry_valid CHECK (expires_at > created_at),
  CONSTRAINT fi_unknown_reason_valid CHECK (unknown_reason IS NULL OR unknown_reason IN (
    'NO_EVIDENCE','INSUFFICIENT_EVIDENCE','NO_EVIDENCE_SOURCE',
    'SINGLE_VEHICLE_ONLY','CONTRADICTORY_EVIDENCE')),
  CONSTRAINT fi_counts_nonneg CHECK (
    evidence_count >= 0 AND vehicle_count >= 0 AND driver_count >= 0
    AND trip_count >= 0 AND measured_count >= 0)
);

/* DEDUPE: aynı şirket + tip + konu + pencere için TEK içgörü. Aynı kanıt
   yeniden işlendiğinde yeni satır AÇILMAZ, mevcut olan güncellenir. */
CREATE UNIQUE INDEX IF NOT EXISTS fi_dedupe_unique
  ON public.fleet_insight (company_id, type, subject_kind,
                           coalesce(subject_id, '00000000-0000-0000-0000-000000000000'::uuid),
                           window_start, window_end);
CREATE INDEX IF NOT EXISTS fi_company_idx
  ON public.fleet_insight (company_id, created_at DESC);

-- ── 2. KANIT DEFTERİ ────────────────────────────────────────────────────
--
-- İzlenebilirliğin kalbi: bir içgörünün HANGİ kanıtlardan oluştuğu tek tek
-- burada durur. Birincil anahtar aynı zamanda REPLAY kilididir.
CREATE TABLE IF NOT EXISTS public.fleet_insight_evidence (
  insight_id uuid NOT NULL REFERENCES public.fleet_insight(id) ON DELETE CASCADE,
  kind       text NOT NULL,
  /* Araç/sürücü/yolculuk kimliği ya da metrik adı — serbest metin DEĞİL. */
  ref_id     text NOT NULL,
  metric     text NOT NULL,
  value      numeric,
  provenance text NOT NULL,
  added_at   timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (insight_id, kind, ref_id, metric),
  CONSTRAINT fie_kind_valid CHECK (kind IN ('VEHICLE','DRIVER','TRIP','METRIC')),
  CONSTRAINT fie_prov_valid CHECK (provenance IN
    ('MEASURED','DERIVED','ESTIMATED','UNKNOWN')),
  /* UNKNOWN KORUNUR: ölçülmemiş değer kanıt SAYILMAZ (0 gibi davranmaz). */
  CONSTRAINT fie_no_empty_evidence CHECK (
    NOT (value IS NULL AND provenance = 'UNKNOWN')),
  CONSTRAINT fie_ref_nonempty CHECK (length(btrim(ref_id)) > 0
                                     AND length(btrim(metric)) > 0)
);

CREATE INDEX IF NOT EXISTS fie_insight_idx
  ON public.fleet_insight_evidence (insight_id);

-- ── 3. GÜVEN KAPISI (tek araçtan HIGH çıkmaz) ───────────────────────────
--
-- ⚠️ Bu fonksiyon TS motoruyla AYNI eşikleri kullanır ve **formül
-- kopyalamaz**: yalnız kapıdır. Karakter/metrik türetme TS'te kalır.
CREATE OR REPLACE FUNCTION public._fleet_insight_confidence(
  p_evidence integer, p_vehicles integer, p_trips integer, p_measured integer)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $fn$
  SELECT CASE
    WHEN coalesce(p_evidence,0) < 3 OR coalesce(p_vehicles,0) < 1 THEN 'UNKNOWN'
    /* TEK ARAÇ TAVANI — filo iddiası olamaz. */
    WHEN p_vehicles < 2 THEN
      CASE WHEN coalesce(p_measured,0)::numeric / greatest(p_evidence,1) >= 0.5
           THEN 'MEDIUM' ELSE 'LOW' END
    WHEN p_vehicles >= 5 AND coalesce(p_trips,0) >= 20
         AND coalesce(p_measured,0)::numeric / greatest(p_evidence,1) >= 0.8 THEN 'VERY_HIGH'
    WHEN coalesce(p_trips,0) >= 20
         AND coalesce(p_measured,0)::numeric / greatest(p_evidence,1) >= 0.6 THEN 'HIGH'
    WHEN coalesce(p_measured,0)::numeric / greatest(p_evidence,1) >= 0.4 THEN 'MEDIUM'
    ELSE 'LOW' END;
$fn$;

-- ── 4. SAYAÇLARI KANITTAN TÜRET (elle yazılamaz) ────────────────────────
CREATE OR REPLACE FUNCTION public._fleet_insight_recount(p_insight_id uuid)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_ev int; v_veh int; v_drv int; v_trip int; v_meas int;
  v_type text; v_conf text; v_state text; v_reason text;
BEGIN
  SELECT count(*),
         count(DISTINCT ref_id) FILTER (WHERE kind='VEHICLE'),
         count(DISTINCT ref_id) FILTER (WHERE kind='DRIVER'),
         count(DISTINCT ref_id) FILTER (WHERE kind='TRIP'),
         count(*) FILTER (WHERE provenance='MEASURED')
    INTO v_ev, v_veh, v_drv, v_trip, v_meas
    FROM public.fleet_insight_evidence WHERE insight_id = p_insight_id;

  SELECT type INTO v_type FROM public.fleet_insight WHERE id = p_insight_id;

  /* KANIT KAYNAĞI OLMAYAN TİPLER: akü ve bakım için sinyal YOK — bu tipler
     kanıt biriktirse bile YAYIMLANMAZ (sıcaklıktan "bakım gerekiyor"
     çıkarmak bir tahmindir; bu paket tahmin üretmez). */
  IF v_type IN ('BATTERY_TREND','MAINTENANCE_TREND') THEN
    v_conf := 'UNKNOWN'; v_state := 'DRAFT'; v_reason := 'NO_EVIDENCE_SOURCE';
  ELSIF v_ev = 0 THEN
    v_conf := 'UNKNOWN'; v_state := 'DRAFT'; v_reason := 'NO_EVIDENCE';
  ELSIF v_ev < 3 THEN
    v_conf := 'UNKNOWN'; v_state := 'DRAFT'; v_reason := 'INSUFFICIENT_EVIDENCE';
  ELSE
    v_conf := public._fleet_insight_confidence(v_ev, v_veh, v_trip, v_meas);
    v_state := CASE WHEN v_conf = 'UNKNOWN' THEN 'DRAFT' ELSE 'ACTIVE' END;
    v_reason := CASE
                  WHEN v_conf = 'UNKNOWN' THEN 'INSUFFICIENT_EVIDENCE'
                  WHEN v_veh < 2 THEN 'SINGLE_VEHICLE_ONLY'
                  ELSE NULL END;
  END IF;

  UPDATE public.fleet_insight
     SET evidence_count = v_ev, vehicle_count = v_veh, driver_count = v_drv,
         trip_count = v_trip, measured_count = v_meas,
         confidence = v_conf,
         /* Kapanmış içgörü YENİDEN AÇILMAZ (idempotens). */
         state = CASE WHEN state IN ('EXPIRED','SUPERSEDED','RETRACTED')
                      THEN state ELSE v_state END,
         unknown_reason = v_reason,
         revision = revision + 1,
         updated_at = now()
   WHERE id = p_insight_id;
END;
$fn$;

/* KANITSIZ İÇGÖRÜ YAYIMLANAMAZ — son savunma. */
CREATE OR REPLACE FUNCTION public._fleet_insight_evidence_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE v_n int;
BEGIN
  IF NEW.state <> 'ACTIVE' THEN RETURN NEW; END IF;
  SELECT count(*) INTO v_n FROM public.fleet_insight_evidence WHERE insight_id = NEW.id;
  IF v_n < 3 THEN
    RAISE EXCEPTION 'FLEET_INSIGHT_WITHOUT_EVIDENCE: kanitsiz icgoru yayimlanamaz (kanit=%)', v_n
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_fleet_insight_evidence_guard ON public.fleet_insight;
CREATE TRIGGER trg_fleet_insight_evidence_guard
  BEFORE INSERT OR UPDATE OF state ON public.fleet_insight
  FOR EACH ROW EXECUTE FUNCTION public._fleet_insight_evidence_guard();

-- ── 5. KANIT EKLEME (merge · replay-safe · cross-tenant kapalı) ──────────
CREATE OR REPLACE FUNCTION public._fleet_add_evidence(
  p_insight_id uuid, p_kind text, p_ref_id text, p_metric text,
  p_value numeric, p_provenance text)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_co  uuid;
  v_ref uuid;
  v_ok  boolean;
BEGIN
  SELECT company_id INTO v_co FROM public.fleet_insight WHERE id = p_insight_id;
  IF v_co IS NULL THEN RETURN 'INSIGHT_NOT_FOUND'; END IF;

  /* UNKNOWN KORUNUR: ölçülmemiş kanıt kabul edilmez. */
  IF p_value IS NULL AND p_provenance = 'UNKNOWN' THEN RETURN 'EMPTY_EVIDENCE'; END IF;

  /* CROSS-TENANT: kanıt BAŞKA şirketin aracına/sürücüsüne/yolculuğuna
     işaret edemez. Referans UUID ise sahibi doğrulanır. */
  BEGIN
    v_ref := p_ref_id::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_ref := NULL;   -- METRIC kanıtı: serbest ad, sahiplik kontrolü yok
  END;

  IF v_ref IS NOT NULL THEN
    IF p_kind = 'VEHICLE' THEN
      SELECT (company_id = v_co) INTO v_ok FROM public.vehicles WHERE id = v_ref;
    ELSIF p_kind = 'DRIVER' THEN
      SELECT (company_id = v_co) INTO v_ok FROM public.fleet_drivers WHERE id = v_ref;
    ELSIF p_kind = 'TRIP' THEN
      SELECT (v.company_id = v_co) INTO v_ok
        FROM public.vehicle_trips t JOIN public.vehicles v ON v.id = t.vehicle_id
       WHERE t.id = v_ref;
    ELSE
      v_ok := true;
    END IF;
    IF v_ok IS NULL OR v_ok = false THEN RETURN 'TENANT_MISMATCH'; END IF;
  END IF;

  INSERT INTO public.fleet_insight_evidence
    (insight_id, kind, ref_id, metric, value, provenance)
  VALUES (p_insight_id, p_kind, p_ref_id, p_metric, p_value, p_provenance)
  ON CONFLICT (insight_id, kind, ref_id, metric) DO NOTHING;   -- ← REPLAY KİLİDİ

  IF NOT FOUND THEN
    PERFORM public._fleet_insight_recount(p_insight_id);
    RETURN 'DUPLICATE';
  END IF;

  PERFORM public._fleet_insight_recount(p_insight_id);
  RETURN 'ADDED';
END;
$fn$;

-- ── 6. İÇGÖRÜ AÇ / GÜNCELLE (dedupe) ────────────────────────────────────
CREATE OR REPLACE FUNCTION public._fleet_upsert_insight(
  p_company_id uuid, p_type text, p_source text,
  p_subject_kind text, p_subject_id uuid,
  p_window_start timestamptz, p_window_end timestamptz,
  p_ttl interval DEFAULT interval '7 days')
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE v_id uuid;
BEGIN
  IF p_company_id IS NULL THEN RETURN NULL; END IF;

  SELECT id INTO v_id FROM public.fleet_insight
   WHERE company_id = p_company_id AND type = p_type
     AND subject_kind = p_subject_kind
     AND coalesce(subject_id,'00000000-0000-0000-0000-000000000000'::uuid)
         = coalesce(p_subject_id,'00000000-0000-0000-0000-000000000000'::uuid)
     AND window_start = p_window_start AND window_end = p_window_end;

  IF v_id IS NOT NULL THEN RETURN v_id; END IF;   -- ← DEDUPE (yeni satır YOK)

  INSERT INTO public.fleet_insight
    (company_id, type, source, subject_kind, subject_id,
     window_start, window_end, expires_at, state, confidence, unknown_reason)
  VALUES (p_company_id, p_type, p_source, p_subject_kind, p_subject_id,
          p_window_start, p_window_end, now() + p_ttl,
          'DRAFT', 'UNKNOWN', 'NO_EVIDENCE')
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$fn$;

-- ── 7. TREND DEFTERİ ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fleet_trend (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  metric     text NOT NULL,
  direction  text NOT NULL DEFAULT 'UNKNOWN',

  baseline_sum numeric(18,6) NOT NULL DEFAULT 0,
  baseline_count integer NOT NULL DEFAULT 0,
  baseline_vehicles integer NOT NULL DEFAULT 0,
  recent_sum numeric(18,6) NOT NULL DEFAULT 0,
  recent_count integer NOT NULL DEFAULT 0,
  recent_vehicles integer NOT NULL DEFAULT 0,

  confidence text NOT NULL DEFAULT 'UNKNOWN',
  unknown_reason text,
  revision   integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ft_metric_valid CHECK (metric IN (
    'FUEL_PER_100KM','IDLE_RATIO','HARSH_EVENTS_PER_100KM',
    'ENGINE_TEMP_PEAK','UTILIZATION_KM_PER_VEHICLE','DRIVER_CHANGE_RATE')),
  CONSTRAINT ft_dir_valid CHECK (direction IN ('RISING','FALLING','FLAT','UNKNOWN')),
  CONSTRAINT ft_conf_valid CHECK (confidence IN
    ('VERY_HIGH','HIGH','MEDIUM','LOW','UNKNOWN'))
);

/* Şirket × metrik başına TEK trend — tekrar işleme yeni satır açmaz. */
CREATE UNIQUE INDEX IF NOT EXISTS ft_company_metric_unique
  ON public.fleet_trend (company_id, metric);

/**
 * Trend penceresine örnek ekler ve yönü YENİDEN hesaplar.
 *
 * MİNİMUM VERİ ŞARTI: iki pencerede de ≥5 örnek ve ≥2 araç yoksa yön
 * `UNKNOWN` kalır — iki noktadan trend çıkarmak gürültüyü bilgi sanmaktır.
 */
CREATE OR REPLACE FUNCTION public._fleet_trend_merge(
  p_company_id uuid, p_metric text, p_window text,
  p_value numeric, p_vehicles integer)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_id uuid; t public.fleet_trend%ROWTYPE;
  v_b numeric; v_r numeric; v_rel numeric; v_dir text; v_veh int; v_conf text;
BEGIN
  IF p_value IS NULL THEN RETURN 'EMPTY_SAMPLE'; END IF;   -- UNKNOWN korunur

  INSERT INTO public.fleet_trend (company_id, metric)
  VALUES (p_company_id, p_metric)
  ON CONFLICT (company_id, metric) DO NOTHING;

  SELECT id INTO v_id FROM public.fleet_trend
   WHERE company_id = p_company_id AND metric = p_metric;

  IF p_window = 'BASELINE' THEN
    UPDATE public.fleet_trend
       SET baseline_sum = baseline_sum + p_value,
           baseline_count = baseline_count + 1,
           baseline_vehicles = greatest(baseline_vehicles, coalesce(p_vehicles,0)),
           revision = revision + 1, updated_at = now()
     WHERE id = v_id;
  ELSIF p_window = 'RECENT' THEN
    UPDATE public.fleet_trend
       SET recent_sum = recent_sum + p_value,
           recent_count = recent_count + 1,
           recent_vehicles = greatest(recent_vehicles, coalesce(p_vehicles,0)),
           revision = revision + 1, updated_at = now()
     WHERE id = v_id;
  ELSE
    RETURN 'UNKNOWN_WINDOW';
  END IF;

  SELECT * INTO t FROM public.fleet_trend WHERE id = v_id;
  v_veh := least(t.baseline_vehicles, t.recent_vehicles);

  IF t.baseline_count < 5 OR t.recent_count < 5 THEN
    v_dir := 'UNKNOWN'; v_conf := 'UNKNOWN';
    UPDATE public.fleet_trend SET direction=v_dir, confidence=v_conf,
           unknown_reason='INSUFFICIENT_EVIDENCE' WHERE id=v_id;
    RETURN 'INSUFFICIENT';
  END IF;
  IF v_veh < 2 THEN
    UPDATE public.fleet_trend SET direction='UNKNOWN', confidence='UNKNOWN',
           unknown_reason='SINGLE_VEHICLE_ONLY' WHERE id=v_id;
    RETURN 'SINGLE_VEHICLE';
  END IF;

  v_b := t.baseline_sum / t.baseline_count;
  v_r := t.recent_sum / t.recent_count;
  v_rel := (v_r - v_b) / greatest(abs(v_b), 0.000000001);
  v_dir := CASE WHEN abs(v_rel) < 0.10 THEN 'FLAT'
                WHEN v_rel > 0 THEN 'RISING' ELSE 'FALLING' END;
  v_conf := public._fleet_insight_confidence(
              t.baseline_count + t.recent_count, v_veh,
              t.baseline_count + t.recent_count, t.baseline_count + t.recent_count);

  UPDATE public.fleet_trend
     SET direction = v_dir, confidence = v_conf, unknown_reason = NULL
   WHERE id = v_id;
  RETURN v_dir;
END;
$fn$;

-- ── 8. FİLO SAĞLIĞI (TEK PUAN YOK) ──────────────────────────────────────
--
-- ⚠️ `overall_score` gibi bir kolon BİLİNÇLİ OLARAK YOKTUR. "Filo sağlığı:
-- 72" birbiriyle ilgisiz altı gerçeği tek bir yalana indirger.
CREATE TABLE IF NOT EXISTS public.fleet_health (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  dimension  text NOT NULL,
  state      text NOT NULL DEFAULT 'UNKNOWN',
  /* `UNKNOWN` ise DAİMA NULL — sahte 0 YASAK. */
  index_value numeric(5,4),
  confidence text NOT NULL DEFAULT 'UNKNOWN',
  vehicle_count integer NOT NULL DEFAULT 0,
  trip_count integer NOT NULL DEFAULT 0,
  unknown_reason text,
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fh_dim_valid CHECK (dimension IN (
    'VEHICLE_HEALTH','DRIVER_HEALTH','DATA_HEALTH','TRIP_HEALTH',
    'CONNECTIVITY_HEALTH','TELEMETRY_HEALTH')),
  CONSTRAINT fh_state_valid CHECK (state IN ('GOOD','WATCH','POOR','UNKNOWN')),
  CONSTRAINT fh_conf_valid CHECK (confidence IN
    ('VERY_HIGH','HIGH','MEDIUM','LOW','UNKNOWN')),
  /* UNKNOWN ile endeks BİRLİKTE olamaz: "bilinmiyor ama 0.4" bir çelişkidir. */
  CONSTRAINT fh_unknown_consistent CHECK (
    (state = 'UNKNOWN' AND index_value IS NULL)
    OR (state <> 'UNKNOWN' AND index_value IS NOT NULL)),
  CONSTRAINT fh_index_range CHECK (index_value IS NULL
    OR (index_value >= 0 AND index_value <= 1))
);

CREATE UNIQUE INDEX IF NOT EXISTS fh_company_dim_unique
  ON public.fleet_health (company_id, dimension);

CREATE OR REPLACE FUNCTION public._fleet_health_merge(
  p_company_id uuid, p_dimension text, p_index numeric,
  p_vehicles integer, p_trips integer)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE v_state text; v_conf text; v_reason text; v_idx numeric;
BEGIN
  IF p_index IS NULL OR coalesce(p_vehicles,0) < 1 THEN
    v_state := 'UNKNOWN'; v_idx := NULL; v_conf := 'UNKNOWN';
    v_reason := CASE WHEN p_index IS NULL THEN 'NO_EVIDENCE'
                     ELSE 'INSUFFICIENT_EVIDENCE' END;
  ELSE
    v_idx := least(1, greatest(0, p_index));
    v_state := CASE WHEN v_idx >= 0.75 THEN 'GOOD'
                    WHEN v_idx >= 0.45 THEN 'WATCH' ELSE 'POOR' END;
    v_conf := public._fleet_insight_confidence(
                greatest(coalesce(p_vehicles,0), coalesce(p_trips,0)),
                p_vehicles, p_trips,
                greatest(coalesce(p_vehicles,0), coalesce(p_trips,0)));
    v_reason := NULL;
  END IF;

  INSERT INTO public.fleet_health
    (company_id, dimension, state, index_value, confidence,
     vehicle_count, trip_count, unknown_reason)
  VALUES (p_company_id, p_dimension, v_state, v_idx, v_conf,
          coalesce(p_vehicles,0), coalesce(p_trips,0), v_reason)
  ON CONFLICT (company_id, dimension) DO UPDATE
    SET state = EXCLUDED.state, index_value = EXCLUDED.index_value,
        confidence = EXCLUDED.confidence,
        vehicle_count = EXCLUDED.vehicle_count,
        trip_count = EXCLUDED.trip_count,
        unknown_reason = EXCLUDED.unknown_reason,
        updated_at = now();
  RETURN v_state;
END;
$fn$;

-- ── 9. OKUMA RPC'Sİ ─────────────────────────────────────────────────────
--
-- Şirket kapılı; kanıt SAYILARI döner, kanıt SATIRLARI ayrı RPC ile
-- (izlenebilirlik gerektiğinde) okunur.
DROP FUNCTION IF EXISTS public.get_fleet_intelligence();

CREATE OR REPLACE FUNCTION public.get_fleet_intelligence()
RETURNS TABLE (
  company_id uuid,
  insight_count integer, active_insight_count integer,
  evidence_count integer, unknown_insight_count integer,
  single_vehicle_insight_count integer,
  trend_count integer, drifting_trend_count integer, unknown_trend_count integer,
  health_unknown_count integer, health_dimension_count integer,
  coverage numeric, vehicles_total integer, vehicles_reporting integer,
  learning_started_at timestamptz, last_update_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_co  uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;              -- fail-closed
  SELECT p.company_id INTO v_co FROM public.profiles p WHERE p.id = v_uid;
  IF v_co IS NULL THEN RETURN; END IF;

  RETURN QUERY
  WITH ins AS (
    SELECT * FROM public.fleet_insight i WHERE i.company_id = v_co
  ), ev AS (
    SELECT count(*)::int AS n FROM public.fleet_insight_evidence e
     WHERE e.insight_id IN (SELECT id FROM ins)
  ), tr AS (
    SELECT * FROM public.fleet_trend t WHERE t.company_id = v_co
  ), he AS (
    SELECT * FROM public.fleet_health h WHERE h.company_id = v_co
  ), veh AS (
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE EXISTS (
             SELECT 1 FROM public.vehicle_trips t
              WHERE t.vehicle_id = v.id AND t.started_at > now() - interval '30 days'
           ))::int AS reporting
      FROM public.vehicles v WHERE v.company_id = v_co
  )
  SELECT v_co,
         (SELECT count(*)::int FROM ins),
         (SELECT count(*)::int FROM ins WHERE state='ACTIVE' AND expires_at > now()),
         (SELECT n FROM ev),
         (SELECT count(*)::int FROM ins WHERE confidence='UNKNOWN'),
         (SELECT count(*)::int FROM ins WHERE unknown_reason='SINGLE_VEHICLE_ONLY'),
         (SELECT count(*)::int FROM tr),
         (SELECT count(*)::int FROM tr WHERE direction IN ('RISING','FALLING')),
         (SELECT count(*)::int FROM tr WHERE direction='UNKNOWN'),
         (SELECT count(*)::int FROM he WHERE state='UNKNOWN'),
         (SELECT count(*)::int FROM he),
         /* KAPSAM: araç yoksa NULL (0 DEĞİL — bölme yapılamaz). */
         (SELECT CASE WHEN total > 0 THEN reporting::numeric / total END FROM veh),
         (SELECT total FROM veh), (SELECT reporting FROM veh),
         (SELECT min(created_at) FROM ins),
         (SELECT max(updated_at) FROM ins);
END;
$fn$;

REVOKE ALL ON FUNCTION public.get_fleet_intelligence() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_fleet_intelligence() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public._fleet_add_evidence(uuid,text,text,text,numeric,text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._fleet_upsert_insight(uuid,text,text,text,uuid,timestamptz,timestamptz,interval)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._fleet_trend_merge(uuid,text,text,numeric,integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._fleet_health_merge(uuid,text,numeric,integer,integer)
  FROM PUBLIC, anon, authenticated;

-- ── 10. RLS + İZİNLER ───────────────────────────────────────────────────
ALTER TABLE public.fleet_insight ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fleet_insight_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fleet_trend ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fleet_health ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.fleet_insight FROM anon, PUBLIC;
REVOKE ALL ON TABLE public.fleet_insight_evidence FROM anon, PUBLIC;
REVOKE ALL ON TABLE public.fleet_trend FROM anon, PUBLIC;
REVOKE ALL ON TABLE public.fleet_health FROM anon, PUBLIC;

GRANT SELECT ON TABLE public.fleet_insight TO authenticated;
GRANT SELECT ON TABLE public.fleet_insight_evidence TO authenticated;
GRANT SELECT ON TABLE public.fleet_trend TO authenticated;
GRANT SELECT ON TABLE public.fleet_health TO authenticated;
GRANT ALL ON TABLE public.fleet_insight TO service_role;
GRANT ALL ON TABLE public.fleet_insight_evidence TO service_role;
GRANT ALL ON TABLE public.fleet_trend TO service_role;
GRANT ALL ON TABLE public.fleet_health TO service_role;

DROP POLICY IF EXISTS fi_company_read ON public.fleet_insight;
CREATE POLICY fi_company_read ON public.fleet_insight
  FOR SELECT TO authenticated
  USING (company_id = (SELECT p.company_id FROM public.profiles p WHERE p.id = auth.uid()));

DROP POLICY IF EXISTS fie_company_read ON public.fleet_insight_evidence;
CREATE POLICY fie_company_read ON public.fleet_insight_evidence
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.fleet_insight i
                  WHERE i.id = insight_id
                    AND i.company_id = (SELECT p.company_id FROM public.profiles p
                                         WHERE p.id = auth.uid())));

DROP POLICY IF EXISTS ft_company_read ON public.fleet_trend;
CREATE POLICY ft_company_read ON public.fleet_trend
  FOR SELECT TO authenticated
  USING (company_id = (SELECT p.company_id FROM public.profiles p WHERE p.id = auth.uid()));

DROP POLICY IF EXISTS fh_company_read ON public.fleet_health;
CREATE POLICY fh_company_read ON public.fleet_health
  FOR SELECT TO authenticated
  USING (company_id = (SELECT p.company_id FROM public.profiles p WHERE p.id = auth.uid()));

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- DOĞRULAMA (fail-closed) — fonksiyonlar ÇAĞRILARAK sınanır.
-- ═══════════════════════════════════════════════════════════════════════════

DO $verify$
DECLARE r record; v_def text;
BEGIN
  -- (a) Tablolar + dedupe/replay kilitleri
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema='public' AND table_name='fleet_insight') THEN
    RAISE EXCEPTION '054 HATA: fleet_insight tablosu yok';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public'
                  AND indexname='fi_dedupe_unique') THEN
    RAISE EXCEPTION '054 HATA: icgoru dedupe kilidi yok';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fie_no_empty_evidence') THEN
    RAISE EXCEPTION '054 HATA: bos kanit engeli yok (UNKNOWN korunmuyor)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fh_unknown_consistent') THEN
    RAISE EXCEPTION '054 HATA: UNKNOWN saglik tutarliligi kisiti yok';
  END IF;

  -- (b) DOĞAL DİL / TAHMİN KOLONU YOK (bu paket AI uretmez)
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='fleet_insight'
                AND column_name IN ('title','message','recommendation','summary','text')) THEN
    RAISE EXCEPTION '054 HATA: icgoruye dogal dil kolonu eklenmis (AI uretimi)';
  END IF;
  -- (c) TEK PUAN YOK
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='fleet_health'
                AND column_name IN ('overall_score','score','rating','grade')) THEN
    RAISE EXCEPTION '054 HATA: filo sagligina TEK PUAN eklenmis';
  END IF;

  -- (d) GÜVEN KAPISI ÇAĞRILARAK sınanır — TEK ARAÇTAN HIGH ÇIKMAZ
  IF public._fleet_insight_confidence(50, 1, 100, 50) IN ('HIGH','VERY_HIGH') THEN
    RAISE EXCEPTION '054 HATA: TEK ARACTAN HIGH cikti (filo iddiasi olamaz)';
  END IF;
  IF public._fleet_insight_confidence(2, 5, 50, 2) <> 'UNKNOWN' THEN
    RAISE EXCEPTION '054 HATA: kanit esigi altinda guven uretildi';
  END IF;
  IF public._fleet_insight_confidence(40, 6, 40, 40) <> 'VERY_HIGH' THEN
    RAISE EXCEPTION '054 HATA: guclu kanitta VERY_HIGH uretilmedi';
  END IF;

  -- (e) MEVCUT KATMANLARA DOKUNULMADI
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='_trip_attribution_trigger';
  IF v_def NOT LIKE '%_resolve_trip_driver%'
     OR v_def NOT LIKE '%_resolve_driver_presence%'
     OR v_def NOT LIKE '%_resolve_driver_authentication%' THEN
    RAISE EXCEPTION '054 HATA: attribution zinciri bozuldu';
  END IF;
  IF v_def LIKE '%fleet_insight%' THEN
    RAISE EXCEPTION '054 HATA: fleet intelligence attribution kararina girmis';
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='_dna_merge_trip';
  IF v_def LIKE '%fleet_insight%' OR v_def LIKE '%fleet_trend%' THEN
    RAISE EXCEPTION '054 HATA: DNA birikimi fleet intelligence e baglanmis';
  END IF;

  SELECT * INTO r FROM public._resolve_driver_presence(
    gen_random_uuid(), gen_random_uuid(), now() - interval '1 hour', now(), NULL);
  IF r.decision <> 'NO_PRESENCE' THEN
    RAISE EXCEPTION '054 HATA: presence resolver davranisi DEGISTI';
  END IF;
  SELECT * INTO r FROM public._resolve_driver_authentication(
    gen_random_uuid(), gen_random_uuid(), now() - interval '1 hour', now());
  IF r.decision <> 'NO_AUTHENTICATION' THEN
    RAISE EXCEPTION '054 HATA: authentication otoritesi DEGISTI';
  END IF;
  IF public._dna_status(4, 500) <> 'NO_DNA' THEN
    RAISE EXCEPTION '054 HATA: DNA esik kapisi DEGISTI';
  END IF;

  -- (f) RLS + anon kilidi + doğrudan yazma kapalı
  FOR r IN SELECT unnest(ARRAY['fleet_insight','fleet_insight_evidence',
                               'fleet_trend','fleet_health']) AS t
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public'
                    AND tablename=r.t AND rowsecurity) THEN
      RAISE EXCEPTION '054 HATA: %: RLS kapali', r.t;
    END IF;
    IF has_table_privilege('anon', 'public.'||r.t, 'SELECT') THEN
      RAISE EXCEPTION '054 HATA: %: anon okuyabiliyor', r.t;
    END IF;
    IF has_table_privilege('authenticated', 'public.'||r.t, 'INSERT')
       OR has_table_privilege('authenticated', 'public.'||r.t, 'UPDATE') THEN
      RAISE EXCEPTION '054 HATA: %: elle yazilabiliyor', r.t;
    END IF;
  END LOOP;

  -- (g) DEFINER + search_path
  FOR r IN SELECT p.proname, pg_get_functiondef(p.oid) AS def
             FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
            WHERE n.nspname='public'
              AND p.proname IN ('_fleet_insight_recount','_fleet_add_evidence',
                                '_fleet_upsert_insight','_fleet_trend_merge',
                                '_fleet_health_merge','get_fleet_intelligence',
                                '_fleet_insight_evidence_guard')
  LOOP
    IF r.def NOT LIKE '%SECURITY DEFINER%' OR r.def NOT LIKE '%search_path%' THEN
      RAISE EXCEPTION '054 HATA: %: DEFINER/search_path eksik', r.proname;
    END IF;
  END LOOP;

  RAISE NOTICE '054 OK: kanit defteri + dedupe/replay kilidi + guven kapisi (tek aractan HIGH yok) + trend/saglik/kapsam kuruldu · DNA/trip/presence/auth DEGISMEDI · dogal dil ve tek puan YOK.';
END
$verify$;
