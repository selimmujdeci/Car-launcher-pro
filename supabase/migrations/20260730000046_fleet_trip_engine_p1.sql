-- ═══════════════════════════════════════════════════════════════════════════
-- 046 — FLEET TRIP ENGINE P1
--
-- YALNIZ İLERİ MIGRATION. 033–045 geçmişi DEĞİŞTİRİLMEZ.
--
-- ── AMAÇ ─────────────────────────────────────────────────────────────────
-- Head unit'te ZATEN VAR OLAN yolculuk verisini (`tripLogService`) buluta
-- güvenli, dürüst, offline-first ve fail-closed şekilde taşımak. Yeni bir
-- trip sistemi kurulmuyor; var olanın kalıcılık ucu açılıyor.
--
-- ── DÜRÜSTLÜK: TAHMİN ÖLÇÜM GİBİ SAKLANMAZ ───────────────────────────────
-- Head unit yakıtı `mesafe/100 × 8.5 L` sabitiyle TAHMİN ediyor ve maliyeti
-- sabit `45 TL/L` ile çarpıyor. Bu değerler saklanır ama **kaynak etiketiyle**
-- (`fuel_source`, `cost_source` ∈ MEASURED·DERIVED·ESTIMATED·UNAVAILABLE).
-- Böylece Cost Analysis ve Driver DNA "varsayım" ile "ölçüm"ü ayırt eder.
-- Bilinmeyen metrik `NULL` kalır — `0` YAZILMAZ (Fleet Reports'u yalanlar).
--
-- ── §6 DEDUPE + REVİZYON ─────────────────────────────────────────────────
-- `trip_key` istemci-üretimli DETERMİNİSTİK anahtardır (başlangıç saniyesi +
-- bitiş saniyesi + yuvarlanmış mesafe). `(vehicle_id, trip_key)` UNIQUE:
--   · aynı anahtar + AYNI/DAHA DÜŞÜK revizyon → `DUPLICATE` (yazma YOK)
--   · aynı anahtar + DAHA YÜKSEK revizyon     → `UPDATED` (düzeltme)
-- Böylece "hiç yükleme kaybetme" ile "asla iki kez sayma" birlikte sağlanır.
--
-- ── OTORİTE SINIRLARI ────────────────────────────────────────────────────
--   · Trip **sahiplik otoritesi DEĞİLDİR** — görünürlük `owner_id`/şirket
--     kapsamından gelir (Vehicle Identity P1 ile aynı desen).
--   · Trip **KOORDİNAT TAŞIMAZ** — rota geçmişi bu paketin KAPSAMI DIŞINDA.
--     Tabloda enlem/boylam kolonu YOKTUR ve olamaz.
--   · Cihaz yazar (`api_key`), kullanıcı okur (`auth.uid()`); `anon` OKUMAZ.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. TABLO ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.vehicle_trips (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id     uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  /* İstemci-üretimli deterministik dedupe anahtarı. */
  trip_key       text NOT NULL,
  /* Yerel trip kimliği — tanı/izleme için; dedupe için KULLANILMAZ. */
  trip_id        text,
  revision       integer NOT NULL DEFAULT 1,

  started_at     timestamptz NOT NULL,
  ended_at       timestamptz,

  /* ── Metrikler — hepsi NULLABLE: bilinmeyen `0` DEĞİLDİR ── */
  distance_km        numeric(10,3),
  duration_min       integer,
  avg_speed_kmh      numeric(6,2),
  max_speed_kmh      numeric(6,2),
  fuel_used_l        numeric(8,3),
  estimated_cost     numeric(12,2),
  idle_time_min      integer,
  moving_time_min    integer,
  stop_count         integer,
  max_rpm            integer,
  max_engine_temp_c  numeric(6,2),
  speed_violations   integer,
  harsh_brake_count  integer,
  harsh_accel_count  integer,

  score          smallint,
  confidence     text NOT NULL DEFAULT 'UNKNOWN',

  /* ── Kaynak etiketleri (dürüstlük) ── */
  distance_source text NOT NULL DEFAULT 'UNAVAILABLE',
  fuel_source     text NOT NULL DEFAULT 'UNAVAILABLE',
  cost_source     text NOT NULL DEFAULT 'UNAVAILABLE',

  /* Olay özeti — koordinat İÇERMEZ (yalnız tür/offset/şiddet). */
  events         jsonb NOT NULL DEFAULT '[]'::jsonb,

  /* Sunucu zamanları — istemci saati otorite DEĞİL. */
  received_at    timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT vehicle_trips_key_unique UNIQUE (vehicle_id, trip_key),
  CONSTRAINT vehicle_trips_revision_positive CHECK (revision >= 1),
  CONSTRAINT vehicle_trips_score_range CHECK (score IS NULL OR (score >= 0 AND score <= 100)),
  CONSTRAINT vehicle_trips_confidence_valid
    CHECK (confidence IN ('HIGH','MEDIUM','LOW','UNKNOWN')),
  CONSTRAINT vehicle_trips_distance_source_valid
    CHECK (distance_source IN ('MEASURED','DERIVED','ESTIMATED','UNAVAILABLE')),
  CONSTRAINT vehicle_trips_fuel_source_valid
    CHECK (fuel_source IN ('MEASURED','DERIVED','ESTIMATED','UNAVAILABLE')),
  CONSTRAINT vehicle_trips_cost_source_valid
    CHECK (cost_source IN ('MEASURED','DERIVED','ESTIMATED','UNAVAILABLE')),
  /* Negatif metrik fiziksel olarak anlamsız. */
  CONSTRAINT vehicle_trips_nonnegative CHECK (
    (distance_km  IS NULL OR distance_km  >= 0) AND
    (duration_min IS NULL OR duration_min >= 0) AND
    (fuel_used_l  IS NULL OR fuel_used_l  >= 0) AND
    (estimated_cost IS NULL OR estimated_cost >= 0) AND
    (stop_count   IS NULL OR stop_count   >= 0)
  ),
  /* Bitiş başlangıçtan önce olamaz. */
  CONSTRAINT vehicle_trips_time_order CHECK (ended_at IS NULL OR ended_at >= started_at)
);

CREATE INDEX IF NOT EXISTS vehicle_trips_vehicle_started_idx
  ON public.vehicle_trips (vehicle_id, started_at DESC);
CREATE INDEX IF NOT EXISTS vehicle_trips_received_idx
  ON public.vehicle_trips (received_at DESC);

-- ── 2. RLS + İZİNLER (fail-closed) ──────────────────────────────────────
ALTER TABLE public.vehicle_trips ENABLE ROW LEVEL SECURITY;

-- anon TABLOYA doğrudan erişemez (yalnız RPC ile yazar).
REVOKE ALL ON TABLE public.vehicle_trips FROM anon;
GRANT SELECT ON TABLE public.vehicle_trips TO authenticated;
GRANT ALL    ON TABLE public.vehicle_trips TO service_role;

DROP POLICY IF EXISTS trips_scope_read ON public.vehicle_trips;
CREATE POLICY trips_scope_read ON public.vehicle_trips
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.vehicles v
       WHERE v.id = vehicle_trips.vehicle_id
         AND (
           v.owner_id = auth.uid()
           OR (v.company_id IS NOT NULL AND v.company_id =
                 (SELECT company_id FROM public.profiles WHERE id = auth.uid()))
         )
    )
  );

-- ── 3. YAZMA RPC — cihaz yolu (api_key), dedupe + revizyon ──────────────
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
  p_events        jsonb       DEFAULT '[]'::jsonb
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
BEGIN
  -- Kimlik doğrulama: api_key → araç. Sahiplik BURADA belirlenmez.
  SELECT id INTO v_vehicle_id FROM public.vehicles
   WHERE coalesce(api_key_hash, api_key) = p_api_key;
  IF v_vehicle_id IS NULL THEN
    RAISE EXCEPTION 'invalid_api_key' USING ERRCODE='P0001';
  END IF;

  IF v_key IS NULL THEN
    RETURN jsonb_build_object('state','REJECTED','reason','MISSING_TRIP_KEY',
                              'serverRevision',NULL);
  END IF;

  -- İstemci saati OTORİTE DEĞİL: gelecekten gelen damga şimdiye kırpılır.
  v_started := LEAST(now(), coalesce(to_timestamp(p_started_at_ms / 1000.0), now()));
  v_ended   := CASE WHEN p_ended_at_ms IS NULL THEN NULL
                    ELSE LEAST(now(), to_timestamp(p_ended_at_ms / 1000.0)) END;
  IF v_ended IS NOT NULL AND v_ended < v_started THEN
    v_ended := v_started;   -- ters sıra kısıtı ihlal etmesin
  END IF;

  -- Enum daraltma: tanınmayan değer UYDURULMAZ → UNAVAILABLE/UNKNOWN.
  v_conf := coalesce(NULLIF(btrim(coalesce(p_confidence,'')),''), 'UNKNOWN');
  IF v_conf NOT IN ('HIGH','MEDIUM','LOW','UNKNOWN') THEN v_conf := 'UNKNOWN'; END IF;

  v_dist_src := coalesce(NULLIF(btrim(coalesce(p_sources->>'distance','')),''), 'UNAVAILABLE');
  v_fuel_src := coalesce(NULLIF(btrim(coalesce(p_sources->>'fuel','')),''), 'UNAVAILABLE');
  v_cost_src := coalesce(NULLIF(btrim(coalesce(p_sources->>'cost','')),''), 'UNAVAILABLE');
  IF v_dist_src NOT IN ('MEASURED','DERIVED','ESTIMATED','UNAVAILABLE') THEN v_dist_src := 'UNAVAILABLE'; END IF;
  IF v_fuel_src NOT IN ('MEASURED','DERIVED','ESTIMATED','UNAVAILABLE') THEN v_fuel_src := 'UNAVAILABLE'; END IF;
  IF v_cost_src NOT IN ('MEASURED','DERIVED','ESTIMATED','UNAVAILABLE') THEN v_cost_src := 'UNAVAILABLE'; END IF;

  v_dist := NULLIF(p_metrics->>'distanceKm','')::numeric;
  -- Ölçülebilir mesafesi olmayan trip Fleet'e bilgi EKLEMEZ.
  IF v_dist IS NULL OR v_dist <= 0 THEN
    RETURN jsonb_build_object('state','REJECTED','reason','NO_DISTANCE',
                              'serverRevision',NULL);
  END IF;

  SELECT * INTO v_existing FROM public.vehicle_trips
   WHERE vehicle_id = v_vehicle_id AND trip_key = v_key FOR UPDATE;

  -- ── §6 DEDUPE ────────────────────────────────────────────────────────
  IF FOUND THEN
    IF v_rev <= v_existing.revision THEN
      -- Aynı yolculuk yeniden geldi → YAZMA YOK, tekrar sayılmaz.
      RETURN jsonb_build_object('state','DUPLICATE','reason','SAME_OR_LOWER_REVISION',
                                'serverRevision', v_existing.revision);
    END IF;

    -- Daha yüksek revizyon = DÜZELTME. Bilinmeyen alan eskiyi EZMEZ.
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
      stop_count        = coalesce(NULLIF(p_metrics->>'stopCount','')::integer, stop_count),
      max_rpm           = coalesce(NULLIF(p_metrics->>'maxRpm','')::integer, max_rpm),
      max_engine_temp_c = coalesce(NULLIF(p_metrics->>'maxEngineTempC','')::numeric, max_engine_temp_c),
      speed_violations  = coalesce(NULLIF(p_metrics->>'speedViolations','')::integer, speed_violations),
      harsh_brake_count = coalesce(NULLIF(p_metrics->>'harshBrakeCount','')::integer, harsh_brake_count),
      harsh_accel_count = coalesce(NULLIF(p_metrics->>'harshAccelCount','')::integer, harsh_accel_count),
      score             = coalesce(p_score::smallint, score),
      confidence        = v_conf,
      distance_source   = v_dist_src,
      fuel_source       = v_fuel_src,
      cost_source       = v_cost_src,
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
    fuel_used_l, estimated_cost, idle_time_min, moving_time_min, stop_count,
    max_rpm, max_engine_temp_c, speed_violations,
    harsh_brake_count, harsh_accel_count,
    score, confidence, distance_source, fuel_source, cost_source, events
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
    NULLIF(p_metrics->>'stopCount','')::integer,
    NULLIF(p_metrics->>'maxRpm','')::integer,
    NULLIF(p_metrics->>'maxEngineTempC','')::numeric,
    NULLIF(p_metrics->>'speedViolations','')::integer,
    NULLIF(p_metrics->>'harshBrakeCount','')::integer,
    NULLIF(p_metrics->>'harshAccelCount','')::integer,
    p_score::smallint, v_conf, v_dist_src, v_fuel_src, v_cost_src,
    CASE WHEN jsonb_typeof(p_events)='array' THEN p_events ELSE '[]'::jsonb END
  );

  RETURN jsonb_build_object('state','CREATED','reason',NULL,'serverRevision', v_rev);
END;
$fn$;

-- ── 4. OKUMA RPC — Fleet UI (kapsamlı, koordinatsız) ────────────────────
CREATE OR REPLACE FUNCTION public.list_vehicle_trips(p_vehicle_id uuid, p_limit integer DEFAULT 50)
RETURNS TABLE (
  trip_key text, trip_id text, revision integer,
  started_at timestamptz, ended_at timestamptz,
  distance_km numeric, duration_min integer,
  avg_speed_kmh numeric, max_speed_kmh numeric,
  fuel_used_l numeric, estimated_cost numeric,
  idle_time_min integer, moving_time_min integer, stop_count integer,
  max_rpm integer, max_engine_temp_c numeric, speed_violations integer,
  harsh_brake_count integer, harsh_accel_count integer,
  score smallint, confidence text,
  distance_source text, fuel_source text, cost_source text,
  received_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
#variable_conflict use_column
DECLARE
  v_uid uuid := auth.uid();
  v_co  uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;   -- oturum yok → satır yok (fail-closed)

  SELECT company_id INTO v_co FROM public.profiles WHERE id = v_uid;

  RETURN QUERY
  SELECT t.trip_key, t.trip_id, t.revision, t.started_at, t.ended_at,
         t.distance_km, t.duration_min, t.avg_speed_kmh, t.max_speed_kmh,
         t.fuel_used_l, t.estimated_cost,
         t.idle_time_min, t.moving_time_min, t.stop_count,
         t.max_rpm, t.max_engine_temp_c, t.speed_violations,
         t.harsh_brake_count, t.harsh_accel_count,
         t.score, t.confidence,
         t.distance_source, t.fuel_source, t.cost_source, t.received_at
    FROM public.vehicle_trips t
    JOIN public.vehicles v ON v.id = t.vehicle_id
   WHERE t.vehicle_id = p_vehicle_id
     AND (v.owner_id = v_uid OR (v_co IS NOT NULL AND v.company_id = v_co))
   ORDER BY t.started_at DESC
   LIMIT LEAST(GREATEST(coalesce(p_limit, 50), 1), 200);
END;
$fn$;

-- ── 5. İZİNLER ──────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.upload_vehicle_trip(
  text,text,text,integer,bigint,bigint,jsonb,integer,text,jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upload_vehicle_trip(
  text,text,text,integer,bigint,bigint,jsonb,integer,text,jsonb,jsonb)
  TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.list_vehicle_trips(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_vehicle_trips(uuid, integer)
  TO authenticated, service_role;

-- ── 6. DOĞRULAMA (fail-closed) ──────────────────────────────────────────
DO $$
DECLARE v_def text; v_missing text;
BEGIN
  -- (a) Tablo ve dedupe kısıtı
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='vehicle_trips') THEN
    RAISE EXCEPTION '046 HATA: vehicle_trips tablosu yok';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='vehicle_trips_key_unique') THEN
    RAISE EXCEPTION '046 HATA: (vehicle_id, trip_key) UNIQUE kisiti yok (dedupe acik)';
  END IF;

  -- (b) KOORDİNAT KOLONU OLMAMALI (rota geçmişi kapsam dışı)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='vehicle_trips'
       AND (column_name IN ('lat','lng','latitude','longitude')
            OR column_name ILIKE '%coord%')
  ) THEN
    RAISE EXCEPTION '046 HATA: vehicle_trips koordinat kolonu tasiyor (kapsam disi)';
  END IF;

  -- (c) Metrik kolonları NULLABLE olmalı (bilinmeyen 0 YAZILMAZ)
  SELECT string_agg(column_name, ', ') INTO v_missing
    FROM information_schema.columns
   WHERE table_schema='public' AND table_name='vehicle_trips'
     AND column_name IN ('distance_km','duration_min','fuel_used_l','estimated_cost',
                         'max_rpm','max_engine_temp_c','idle_time_min','stop_count')
     AND is_nullable = 'NO';
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '046 HATA: metrik kolonlari NOT NULL: %', v_missing;
  END IF;

  -- (d) Kaynak etiketi kolonları var mı (dürüstlük sözleşmesi)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='vehicle_trips' AND column_name='fuel_source'
  ) THEN
    RAISE EXCEPTION '046 HATA: fuel_source kolonu yok (tahmin/olcum ayrimi kayip)';
  END IF;

  -- (e) RLS açık
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='vehicle_trips' AND rowsecurity
  ) THEN
    RAISE EXCEPTION '046 HATA: vehicle_trips RLS kapali';
  END IF;

  -- (f) anon TABLOYU okuyamamalı ve OKUMA RPC'sini çalıştıramamalı
  IF has_table_privilege('anon','public.vehicle_trips','SELECT') THEN
    RAISE EXCEPTION '046 HATA: anon vehicle_trips SELECT yetkisi acik';
  END IF;
  IF has_function_privilege('anon','public.list_vehicle_trips(uuid,integer)','EXECUTE') THEN
    RAISE EXCEPTION '046 HATA: anon trip okuma RPC yetkisi acik';
  END IF;

  -- (g) Yazma RPC DEFINER + sabit search_path + dedupe hükmü içermeli
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='upload_vehicle_trip' LIMIT 1;
  IF v_def IS NULL OR v_def NOT LIKE '%SECURITY DEFINER%' OR v_def NOT LIKE '%search_path%' THEN
    RAISE EXCEPTION '046 HATA: upload_vehicle_trip DEFINER/search_path eksik';
  END IF;
  IF v_def NOT LIKE '%DUPLICATE%' THEN
    RAISE EXCEPTION '046 HATA: dedupe hukmu yok (ayni trip iki kez sayilabilir)';
  END IF;

  RAISE NOTICE '046 OK: vehicle_trips + dedupe/revizyon + kaynak etiketleri + RLS · anon kapali · koordinat YOK.';
END $$;

COMMIT;
