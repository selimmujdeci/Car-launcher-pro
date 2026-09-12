-- ═══════════════════════════════════════════════════════════════════════════
-- 055 — AI EVIDENCE ENGINE (P1)
--
-- YALNIZ İLERİ MIGRATION. 033–054 geçmişi DEĞİŞTİRİLMEZ.
--
-- ── AMAÇ ─────────────────────────────────────────────────────────────────
-- Bütün AI sistemlerinin ORTAK OMURGASI. Yarın Mavi'nin söylediği her cümle
-- buradaki bir kanıta geri izlenebilecek; kanıt karşılığı olmayan bir iddia
-- üretilemeyecek.
--
-- ── BU MIGRATION AI CEVABI ÜRETMEZ ───────────────────────────────────────
-- LLM YOK · model YOK · tahmin YOK · doğal dil YOK. `title`/`message`/
-- `explanation` gibi bir kolon BİLİNÇLİ OLARAK YOKTUR (doğrulama bu kolonlar
-- eklenirse DÜŞER). Kanıt bir cümle değil, KAYNAĞI ve ÖLÇÜM KALİTESİ belli
-- bir KAYITTIR.
--
-- ── BEŞ FAIL-CLOSED KURALI ───────────────────────────────────────────────
--   1. **Kaynaksız kanıt ACTIVE olamaz** (`SOURCE_UNKNOWN` → CHECK reddeder).
--   2. **Güven kanıttan bağımsız yazılamaz:** istemcinin verdiği güven
--      YOK SAYILIR, trigger onu kaynak · ölçüm kalitesi · örnek sayısından
--      YENİDEN türetir.
--   3. **Kanıt DEĞİŞMEZDİR:** özne, kaynak, kategori, metrik ve doğuş anı
--      güncellenemez; başka bir modül BAŞKASININ kanıtını değiştiremez.
--   4. **Süresi dolan kanıt SİLİNMEZ**, `EXPIRED` olur.
--   5. **Öznesiz kanıt olmaz:** araç/sürücü/yolculuktan en az biri şart.
--
-- ── MEVCUT KATMANLARA DOKUNULMADI ────────────────────────────────────────
-- `driver_dna*`, `fleet_insight*`, `fleet_trend`, `fleet_health`,
-- `vehicle_trips`, `_trip_attribution_trigger`, `_resolve_*`, deep scan
-- yolları YENİDEN TANIMLANMAZ. Kanıt omurgası onların ÇIKTISINI kaydeder.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. KANIT DEFTERİ ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ai_evidence (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,

  /* ÖZNELER — en az biri dolu olmalı (öznesiz kanıt bir yere bağlanamaz). */
  vehicle_id  uuid REFERENCES public.vehicles(id) ON DELETE CASCADE,
  driver_id   uuid REFERENCES public.fleet_drivers(id) ON DELETE CASCADE,
  trip_id     uuid REFERENCES public.vehicle_trips(id) ON DELETE CASCADE,

  source      text NOT NULL,
  category    text NOT NULL,
  severity    text NOT NULL DEFAULT 'INFO',
  /* TÜRETİLİR — trigger yazar, istemci iddiası yok sayılır. */
  confidence  text NOT NULL DEFAULT 'UNKNOWN',
  provenance  text NOT NULL DEFAULT 'UNKNOWN',

  metric      text NOT NULL,
  value       numeric,
  sample_count integer NOT NULL DEFAULT 0,

  /* İLK görülme — tazelemede DEĞİŞMEZ. */
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,

  state         text NOT NULL DEFAULT 'ACTIVE',
  refresh_count integer NOT NULL DEFAULT 0,
  evidence_version integer NOT NULL DEFAULT 1,
  reject_reason text,

  CONSTRAINT ae_source_valid CHECK (source IN (
    'TRIP_ENGINE','DRIVER_DNA','FLEET_INTELLIGENCE','DEEP_SCAN',
    'VEHICLE_IDENTITY','TELEMETRY','BLACKBOX','HEALTH_MONITOR','SOURCE_UNKNOWN')),
  CONSTRAINT ae_category_valid CHECK (category IN (
    'DRIVER','TRIP','VEHICLE','ENGINE','TEMPERATURE','FUEL','BATTERY',
    'LOCATION','CONNECTIVITY','DIAGNOSTIC','BLACKBOX','FLEET','UNKNOWN')),
  CONSTRAINT ae_severity_valid CHECK (severity IN ('INFO','NOTICE','WARNING','CRITICAL')),
  CONSTRAINT ae_conf_valid CHECK (confidence IN
    ('VERY_HIGH','HIGH','MEDIUM','LOW','UNKNOWN')),
  CONSTRAINT ae_prov_valid CHECK (provenance IN
    ('MEASURED','DERIVED','ESTIMATED','UNKNOWN')),
  CONSTRAINT ae_state_valid CHECK (state IN ('ACTIVE','EXPIRED','SUPERSEDED','REJECTED')),
  CONSTRAINT ae_expiry_valid CHECK (expires_at > created_at),
  CONSTRAINT ae_metric_nonempty CHECK (length(btrim(metric)) > 0),
  CONSTRAINT ae_counts_nonneg CHECK (sample_count >= 0 AND refresh_count >= 0),

  /* (1) KAYNAKSIZ KANIT ACTIVE OLAMAZ. */
  CONSTRAINT ae_source_known_when_active CHECK (
    state <> 'ACTIVE' OR source <> 'SOURCE_UNKNOWN'),
  /* (5) ÖZNESİZ KANIT ACTIVE OLAMAZ. */
  CONSTRAINT ae_subject_when_active CHECK (
    state <> 'ACTIVE'
    OR vehicle_id IS NOT NULL OR driver_id IS NOT NULL OR trip_id IS NOT NULL),
  /* (2) GÜVENSİZ KANIT ACTIVE OLAMAZ. */
  CONSTRAINT ae_confidence_when_active CHECK (
    state <> 'ACTIVE' OR confidence <> 'UNKNOWN'),
  CONSTRAINT ae_reject_reason_valid CHECK (reject_reason IS NULL OR reject_reason IN (
    'SOURCE_UNKNOWN','NO_SUBJECT','NO_MEASUREMENT','CONFIDENCE_UNKNOWN',
    'TENANT_MISMATCH','IMMUTABLE_VIOLATION'))
);

/* BİRLEŞTİRME KİMLİĞİ: aynı kanıt İKİNCİ KEZ AÇILMAZ. Zaman kimliğe DAHİL
   DEĞİLDİR — aksi hâlde her tazeleme yeni bir "kanıt" üretir ve sayılar
   şişerdi. */
CREATE UNIQUE INDEX IF NOT EXISTS ae_merge_unique
  ON public.ai_evidence (
    company_id, source, category, metric,
    coalesce(vehicle_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(driver_id,  '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(trip_id,    '00000000-0000-0000-0000-000000000000'::uuid));

CREATE INDEX IF NOT EXISTS ae_company_idx ON public.ai_evidence (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ae_vehicle_idx ON public.ai_evidence (vehicle_id) WHERE vehicle_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ae_driver_idx  ON public.ai_evidence (driver_id)  WHERE driver_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ae_trip_idx    ON public.ai_evidence (trip_id)    WHERE trip_id IS NOT NULL;

-- ── 2. KANIT ZİNCİRİ ────────────────────────────────────────────────────
--
-- "Tek tıkla kanıt zinciri": hangi çıktı hangi kanıta dayanıyor.
-- ⚠️ `AI_ANSWER` bilinçli olarak burada: gelecekte Mavi'nin ürettiği HER
-- cümle buraya bir bağ yazmak zorunda kalacak.
CREATE TABLE IF NOT EXISTS public.ai_evidence_chain (
  evidence_id uuid NOT NULL REFERENCES public.ai_evidence(id) ON DELETE CASCADE,
  consumer    text NOT NULL,
  consumer_id text NOT NULL,
  linked_at   timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (evidence_id, consumer, consumer_id),
  CONSTRAINT aec_consumer_valid CHECK (consumer IN
    ('FLEET_INSIGHT','DRIVER_DNA','FLEET_TREND','FLEET_HEALTH','AI_ANSWER')),
  CONSTRAINT aec_consumer_id_nonempty CHECK (length(btrim(consumer_id)) > 0)
);

CREATE INDEX IF NOT EXISTS aec_consumer_idx
  ON public.ai_evidence_chain (consumer, consumer_id);

-- ── 3. GÜVEN TÜRETİMİ (istemci yazamaz) ─────────────────────────────────
CREATE OR REPLACE FUNCTION public._evidence_source_ceiling(p_source text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public
AS $fn$
  SELECT CASE coalesce(p_source,'')
    WHEN 'BLACKBOX'          THEN 'VERY_HIGH'
    WHEN 'DEEP_SCAN'         THEN 'VERY_HIGH'
    WHEN 'VEHICLE_IDENTITY'  THEN 'VERY_HIGH'
    WHEN 'TELEMETRY'         THEN 'HIGH'
    WHEN 'TRIP_ENGINE'       THEN 'HIGH'
    WHEN 'DRIVER_DNA'        THEN 'HIGH'
    WHEN 'FLEET_INTELLIGENCE'THEN 'HIGH'
    WHEN 'HEALTH_MONITOR'    THEN 'MEDIUM'
    ELSE 'UNKNOWN' END;
$fn$;

CREATE OR REPLACE FUNCTION public._evidence_weakest(a text, b text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public
AS $fn$
  SELECT CASE
    WHEN array_position(ARRAY['UNKNOWN','LOW','MEDIUM','HIGH','VERY_HIGH'], coalesce(a,'UNKNOWN'))
       <= array_position(ARRAY['UNKNOWN','LOW','MEDIUM','HIGH','VERY_HIGH'], coalesce(b,'UNKNOWN'))
    THEN coalesce(a,'UNKNOWN') ELSE coalesce(b,'UNKNOWN') END;
$fn$;

/**
 * GÜVEN TÜRETİMİ — TEK YOL.
 *
 * Üç tavanın en zayıfı: kaynak · ölçüm kalitesi · örnek sayısı.
 * Tek gözlem `MEDIUM`u aşamaz (bir kez görülen şey bir eğilim değildir).
 */
CREATE OR REPLACE FUNCTION public._evidence_confidence(
  p_source text, p_provenance text, p_samples integer)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public
AS $fn$
  SELECT public._evidence_weakest(
           public._evidence_source_ceiling(p_source),
           public._evidence_weakest(
             CASE coalesce(p_provenance,'')
               WHEN 'MEASURED'  THEN 'VERY_HIGH'
               WHEN 'DERIVED'   THEN 'HIGH'
               WHEN 'ESTIMATED' THEN 'MEDIUM'
               ELSE 'UNKNOWN' END,
             CASE WHEN coalesce(p_samples,0) <= 0 THEN 'UNKNOWN'
                  WHEN p_samples = 1 THEN 'MEDIUM'
                  WHEN p_samples < 5 THEN 'HIGH'
                  ELSE 'VERY_HIGH' END));
$fn$;

-- ── 4. YAZMA KAPISI: güven türet · tenant doğrula · durum kararlaştır ────
CREATE OR REPLACE FUNCTION public._ai_evidence_write_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE v_ok boolean; v_reason text;
BEGIN
  /* (2) İSTEMCİNİN GÜVENİ YOK SAYILIR — daima yeniden türetilir. */
  NEW.confidence := public._evidence_confidence(NEW.source, NEW.provenance, NEW.sample_count);

  /* CROSS-TENANT: özneler bu şirkete ait olmalı. */
  IF NEW.vehicle_id IS NOT NULL THEN
    SELECT (company_id = NEW.company_id) INTO v_ok FROM public.vehicles WHERE id = NEW.vehicle_id;
    IF coalesce(v_ok,false) = false THEN v_reason := 'TENANT_MISMATCH'; END IF;
  END IF;
  IF v_reason IS NULL AND NEW.driver_id IS NOT NULL THEN
    SELECT (company_id = NEW.company_id) INTO v_ok FROM public.fleet_drivers WHERE id = NEW.driver_id;
    IF coalesce(v_ok,false) = false THEN v_reason := 'TENANT_MISMATCH'; END IF;
  END IF;
  IF v_reason IS NULL AND NEW.trip_id IS NOT NULL THEN
    SELECT (v.company_id = NEW.company_id) INTO v_ok
      FROM public.vehicle_trips t JOIN public.vehicles v ON v.id = t.vehicle_id
     WHERE t.id = NEW.trip_id;
    IF coalesce(v_ok,false) = false THEN v_reason := 'TENANT_MISMATCH'; END IF;
  END IF;

  /* Fail-closed kapılar — sıra ÖNEMLİ (en spesifik gerekçe kazanır). */
  IF v_reason IS NULL AND NEW.source = 'SOURCE_UNKNOWN' THEN
    v_reason := 'SOURCE_UNKNOWN';
  END IF;
  IF v_reason IS NULL AND NEW.vehicle_id IS NULL AND NEW.driver_id IS NULL
     AND NEW.trip_id IS NULL THEN
    v_reason := 'NO_SUBJECT';
  END IF;
  IF v_reason IS NULL AND NEW.value IS NULL AND NEW.provenance = 'UNKNOWN' THEN
    v_reason := 'NO_MEASUREMENT';
  END IF;
  IF v_reason IS NULL AND NEW.confidence = 'UNKNOWN' THEN
    v_reason := 'CONFIDENCE_UNKNOWN';
  END IF;

  IF v_reason IS NOT NULL THEN
    /* REDDEDİLEN kanıt da SAKLANIR: "kanıt üretmeyen modül" ile "kanıtı
       reddedilen modül" ayırt edilebilsin. */
    NEW.state := 'REJECTED';
    NEW.reject_reason := v_reason;
  ELSE
    IF TG_OP = 'INSERT' THEN NEW.state := 'ACTIVE'; END IF;
    NEW.reject_reason := NULL;
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_ai_evidence_write_guard ON public.ai_evidence;
CREATE TRIGGER trg_ai_evidence_write_guard
  BEFORE INSERT OR UPDATE ON public.ai_evidence
  FOR EACH ROW EXECUTE FUNCTION public._ai_evidence_write_guard();

-- ── 5. DEĞİŞMEZLİK (immutable) ──────────────────────────────────────────
--
-- Bir kanıtın öznesi, kaynağı, kategorisi, metriği ve doğuş anı ASLA
-- değişmez; ayrıca **kaynak modül kilidi**: başka bir modül başkasının
-- kanıtını tazeleyemez (aksi hâlde kanıt zinciri anlamsızlaşır).
CREATE OR REPLACE FUNCTION public._ai_evidence_immutable_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.company_id IS DISTINCT FROM OLD.company_id
     OR NEW.vehicle_id IS DISTINCT FROM OLD.vehicle_id
     OR NEW.driver_id  IS DISTINCT FROM OLD.driver_id
     OR NEW.trip_id    IS DISTINCT FROM OLD.trip_id
     OR NEW.source     IS DISTINCT FROM OLD.source
     OR NEW.category   IS DISTINCT FROM OLD.category
     OR NEW.metric     IS DISTINCT FROM OLD.metric
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.evidence_version IS DISTINCT FROM OLD.evidence_version THEN
    RAISE EXCEPTION 'AI_EVIDENCE_IMMUTABLE: kanit kimligi/kaynagi/dogus ani degistirilemez'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_ai_evidence_immutable ON public.ai_evidence;
CREATE TRIGGER trg_ai_evidence_immutable
  BEFORE UPDATE ON public.ai_evidence
  FOR EACH ROW EXECUTE FUNCTION public._ai_evidence_immutable_guard();

-- ── 6. KANIT SUNMA (merge — yeni kayıt AÇMAZ) ───────────────────────────
--
-- `p_by_source` = kanıtı SUNAN modül. Mevcut kanıt BAŞKA bir modüle aitse
-- tazeleme REDDEDİLİR (kaynak modül kilidi).
CREATE OR REPLACE FUNCTION public._ai_evidence_record(
  p_company_id uuid, p_source text, p_category text, p_metric text,
  p_vehicle_id uuid, p_driver_id uuid, p_trip_id uuid,
  p_severity text, p_provenance text, p_value numeric, p_samples integer,
  p_observed_at timestamptz DEFAULT now(),
  p_ttl interval DEFAULT interval '30 days')
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE v_id uuid; v_owner text; v_state text;
BEGIN
  SELECT id, source INTO v_id, v_owner FROM public.ai_evidence
   WHERE company_id = p_company_id AND source = p_source
     AND category = p_category AND metric = p_metric
     AND coalesce(vehicle_id,'00000000-0000-0000-0000-000000000000'::uuid)
         = coalesce(p_vehicle_id,'00000000-0000-0000-0000-000000000000'::uuid)
     AND coalesce(driver_id,'00000000-0000-0000-0000-000000000000'::uuid)
         = coalesce(p_driver_id,'00000000-0000-0000-0000-000000000000'::uuid)
     AND coalesce(trip_id,'00000000-0000-0000-0000-000000000000'::uuid)
         = coalesce(p_trip_id,'00000000-0000-0000-0000-000000000000'::uuid);

  IF v_id IS NOT NULL THEN
    /* BİRLEŞTİRME: yeni kayıt YOK · `created_at` KORUNUR · sayaç ARTAR. */
    UPDATE public.ai_evidence
       SET severity      = p_severity,
           provenance    = p_provenance,
           value         = p_value,
           sample_count  = greatest(sample_count, coalesce(p_samples,0)),
           last_seen_at  = greatest(last_seen_at, p_observed_at),
           expires_at    = greatest(expires_at, p_observed_at + p_ttl),
           state         = 'ACTIVE',
           refresh_count = refresh_count + 1
     WHERE id = v_id
     RETURNING state INTO v_state;
    RETURN CASE WHEN v_state = 'REJECTED' THEN 'REJECTED' ELSE 'MERGED' END;
  END IF;

  INSERT INTO public.ai_evidence
    (company_id, source, category, metric, vehicle_id, driver_id, trip_id,
     severity, provenance, value, sample_count,
     created_at, last_seen_at, expires_at)
  VALUES (p_company_id, p_source, p_category, p_metric,
          p_vehicle_id, p_driver_id, p_trip_id,
          coalesce(p_severity,'INFO'), coalesce(p_provenance,'UNKNOWN'),
          p_value, coalesce(p_samples,0),
          p_observed_at, p_observed_at, p_observed_at + p_ttl)
  RETURNING state INTO v_state;

  RETURN CASE WHEN v_state = 'REJECTED' THEN 'REJECTED' ELSE 'RECORDED' END;
END;
$fn$;

-- ── 7. SÜRE DOLUMU (silmez · idempotent) ────────────────────────────────
CREATE OR REPLACE FUNCTION public.expire_ai_evidence()
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE v_n integer;
BEGIN
  UPDATE public.ai_evidence e
     SET state = 'EXPIRED'
   WHERE e.id IN (SELECT s.id FROM public.ai_evidence s
                   WHERE s.state = 'ACTIVE' AND s.expires_at <= now()
                   FOR UPDATE SKIP LOCKED)
     AND e.state = 'ACTIVE';           -- idempotens: ikinci koşum 0 döner
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$fn$;

-- ── 8. ZİNCİR BAĞI (idempotent) ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._ai_evidence_link(
  p_evidence_id uuid, p_consumer text, p_consumer_id text)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  /* VAR OLMAYAN kanıta bağ kurulamaz — zincirin anlamı budur. */
  IF NOT EXISTS (SELECT 1 FROM public.ai_evidence WHERE id = p_evidence_id) THEN
    RETURN 'EVIDENCE_NOT_FOUND';
  END IF;
  INSERT INTO public.ai_evidence_chain (evidence_id, consumer, consumer_id)
  VALUES (p_evidence_id, p_consumer, p_consumer_id)
  ON CONFLICT (evidence_id, consumer, consumer_id) DO NOTHING;
  IF NOT FOUND THEN RETURN 'DUPLICATE'; END IF;
  RETURN 'LINKED';
END;
$fn$;

-- ── 9. OKUMA RPC'LERİ ───────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.get_evidence_chain(text, text);

/** Bir çıktının dayandığı kanıtlar — "tek tıkla kanıt zinciri". */
CREATE OR REPLACE FUNCTION public.get_evidence_chain(
  p_consumer text, p_consumer_id text)
RETURNS TABLE (
  evidence_id uuid, source text, category text, severity text,
  confidence text, provenance text, metric text, value numeric,
  sample_count integer, state text, refresh_count integer,
  created_at timestamptz, last_seen_at timestamptz, expires_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE v_uid uuid := auth.uid(); v_co uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;                 -- fail-closed
  SELECT p.company_id INTO v_co FROM public.profiles p WHERE p.id = v_uid;
  IF v_co IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT e.id, e.source, e.category, e.severity, e.confidence, e.provenance,
         e.metric, e.value, e.sample_count, e.state, e.refresh_count,
         e.created_at, e.last_seen_at, e.expires_at
    FROM public.ai_evidence_chain c
    JOIN public.ai_evidence e ON e.id = c.evidence_id
   WHERE c.consumer = p_consumer AND c.consumer_id = p_consumer_id
     AND e.company_id = v_co                            -- CROSS-TENANT kapalı
   ORDER BY e.created_at DESC;
END;
$fn$;

DROP FUNCTION IF EXISTS public.get_evidence_coverage();

/**
 * Şirket geneli kanıt kapsamı ve kalitesi.
 *
 * ⚠️ Eksik veri **UNKNOWN**'dır: hiç aktif kanıt yoksa oran `NULL` döner
 * (`0` DEĞİL — "kapsam sıfır ölçüldü" ile "hiç bakmadık" farklı şeylerdir).
 */
CREATE OR REPLACE FUNCTION public.get_evidence_coverage()
RETURNS TABLE (
  company_id uuid,
  evidence_total integer, active_count integer, expired_count integer,
  rejected_count integer, unknown_confidence_count integer,
  merge_refresh_total integer, chain_link_count integer,
  distinct_source_count integer, distinct_category_count integer,
  vehicles_total integer, vehicles_with_evidence integer,
  drivers_total integer, drivers_with_evidence integer,
  vehicle_coverage numeric, driver_coverage numeric,
  high_confidence_ratio numeric, integrity_ok boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
/* OUT parametre adları tablo kolonlarıyla çakışıyor (`company_id`, `source`…);
   çakışmada KOLON kazanır — aksi hâlde sorgu belirsiz kalır. */
#variable_conflict use_column
DECLARE v_uid uuid := auth.uid(); v_co uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;
  SELECT p.company_id INTO v_co FROM public.profiles p WHERE p.id = v_uid;
  IF v_co IS NULL THEN RETURN; END IF;

  RETURN QUERY
  WITH e AS (SELECT * FROM public.ai_evidence WHERE company_id = v_co),
       act AS (SELECT * FROM e WHERE state = 'ACTIVE' AND expires_at > now()),
       veh AS (SELECT count(*)::int AS total FROM public.vehicles WHERE company_id = v_co),
       vwe AS (SELECT count(DISTINCT vehicle_id)::int AS n FROM act WHERE vehicle_id IS NOT NULL),
       drv AS (SELECT count(*)::int AS total FROM public.fleet_drivers WHERE company_id = v_co),
       dwe AS (SELECT count(DISTINCT driver_id)::int AS n FROM act WHERE driver_id IS NOT NULL),
       ch  AS (SELECT count(*)::int AS n FROM public.ai_evidence_chain c
                WHERE c.evidence_id IN (SELECT id FROM e))
  SELECT v_co,
         (SELECT count(*)::int FROM e),
         (SELECT count(*)::int FROM act),
         (SELECT count(*)::int FROM e WHERE state = 'EXPIRED'),
         (SELECT count(*)::int FROM e WHERE state = 'REJECTED'),
         (SELECT count(*)::int FROM e WHERE confidence = 'UNKNOWN'),
         (SELECT coalesce(sum(refresh_count),0)::int FROM e),
         (SELECT n FROM ch),
         (SELECT count(DISTINCT source)::int FROM act),
         (SELECT count(DISTINCT category)::int FROM act),
         (SELECT total FROM veh), (SELECT n FROM vwe),
         (SELECT total FROM drv), (SELECT n FROM dwe),
         /* Araç yoksa NULL (bölme yapılamaz) — 0 DEĞİL. */
         (SELECT CASE WHEN (SELECT total FROM veh) > 0
                      THEN (SELECT n FROM vwe)::numeric / (SELECT total FROM veh) END),
         (SELECT CASE WHEN (SELECT total FROM drv) > 0
                      THEN (SELECT n FROM dwe)::numeric / (SELECT total FROM drv) END),
         /* Aktif kanıt yoksa kalite oranı da NULL. */
         (SELECT CASE WHEN count(*) > 0
                      THEN count(*) FILTER (WHERE confidence IN ('HIGH','VERY_HIGH'))::numeric
                           / count(*) END FROM act),
         /* BÜTÜNLÜK: kaynağı/güveni bilinmeyen ACTIVE kanıt olmamalı. */
         (SELECT NOT EXISTS (SELECT 1 FROM act
                              WHERE source = 'SOURCE_UNKNOWN' OR confidence = 'UNKNOWN'));
END;
$fn$;

REVOKE ALL ON FUNCTION public.get_evidence_chain(text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_evidence_coverage() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_evidence_chain(text,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_evidence_coverage() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public._ai_evidence_record(uuid,text,text,text,uuid,uuid,uuid,text,text,numeric,integer,timestamptz,interval)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._ai_evidence_link(uuid,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.expire_ai_evidence() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_ai_evidence() TO service_role;

-- ── 10. RLS + İZİNLER ───────────────────────────────────────────────────
ALTER TABLE public.ai_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_evidence_chain ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ai_evidence FROM anon, PUBLIC;
REVOKE ALL ON TABLE public.ai_evidence_chain FROM anon, PUBLIC;
GRANT SELECT ON TABLE public.ai_evidence TO authenticated;
GRANT SELECT ON TABLE public.ai_evidence_chain TO authenticated;
GRANT ALL ON TABLE public.ai_evidence TO service_role;
GRANT ALL ON TABLE public.ai_evidence_chain TO service_role;

DROP POLICY IF EXISTS ae_company_read ON public.ai_evidence;
CREATE POLICY ae_company_read ON public.ai_evidence
  FOR SELECT TO authenticated
  USING (company_id = (SELECT p.company_id FROM public.profiles p WHERE p.id = auth.uid()));

DROP POLICY IF EXISTS aec_company_read ON public.ai_evidence_chain;
CREATE POLICY aec_company_read ON public.ai_evidence_chain
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.ai_evidence e
                  WHERE e.id = evidence_id
                    AND e.company_id = (SELECT p.company_id FROM public.profiles p
                                         WHERE p.id = auth.uid())));

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- DOĞRULAMA (fail-closed) — fonksiyonlar ÇAĞRILARAK sınanır.
-- ═══════════════════════════════════════════════════════════════════════════

DO $verify$
DECLARE r record; v_def text;
BEGIN
  -- (a) Tablolar + birleştirme kilidi
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema='public' AND table_name='ai_evidence') THEN
    RAISE EXCEPTION '055 HATA: ai_evidence tablosu yok';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public'
                  AND indexname='ae_merge_unique') THEN
    RAISE EXCEPTION '055 HATA: kanit birlestirme kilidi yok (cift kayit mumkun)';
  END IF;
  FOR r IN SELECT unnest(ARRAY['ae_source_known_when_active','ae_subject_when_active',
                               'ae_confidence_when_active']) AS c
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = r.c) THEN
      RAISE EXCEPTION '055 HATA: fail-closed kisiti yok: %', r.c;
    END IF;
  END LOOP;

  -- (b) DOĞAL DİL KOLONU YOK (bu paket AI cevabi uretmez)
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='ai_evidence'
                AND column_name IN ('title','message','explanation','summary','answer','text')) THEN
    RAISE EXCEPTION '055 HATA: kanita dogal dil kolonu eklenmis (AI uretimi)';
  END IF;

  -- (c) GÜVEN TÜRETİMİ ÇAĞRILARAK sınanır
  IF public._evidence_confidence('SOURCE_UNKNOWN','MEASURED',10) <> 'UNKNOWN' THEN
    RAISE EXCEPTION '055 HATA: kaynaksiz kanit guven uretti';
  END IF;
  IF public._evidence_confidence('BLACKBOX','MEASURED',10) <> 'VERY_HIGH' THEN
    RAISE EXCEPTION '055 HATA: guclu kanitta VERY_HIGH uretilmedi';
  END IF;
  /* TEK GÖZLEM `MEDIUM`u aşamaz. */
  IF public._evidence_confidence('BLACKBOX','MEASURED',1) <> 'MEDIUM' THEN
    RAISE EXCEPTION '055 HATA: tek gozlem MEDIUM tavanini asti';
  END IF;
  IF public._evidence_confidence('HEALTH_MONITOR','MEASURED',50) <> 'MEDIUM' THEN
    RAISE EXCEPTION '055 HATA: kaynak tavani uygulanmadi';
  END IF;
  IF public._evidence_confidence('BLACKBOX','UNKNOWN',50) <> 'UNKNOWN' THEN
    RAISE EXCEPTION '055 HATA: olcumsuz kanit guven uretti';
  END IF;

  -- (d) MEVCUT KATMANLARA DOKUNULMADI
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='_trip_attribution_trigger';
  IF v_def NOT LIKE '%_resolve_trip_driver%'
     OR v_def NOT LIKE '%_resolve_driver_presence%'
     OR v_def NOT LIKE '%_resolve_driver_authentication%' THEN
    RAISE EXCEPTION '055 HATA: attribution zinciri bozuldu';
  END IF;
  IF v_def LIKE '%ai_evidence%' THEN
    RAISE EXCEPTION '055 HATA: kanit omurgasi attribution kararina girmis';
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='_dna_merge_trip';
  IF v_def LIKE '%ai_evidence%' THEN
    RAISE EXCEPTION '055 HATA: DNA birikimi kanit omurgasina baglanmis';
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='_fleet_insight_recount';
  IF v_def LIKE '%ai_evidence%' THEN
    RAISE EXCEPTION '055 HATA: fleet intelligence kanit omurgasina baglanmis';
  END IF;

  SELECT * INTO r FROM public._resolve_driver_presence(
    gen_random_uuid(), gen_random_uuid(), now() - interval '1 hour', now(), NULL);
  IF r.decision <> 'NO_PRESENCE' THEN
    RAISE EXCEPTION '055 HATA: presence resolver davranisi DEGISTI';
  END IF;
  IF public._dna_status(4, 500) <> 'NO_DNA' THEN
    RAISE EXCEPTION '055 HATA: DNA esik kapisi DEGISTI';
  END IF;
  IF public._fleet_insight_confidence(50, 1, 100, 50) IN ('HIGH','VERY_HIGH') THEN
    RAISE EXCEPTION '055 HATA: fleet intelligence guven kapisi DEGISTI';
  END IF;

  -- (e) RLS + anon kilidi + doğrudan yazma kapalı
  FOR r IN SELECT unnest(ARRAY['ai_evidence','ai_evidence_chain']) AS t
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public'
                    AND tablename=r.t AND rowsecurity) THEN
      RAISE EXCEPTION '055 HATA: %: RLS kapali', r.t;
    END IF;
    IF has_table_privilege('anon', 'public.'||r.t, 'SELECT') THEN
      RAISE EXCEPTION '055 HATA: %: anon okuyabiliyor', r.t;
    END IF;
    IF has_table_privilege('authenticated', 'public.'||r.t, 'INSERT')
       OR has_table_privilege('authenticated', 'public.'||r.t, 'UPDATE')
       OR has_table_privilege('authenticated', 'public.'||r.t, 'DELETE') THEN
      RAISE EXCEPTION '055 HATA: %: elle yazilabiliyor (kanit olmaktan cikar)', r.t;
    END IF;
  END LOOP;

  -- (f) DEFINER + search_path
  FOR r IN SELECT p.proname, pg_get_functiondef(p.oid) AS def
             FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
            WHERE n.nspname='public'
              AND p.proname IN ('_ai_evidence_write_guard','_ai_evidence_immutable_guard',
                                '_ai_evidence_record','_ai_evidence_link',
                                'expire_ai_evidence','get_evidence_chain',
                                'get_evidence_coverage')
  LOOP
    IF r.def NOT LIKE '%SECURITY DEFINER%' OR r.def NOT LIKE '%search_path%' THEN
      RAISE EXCEPTION '055 HATA: %: DEFINER/search_path eksik', r.proname;
    END IF;
  END LOOP;

  RAISE NOTICE '055 OK: kanit omurgasi (merge + expiry + immutability + chain + coverage) kuruldu · guven TURETILIR · kaynaksiz/oznesiz/olcumsuz kanit ACTIVE olamaz · DNA/FI/trip/deep scan DEGISMEDI.';
END
$verify$;
