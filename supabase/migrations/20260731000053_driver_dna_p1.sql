-- ═══════════════════════════════════════════════════════════════════════════
-- 053 — DRIVER DNA (P1)
--
-- YALNIZ İLERİ MIGRATION. 033–052 geçmişi DEĞİŞTİRİLMEZ.
--
-- ── BU BİR PUANLAMA SİSTEMİ DEĞİLDİR ─────────────────────────────────────
-- Tek bir "sürücü puanı" BİLİNÇLİ olarak üretilmez. Amaç, zaman içinde
-- KANITLA oluşan bir sürüş karakteridir: alışkanlıklar, risk profili ve
-- araç üzerindeki etki.
--
-- ── BU MIGRATION AI ÜRETMEZ ──────────────────────────────────────────────
-- Model, tahmin, öneri veya sınıflandırma YOKTUR. Burada yalnız **kanıt
-- birikimi** vardır: yolculuk ölçümleri, kaynağı (`*_source`) korunarak
-- toplanır. Metrik FORMÜLLERİ bilinçli olarak SQL'e KOPYALANMAZ — iki ayrı
-- formül iki ayrı "gerçek" üretirdi. Tek otorite `driverDnaEngine.ts`'tir;
-- bu katman ona SAYILABİLİR KANIT sağlar.
--
-- ── FAIL-CLOSED ──────────────────────────────────────────────────────────
--   · Ölçülmemiş alan (`UNAVAILABLE`/`NULL`) toplama GİRMEZ → `0` sayılmaz.
--     Her birikimin KENDİ sayacı vardır: "hiç ölçülmedi" ile "ölçüldü ve 0"
--     ayrı şeylerdir.
--   · Eşik altında DNA OLUŞMAZ (`NO_DNA`).
--   · Yolculuk sürücüye ATANMAMIŞSA DNA'ya katkı vermez.
--
-- ── MEVCUT KATMANLARA DOKUNULMADI ────────────────────────────────────────
-- `_resolve_trip_driver`, `_resolve_driver_presence`,
-- `_resolve_driver_authentication` ve `_trip_attribution_trigger`
-- **YENİDEN TANIMLANMAZ**. DNA attribution'ın SONUCUNU okur; kararına
-- KARIŞMAZ (doğrulama bölümü bunu kanıtlar).
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. DNA KAYDI (sürücü × şirket) ──────────────────────────────────────
--
-- DNA SÜRÜCÜYE aittir, araca değil: sürücü araç değiştirince karakteri
-- onunla gider. Şirket kimliğin parçasıdır (cross-tenant sızıntı olamaz).
CREATE TABLE IF NOT EXISTS public.driver_dna (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  driver_id     uuid NOT NULL REFERENCES public.fleet_drivers(id) ON DELETE CASCADE,

  trip_count        integer NOT NULL DEFAULT 0,
  total_distance_km numeric(14,3) NOT NULL DEFAULT 0,
  first_trip_at     timestamptz,
  last_trip_at      timestamptz,

  /* ── Birikimler: her sinyalin KENDİ sayacı ve kanıt mesafesi vardır ──
     `*_measured_only` false olur olmaz metrik `DERIVED`'a düşer (en zayıf
     halka) — türetilmiş girdiyi ölçüm gibi sunmak yasaktır. */
  brake_sum numeric(14,3) NOT NULL DEFAULT 0,
  brake_count integer NOT NULL DEFAULT 0,
  brake_km numeric(14,3) NOT NULL DEFAULT 0,
  brake_measured_only boolean NOT NULL DEFAULT true,

  accel_sum numeric(14,3) NOT NULL DEFAULT 0,
  accel_count integer NOT NULL DEFAULT 0,
  accel_km numeric(14,3) NOT NULL DEFAULT 0,
  accel_measured_only boolean NOT NULL DEFAULT true,

  violation_sum numeric(14,3) NOT NULL DEFAULT 0,
  violation_count integer NOT NULL DEFAULT 0,
  violation_km numeric(14,3) NOT NULL DEFAULT 0,

  idle_sum numeric(14,3) NOT NULL DEFAULT 0,
  idle_count integer NOT NULL DEFAULT 0,
  moving_sum numeric(14,3) NOT NULL DEFAULT 0,
  moving_count integer NOT NULL DEFAULT 0,

  avg_speed_sum numeric(14,3) NOT NULL DEFAULT 0,
  avg_speed_count integer NOT NULL DEFAULT 0,

  rpm_sum numeric(14,3) NOT NULL DEFAULT 0,
  rpm_count integer NOT NULL DEFAULT 0,
  temp_sum numeric(14,3) NOT NULL DEFAULT 0,
  temp_count integer NOT NULL DEFAULT 0,

  fuel_sum numeric(14,3) NOT NULL DEFAULT 0,
  fuel_count integer NOT NULL DEFAULT 0,
  fuel_km numeric(14,3) NOT NULL DEFAULT 0,
  fuel_measured_only boolean NOT NULL DEFAULT true,

  /* Tutarlılık ve sapma için olay oranı istatistiği (yolculuk başına). */
  event_rate_sum numeric(14,6) NOT NULL DEFAULT 0,
  event_rate_sq_sum numeric(18,6) NOT NULL DEFAULT 0,
  event_rate_count integer NOT NULL DEFAULT 0,

  /* SAPMA: taban (ilk pencere) ve son pencere ayrı tutulur. */
  baseline_rate_sum numeric(14,6) NOT NULL DEFAULT 0,
  baseline_rate_count integer NOT NULL DEFAULT 0,
  recent_rates numeric(14,6)[] NOT NULL DEFAULT '{}',

  /**
   * BÜTÜNLÜK DURUMU — sürücü değişiminde dürüstlük.
   *
   * Toplanabilir birikimler geri alınabilir; ama bir yolculuk başka sürücüye
   * devredildiğinde geçmiş "en yüksek/ortalama" örneklemi TAM olarak eski
   * hâline döndürülemez. Bunu gizlemek yerine İŞARETLERİZ.
   */
  integrity_state text NOT NULL DEFAULT 'CLEAN',
  retracted_trip_count integer NOT NULL DEFAULT 0,

  revision   integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT dna_integrity_valid
    CHECK (integrity_state IN ('CLEAN','RETRACTED')),
  CONSTRAINT dna_counts_nonneg
    CHECK (trip_count >= 0 AND total_distance_km >= 0 AND retracted_trip_count >= 0)
);

/* Bir sürücünün ŞİRKET İÇİNDE tek DNA'sı olur. */
CREATE UNIQUE INDEX IF NOT EXISTS dna_driver_unique
  ON public.driver_dna (company_id, driver_id);
CREATE INDEX IF NOT EXISTS dna_company_idx ON public.driver_dna (company_id);

-- ── 2. KATKI DEFTERİ (replay kilidi) ────────────────────────────────────
--
-- Bir yolculuk bir DNA'ya YALNIZ BİR KEZ katkı verir. Çevrimdışı kuyruk aynı
-- yolculuğu 10 kez yüklerse DNA 10 kat sapmaz.
CREATE TABLE IF NOT EXISTS public.driver_dna_trip (
  dna_id     uuid NOT NULL REFERENCES public.driver_dna(id) ON DELETE CASCADE,
  trip_id    uuid NOT NULL REFERENCES public.vehicle_trips(id) ON DELETE CASCADE,
  applied_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (dna_id, trip_id)
);

/* Bir yolculuk AYNI ANDA yalnız TEK DNA'ya katkı verebilir: iki sürücünün
   aynı yolculuktan karakter öğrenmesi bir veri hatasıdır. */
CREATE UNIQUE INDEX IF NOT EXISTS dna_trip_single_owner
  ON public.driver_dna_trip (trip_id);

-- ── 3. KANIT UYGULAMA (ekle / geri al) ──────────────────────────────────
--
-- `p_dir` = +1 ekler, -1 geri alır (sürücü değişimi). Ölçülmemiş alanlar
-- HİÇ dokunulmaz — `0` gibi davranmaz.
CREATE OR REPLACE FUNCTION public._dna_apply_trip(
  p_dna_id uuid, p_trip public.vehicle_trips, p_dir integer)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_km    numeric := CASE WHEN p_trip.distance_source IN ('MEASURED','DERIVED')
                          THEN coalesce(p_trip.distance_km, 0) ELSE 0 END;
  v_rate  numeric;
  v_ok    boolean;
BEGIN
  /* Olay oranı: yalnız hem mesafe hem olay ölçülmüşse anlamlıdır. */
  v_ok := v_km > 0 AND (
            coalesce(p_trip.harsh_brake_source,'UNAVAILABLE') IN ('MEASURED','DERIVED')
            OR coalesce(p_trip.harsh_accel_source,'UNAVAILABLE') IN ('MEASURED','DERIVED'));
  v_rate := CASE WHEN v_ok THEN
              ((CASE WHEN coalesce(p_trip.harsh_brake_source,'') IN ('MEASURED','DERIVED')
                     THEN coalesce(p_trip.harsh_brake_count,0) ELSE 0 END)
             + (CASE WHEN coalesce(p_trip.harsh_accel_source,'') IN ('MEASURED','DERIVED')
                     THEN coalesce(p_trip.harsh_accel_count,0) ELSE 0 END)
              ) / v_km * 100
            ELSE NULL END;

  UPDATE public.driver_dna d SET
    trip_count        = d.trip_count + p_dir,
    total_distance_km = greatest(0, d.total_distance_km + p_dir * v_km),

    brake_sum   = CASE WHEN coalesce(p_trip.harsh_brake_source,'') IN ('MEASURED','DERIVED')
                       THEN d.brake_sum + p_dir * coalesce(p_trip.harsh_brake_count,0)
                       ELSE d.brake_sum END,
    brake_count = CASE WHEN coalesce(p_trip.harsh_brake_source,'') IN ('MEASURED','DERIVED')
                       THEN d.brake_count + p_dir ELSE d.brake_count END,
    brake_km    = CASE WHEN coalesce(p_trip.harsh_brake_source,'') IN ('MEASURED','DERIVED')
                       THEN greatest(0, d.brake_km + p_dir * v_km) ELSE d.brake_km END,
    brake_measured_only = d.brake_measured_only
                       AND (p_dir < 0 OR coalesce(p_trip.harsh_brake_source,'MEASURED') <> 'DERIVED'),

    accel_sum   = CASE WHEN coalesce(p_trip.harsh_accel_source,'') IN ('MEASURED','DERIVED')
                       THEN d.accel_sum + p_dir * coalesce(p_trip.harsh_accel_count,0)
                       ELSE d.accel_sum END,
    accel_count = CASE WHEN coalesce(p_trip.harsh_accel_source,'') IN ('MEASURED','DERIVED')
                       THEN d.accel_count + p_dir ELSE d.accel_count END,
    accel_km    = CASE WHEN coalesce(p_trip.harsh_accel_source,'') IN ('MEASURED','DERIVED')
                       THEN greatest(0, d.accel_km + p_dir * v_km) ELSE d.accel_km END,
    accel_measured_only = d.accel_measured_only
                       AND (p_dir < 0 OR coalesce(p_trip.harsh_accel_source,'MEASURED') <> 'DERIVED'),

    violation_sum   = CASE WHEN coalesce(p_trip.speed_violation_source,'') IN ('MEASURED','DERIVED')
                           THEN d.violation_sum + p_dir * coalesce(p_trip.speed_violations,0)
                           ELSE d.violation_sum END,
    violation_count = CASE WHEN coalesce(p_trip.speed_violation_source,'') IN ('MEASURED','DERIVED')
                           THEN d.violation_count + p_dir ELSE d.violation_count END,
    violation_km    = CASE WHEN coalesce(p_trip.speed_violation_source,'') IN ('MEASURED','DERIVED')
                           THEN greatest(0, d.violation_km + p_dir * v_km) ELSE d.violation_km END,

    idle_sum   = CASE WHEN coalesce(p_trip.idle_source,'') IN ('MEASURED','DERIVED')
                      THEN d.idle_sum + p_dir * coalesce(p_trip.idle_time_min,0) ELSE d.idle_sum END,
    idle_count = CASE WHEN coalesce(p_trip.idle_source,'') IN ('MEASURED','DERIVED')
                      THEN d.idle_count + p_dir ELSE d.idle_count END,
    moving_sum   = CASE WHEN coalesce(p_trip.moving_source,'') IN ('MEASURED','DERIVED')
                        THEN d.moving_sum + p_dir * coalesce(p_trip.moving_time_min,0) ELSE d.moving_sum END,
    moving_count = CASE WHEN coalesce(p_trip.moving_source,'') IN ('MEASURED','DERIVED')
                        THEN d.moving_count + p_dir ELSE d.moving_count END,

    avg_speed_sum   = CASE WHEN coalesce(p_trip.avg_speed_source,'') IN ('MEASURED','DERIVED')
                           THEN d.avg_speed_sum + p_dir * coalesce(p_trip.avg_speed_kmh,0)
                           ELSE d.avg_speed_sum END,
    avg_speed_count = CASE WHEN coalesce(p_trip.avg_speed_source,'') IN ('MEASURED','DERIVED')
                           THEN d.avg_speed_count + p_dir ELSE d.avg_speed_count END,

    rpm_sum   = CASE WHEN coalesce(p_trip.max_rpm_source,'') IN ('MEASURED','DERIVED')
                     THEN d.rpm_sum + p_dir * coalesce(p_trip.max_rpm,0) ELSE d.rpm_sum END,
    rpm_count = CASE WHEN coalesce(p_trip.max_rpm_source,'') IN ('MEASURED','DERIVED')
                     THEN d.rpm_count + p_dir ELSE d.rpm_count END,
    temp_sum   = CASE WHEN coalesce(p_trip.max_temp_source,'') IN ('MEASURED','DERIVED')
                      THEN d.temp_sum + p_dir * coalesce(p_trip.max_engine_temp_c,0) ELSE d.temp_sum END,
    temp_count = CASE WHEN coalesce(p_trip.max_temp_source,'') IN ('MEASURED','DERIVED')
                      THEN d.temp_count + p_dir ELSE d.temp_count END,

    fuel_sum   = CASE WHEN p_trip.fuel_source IN ('MEASURED','DERIVED')
                      THEN d.fuel_sum + p_dir * coalesce(p_trip.fuel_used_l,0) ELSE d.fuel_sum END,
    fuel_count = CASE WHEN p_trip.fuel_source IN ('MEASURED','DERIVED')
                      THEN d.fuel_count + p_dir ELSE d.fuel_count END,
    fuel_km    = CASE WHEN p_trip.fuel_source IN ('MEASURED','DERIVED')
                      THEN greatest(0, d.fuel_km + p_dir * v_km) ELSE d.fuel_km END,
    fuel_measured_only = d.fuel_measured_only
                      AND (p_dir < 0 OR p_trip.fuel_source <> 'DERIVED'),

    event_rate_sum    = CASE WHEN v_rate IS NULL THEN d.event_rate_sum
                             ELSE d.event_rate_sum + p_dir * v_rate END,
    event_rate_sq_sum = CASE WHEN v_rate IS NULL THEN d.event_rate_sq_sum
                             ELSE greatest(0, d.event_rate_sq_sum + p_dir * v_rate * v_rate) END,
    event_rate_count  = CASE WHEN v_rate IS NULL THEN d.event_rate_count
                             ELSE d.event_rate_count + p_dir END,

    /* SAPMA pencereleri — yalnız EKLEMEDE güncellenir (geri alma pencereyi
       yeniden kuramaz; bu durum `integrity_state` ile görünür kılınır). */
    baseline_rate_sum   = CASE WHEN p_dir > 0 AND v_rate IS NOT NULL
                                 AND d.baseline_rate_count < 10
                               THEN d.baseline_rate_sum + v_rate ELSE d.baseline_rate_sum END,
    baseline_rate_count = CASE WHEN p_dir > 0 AND v_rate IS NOT NULL
                                 AND d.baseline_rate_count < 10
                               THEN d.baseline_rate_count + 1 ELSE d.baseline_rate_count END,
    recent_rates = CASE WHEN p_dir > 0 AND v_rate IS NOT NULL
                        THEN (array_append(d.recent_rates, v_rate))[
                               greatest(1, array_length(array_append(d.recent_rates, v_rate),1) - 19)
                               : array_length(array_append(d.recent_rates, v_rate),1)]
                        ELSE d.recent_rates END,

    first_trip_at = CASE WHEN p_dir > 0
                         THEN least(coalesce(d.first_trip_at, p_trip.started_at), p_trip.started_at)
                         ELSE d.first_trip_at END,
    last_trip_at  = CASE WHEN p_dir > 0
                         THEN greatest(coalesce(d.last_trip_at, p_trip.started_at), p_trip.started_at)
                         ELSE d.last_trip_at END,

    retracted_trip_count = CASE WHEN p_dir < 0
                                THEN d.retracted_trip_count + 1 ELSE d.retracted_trip_count END,
    integrity_state = CASE WHEN p_dir < 0 THEN 'RETRACTED' ELSE d.integrity_state END,

    revision   = d.revision + 1,
    updated_at = now()
  WHERE d.id = p_dna_id;
END;
$fn$;

-- ── 4. YOLCULUĞU DNA'YA İŞLE ────────────────────────────────────────────
--
-- KAPILAR (hepsi fail-closed):
--   · yolculuk bir sürücüye ATANMIŞ olmalı (`ATTRIBUTED` + `driver_id`)
--   · araç ve sürücü AYNI şirkette olmalı (cross-tenant yasak)
--   · aynı yolculuk ikinci kez katkı VEREMEZ (replay)
CREATE OR REPLACE FUNCTION public._dna_merge_trip(p_trip_id uuid)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  t         public.vehicle_trips%ROWTYPE;
  v_veh_co  uuid;
  v_drv_co  uuid;
  v_dna_id  uuid;
  v_prev    uuid;
BEGIN
  SELECT * INTO t FROM public.vehicle_trips WHERE id = p_trip_id;
  IF NOT FOUND THEN RETURN 'TRIP_NOT_FOUND'; END IF;

  /* Önceki katkı varsa ve sürücü DEĞİŞTİYSE geri al (driver change). */
  SELECT dna_id INTO v_prev FROM public.driver_dna_trip WHERE trip_id = p_trip_id;

  IF t.driver_id IS NULL OR t.driver_attribution_status <> 'ATTRIBUTED' THEN
    IF v_prev IS NOT NULL THEN
      PERFORM public._dna_apply_trip(v_prev, t, -1);
      DELETE FROM public.driver_dna_trip WHERE trip_id = p_trip_id;
      RETURN 'RETRACTED';
    END IF;
    RETURN 'NOT_ATTRIBUTED';
  END IF;

  SELECT company_id INTO v_veh_co FROM public.vehicles WHERE id = t.vehicle_id;
  SELECT company_id INTO v_drv_co FROM public.fleet_drivers WHERE id = t.driver_id;

  /* CROSS-TENANT: araç ve sürücü farklı şirketteyse DNA oluşturulmaz. */
  IF v_veh_co IS NULL OR v_drv_co IS NULL OR v_veh_co IS DISTINCT FROM v_drv_co THEN
    RETURN 'TENANT_MISMATCH';
  END IF;

  SELECT id INTO v_dna_id FROM public.driver_dna
   WHERE company_id = v_veh_co AND driver_id = t.driver_id;

  IF v_dna_id IS NULL THEN
    INSERT INTO public.driver_dna (company_id, driver_id)
    VALUES (v_veh_co, t.driver_id)
    ON CONFLICT (company_id, driver_id) DO UPDATE SET updated_at = now()
    RETURNING id INTO v_dna_id;
  END IF;

  IF v_prev IS NOT NULL AND v_prev = v_dna_id THEN
    RETURN 'ALREADY_APPLIED';            -- ← REPLAY KİLİDİ
  END IF;

  IF v_prev IS NOT NULL THEN
    /* Sürücü DEĞİŞTİ: eski DNA'dan geri al, yenisine ekle. */
    PERFORM public._dna_apply_trip(v_prev, t, -1);
    DELETE FROM public.driver_dna_trip WHERE trip_id = p_trip_id;
  END IF;

  INSERT INTO public.driver_dna_trip (dna_id, trip_id) VALUES (v_dna_id, p_trip_id);
  PERFORM public._dna_apply_trip(v_dna_id, t, 1);
  RETURN CASE WHEN v_prev IS NULL THEN 'MERGED' ELSE 'REASSIGNED' END;
END;
$fn$;

-- ── 5. TRIGGER — attribution SONUCUNU okur, kararına KARIŞMAZ ───────────
CREATE OR REPLACE FUNCTION public._dna_trip_trigger()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  PERFORM public._dna_merge_trip(NEW.id);
  RETURN NULL;   -- AFTER trigger
END;
$fn$;

DROP TRIGGER IF EXISTS trg_driver_dna ON public.vehicle_trips;
CREATE TRIGGER trg_driver_dna
  AFTER INSERT OR UPDATE OF driver_id, driver_attribution_status,
                            distance_km, harsh_brake_count, harsh_accel_count
  ON public.vehicle_trips
  FOR EACH ROW EXECUTE FUNCTION public._dna_trip_trigger();

-- ── 6. DNA OLUŞMA EŞİĞİ (fail-closed kapı) ──────────────────────────────
--
-- ⚠️ Metrik FORMÜLLERİ burada YOK (tek otorite `driverDnaEngine.ts`).
-- Buradaki tek karar, "yeterli kanıt var mı" kapısıdır.
CREATE OR REPLACE FUNCTION public._dna_status(
  p_trip_count integer, p_distance numeric)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $fn$
  SELECT CASE
    WHEN coalesce(p_trip_count,0) < 5 OR coalesce(p_distance,0) < 50 THEN 'NO_DNA'
    WHEN p_trip_count < 100 THEN 'FORMING'
    ELSE 'ACTIVE' END;
$fn$;

CREATE OR REPLACE FUNCTION public._dna_learning_level(p_trip_count integer)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $fn$
  SELECT CASE
    WHEN coalesce(p_trip_count,0) < 1 THEN 'NONE'
    WHEN p_trip_count < 10 THEN 'NASCENT'
    WHEN p_trip_count < 100 THEN 'DEVELOPING'
    WHEN p_trip_count < 1000 THEN 'ESTABLISHED'
    ELSE 'MATURE' END;
$fn$;

-- ── 7. OKUMA RPC'Sİ ─────────────────────────────────────────────────────
--
-- Birikimleri ve kapı sonuçlarını döndürür. **Metrik formülü döndürmez** —
-- tüketici tek otoriteyi (`driverDnaEngine.ts`) kullanır. Sapma yalnız
-- BİLEŞİK olay oranı üzerinden ve kanıt sayılarıyla birlikte raporlanır.
DROP FUNCTION IF EXISTS public.get_driver_dna(uuid);

CREATE OR REPLACE FUNCTION public.get_driver_dna(p_driver_id uuid)
RETURNS TABLE (
  driver_id uuid, company_id uuid,
  status text, learning_level text,
  trip_count integer, total_distance_km numeric,
  first_trip_at timestamptz, last_trip_at timestamptz,
  brake_sum numeric, brake_count integer, brake_km numeric, brake_measured_only boolean,
  accel_sum numeric, accel_count integer, accel_km numeric, accel_measured_only boolean,
  violation_sum numeric, violation_count integer, violation_km numeric,
  idle_sum numeric, idle_count integer, moving_sum numeric, moving_count integer,
  avg_speed_sum numeric, avg_speed_count integer,
  rpm_sum numeric, rpm_count integer, temp_sum numeric, temp_count integer,
  fuel_sum numeric, fuel_count integer, fuel_km numeric, fuel_measured_only boolean,
  event_rate_count integer,
  drift_state text, drift_baseline numeric, drift_recent numeric,
  drift_relative_change numeric,
  integrity_state text, retracted_trip_count integer, revision integer,
  updated_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
#variable_conflict use_column
DECLARE
  v_uid uuid := auth.uid();
  v_co  uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;             -- fail-closed
  SELECT company_id INTO v_co FROM public.profiles WHERE id = v_uid;
  IF v_co IS NULL THEN RETURN; END IF;

  RETURN QUERY
  WITH d AS (
    SELECT * FROM public.driver_dna
     WHERE driver_id = p_driver_id AND company_id = v_co   -- CROSS-TENANT kapalı
  ), w AS (
    SELECT d.*,
           CASE WHEN d.baseline_rate_count > 0
                THEN d.baseline_rate_sum / d.baseline_rate_count END AS base_rate,
           CASE WHEN array_length(d.recent_rates,1) >= 5
                THEN (SELECT avg(x) FROM unnest(d.recent_rates) x) END AS rec_rate
      FROM d
  )
  SELECT w.driver_id, w.company_id,
         public._dna_status(w.trip_count, w.total_distance_km),
         public._dna_learning_level(w.trip_count),
         w.trip_count, w.total_distance_km, w.first_trip_at, w.last_trip_at,
         w.brake_sum, w.brake_count, w.brake_km, w.brake_measured_only,
         w.accel_sum, w.accel_count, w.accel_km, w.accel_measured_only,
         w.violation_sum, w.violation_count, w.violation_km,
         w.idle_sum, w.idle_count, w.moving_sum, w.moving_count,
         w.avg_speed_sum, w.avg_speed_count,
         w.rpm_sum, w.rpm_count, w.temp_sum, w.temp_count,
         w.fuel_sum, w.fuel_count, w.fuel_km, w.fuel_measured_only,
         w.event_rate_count,
         /* SAPMA: iki pencerede de yeterli örnek yoksa KARAR YOK. */
         CASE
           WHEN w.base_rate IS NULL OR w.rec_rate IS NULL
                OR w.baseline_rate_count < 5 THEN 'INSUFFICIENT'
           WHEN abs(w.rec_rate - w.base_rate) / greatest(abs(w.base_rate), 0.000001) >= 0.25
             THEN 'DRIFTING'
           ELSE 'STABLE' END,
         w.base_rate, w.rec_rate,
         CASE WHEN w.base_rate IS NULL OR w.rec_rate IS NULL THEN NULL
              ELSE abs(w.rec_rate - w.base_rate) / greatest(abs(w.base_rate), 0.000001) END,
         w.integrity_state, w.retracted_trip_count, w.revision, w.updated_at
    FROM w;
END;
$fn$;

REVOKE ALL ON FUNCTION public.get_driver_dna(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_driver_dna(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public._dna_apply_trip(uuid, public.vehicle_trips, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._dna_merge_trip(uuid) FROM PUBLIC, anon, authenticated;

-- ── 8. RLS + İZİNLER ────────────────────────────────────────────────────
--
-- `authenticated` DOĞRUDAN YAZAMAZ: DNA'yı yalnız trigger üretir. Elle
-- düzenlenebilen bir karakter kaydı kanıt olmaktan çıkar.
ALTER TABLE public.driver_dna ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_dna_trip ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.driver_dna FROM anon, PUBLIC;
REVOKE ALL ON TABLE public.driver_dna_trip FROM anon, PUBLIC;
GRANT SELECT ON TABLE public.driver_dna TO authenticated;
GRANT ALL    ON TABLE public.driver_dna TO service_role;
GRANT ALL    ON TABLE public.driver_dna_trip TO service_role;

DROP POLICY IF EXISTS dna_company_read ON public.driver_dna;
CREATE POLICY dna_company_read ON public.driver_dna
  FOR SELECT TO authenticated
  USING (company_id = (SELECT p.company_id FROM public.profiles p WHERE p.id = auth.uid()));

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- DOĞRULAMA (fail-closed) — fonksiyonlar ÇAĞRILARAK sınanır.
-- ═══════════════════════════════════════════════════════════════════════════

DO $verify$
DECLARE r record; v_def text;
BEGIN
  -- (a) Tablolar + replay kilidi
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema='public' AND table_name='driver_dna') THEN
    RAISE EXCEPTION '053 HATA: driver_dna tablosu yok';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public'
                  AND indexname='dna_trip_single_owner') THEN
    RAISE EXCEPTION '053 HATA: yolculuk tek-sahip kilidi yok (replay mumkun)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public'
                  AND indexname='dna_driver_unique') THEN
    RAISE EXCEPTION '053 HATA: surucu basina tek DNA kilidi yok';
  END IF;

  -- (b) EŞİK KAPISI çağrılarak sınanır — az kanıtta DNA OLUŞMAZ
  IF public._dna_status(4, 500) <> 'NO_DNA' THEN
    RAISE EXCEPTION '053 HATA: yetersiz yolculukta DNA olustu';
  END IF;
  IF public._dna_status(50, 10) <> 'NO_DNA' THEN
    RAISE EXCEPTION '053 HATA: yetersiz mesafede DNA olustu';
  END IF;
  IF public._dna_status(50, 500) <> 'FORMING'
     OR public._dna_status(500, 5000) <> 'ACTIVE' THEN
    RAISE EXCEPTION '053 HATA: DNA durum kapisi yanlis';
  END IF;

  -- (c) ÖĞRENME seviyeleri
  IF public._dna_learning_level(0) <> 'NONE'
     OR public._dna_learning_level(1) <> 'NASCENT'
     OR public._dna_learning_level(10) <> 'DEVELOPING'
     OR public._dna_learning_level(100) <> 'ESTABLISHED'
     OR public._dna_learning_level(1000) <> 'MATURE' THEN
    RAISE EXCEPTION '053 HATA: ogrenme seviyeleri yanlis';
  END IF;

  -- (d) MEVCUT KATMANLARA DOKUNULMADI
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='_trip_attribution_trigger';
  IF v_def NOT LIKE '%_resolve_trip_driver%'
     OR v_def NOT LIKE '%_resolve_driver_presence%'
     OR v_def NOT LIKE '%_resolve_driver_authentication%' THEN
    RAISE EXCEPTION '053 HATA: attribution zinciri bozuldu';
  END IF;
  /* DNA attribution KARARINA karışmamalı. */
  IF v_def LIKE '%driver_dna%' THEN
    RAISE EXCEPTION '053 HATA: DNA attribution kararina girmis';
  END IF;

  SELECT * INTO r FROM public._resolve_driver_presence(
    gen_random_uuid(), gen_random_uuid(), now() - interval '1 hour', now(), NULL);
  IF r.decision <> 'NO_PRESENCE' THEN
    RAISE EXCEPTION '053 HATA: presence resolver davranisi DEGISTI';
  END IF;
  SELECT * INTO r FROM public._resolve_driver_authentication(
    gen_random_uuid(), gen_random_uuid(), now() - interval '1 hour', now());
  IF r.decision <> 'NO_AUTHENTICATION' THEN
    RAISE EXCEPTION '053 HATA: authentication otoritesi DEGISTI';
  END IF;

  -- (e) METRİK FORMÜLÜ SQL'E KOPYALANMADI (tek otorite TS motorudur)
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='get_driver_dna';
  IF v_def LIKE '%MECHANICAL_SYMPATHY%' OR v_def LIKE '%AGGRESSIVENESS%' THEN
    RAISE EXCEPTION '053 HATA: metrik formulu SQL e kopyalanmis (iki otorite)';
  END IF;

  -- (f) RLS + anon kilidi + doğrudan yazma kapalı
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public'
                  AND tablename='driver_dna' AND rowsecurity) THEN
    RAISE EXCEPTION '053 HATA: driver_dna tablosunda RLS kapali';
  END IF;
  IF has_table_privilege('anon','public.driver_dna','SELECT') THEN
    RAISE EXCEPTION '053 HATA: anon DNA okuyabiliyor';
  END IF;
  IF has_table_privilege('authenticated','public.driver_dna','INSERT')
     OR has_table_privilege('authenticated','public.driver_dna','UPDATE')
     OR has_table_privilege('authenticated','public.driver_dna','DELETE') THEN
    RAISE EXCEPTION '053 HATA: DNA elle degistirilebiliyor';
  END IF;
  IF has_function_privilege('authenticated','public._dna_merge_trip(uuid)','EXECUTE') THEN
    RAISE EXCEPTION '053 HATA: kullanici DNA birikimini elle tetikleyebiliyor';
  END IF;

  -- (g) DEFINER + search_path
  FOR r IN SELECT p.proname, pg_get_functiondef(p.oid) AS def
             FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
            WHERE n.nspname='public'
              AND p.proname IN ('_dna_apply_trip','_dna_merge_trip',
                                '_dna_trip_trigger','get_driver_dna')
  LOOP
    IF r.def NOT LIKE '%SECURITY DEFINER%' OR r.def NOT LIKE '%search_path%' THEN
      RAISE EXCEPTION '053 HATA: %: DEFINER/search_path eksik', r.proname;
    END IF;
  END LOOP;

  RAISE NOTICE '053 OK: DNA kanit birikimi + replay kilidi + surucu degisimi geri alma + esik kapisi kuruldu · attribution zinciri DEGISMEDI · metrik formulu SQL e kopyalanmadi.';
END
$verify$;
