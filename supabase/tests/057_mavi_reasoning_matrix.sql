-- ═══════════════════════════════════════════════════════════════════════════
-- 057 MAVI REASONING ENGINE — GERÇEK PostgreSQL DOĞRULAMA MATRİSİ (56 kontrol)
--
-- ── NASIL KOŞULUR ────────────────────────────────────────────────────────
--   MSYS_NO_PATHCONV=1 docker exec -i -e PGPASSWORD=postgres \
--     supabase_db_<proje> psql -U postgres -d postgres \
--     < supabase/tests/057_mavi_reasoning_matrix.sql
--
-- ── NEDEN TRANSACTION İÇİNDE DEĞİL ───────────────────────────────────────
-- AUTOCOMMIT modda koşar: PostgreSQL'de `now()` bir işlem içinde SABİTTİR ve
-- süre dolumu donmuş bir saatle ölçülemez. Fixture sonda temizlenir.
--
-- ⚠️ Bu dosya ürün kodu DEĞİLDİR ve hiçbir migration onu çağırmaz.
--
-- ── 058 SONRASI NOT (ÖNEMLİ) ─────────────────────────────────────────────
-- Migration 058 üretim akışını bağladıktan sonra **kanıt yazmak tek başına
-- karar üretir**. Bu yüzden buradaki "elle `mavi_reason` çağır" adımları
-- artık çoğu zaman `DUPLICATE` döner — çünkü karar ZATEN otomatik üretilmiş
-- olur. Bu bir ürün hatası DEĞİL, akışın doğru çalıştığının kanıtıdır.
-- Etkilenen kontroller (C2 · E3 · F4) bu gerçeğe göre uyarlandı ve
-- `result` yerine ÜRETİLEN KARARIN kendisi sınanır.
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on
\pset pager off

-- ── FIXTURE ────────────────────────────────────────────────────────────
DELETE FROM public.vehicles WHERE company_id IN
  (SELECT id FROM public.companies WHERE name LIKE 'RSN_TEST_%');
DELETE FROM public.companies WHERE name LIKE 'RSN_TEST_%';

CREATE TEMP TABLE IF NOT EXISTS t_ids (k text PRIMARY KEY, v uuid);

DO $$
DECLARE ca uuid; cb uuid; va uuid; vb uuid; da uuid; db_ uuid; tr uuid;
BEGIN
  INSERT INTO public.companies (name) VALUES ('RSN_TEST_A') RETURNING id INTO ca;
  INSERT INTO public.companies (name) VALUES ('RSN_TEST_B') RETURNING id INTO cb;
  INSERT INTO public.vehicles (name, company_id) VALUES ('rsn-va', ca) RETURNING id INTO va;
  INSERT INTO public.vehicles (name, company_id) VALUES ('rsn-vb', cb) RETURNING id INTO vb;
  INSERT INTO public.fleet_drivers (company_id, display_name)
    VALUES (ca, 'RSN Driver A') RETURNING id INTO da;
  INSERT INTO public.fleet_drivers (company_id, display_name)
    VALUES (cb, 'RSN Driver B') RETURNING id INTO db_;
  INSERT INTO public.vehicle_trips (vehicle_id, trip_key, started_at, ended_at)
    VALUES (va, 'rsn-trip-1', now() - interval '2 hours', now() - interval '1 hour')
    RETURNING id INTO tr;

  INSERT INTO t_ids VALUES ('ca',ca),('cb',cb),('va',va),('vb',vb),
                           ('da',da),('db',db_),('tr',tr);
END $$;

CREATE OR REPLACE FUNCTION pg_temp.id(k text) RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT v FROM t_ids WHERE k = $1 $$;

-- Sonuç toplayıcı
CREATE TEMP TABLE IF NOT EXISTS t_res (code text PRIMARY KEY, ok boolean, detail text);

CREATE OR REPLACE FUNCTION pg_temp.chk(p_code text, p_ok boolean, p_detail text DEFAULT '')
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO t_res VALUES (p_code, p_ok, p_detail)
  ON CONFLICT (code) DO UPDATE SET ok = EXCLUDED.ok, detail = EXCLUDED.detail;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- A · KANIT ÇÖZÜMÜ (evidence resolution)
-- ═══════════════════════════════════════════════════════════════════════════

-- A1: kanıt yokken karar INSUFFICIENT_EVIDENCE olmalı ("veri yok = sorun yok" DEĞİL)
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.mavi_reason(
    pg_temp.id('ca'), 'VEHICLE_HEALTH', pg_temp.id('va'), NULL, NULL);
  PERFORM pg_temp.chk('A1',
    r.decision = 'INSUFFICIENT_EVIDENCE' AND r.confidence = 'UNKNOWN',
    format('decision=%s confidence=%s', r.decision, r.confidence));
END $$;

-- A2: kanıtsız karar SONUÇLANDIRICI olamaz (state UNKNOWN)
DO $$
DECLARE v_state text;
BEGIN
  SELECT state INTO v_state FROM public.mavi_reasoning
   WHERE company_id = pg_temp.id('ca') ORDER BY created_at DESC LIMIT 1;
  PERFORM pg_temp.chk('A2', v_state = 'UNKNOWN', format('state=%s', v_state));
END $$;

-- A3: kanıt yazılınca karar kanıtı GÖRÜR
DO $$
DECLARE r record;
BEGIN
  PERFORM public._ai_evidence_record(
    pg_temp.id('ca'), 'TELEMETRY', 'ENGINE', 'engine.rpm.max',
    pg_temp.id('va'), NULL, NULL, 'INFO', 'MEASURED', 3200, 8);
  SELECT * INTO r FROM public.mavi_reason(
    pg_temp.id('ca'), 'ENGINE', pg_temp.id('va'), NULL, NULL);
  PERFORM pg_temp.chk('A3', r.decision = 'SUPPORTED',
    format('decision=%s confidence=%s', r.decision, r.confidence));
END $$;

-- A4: kanıt sayısı ve kapsam kaydedildi (kapsam UYDURULMADI)
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.mavi_reasoning
   WHERE company_id = pg_temp.id('ca') AND intent = 'ENGINE'
   ORDER BY created_at DESC LIMIT 1;
  PERFORM pg_temp.chk('A4',
    r.evidence_count = 1 AND r.coverage_ratio = 1.0,
    format('n=%s coverage=%s', r.evidence_count, r.coverage_ratio));
END $$;

-- A5: KANIT BAĞI GERÇEK yabancı anahtardır
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.mavi_reasoning_evidence me
    JOIN public.mavi_reasoning m ON m.id = me.reasoning_id
   WHERE m.company_id = pg_temp.id('ca') AND m.intent = 'ENGINE';
  PERFORM pg_temp.chk('A5', n = 1, format('bag=%s', n));
END $$;

-- A6: BAŞKA öznenin kanıtı karara GİRMEZ
DO $$
DECLARE r record;
BEGIN
  PERFORM public._ai_evidence_record(
    pg_temp.id('cb'), 'TELEMETRY', 'ENGINE', 'engine.rpm.max',
    pg_temp.id('vb'), NULL, NULL, 'CRITICAL', 'MEASURED', 9000, 8);
  SELECT * INTO r FROM public.mavi_reasoning
   WHERE company_id = pg_temp.id('ca') AND intent = 'ENGINE'
   ORDER BY created_at DESC LIMIT 1;
  PERFORM pg_temp.chk('A6', r.evidence_count = 1 AND r.decision = 'SUPPORTED',
    format('n=%s decision=%s', r.evidence_count, r.decision));
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- B · KARAR ÇÖZÜMÜ (decision resolver)
-- ═══════════════════════════════════════════════════════════════════════════

-- B1: olumsuz kanıt (CRITICAL) → UNSUPPORTED
DO $$
DECLARE r record;
BEGIN
  PERFORM public._ai_evidence_record(
    pg_temp.id('ca'), 'TELEMETRY', 'TEMPERATURE', 'coolant.max_c',
    pg_temp.id('va'), NULL, NULL, 'CRITICAL', 'MEASURED', 121, 6);
  SELECT * INTO r FROM public.mavi_reason(
    pg_temp.id('ca'), 'TEMPERATURE', pg_temp.id('va'), NULL, NULL);
  PERFORM pg_temp.chk('B1', r.decision = 'UNSUPPORTED',
    format('decision=%s', r.decision));
END $$;

-- B2: güven kanıttan TÜRETİLDİ — tek kanıt MEDIUM tavanını aşamaz
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.mavi_reasoning
   WHERE company_id = pg_temp.id('ca') AND intent = 'TEMPERATURE'
   ORDER BY created_at DESC LIMIT 1;
  PERFORM pg_temp.chk('B2', r.confidence = 'MEDIUM',
    format('confidence=%s reason=%s', r.confidence, r.confidence_reason));
END $$;

-- B3: EKSİK KAPSAM güveni düşürür + gerekçe COVERAGE_INCOMPLETE
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.mavi_reason(
    pg_temp.id('ca'), 'VEHICLE_HEALTH', pg_temp.id('va'), NULL, NULL);
  PERFORM pg_temp.chk('B3',
    r.decision = 'UNSUPPORTED' AND r.confidence = 'LOW',
    format('decision=%s confidence=%s', r.decision, r.confidence));
END $$;

-- B4: gerekçe bounded KOD (serbest metin değil)
DO $$
DECLARE v_reason text;
BEGIN
  SELECT confidence_reason INTO v_reason FROM public.mavi_reasoning
   WHERE company_id = pg_temp.id('ca') AND intent = 'VEHICLE_HEALTH'
     AND evidence_count > 0 ORDER BY created_at DESC LIMIT 1;
  PERFORM pg_temp.chk('B4', v_reason = 'COVERAGE_INCOMPLETE',
    format('reason=%s', v_reason));
END $$;

-- B5: NİYET ÇÖZÜLEMEZSE karar UNKNOWN (kura çekilmez)
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.mavi_reason(
    pg_temp.id('ca'), NULL, pg_temp.id('va'), NULL, NULL);
  PERFORM pg_temp.chk('B5',
    r.decision = 'UNKNOWN',
    format('decision=%s', r.decision));
END $$;

-- B6: TEK aday niyet varsa TÜRETİLİR (sürücü öznesi yalnız DRIVER kanıtı taşır)
DO $$
DECLARE r record;
BEGIN
  PERFORM public._ai_evidence_record(
    pg_temp.id('ca'), 'DRIVER_DNA', 'DRIVER', 'dna.brake.score',
    NULL, pg_temp.id('da'), NULL, 'INFO', 'DERIVED', 72, 12);
  SELECT * INTO r FROM public.mavi_reason(
    pg_temp.id('ca'), NULL, NULL, pg_temp.id('da'), NULL);
  PERFORM pg_temp.chk('B6', r.decision IN ('SUPPORTED','UNSUPPORTED'),
    format('decision=%s', r.decision));
END $$;

-- B7: niyet UNKNOWN iken karar SONUÇLANDIRICI olamaz (CHECK)
DO $$
DECLARE v_bad integer;
BEGIN
  SELECT count(*) INTO v_bad FROM public.mavi_reasoning
   WHERE intent = 'UNKNOWN' AND decision IN ('SUPPORTED','UNSUPPORTED');
  PERFORM pg_temp.chk('B7', v_bad = 0, format('ihlal=%s', v_bad));
END $$;

-- B8: güveni bilinmeyen kanıt tek başına karar veremez
DO $$
DECLARE r record; v_id uuid;
BEGIN
  PERFORM public._ai_evidence_record(
    pg_temp.id('ca'), 'TELEMETRY', 'CONNECTIVITY', 'link.drop.count',
    pg_temp.id('va'), NULL, NULL, 'INFO', 'MEASURED', 4, 5);
  /* Kanıtın güvenini elle UNKNOWN'a çekmek 055 trigger'ı yüzünden mümkün
     değil; onun yerine ölçümsüz+bilinmeyen kalitede kanıt REDDEDİLİR. */
  SELECT public._ai_evidence_record(
    pg_temp.id('ca'), 'HEALTH_MONITOR', 'CONNECTIVITY', 'link.guess',
    pg_temp.id('va'), NULL, NULL, 'INFO', 'UNKNOWN', NULL, 0) INTO r;
  SELECT id INTO v_id FROM public.ai_evidence
   WHERE company_id = pg_temp.id('ca') AND metric = 'link.guess';
  PERFORM pg_temp.chk('B8',
    (SELECT state FROM public.ai_evidence WHERE id = v_id) = 'REJECTED',
    format('state=%s', (SELECT state FROM public.ai_evidence WHERE id = v_id)));
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- C · ÇELİŞKİ (conflict)
-- ═══════════════════════════════════════════════════════════════════════════

-- C1: iki KAYNAK aynı metriği farklı ölçerse → CONFLICTED_EVIDENCE
DO $$
DECLARE r record;
BEGIN
  PERFORM public._ai_evidence_record(
    pg_temp.id('ca'), 'TELEMETRY', 'FUEL', 'fuel.used_l',
    pg_temp.id('va'), NULL, NULL, 'INFO', 'MEASURED', 40, 6);
  PERFORM public._ai_evidence_record(
    pg_temp.id('ca'), 'TRIP_ENGINE', 'FUEL', 'fuel.used_l',
    pg_temp.id('va'), NULL, NULL, 'INFO', 'MEASURED', 70, 6);
  SELECT * INTO r FROM public.mavi_reason(
    pg_temp.id('ca'), 'FUEL', pg_temp.id('va'), NULL, NULL);
  PERFORM pg_temp.chk('C1', r.decision = 'CONFLICTED_EVIDENCE',
    format('decision=%s', r.decision));
END $$;

-- C2: çelişkide GÜVEN üretilmez
--     ⚠️ 058 sonrası aynı özne için birden fazla FUEL kararı olabilir (ilk
--     kanıt tek başına geldiğinde çelişki yoktu). ÇELİŞKİLİ olanı seçiyoruz.
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.mavi_reasoning
   WHERE company_id = pg_temp.id('ca') AND intent = 'FUEL' AND conflict_count > 0
   ORDER BY created_at DESC LIMIT 1;
  PERFORM pg_temp.chk('C2',
    r.id IS NOT NULL AND r.confidence = 'UNKNOWN'
    AND r.conflict_count > 0 AND r.state = 'CONFLICTED',
    format('conf=%s conflicts=%s state=%s',
           coalesce(r.confidence,'-'), coalesce(r.conflict_count,-1),
           coalesce(r.state,'-')));
END $$;

-- C3: çelişki varken SONUÇLANDIRICI karar YAZILAMAZ (CHECK)
DO $$
DECLARE v_err text := 'NO_ERROR';
BEGIN
  BEGIN
    UPDATE public.mavi_reasoning SET decision = 'SUPPORTED'
     WHERE company_id = pg_temp.id('ca') AND intent = 'FUEL' AND conflict_count > 0;
  EXCEPTION WHEN OTHERS THEN v_err := SQLSTATE;
  END;
  PERFORM pg_temp.chk('C3', v_err <> 'NO_ERROR', format('sqlstate=%s', v_err));
END $$;

-- C4: KÜÇÜK fark çelişki DEĞİLDİR (%10 eşiği)
DO $$
DECLARE r record;
BEGIN
  PERFORM public._ai_evidence_record(
    pg_temp.id('ca'), 'TELEMETRY', 'BATTERY', 'batt.volt',
    pg_temp.id('va'), NULL, NULL, 'INFO', 'MEASURED', 12.5, 6);
  PERFORM public._ai_evidence_record(
    pg_temp.id('ca'), 'BLACKBOX', 'BATTERY', 'batt.volt',
    pg_temp.id('va'), NULL, NULL, 'INFO', 'MEASURED', 12.6, 6);
  SELECT * INTO r FROM public.mavi_reason(
    pg_temp.id('ca'), 'BATTERY', pg_temp.id('va'), NULL, NULL);
  PERFORM pg_temp.chk('C4', r.decision = 'SUPPORTED',
    format('decision=%s', r.decision));
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- D · SÜRE DOLUMU (expiry)
-- ═══════════════════════════════════════════════════════════════════════════

-- D1: süresi dolmuş KANIT karara girmez → EXPIRED_EVIDENCE
DO $$
DECLARE r record;
BEGIN
  PERFORM public._ai_evidence_record(
    pg_temp.id('ca'), 'TELEMETRY', 'LOCATION', 'loc.samples',
    pg_temp.id('va'), NULL, NULL, 'INFO', 'MEASURED', 10, 5,
    now() - interval '40 days', interval '1 day');
  PERFORM public.expire_ai_evidence();
  SELECT * INTO r FROM public.mavi_reason(
    pg_temp.id('ca'), 'LOCATION', pg_temp.id('va'), NULL, NULL);
  PERFORM pg_temp.chk('D1',
    r.decision = 'EXPIRED_EVIDENCE' AND r.confidence = 'UNKNOWN',
    format('decision=%s', r.decision));
END $$;

-- D2: süresi dolan kanıt SİLİNMEDİ (geçmiş açıklanabilir kalır)
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.ai_evidence
   WHERE company_id = pg_temp.id('ca') AND metric = 'loc.samples' AND state = 'EXPIRED';
  PERFORM pg_temp.chk('D2', n = 1, format('expired_kanit=%s', n));
END $$;

-- D3: KARAR süresi dolunca EXPIRED olur — silinmez
UPDATE public.mavi_reasoning
   SET expires_at = created_at + interval '1 millisecond'
 WHERE company_id = pg_temp.id('ca') AND intent = 'ENGINE';

DO $$
DECLARE n integer; v_state text;
BEGIN
  SELECT public.expire_mavi_reasoning() INTO n;
  SELECT state INTO v_state FROM public.mavi_reasoning
   WHERE company_id = pg_temp.id('ca') AND intent = 'ENGINE';
  PERFORM pg_temp.chk('D3', n >= 1 AND v_state = 'EXPIRED',
    format('n=%s state=%s', n, v_state));
END $$;

-- D4: süre dolumu İDEMPOTENT (ikinci koşum 0)
DO $$
DECLARE n integer;
BEGIN
  SELECT public.expire_mavi_reasoning() INTO n;
  PERFORM pg_temp.chk('D4', n = 0, format('ikinci_kosum=%s', n));
END $$;

-- D5: süresi dolan kararın KANIT BAĞI korunur (zincir bozulmaz)
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.mavi_reasoning_evidence me
    JOIN public.mavi_reasoning m ON m.id = me.reasoning_id
   WHERE m.company_id = pg_temp.id('ca') AND m.intent = 'ENGINE' AND m.state = 'EXPIRED';
  PERFORM pg_temp.chk('D5', n = 1, format('bag=%s', n));
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- E · REPLAY / TEKİLLEŞTİRME (decision dedupe)
-- ═══════════════════════════════════════════════════════════════════════════

-- E1: aynı kanıtla ikinci düşünme YENİ karar açmaz
DO $$
DECLARE r record; n_before integer; n_after integer;
BEGIN
  SELECT count(*) INTO n_before FROM public.mavi_reasoning
   WHERE company_id = pg_temp.id('ca');
  SELECT * INTO r FROM public.mavi_reason(
    pg_temp.id('ca'), 'BATTERY', pg_temp.id('va'), NULL, NULL);
  SELECT count(*) INTO n_after FROM public.mavi_reasoning
   WHERE company_id = pg_temp.id('ca');
  PERFORM pg_temp.chk('E1',
    r.result = 'DUPLICATE' AND n_after = n_before,
    format('result=%s before=%s after=%s', r.result, n_before, n_after));
END $$;

-- E2: bastırılan tekrar SESSİZCE YUTULMAZ (sayaç arttı)
DO $$
DECLARE n integer;
BEGIN
  SELECT duplicate_count INTO n FROM public.mavi_reasoning_stat
   WHERE company_id = pg_temp.id('ca');
  PERFORM pg_temp.chk('E2', coalesce(n,0) >= 1, format('duplicate_count=%s', n));
END $$;

-- E3: KANIT DEĞİŞİRSE bu ARTIK BAŞKA KARARDIR (yeni kayıt)
--     ⚠️ 058 sonrası yeni kanıt kararı KENDİLİĞİNDEN üretir; bu yüzden
--     `result` yerine KARAR SAYISININ arttığı sınanır.
DO $$
DECLARE n_before integer; n_after integer;
BEGIN
  SELECT count(*) INTO n_before FROM public.mavi_reasoning
   WHERE company_id = pg_temp.id('ca') AND intent = 'BATTERY';
  PERFORM public._ai_evidence_record(
    pg_temp.id('ca'), 'DEEP_SCAN', 'BATTERY', 'batt.internal_res',
    pg_temp.id('va'), NULL, NULL, 'INFO', 'MEASURED', 7.2, 9);
  /* Elle çağrı da yapılır: DUPLICATE dönmesi otomatik akışın çalıştığını
     KANITLAR (aynı kanıt kümesi ikinci karar açmaz). */
  PERFORM public.mavi_reason(pg_temp.id('ca'), 'BATTERY', pg_temp.id('va'), NULL, NULL);
  SELECT count(*) INTO n_after FROM public.mavi_reasoning
   WHERE company_id = pg_temp.id('ca') AND intent = 'BATTERY';
  PERFORM pg_temp.chk('E3', n_after = n_before + 1,
    format('karar %s->%s (kanit degisti = yeni karar)', n_before, n_after));
END $$;

-- E4: tekilleştirme kilidi DB seviyesinde (elle çift kayıt imkânsız)
DO $$
DECLARE v_err text := 'NO_ERROR'; m record;
BEGIN
  SELECT * INTO m FROM public.mavi_reasoning
   WHERE company_id = pg_temp.id('ca') AND intent = 'BATTERY'
   ORDER BY created_at DESC LIMIT 1;
  BEGIN
    INSERT INTO public.mavi_reasoning
      (company_id, vehicle_id, intent, decision, confidence_reason,
       evidence_signature, evidence_count, expires_at, state)
    VALUES (m.company_id, m.vehicle_id, m.intent, 'UNKNOWN', 'NO_EVIDENCE',
            m.evidence_signature, 0, now() + interval '1 day', 'NEW');
  EXCEPTION WHEN unique_violation THEN v_err := 'UNIQUE';
  END;
  PERFORM pg_temp.chk('E4', v_err = 'UNIQUE', format('sonuc=%s', v_err));
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- F · KARAR ZİNCİRİ (reasoning chain)
-- ═══════════════════════════════════════════════════════════════════════════

-- F1: zincir DECISION → EVIDENCE → VEHICLE olarak kuruldu
DO $$
DECLARE n_dec integer; n_ev integer; n_veh integer; m uuid;
BEGIN
  SELECT id INTO m FROM public.mavi_reasoning
   WHERE company_id = pg_temp.id('ca') AND intent = 'BATTERY'
   ORDER BY created_at DESC LIMIT 1;
  SELECT count(*) FILTER (WHERE layer='DECISION'),
         count(*) FILTER (WHERE layer='EVIDENCE'),
         count(*) FILTER (WHERE layer='VEHICLE')
    INTO n_dec, n_ev, n_veh
    FROM public.mavi_reasoning_chain WHERE reasoning_id = m;
  PERFORM pg_temp.chk('F1', n_dec = 1 AND n_ev = 3 AND n_veh = 1,
    format('dec=%s ev=%s veh=%s', n_dec, n_ev, n_veh));
END $$;

-- F2: TRIP ucu kanıtın trip öznesinden çözülür
DO $$
DECLARE r record; m uuid; n integer;
BEGIN
  PERFORM public._ai_evidence_record(
    pg_temp.id('ca'), 'TRIP_ENGINE', 'TRIP', 'trip.distance_km',
    pg_temp.id('va'), NULL, pg_temp.id('tr'), 'INFO', 'MEASURED', 88.5, 4);
  SELECT * INTO r FROM public.mavi_reason(
    pg_temp.id('ca'), 'TRIP_STATUS', NULL, NULL, pg_temp.id('tr'));
  SELECT count(*) INTO n FROM public.mavi_reasoning_chain
   WHERE reasoning_id = r.reasoning_id AND layer = 'TRIP';
  PERFORM pg_temp.chk('F2', n = 1, format('trip_dugum=%s decision=%s', n, r.decision));
END $$;

-- F3: DRIVER_DNA ucu GERÇEK DNA kaydından çözülür — yoksa YAZILMAZ
DO $$
DECLARE r record; n integer;
BEGIN
  SELECT * INTO r FROM public.mavi_reasoning
   WHERE company_id = pg_temp.id('ca') AND intent = 'DRIVER'
   ORDER BY created_at DESC LIMIT 1;
  SELECT count(*) INTO n FROM public.mavi_reasoning_chain
   WHERE reasoning_id = r.id AND layer = 'DRIVER_DNA';
  /* Bu fixture'da DNA kaydı YOK → uç uydurulmamalı. */
  PERFORM pg_temp.chk('F3', n = 0, format('dna_dugum=%s (kayit yok, uydurulmadi)', n));
END $$;

-- F4: FLEET_INSIGHT ucu `ai_evidence_chain` bağı varsa çözülür
--     ⚠️ 058 sonrası ilk kanıt zaten bir karar üretir ve o anda henüz bağ
--     YOKTUR. Bağ kurulduktan sonra İKİNCİ bir kanıt eklenir: imza değişir,
--     yeni karar üretilir ve zincir artık içgörü ucunu ÇÖZEBİLİR.
DO $$
DECLARE v_ev uuid; r record; n integer; m uuid;
BEGIN
  PERFORM public._ai_evidence_record(
    pg_temp.id('ca'), 'FLEET_INTELLIGENCE', 'FLEET', 'FUEL_OUTLIER.ratio',
    pg_temp.id('va'), NULL, NULL, 'INFO', 'DERIVED', 1.4, 7);
  SELECT id INTO v_ev FROM public.ai_evidence
   WHERE company_id = pg_temp.id('ca') AND metric = 'FUEL_OUTLIER.ratio';
  PERFORM public._ai_evidence_link(v_ev, 'FLEET_INSIGHT', 'rsn-insight-1');

  /* Bağ kurulduktan SONRA kanıt kümesini değiştir → yeni karar → yeni zincir. */
  PERFORM public._ai_evidence_record(
    pg_temp.id('ca'), 'FLEET_INTELLIGENCE', 'FLEET', 'FUEL_OUTLIER.count',
    pg_temp.id('va'), NULL, NULL, 'INFO', 'DERIVED', 3, 7);

  SELECT id INTO m FROM public.mavi_reasoning
   WHERE company_id = pg_temp.id('ca') AND intent = 'FLEET'
   ORDER BY evidence_count DESC, created_at DESC LIMIT 1;
  SELECT count(*) INTO n FROM public.mavi_reasoning_chain
   WHERE reasoning_id = m AND layer = 'FLEET_INSIGHT';
  PERFORM pg_temp.chk('F4', n = 1, format('insight_dugum=%s', n));
END $$;

-- F5: kararın dayanağı DEĞİŞTİRİLEMEZ (kanıt imzası immutable)
DO $$
DECLARE v_err text := 'NO_ERROR';
BEGIN
  BEGIN
    UPDATE public.mavi_reasoning SET evidence_signature = 'sahte'
     WHERE company_id = pg_temp.id('ca') AND intent = 'FLEET';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  PERFORM pg_temp.chk('F5', v_err LIKE '%IMMUTABLE%', format('hata=%s', left(v_err,60)));
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- G · DURUM MAKİNESİ (state machine)
-- ═══════════════════════════════════════════════════════════════════════════

-- G1: sonuçlanmış karar sessizce BAŞKA sonuca çevrilemez
DO $$
DECLARE v_err text := 'NO_ERROR';
BEGIN
  BEGIN
    UPDATE public.mavi_reasoning SET state = 'UNSUPPORTED'
     WHERE company_id = pg_temp.id('ca') AND state = 'SUPPORTED';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  PERFORM pg_temp.chk('G1', v_err LIKE '%INVALID_TRANSITION%',
    format('hata=%s', left(v_err,60)));
END $$;

-- G2: EXPIRED terminaldir — diriltilemez
DO $$
DECLARE v_err text := 'NO_ERROR';
BEGIN
  BEGIN
    UPDATE public.mavi_reasoning SET state = 'ANALYZING'
     WHERE company_id = pg_temp.id('ca') AND state = 'EXPIRED';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  PERFORM pg_temp.chk('G2', v_err LIKE '%INVALID_TRANSITION%',
    format('hata=%s', left(v_err,60)));
END $$;

-- G3: geçersiz geçiş SESSİZCE YUTULMADI — sarmalayıcı yakalar ve SAYAR
--     (trigger tek başına sayamaz: RAISE, sayacı da geri alırdı)
DO $$
DECLARE v_res text; n integer; m uuid;
BEGIN
  SELECT id INTO m FROM public.mavi_reasoning
   WHERE company_id = pg_temp.id('ca') AND state = 'SUPPORTED' LIMIT 1;
  SELECT public.mavi_reasoning_transition(m, 'UNSUPPORTED') INTO v_res;
  SELECT invalid_transition_count INTO n FROM public.mavi_reasoning_stat
   WHERE company_id = pg_temp.id('ca');
  PERFORM pg_temp.chk('G3',
    v_res = 'INVALID_TRANSITION' AND coalesce(n,0) >= 1,
    format('sonuc=%s sayac=%s', v_res, n));
END $$;

-- G3b: GEÇERLİ geçiş sarmalayıcıdan uygulanır ve sayacı ARTIRMAZ
DO $$
DECLARE v_res text; n_before integer; n_after integer; m uuid;
BEGIN
  SELECT id INTO m FROM public.mavi_reasoning
   WHERE company_id = pg_temp.id('ca') AND state = 'SUPPORTED' LIMIT 1;
  SELECT invalid_transition_count INTO n_before FROM public.mavi_reasoning_stat
   WHERE company_id = pg_temp.id('ca');
  SELECT public.mavi_reasoning_transition(m, 'EXPIRED') INTO v_res;
  SELECT invalid_transition_count INTO n_after FROM public.mavi_reasoning_stat
   WHERE company_id = pg_temp.id('ca');
  PERFORM pg_temp.chk('G3b',
    v_res = 'APPLIED' AND n_after = n_before,
    format('sonuc=%s sayac %s->%s', v_res, n_before, n_after));
END $$;

-- G4: karar GERÇEKTEN NEW → ANALYZING → terminal yürüdü
--     (kestirme olsaydı ANALYZING'e hiç uğramazdı; kapı bunu reddeder)
DO $$
BEGIN
  PERFORM pg_temp.chk('G4',
    NOT public._reasoning_can_transition('NEW','SUPPORTED')
    AND public._reasoning_can_transition('NEW','ANALYZING')
    AND public._reasoning_can_transition('ANALYZING','CONFLICTED'), '');
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- H · CROSS-TENANT · SAHİPLİK · DEVİR
-- ═══════════════════════════════════════════════════════════════════════════

-- H1: BAŞKA şirketin aracı için karar REDDEDİLİR
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.mavi_reason(
    pg_temp.id('ca'), 'ENGINE', pg_temp.id('vb'), NULL, NULL);
  PERFORM pg_temp.chk('H1', r.result = 'REJECTED' AND r.reasoning_id IS NULL,
    format('result=%s', r.result));
END $$;

-- H2: BAŞKA şirketin sürücüsü için karar REDDEDİLİR
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.mavi_reason(
    pg_temp.id('ca'), 'DRIVER', NULL, pg_temp.id('db'), NULL);
  PERFORM pg_temp.chk('H2', r.result = 'REJECTED', format('result=%s', r.result));
END $$;

-- H3: ÖZNESİZ istek REDDEDİLİR
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.mavi_reason(pg_temp.id('ca'), 'FLEET', NULL, NULL, NULL);
  PERFORM pg_temp.chk('H3', r.result = 'REJECTED', format('result=%s', r.result));
END $$;

-- H4: reddedilen istek SESSİZCE YUTULMADI
DO $$
DECLARE n integer;
BEGIN
  SELECT rejected_request_count INTO n FROM public.mavi_reasoning_stat
   WHERE company_id = pg_temp.id('ca');
  PERFORM pg_temp.chk('H4', coalesce(n,0) >= 3, format('rejected_request=%s', n));
END $$;

-- H5: DEVİR — araç B şirketine geçince A'nın kanıtı B'nin kararına GİRMEZ
UPDATE public.vehicles SET company_id = pg_temp.id('cb') WHERE id = pg_temp.id('va');

DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.mavi_reason(
    pg_temp.id('cb'), 'TEMPERATURE', pg_temp.id('va'), NULL, NULL);
  PERFORM pg_temp.chk('H5',
    r.decision = 'INSUFFICIENT_EVIDENCE',
    format('decision=%s (devralan sirket eski kaniti GORMEZ)', r.decision));
END $$;

-- H6: DEVİR sonrası ESKİ şirketin kararı ve kanıtı SİLİNMEZ
DO $$
DECLARE n_dec integer; n_ev integer;
BEGIN
  SELECT count(*) INTO n_dec FROM public.mavi_reasoning
   WHERE company_id = pg_temp.id('ca') AND vehicle_id = pg_temp.id('va');
  SELECT count(*) INTO n_ev FROM public.ai_evidence
   WHERE company_id = pg_temp.id('ca') AND vehicle_id = pg_temp.id('va');
  PERFORM pg_temp.chk('H6', n_dec > 0 AND n_ev > 0,
    format('eski_karar=%s eski_kanit=%s', n_dec, n_ev));
END $$;

-- H7: DEVİR sonrası eski şirket için YENİ karar artık REDDEDİLİR
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.mavi_reason(
    pg_temp.id('ca'), 'ENGINE', pg_temp.id('va'), NULL, NULL);
  PERFORM pg_temp.chk('H7', r.result = 'REJECTED', format('result=%s', r.result));
END $$;

UPDATE public.vehicles SET company_id = pg_temp.id('ca') WHERE id = pg_temp.id('va');

-- ═══════════════════════════════════════════════════════════════════════════
-- I · FAIL-CLOSED · YETKİ · LLM YOKLUĞU
-- ═══════════════════════════════════════════════════════════════════════════

-- I1: anon karar tablolarını OKUYAMAZ
DO $$
DECLARE v_bad text := '';
BEGIN
  IF has_table_privilege('anon','public.mavi_reasoning','SELECT') THEN v_bad := 'mavi_reasoning'; END IF;
  IF has_table_privilege('anon','public.mavi_reasoning_chain','SELECT') THEN v_bad := v_bad||' chain'; END IF;
  PERFORM pg_temp.chk('I1', v_bad = '', format('sizinti=%s', v_bad));
END $$;

-- I2: authenticated karar YAZAMAZ (karar olmaktan çıkardı)
DO $$
DECLARE v_bad boolean;
BEGIN
  v_bad := has_table_privilege('authenticated','public.mavi_reasoning','INSERT')
        OR has_table_privilege('authenticated','public.mavi_reasoning','UPDATE')
        OR has_table_privilege('authenticated','public.mavi_reasoning','DELETE');
  PERFORM pg_temp.chk('I2', NOT v_bad, format('yazabiliyor=%s', v_bad));
END $$;

-- I3: istemci karar TETİKLEYEMEZ
DO $$
DECLARE v_bad boolean;
BEGIN
  v_bad := has_function_privilege('authenticated',
    'public.mavi_reason(uuid,text,uuid,uuid,uuid,interval)','EXECUTE');
  PERFORM pg_temp.chk('I3', NOT v_bad, format('tetikleyebiliyor=%s', v_bad));
END $$;

-- I4: oturumsuz okuma BOŞ döner (fail-closed)
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.get_reasoning_summary();
  PERFORM pg_temp.chk('I4', n = 0, format('satir=%s (auth.uid() NULL)', n));
END $$;

-- I5: karar tablosunda DOĞAL DİL kolonu YOK
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema='public' AND table_name='mavi_reasoning'
     AND column_name IN ('title','message','explanation','summary','answer',
                         'text','recommendation','advice');
  PERFORM pg_temp.chk('I5', n = 0, format('dogal_dil_kolonu=%s', n));
END $$;

-- I6: karar üretiminde DIŞ ÇAĞRI (LLM) yok
DO $$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='mavi_reason';
  PERFORM pg_temp.chk('I6',
    v_def NOT LIKE '%http%' AND v_def NOT LIKE '%openrouter%'
    AND v_def NOT LIKE '%gemini%' AND v_def NOT LIKE '%anthropic%', '');
END $$;

-- I7: güven ELLE yazılamaz — trigger yeniden türetir
DO $$
DECLARE v_conf text;
BEGIN
  UPDATE public.mavi_reasoning SET confidence = 'VERY_HIGH'
   WHERE company_id = pg_temp.id('ca') AND intent = 'TEMPERATURE';
  SELECT confidence INTO v_conf FROM public.mavi_reasoning
   WHERE company_id = pg_temp.id('ca') AND intent = 'TEMPERATURE';
  PERFORM pg_temp.chk('I7', v_conf = 'MEDIUM', format('confidence=%s', v_conf));
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- J · MEVCUT KATMAN REGRESYONU (karar omurgası hiçbir şeyi bozmadı)
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  PERFORM pg_temp.chk('J1', public._evidence_confidence('BLACKBOX','MEASURED',1) = 'MEDIUM',
    '055 guven kapisi');
  PERFORM pg_temp.chk('J2', public._dna_status(4, 500) = 'NO_DNA', '053 DNA esigi');
  PERFORM pg_temp.chk('J3',
    public._fleet_insight_confidence(50, 1, 100, 50) NOT IN ('HIGH','VERY_HIGH'),
    '054 FI guven kapisi');
END $$;

DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public._resolve_driver_presence(
    gen_random_uuid(), gen_random_uuid(), now() - interval '1 hour', now(), NULL);
  PERFORM pg_temp.chk('J4', r.decision = 'NO_PRESENCE', '052/049 presence resolver');
END $$;

DO $$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='_trip_attribution_trigger';
  PERFORM pg_temp.chk('J5',
    v_def LIKE '%_resolve_trip_driver%' AND v_def NOT LIKE '%mavi_reasoning%',
    'attribution zinciri');
END $$;

-- ── SONUÇ ──────────────────────────────────────────────────────────────
SELECT code, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS sonuc, detail
  FROM t_res ORDER BY code;

SELECT count(*) FILTER (WHERE ok) AS pass,
       count(*) FILTER (WHERE NOT ok) AS fail,
       count(*) AS toplam
  FROM t_res;

-- ── TEMİZLİK ───────────────────────────────────────────────────────────
DELETE FROM public.vehicles WHERE company_id IN
  (SELECT id FROM public.companies WHERE name LIKE 'RSN_TEST_%');
DELETE FROM public.companies WHERE name LIKE 'RSN_TEST_%';
