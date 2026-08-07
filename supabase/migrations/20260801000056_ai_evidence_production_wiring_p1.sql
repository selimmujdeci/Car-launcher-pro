-- ═══════════════════════════════════════════════════════════════════════════
-- 056 — AI EVIDENCE PRODUCTION WIRING (P1)
--
-- YALNIZ İLERİ MIGRATION. 033–055 geçmişi DEĞİŞTİRİLMEZ.
--
-- ── AMAÇ ─────────────────────────────────────────────────────────────────
-- 055'in kanıt omurgasını GERÇEK üretim kaynaklarına bağlar. Bu pakette
-- YALNIZ üç kaynak vardır:
--     TRIP_ENGINE · DRIVER_DNA · FLEET_INTELLIGENCE
-- Deep Scan · BlackBox · DTC · bakım tahmini · LLM çıktıları KAPSAM DIŞIDIR.
--
-- ── ÜÇ MİMARİ KURAL ──────────────────────────────────────────────────────
--  1. **KAYNAK MODÜLLER DOĞRUDAN KANIT YAZMAZ.** Her kaynağın TEK bir
--     kanonik adaptörü vardır; kanıt yalnız o adaptörden geçer.
--  2. **KAYNAK SAHİPLİĞİ:** bir adaptör YALNIZ kendi `source` değeriyle
--     yazabilir ve BAŞKA kaynağın kanıtına dokunamaz (kilit: adaptör kapısı
--     + 055'in değişmezlik trigger'ı).
--  3. **HATA YALITIMI:** kanıt yazımı düşerse ana işlem (trip yükleme, DNA
--     güncellemesi, insight sayımı) BOZULMAZ — ama hata **SESSİZCE
--     YUTULMAZ**: durum kaydedilir ve sınırlı yeniden deneme kuyruğa girer.
--
-- ── PARALEL MOTOR KURULMAZ ───────────────────────────────────────────────
-- Fleet Intelligence'ın mevcut `fleet_insight_evidence` satırları TEK
-- GERÇEK KAYNAKTIR; burada ikinci bir kanıt hesaplama motoru YOKTUR.
-- Aynı şekilde DNA metrik formülleri SQL'e kopyalanmaz — adaptör yalnız
-- PG'nin ZATEN sahip olduğu tanımsal oranları ve sayaçları kanıta çevirir.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. KANIT MODELİ GENİŞLETMESİ (revizyon + devir) ─────────────────────
--
-- ⚠️ 055 sözleşmesi BOZULMAZ, GENİŞLETİLİR: yeni kolonlar varsayılanlıdır
-- ve mevcut satırların davranışını değiştirmez.
--
-- NEDEN GEREKLİ: bir yolculuk sonradan güncellenirse (revision artışı) eski
-- kanıt DEĞİŞTİRİLEMEZ (değişmezlik kuralı). O hâlde yeni ölçüm YENİ bir
-- kanıt revizyonu olmalı ve eskisi `SUPERSEDED` olarak İLİŞKİLENDİRİLMELİDİR
-- — geçmişte söylenmiş bir şeyin dayanağı korunur.
ALTER TABLE public.ai_evidence
  ADD COLUMN IF NOT EXISTS subject_revision integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS superseded_by uuid REFERENCES public.ai_evidence(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ae_subject_revision_nonneg') THEN
    ALTER TABLE public.ai_evidence
      ADD CONSTRAINT ae_subject_revision_nonneg CHECK (subject_revision >= 0);
  END IF;
END $$;

/* Birleştirme kimliği artık ÖZNE REVİZYONUNU da içerir: aynı yolculuğun
   farklı revizyonu AYRI kanıttır (eski değer korunur). */
DROP INDEX IF EXISTS public.ae_merge_unique;
CREATE UNIQUE INDEX IF NOT EXISTS ae_merge_unique
  ON public.ai_evidence (
    company_id, source, category, metric, subject_revision,
    coalesce(vehicle_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(driver_id,  '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(trip_id,    '00000000-0000-0000-0000-000000000000'::uuid));

-- ── 2. ADAPTÖR DURUMU VE YENİDEN DENEME ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ai_evidence_adapter_state (
  source        text PRIMARY KEY,
  last_event_at timestamptz,
  last_result   text NOT NULL DEFAULT 'REPORTED',
  last_error    text,
  reported_count      integer NOT NULL DEFAULT 0,
  deduped_count       integer NOT NULL DEFAULT 0,
  rejected_count      integer NOT NULL DEFAULT 0,
  degraded_count      integer NOT NULL DEFAULT 0,
  retry_pending_count integer NOT NULL DEFAULT 0,
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT aeas_source_valid CHECK (source IN
    ('TRIP_ENGINE','DRIVER_DNA','FLEET_INTELLIGENCE')),
  CONSTRAINT aeas_result_valid CHECK (last_result IN
    ('REPORTED','DEDUPED','REJECTED','DEGRADED','RETRY_PENDING')),
  CONSTRAINT aeas_counts_nonneg CHECK (
    reported_count >= 0 AND deduped_count >= 0 AND rejected_count >= 0
    AND degraded_count >= 0 AND retry_pending_count >= 0)
);

/**
 * Yeniden deneme kuyruğu — **SINIRLI**.
 *
 * ⚠️ Sonsuz/hızlı yeniden deneme YASAK: her denemede bekleme katlanır
 * (2^n dakika) ve `MAX_ATTEMPTS`ten sonra kayıt `DEGRADED` olarak kalır —
 * sessizce kaybolmaz, LAB'da görünür.
 */
CREATE TABLE IF NOT EXISTS public.ai_evidence_retry (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source       text NOT NULL,
  subject_kind text NOT NULL,
  subject_id   uuid NOT NULL,
  attempts     integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error   text,
  state        text NOT NULL DEFAULT 'RETRY_PENDING',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT aer_source_valid CHECK (source IN
    ('TRIP_ENGINE','DRIVER_DNA','FLEET_INTELLIGENCE')),
  CONSTRAINT aer_subject_valid CHECK (subject_kind IN ('TRIP','DNA','INSIGHT')),
  CONSTRAINT aer_state_valid CHECK (state IN ('RETRY_PENDING','DEGRADED','DONE')),
  CONSTRAINT aer_attempts_bounded CHECK (attempts >= 0 AND attempts <= 5)
);

/* Aynı özne için TEK bekleyen kayıt — kuyruk şişmez. */
CREATE UNIQUE INDEX IF NOT EXISTS aer_subject_unique
  ON public.ai_evidence_retry (source, subject_kind, subject_id)
  WHERE state = 'RETRY_PENDING';

CREATE INDEX IF NOT EXISTS aer_due_idx
  ON public.ai_evidence_retry (next_attempt_at) WHERE state = 'RETRY_PENDING';

-- ── 3. KAYNAK SAHİPLİĞİ ─────────────────────────────────────────────────
--
-- Bir adaptör YALNIZ kendi kaynağıyla yazabilir. Eşleme AÇIKTIR ve
-- doğrulama bölümü onu çağırarak sınar.
CREATE OR REPLACE FUNCTION public._evidence_adapter_source(p_adapter text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public
AS $fn$
  SELECT CASE p_adapter
    WHEN 'TRIP_METRICS_ADAPTER'       THEN 'TRIP_ENGINE'
    WHEN 'DRIVER_DNA_ADAPTER'         THEN 'DRIVER_DNA'
    WHEN 'FLEET_INTELLIGENCE_ADAPTER' THEN 'FLEET_INTELLIGENCE'
    ELSE NULL END;
$fn$;

CREATE OR REPLACE FUNCTION public._evidence_adapter_state_bump(
  p_source text, p_result text, p_error text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  INSERT INTO public.ai_evidence_adapter_state (source, last_event_at, last_result, last_error)
  VALUES (p_source, now(), p_result, p_error)
  ON CONFLICT (source) DO UPDATE SET
    last_event_at = now(),
    last_result   = p_result,
    last_error    = p_error,
    reported_count      = public.ai_evidence_adapter_state.reported_count
                          + CASE WHEN p_result='REPORTED' THEN 1 ELSE 0 END,
    deduped_count       = public.ai_evidence_adapter_state.deduped_count
                          + CASE WHEN p_result='DEDUPED' THEN 1 ELSE 0 END,
    rejected_count      = public.ai_evidence_adapter_state.rejected_count
                          + CASE WHEN p_result='REJECTED' THEN 1 ELSE 0 END,
    degraded_count      = public.ai_evidence_adapter_state.degraded_count
                          + CASE WHEN p_result='DEGRADED' THEN 1 ELSE 0 END,
    retry_pending_count = public.ai_evidence_adapter_state.retry_pending_count
                          + CASE WHEN p_result='RETRY_PENDING' THEN 1 ELSE 0 END,
    updated_at = now();
END;
$fn$;

/**
 * ADAPTÖR YAZMA KAPISI — kanıta giden TEK yol.
 *
 * Kaynak sahipliği burada uygulanır: `p_adapter`ın izinli kaynağı ile
 * yazılmak istenen `p_source` uyuşmuyorsa yazım REDDEDİLİR.
 */
CREATE OR REPLACE FUNCTION public._evidence_adapter_record(
  p_adapter text, p_source text,
  p_company_id uuid, p_category text, p_metric text,
  p_vehicle_id uuid, p_driver_id uuid, p_trip_id uuid,
  p_severity text, p_provenance text, p_value numeric, p_samples integer,
  p_subject_revision integer DEFAULT 0,
  p_observed_at timestamptz DEFAULT now(),
  p_ttl interval DEFAULT interval '30 days')
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE v_allowed text; v_id uuid; v_state text; v_res text;
BEGIN
  v_allowed := public._evidence_adapter_source(p_adapter);
  IF v_allowed IS NULL OR v_allowed IS DISTINCT FROM p_source THEN
    /* KAYNAK SAHİPLİĞİ İHLALİ — adaptör başka kaynağın kanıtını yazamaz. */
    RETURN 'FOREIGN_SOURCE';
  END IF;

  SELECT id, state INTO v_id, v_state FROM public.ai_evidence
   WHERE company_id = p_company_id AND source = p_source
     AND category = p_category AND metric = p_metric
     AND subject_revision = coalesce(p_subject_revision,0)
     AND coalesce(vehicle_id,'00000000-0000-0000-0000-000000000000'::uuid)
         = coalesce(p_vehicle_id,'00000000-0000-0000-0000-000000000000'::uuid)
     AND coalesce(driver_id,'00000000-0000-0000-0000-000000000000'::uuid)
         = coalesce(p_driver_id,'00000000-0000-0000-0000-000000000000'::uuid)
     AND coalesce(trip_id,'00000000-0000-0000-0000-000000000000'::uuid)
         = coalesce(p_trip_id,'00000000-0000-0000-0000-000000000000'::uuid);

  IF v_id IS NOT NULL THEN
    /* AYNI özne + revizyon: tazeleme (dedupe) — yeni kayıt AÇILMAZ. */
    UPDATE public.ai_evidence
       SET severity=p_severity, provenance=p_provenance, value=p_value,
           sample_count = greatest(sample_count, coalesce(p_samples,0)),
           last_seen_at = greatest(last_seen_at, p_observed_at),
           expires_at   = greatest(expires_at, p_observed_at + p_ttl),
           state        = CASE WHEN state='SUPERSEDED' THEN state ELSE 'ACTIVE' END,
           refresh_count = refresh_count + 1
     WHERE id = v_id
     RETURNING state INTO v_state;
    RETURN CASE WHEN v_state='REJECTED' THEN 'REJECTED' ELSE 'DEDUPED' END;
  END IF;

  INSERT INTO public.ai_evidence
    (company_id, source, category, metric, subject_revision,
     vehicle_id, driver_id, trip_id, severity, provenance, value, sample_count,
     created_at, last_seen_at, expires_at)
  VALUES (p_company_id, p_source, p_category, p_metric, coalesce(p_subject_revision,0),
          p_vehicle_id, p_driver_id, p_trip_id,
          coalesce(p_severity,'INFO'), coalesce(p_provenance,'UNKNOWN'),
          p_value, coalesce(p_samples,0),
          p_observed_at, p_observed_at, p_observed_at + p_ttl)
  RETURNING state INTO v_res;

  RETURN CASE WHEN v_res='REJECTED' THEN 'REJECTED' ELSE 'REPORTED' END;
END;
$fn$;

-- ── 4. TRIP METRICS ADAPTÖRÜ ────────────────────────────────────────────
--
-- YALNIZ GERÇEK TRIP KAPANIŞINDAN SONRA çalışır (`ended_at` dolu).
-- Her metrik KENDİ `*_source` alanını taşır:
--   · `UNAVAILABLE`/NULL  → kanıt ÜRETİLMEZ (0 sayılmaz)
--   · `ESTIMATED`         → kanıt üretilir ama ÖLÇÜLMÜŞ gibi işaretlenmez
-- Trip revizyonu artarsa ESKİ kanıt DEĞİŞTİRİLMEZ; yeni revizyon açılır ve
-- eskisi `SUPERSEDED` olarak ilişkilendirilir.
CREATE OR REPLACE FUNCTION public._evidence_from_trip(p_trip_id uuid)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  t   public.vehicle_trips%ROWTYPE;
  v_co uuid;
  v_rev integer;
  v_res text;
  v_any boolean := false;
  v_dedup boolean := false;
  m record;
BEGIN
  SELECT * INTO t FROM public.vehicle_trips WHERE id = p_trip_id;
  IF NOT FOUND THEN RETURN 'REJECTED'; END IF;

  /* KAPANMAMIŞ yolculuk kanıt üretmez — devam eden ölçüm kanıt değildir. */
  IF t.ended_at IS NULL THEN RETURN 'SKIPPED_OPEN_TRIP'; END IF;

  SELECT company_id INTO v_co FROM public.vehicles WHERE id = t.vehicle_id;
  IF v_co IS NULL THEN RETURN 'REJECTED'; END IF;   -- bireysel/şirketsiz araç

  v_rev := coalesce(t.revision, 1);

  /* ESKİ REVİZYON KANITLARI: değeri DEĞİŞTİRİLMEZ, yalnız devredilir. */
  UPDATE public.ai_evidence
     SET state = 'SUPERSEDED'
   WHERE trip_id = p_trip_id AND source = 'TRIP_ENGINE'
     AND subject_revision < v_rev AND state = 'ACTIVE';

  /* Metrik tablosu: değer · kaynak alanı · kategori. Tek yerde tanımlı. */
  FOR m IN
    SELECT * FROM (VALUES
      ('distance_km',        t.distance_km,                    t.distance_source,          'TRIP'),
      ('duration_min',       t.duration_min::numeric,          t.duration_source,          'TRIP'),
      ('moving_time_min',    t.moving_time_min::numeric,       t.moving_source,            'TRIP'),
      ('idle_time_min',      t.idle_time_min::numeric,         t.idle_source,              'TRIP'),
      ('unknown_time_min',   t.unknown_time_min::numeric,      t.duration_source,          'TRIP'),
      ('harsh_brake_count',  t.harsh_brake_count::numeric,     t.harsh_brake_source,       'DRIVER'),
      ('harsh_accel_count',  t.harsh_accel_count::numeric,     t.harsh_accel_source,       'DRIVER'),
      ('max_rpm',            t.max_rpm::numeric,               t.max_rpm_source,           'ENGINE'),
      ('max_engine_temp_c',  t.max_engine_temp_c,              t.max_temp_source,          'TEMPERATURE'),
      ('fuel_used_l',        t.fuel_used_l,                    t.fuel_source,              'FUEL'),
      ('estimated_cost',     t.estimated_cost,                 t.cost_source,              'TRIP')
    ) AS x(metric, val, src, cat)
  LOOP
    /* ÖLÇÜLMEMİŞ ALAN KANIT ÜRETMEZ. */
    CONTINUE WHEN m.val IS NULL;
    CONTINUE WHEN m.src IS NULL OR m.src = 'UNAVAILABLE';

    v_res := public._evidence_adapter_record(
      'TRIP_METRICS_ADAPTER', 'TRIP_ENGINE', v_co, m.cat, m.metric,
      t.vehicle_id, t.driver_id, p_trip_id,
      'INFO',
      /* ESTIMATED, ÖLÇÜLMÜŞ gibi işaretlenmez — olduğu gibi taşınır. */
      m.src,
      m.val, 1, v_rev, coalesce(t.ended_at, now()));

    IF v_res = 'REPORTED' THEN v_any := true;
    ELSIF v_res = 'DEDUPED' THEN v_dedup := true; END IF;
  END LOOP;

  /* Trip'in KENDİ güven damgası da bir kanıttır (sayısal karşılığıyla). */
  IF t.confidence IS NOT NULL AND t.confidence <> 'UNKNOWN' THEN
    v_res := public._evidence_adapter_record(
      'TRIP_METRICS_ADAPTER', 'TRIP_ENGINE', v_co, 'TRIP', 'trip_confidence',
      t.vehicle_id, t.driver_id, p_trip_id, 'INFO', 'DERIVED',
      CASE t.confidence WHEN 'VERY_HIGH' THEN 4 WHEN 'HIGH' THEN 3
                        WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 1 ELSE 0 END,
      1, v_rev, coalesce(t.ended_at, now()));
    IF v_res = 'REPORTED' THEN v_any := true; END IF;
  END IF;

  IF v_any THEN RETURN 'REPORTED'; END IF;
  IF v_dedup THEN RETURN 'DEDUPED'; END IF;
  RETURN 'REJECTED';   -- hiçbir alan ölçülmemiş → kanıt yok
END;
$fn$;

-- ── 5. DRIVER DNA ADAPTÖRÜ ──────────────────────────────────────────────
--
-- YALNIZ ÖĞRENME EŞİĞİ AŞILDIĞINDA çalışır (`_dna_status <> 'NO_DNA'`).
--
-- ⚠️ METRİK FORMÜLÜ SQL'E KOPYALANMAZ (053 kuralı): adaptör yalnız PG'nin
-- ZATEN sahip olduğu **tanımsal** oranları (toplam ÷ mesafe) ve sayaçları
-- kanıta çevirir. Karakter metriklerinin tek otoritesi `driverDnaEngine.ts`.
--
-- ⚠️ Viraj/akü için KAYNAK YOK → kanıt ÜRETİLMEZ (uydurma yasağı).
-- ⚠️ `RETRACTED` DNA aktif güvenilir kanıt gibi KULLANILMAZ.
CREATE OR REPLACE FUNCTION public._evidence_from_dna(p_dna_id uuid)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  d public.driver_dna%ROWTYPE;
  v_status text;
  v_res text;
  v_any boolean := false;
  v_dedup boolean := false;
  v_lvl integer;
BEGIN
  SELECT * INTO d FROM public.driver_dna WHERE id = p_dna_id;
  IF NOT FOUND THEN RETURN 'REJECTED'; END IF;

  v_status := public._dna_status(d.trip_count, d.total_distance_km);

  /* EŞİK ALTINDA KANIT YOK — yarım DNA kanıt değildir. */
  IF v_status = 'NO_DNA' THEN RETURN 'SKIPPED_BELOW_THRESHOLD'; END IF;

  /* RETRACTED DNA: mevcut kanıtlar AKTİF GÜVENİLİR sayılmaz → devredilir.
     Değerleri DEĞİŞTİRİLMEZ (değişmezlik), yalnız durumu düşer. */
  IF d.integrity_state = 'RETRACTED' THEN
    UPDATE public.ai_evidence
       SET state = 'SUPERSEDED'
     WHERE driver_id = d.driver_id AND source = 'DRIVER_DNA' AND state = 'ACTIVE';
    RETURN 'DEGRADED';
  END IF;

  v_lvl := CASE public._dna_learning_level(d.trip_count)
             WHEN 'MATURE' THEN 4 WHEN 'ESTABLISHED' THEN 3
             WHEN 'DEVELOPING' THEN 2 WHEN 'NASCENT' THEN 1 ELSE 0 END;

  /* (a) Öğrenme kapsamı — her DNA kanıtının bağlamı. */
  v_res := public._evidence_adapter_record(
    'DRIVER_DNA_ADAPTER', 'DRIVER_DNA', d.company_id, 'DRIVER',
    'dna_trip_count', NULL, d.driver_id, NULL, 'INFO', 'MEASURED',
    d.trip_count, d.trip_count, d.revision);
  IF v_res='REPORTED' THEN v_any := true; ELSIF v_res='DEDUPED' THEN v_dedup := true; END IF;

  v_res := public._evidence_adapter_record(
    'DRIVER_DNA_ADAPTER', 'DRIVER_DNA', d.company_id, 'DRIVER',
    'dna_distance_km', NULL, d.driver_id, NULL, 'INFO', 'MEASURED',
    d.total_distance_km, d.trip_count, d.revision);
  IF v_res='REPORTED' THEN v_any := true; END IF;

  v_res := public._evidence_adapter_record(
    'DRIVER_DNA_ADAPTER', 'DRIVER_DNA', d.company_id, 'DRIVER',
    'dna_learning_level', NULL, d.driver_id, NULL, 'INFO', 'DERIVED',
    v_lvl, d.trip_count, d.revision);
  IF v_res='REPORTED' THEN v_any := true; END IF;

  /* (b) TANIMSAL oranlar — yalnız kanıt mesafesi varsa (bölme yapılabilirse).
     `*_measured_only` false ise provenance DERIVED'a düşer (en zayıf halka). */
  IF d.brake_count > 0 AND d.brake_km > 0 THEN
    v_res := public._evidence_adapter_record(
      'DRIVER_DNA_ADAPTER', 'DRIVER_DNA', d.company_id, 'DRIVER',
      'dna_harsh_brake_per_100km', NULL, d.driver_id, NULL, 'NOTICE',
      CASE WHEN d.brake_measured_only THEN 'MEASURED' ELSE 'DERIVED' END,
      d.brake_sum / d.brake_km * 100, d.brake_count, d.revision);
    IF v_res='REPORTED' THEN v_any := true; END IF;
  END IF;

  IF d.accel_count > 0 AND d.accel_km > 0 THEN
    v_res := public._evidence_adapter_record(
      'DRIVER_DNA_ADAPTER', 'DRIVER_DNA', d.company_id, 'DRIVER',
      'dna_harsh_accel_per_100km', NULL, d.driver_id, NULL, 'NOTICE',
      CASE WHEN d.accel_measured_only THEN 'MEASURED' ELSE 'DERIVED' END,
      d.accel_sum / d.accel_km * 100, d.accel_count, d.revision);
    IF v_res='REPORTED' THEN v_any := true; END IF;
  END IF;

  IF d.fuel_count > 0 AND d.fuel_km > 0 THEN
    v_res := public._evidence_adapter_record(
      'DRIVER_DNA_ADAPTER', 'DRIVER_DNA', d.company_id, 'FUEL',
      'dna_fuel_l_per_100km', NULL, d.driver_id, NULL, 'INFO',
      CASE WHEN d.fuel_measured_only THEN 'MEASURED' ELSE 'DERIVED' END,
      d.fuel_sum / d.fuel_km * 100, d.fuel_count, d.revision);
    IF v_res='REPORTED' THEN v_any := true; END IF;
  END IF;

  IF d.idle_count > 0 AND (d.idle_sum + d.moving_sum) > 0 THEN
    v_res := public._evidence_adapter_record(
      'DRIVER_DNA_ADAPTER', 'DRIVER_DNA', d.company_id, 'DRIVER',
      'dna_idle_ratio', NULL, d.driver_id, NULL, 'INFO', 'MEASURED',
      d.idle_sum / (d.idle_sum + d.moving_sum), d.idle_count, d.revision);
    IF v_res='REPORTED' THEN v_any := true; END IF;
  END IF;

  /* (c) VİRAJ ve AKÜ: kaynak YOK → kanıt ÜRETİLMEZ (bilinçli boşluk). */

  IF v_any THEN RETURN 'REPORTED'; END IF;
  IF v_dedup THEN RETURN 'DEDUPED'; END IF;
  RETURN 'REJECTED';
END;
$fn$;

-- ── 6. FLEET INTELLIGENCE ADAPTÖRÜ ──────────────────────────────────────
--
-- ⚠️ YENİ HESAPLAMA MOTORU KURULMAZ: `fleet_insight_evidence` satırları TEK
-- GERÇEK KAYNAKTIR. Adaptör onları AI Evidence'a taşır ve zinciri kurar.
--
--   · kanıt sayısı < 3 → ACTIVE zincir OLUŞMAZ
--   · `SINGLE_VEHICLE_ONLY` etiketi KORUNUR (ayrı kanıt olarak taşınır)
--   · `BATTERY_TREND` / `MAINTENANCE_TREND` → kaynak YOK, kanıt ÜRETİLMEZ
CREATE OR REPLACE FUNCTION public._evidence_from_insight(p_insight_id uuid)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  i public.fleet_insight%ROWTYPE;
  e record;
  v_res text; v_link text;
  v_id uuid;
  v_any boolean := false; v_dedup boolean := false;
  v_veh uuid; v_drv uuid; v_trip uuid;
BEGIN
  SELECT * INTO i FROM public.fleet_insight WHERE id = p_insight_id;
  IF NOT FOUND THEN RETURN 'REJECTED'; END IF;

  /* KAYNAĞI OLMAYAN TİPLER — 054'teki beyanla birebir aynı. */
  IF i.type IN ('BATTERY_TREND','MAINTENANCE_TREND') THEN
    RETURN 'SKIPPED_NO_SOURCE';
  END IF;

  /* KANIT EŞİĞİ — 3'ten az kanıtla ACTIVE zincir kurulmaz. */
  IF i.evidence_count < 3 THEN RETURN 'SKIPPED_INSUFFICIENT'; END IF;

  FOR e IN SELECT * FROM public.fleet_insight_evidence WHERE insight_id = p_insight_id
  LOOP
    v_veh := NULL; v_drv := NULL; v_trip := NULL;
    BEGIN
      IF e.kind = 'VEHICLE' THEN v_veh := e.ref_id::uuid;
      ELSIF e.kind = 'DRIVER' THEN v_drv := e.ref_id::uuid;
      ELSIF e.kind = 'TRIP' THEN v_trip := e.ref_id::uuid;
      END IF;
    EXCEPTION WHEN invalid_text_representation THEN
      /* METRIC kanıtı: özne yok → insight'ın kendi öznesine bağlanır. */
      NULL;
    END;

    IF v_veh IS NULL AND v_drv IS NULL AND v_trip IS NULL THEN
      /* Öznesiz kanıt ACTIVE olamaz (055 kuralı) → insight'ın öznesini kullan. */
      IF i.subject_kind = 'VEHICLE' THEN v_veh := i.subject_id;
      ELSIF i.subject_kind = 'DRIVER' THEN v_drv := i.subject_id;
      END IF;
    END IF;

    CONTINUE WHEN v_veh IS NULL AND v_drv IS NULL AND v_trip IS NULL;

    v_res := public._evidence_adapter_record(
      'FLEET_INTELLIGENCE_ADAPTER', 'FLEET_INTELLIGENCE', i.company_id,
      'FLEET', i.type || '.' || e.metric,
      v_veh, v_drv, v_trip, 'INFO', e.provenance, e.value,
      greatest(i.evidence_count, 1), i.revision);

    IF v_res = 'REPORTED' THEN v_any := true;
    ELSIF v_res = 'DEDUPED' THEN v_dedup := true; END IF;

    /* ZİNCİR: içgörü ↔ kanıt. Tekrar oynatmada duplicate bağ oluşmaz. */
    SELECT id INTO v_id FROM public.ai_evidence
     WHERE company_id = i.company_id AND source = 'FLEET_INTELLIGENCE'
       AND metric = i.type || '.' || e.metric
       AND subject_revision = i.revision
       AND coalesce(vehicle_id,'00000000-0000-0000-0000-000000000000'::uuid)
           = coalesce(v_veh,'00000000-0000-0000-0000-000000000000'::uuid)
       AND coalesce(driver_id,'00000000-0000-0000-0000-000000000000'::uuid)
           = coalesce(v_drv,'00000000-0000-0000-0000-000000000000'::uuid)
       AND coalesce(trip_id,'00000000-0000-0000-0000-000000000000'::uuid)
           = coalesce(v_trip,'00000000-0000-0000-0000-000000000000'::uuid);

    IF v_id IS NOT NULL THEN
      v_link := public._ai_evidence_link(v_id, 'FLEET_INSIGHT', p_insight_id::text);
    END IF;
  END LOOP;

  /* SINGLE_VEHICLE_ONLY etiketi KORUNUR — filo iddiası olmadığı görünür kalır. */
  IF i.unknown_reason = 'SINGLE_VEHICLE_ONLY' AND i.subject_id IS NOT NULL THEN
    PERFORM public._evidence_adapter_record(
      'FLEET_INTELLIGENCE_ADAPTER', 'FLEET_INTELLIGENCE', i.company_id,
      'FLEET', i.type || '.single_vehicle_only',
      CASE WHEN i.subject_kind='VEHICLE' THEN i.subject_id END,
      CASE WHEN i.subject_kind='DRIVER' THEN i.subject_id END,
      NULL, 'NOTICE', 'DERIVED', 1, greatest(i.evidence_count,1), i.revision);
  END IF;

  IF v_any THEN RETURN 'REPORTED'; END IF;
  IF v_dedup THEN RETURN 'DEDUPED'; END IF;
  RETURN 'REJECTED';
END;
$fn$;

-- ── 7. HATA YALITIMI + TRIGGER'LAR ──────────────────────────────────────
--
-- ⚠️ Adaptör hatası ANA İŞLEMİ BOZMAZ: `EXCEPTION` bloğu alt-işlemi geri
-- alır, ana işlem devam eder. Ama hata **SESSİZCE YUTULMAZ** — durum
-- kaydedilir ve sınırlı yeniden deneme kuyruğa girer.
CREATE OR REPLACE FUNCTION public._evidence_wire_safely(
  p_source text, p_subject_kind text, p_subject_id uuid)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE v_res text; v_err text;
BEGIN
  BEGIN
    IF p_source = 'TRIP_ENGINE' THEN
      v_res := public._evidence_from_trip(p_subject_id);
    ELSIF p_source = 'DRIVER_DNA' THEN
      v_res := public._evidence_from_dna(p_subject_id);
    ELSIF p_source = 'FLEET_INTELLIGENCE' THEN
      v_res := public._evidence_from_insight(p_subject_id);
    ELSE
      RETURN 'FOREIGN_SOURCE';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    /* HATA YALITIMI: ana işlem devam eder; kayıt kuyruğa alınır. */
    v_err := left(coalesce(SQLSTATE,'') || ':' || coalesce(SQLERRM,''), 200);
    INSERT INTO public.ai_evidence_retry
      (source, subject_kind, subject_id, attempts, next_attempt_at, last_error)
    VALUES (p_source, p_subject_kind, p_subject_id, 1,
            now() + interval '2 minutes', v_err)
    ON CONFLICT (source, subject_kind, subject_id) WHERE state='RETRY_PENDING'
    DO UPDATE SET attempts = least(5, public.ai_evidence_retry.attempts + 1),
                  next_attempt_at = now()
                    + (interval '1 minute' * power(2, least(5, public.ai_evidence_retry.attempts + 1))),
                  last_error = v_err,
                  state = CASE WHEN public.ai_evidence_retry.attempts + 1 >= 5
                               THEN 'DEGRADED' ELSE 'RETRY_PENDING' END,
                  updated_at = now();
    PERFORM public._evidence_adapter_state_bump(p_source, 'RETRY_PENDING', v_err);
    RETURN 'RETRY_PENDING';
  END;

  /* Atlanan durumlar da GÖRÜNÜR (sessiz sessizlik yok). */
  PERFORM public._evidence_adapter_state_bump(
    p_source,
    CASE WHEN v_res IN ('REPORTED','DEDUPED','REJECTED','DEGRADED') THEN v_res
         ELSE 'DEGRADED' END,
    CASE WHEN v_res LIKE 'SKIPPED%' THEN v_res ELSE NULL END);
  RETURN v_res;
END;
$fn$;

CREATE OR REPLACE FUNCTION public._evidence_trip_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  IF NEW.ended_at IS NOT NULL THEN
    PERFORM public._evidence_wire_safely('TRIP_ENGINE', 'TRIP', NEW.id);
  END IF;
  RETURN NULL;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_evidence_from_trip ON public.vehicle_trips;
CREATE TRIGGER trg_evidence_from_trip
  AFTER INSERT OR UPDATE OF ended_at, revision, distance_km, fuel_used_l,
                            harsh_brake_count, harsh_accel_count, driver_id
  ON public.vehicle_trips
  FOR EACH ROW EXECUTE FUNCTION public._evidence_trip_trigger();

CREATE OR REPLACE FUNCTION public._evidence_dna_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  PERFORM public._evidence_wire_safely('DRIVER_DNA', 'DNA', NEW.id);
  RETURN NULL;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_evidence_from_dna ON public.driver_dna;
CREATE TRIGGER trg_evidence_from_dna
  AFTER INSERT OR UPDATE OF trip_count, total_distance_km, integrity_state, revision
  ON public.driver_dna
  FOR EACH ROW EXECUTE FUNCTION public._evidence_dna_trigger();

CREATE OR REPLACE FUNCTION public._evidence_insight_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  IF NEW.state = 'ACTIVE' THEN
    PERFORM public._evidence_wire_safely('FLEET_INTELLIGENCE', 'INSIGHT', NEW.id);
  END IF;
  RETURN NULL;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_evidence_from_insight ON public.fleet_insight;
CREATE TRIGGER trg_evidence_from_insight
  AFTER INSERT OR UPDATE OF state, evidence_count, revision
  ON public.fleet_insight
  FOR EACH ROW EXECUTE FUNCTION public._evidence_insight_trigger();

-- ── 8. SINIRLI YENİDEN DENEME KOŞUCUSU ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.run_ai_evidence_retry(p_limit integer DEFAULT 50)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE r record; v_n integer := 0; v_res text;
BEGIN
  FOR r IN SELECT * FROM public.ai_evidence_retry
            WHERE state = 'RETRY_PENDING' AND next_attempt_at <= now()
            ORDER BY next_attempt_at
            LIMIT greatest(1, least(coalesce(p_limit,50), 500))
            FOR UPDATE SKIP LOCKED
  LOOP
    v_res := public._evidence_wire_safely(r.source, r.subject_kind, r.subject_id);
    IF v_res <> 'RETRY_PENDING' THEN
      UPDATE public.ai_evidence_retry SET state='DONE', updated_at=now() WHERE id = r.id;
      v_n := v_n + 1;
    END IF;
  END LOOP;
  RETURN v_n;
END;
$fn$;

-- ── 9. OKUMA RPC'LERİ (Fleet UI · salt-okunur) ──────────────────────────
DROP FUNCTION IF EXISTS public.get_subject_evidence(text, uuid);

/** Bir öznenin (trip/driver/vehicle) kanıtları — salt-okunur kart için. */
CREATE OR REPLACE FUNCTION public.get_subject_evidence(
  p_subject_kind text, p_subject_id uuid)
RETURNS TABLE (
  evidence_id uuid, source text, category text, metric text,
  value numeric, provenance text, confidence text, severity text,
  state text, subject_revision integer, refresh_count integer,
  created_at timestamptz, last_seen_at timestamptz, expires_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
#variable_conflict use_column
DECLARE v_uid uuid := auth.uid(); v_co uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;             -- fail-closed
  SELECT p.company_id INTO v_co FROM public.profiles p WHERE p.id = v_uid;
  IF v_co IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT e.id, e.source, e.category, e.metric, e.value, e.provenance,
         e.confidence, e.severity, e.state, e.subject_revision,
         e.refresh_count, e.created_at, e.last_seen_at, e.expires_at
    FROM public.ai_evidence e
   WHERE e.company_id = v_co                        -- CROSS-TENANT kapalı
     AND ((p_subject_kind = 'TRIP'    AND e.trip_id = p_subject_id)
       OR (p_subject_kind = 'DRIVER'  AND e.driver_id = p_subject_id)
       OR (p_subject_kind = 'VEHICLE' AND e.vehicle_id = p_subject_id))
   ORDER BY e.subject_revision DESC, e.created_at DESC;
END;
$fn$;

DROP FUNCTION IF EXISTS public.get_evidence_adapter_status();

/** Adaptör durumları — CAROS LAB için (ham veri/PII taşımaz). */
CREATE OR REPLACE FUNCTION public.get_evidence_adapter_status()
RETURNS TABLE (
  source text, last_event_at timestamptz, last_result text,
  reported_count integer, deduped_count integer, rejected_count integer,
  degraded_count integer, retry_pending_count integer,
  evidence_count integer, orphan_chain_count integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
#variable_conflict use_column
DECLARE v_uid uuid := auth.uid(); v_co uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;
  SELECT p.company_id INTO v_co FROM public.profiles p WHERE p.id = v_uid;
  IF v_co IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT s.source, s.last_event_at, s.last_result,
         s.reported_count, s.deduped_count, s.rejected_count,
         s.degraded_count, s.retry_pending_count,
         (SELECT count(*)::int FROM public.ai_evidence e
           WHERE e.company_id = v_co AND e.source = s.source),
         /* ÖKSÜZ ZİNCİR: kanıtı artık ACTIVE olmayan bağlar. */
         (SELECT count(*)::int FROM public.ai_evidence_chain c
            JOIN public.ai_evidence e2 ON e2.id = c.evidence_id
           WHERE e2.company_id = v_co AND e2.source = s.source
             AND e2.state <> 'ACTIVE')
    FROM public.ai_evidence_adapter_state s
   ORDER BY s.source;
END;
$fn$;

REVOKE ALL ON FUNCTION public.get_subject_evidence(text,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_evidence_adapter_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_subject_evidence(text,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_evidence_adapter_status() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.run_ai_evidence_retry(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_ai_evidence_retry(integer) TO service_role;
REVOKE ALL ON FUNCTION public._evidence_adapter_record(text,text,uuid,text,text,uuid,uuid,uuid,text,text,numeric,integer,integer,timestamptz,interval)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._evidence_from_trip(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._evidence_from_dna(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._evidence_from_insight(uuid) FROM PUBLIC, anon, authenticated;

-- ── 10. RLS + İZİNLER ───────────────────────────────────────────────────
ALTER TABLE public.ai_evidence_adapter_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_evidence_retry ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ai_evidence_adapter_state FROM anon, PUBLIC;
REVOKE ALL ON TABLE public.ai_evidence_retry FROM anon, PUBLIC;
GRANT SELECT ON TABLE public.ai_evidence_adapter_state TO authenticated;
GRANT ALL ON TABLE public.ai_evidence_adapter_state TO service_role;
GRANT ALL ON TABLE public.ai_evidence_retry TO service_role;

DROP POLICY IF EXISTS aeas_read ON public.ai_evidence_adapter_state;
CREATE POLICY aeas_read ON public.ai_evidence_adapter_state
  FOR SELECT TO authenticated USING (true);   -- şirket-bağımsız SAYAÇ (PII yok)

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- DOĞRULAMA (fail-closed) — fonksiyonlar ÇAĞRILARAK sınanır.
-- ═══════════════════════════════════════════════════════════════════════════

DO $verify$
DECLARE r record; v_def text;
BEGIN
  -- (a) Kaynak eşlemesi ÇAĞRILARAK sınanır
  IF public._evidence_adapter_source('TRIP_METRICS_ADAPTER') <> 'TRIP_ENGINE'
     OR public._evidence_adapter_source('DRIVER_DNA_ADAPTER') <> 'DRIVER_DNA'
     OR public._evidence_adapter_source('FLEET_INTELLIGENCE_ADAPTER') <> 'FLEET_INTELLIGENCE' THEN
    RAISE EXCEPTION '056 HATA: kaynak eslemesi yanlis';
  END IF;
  IF public._evidence_adapter_source('UYDURMA_ADAPTER') IS NOT NULL THEN
    RAISE EXCEPTION '056 HATA: taninmayan adaptore kaynak verildi';
  END IF;
  /* Bu pakette YALNIZ üç kaynak var — deep scan/blackbox KAPSAM DIŞI. */
  IF public._evidence_adapter_source('DEEP_SCAN_ADAPTER') IS NOT NULL
     OR public._evidence_adapter_source('BLACKBOX_ADAPTER') IS NOT NULL THEN
    RAISE EXCEPTION '056 HATA: kapsam disi kaynak baglanmis';
  END IF;

  -- (b) Adaptör tabloları + sınırlı retry
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='aer_attempts_bounded') THEN
    RAISE EXCEPTION '056 HATA: sinirsiz yeniden deneme mumkun';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public'
                  AND indexname='aer_subject_unique') THEN
    RAISE EXCEPTION '056 HATA: kuyruk tekillik kilidi yok';
  END IF;

  -- (c) 055 SÖZLEŞMESİ KORUNDU (genişletildi, bozulmadı)
  IF public._evidence_confidence('SOURCE_UNKNOWN','MEASURED',10) <> 'UNKNOWN'
     OR public._evidence_confidence('BLACKBOX','MEASURED',1) <> 'MEDIUM'
     OR public._evidence_confidence('BLACKBOX','MEASURED',10) <> 'VERY_HIGH' THEN
    RAISE EXCEPTION '056 HATA: guven turetimi DEGISTI';
  END IF;
  FOR r IN SELECT unnest(ARRAY['ae_source_known_when_active','ae_subject_when_active',
                               'ae_confidence_when_active']) AS c
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = r.c) THEN
      RAISE EXCEPTION '056 HATA: 055 fail-closed kisiti kayboldu: %', r.c;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_ai_evidence_immutable'
                   AND NOT tgisinternal) THEN
    RAISE EXCEPTION '056 HATA: degismezlik trigger i kayboldu';
  END IF;

  -- (d) PARALEL MOTOR KURULMADI: adaptör metrik formülü İÇERMEZ
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='_evidence_from_dna';
  IF v_def LIKE '%MECHANICAL_SYMPATHY%' OR v_def LIKE '%AGGRESSIVENESS%'
     OR v_def LIKE '%CONSISTENCY%' THEN
    RAISE EXCEPTION '056 HATA: DNA metrik formulu adaptore kopyalanmis';
  END IF;
  /* Viraj/akü kaynağı yok → adaptör onları ÜRETMEMELİ. */
  IF v_def LIKE '%cornering%' OR v_def LIKE '%battery_care%' THEN
    RAISE EXCEPTION '056 HATA: kaynagi olmayan DNA metrigi uretilmis';
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='_evidence_from_insight';
  IF v_def NOT LIKE '%fleet_insight_evidence%' THEN
    RAISE EXCEPTION '056 HATA: FI adaptoru mevcut kanit satirlarini kullanmiyor';
  END IF;
  IF v_def NOT LIKE '%BATTERY_TREND%' OR v_def NOT LIKE '%SINGLE_VEHICLE_ONLY%' THEN
    RAISE EXCEPTION '056 HATA: FI adaptorunde kaynak/etiket korumasi yok';
  END IF;

  -- (e) MEVCUT KATMANLARA DOKUNULMADI
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='_trip_attribution_trigger';
  IF v_def NOT LIKE '%_resolve_trip_driver%'
     OR v_def NOT LIKE '%_resolve_driver_presence%'
     OR v_def NOT LIKE '%_resolve_driver_authentication%' THEN
    RAISE EXCEPTION '056 HATA: attribution zinciri bozuldu';
  END IF;
  IF v_def LIKE '%ai_evidence%' THEN
    RAISE EXCEPTION '056 HATA: kanit yazimi attribution kararina girmis';
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='_dna_merge_trip';
  IF v_def LIKE '%ai_evidence%' THEN
    RAISE EXCEPTION '056 HATA: DNA birikimi kanit yazimina baglanmis (izolasyon yok)';
  END IF;

  SELECT * INTO r FROM public._resolve_driver_presence(
    gen_random_uuid(), gen_random_uuid(), now() - interval '1 hour', now(), NULL);
  IF r.decision <> 'NO_PRESENCE' THEN
    RAISE EXCEPTION '056 HATA: presence resolver DEGISTI';
  END IF;
  IF public._dna_status(4,500) <> 'NO_DNA'
     OR public._fleet_insight_confidence(50,1,100,50) IN ('HIGH','VERY_HIGH') THEN
    RAISE EXCEPTION '056 HATA: DNA/FI kapilari DEGISTI';
  END IF;

  -- (f) RLS + anon kilidi
  FOR r IN SELECT unnest(ARRAY['ai_evidence_adapter_state','ai_evidence_retry']) AS t
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public'
                    AND tablename=r.t AND rowsecurity) THEN
      RAISE EXCEPTION '056 HATA: %: RLS kapali', r.t;
    END IF;
    IF has_table_privilege('anon', 'public.'||r.t, 'SELECT') THEN
      RAISE EXCEPTION '056 HATA: %: anon okuyabiliyor', r.t;
    END IF;
  END LOOP;
  IF has_function_privilege('anon','public.get_subject_evidence(text,uuid)','EXECUTE') THEN
    RAISE EXCEPTION '056 HATA: anon kanit okuyabiliyor';
  END IF;
  IF has_function_privilege('authenticated','public.run_ai_evidence_retry(integer)','EXECUTE') THEN
    RAISE EXCEPTION '056 HATA: kullanici retry kosucusunu tetikleyebiliyor';
  END IF;

  -- (g) DEFINER + search_path
  FOR r IN SELECT p.proname, pg_get_functiondef(p.oid) AS def
             FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
            WHERE n.nspname='public'
              AND p.proname IN ('_evidence_adapter_record','_evidence_from_trip',
                                '_evidence_from_dna','_evidence_from_insight',
                                '_evidence_wire_safely','run_ai_evidence_retry',
                                'get_subject_evidence','get_evidence_adapter_status')
  LOOP
    IF r.def NOT LIKE '%SECURITY DEFINER%' OR r.def NOT LIKE '%search_path%' THEN
      RAISE EXCEPTION '056 HATA: %: DEFINER/search_path eksik', r.proname;
    END IF;
  END LOOP;

  RAISE NOTICE '056 OK: uc kanonik adaptor (trip/DNA/FI) baglandi · kaynak sahipligi + hata yalitimi + sinirli retry kuruldu · 055 sozlesmesi KORUNDU · paralel motor YOK.';
END
$verify$;
