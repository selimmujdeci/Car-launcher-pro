-- ═══════════════════════════════════════════════════════════════════════════
-- 060 · AI MECHANIC CORE P1 — SALT-OKUNUR TEŞHİS YORUM KATMANI
--
-- ── EN ÖNEMLİ MİMARİ KARAR: YENİ TABLO YOK ───────────────────────────────
-- Bu migration HİÇBİR yeni tablo, karar motoru, güven sistemi veya kanıt
-- deposu OLUŞTURMAZ. AI Mechanic bir YORUM katmanıdır: kararı
-- `public.mavi_reasoning`dan, kanıtı `public.ai_evidence`tan OKUR.
--
-- Analiz kaydı kalıcı DEĞİLDİR çünkü kalıcı olsaydı ikinci bir gerçek kaynağı
-- olurdu: karar MAVI'de değişince (EXPIRED/CONFLICTED) saklanmış analiz
-- eskir ve iki otorite çelişirdi. Analiz bu yüzden HER OKUMADA karardan
-- TÜRETİLİR — tek gerçek kaynağı MAVI'dir.
--
-- `analysis_id` deterministiktir: 'mech:' || reasoning_id. Replay yeni analiz
-- ÜRETMEZ (MAVI'nin tekilleştirme kuralı 5 ile aynı ilke).
--
-- ── KAPSAM (paket şartı §2) ──────────────────────────────────────────────
-- P1 yalnız MEKANİK teşhis alanlarını yorumlar:
--   ENGINE · COOLING · BATTERY · FUEL · OBD · TEMPERATURE · CONNECTIVITY · UNKNOWN
-- `DRIVER` · `FLEET` · `TRIP_STATUS` · `LOCATION` niyetleri KAPSAM DIŞIDIR ve
-- hiç döndürülmez — AI Mechanic kendi alanı dışında konuşmaz.
--
-- ── ÖNERİ YOK (paket şartı §5) ───────────────────────────────────────────
-- Bu katmanda tamir tavsiyesi · parça · maliyet · aciliyet talimatı YOKTUR.
-- Serbest metin alanı da yoktur; her gerekçe bounded KOD'dur.
--
-- ── FAIL-CLOSED ──────────────────────────────────────────────────────────
-- Oturum yoksa / şirket çözülemezse / kayıt başka tenant'a aitse: BOŞ döner.
-- Çözülemeyen kategori `UNKNOWN`'dır; "makul varsayılan" YOKTUR.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1 · NİYET → MEKANİK KATEGORİ (SAF) ─────────────────────────────────
--
-- TS karşılığı: `aiMechanicModel.categoryForIntent`. İki taraf AYNI tabloyu
-- uygular; parite testi `supabase/tests/060_ai_mechanic_matrix.sql` içindedir.
-- NULL = mekanik teşhis kapsamı DIŞI (UNKNOWN ile karıştırılmaz).
CREATE OR REPLACE FUNCTION public._mechanic_category_for_intent(p_intent text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $fn$
  SELECT CASE p_intent
    WHEN 'ENGINE'         THEN 'ENGINE'
    WHEN 'BATTERY'        THEN 'BATTERY'
    WHEN 'FUEL'           THEN 'FUEL'
    WHEN 'TEMPERATURE'    THEN 'TEMPERATURE'
    WHEN 'CONNECTIVITY'   THEN 'CONNECTIVITY'
    WHEN 'DIAGNOSTIC'     THEN 'OBD'
    -- Çatı niyet: tek bir alt sisteme indirgenemez → çözülemedi.
    WHEN 'VEHICLE_HEALTH' THEN 'UNKNOWN'
    WHEN 'UNKNOWN'        THEN 'UNKNOWN'
    -- DRIVER / FLEET / TRIP_STATUS / LOCATION → kapsam dışı
    ELSE NULL
  END;
$fn$;

-- ── 2 · SOĞUTMA AYRIMI (kanıt metriğinden — UYDURULMAZ) ────────────────
--
-- Reasoning'de `COOLING` niyeti YOKTUR; soğutma `TEMPERATURE` içinde yaşar.
-- Ayrım YALNIZ gerçek kanıt metriği taşıdığında yapılır. Metrik yoksa
-- `TEMPERATURE` kalır — olmayan bir alt sistemi suçlamak yasaktır.
CREATE OR REPLACE FUNCTION public._mechanic_is_cooling_metric(p_metric text)
RETURNS boolean
LANGUAGE sql IMMUTABLE
AS $fn$
  SELECT coalesce(
    lower(p_metric) LIKE '%coolant%'
    OR lower(p_metric) LIKE '%radiator%'
    OR lower(p_metric) LIKE '%thermostat%'
    OR lower(p_metric) LIKE '%water_temp%'
    OR lower(p_metric) LIKE '%fan%', false);
$fn$;

-- ── 3 · KARAR → ANALİZ DURUMU (SAF) ────────────────────────────────────
--
-- `REJECTED` → NULL: reddedilen istek bir teşhis değil, girdi hatasıdır.
CREATE OR REPLACE FUNCTION public._mechanic_state_for_decision(p_decision text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $fn$
  SELECT CASE p_decision
    WHEN 'SUPPORTED'             THEN 'SUPPORTED'
    WHEN 'UNSUPPORTED'           THEN 'UNSUPPORTED'
    WHEN 'INSUFFICIENT_EVIDENCE' THEN 'INSUFFICIENT_EVIDENCE'
    WHEN 'CONFLICTED_EVIDENCE'   THEN 'CONFLICTED_EVIDENCE'
    WHEN 'EXPIRED_EVIDENCE'      THEN 'EXPIRED_EVIDENCE'
    WHEN 'UNKNOWN'               THEN 'UNKNOWN'
    ELSE NULL   -- REJECTED ve tanınmayan her şey
  END;
$fn$;

-- ── 4 · ŞİDDET (TÜRETİLMİŞ SUNUM — KARAR DEĞİL) ────────────────────────
--
-- Yeni güven sistemi DEĞİLDİR: yalnız MAVI'nin `decision`+`confidence`
-- ikilisinin sıralamasıdır. `CONFLICTED_EVIDENCE` bilinçle WARNING DEĞİL —
-- çelişki arıza kanıtı değil, bilgi eksikliğidir.
CREATE OR REPLACE FUNCTION public._mechanic_severity(p_state text, p_conf text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $fn$
  SELECT CASE
    WHEN p_state = 'SUPPORTED'   THEN 'NONE'
    WHEN p_state <> 'UNSUPPORTED' THEN 'UNKNOWN'
    WHEN p_conf IN ('VERY_HIGH','HIGH') THEN 'CRITICAL'
    WHEN p_conf IN ('MEDIUM','LOW')     THEN 'WARNING'
    ELSE 'UNKNOWN'
  END;
$fn$;

-- ── 5 · ANALİZ LİSTESİ (salt-okunur · tenant kapalı) ───────────────────
DROP FUNCTION IF EXISTS public.get_ai_mechanic_analyses(integer);

/**
 * AI Mechanic analizleri — MAVI kararlarından HER OKUMADA türetilir.
 *
 * Kapsam dışı niyetler ve REJECTED kararlar HİÇ DÖNMEZ.
 * Kanıt kimlikleri `mavi_reasoning_evidence` bağından gelir (referans).
 */
CREATE OR REPLACE FUNCTION public.get_ai_mechanic_analyses(p_limit integer DEFAULT 50)
RETURNS TABLE (
  analysis_id         text,
  reasoning_id        uuid,
  vehicle_id          uuid,
  driver_id           uuid,
  trip_id             uuid,
  diagnostic_category text,
  analysis_state      text,
  severity            text,
  confidence          text,
  confidence_reason   text,
  reasoning_state     text,
  evidence_count      integer,
  conflict_count      integer,
  evidence_ids        uuid[],
  created_at          timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
#variable_conflict use_column
DECLARE v_uid uuid := auth.uid(); v_co uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;                       -- fail-closed
  SELECT p.company_id INTO v_co FROM public.profiles p WHERE p.id = v_uid;
  IF v_co IS NULL THEN RETURN; END IF;                        -- fail-closed

  RETURN QUERY
  WITH base AS (
    SELECT m.*,
           public._mechanic_category_for_intent(m.intent) AS cat0,
           public._mechanic_state_for_decision(m.decision) AS st
      FROM public.mavi_reasoning m
     WHERE m.company_id = v_co                                -- CROSS-TENANT kapalı
  ),
  scoped AS (
    SELECT * FROM base
     WHERE cat0 IS NOT NULL          -- mekanik kapsam dışı niyetler ELENİR
       AND st   IS NOT NULL          -- REJECTED ELENİR
  ),
  ev AS (
    SELECT re.reasoning_id,
           array_agg(re.evidence_id ORDER BY re.evidence_id) AS ids,
           bool_or(public._mechanic_is_cooling_metric(e.metric)) AS has_cooling
      FROM public.mavi_reasoning_evidence re
      LEFT JOIN public.ai_evidence e ON e.id = re.evidence_id
     GROUP BY re.reasoning_id
  )
  SELECT
    'mech:' || s.id::text,
    s.id,
    s.vehicle_id, s.driver_id, s.trip_id,
    -- Soğutma ayrımı YALNIZ gerçek metrik varsa; yoksa TEMPERATURE kalır.
    CASE WHEN s.cat0 = 'TEMPERATURE' AND coalesce(ev.has_cooling, false)
         THEN 'COOLING' ELSE s.cat0 END,
    s.st,
    public._mechanic_severity(s.st, s.confidence),
    s.confidence,
    s.confidence_reason,
    s.state,
    s.evidence_count,
    s.conflict_count,
    coalesce(ev.ids, ARRAY[]::uuid[]),
    s.created_at
  FROM scoped s
  LEFT JOIN ev ON ev.reasoning_id = s.id
  ORDER BY s.created_at DESC
  LIMIT greatest(1, least(coalesce(p_limit, 50), 200));
END;
$fn$;

-- ── 6 · ÖZET (CAROS LAB · Fleet Dashboard) ─────────────────────────────
DROP FUNCTION IF EXISTS public.get_ai_mechanic_summary();

/**
 * Şirket geneli AI Mechanic özeti.
 *
 * ⚠️ Hiç analiz yoksa oranlar NULL döner (0 DEĞİL) — "hiç analiz etmedik"
 * ile "sıfır ölçtük" farklı şeylerdir (MAVI özetiyle aynı ilke).
 */
CREATE OR REPLACE FUNCTION public.get_ai_mechanic_summary()
RETURNS TABLE (
  company_id            uuid,
  analysis_total        integer,
  supported_count       integer,
  unsupported_count     integer,
  unknown_count         integer,
  insufficient_count    integer,
  conflicted_count      integer,
  expired_count         integer,
  critical_count        integer,
  warning_count         integer,
  engine_count          integer,
  cooling_count         integer,
  battery_count         integer,
  fuel_count            integer,
  obd_count             integer,
  temperature_count     integer,
  connectivity_count    integer,
  unknown_category_count integer,
  evidence_ref_total    integer,
  conclusive_ratio      numeric,
  high_confidence_ratio numeric,
  newest_analysis_age_seconds integer
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
  WITH a AS (SELECT * FROM public.get_ai_mechanic_analyses(200))
  SELECT
    v_co,
    count(*)::int,
    count(*) FILTER (WHERE analysis_state = 'SUPPORTED')::int,
    count(*) FILTER (WHERE analysis_state = 'UNSUPPORTED')::int,
    count(*) FILTER (WHERE analysis_state = 'UNKNOWN')::int,
    count(*) FILTER (WHERE analysis_state = 'INSUFFICIENT_EVIDENCE')::int,
    count(*) FILTER (WHERE analysis_state = 'CONFLICTED_EVIDENCE')::int,
    count(*) FILTER (WHERE analysis_state = 'EXPIRED_EVIDENCE')::int,
    count(*) FILTER (WHERE severity = 'CRITICAL')::int,
    count(*) FILTER (WHERE severity = 'WARNING')::int,
    count(*) FILTER (WHERE diagnostic_category = 'ENGINE')::int,
    count(*) FILTER (WHERE diagnostic_category = 'COOLING')::int,
    count(*) FILTER (WHERE diagnostic_category = 'BATTERY')::int,
    count(*) FILTER (WHERE diagnostic_category = 'FUEL')::int,
    count(*) FILTER (WHERE diagnostic_category = 'OBD')::int,
    count(*) FILTER (WHERE diagnostic_category = 'TEMPERATURE')::int,
    count(*) FILTER (WHERE diagnostic_category = 'CONNECTIVITY')::int,
    count(*) FILTER (WHERE diagnostic_category = 'UNKNOWN')::int,
    coalesce(sum(coalesce(array_length(evidence_ids, 1), 0)), 0)::int,
    -- Küme boşken oran UYDURULMAZ.
    CASE WHEN count(*) = 0 THEN NULL
         ELSE round((count(*) FILTER (WHERE analysis_state IN ('SUPPORTED','UNSUPPORTED')))::numeric
                    / count(*), 4) END,
    CASE WHEN count(*) = 0 THEN NULL
         ELSE round((count(*) FILTER (WHERE confidence IN ('HIGH','VERY_HIGH')))::numeric
                    / count(*), 4) END,
    CASE WHEN count(*) = 0 THEN NULL
         ELSE extract(epoch FROM (now() - max(created_at)))::int END
  FROM a;
END;
$fn$;

-- ── 7 · MUHAKEME ZİNCİRİ (paket şartı §6) ──────────────────────────────
DROP FUNCTION IF EXISTS public.get_ai_mechanic_chain(text);

/**
 * Bir analizin zinciri — hangi karar · hangi kanıt · hangi yolculuk · hangi araç.
 *
 * YENİ ZİNCİR DEPOLAMAZ: `get_reasoning_chain()`e delege eder. Böylece zincirin
 * tek gerçek kaynağı MAVI'de kalır. `analysis_id` 'mech:<uuid>' biçimindedir;
 * biçim bozuksa BOŞ döner (fail-closed, hata sızdırmaz).
 */
CREATE OR REPLACE FUNCTION public.get_ai_mechanic_chain(p_analysis_id text)
RETURNS TABLE (
  layer text, ref_id text, parent_ref_id text,
  evidence_source text, evidence_category text, evidence_metric text,
  evidence_value numeric, evidence_confidence text, evidence_state text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE v_rid uuid;
BEGIN
  IF p_analysis_id IS NULL OR left(p_analysis_id, 5) <> 'mech:' THEN RETURN; END IF;
  BEGIN
    v_rid := substring(p_analysis_id FROM 6)::uuid;
  EXCEPTION WHEN others THEN
    RETURN;                                            -- bozuk kimlik → boş
  END;
  -- Tenant kapısı get_reasoning_chain'in İÇİNDEDİR; burada tekrarlanmaz
  -- (iki ayrı kapı iki ayrı gerçek kaynağı olurdu).
  RETURN QUERY SELECT * FROM public.get_reasoning_chain(v_rid);
END;
$fn$;

-- ── 8 · İZİNLER ────────────────────────────────────────────────────────
--
-- Salt-okunur analiz yüzeyi. `anon` HİÇBİR erişim ALMAZ: teşhis verisi
-- oturum gerektirir (head unit anon anahtarla filo teşhisi OKUYAMAZ).
REVOKE ALL ON FUNCTION public.get_ai_mechanic_analyses(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_ai_mechanic_summary()         FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_ai_mechanic_chain(text)       FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_ai_mechanic_analyses(integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_ai_mechanic_summary()         TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_ai_mechanic_chain(text)       TO authenticated, service_role;

COMMENT ON FUNCTION public.get_ai_mechanic_analyses(integer) IS
  'AI Mechanic P1: MAVI kararlarından TÜRETİLEN salt-okunur mekanik teşhis analizleri. Yeni karar üretmez.';
COMMENT ON FUNCTION public.get_ai_mechanic_summary() IS
  'AI Mechanic P1 özeti. Analiz yoksa oranlar NULL (0 değil).';
COMMENT ON FUNCTION public.get_ai_mechanic_chain(text) IS
  'AI Mechanic P1 muhakeme zinciri — get_reasoning_chain delegasyonu; yeni zincir depolamaz.';
