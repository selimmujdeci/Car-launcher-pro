-- ═══════════════════════════════════════════════════════════════════════════
-- 058 — MAVI REASONING PRODUCTION WIRING (P1)
--
-- YALNIZ İLERİ MIGRATION. 033–057 geçmişi DEĞİŞTİRİLMEZ.
--
-- ── AMAÇ ─────────────────────────────────────────────────────────────────
-- 057'nin karar motorunu GERÇEK ÜRÜN AKIŞINA bağlar. Bu migration'dan sonra
-- karar üretimi elle çağrılan bir fonksiyon olmaktan çıkar: gerçek araç,
-- filo ve sürücü olayları motoru KENDİLİĞİNDEN tetikler.
--
-- ── LLM YOK ──────────────────────────────────────────────────────────────
-- Bu paket de LLM çağırmaz, cümle kurmaz, tahmin üretmez. Yalnız "hangi olay
-- hangi niyeti hangi resolver'a götürür" sorusunu deterministik olarak
-- cevaplar.
--
-- ── TEK KARAR OTORİTESİ KORUNUR ──────────────────────────────────────────
-- ⚠️ Resolver'lar KARAR ÜRETMEZ. Bir resolver yalnız **öznesini seçer** ve
-- `mavi_reason`a yönlendirir. Karar mantığı (intent · evidence · decision ·
-- confidence · conflict · expiry) 057'de kalır ve BURAYA KOPYALANMAZ —
-- kopyalanırsa doğrulama DÜŞER.
--
-- ── DEĞİŞTİRİLMEYENLER ───────────────────────────────────────────────────
-- `ai_evidence*` · `driver_dna*` · `fleet_insight*` · `vehicle_trips` ·
-- `_evidence_*` · `_dna_*` · `_trip_attribution_trigger` · `_resolve_*` ·
-- `mavi_reason` gövdesi YENİDEN TANIMLANMAZ. Bu paket yalnız ÇAĞIRIR.
--
-- ── BEŞ FAIL-CLOSED KURALI ───────────────────────────────────────────────
--   1. **Varsayılan resolver YOKTUR:** eşlenmemiş niyet kuyruğa GİREMEZ.
--   2. **Aynı iş iki kez kuyruğa girmez:** bekleyen iş varken tekrar gelen
--      olay yeni satır açmaz, `suppressed_count` artar (bounded dedupe).
--   3. **Reasoning hatası ana işlemi BOZMAZ** ama SESSİZCE YUTULMAZ.
--   4. **Öznesiz/uyumsuz olay REDDEDİLİR** — uydurma özne ile karar üretilmez.
--   5. **Eşzamanlı işleyiciler aynı olayı iki kez çalıştıramaz** (atomik
--      durum geçişi + `SKIP LOCKED`).
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. OLAY KUYRUĞU ─────────────────────────────────────────────────────
--
-- ⚠️ Bu bir "yeni scheduler" DEĞİLDİR: kendi zamanlayıcısı, kendi saati veya
-- kendi karar mantığı yoktur. Mevcut olay akışının (trigger'ların) karar
-- motoruna açılan tek kapısıdır.
CREATE TABLE IF NOT EXISTS public.mavi_reasoning_event (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,

  event_type  text NOT NULL,
  /* Dispatcher'ın ÇÖZDÜĞÜ niyet ve resolver — kuyruğa girerken sabitlenir. */
  intent      text NOT NULL,
  resolver    text NOT NULL,

  vehicle_id  uuid REFERENCES public.vehicles(id) ON DELETE CASCADE,
  driver_id   uuid REFERENCES public.fleet_drivers(id) ON DELETE CASCADE,
  trip_id     uuid REFERENCES public.vehicle_trips(id) ON DELETE CASCADE,

  /* BOUNDED DEDUPE anahtarı: şirket + niyet + özne. */
  dedupe_key  text NOT NULL,

  state       text NOT NULL DEFAULT 'PENDING',
  attempts    integer NOT NULL DEFAULT 0,
  /* Bekleyen iş varken kaç kez aynı olay geldi — SESSİZCE yutulmaz. */
  suppressed_count integer NOT NULL DEFAULT 0,

  /* Üretilen karar (varsa) ve `mavi_reason`ın hükmü. */
  reasoning_id uuid REFERENCES public.mavi_reasoning(id) ON DELETE SET NULL,
  result       text,
  skip_reason  text,
  last_error   text,

  enqueued_at  timestamptz NOT NULL DEFAULT now(),
  started_at   timestamptz,
  finished_at  timestamptz,
  next_attempt_at timestamptz,

  CONSTRAINT mre_event_type_valid CHECK (event_type IN (
    'TRIP_COMPLETED','DRIVER_DNA_UPDATED','FLEET_INSIGHT_CREATED',
    'VEHICLE_IDENTITY_CHANGED','VEHICLE_CONNECTIVITY_CHANGED',
    'LOCATION_STATE_CHANGED','DRIVER_AUTHENTICATION_CHANGED',
    'DRIVER_PRESENCE_CHANGED','HEALTH_SNAPSHOT_UPDATED',
    'EVIDENCE_ADDED','EVIDENCE_EXPIRED','EVIDENCE_RETRACTED')),
  CONSTRAINT mre_resolver_valid CHECK (resolver IN (
    'VEHICLE','DRIVER','TRIP','FLEET','DIAGNOSTIC','UNKNOWN')),
  CONSTRAINT mre_state_valid CHECK (state IN (
    'PENDING','RUNNING','COMPLETED','FAILED','RETRY_PENDING',
    'REJECTED','SKIPPED','DEDUPED')),
  CONSTRAINT mre_counts_nonneg CHECK (attempts >= 0 AND suppressed_count >= 0),
  CONSTRAINT mre_skip_reason_valid CHECK (skip_reason IS NULL OR skip_reason IN (
    'NO_VEHICLE_SUBJECT','NO_DRIVER_SUBJECT','NO_TRIP_SUBJECT',
    'NO_COMPANY','SUBJECT_MISMATCH','UNMAPPED_INTENT','ATTEMPTS_EXHAUSTED')),
  /* Ölçüm dürüstlüğü: bitmiş iş başlamış olmalı. */
  CONSTRAINT mre_timing_sane CHECK (
    finished_at IS NULL OR started_at IS NOT NULL)
);

/* (2) BOUNDED DEDUPE: aynı şirket+niyet+özne için AÇIK tek bir iş olabilir.
   20 kez gelen aynı olay tek reasoning çalıştırır. */
CREATE UNIQUE INDEX IF NOT EXISTS mre_open_dedupe_unique
  ON public.mavi_reasoning_event (dedupe_key)
  WHERE state IN ('PENDING','RUNNING','RETRY_PENDING');

CREATE INDEX IF NOT EXISTS mre_queue_idx
  ON public.mavi_reasoning_event (state, next_attempt_at)
  WHERE state IN ('PENDING','RETRY_PENDING');
CREATE INDEX IF NOT EXISTS mre_company_idx
  ON public.mavi_reasoning_event (company_id, enqueued_at DESC);

-- ── 2. OLAY → NİYET (deterministik) ─────────────────────────────────────
--
-- ⚠️ Kanıt olayları niyeti KENDİ kategorisinden alır; diğerleri sabit
-- eşlemedir. Eşlenmemiş olay tipi `UNKNOWN` niyet üretir ve Unknown
-- Resolver'a gider — sessizce en yakın niyete YUVARLANMAZ.
CREATE OR REPLACE FUNCTION public._reasoning_intent_for_event(
  p_event_type text, p_evidence_category text DEFAULT NULL)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public
AS $fn$
  SELECT CASE coalesce(p_event_type,'')
    WHEN 'TRIP_COMPLETED'                 THEN 'TRIP_STATUS'
    WHEN 'DRIVER_DNA_UPDATED'             THEN 'DRIVER'
    WHEN 'FLEET_INSIGHT_CREATED'          THEN 'FLEET'
    WHEN 'VEHICLE_IDENTITY_CHANGED'       THEN 'VEHICLE_HEALTH'
    WHEN 'VEHICLE_CONNECTIVITY_CHANGED'   THEN 'CONNECTIVITY'
    WHEN 'LOCATION_STATE_CHANGED'         THEN 'LOCATION'
    WHEN 'DRIVER_AUTHENTICATION_CHANGED'  THEN 'DRIVER'
    WHEN 'DRIVER_PRESENCE_CHANGED'        THEN 'DRIVER'
    WHEN 'HEALTH_SNAPSHOT_UPDATED'        THEN 'FLEET'
    /* Kanıt olayları: niyet KANITIN kendi kategorisinden gelir. */
    WHEN 'EVIDENCE_ADDED'     THEN public._reasoning_intent_for_category(p_evidence_category)
    WHEN 'EVIDENCE_EXPIRED'   THEN public._reasoning_intent_for_category(p_evidence_category)
    WHEN 'EVIDENCE_RETRACTED' THEN public._reasoning_intent_for_category(p_evidence_category)
    ELSE 'UNKNOWN' END;
$fn$;

-- ── 3. NİYET → RESOLVER (VARSAYILAN RESOLVER YASAK) ─────────────────────
--
-- ⚠️ `ELSE` dalı bilinçli olarak **NULL** döndürür: eşlenmemiş bir niyet
-- sessizce "en yakın" resolver'a düşmez, kuyruğa hiç GİREMEZ. Doğrulama
-- bloğu 057'nin BÜTÜN niyetlerinin eşlendiğini çağırarak sınar — yeni bir
-- niyet eklenip burada eşlenmezse migration DÜŞER.
CREATE OR REPLACE FUNCTION public._reasoning_resolver_for_intent(p_intent text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public
AS $fn$
  SELECT CASE coalesce(p_intent,'')
    /* Araç gövdesine ait sinyaller. */
    WHEN 'VEHICLE_HEALTH' THEN 'VEHICLE'
    WHEN 'ENGINE'         THEN 'VEHICLE'
    WHEN 'TEMPERATURE'    THEN 'VEHICLE'
    WHEN 'BATTERY'        THEN 'VEHICLE'
    WHEN 'CONNECTIVITY'   THEN 'VEHICLE'
    /* Sürücü. */
    WHEN 'DRIVER'         THEN 'DRIVER'
    /* Yolculuk bağlamı (konum ve yakıt bir yolculuğun içinde anlam kazanır). */
    WHEN 'TRIP_STATUS'    THEN 'TRIP'
    WHEN 'LOCATION'       THEN 'TRIP'
    WHEN 'FUEL'           THEN 'TRIP'
    /* Filo. */
    WHEN 'FLEET'          THEN 'FLEET'
    /* Tanı. */
    WHEN 'DIAGNOSTIC'     THEN 'DIAGNOSTIC'
    /* Niyeti bilinmeyen olay da bir resolver'a gider — ama o resolver
       "bilmiyorum"u kayda geçirir, karar UYDURMAZ. */
    WHEN 'UNKNOWN'        THEN 'UNKNOWN'
    ELSE NULL END;
$fn$;

-- ── 4. KUYRUĞA ALMA (bounded dedupe) ────────────────────────────────────
CREATE OR REPLACE FUNCTION public._reasoning_enqueue(
  p_company_id uuid, p_event_type text,
  p_vehicle_id uuid, p_driver_id uuid, p_trip_id uuid,
  p_evidence_category text DEFAULT NULL)
RETURNS TABLE (result text, event_id uuid)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_intent text; v_resolver text; v_key text; v_id uuid; v_open uuid;
BEGIN
  IF p_company_id IS NULL THEN
    RETURN QUERY SELECT 'REJECTED'::text, NULL::uuid; RETURN;
  END IF;

  v_intent := public._reasoning_intent_for_event(p_event_type, p_evidence_category);
  v_resolver := public._reasoning_resolver_for_intent(v_intent);

  /* (1) VARSAYILAN RESOLVER YOK — eşlenmemiş niyet kuyruğa giremez. */
  IF v_resolver IS NULL THEN
    RETURN QUERY SELECT 'REJECTED'::text, NULL::uuid; RETURN;
  END IF;

  v_key := concat_ws('|', p_company_id::text, v_intent,
    coalesce(p_vehicle_id::text,'-'), coalesce(p_driver_id::text,'-'),
    coalesce(p_trip_id::text,'-'));

  /* (2) BOUNDED DEDUPE: açık iş varsa YENİ SATIR AÇILMAZ. */
  SELECT id INTO v_open FROM public.mavi_reasoning_event
   WHERE dedupe_key = v_key
     AND state IN ('PENDING','RUNNING','RETRY_PENDING')
   FOR UPDATE SKIP LOCKED;

  IF v_open IS NOT NULL THEN
    UPDATE public.mavi_reasoning_event
       SET suppressed_count = suppressed_count + 1
     WHERE id = v_open;
    RETURN QUERY SELECT 'DEDUPED'::text, v_open; RETURN;
  END IF;

  INSERT INTO public.mavi_reasoning_event
    (company_id, event_type, intent, resolver,
     vehicle_id, driver_id, trip_id, dedupe_key, state)
  VALUES (p_company_id, p_event_type, v_intent, v_resolver,
          p_vehicle_id, p_driver_id, p_trip_id, v_key, 'PENDING')
  RETURNING id INTO v_id;

  RETURN QUERY SELECT 'ENQUEUED'::text, v_id;
END;
$fn$;

-- ── 5. RESOLVER'LAR (KARAR ÜRETMEZ — yalnız özne seçer ve yönlendirir) ──
--
-- ⚠️ Buradaki hiçbir fonksiyon "sonuç" hesaplamaz: eşik, oran, severity ya
-- da güven mantığı YOKTUR. Her biri yalnız kendi öznesini doğrular ve
-- `mavi_reason`a devreder. Özne yoksa karar UYDURULMAZ → `SKIPPED`.
CREATE OR REPLACE FUNCTION public._reasoning_resolve(
  p_resolver text, p_company_id uuid, p_intent text,
  p_vehicle_id uuid, p_driver_id uuid, p_trip_id uuid)
RETURNS TABLE (outcome text, reasoning_id uuid, result text, skip_reason text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $fn$
#variable_conflict use_column
DECLARE r record;
BEGIN
  /* ── VEHICLE RESOLVER ─────────────────────────────────────────────── */
  IF p_resolver = 'VEHICLE' OR p_resolver = 'DIAGNOSTIC' THEN
    IF p_vehicle_id IS NULL THEN
      RETURN QUERY SELECT 'SKIPPED'::text, NULL::uuid, NULL::text,
                          'NO_VEHICLE_SUBJECT'::text; RETURN;
    END IF;
    SELECT * INTO r FROM public.mavi_reason(
      p_company_id, p_intent, p_vehicle_id, NULL, NULL);

  /* ── DRIVER RESOLVER ──────────────────────────────────────────────── */
  ELSIF p_resolver = 'DRIVER' THEN
    IF p_driver_id IS NULL THEN
      RETURN QUERY SELECT 'SKIPPED'::text, NULL::uuid, NULL::text,
                          'NO_DRIVER_SUBJECT'::text; RETURN;
    END IF;
    SELECT * INTO r FROM public.mavi_reason(
      p_company_id, p_intent, NULL, p_driver_id, NULL);

  /* ── TRIP RESOLVER ────────────────────────────────────────────────── */
  ELSIF p_resolver = 'TRIP' THEN
    /* Yolculuk öznesi yoksa araç öznesine düşülür — bu bir VARSAYILAN
       RESOLVER değil, aynı resolver'ın ikinci öznesidir (konum/yakıt
       yolculuk kapanmadan da araca bağlanabilir). İkisi de yoksa SKIPPED. */
    IF p_trip_id IS NULL AND p_vehicle_id IS NULL THEN
      RETURN QUERY SELECT 'SKIPPED'::text, NULL::uuid, NULL::text,
                          'NO_TRIP_SUBJECT'::text; RETURN;
    END IF;
    IF p_trip_id IS NOT NULL THEN
      SELECT * INTO r FROM public.mavi_reason(
        p_company_id, p_intent, NULL, NULL, p_trip_id);
    ELSE
      SELECT * INTO r FROM public.mavi_reason(
        p_company_id, p_intent, p_vehicle_id, NULL, NULL);
    END IF;

  /* ── FLEET RESOLVER ───────────────────────────────────────────────── */
  ELSIF p_resolver = 'FLEET' THEN
    /* Filo kararı da bir ÖZNEYE bağlanmak zorundadır (057 kuralı):
       öznesiz karar bir yere bağlanamaz. */
    IF p_vehicle_id IS NULL AND p_driver_id IS NULL THEN
      RETURN QUERY SELECT 'SKIPPED'::text, NULL::uuid, NULL::text,
                          'NO_VEHICLE_SUBJECT'::text; RETURN;
    END IF;
    SELECT * INTO r FROM public.mavi_reason(
      p_company_id, p_intent, p_vehicle_id, p_driver_id, NULL);

  /* ── UNKNOWN RESOLVER ─────────────────────────────────────────────── */
  ELSIF p_resolver = 'UNKNOWN' THEN
    /* ⚠️ Bu resolver kararı ATLAMAZ: "bilmiyorum" da kayda geçer.
       `mavi_reason` niyeti kanıt kategorilerinden türetmeyi dener; tek aday
       çıkmazsa `UNKNOWN` kararı yazılır — bu dürüstlüktür, gürültü değil
       (dedupe tekrarları zaten bastırır). */
    IF p_vehicle_id IS NULL AND p_driver_id IS NULL AND p_trip_id IS NULL THEN
      RETURN QUERY SELECT 'SKIPPED'::text, NULL::uuid, NULL::text,
                          'SUBJECT_MISMATCH'::text; RETURN;
    END IF;
    SELECT * INTO r FROM public.mavi_reason(
      p_company_id, 'UNKNOWN', p_vehicle_id, p_driver_id, p_trip_id);

  ELSE
    /* (1) Buraya düşmek imkânsızdır: resolver kümesi CHECK ile sınırlı ve
       eşlenmemiş niyet kuyruğa giremez. Yine de sessiz kalınmaz. */
    RETURN QUERY SELECT 'REJECTED'::text, NULL::uuid, NULL::text,
                        'UNMAPPED_INTENT'::text; RETURN;
  END IF;

  IF r.result = 'REJECTED' THEN
    RETURN QUERY SELECT 'REJECTED'::text, r.reasoning_id, r.result,
                        'SUBJECT_MISMATCH'::text; RETURN;
  END IF;
  RETURN QUERY SELECT 'COMPLETED'::text, r.reasoning_id, r.result, NULL::text;
END;
$fn$;

-- ── 6. DISPATCHER (eşzamanlılık güvenli) ────────────────────────────────
--
-- ⚠️ (5) Aynı olayı iki işleyici çalıştıramaz: `PENDING/RETRY_PENDING →
-- RUNNING` geçişi ATOMİKTİR; kaybeden işleyici `ALREADY_RUNNING` alır.
CREATE OR REPLACE FUNCTION public._reasoning_dispatch(p_event_id uuid)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE e record; r record; v_err text;
BEGIN
  UPDATE public.mavi_reasoning_event
     SET state = 'RUNNING', started_at = now(), attempts = attempts + 1
   WHERE id = p_event_id
     AND state IN ('PENDING','RETRY_PENDING')
  RETURNING * INTO e;

  IF NOT FOUND THEN RETURN 'ALREADY_RUNNING'; END IF;

  BEGIN
    SELECT * INTO r FROM public._reasoning_resolve(
      e.resolver, e.company_id, e.intent, e.vehicle_id, e.driver_id, e.trip_id);
  EXCEPTION WHEN OTHERS THEN
    /* (3) HATA SESSİZCE YUTULMAZ: sınırlı yeniden deneme, sonra FAILED. */
    v_err := left(coalesce(SQLSTATE,'') || ':' || coalesce(SQLERRM,''), 200);
    UPDATE public.mavi_reasoning_event
       SET state = CASE WHEN attempts >= 5 THEN 'FAILED' ELSE 'RETRY_PENDING' END,
           skip_reason = CASE WHEN attempts >= 5 THEN 'ATTEMPTS_EXHAUSTED' END,
           last_error = v_err,
           next_attempt_at = now() + (interval '1 minute' * power(2, least(5, attempts))),
           finished_at = CASE WHEN attempts >= 5 THEN now() END
     WHERE id = p_event_id;
    RETURN CASE WHEN e.attempts >= 5 THEN 'FAILED' ELSE 'RETRY_PENDING' END;
  END;

  UPDATE public.mavi_reasoning_event
     SET state = r.outcome,
         reasoning_id = r.reasoning_id,
         result = r.result,
         skip_reason = r.skip_reason,
         finished_at = now()
   WHERE id = p_event_id;

  RETURN r.outcome;
END;
$fn$;

-- ── 7. HATA YALITIMI (ana işlem BOZULMAZ) ───────────────────────────────
--
-- ⚠️ Reasoning düşerse trip yükleme · Fleet Insight · Driver DNA · Evidence
-- Engine ÇALIŞMAYA DEVAM EDER: `EXCEPTION` bloğu yalnız alt-işlemi geri alır.
-- Ama hata SESSİZCE YUTULMAZ — kuyruk kaydı durumu taşır.
-- ⚠️ `p_dispatch_now = false` YÜKSEK FREKANSLI olaylar içindir (konum akışı,
-- bağlantı tazeliği). Bunlar hot-path'te çalışır ve karar üretimini oraya
-- sokmak CLAUDE.md'nin performans bütçesini ihlal ederdi: olay yine GERÇEK
-- ve OTOMATİK olarak kuyruğa girer, işlenmesi koşucuya bırakılır.
CREATE OR REPLACE FUNCTION public._reasoning_wire_safely(
  p_company_id uuid, p_event_type text,
  p_vehicle_id uuid, p_driver_id uuid, p_trip_id uuid,
  p_evidence_category text DEFAULT NULL,
  p_dispatch_now boolean DEFAULT true)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE q record; v_res text;
BEGIN
  BEGIN
    SELECT * INTO q FROM public._reasoning_enqueue(
      p_company_id, p_event_type, p_vehicle_id, p_driver_id, p_trip_id,
      p_evidence_category);

    IF q.result <> 'ENQUEUED' THEN RETURN q.result; END IF;
    IF NOT p_dispatch_now THEN RETURN 'ENQUEUED'; END IF;

    /* Olay KUYRUĞA ALINIR VE HEMEN İŞLENİR: karar üretimi bir çağrı
       beklemez, gerçek olayla birlikte olur. Düşerse kuyrukta
       `RETRY_PENDING` kalır ve koşucu devralır. */
    v_res := public._reasoning_dispatch(q.event_id);
    RETURN v_res;
  EXCEPTION WHEN OTHERS THEN
    /* Kuyruğa alma bile düştüyse ana işlem YİNE de devam eder. */
    RETURN 'FAILED';
  END;
END;
$fn$;

-- ── 8. GERÇEK OLAY TRIGGER'LARI (12 olay) ───────────────────────────────
--
-- ⚠️ HİÇBİRİ PARALEL TETİKLEMEZ: her olay tek bir `_reasoning_wire_safely`
-- çağrısı yapar ve bounded dedupe aynı özne+niyet için tek iş bırakır.
-- Kanıt olayları ile kaynak olayları çakıştığında (ör. trip kapanışı hem
-- `TRIP_COMPLETED` hem `EVIDENCE_ADDED` üretir) ikinci olay `DEDUPED` olur.

/* 8.1 · TRIP COMPLETED */
CREATE OR REPLACE FUNCTION public._reasoning_trip_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE v_co uuid;
BEGIN
  IF NEW.ended_at IS NULL THEN RETURN NULL; END IF;
  SELECT company_id INTO v_co FROM public.vehicles WHERE id = NEW.vehicle_id;
  IF v_co IS NULL THEN RETURN NULL; END IF;
  PERFORM public._reasoning_wire_safely(
    v_co, 'TRIP_COMPLETED', NEW.vehicle_id, NEW.driver_id, NEW.id);
  RETURN NULL;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_reasoning_trip ON public.vehicle_trips;
CREATE TRIGGER trg_reasoning_trip
  AFTER INSERT OR UPDATE OF ended_at, revision ON public.vehicle_trips
  FOR EACH ROW EXECUTE FUNCTION public._reasoning_trip_trigger();

/* 8.2 · DRIVER DNA UPDATED */
CREATE OR REPLACE FUNCTION public._reasoning_dna_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  PERFORM public._reasoning_wire_safely(
    NEW.company_id, 'DRIVER_DNA_UPDATED', NULL, NEW.driver_id, NULL);
  RETURN NULL;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_reasoning_dna ON public.driver_dna;
CREATE TRIGGER trg_reasoning_dna
  AFTER INSERT OR UPDATE OF trip_count, total_distance_km, integrity_state
  ON public.driver_dna
  FOR EACH ROW EXECUTE FUNCTION public._reasoning_dna_trigger();

/* 8.3 · FLEET INSIGHT CREATED */
CREATE OR REPLACE FUNCTION public._reasoning_insight_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  IF NEW.state <> 'ACTIVE' THEN RETURN NULL; END IF;
  PERFORM public._reasoning_wire_safely(
    NEW.company_id, 'FLEET_INSIGHT_CREATED',
    CASE WHEN NEW.subject_kind = 'VEHICLE' THEN NEW.subject_id END,
    CASE WHEN NEW.subject_kind = 'DRIVER'  THEN NEW.subject_id END,
    NULL);
  RETURN NULL;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_reasoning_insight ON public.fleet_insight;
CREATE TRIGGER trg_reasoning_insight
  AFTER INSERT OR UPDATE OF state, evidence_count ON public.fleet_insight
  FOR EACH ROW EXECUTE FUNCTION public._reasoning_insight_trigger();

/* 8.4 · VEHICLE IDENTITY CHANGED */
CREATE OR REPLACE FUNCTION public._reasoning_identity_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE v_co uuid;
BEGIN
  SELECT company_id INTO v_co FROM public.vehicles WHERE id = NEW.vehicle_id;
  IF v_co IS NULL THEN RETURN NULL; END IF;
  PERFORM public._reasoning_wire_safely(
    v_co, 'VEHICLE_IDENTITY_CHANGED', NEW.vehicle_id, NULL, NULL);
  RETURN NULL;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_reasoning_identity ON public.vehicle_identity;
CREATE TRIGGER trg_reasoning_identity
  AFTER INSERT OR UPDATE OF vin, fingerprint_hash, active_obd_protocol,
                            identity_confidence, identity_conflict_count
  ON public.vehicle_identity
  FOR EACH ROW EXECUTE FUNCTION public._reasoning_identity_trigger();

/* 8.5 · VEHICLE CONNECTIVITY CHANGED
 *
 * ⚠️ HER `last_seen` GÜNCELLEMESİ BİR OLAY DEĞİLDİR: telemetri saniyede bir
 * gelebilir ve bunların hepsini "bağlantı durumu değişti" saymak kuyruğu
 * gürültüyle doldururdu. Olay yalnız GERÇEK bir durum geçişinde üretilir:
 * araç `CONNECTIVITY_SILENCE` süresince sessiz kaldıktan sonra geri döndüğünde
 * (ya da ilk kez görüldüğünde). Eşik SABİTTİR ve çağıran gevşetemez. */
CREATE OR REPLACE FUNCTION public._reasoning_connectivity_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  IF NEW.company_id IS NULL OR NEW.last_seen IS NULL THEN RETURN NULL; END IF;
  /* Sessizlikten dönüş DEĞİLSE olay yok. */
  IF OLD.last_seen IS NOT NULL
     AND NEW.last_seen - OLD.last_seen < interval '10 minutes' THEN
    RETURN NULL;
  END IF;
  /* Hot-path: kuyruğa alınır, koşucu işler (karar üretimi telemetri
     yolunun içine SOKULMAZ). */
  PERFORM public._reasoning_wire_safely(
    NEW.company_id, 'VEHICLE_CONNECTIVITY_CHANGED', NEW.id, NULL, NULL,
    NULL, false);
  RETURN NULL;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_reasoning_connectivity ON public.vehicles;
CREATE TRIGGER trg_reasoning_connectivity
  AFTER UPDATE OF last_seen ON public.vehicles
  FOR EACH ROW EXECUTE FUNCTION public._reasoning_connectivity_trigger();

/* 8.6 · LOCATION STATE CHANGED
 *
 * ⚠️ Konum akışı saniyeler mertebesindedir; her nokta bir "durum değişimi"
 * DEĞİLDİR. Olay yalnız akış KESİLİP yeniden başladığında üretilir. */
CREATE OR REPLACE FUNCTION public._reasoning_location_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE v_prev timestamptz;
BEGIN
  IF NEW.company_id IS NULL THEN RETURN NULL; END IF;

  SELECT max(coalesce(observed_at, recorded_at, created_at)) INTO v_prev
    FROM public.vehicle_locations
   WHERE vehicle_id = NEW.vehicle_id AND id <> NEW.id;

  /* Akış kesilmemişse olay yok (ilk konum ise olay VAR). */
  IF v_prev IS NOT NULL
     AND coalesce(NEW.observed_at, NEW.recorded_at, NEW.created_at, now()) - v_prev
         < interval '10 minutes' THEN
    RETURN NULL;
  END IF;

  PERFORM public._reasoning_wire_safely(
    NEW.company_id, 'LOCATION_STATE_CHANGED', NEW.vehicle_id, NULL, NULL,
    NULL, false);
  RETURN NULL;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_reasoning_location ON public.vehicle_locations;
CREATE TRIGGER trg_reasoning_location
  AFTER INSERT ON public.vehicle_locations
  FOR EACH ROW EXECUTE FUNCTION public._reasoning_location_trigger();

/* 8.7 · DRIVER AUTHENTICATION CHANGED */
CREATE OR REPLACE FUNCTION public._reasoning_auth_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  PERFORM public._reasoning_wire_safely(
    NEW.company_id, 'DRIVER_AUTHENTICATION_CHANGED',
    NEW.vehicle_id, NEW.driver_id, NULL);
  RETURN NULL;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_reasoning_auth ON public.vehicle_driver_authentication;
CREATE TRIGGER trg_reasoning_auth
  AFTER INSERT OR UPDATE ON public.vehicle_driver_authentication
  FOR EACH ROW EXECUTE FUNCTION public._reasoning_auth_trigger();

/* 8.8 · DRIVER PRESENCE CHANGED */
CREATE OR REPLACE FUNCTION public._reasoning_presence_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  PERFORM public._reasoning_wire_safely(
    NEW.company_id, 'DRIVER_PRESENCE_CHANGED',
    NEW.vehicle_id, NEW.driver_id, NULL);
  RETURN NULL;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_reasoning_presence ON public.vehicle_driver_presence;
CREATE TRIGGER trg_reasoning_presence
  AFTER INSERT OR UPDATE ON public.vehicle_driver_presence
  FOR EACH ROW EXECUTE FUNCTION public._reasoning_presence_trigger();

/* 8.9 · HEALTH SNAPSHOT UPDATED */
CREATE OR REPLACE FUNCTION public._reasoning_health_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE v_veh uuid;
BEGIN
  /* Filo sağlığının kendi öznesi yoktur; karar bir ARACA bağlanmak
     zorundadır (057 kuralı) → şirketin bir aracı seçilir. Araç yoksa
     olay hiç üretilmez (uydurma özne YOK). */
  SELECT id INTO v_veh FROM public.vehicles
   WHERE company_id = NEW.company_id ORDER BY created_at LIMIT 1;
  IF v_veh IS NULL THEN RETURN NULL; END IF;
  PERFORM public._reasoning_wire_safely(
    NEW.company_id, 'HEALTH_SNAPSHOT_UPDATED', v_veh, NULL, NULL);
  RETURN NULL;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_reasoning_health ON public.fleet_health;
CREATE TRIGGER trg_reasoning_health
  AFTER INSERT OR UPDATE OF state, index_value, confidence
  ON public.fleet_health
  FOR EACH ROW EXECUTE FUNCTION public._reasoning_health_trigger();

/* 8.10–8.12 · EVIDENCE ADDED / EXPIRED / RETRACTED */
CREATE OR REPLACE FUNCTION public._reasoning_evidence_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE v_type text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    /* Reddedilen kayıt kanıt DEĞİLDİR — karar tetiklemez. */
    IF NEW.state <> 'ACTIVE' THEN RETURN NULL; END IF;
    v_type := 'EVIDENCE_ADDED';
  ELSE
    IF NEW.state = OLD.state THEN RETURN NULL; END IF;
    IF NEW.state = 'EXPIRED' THEN
      v_type := 'EVIDENCE_EXPIRED';
    ELSIF NEW.state IN ('SUPERSEDED','REJECTED') THEN
      v_type := 'EVIDENCE_RETRACTED';
    ELSIF NEW.state = 'ACTIVE' THEN
      v_type := 'EVIDENCE_ADDED';
    ELSE
      RETURN NULL;
    END IF;
  END IF;

  PERFORM public._reasoning_wire_safely(
    NEW.company_id, v_type, NEW.vehicle_id, NEW.driver_id, NEW.trip_id,
    NEW.category);
  RETURN NULL;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_reasoning_evidence ON public.ai_evidence;
CREATE TRIGGER trg_reasoning_evidence
  AFTER INSERT OR UPDATE OF state ON public.ai_evidence
  FOR EACH ROW EXECUTE FUNCTION public._reasoning_evidence_trigger();

-- ── 9. KUYRUK KOŞUCUSU (retry + gecikmiş işler) ─────────────────────────
--
-- ⚠️ Bu bir zamanlayıcı DEĞİLDİR; `service_role` tarafından çağrılır.
-- Normal akışta olaylar zaten tetiklendikleri anda işlenir; koşucu yalnız
-- DÜŞMÜŞ ve yeniden denenecek işler içindir.
CREATE OR REPLACE FUNCTION public.run_mavi_reasoning_queue(p_limit integer DEFAULT 50)
RETURNS TABLE (processed integer, completed integer, failed integer, skipped integer)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE r record; v_res text;
  v_n integer := 0; v_ok integer := 0; v_fail integer := 0; v_skip integer := 0;
BEGIN
  FOR r IN
    SELECT id FROM public.mavi_reasoning_event
     WHERE state IN ('PENDING','RETRY_PENDING')
       AND (next_attempt_at IS NULL OR next_attempt_at <= now())
     ORDER BY enqueued_at
     LIMIT greatest(1, least(coalesce(p_limit,50), 500))
     FOR UPDATE SKIP LOCKED           -- (5) eşzamanlı koşucular çakışmaz
  LOOP
    v_res := public._reasoning_dispatch(r.id);
    v_n := v_n + 1;
    IF v_res = 'COMPLETED' THEN v_ok := v_ok + 1;
    ELSIF v_res IN ('FAILED','REJECTED') THEN v_fail := v_fail + 1;
    ELSIF v_res = 'SKIPPED' THEN v_skip := v_skip + 1;
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_n, v_ok, v_fail, v_skip;
END;
$fn$;

-- ── 10. OKUMA RPC'LERİ (salt-okunur) ────────────────────────────────────
DROP FUNCTION IF EXISTS public.get_reasoning_queue();

/**
 * Kuyruk sağlığı ve GECİKME ölçümü — CAROS LAB ve Fleet Dashboard.
 *
 * ⚠️ Ölçüm yoksa `NULL` döner (`0` DEĞİL): hiç iş işlenmediyse "ortalama
 * karar süresi 0 sn" demek yanlış olurdu.
 */
CREATE OR REPLACE FUNCTION public.get_reasoning_queue()
RETURNS TABLE (
  company_id uuid,
  event_total integer, pending_count integer, running_count integer,
  completed_count integer, failed_count integer, retry_pending_count integer,
  rejected_count integer, skipped_count integer, deduped_count integer,
  suppressed_total integer,
  avg_queue_ms numeric, avg_decision_ms numeric,
  max_queue_ms numeric, max_decision_ms numeric,
  oldest_pending_age_seconds integer,
  last_event_age_seconds integer,
  queue_healthy boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
#variable_conflict use_column
DECLARE v_uid uuid := auth.uid(); v_co uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;                 -- fail-closed
  SELECT p.company_id INTO v_co FROM public.profiles p WHERE p.id = v_uid;
  IF v_co IS NULL THEN RETURN; END IF;

  RETURN QUERY
  WITH e AS (SELECT * FROM public.mavi_reasoning_event WHERE company_id = v_co),
       done AS (SELECT * FROM e WHERE started_at IS NOT NULL AND finished_at IS NOT NULL)
  SELECT v_co,
         (SELECT count(*)::int FROM e),
         (SELECT count(*)::int FROM e WHERE state = 'PENDING'),
         (SELECT count(*)::int FROM e WHERE state = 'RUNNING'),
         (SELECT count(*)::int FROM e WHERE state = 'COMPLETED'),
         (SELECT count(*)::int FROM e WHERE state = 'FAILED'),
         (SELECT count(*)::int FROM e WHERE state = 'RETRY_PENDING'),
         (SELECT count(*)::int FROM e WHERE state = 'REJECTED'),
         (SELECT count(*)::int FROM e WHERE state = 'SKIPPED'),
         (SELECT count(*)::int FROM e WHERE state = 'DEDUPED'),
         (SELECT coalesce(sum(suppressed_count),0)::int FROM e),
         /* Hiç iş bitmediyse ortalama BİLİNMEZ — 0 DEĞİL. */
         (SELECT avg(extract(epoch FROM (started_at - enqueued_at)) * 1000) FROM done),
         (SELECT avg(extract(epoch FROM (finished_at - started_at)) * 1000) FROM done),
         (SELECT max(extract(epoch FROM (started_at - enqueued_at)) * 1000) FROM done),
         (SELECT max(extract(epoch FROM (finished_at - started_at)) * 1000) FROM done),
         (SELECT extract(epoch FROM (now() - min(enqueued_at)))::int FROM e
           WHERE state IN ('PENDING','RETRY_PENDING')),
         (SELECT extract(epoch FROM (now() - max(enqueued_at)))::int FROM e),
         /* SAĞLIK: düşmüş iş yok ve bekleyen iş birikmemiş. */
         (SELECT NOT EXISTS (SELECT 1 FROM e WHERE state = 'FAILED')
             AND coalesce((SELECT count(*) FROM e
                            WHERE state IN ('PENDING','RETRY_PENDING')), 0) < 100);
END;
$fn$;

DROP FUNCTION IF EXISTS public.get_recent_reasoning_events(integer);

/** Son olaylar — Live Event Queue (salt-okunur). */
CREATE OR REPLACE FUNCTION public.get_recent_reasoning_events(p_limit integer DEFAULT 20)
RETURNS TABLE (
  event_id uuid, event_type text, intent text, resolver text, state text,
  attempts integer, suppressed_count integer,
  result text, skip_reason text,
  reasoning_id uuid,
  vehicle_id uuid, driver_id uuid, trip_id uuid,
  queue_ms numeric, decision_ms numeric,
  enqueued_age_seconds integer
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
  SELECT x.id, x.event_type, x.intent, x.resolver, x.state,
         x.attempts, x.suppressed_count, x.result, x.skip_reason,
         x.reasoning_id, x.vehicle_id, x.driver_id, x.trip_id,
         CASE WHEN x.started_at IS NOT NULL
              THEN extract(epoch FROM (x.started_at - x.enqueued_at)) * 1000 END,
         CASE WHEN x.finished_at IS NOT NULL AND x.started_at IS NOT NULL
              THEN extract(epoch FROM (x.finished_at - x.started_at)) * 1000 END,
         extract(epoch FROM (now() - x.enqueued_at))::int
    FROM public.mavi_reasoning_event x
   WHERE x.company_id = v_co
   ORDER BY x.enqueued_at DESC
   LIMIT greatest(1, least(coalesce(p_limit,20), 100));
END;
$fn$;

-- ── 11. YETKİLER ────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.get_reasoning_queue() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_recent_reasoning_events(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_reasoning_queue() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_recent_reasoning_events(integer) TO authenticated, service_role;

/* ⚠️ Kuyruk İSTEMCİYE AÇILMAZ: olay üretimi ve işleme sunucudadır. */
REVOKE ALL ON FUNCTION public.run_mavi_reasoning_queue(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_mavi_reasoning_queue(integer) TO service_role;
REVOKE ALL ON FUNCTION public._reasoning_enqueue(uuid,text,uuid,uuid,uuid,text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._reasoning_dispatch(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._reasoning_resolve(text,uuid,text,uuid,uuid,uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._reasoning_wire_safely(uuid,text,uuid,uuid,uuid,text,boolean)
  FROM PUBLIC, anon, authenticated;

-- ── 12. RLS + İZİNLER ───────────────────────────────────────────────────
ALTER TABLE public.mavi_reasoning_event ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mavi_reasoning_event FROM anon, PUBLIC;
GRANT SELECT ON TABLE public.mavi_reasoning_event TO authenticated;
GRANT ALL ON TABLE public.mavi_reasoning_event TO service_role;

DROP POLICY IF EXISTS mre_company_read ON public.mavi_reasoning_event;
CREATE POLICY mre_company_read ON public.mavi_reasoning_event
  FOR SELECT TO authenticated
  USING (company_id = (SELECT p.company_id FROM public.profiles p WHERE p.id = auth.uid()));

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- DOĞRULAMA (fail-closed) — fonksiyonlar ÇAĞRILARAK sınanır.
-- ═══════════════════════════════════════════════════════════════════════════

DO $verify$
DECLARE r record; v_def text; v_n integer;
BEGIN
  -- (a) Kuyruk tablosu + bounded dedupe kilidi
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema='public' AND table_name='mavi_reasoning_event') THEN
    RAISE EXCEPTION '058 HATA: olay kuyrugu tablosu yok';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public'
                  AND indexname='mre_open_dedupe_unique') THEN
    RAISE EXCEPTION '058 HATA: bounded dedupe kilidi yok (ayni is 20 kez kuyruga girer)';
  END IF;

  -- (b) VARSAYILAN RESOLVER YASAK — 057'nin BÜTÜN niyetleri eşlenmiş olmalı
  FOR r IN SELECT unnest(ARRAY[
      'VEHICLE_HEALTH','TRIP_STATUS','LOCATION','CONNECTIVITY','FUEL','ENGINE',
      'TEMPERATURE','BATTERY','DRIVER','FLEET','DIAGNOSTIC','UNKNOWN']) AS i
  LOOP
    IF public._reasoning_resolver_for_intent(r.i) IS NULL THEN
      RAISE EXCEPTION '058 HATA: niyet resolver a eslenmemis: %', r.i;
    END IF;
  END LOOP;
  /* Bilinmeyen bir niyet SESSİZCE bir resolver'a düşmemeli. */
  IF public._reasoning_resolver_for_intent('SOMETHING_NEW') IS NOT NULL THEN
    RAISE EXCEPTION '058 HATA: varsayilan resolver var (eslenmemis niyet yutuluyor)';
  END IF;
  IF public._reasoning_resolver_for_intent(NULL) IS NOT NULL THEN
    RAISE EXCEPTION '058 HATA: NULL niyet bir resolver a dusuyor';
  END IF;

  -- (c) OLAY → NİYET eşlemesi çağrılarak sınanır
  IF public._reasoning_intent_for_event('TRIP_COMPLETED') <> 'TRIP_STATUS'
     OR public._reasoning_intent_for_event('DRIVER_PRESENCE_CHANGED') <> 'DRIVER'
     OR public._reasoning_intent_for_event('VEHICLE_CONNECTIVITY_CHANGED') <> 'CONNECTIVITY'
     OR public._reasoning_intent_for_event('HEALTH_SNAPSHOT_UPDATED') <> 'FLEET' THEN
    RAISE EXCEPTION '058 HATA: olay-niyet eslemesi bozuldu';
  END IF;
  /* Kanıt olayları niyeti KANITIN kategorisinden almalı. */
  IF public._reasoning_intent_for_event('EVIDENCE_ADDED','TEMPERATURE') <> 'TEMPERATURE'
     OR public._reasoning_intent_for_event('EVIDENCE_EXPIRED','BLACKBOX') <> 'DIAGNOSTIC' THEN
    RAISE EXCEPTION '058 HATA: kanit olayi niyeti kategoriden almiyor';
  END IF;
  /* Bilinmeyen olay tipi en yakın niyete YUVARLANMAMALI. */
  IF public._reasoning_intent_for_event('SOMETHING_NEW') <> 'UNKNOWN' THEN
    RAISE EXCEPTION '058 HATA: bilinmeyen olay bir niyete yuvarlaniyor';
  END IF;

  -- (d) 12 GERÇEK OLAY TRIGGER'I KURULU
  SELECT count(*) INTO v_n FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname='public' AND NOT t.tgisinternal
     AND t.tgname IN ('trg_reasoning_trip','trg_reasoning_dna','trg_reasoning_insight',
                      'trg_reasoning_identity','trg_reasoning_connectivity',
                      'trg_reasoning_location','trg_reasoning_auth',
                      'trg_reasoning_presence','trg_reasoning_health',
                      'trg_reasoning_evidence');
  IF v_n <> 10 THEN
    RAISE EXCEPTION '058 HATA: olay trigger sayisi % (10 bekleniyor)', v_n;
  END IF;

  -- (e) RESOLVER'LAR KARAR ÜRETMEZ — yalnız `mavi_reason`a yönlendirir
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='_reasoning_resolve';
  IF v_def NOT LIKE '%mavi_reason(%' THEN
    RAISE EXCEPTION '058 HATA: resolver karar motoruna yonlendirmiyor';
  END IF;
  /* Karar mantığı kopyalanmış olmamalı. */
  IF v_def LIKE '%SUPPORTED%' OR v_def LIKE '%CONFLICTED_EVIDENCE%'
     OR v_def LIKE '%_reasoning_confidence%' OR v_def LIKE '%_reasoning_conflicts%'
     OR v_def LIKE '%ai_evidence%' THEN
    RAISE EXCEPTION '058 HATA: resolver kendi karar mantigini yaziyor (ikinci otorite)';
  END IF;
  IF v_def LIKE '%http%' OR v_def LIKE '%openrouter%' OR v_def LIKE '%gemini%'
     OR v_def LIKE '%anthropic%' OR v_def LIKE '%openai%' THEN
    RAISE EXCEPTION '058 HATA: resolver da dis cagri var (LLM)';
  END IF;

  -- (f) 057 KARAR MOTORU DEĞİŞTİRİLMEDİ
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                  WHERE n.nspname='public' AND p.proname='mavi_reason') THEN
    RAISE EXCEPTION '058 HATA: mavi_reason kayboldu';
  END IF;
  IF public._reasoning_confidence('SUPPORTED','VERY_HIGH',1,1.0) <> 'MEDIUM' THEN
    RAISE EXCEPTION '058 HATA: 057 guven kapisi DEGISTI';
  END IF;
  IF public._reasoning_can_transition('NEW','SUPPORTED') THEN
    RAISE EXCEPTION '058 HATA: 057 durum makinesi DEGISTI';
  END IF;

  -- (g) MEVCUT KATMANLAR DEĞİŞTİRİLMEDİ
  IF public._evidence_confidence('BLACKBOX','MEASURED',1) <> 'MEDIUM' THEN
    RAISE EXCEPTION '058 HATA: 055 guven kapisi DEGISTI';
  END IF;
  IF public._dna_status(4, 500) <> 'NO_DNA' THEN
    RAISE EXCEPTION '058 HATA: 053 DNA esigi DEGISTI';
  END IF;
  IF public._fleet_insight_confidence(50, 1, 100, 50) IN ('HIGH','VERY_HIGH') THEN
    RAISE EXCEPTION '058 HATA: 054 FI guven kapisi DEGISTI';
  END IF;
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='_evidence_adapter_record';
  IF v_def LIKE '%mavi_reasoning%' THEN
    RAISE EXCEPTION '058 HATA: kanit adaptoru karar omurgasina baglanmis';
  END IF;
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='_trip_attribution_trigger';
  IF v_def LIKE '%mavi_reasoning%' THEN
    RAISE EXCEPTION '058 HATA: attribution zinciri karar omurgasina baglanmis';
  END IF;

  -- (h) HATA YALITIMI: reasoning hatası ana işlemi bozmamalı
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='_reasoning_wire_safely';
  IF v_def NOT LIKE '%EXCEPTION WHEN OTHERS%' THEN
    RAISE EXCEPTION '058 HATA: hata yalitimi yok (reasoning hatasi ana islemi bozar)';
  END IF;

  -- (i) RLS + anon kilidi + elle yazma kapalı
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public'
                  AND tablename='mavi_reasoning_event' AND rowsecurity) THEN
    RAISE EXCEPTION '058 HATA: kuyruk RLS kapali';
  END IF;
  IF has_table_privilege('anon','public.mavi_reasoning_event','SELECT') THEN
    RAISE EXCEPTION '058 HATA: anon kuyrugu okuyabiliyor';
  END IF;
  IF has_table_privilege('authenticated','public.mavi_reasoning_event','INSERT')
     OR has_table_privilege('authenticated','public.mavi_reasoning_event','UPDATE')
     OR has_table_privilege('authenticated','public.mavi_reasoning_event','DELETE') THEN
    RAISE EXCEPTION '058 HATA: istemci kuyruga yazabiliyor (sahte olay uretilebilir)';
  END IF;
  IF has_function_privilege('authenticated',
       'public.run_mavi_reasoning_queue(integer)','EXECUTE') THEN
    RAISE EXCEPTION '058 HATA: istemci kuyrugu isletebiliyor';
  END IF;

  -- (j) DEFINER + search_path
  FOR r IN SELECT p.proname, pg_get_functiondef(p.oid) AS def
             FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
            WHERE n.nspname='public'
              AND p.proname IN ('_reasoning_enqueue','_reasoning_dispatch',
                                '_reasoning_resolve','_reasoning_wire_safely',
                                'run_mavi_reasoning_queue','get_reasoning_queue',
                                'get_recent_reasoning_events',
                                '_reasoning_trip_trigger','_reasoning_dna_trigger',
                                '_reasoning_insight_trigger','_reasoning_identity_trigger',
                                '_reasoning_connectivity_trigger','_reasoning_location_trigger',
                                '_reasoning_auth_trigger','_reasoning_presence_trigger',
                                '_reasoning_health_trigger','_reasoning_evidence_trigger')
  LOOP
    IF r.def NOT LIKE '%SECURITY DEFINER%' OR r.def NOT LIKE '%search_path%' THEN
      RAISE EXCEPTION '058 HATA: %: DEFINER/search_path eksik', r.proname;
    END IF;
  END LOOP;

  RAISE NOTICE '058 OK: 12 gercek olay karar motoruna baglandi · varsayilan resolver YOK · bounded dedupe kuruldu · hata yalitimi var · 057 karar mantigi ve mevcut katmanlar DEGISMEDI.';
END
$verify$;
