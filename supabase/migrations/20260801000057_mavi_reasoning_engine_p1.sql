-- ═══════════════════════════════════════════════════════════════════════════
-- 057 — MAVI REASONING ENGINE (P1)
--
-- YALNIZ İLERİ MIGRATION. 033–056 geçmişi DEĞİŞTİRİLMEZ.
--
-- ── AMAÇ ─────────────────────────────────────────────────────────────────
-- CAROS PRO'nun **TEK KARAR OTORİTESİ**. Bugünden sonra hiçbir modül kendi
-- kararını üretmez; AI Mechanic · Driver Coach · Fleet Advisor · Predictive
-- Maintenance · Trip/Diagnostic/Repair/Service Advisor · AI Negotiator ·
-- Vehicle Health Advisor kararı BURADAN alır.
--
-- ── LLM KARAR VERMEZ ─────────────────────────────────────────────────────
-- LLM YOK · model YOK · tahmin YOK · doğal dil YOK. `title`/`message`/
-- `explanation`/`summary`/`answer`/`text` gibi bir kolon BİLİNÇLİ OLARAK
-- YOKTUR (doğrulama bu kolonlar eklenirse DÜŞER). LLM yalnız bu tabloda
-- ZATEN VERİLMİŞ kararı doğal dile çevirir.
--
-- ── TEK VERİ KAPISI ──────────────────────────────────────────────────────
-- Karar YALNIZ `ai_evidence` okur. `driver_dna*` · `fleet_insight*` ·
-- `vehicle_trips` · deep scan tabloları DOĞRUDAN OKUNMAZ — zincirin o
-- uçları `ai_evidence_chain` üzerinden ÇÖZÜLÜR (uydurulmaz).
--
-- ── ALTI FAIL-CLOSED KURALI ──────────────────────────────────────────────
--   1. **Kanıtsız karar sonuçlandırıcı olamaz** — CHECK reddeder.
--   2. **Güven istemciden yazılamaz:** trigger onu kanıttan YENİDEN türetir.
--   3. **Çelişkili kanıtta karar üretilmez** → `CONFLICTED_EVIDENCE`.
--   4. **Süresi dolan karar SİLİNMEZ**, `EXPIRED` olur.
--   5. **Aynı karar iki kez açılmaz** (kimlik = özne + niyet + kanıt imzası).
--   6. **Geçersiz durum geçişi REDDEDİLİR** (`NEW → SUPPORTED` yasak).
--
-- ── İKİNCİ OTORİTE KURULMAZ ──────────────────────────────────────────────
-- Güven ölçeği ve en-zayıf-halka formülü 055'ten ÇAĞRILIR
-- (`_evidence_weakest`, `_evidence_confidence`); SQL'e KOPYALANMAZ.
--
-- ── MEVCUT KATMANLARA DOKUNULMADI ────────────────────────────────────────
-- `ai_evidence*`, `driver_dna*`, `fleet_insight*`, `vehicle_trips`,
-- `_trip_attribution_trigger`, `_resolve_*`, `_evidence_*` yolları YENİDEN
-- TANIMLANMAZ. Karar omurgası onları YALNIZ OKUR.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. KARAR DEFTERİ ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mavi_reasoning (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,

  /* ÖZNELER — en az biri dolu olmalı (öznesiz karar bir yere bağlanamaz). */
  vehicle_id  uuid REFERENCES public.vehicles(id) ON DELETE CASCADE,
  driver_id   uuid REFERENCES public.fleet_drivers(id) ON DELETE CASCADE,
  trip_id     uuid REFERENCES public.vehicle_trips(id) ON DELETE CASCADE,

  intent            text NOT NULL,
  decision          text NOT NULL DEFAULT 'UNKNOWN',
  /* TÜRETİLİR — trigger yazar, istemci iddiası yok sayılır. */
  confidence        text NOT NULL DEFAULT 'UNKNOWN',
  /* Gerekçe bounded KOD'dur; serbest metin OLAMAZ (doğal dil üretimi olurdu). */
  confidence_reason text NOT NULL DEFAULT 'NO_EVIDENCE',

  /* KANIT İMZASI — kararın DAYANAĞININ parmak izi. Kanıt kümesi değişirse
     imza değişir ve bu ARTIK BAŞKA BİR KARARDIR. */
  evidence_signature text NOT NULL DEFAULT '',
  evidence_count     integer NOT NULL DEFAULT 0,
  conflict_count     integer NOT NULL DEFAULT 0,
  /* Beklenen kategorilerin kaçı karşılandı; hesaplanamazsa NULL (0 DEĞİL). */
  coverage_ratio     numeric,

  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  state       text NOT NULL DEFAULT 'NEW',
  reasoning_version integer NOT NULL DEFAULT 1,

  CONSTRAINT mr_intent_valid CHECK (intent IN (
    'VEHICLE_HEALTH','TRIP_STATUS','LOCATION','CONNECTIVITY','FUEL','ENGINE',
    'TEMPERATURE','BATTERY','DRIVER','FLEET','DIAGNOSTIC','UNKNOWN')),
  CONSTRAINT mr_decision_valid CHECK (decision IN (
    'SUPPORTED','UNSUPPORTED','INSUFFICIENT_EVIDENCE','CONFLICTED_EVIDENCE',
    'EXPIRED_EVIDENCE','UNKNOWN','REJECTED')),
  CONSTRAINT mr_conf_valid CHECK (confidence IN
    ('VERY_HIGH','HIGH','MEDIUM','LOW','UNKNOWN')),
  CONSTRAINT mr_conf_reason_valid CHECK (confidence_reason IN (
    'NO_EVIDENCE','ALL_EVIDENCE_EXPIRED','CONFLICTING_EVIDENCE',
    'EVIDENCE_UNKNOWN_CONFIDENCE','SINGLE_OBSERVATION','COVERAGE_INCOMPLETE',
    'WEAKEST_EVIDENCE_LINK','INTENT_UNRESOLVED','SUBJECT_MISMATCH')),
  CONSTRAINT mr_state_valid CHECK (state IN (
    'NEW','ANALYZING','SUPPORTED','UNSUPPORTED','UNKNOWN','REJECTED',
    'EXPIRED','CONFLICTED')),
  CONSTRAINT mr_expiry_valid CHECK (expires_at > created_at),
  CONSTRAINT mr_counts_nonneg CHECK (evidence_count >= 0 AND conflict_count >= 0),
  CONSTRAINT mr_coverage_range CHECK (
    coverage_ratio IS NULL OR (coverage_ratio >= 0 AND coverage_ratio <= 1)),

  /* (1) KANITSIZ KARAR SONUÇLANDIRICI OLAMAZ.
     "Veri yok, o hâlde sorun yok" bir karar DEĞİLDİR. */
  CONSTRAINT mr_evidence_when_conclusive CHECK (
    decision NOT IN ('SUPPORTED','UNSUPPORTED') OR evidence_count > 0),
  /* (2) GÜVENSİZ KARAR SONUÇLANDIRICI OLAMAZ. */
  CONSTRAINT mr_confidence_when_conclusive CHECK (
    decision NOT IN ('SUPPORTED','UNSUPPORTED') OR confidence <> 'UNKNOWN'),
  /* (3) ÇELİŞKİ VARSA SONUÇLANDIRICI KARAR YAZILAMAZ. */
  CONSTRAINT mr_no_conclusion_on_conflict CHECK (
    conflict_count = 0 OR decision NOT IN ('SUPPORTED','UNSUPPORTED')),
  /* Niyeti bilinmeyen karar sonuçlandırıcı olamaz. */
  CONSTRAINT mr_intent_when_conclusive CHECK (
    decision NOT IN ('SUPPORTED','UNSUPPORTED') OR intent <> 'UNKNOWN'),
  /* ÖZNESİZ KARAR — yalnız `REJECTED` olabilir. */
  CONSTRAINT mr_subject_required CHECK (
    decision = 'REJECTED'
    OR vehicle_id IS NOT NULL OR driver_id IS NOT NULL OR trip_id IS NOT NULL)
);

/* (5) TEKİLLEŞTİRME KİMLİĞİ: aynı özne + niyet + kanıt imzası İKİNCİ KEZ
   AÇILMAZ. Zaman kimliğe DAHİL DEĞİLDİR — aksi hâlde her replay yeni bir
   "karar" üretir ve sayılar şişerdi. */
CREATE UNIQUE INDEX IF NOT EXISTS mr_dedupe_unique
  ON public.mavi_reasoning (
    company_id, intent, evidence_signature,
    coalesce(vehicle_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(driver_id,  '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(trip_id,    '00000000-0000-0000-0000-000000000000'::uuid));

CREATE INDEX IF NOT EXISTS mr_company_idx ON public.mavi_reasoning (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS mr_vehicle_idx ON public.mavi_reasoning (vehicle_id) WHERE vehicle_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS mr_driver_idx  ON public.mavi_reasoning (driver_id)  WHERE driver_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS mr_trip_idx    ON public.mavi_reasoning (trip_id)    WHERE trip_id IS NOT NULL;

-- ── 2. KARAR ↔ KANIT BAĞI ───────────────────────────────────────────────
--
-- ⚠️ Kanıt bağı bir metin listesi DEĞİL, GERÇEK bir yabancı anahtardır:
-- var olmayan kanıta dayanan karar YAZILAMAZ.
CREATE TABLE IF NOT EXISTS public.mavi_reasoning_evidence (
  reasoning_id uuid NOT NULL REFERENCES public.mavi_reasoning(id) ON DELETE CASCADE,
  evidence_id  uuid NOT NULL REFERENCES public.ai_evidence(id) ON DELETE CASCADE,
  PRIMARY KEY (reasoning_id, evidence_id)
);

CREATE INDEX IF NOT EXISTS mre_evidence_idx
  ON public.mavi_reasoning_evidence (evidence_id);

-- ── 3. KARAR ZİNCİRİ ────────────────────────────────────────────────────
--
-- `DECISION → EVIDENCE → FLEET_INSIGHT · DRIVER_DNA → TRIP → VEHICLE`
--
-- ⚠️ Zincir UYDURULMAZ: içgörü ve DNA uçları `ai_evidence_chain` ile
-- `driver_dna` üzerinden ÇÖZÜLÜR. Çözülemeyen uç zincire YAZILMAZ.
CREATE TABLE IF NOT EXISTS public.mavi_reasoning_chain (
  reasoning_id  uuid NOT NULL REFERENCES public.mavi_reasoning(id) ON DELETE CASCADE,
  layer         text NOT NULL,
  ref_id        text NOT NULL,
  parent_ref_id text,
  PRIMARY KEY (reasoning_id, layer, ref_id),
  CONSTRAINT mrc_layer_valid CHECK (layer IN (
    'DECISION','EVIDENCE','FLEET_INSIGHT','DRIVER_DNA','TRIP','VEHICLE')),
  CONSTRAINT mrc_ref_nonempty CHECK (length(btrim(ref_id)) > 0)
);

-- ── 4. TEKİLLEŞTİRME VE GEÇİŞ SAYAÇLARI (gözlemlenebilirlik) ────────────
--
-- Bastırılan tekrar SESSİZCE YUTULMAZ: "karar sayısı artmıyor" ile "hiç
-- düşünülmüyor" ayırt edilebilmelidir.
CREATE TABLE IF NOT EXISTS public.mavi_reasoning_stat (
  company_id uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  duplicate_count           integer NOT NULL DEFAULT 0,
  invalid_transition_count  integer NOT NULL DEFAULT 0,
  rejected_request_count    integer NOT NULL DEFAULT 0,
  last_reasoned_at          timestamptz,
  CONSTRAINT mrs_counts_nonneg CHECK (
    duplicate_count >= 0 AND invalid_transition_count >= 0
    AND rejected_request_count >= 0)
);

-- ── 5. NİYET ↔ KATEGORİ SÖZLEŞMESİ ──────────────────────────────────────
--
-- ⚠️ Beklenti SABİTTİR ve gerçeğe göre aşağı çekilmez: "zaten sıcaklık
-- verimiz yok, o hâlde beklemeyelim" demek eksikliği görünmez yapardı.
-- TS `categoriesForIntent` ile BİREBİR aynı olmak zorundadır.
CREATE OR REPLACE FUNCTION public._reasoning_categories(p_intent text)
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = public
AS $fn$
  SELECT CASE coalesce(p_intent,'')
    WHEN 'VEHICLE_HEALTH' THEN ARRAY['VEHICLE','ENGINE','TEMPERATURE','BATTERY','DIAGNOSTIC']
    WHEN 'TRIP_STATUS'    THEN ARRAY['TRIP','LOCATION','FUEL']
    WHEN 'LOCATION'       THEN ARRAY['LOCATION']
    WHEN 'CONNECTIVITY'   THEN ARRAY['CONNECTIVITY']
    WHEN 'FUEL'           THEN ARRAY['FUEL']
    WHEN 'ENGINE'         THEN ARRAY['ENGINE']
    WHEN 'TEMPERATURE'    THEN ARRAY['TEMPERATURE']
    WHEN 'BATTERY'        THEN ARRAY['BATTERY']
    WHEN 'DRIVER'         THEN ARRAY['DRIVER','TRIP']
    WHEN 'FLEET'          THEN ARRAY['FLEET']
    WHEN 'DIAGNOSTIC'     THEN ARRAY['DIAGNOSTIC','BLACKBOX']
    /* Niyet bilinmiyorsa beklenen kategori de yoktur — boş dizi bir
       "hepsi" kısayolu DEĞİLDİR. */
    ELSE ARRAY[]::text[] END;
$fn$;

/** Kanıt kategorisinin işaret ettiği niyet (TS `intentForCategory` aynası). */
CREATE OR REPLACE FUNCTION public._reasoning_intent_for_category(p_category text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public
AS $fn$
  SELECT CASE coalesce(p_category,'')
    WHEN 'DRIVER'       THEN 'DRIVER'
    WHEN 'TRIP'         THEN 'TRIP_STATUS'
    WHEN 'VEHICLE'      THEN 'VEHICLE_HEALTH'
    WHEN 'ENGINE'       THEN 'ENGINE'
    WHEN 'TEMPERATURE'  THEN 'TEMPERATURE'
    WHEN 'FUEL'         THEN 'FUEL'
    WHEN 'BATTERY'      THEN 'BATTERY'
    WHEN 'LOCATION'     THEN 'LOCATION'
    WHEN 'CONNECTIVITY' THEN 'CONNECTIVITY'
    WHEN 'DIAGNOSTIC'   THEN 'DIAGNOSTIC'
    WHEN 'BLACKBOX'     THEN 'DIAGNOSTIC'
    WHEN 'FLEET'        THEN 'FLEET'
    ELSE 'UNKNOWN' END;
$fn$;

-- ── 6. DURUM MAKİNESİ ───────────────────────────────────────────────────
--
-- `NEW → ANALYZING → {SUPPORTED · UNSUPPORTED · UNKNOWN · CONFLICTED · REJECTED}`
-- Sonuçlanmış karar yalnız `EXPIRED`a gidebilir. `REJECTED` ve `EXPIRED`
-- MUTLAK terminaldir: reddedilmiş karar sonradan doğru olamaz, süresi
-- dolmuş karar diriltilemez — yeni kanıt YENİ bir karar açar.
CREATE OR REPLACE FUNCTION public._reasoning_can_transition(p_from text, p_to text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public
AS $fn$
  SELECT CASE
    WHEN p_from = p_to THEN false                       -- no-op geçiş yoktur
    WHEN p_from = 'NEW' THEN p_to IN ('ANALYZING','REJECTED')
    WHEN p_from = 'ANALYZING' THEN p_to IN
      ('SUPPORTED','UNSUPPORTED','UNKNOWN','CONFLICTED','REJECTED')
    WHEN p_from IN ('SUPPORTED','UNSUPPORTED','UNKNOWN','CONFLICTED')
      THEN p_to = 'EXPIRED'
    ELSE false END;                                     -- REJECTED · EXPIRED
$fn$;

/** Karara karşılık gelen terminal durum (TS `stateForDecision` aynası). */
CREATE OR REPLACE FUNCTION public._reasoning_state_for_decision(p_decision text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public
AS $fn$
  SELECT CASE coalesce(p_decision,'')
    WHEN 'SUPPORTED'           THEN 'SUPPORTED'
    WHEN 'UNSUPPORTED'         THEN 'UNSUPPORTED'
    WHEN 'CONFLICTED_EVIDENCE' THEN 'CONFLICTED'
    WHEN 'REJECTED'            THEN 'REJECTED'
    /* Yetersiz · süresi dolmuş · bilinmeyen kanıt → hepsi "bilmiyorum"dur. */
    ELSE 'UNKNOWN' END;
$fn$;

CREATE OR REPLACE FUNCTION public._mavi_reasoning_state_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  IF NEW.state IS DISTINCT FROM OLD.state
     AND NOT public._reasoning_can_transition(OLD.state, NEW.state) THEN
    /* Geçersiz geçiş SESSİZCE DÜZELTİLMEZ — REDDEDİLİR.
       ⚠️ Sayaç BURADA artırılamaz: `RAISE` işlemi geri alır, artış da geri
       alınırdı — "sayıyorum" demek ama saymamak, sessiz yutmanın en kötü
       türüdür. Sayım, geçişi YAKALAYABİLEN sarmalayıcıda yapılır
       (`mavi_reasoning_transition`). */
    RAISE EXCEPTION 'MAVI_REASONING_INVALID_TRANSITION: % -> %', OLD.state, NEW.state
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_mavi_reasoning_state ON public.mavi_reasoning;
CREATE TRIGGER trg_mavi_reasoning_state
  BEFORE UPDATE ON public.mavi_reasoning
  FOR EACH ROW EXECUTE FUNCTION public._mavi_reasoning_state_guard();

-- ── 7. DEĞİŞMEZLİK ──────────────────────────────────────────────────────
--
-- Bir kararın öznesi, niyeti, dayanağı (kanıt imzası) ve doğuş anı ASLA
-- değişmez: dayanağı değiştirilebilen bir karar açıklanamaz.
CREATE OR REPLACE FUNCTION public._mavi_reasoning_immutable_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.company_id IS DISTINCT FROM OLD.company_id
     OR NEW.vehicle_id IS DISTINCT FROM OLD.vehicle_id
     OR NEW.driver_id  IS DISTINCT FROM OLD.driver_id
     OR NEW.trip_id    IS DISTINCT FROM OLD.trip_id
     OR NEW.intent     IS DISTINCT FROM OLD.intent
     OR NEW.evidence_signature IS DISTINCT FROM OLD.evidence_signature
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.reasoning_version IS DISTINCT FROM OLD.reasoning_version THEN
    RAISE EXCEPTION 'MAVI_REASONING_IMMUTABLE: karar kimligi/dayanagi/dogus ani degistirilemez'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_mavi_reasoning_immutable ON public.mavi_reasoning;
CREATE TRIGGER trg_mavi_reasoning_immutable
  BEFORE UPDATE ON public.mavi_reasoning
  FOR EACH ROW EXECUTE FUNCTION public._mavi_reasoning_immutable_guard();

-- ── 8. GÜVEN TÜRETİMİ (istemci yazamaz) ─────────────────────────────────
--
-- ⚠️ İKİNCİ OTORİTE KURULMAZ: en-zayıf-halka ve örnek-sayısı tavanları
-- 055'ten ÇAĞRILIR. `_evidence_confidence('BLACKBOX','MEASURED', n)` ifadesi
-- kaynak ve ölçüm tavanları `VERY_HIGH` olduğu için SAF örnek-sayısı
-- tavanını verir — formül BURAYA KOPYALANMAZ.
CREATE OR REPLACE FUNCTION public._reasoning_confidence(
  p_decision text, p_weakest_evidence text,
  p_evidence_count integer, p_coverage numeric)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public
AS $fn$
  SELECT CASE
    /* "Kararsızım ama eminim" olamaz. */
    WHEN p_decision NOT IN ('SUPPORTED','UNSUPPORTED') THEN 'UNKNOWN'
    WHEN coalesce(p_evidence_count,0) <= 0 THEN 'UNKNOWN'
    WHEN p_coverage IS NULL THEN 'UNKNOWN'
    ELSE public._evidence_weakest(
           public._evidence_weakest(
             coalesce(p_weakest_evidence,'UNKNOWN'),
             public._evidence_confidence('BLACKBOX','MEASURED', p_evidence_count)),
           CASE WHEN p_coverage < 0.5 THEN 'LOW'
                WHEN p_coverage < 0.8 THEN 'MEDIUM'
                ELSE 'VERY_HIGH' END)
    END;
$fn$;

CREATE OR REPLACE FUNCTION public._mavi_reasoning_write_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  /* (2) İSTEMCİNİN GÜVENİ YOK SAYILIR — daima yeniden türetilir.
     `weakest_evidence` kararın kanıt bağından okunur; INSERT anında bağ
     henüz yoksa güven `UNKNOWN` kalır ve sonuçlandırıcı karar CHECK'e
     takılır (fail-closed). */
  NEW.confidence := public._reasoning_confidence(
    NEW.decision,
    (SELECT public._evidence_weakest_agg(NEW.id)),
    NEW.evidence_count, NEW.coverage_ratio);
  RETURN NEW;
END;
$fn$;

/** Bir kararın kanıtlarının EN ZAYIF güveni (bağ yoksa `UNKNOWN`). */
CREATE OR REPLACE FUNCTION public._evidence_weakest_agg(p_reasoning_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE v_w text := 'VERY_HIGH'; r record; v_any boolean := false;
BEGIN
  FOR r IN SELECT e.confidence FROM public.mavi_reasoning_evidence m
             JOIN public.ai_evidence e ON e.id = m.evidence_id
            WHERE m.reasoning_id = p_reasoning_id
  LOOP
    v_any := true;
    v_w := public._evidence_weakest(v_w, r.confidence);
  END LOOP;
  IF NOT v_any THEN RETURN 'UNKNOWN'; END IF;
  RETURN v_w;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_mavi_reasoning_write ON public.mavi_reasoning;
CREATE TRIGGER trg_mavi_reasoning_write
  BEFORE INSERT OR UPDATE ON public.mavi_reasoning
  FOR EACH ROW EXECUTE FUNCTION public._mavi_reasoning_write_guard();

-- ── 9. ÇELİŞKİ ÇÖZÜCÜ ───────────────────────────────────────────────────
--
-- İki çelişki türü (TS `resolveConflicts` ile birebir):
--   · VALUE_DIVERGENCE    — FARKLI kaynaklar aynı metriği farklı ölçmüş.
--   · REVISION_DIVERGENCE — AYNI kaynağın iki revizyonu birden aktif.
-- Eşik %10'dur ve SABİTTİR: gevşetilebilir bir eşik, çelişkiyi gizlemenin
-- yolu olurdu.
CREATE OR REPLACE FUNCTION public._reasoning_conflicts(p_evidence_ids uuid[])
RETURNS integer LANGUAGE sql STABLE SET search_path = public
AS $fn$
  WITH act AS (
    SELECT * FROM public.ai_evidence WHERE id = ANY(p_evidence_ids)
  )
  SELECT count(*)::int FROM act a JOIN act b
    ON b.id > a.id
   AND a.metric = b.metric
   AND coalesce(a.vehicle_id,'00000000-0000-0000-0000-000000000000'::uuid)
       = coalesce(b.vehicle_id,'00000000-0000-0000-0000-000000000000'::uuid)
   AND coalesce(a.driver_id,'00000000-0000-0000-0000-000000000000'::uuid)
       = coalesce(b.driver_id,'00000000-0000-0000-0000-000000000000'::uuid)
   AND coalesce(a.trip_id,'00000000-0000-0000-0000-000000000000'::uuid)
       = coalesce(b.trip_id,'00000000-0000-0000-0000-000000000000'::uuid)
   AND (
        a.source = b.source                              -- REVISION_DIVERGENCE
     OR (a.value IS NOT NULL AND b.value IS NOT NULL
         AND greatest(abs(a.value), abs(b.value)) > 0
         AND abs(a.value - b.value)
             / greatest(abs(a.value), abs(b.value)) > 0.10)  -- VALUE_DIVERGENCE
   );
$fn$;

-- ── 10. KARAR ÜRETİMİ ───────────────────────────────────────────────────
--
-- ⚠️ Bu fonksiyon **TEK KARAR OTORİTESİDİR**. Başka hiçbir yol karar
-- yazamaz (tablo `authenticated` için salt-okunurdur).
--
-- ── SIRA (fail-closed, pazarlıksız) ─────────────────────────────────────
--  1. Özne yok / başka şirkete ait  → REJECTED · SUBJECT_MISMATCH
--  2. Niyet çözülemedi              → UNKNOWN  · INTENT_UNRESOLVED
--  3. Hiç kanıt yok                 → INSUFFICIENT_EVIDENCE · NO_EVIDENCE
--  4. Kanıt var, hepsi süresi dolmuş→ EXPIRED_EVIDENCE · ALL_EVIDENCE_EXPIRED
--  5. Çelişki var                   → CONFLICTED_EVIDENCE (karar ÜRETİLMEZ)
--  6. Güven türetilemedi            → UNKNOWN · EVIDENCE_UNKNOWN_CONFIDENCE
--  7. Olumsuz kanıt (WARNING/CRITICAL) → UNSUPPORTED
--  8. Aksi hâlde                    → SUPPORTED
CREATE OR REPLACE FUNCTION public.mavi_reason(
  p_company_id uuid, p_intent text,
  p_vehicle_id uuid DEFAULT NULL, p_driver_id uuid DEFAULT NULL,
  p_trip_id uuid DEFAULT NULL,
  p_ttl interval DEFAULT interval '24 hours')
RETURNS TABLE (result text, reasoning_id uuid, decision text, confidence text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_intent    text := coalesce(p_intent, 'UNKNOWN');
  v_cats      text[];
  v_ids       uuid[] := ARRAY[]::uuid[];
  v_all       integer := 0;
  v_expired   integer := 0;
  v_unknown   integer := 0;
  v_negative  integer := 0;
  v_conflicts integer := 0;
  v_present   integer := 0;
  v_coverage  numeric;
  v_sig       text := '';
  v_decision  text;
  v_reason    text;
  v_state     text;
  v_id        uuid;
  v_existing  uuid;
  v_ok        boolean;
  r           record;
BEGIN
  /* ── 1. ÖZNE KAPISI (cross-tenant fail-closed) ───────────────────── */
  IF p_company_id IS NULL
     OR (p_vehicle_id IS NULL AND p_driver_id IS NULL AND p_trip_id IS NULL) THEN
    PERFORM public._reasoning_bump_rejected(p_company_id);
    RETURN QUERY SELECT 'REJECTED'::text, NULL::uuid, 'REJECTED'::text, 'UNKNOWN'::text;
    RETURN;
  END IF;

  IF p_vehicle_id IS NOT NULL THEN
    SELECT (company_id = p_company_id) INTO v_ok FROM public.vehicles WHERE id = p_vehicle_id;
    IF coalesce(v_ok,false) = false THEN
      PERFORM public._reasoning_bump_rejected(p_company_id);
      RETURN QUERY SELECT 'REJECTED'::text, NULL::uuid, 'REJECTED'::text, 'UNKNOWN'::text;
      RETURN;
    END IF;
  END IF;
  IF p_driver_id IS NOT NULL THEN
    SELECT (company_id = p_company_id) INTO v_ok FROM public.fleet_drivers WHERE id = p_driver_id;
    IF coalesce(v_ok,false) = false THEN
      PERFORM public._reasoning_bump_rejected(p_company_id);
      RETURN QUERY SELECT 'REJECTED'::text, NULL::uuid, 'REJECTED'::text, 'UNKNOWN'::text;
      RETURN;
    END IF;
  END IF;
  IF p_trip_id IS NOT NULL THEN
    SELECT (v.company_id = p_company_id) INTO v_ok
      FROM public.vehicle_trips t JOIN public.vehicles v ON v.id = t.vehicle_id
     WHERE t.id = p_trip_id;
    IF coalesce(v_ok,false) = false THEN
      PERFORM public._reasoning_bump_rejected(p_company_id);
      RETURN QUERY SELECT 'REJECTED'::text, NULL::uuid, 'REJECTED'::text, 'UNKNOWN'::text;
      RETURN;
    END IF;
  END IF;

  /* ── 2. NİYET ÇÖZÜCÜ ──────────────────────────────────────────────
     Niyet verilmediyse ÖZNENİN aktif kanıt kategorilerinden türetilir —
     ve YALNIZ tek bir aday varsa. Birden fazla aday varsa motor kura
     çekmez: `UNKNOWN`. */
  IF v_intent = 'UNKNOWN' THEN
    SELECT count(DISTINCT public._reasoning_intent_for_category(e.category)),
           min(public._reasoning_intent_for_category(e.category))
      INTO v_all, v_intent
      FROM public.ai_evidence e
     WHERE e.company_id = p_company_id
       AND e.state = 'ACTIVE' AND e.expires_at > now()
       AND public._reasoning_intent_for_category(e.category) <> 'UNKNOWN'
       AND (p_vehicle_id IS NULL OR e.vehicle_id = p_vehicle_id)
       AND (p_driver_id  IS NULL OR e.driver_id  = p_driver_id)
       AND (p_trip_id    IS NULL OR e.trip_id    = p_trip_id);
    IF coalesce(v_all,0) <> 1 THEN v_intent := 'UNKNOWN'; END IF;
    v_all := 0;
  END IF;

  /* ── 3. KANIT ÇÖZÜCÜ — TEK VERİ KAPISI: yalnız `ai_evidence` ─────── */
  v_cats := public._reasoning_categories(v_intent);

  IF array_length(v_cats,1) IS NOT NULL THEN
    SELECT count(*)::int,
           count(*) FILTER (WHERE e.state = 'EXPIRED'
                              OR (e.state = 'ACTIVE' AND e.expires_at <= now()))::int
      INTO v_all, v_expired
      FROM public.ai_evidence e
     WHERE e.company_id = p_company_id
       AND e.category = ANY(v_cats)
       AND (p_vehicle_id IS NULL OR e.vehicle_id = p_vehicle_id)
       AND (p_driver_id  IS NULL OR e.driver_id  = p_driver_id)
       AND (p_trip_id    IS NULL OR e.trip_id    = p_trip_id);

    SELECT coalesce(array_agg(e.id ORDER BY e.id), ARRAY[]::uuid[]),
           count(*) FILTER (WHERE e.confidence = 'UNKNOWN')::int,
           count(*) FILTER (WHERE e.severity IN ('WARNING','CRITICAL'))::int,
           count(DISTINCT e.category)::int
      INTO v_ids, v_unknown, v_negative, v_present
      FROM public.ai_evidence e
     WHERE e.company_id = p_company_id
       AND e.category = ANY(v_cats)
       AND e.state = 'ACTIVE' AND e.expires_at > now()
       AND (p_vehicle_id IS NULL OR e.vehicle_id = p_vehicle_id)
       AND (p_driver_id  IS NULL OR e.driver_id  = p_driver_id)
       AND (p_trip_id    IS NULL OR e.trip_id    = p_trip_id);
  END IF;

  /* Kanıt yoksa kapsam BİLİNMEZ (0 DEĞİL — "hiç bakmadık"). */
  v_coverage := CASE WHEN coalesce(array_length(v_ids,1),0) = 0 THEN NULL
                     ELSE v_present::numeric / array_length(v_cats,1) END;
  v_sig := coalesce((SELECT string_agg(x::text, ',' ORDER BY x::text)
                       FROM unnest(v_ids) AS x), '');
  v_conflicts := coalesce(public._reasoning_conflicts(v_ids), 0);

  /* ── 4. KARAR ÇÖZÜCÜ (sıra pazarlıksız) ──────────────────────────── */
  IF v_intent = 'UNKNOWN' THEN
    v_decision := 'UNKNOWN';                 v_reason := 'INTENT_UNRESOLVED';
  ELSIF v_all = 0 THEN
    v_decision := 'INSUFFICIENT_EVIDENCE';   v_reason := 'NO_EVIDENCE';
  ELSIF coalesce(array_length(v_ids,1),0) = 0 THEN
    IF v_expired > 0 THEN
      v_decision := 'EXPIRED_EVIDENCE';      v_reason := 'ALL_EVIDENCE_EXPIRED';
    ELSE
      v_decision := 'INSUFFICIENT_EVIDENCE'; v_reason := 'NO_EVIDENCE';
    END IF;
  ELSIF v_conflicts > 0 THEN
    v_decision := 'CONFLICTED_EVIDENCE';     v_reason := 'CONFLICTING_EVIDENCE';
  ELSIF v_unknown = array_length(v_ids,1) THEN
    v_decision := 'UNKNOWN';                 v_reason := 'EVIDENCE_UNKNOWN_CONFIDENCE';
  ELSE
    v_decision := CASE WHEN v_negative > 0 THEN 'UNSUPPORTED' ELSE 'SUPPORTED' END;
    v_reason := CASE
      WHEN v_present < array_length(v_cats,1) THEN 'COVERAGE_INCOMPLETE'
      WHEN array_length(v_ids,1) = 1          THEN 'SINGLE_OBSERVATION'
      ELSE 'WEAKEST_EVIDENCE_LINK' END;
  END IF;

  /* ── 5. TEKİLLEŞTİRME (kural 5) — replay YENİ KARAR AÇMAZ ────────── */
  SELECT id INTO v_existing FROM public.mavi_reasoning
   WHERE company_id = p_company_id AND intent = v_intent
     AND evidence_signature = v_sig
     AND coalesce(vehicle_id,'00000000-0000-0000-0000-000000000000'::uuid)
         = coalesce(p_vehicle_id,'00000000-0000-0000-0000-000000000000'::uuid)
     AND coalesce(driver_id,'00000000-0000-0000-0000-000000000000'::uuid)
         = coalesce(p_driver_id,'00000000-0000-0000-0000-000000000000'::uuid)
     AND coalesce(trip_id,'00000000-0000-0000-0000-000000000000'::uuid)
         = coalesce(p_trip_id,'00000000-0000-0000-0000-000000000000'::uuid);

  IF v_existing IS NOT NULL THEN
    INSERT INTO public.mavi_reasoning_stat (company_id, duplicate_count, last_reasoned_at)
    VALUES (p_company_id, 1, now())
    ON CONFLICT (company_id) DO UPDATE
      SET duplicate_count = public.mavi_reasoning_stat.duplicate_count + 1,
          last_reasoned_at = now();
    RETURN QUERY SELECT 'DUPLICATE'::text, r2.id, r2.decision, r2.confidence
      FROM public.mavi_reasoning r2 WHERE r2.id = v_existing;
    RETURN;
  END IF;

  /* ── 6. DURUM MAKİNESİ GERÇEKTEN YÜRÜR: NEW → ANALYZING → terminal.
     Kestirme YOKTUR; her adım geçiş kapısından geçer. ──────────────── */
  INSERT INTO public.mavi_reasoning (
    company_id, vehicle_id, driver_id, trip_id, intent,
    decision, confidence_reason, evidence_signature, evidence_count,
    conflict_count, coverage_ratio, expires_at, state)
  VALUES (
    p_company_id, p_vehicle_id, p_driver_id, p_trip_id, v_intent,
    /* Kanıt bağı henüz yazılmadığı için karar ÖNCE `UNKNOWN` açılır:
       sonuçlandırıcı bir karar, dayanağı bağlanmadan yazılamaz. */
    'UNKNOWN', v_reason, v_sig, 0, v_conflicts, v_coverage,
    now() + p_ttl, 'NEW')
  RETURNING id INTO v_id;

  /* Kanıt bağları — GERÇEK yabancı anahtar (var olmayan kanıt bağlanamaz). */
  IF coalesce(array_length(v_ids,1),0) > 0 THEN
    INSERT INTO public.mavi_reasoning_evidence (reasoning_id, evidence_id)
    SELECT v_id, x FROM unnest(v_ids) AS x
    ON CONFLICT DO NOTHING;
  END IF;

  UPDATE public.mavi_reasoning SET state = 'ANALYZING' WHERE id = v_id;

  v_state := public._reasoning_state_for_decision(v_decision);
  UPDATE public.mavi_reasoning
     SET decision = v_decision,
         confidence_reason = v_reason,
         evidence_count = coalesce(array_length(v_ids,1),0),
         state = v_state
   WHERE id = v_id;

  /* ── 7. ZİNCİR: uçlar ÇÖZÜLÜR, uydurulmaz ────────────────────────── */
  INSERT INTO public.mavi_reasoning_chain (reasoning_id, layer, ref_id, parent_ref_id)
  VALUES (v_id, 'DECISION', v_id::text, NULL)
  ON CONFLICT DO NOTHING;

  FOR r IN SELECT e.* FROM public.ai_evidence e
            WHERE e.id = ANY(v_ids)
  LOOP
    INSERT INTO public.mavi_reasoning_chain (reasoning_id, layer, ref_id, parent_ref_id)
    VALUES (v_id, 'EVIDENCE', r.id::text, v_id::text)
    ON CONFLICT DO NOTHING;

    /* Fleet Intelligence ucu: `ai_evidence_chain` üzerinden GERÇEK bağ. */
    INSERT INTO public.mavi_reasoning_chain (reasoning_id, layer, ref_id, parent_ref_id)
    SELECT v_id, 'FLEET_INSIGHT', c.consumer_id, r.id::text
      FROM public.ai_evidence_chain c
     WHERE c.evidence_id = r.id AND c.consumer = 'FLEET_INSIGHT'
    ON CONFLICT DO NOTHING;

    /* Driver DNA ucu: kanıt DNA kaynaklıysa sürücünün DNA kaydı çözülür.
       DNA kaydı yoksa düğüm YAZILMAZ (boş uç uydurmaktan iyidir). */
    IF r.source = 'DRIVER_DNA' AND r.driver_id IS NOT NULL THEN
      INSERT INTO public.mavi_reasoning_chain (reasoning_id, layer, ref_id, parent_ref_id)
      SELECT v_id, 'DRIVER_DNA', d.id::text, r.id::text
        FROM public.driver_dna d
       WHERE d.driver_id = r.driver_id AND d.company_id = p_company_id
      ON CONFLICT DO NOTHING;
    END IF;

    IF r.trip_id IS NOT NULL THEN
      INSERT INTO public.mavi_reasoning_chain (reasoning_id, layer, ref_id, parent_ref_id)
      VALUES (v_id, 'TRIP', r.trip_id::text, r.id::text)
      ON CONFLICT DO NOTHING;
    END IF;
    IF r.vehicle_id IS NOT NULL THEN
      INSERT INTO public.mavi_reasoning_chain (reasoning_id, layer, ref_id, parent_ref_id)
      VALUES (v_id, 'VEHICLE', r.vehicle_id::text,
              coalesce(r.trip_id::text, r.id::text))
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;

  INSERT INTO public.mavi_reasoning_stat (company_id, last_reasoned_at)
  VALUES (p_company_id, now())
  ON CONFLICT (company_id) DO UPDATE SET last_reasoned_at = now();

  RETURN QUERY SELECT 'RECORDED'::text, r3.id, r3.decision, r3.confidence
    FROM public.mavi_reasoning r3 WHERE r3.id = v_id;
END;
$fn$;

/** Reddedilen istek sayacı — sessiz yutma YOK. */
CREATE OR REPLACE FUNCTION public._reasoning_bump_rejected(p_company_id uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  IF p_company_id IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = p_company_id) THEN RETURN; END IF;
  INSERT INTO public.mavi_reasoning_stat (company_id, rejected_request_count)
  VALUES (p_company_id, 1)
  ON CONFLICT (company_id) DO UPDATE
    SET rejected_request_count = public.mavi_reasoning_stat.rejected_request_count + 1;
END;
$fn$;

/**
 * Durum geçişini DENER ve geçersizse **SAYAR**.
 *
 * ⚠️ Trigger tek başına yetmez: `RAISE` işlemi geri alır, bu yüzden sayaç
 * trigger içinde artırılamaz. Bu sarmalayıcı geçişi bir alt-işlemde dener;
 * reddedilirse hatayı YAKALAR, sayacı KALICI olarak artırır ve sonucu
 * bounded bir KOD olarak döndürür — geçersiz geçiş ne sessizce uygulanır
 * ne de sessizce kaybolur.
 */
CREATE OR REPLACE FUNCTION public.mavi_reasoning_transition(
  p_reasoning_id uuid, p_to text)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE v_co uuid; v_from text;
BEGIN
  SELECT company_id, state INTO v_co, v_from
    FROM public.mavi_reasoning WHERE id = p_reasoning_id;
  IF NOT FOUND THEN RETURN 'NOT_FOUND'; END IF;

  BEGIN
    UPDATE public.mavi_reasoning SET state = p_to WHERE id = p_reasoning_id;
    RETURN 'APPLIED';
  EXCEPTION WHEN OTHERS THEN
    /* Alt-işlem geri alındı; bu INSERT ana işlemde KALICIDIR. */
    INSERT INTO public.mavi_reasoning_stat (company_id, invalid_transition_count)
    VALUES (v_co, 1)
    ON CONFLICT (company_id) DO UPDATE
      SET invalid_transition_count = public.mavi_reasoning_stat.invalid_transition_count + 1;
    RETURN 'INVALID_TRANSITION';
  END;
END;
$fn$;

-- ── 11. SÜRE DOLUMU (silmez · idempotent) ───────────────────────────────
--
-- ⚠️ Karar SİLİNMEZ: geçmişte verilmiş bir karar yok edilirse, o karara
-- dayanan her şey açıklanamaz hâle gelir.
CREATE OR REPLACE FUNCTION public.expire_mavi_reasoning()
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE v_n integer;
BEGIN
  UPDATE public.mavi_reasoning r
     SET state = 'EXPIRED'
   WHERE r.id IN (SELECT s.id FROM public.mavi_reasoning s
                   WHERE s.expires_at <= now()
                     AND public._reasoning_can_transition(s.state, 'EXPIRED')
                   FOR UPDATE SKIP LOCKED)
     AND public._reasoning_can_transition(r.state, 'EXPIRED');
  GET DIAGNOSTICS v_n = ROW_COUNT;      -- idempotens: ikinci koşum 0 döner
  RETURN v_n;
END;
$fn$;

-- ── 12. OKUMA RPC'LERİ (salt-okunur) ────────────────────────────────────
DROP FUNCTION IF EXISTS public.get_reasoning_chain(uuid);

/** Bir kararın geriye doğru okunması — "tek tıkla karar zinciri". */
CREATE OR REPLACE FUNCTION public.get_reasoning_chain(p_reasoning_id uuid)
RETURNS TABLE (
  layer text, ref_id text, parent_ref_id text,
  evidence_source text, evidence_category text, evidence_metric text,
  evidence_value numeric, evidence_confidence text, evidence_state text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
#variable_conflict use_column
DECLARE v_uid uuid := auth.uid(); v_co uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;                 -- fail-closed
  SELECT p.company_id INTO v_co FROM public.profiles p WHERE p.id = v_uid;
  IF v_co IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.mavi_reasoning m
                  WHERE m.id = p_reasoning_id AND m.company_id = v_co) THEN
    RETURN;                                             -- CROSS-TENANT kapalı
  END IF;

  RETURN QUERY
  SELECT c.layer, c.ref_id, c.parent_ref_id,
         e.source, e.category, e.metric, e.value, e.confidence, e.state
    FROM public.mavi_reasoning_chain c
    LEFT JOIN public.ai_evidence e
      ON c.layer = 'EVIDENCE' AND e.id::text = c.ref_id
   WHERE c.reasoning_id = p_reasoning_id
   ORDER BY array_position(
     ARRAY['DECISION','EVIDENCE','FLEET_INSIGHT','DRIVER_DNA','TRIP','VEHICLE'],
     c.layer), c.ref_id;
END;
$fn$;

DROP FUNCTION IF EXISTS public.get_recent_reasoning(integer);

/** Son kararlar — Fleet Dashboard "Son Kararlar" kartı. */
CREATE OR REPLACE FUNCTION public.get_recent_reasoning(p_limit integer DEFAULT 20)
RETURNS TABLE (
  reasoning_id uuid, intent text, decision text, confidence text,
  confidence_reason text, state text,
  evidence_count integer, conflict_count integer, coverage_ratio numeric,
  vehicle_id uuid, driver_id uuid, trip_id uuid,
  created_at timestamptz, expires_at timestamptz, decision_age_seconds integer
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
  SELECT m.id, m.intent, m.decision, m.confidence, m.confidence_reason, m.state,
         m.evidence_count, m.conflict_count, m.coverage_ratio,
         m.vehicle_id, m.driver_id, m.trip_id,
         m.created_at, m.expires_at,
         extract(epoch FROM (now() - m.created_at))::int
    FROM public.mavi_reasoning m
   WHERE m.company_id = v_co
   ORDER BY m.created_at DESC
   LIMIT greatest(1, least(coalesce(p_limit,20), 100));
END;
$fn$;

DROP FUNCTION IF EXISTS public.get_reasoning_summary();

/**
 * Şirket geneli karar özeti — Fleet Dashboard kartları ve CAROS LAB.
 *
 * ⚠️ Eksik veri **UNKNOWN**'dır: hiç karar yoksa oranlar `NULL` döner
 * (`0` DEĞİL — "hiç düşünmedik" ile "sıfır ölçtük" farklı şeylerdir).
 */
CREATE OR REPLACE FUNCTION public.get_reasoning_summary()
RETURNS TABLE (
  company_id uuid,
  reasoning_total integer, valid_count integer, expired_count integer,
  supported_count integer, unsupported_count integer,
  conflicted_count integer, unknown_count integer,
  insufficient_count integer, expired_evidence_count integer,
  rejected_count integer,
  duplicate_count integer, invalid_transition_count integer,
  rejected_request_count integer,
  evidence_ref_total integer, chain_node_total integer,
  high_confidence_ratio numeric, conclusive_ratio numeric,
  newest_decision_age_seconds integer, oldest_decision_age_seconds integer,
  integrity_ok boolean
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
  WITH m AS (SELECT * FROM public.mavi_reasoning WHERE company_id = v_co),
       valid AS (SELECT * FROM m
                  WHERE state IN ('SUPPORTED','UNSUPPORTED','UNKNOWN','CONFLICTED')
                    AND expires_at > now()),
       st AS (SELECT * FROM public.mavi_reasoning_stat WHERE company_id = v_co),
       ev AS (SELECT count(*)::int AS n FROM public.mavi_reasoning_evidence x
               WHERE x.reasoning_id IN (SELECT id FROM m)),
       ch AS (SELECT count(*)::int AS n FROM public.mavi_reasoning_chain x
               WHERE x.reasoning_id IN (SELECT id FROM m))
  SELECT v_co,
         (SELECT count(*)::int FROM m),
         (SELECT count(*)::int FROM valid),
         (SELECT count(*)::int FROM m WHERE state = 'EXPIRED'),
         (SELECT count(*)::int FROM m WHERE decision = 'SUPPORTED'),
         (SELECT count(*)::int FROM m WHERE decision = 'UNSUPPORTED'),
         (SELECT count(*)::int FROM m WHERE decision = 'CONFLICTED_EVIDENCE'),
         (SELECT count(*)::int FROM m WHERE decision = 'UNKNOWN'),
         (SELECT count(*)::int FROM m WHERE decision = 'INSUFFICIENT_EVIDENCE'),
         (SELECT count(*)::int FROM m WHERE decision = 'EXPIRED_EVIDENCE'),
         (SELECT count(*)::int FROM m WHERE decision = 'REJECTED'),
         (SELECT coalesce((SELECT duplicate_count FROM st), 0)),
         (SELECT coalesce((SELECT invalid_transition_count FROM st), 0)),
         (SELECT coalesce((SELECT rejected_request_count FROM st), 0)),
         (SELECT n FROM ev), (SELECT n FROM ch),
         /* Karar yoksa oran NULL — bölme yapılamaz. */
         (SELECT CASE WHEN count(*) > 0
                      THEN count(*) FILTER (WHERE confidence IN ('HIGH','VERY_HIGH'))::numeric
                           / count(*) END FROM m),
         (SELECT CASE WHEN count(*) > 0
                      THEN count(*) FILTER (WHERE decision IN ('SUPPORTED','UNSUPPORTED'))::numeric
                           / count(*) END FROM m),
         (SELECT extract(epoch FROM (now() - max(created_at)))::int FROM m),
         (SELECT extract(epoch FROM (now() - min(created_at)))::int FROM m),
         /* BÜTÜNLÜK: sonuçlandırıcı karar kanıtsız/güvensiz/çelişkili olamaz. */
         (SELECT NOT EXISTS (SELECT 1 FROM m
                              WHERE decision IN ('SUPPORTED','UNSUPPORTED')
                                AND (evidence_count = 0 OR confidence = 'UNKNOWN'
                                     OR conflict_count > 0)));
END;
$fn$;

-- ── 13. YETKİLER ────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.get_reasoning_chain(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_recent_reasoning(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_reasoning_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_reasoning_chain(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_recent_reasoning(integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_reasoning_summary() TO authenticated, service_role;

/* ⚠️ KARAR ÜRETİMİ İSTEMCİYE AÇILMAZ: karar otoritesi sunucudadır.
   `authenticated` bir karar tetikleyemez, yazamaz, güncelleyemez. */
REVOKE ALL ON FUNCTION public.mavi_reason(uuid,text,uuid,uuid,uuid,interval)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mavi_reason(uuid,text,uuid,uuid,uuid,interval) TO service_role;
REVOKE ALL ON FUNCTION public.expire_mavi_reasoning() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_mavi_reasoning() TO service_role;
REVOKE ALL ON FUNCTION public.mavi_reasoning_transition(uuid,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mavi_reasoning_transition(uuid,text) TO service_role;
REVOKE ALL ON FUNCTION public._reasoning_bump_rejected(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._reasoning_conflicts(uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._evidence_weakest_agg(uuid) FROM PUBLIC, anon, authenticated;

-- ── 14. RLS + İZİNLER ───────────────────────────────────────────────────
ALTER TABLE public.mavi_reasoning ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mavi_reasoning_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mavi_reasoning_chain ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mavi_reasoning_stat ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.mavi_reasoning FROM anon, PUBLIC;
REVOKE ALL ON TABLE public.mavi_reasoning_evidence FROM anon, PUBLIC;
REVOKE ALL ON TABLE public.mavi_reasoning_chain FROM anon, PUBLIC;
REVOKE ALL ON TABLE public.mavi_reasoning_stat FROM anon, PUBLIC;

/* Salt-okuma: karar ELLE yazılamaz — yazılabilseydi karar olmaktan çıkardı. */
GRANT SELECT ON TABLE public.mavi_reasoning TO authenticated;
GRANT SELECT ON TABLE public.mavi_reasoning_evidence TO authenticated;
GRANT SELECT ON TABLE public.mavi_reasoning_chain TO authenticated;
GRANT SELECT ON TABLE public.mavi_reasoning_stat TO authenticated;
GRANT ALL ON TABLE public.mavi_reasoning TO service_role;
GRANT ALL ON TABLE public.mavi_reasoning_evidence TO service_role;
GRANT ALL ON TABLE public.mavi_reasoning_chain TO service_role;
GRANT ALL ON TABLE public.mavi_reasoning_stat TO service_role;

DROP POLICY IF EXISTS mr_company_read ON public.mavi_reasoning;
CREATE POLICY mr_company_read ON public.mavi_reasoning
  FOR SELECT TO authenticated
  USING (company_id = (SELECT p.company_id FROM public.profiles p WHERE p.id = auth.uid()));

DROP POLICY IF EXISTS mre_company_read ON public.mavi_reasoning_evidence;
CREATE POLICY mre_company_read ON public.mavi_reasoning_evidence
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.mavi_reasoning m
                  WHERE m.id = reasoning_id
                    AND m.company_id = (SELECT p.company_id FROM public.profiles p
                                         WHERE p.id = auth.uid())));

DROP POLICY IF EXISTS mrc_company_read ON public.mavi_reasoning_chain;
CREATE POLICY mrc_company_read ON public.mavi_reasoning_chain
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.mavi_reasoning m
                  WHERE m.id = reasoning_id
                    AND m.company_id = (SELECT p.company_id FROM public.profiles p
                                         WHERE p.id = auth.uid())));

DROP POLICY IF EXISTS mrs_company_read ON public.mavi_reasoning_stat;
CREATE POLICY mrs_company_read ON public.mavi_reasoning_stat
  FOR SELECT TO authenticated
  USING (company_id = (SELECT p.company_id FROM public.profiles p WHERE p.id = auth.uid()));

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- DOĞRULAMA (fail-closed) — fonksiyonlar ÇAĞRILARAK sınanır.
-- ═══════════════════════════════════════════════════════════════════════════

DO $verify$
DECLARE r record; v_def text;
BEGIN
  -- (a) Tablolar + tekilleştirme kilidi
  FOR r IN SELECT unnest(ARRAY['mavi_reasoning','mavi_reasoning_evidence',
                               'mavi_reasoning_chain','mavi_reasoning_stat']) AS t
  LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                    WHERE table_schema='public' AND table_name=r.t) THEN
      RAISE EXCEPTION '057 HATA: % tablosu yok', r.t;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public'
                  AND indexname='mr_dedupe_unique') THEN
    RAISE EXCEPTION '057 HATA: karar tekillestirme kilidi yok (replay cift karar acar)';
  END IF;
  FOR r IN SELECT unnest(ARRAY['mr_evidence_when_conclusive',
                               'mr_confidence_when_conclusive',
                               'mr_no_conclusion_on_conflict',
                               'mr_intent_when_conclusive',
                               'mr_subject_required']) AS c
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = r.c) THEN
      RAISE EXCEPTION '057 HATA: fail-closed kisiti yok: %', r.c;
    END IF;
  END LOOP;

  -- (b) DOĞAL DİL KOLONU YOK (LLM karar vermez, cumle kurmaz)
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='mavi_reasoning'
                AND column_name IN ('title','message','explanation','summary',
                                    'answer','text','recommendation','advice')) THEN
    RAISE EXCEPTION '057 HATA: karara dogal dil kolonu eklenmis (AI uretimi)';
  END IF;

  -- (c) DURUM MAKİNESİ ÇAĞRILARAK sınanır
  IF public._reasoning_can_transition('NEW','SUPPORTED') THEN
    RAISE EXCEPTION '057 HATA: analiz edilmeden karar verilebiliyor';
  END IF;
  IF NOT public._reasoning_can_transition('NEW','ANALYZING') THEN
    RAISE EXCEPTION '057 HATA: NEW -> ANALYZING gecisi kapali';
  END IF;
  IF NOT public._reasoning_can_transition('ANALYZING','SUPPORTED') THEN
    RAISE EXCEPTION '057 HATA: ANALYZING -> SUPPORTED gecisi kapali';
  END IF;
  IF public._reasoning_can_transition('EXPIRED','SUPPORTED')
     OR public._reasoning_can_transition('REJECTED','ANALYZING') THEN
    RAISE EXCEPTION '057 HATA: terminal durumdan cikis var';
  END IF;
  IF public._reasoning_can_transition('SUPPORTED','UNSUPPORTED') THEN
    RAISE EXCEPTION '057 HATA: sonuclanmis karar sessizce degistirilebiliyor';
  END IF;

  -- (d) GÜVEN TÜRETİMİ — ikinci otorite YOK, 055'ten cagrilir
  IF public._reasoning_confidence('UNKNOWN','VERY_HIGH',5,1.0) <> 'UNKNOWN' THEN
    RAISE EXCEPTION '057 HATA: sonuclandirici olmayan karar guven uretti';
  END IF;
  IF public._reasoning_confidence('SUPPORTED','VERY_HIGH',0,1.0) <> 'UNKNOWN' THEN
    RAISE EXCEPTION '057 HATA: kanitsiz karar guven uretti';
  END IF;
  /* TEK KANIT `MEDIUM`u aşamaz — 055'in ornek-sayisi tavani devrede. */
  IF public._reasoning_confidence('SUPPORTED','VERY_HIGH',1,1.0) <> 'MEDIUM' THEN
    RAISE EXCEPTION '057 HATA: tek kanitli karar MEDIUM tavanini asti';
  END IF;
  IF public._reasoning_confidence('SUPPORTED','LOW',10,1.0) <> 'LOW' THEN
    RAISE EXCEPTION '057 HATA: en zayif kanit halkasi guveni baglamadi';
  END IF;
  /* Kapsam %50 altiysa guven LOW'u asamaz. */
  IF public._reasoning_confidence('SUPPORTED','VERY_HIGH',10,0.4) <> 'LOW' THEN
    RAISE EXCEPTION '057 HATA: eksik kapsam guveni dusurmedi';
  END IF;
  IF public._reasoning_confidence('SUPPORTED','VERY_HIGH',10,NULL) <> 'UNKNOWN' THEN
    RAISE EXCEPTION '057 HATA: kapsami bilinmeyen karar guven uretti';
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='_reasoning_confidence';
  IF v_def NOT LIKE '%_evidence_weakest%' OR v_def NOT LIKE '%_evidence_confidence%' THEN
    RAISE EXCEPTION '057 HATA: guven formulu kopyalanmis (ikinci otorite)';
  END IF;

  -- (e) NİYET ↔ KATEGORİ SÖZLEŞMESİ
  IF public._reasoning_intent_for_category('TEMPERATURE') <> 'TEMPERATURE'
     OR public._reasoning_intent_for_category('BLACKBOX') <> 'DIAGNOSTIC'
     OR public._reasoning_intent_for_category('UNKNOWN') <> 'UNKNOWN' THEN
    RAISE EXCEPTION '057 HATA: niyet esleme sozlesmesi bozuldu';
  END IF;
  IF array_length(public._reasoning_categories('UNKNOWN'),1) IS NOT NULL THEN
    RAISE EXCEPTION '057 HATA: bilinmeyen niyet kategori bekliyor';
  END IF;
  IF array_length(public._reasoning_categories('VEHICLE_HEALTH'),1) <> 5 THEN
    RAISE EXCEPTION '057 HATA: arac sagligi beklentisi daraltilmis';
  END IF;

  -- (f) MEVCUT KATMANLARA DOKUNULMADI
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='_ai_evidence_write_guard';
  IF v_def LIKE '%mavi_reasoning%' THEN
    RAISE EXCEPTION '057 HATA: karar omurgasi kanit yazma kapisina girmis';
  END IF;
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='_trip_attribution_trigger';
  IF v_def LIKE '%mavi_reasoning%' THEN
    RAISE EXCEPTION '057 HATA: karar omurgasi attribution kararina girmis';
  END IF;
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='_dna_merge_trip';
  IF v_def LIKE '%mavi_reasoning%' THEN
    RAISE EXCEPTION '057 HATA: DNA birikimi karar omurgasina baglanmis';
  END IF;
  IF public._evidence_confidence('BLACKBOX','MEASURED',1) <> 'MEDIUM' THEN
    RAISE EXCEPTION '057 HATA: 055 guven kapisi DEGISTI';
  END IF;
  IF public._dna_status(4, 500) <> 'NO_DNA' THEN
    RAISE EXCEPTION '057 HATA: DNA esik kapisi DEGISTI';
  END IF;

  -- (g) TEK VERİ KAPISI
  --
  -- ⚠️ AYRIM: karar GİRDİSİ ile özne DOĞRULAMASI aynı şey değildir.
  --   · `vehicles` · `fleet_drivers` · `vehicle_trips` → yalnız CROSS-TENANT
  --     kapısında okunur (öznenin bu şirkete ait olup olmadığı).
  --   · `driver_dna` · `ai_evidence_chain` → yalnız ZİNCİR UCU çözümünde
  --     okunur (kararın nereden geldiği görünsün diye).
  --   · Karara giren ÖLÇÜM · SEVERITY · GÜVEN · KAPSAM yalnız
  --     `ai_evidence`ten gelir.
  -- Aşağıdaki liste "paralel motor" işaretleridir: bunlar okunursa karar
  -- kanıt omurgasını atlayıp ham katmandan hesap yapıyor demektir.
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='mavi_reason';
  IF v_def LIKE '%fleet_insight_evidence%'
     OR v_def LIKE '%driver_dna_trip%'
     OR v_def LIKE '%fleet_trend%'
     OR v_def LIKE '%fleet_health%'
     OR v_def LIKE '%deep_scan%' THEN
    RAISE EXCEPTION '057 HATA: karar kanit omurgasini atlayip ham katmandan hesap yapiyor';
  END IF;
  /* Karar, başka katmanların KARAR fonksiyonlarını da çağıramaz —
     ikinci bir karar otoritesi devreye girmiş olurdu. */
  IF v_def LIKE '%_dna_status%'
     OR v_def LIKE '%_fleet_insight_confidence%'
     OR v_def LIKE '%_resolve_driver_%' THEN
    RAISE EXCEPTION '057 HATA: karar baska bir karar otoritesine devrediyor';
  END IF;
  IF v_def LIKE '%http%' OR v_def LIKE '%openrouter%' OR v_def LIKE '%gemini%'
     OR v_def LIKE '%anthropic%' OR v_def LIKE '%openai%' THEN
    RAISE EXCEPTION '057 HATA: karar uretiminde dis cagri var (LLM)';
  END IF;

  -- (h) RLS + anon kilidi + elle yazma kapalı
  FOR r IN SELECT unnest(ARRAY['mavi_reasoning','mavi_reasoning_evidence',
                               'mavi_reasoning_chain','mavi_reasoning_stat']) AS t
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public'
                    AND tablename=r.t AND rowsecurity) THEN
      RAISE EXCEPTION '057 HATA: %: RLS kapali', r.t;
    END IF;
    IF has_table_privilege('anon', 'public.'||r.t, 'SELECT') THEN
      RAISE EXCEPTION '057 HATA: %: anon okuyabiliyor', r.t;
    END IF;
    IF has_table_privilege('authenticated', 'public.'||r.t, 'INSERT')
       OR has_table_privilege('authenticated', 'public.'||r.t, 'UPDATE')
       OR has_table_privilege('authenticated', 'public.'||r.t, 'DELETE') THEN
      RAISE EXCEPTION '057 HATA: %: elle yazilabiliyor (karar olmaktan cikar)', r.t;
    END IF;
  END LOOP;

  -- (i) KARAR TETİKLEME İSTEMCİYE KAPALI
  IF has_function_privilege('authenticated',
       'public.mavi_reason(uuid,text,uuid,uuid,uuid,interval)', 'EXECUTE') THEN
    RAISE EXCEPTION '057 HATA: istemci karar tetikleyebiliyor';
  END IF;
  IF has_function_privilege('anon', 'public.get_reasoning_summary()', 'EXECUTE') THEN
    RAISE EXCEPTION '057 HATA: anon karar ozeti okuyabiliyor';
  END IF;

  -- (j) DEFINER + search_path
  FOR r IN SELECT p.proname, pg_get_functiondef(p.oid) AS def
             FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
            WHERE n.nspname='public'
              AND p.proname IN ('_mavi_reasoning_state_guard','_mavi_reasoning_immutable_guard',
                                '_mavi_reasoning_write_guard','mavi_reason',
                                'mavi_reasoning_transition',
                                'expire_mavi_reasoning','get_reasoning_chain',
                                'get_recent_reasoning','get_reasoning_summary',
                                '_evidence_weakest_agg','_reasoning_bump_rejected')
  LOOP
    IF r.def NOT LIKE '%SECURITY DEFINER%' OR r.def NOT LIKE '%search_path%' THEN
      RAISE EXCEPTION '057 HATA: %: DEFINER/search_path eksik', r.proname;
    END IF;
  END LOOP;

  RAISE NOTICE '057 OK: tek karar otoritesi kuruldu · guven TURETILIR (055 formulu) · kanitsiz/celiskili/niyetsiz karar sonuclandirici olamaz · replay yeni karar acmaz · gecersiz durum gecisi reddedilir · kanit ve mevcut katmanlar DEGISMEDI.';
END
$verify$;
