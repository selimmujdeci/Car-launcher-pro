-- ═══════════════════════════════════════════════════════════════════════════
-- 062 · FLEET INSIGHT OKUMA UCU (SALT-OKUNUR)
--
-- ── NEDEN ────────────────────────────────────────────────────────────────
-- Migration 054 `fleet_insight` kayıtlarını üretiyor ama dışarıya YALNIZ
-- toplam sayaçlar açılıyordu (`get_fleet_intelligence`). Tekil içgörüyü ve
-- onun kanıt zincirini okuyacak bir yüzey YOKTU → Fleet Intelligence kartından
-- detaya inilemiyordu.
--
-- ── YENİ MOTOR YOK ───────────────────────────────────────────────────────
-- Bu migration HİÇBİR içgörü HESAPLAMAZ, güven ÜRETMEZ, kanıt YAZMAZ.
-- Yalnız var olan `fleet_insight` + `fleet_insight_evidence` kayıtlarını
-- şirket kapsamında okur. AI Evidence ve MAVI Reasoning tek otorite KALIR.
--
-- ── GİZLİLİK ─────────────────────────────────────────────────────────────
-- VIN · konum · ham kullanıcı verisi DÖNMEZ. Özne kimliği yalnız uuid olarak
-- döner; istemci onu KISALTARAK gösterir ve ham basmaz.
-- ═══════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.list_fleet_insights(integer);

/**
 * Şirketin içgörüleri — en yeni önce. Salt-okunur, tenant kapalı.
 *
 * `unknown_reason` GİZLENMEZ: `SINGLE_VEHICLE_ONLY` gibi sınırlar görünür
 * kalmalıdır, aksi hâlde tek araçtan çıkan bir gözlem "filo içgörüsü" sanılır.
 */
CREATE OR REPLACE FUNCTION public.list_fleet_insights(p_limit integer DEFAULT 50)
RETURNS TABLE (
  insight_id     uuid,
  type           text,
  source         text,
  state          text,
  confidence     text,
  subject_kind   text,
  subject_id     uuid,
  evidence_count integer,
  vehicle_count  integer,
  driver_count   integer,
  trip_count     integer,
  measured_count integer,
  unknown_reason text,
  revision       integer,
  window_start   timestamptz,
  window_end     timestamptz,
  created_at     timestamptz,
  expires_at     timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
#variable_conflict use_column
DECLARE v_uid uuid := auth.uid(); v_co uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;                    -- fail-closed
  SELECT p.company_id INTO v_co FROM public.profiles p WHERE p.id = v_uid;
  IF v_co IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT i.id, i.type, i.source, i.state, i.confidence,
         i.subject_kind, i.subject_id,
         i.evidence_count, i.vehicle_count, i.driver_count,
         i.trip_count, i.measured_count,
         i.unknown_reason, i.revision,
         i.window_start, i.window_end, i.created_at, i.expires_at
    FROM public.fleet_insight i
   WHERE i.company_id = v_co                               -- CROSS-TENANT kapalı
   ORDER BY i.created_at DESC
   LIMIT greatest(1, least(coalesce(p_limit, 50), 200));
END;
$fn$;

DROP FUNCTION IF EXISTS public.get_fleet_insight_chain(uuid);

/**
 * Bir içgörünün KANIT ZİNCİRİ — İKİ YÖNLÜ.
 *
 * ── ÖLÇÜLEN ŞEMA GERÇEĞİ (2026-08-01) ────────────────────────────────
 * `fleet_insight_evidence` `ai_evidence`'a **yabancı anahtarla BAĞLI DEĞİLDİR**.
 * Kendi kanıt defteridir: `(kind · ref_id · metric · value · provenance)`.
 * AI Evidence bağı AYRI bir yoldan gelir: `ai_evidence_chain` içinde
 * `consumer='FLEET_INSIGHT'` ve `consumer_id=<insight id>`.
 * Bu yüzden İLERİ yön İKİ kaynaktan derlenir; uydurma join YAPILMAZ.
 *
 *   direction='LEDGER'   → içgörünün KENDİ kanıt defteri
 *   direction='EVIDENCE' → içgörüyü besleyen AI Evidence kayıtları
 *   direction='CONSUMER' → bu içgörünün BESLEDİĞİ MAVI kararları (ters yön)
 *
 * Kanıtı olmayan içgörü için SAHTE zincir ÜRETİLMEZ: satır dönmez.
 */
CREATE OR REPLACE FUNCTION public.get_fleet_insight_chain(p_insight_id uuid)
RETURNS TABLE (
  direction   text,
  ref_kind    text,
  ref_id      text,
  metric      text,
  value       numeric,
  provenance  text,
  confidence  text,
  severity    text,
  state       text,
  created_at  timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
#variable_conflict use_column
DECLARE v_uid uuid := auth.uid(); v_co uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;
  SELECT p.company_id INTO v_co FROM public.profiles p WHERE p.id = v_uid;
  IF v_co IS NULL THEN RETURN; END IF;

  /* İçgörü BU şirkete ait değilse hiçbir şey dönmez (cross-tenant kapalı). */
  IF NOT EXISTS (SELECT 1 FROM public.fleet_insight i
                  WHERE i.id = p_insight_id AND i.company_id = v_co) THEN
    RETURN;
  END IF;

  RETURN QUERY
  /* 1) İÇGÖRÜNÜN KENDİ KANIT DEFTERİ. */
  SELECT 'LEDGER'::text, fie.kind, fie.ref_id, fie.metric, fie.value,
         fie.provenance, NULL::text, NULL::text, NULL::text, fie.added_at
    FROM public.fleet_insight_evidence fie
   WHERE fie.insight_id = p_insight_id

  UNION ALL

  /* 2) İÇGÖRÜYÜ BESLEYEN AI EVIDENCE (gerçek bağ: ai_evidence_chain). */
  SELECT 'EVIDENCE'::text, e.category, e.id::text, e.metric, e.value,
         e.provenance, e.confidence, e.severity, e.state, e.created_at
    FROM public.ai_evidence_chain c
    JOIN public.ai_evidence e ON e.id = c.evidence_id
   WHERE c.consumer = 'FLEET_INSIGHT'
     AND c.consumer_id = p_insight_id::text
     AND e.company_id = v_co

  UNION ALL

  /* 3) TERS YÖN: bu içgörünün beslediği MAVI kararları. */
  SELECT 'CONSUMER'::text, 'REASONING'::text, m.id::text, m.intent, NULL::numeric,
         NULL::text, m.confidence, NULL::text, m.state, m.created_at
    FROM public.mavi_reasoning_chain mc
    JOIN public.mavi_reasoning m ON m.id = mc.reasoning_id
   WHERE mc.layer = 'FLEET_INSIGHT'
     AND mc.ref_id = p_insight_id::text
     AND m.company_id = v_co

   ORDER BY 1, 4;
END;
$fn$;

-- ── İZİNLER ────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.list_fleet_insights(integer)     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_fleet_insight_chain(uuid)    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_fleet_insights(integer)  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_fleet_insight_chain(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.list_fleet_insights(integer) IS
  'Fleet Intelligence içgörülerinin salt-okunur listesi. Hesaplama YOK — mevcut kayıtları okur.';
COMMENT ON FUNCTION public.get_fleet_insight_chain(uuid) IS
  'Bir içgörünün iki yönlü kanıt zinciri (SOURCE/CONSUMER). Sahte zincir üretmez.';
