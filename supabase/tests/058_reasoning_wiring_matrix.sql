-- ═══════════════════════════════════════════════════════════════════════════
-- 058 MAVI REASONING PRODUCTION WIRING — GERÇEK PostgreSQL DOĞRULAMA MATRİSİ
--
-- ── NASIL KOŞULUR ────────────────────────────────────────────────────────
--   MSYS_NO_PATHCONV=1 docker exec -i -e PGPASSWORD=postgres \
--     supabase_db_<proje> psql -U postgres -d postgres \
--     < supabase/tests/058_reasoning_wiring_matrix.sql
--
-- ── NEDEN TRANSACTION İÇİNDE DEĞİL ───────────────────────────────────────
-- AUTOCOMMIT: `now()` bir işlem içinde SABİTTİR; kuyruk gecikmesi ve süre
-- dolumu donmuş saatle ölçülemez. Fixture sonda temizlenir.
--
-- ⚠️ Bu dosya ürün kodu DEĞİLDİR ve hiçbir migration onu çağırmaz.
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on
\pset pager off

-- ── FIXTURE ────────────────────────────────────────────────────────────
DELETE FROM public.vehicles WHERE company_id IN
  (SELECT id FROM public.companies WHERE name LIKE 'WIR_TEST_%');
DELETE FROM public.companies WHERE name LIKE 'WIR_TEST_%';

CREATE TEMP TABLE IF NOT EXISTS w_ids (k text PRIMARY KEY, v uuid);

DO $$
DECLARE ca uuid; cb uuid; va uuid; vb uuid; da uuid; db_ uuid;
BEGIN
  INSERT INTO public.companies (name) VALUES ('WIR_TEST_A') RETURNING id INTO ca;
  INSERT INTO public.companies (name) VALUES ('WIR_TEST_B') RETURNING id INTO cb;
  INSERT INTO public.vehicles (name, company_id) VALUES ('wir-va', ca) RETURNING id INTO va;
  INSERT INTO public.vehicles (name, company_id) VALUES ('wir-vb', cb) RETURNING id INTO vb;
  INSERT INTO public.fleet_drivers (company_id, display_name)
    VALUES (ca, 'WIR Driver A') RETURNING id INTO da;
  INSERT INTO public.fleet_drivers (company_id, display_name)
    VALUES (cb, 'WIR Driver B') RETURNING id INTO db_;
  INSERT INTO w_ids VALUES ('ca',ca),('cb',cb),('va',va),('vb',vb),('da',da),('db',db_);
END $$;

CREATE OR REPLACE FUNCTION pg_temp.id(k text) RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT v FROM w_ids WHERE k = $1 $$;

CREATE TEMP TABLE IF NOT EXISTS w_res (code text PRIMARY KEY, ok boolean, detail text);

CREATE OR REPLACE FUNCTION pg_temp.chk(p_code text, p_ok boolean, p_detail text DEFAULT '')
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO w_res VALUES (p_code, p_ok, p_detail)
  ON CONFLICT (code) DO UPDATE SET ok = EXCLUDED.ok, detail = EXCLUDED.detail;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- A · TRIP COMPLETION otomatik tetikliyor mu
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE tr uuid; n integer;
BEGIN
  INSERT INTO public.vehicle_trips (vehicle_id, trip_key, started_at, ended_at)
  VALUES (pg_temp.id('va'), 'wir-trip-1', now()-interval '2 hours', now()-interval '1 hour')
  RETURNING id INTO tr;
  INSERT INTO w_ids VALUES ('tr', tr) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v;

  SELECT count(*) INTO n FROM public.mavi_reasoning_event
   WHERE company_id = pg_temp.id('ca') AND event_type = 'TRIP_COMPLETED';
  PERFORM pg_temp.chk('A1', n = 1, format('olay=%s (ELLE CAGRI YOK)', n));
END $$;

-- A2: olay GERÇEKTEN işlendi ve bir karar üretti
DO $$
DECLARE e record;
BEGIN
  SELECT * INTO e FROM public.mavi_reasoning_event
   WHERE company_id = pg_temp.id('ca') AND event_type = 'TRIP_COMPLETED'
   ORDER BY enqueued_at DESC LIMIT 1;
  PERFORM pg_temp.chk('A2',
    e.state = 'COMPLETED' AND e.reasoning_id IS NOT NULL AND e.result = 'RECORDED',
    format('state=%s result=%s karar=%s', e.state, e.result,
           (e.reasoning_id IS NOT NULL)));
END $$;

-- A3: dispatcher DOĞRU resolver'a gönderdi
DO $$
DECLARE e record;
BEGIN
  SELECT * INTO e FROM public.mavi_reasoning_event
   WHERE company_id = pg_temp.id('ca') AND event_type = 'TRIP_COMPLETED'
   ORDER BY enqueued_at DESC LIMIT 1;
  PERFORM pg_temp.chk('A3', e.intent = 'TRIP_STATUS' AND e.resolver = 'TRIP',
    format('intent=%s resolver=%s', e.intent, e.resolver));
END $$;

-- A4: kuyruk GECİKMESİ ölçüldü (uydurulmadı)
DO $$
DECLARE e record;
BEGIN
  SELECT * INTO e FROM public.mavi_reasoning_event
   WHERE company_id = pg_temp.id('ca') AND event_type = 'TRIP_COMPLETED'
   ORDER BY enqueued_at DESC LIMIT 1;
  PERFORM pg_temp.chk('A4',
    e.started_at IS NOT NULL AND e.finished_at IS NOT NULL
    AND e.finished_at >= e.started_at,
    format('started=%s finished=%s', (e.started_at IS NOT NULL),
           (e.finished_at IS NOT NULL)));
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- B · EVIDENCE olayları
-- ═══════════════════════════════════════════════════════════════════════════

-- B1: kanıt eklenince EVIDENCE_ADDED otomatik tetiklenir
DO $$
DECLARE n integer;
BEGIN
  PERFORM public._ai_evidence_record(
    pg_temp.id('ca'),'TELEMETRY','TEMPERATURE','coolant.max_c',
    pg_temp.id('va'),NULL,NULL,'CRITICAL','MEASURED',121,6);
  SELECT count(*) INTO n FROM public.mavi_reasoning_event
   WHERE company_id = pg_temp.id('ca') AND event_type = 'EVIDENCE_ADDED';
  PERFORM pg_temp.chk('B1', n >= 1, format('olay=%s', n));
END $$;

-- B2: kanıt olayı niyeti KANITIN kategorisinden aldı
DO $$
DECLARE e record;
BEGIN
  SELECT * INTO e FROM public.mavi_reasoning_event
   WHERE company_id = pg_temp.id('ca') AND event_type = 'EVIDENCE_ADDED'
   ORDER BY enqueued_at DESC LIMIT 1;
  PERFORM pg_temp.chk('B2',
    e.intent = 'TEMPERATURE' AND e.resolver = 'VEHICLE' AND e.state = 'COMPLETED',
    format('intent=%s resolver=%s state=%s', e.intent, e.resolver, e.state));
END $$;

-- B3: üretilen karar KANITA dayanıyor ve olumsuz kanıtı gördü
DO $$
DECLARE m record;
BEGIN
  SELECT r.* INTO m FROM public.mavi_reasoning r
    JOIN public.mavi_reasoning_event e ON e.reasoning_id = r.id
   WHERE e.company_id = pg_temp.id('ca') AND e.event_type = 'EVIDENCE_ADDED'
   ORDER BY e.enqueued_at DESC LIMIT 1;
  PERFORM pg_temp.chk('B3',
    m.decision = 'UNSUPPORTED' AND m.evidence_count > 0 AND m.confidence <> 'UNKNOWN',
    format('decision=%s n=%s conf=%s', m.decision, m.evidence_count, m.confidence));
END $$;

-- B4: kanıt SÜRESİ DOLUNCA EVIDENCE_EXPIRED tetiklenir
DO $$
DECLARE n integer;
BEGIN
  PERFORM public._ai_evidence_record(
    pg_temp.id('ca'),'TELEMETRY','LOCATION','loc.samples',
    pg_temp.id('va'),NULL,NULL,'INFO','MEASURED',10,5,
    now() - interval '40 days', interval '1 day');
  PERFORM public.expire_ai_evidence();
  SELECT count(*) INTO n FROM public.mavi_reasoning_event
   WHERE company_id = pg_temp.id('ca') AND event_type = 'EVIDENCE_EXPIRED';
  PERFORM pg_temp.chk('B4', n >= 1, format('olay=%s', n));
END $$;

-- B5: kanıt GERİ ÇEKİLİNCE EVIDENCE_RETRACTED tetiklenir
DO $$
DECLARE v_id uuid; n integer;
BEGIN
  PERFORM public._ai_evidence_record(
    pg_temp.id('ca'),'DEEP_SCAN','DIAGNOSTIC','dtc.count',
    pg_temp.id('va'),NULL,NULL,'NOTICE','MEASURED',2,7);
  SELECT id INTO v_id FROM public.ai_evidence
   WHERE company_id = pg_temp.id('ca') AND metric = 'dtc.count';
  UPDATE public.ai_evidence SET state = 'SUPERSEDED' WHERE id = v_id;
  SELECT count(*) INTO n FROM public.mavi_reasoning_event
   WHERE company_id = pg_temp.id('ca') AND event_type = 'EVIDENCE_RETRACTED';
  PERFORM pg_temp.chk('B5', n >= 1, format('olay=%s', n));
END $$;

-- B6: REDDEDİLEN kanıt karar TETİKLEMEZ (kanıt değildir)
DO $$
DECLARE n_before integer; n_after integer;
BEGIN
  SELECT count(*) INTO n_before FROM public.mavi_reasoning_event
   WHERE company_id = pg_temp.id('ca');
  /* Ölçümsüz + bilinmeyen kalite → 055 kapısı REJECTED yazar. */
  PERFORM public._ai_evidence_record(
    pg_temp.id('ca'),'HEALTH_MONITOR','CONNECTIVITY','link.guess',
    pg_temp.id('va'),NULL,NULL,'INFO','UNKNOWN',NULL,0);
  SELECT count(*) INTO n_after FROM public.mavi_reasoning_event
   WHERE company_id = pg_temp.id('ca');
  PERFORM pg_temp.chk('B6', n_after = n_before,
    format('olay %s->%s (reddedilen kanit tetiklemedi)', n_before, n_after));
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- C · DRIVER DNA · FLEET INSIGHT · PRESENCE · AUTH · IDENTITY · HEALTH
-- ═══════════════════════════════════════════════════════════════════════════

-- C1: DNA güncellenince DRIVER_DNA_UPDATED tetiklenir
DO $$
DECLARE n integer;
BEGIN
  INSERT INTO public.driver_dna (company_id, driver_id, trip_count, total_distance_km)
  VALUES (pg_temp.id('ca'), pg_temp.id('da'), 12, 900);
  SELECT count(*) INTO n FROM public.mavi_reasoning_event
   WHERE company_id = pg_temp.id('ca') AND event_type = 'DRIVER_DNA_UPDATED';
  PERFORM pg_temp.chk('C1', n = 1, format('olay=%s', n));
END $$;

-- C2: DNA olayı DRIVER resolver'a gitti ve sürücü öznesine bağlandı
DO $$
DECLARE e record;
BEGIN
  SELECT * INTO e FROM public.mavi_reasoning_event
   WHERE company_id = pg_temp.id('ca') AND event_type = 'DRIVER_DNA_UPDATED'
   ORDER BY enqueued_at DESC LIMIT 1;
  PERFORM pg_temp.chk('C2',
    e.resolver = 'DRIVER' AND e.driver_id = pg_temp.id('da')
    AND e.state IN ('COMPLETED','SKIPPED'),
    format('resolver=%s state=%s', e.resolver, e.state));
END $$;

-- C3: PRESENCE değişimi tetikler
DO $$
DECLARE n integer;
BEGIN
  INSERT INTO public.vehicle_driver_presence
    (company_id, vehicle_id, driver_id, source, confidence,
     detected_at, expires_at, received_at)
  VALUES (pg_temp.id('ca'), pg_temp.id('va'), pg_temp.id('da'),
          'HEAD_UNIT', 'MEDIUM', now(), now() + interval '2 hours', now())
  ON CONFLICT DO NOTHING;
  SELECT count(*) INTO n FROM public.mavi_reasoning_event
   WHERE company_id = pg_temp.id('ca') AND event_type = 'DRIVER_PRESENCE_CHANGED';
  PERFORM pg_temp.chk('C3', n >= 1, format('olay=%s', n));
EXCEPTION WHEN OTHERS THEN
  /* Presence şeması bu fixture ile uyuşmazsa test ATLANMAZ, düşer. */
  PERFORM pg_temp.chk('C3', false, left(SQLERRM, 80));
END $$;

-- C4: FLEET HEALTH güncellenince tetiklenir ve ARAÇ öznesine bağlanır
DO $$
DECLARE e record;
BEGIN
  INSERT INTO public.fleet_health (company_id, dimension, state, confidence)
  VALUES (pg_temp.id('ca'), 'VEHICLE_HEALTH', 'UNKNOWN', 'UNKNOWN')
  ON CONFLICT DO NOTHING;
  SELECT * INTO e FROM public.mavi_reasoning_event
   WHERE company_id = pg_temp.id('ca') AND event_type = 'HEALTH_SNAPSHOT_UPDATED'
   ORDER BY enqueued_at DESC LIMIT 1;
  PERFORM pg_temp.chk('C4',
    e.id IS NOT NULL AND e.resolver = 'FLEET' AND e.vehicle_id IS NOT NULL,
    format('resolver=%s veh=%s', e.resolver, (e.vehicle_id IS NOT NULL)));
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp.chk('C4', false, left(SQLERRM, 80));
END $$;

-- C5: VEHICLE IDENTITY değişimi tetikler
DO $$
DECLARE n integer;
BEGIN
  INSERT INTO public.vehicle_identity (vehicle_id, fingerprint_hash)
  VALUES (pg_temp.id('va'), 'wir-fp-1')
  ON CONFLICT (vehicle_id) DO UPDATE SET fingerprint_hash = 'wir-fp-2';
  SELECT count(*) INTO n FROM public.mavi_reasoning_event
   WHERE company_id = pg_temp.id('ca') AND event_type = 'VEHICLE_IDENTITY_CHANGED';
  PERFORM pg_temp.chk('C5', n >= 1, format('olay=%s', n));
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp.chk('C5', false, left(SQLERRM, 80));
END $$;

-- C6: CONNECTIVITY yalnız SESSİZLİKTEN DÖNÜŞTE tetiklenir (gürültü yok)
UPDATE public.vehicles SET last_seen = now() - interval '1 hour'
 WHERE id = pg_temp.id('va');
UPDATE public.vehicles SET last_seen = now() WHERE id = pg_temp.id('va');

DO $$
DECLARE n_gap integer; n_after integer;
BEGIN
  SELECT count(*) INTO n_gap FROM public.mavi_reasoning_event
   WHERE company_id = pg_temp.id('ca') AND event_type = 'VEHICLE_CONNECTIVITY_CHANGED';
  /* Hemen ardından gelen tazeleme YENİ olay üretmemeli (10 dk altı). */
  UPDATE public.vehicles SET last_seen = now() + interval '5 seconds'
   WHERE id = pg_temp.id('va');
  SELECT count(*) INTO n_after FROM public.mavi_reasoning_event
   WHERE company_id = pg_temp.id('ca') AND event_type = 'VEHICLE_CONNECTIVITY_CHANGED';
  PERFORM pg_temp.chk('C6', n_gap >= 1 AND n_after = n_gap,
    format('sessizlik_donusu=%s sonraki_tazeleme_sonrasi=%s', n_gap, n_after));
END $$;

-- C7: CONNECTIVITY olayı HOT-PATH'e girmedi (kuyruğa alındı, dispatch edilmedi)
DO $$
DECLARE e record;
BEGIN
  SELECT * INTO e FROM public.mavi_reasoning_event
   WHERE company_id = pg_temp.id('ca') AND event_type = 'VEHICLE_CONNECTIVITY_CHANGED'
   ORDER BY enqueued_at DESC LIMIT 1;
  PERFORM pg_temp.chk('C7', e.state = 'PENDING' AND e.started_at IS NULL,
    format('state=%s (telemetri yoluna karar sokulmadi)', e.state));
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- D · BOUNDED DEDUPE (aynı olay 20 kez)
-- ═══════════════════════════════════════════════════════════════════════════

-- D1: aynı olay 20 kez gelirse TEK iş açılır
DO $$
DECLARE i integer; n_rows integer; v_supp integer;
BEGIN
  /* Bekleyen bir iş oluştur (dispatch edilmeyen connectivity olayı zaten
     PENDING); aynı özne+niyet için 20 kez daha tetikle. */
  FOR i IN 1..20 LOOP
    PERFORM public._reasoning_enqueue(
      pg_temp.id('ca'), 'VEHICLE_CONNECTIVITY_CHANGED',
      pg_temp.id('va'), NULL, NULL);
  END LOOP;

  SELECT count(*), max(suppressed_count) INTO n_rows, v_supp
    FROM public.mavi_reasoning_event
   WHERE company_id = pg_temp.id('ca')
     AND event_type = 'VEHICLE_CONNECTIVITY_CHANGED'
     AND state IN ('PENDING','RUNNING','RETRY_PENDING');
  PERFORM pg_temp.chk('D1', n_rows = 1 AND v_supp >= 20,
    format('acik_is=%s bastirilan=%s', n_rows, v_supp));
END $$;

-- D2: bastırma SESSİZCE yutulmadı — `DEDUPED` sonucu döndü
DO $$
DECLARE q record;
BEGIN
  SELECT * INTO q FROM public._reasoning_enqueue(
    pg_temp.id('ca'), 'VEHICLE_CONNECTIVITY_CHANGED', pg_temp.id('va'), NULL, NULL);
  PERFORM pg_temp.chk('D2', q.result = 'DEDUPED', format('sonuc=%s', q.result));
END $$;

-- D3: iş BİTİNCE dedupe penceresi kapanır (yeni olay yeni iş açar)
DO $$
DECLARE v_res text; n integer;
BEGIN
  SELECT completed INTO n FROM public.run_mavi_reasoning_queue(50);
  SELECT count(*) INTO n FROM public.mavi_reasoning_event
   WHERE company_id = pg_temp.id('ca')
     AND event_type = 'VEHICLE_CONNECTIVITY_CHANGED'
     AND state IN ('PENDING','RUNNING','RETRY_PENDING');
  PERFORM pg_temp.chk('D3', n = 0, format('acik_is=%s (kuyruk bosaldi)', n));
END $$;

-- D4: farklı NİYET ayrı iştir (dedupe niyeti ezmez)
DO $$
DECLARE q1 record; q2 record;
BEGIN
  SELECT * INTO q1 FROM public._reasoning_enqueue(
    pg_temp.id('ca'), 'LOCATION_STATE_CHANGED', pg_temp.id('va'), NULL, NULL);
  SELECT * INTO q2 FROM public._reasoning_enqueue(
    pg_temp.id('ca'), 'VEHICLE_IDENTITY_CHANGED', pg_temp.id('va'), NULL, NULL);
  PERFORM pg_temp.chk('D4',
    q1.result = 'ENQUEUED' AND q2.result = 'ENQUEUED'
    AND q1.event_id <> q2.event_id,
    format('loc=%s identity=%s', q1.result, q2.result));
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- E · DISPATCHER (varsayılan resolver yasak)
-- ═══════════════════════════════════════════════════════════════════════════

-- E1: 057'nin BÜTÜN niyetleri bir resolver'a eşlenmiş
DO $$
DECLARE r record; v_bad text := '';
BEGIN
  FOR r IN SELECT unnest(ARRAY[
      'VEHICLE_HEALTH','TRIP_STATUS','LOCATION','CONNECTIVITY','FUEL','ENGINE',
      'TEMPERATURE','BATTERY','DRIVER','FLEET','DIAGNOSTIC','UNKNOWN']) AS i
  LOOP
    IF public._reasoning_resolver_for_intent(r.i) IS NULL THEN
      v_bad := v_bad || ' ' || r.i;
    END IF;
  END LOOP;
  PERFORM pg_temp.chk('E1', v_bad = '', format('eslenmeyen=%s', v_bad));
END $$;

-- E2: VARSAYILAN RESOLVER YOK — bilinmeyen niyet yutulmuyor
DO $$
BEGIN
  PERFORM pg_temp.chk('E2',
    public._reasoning_resolver_for_intent('SOMETHING_NEW') IS NULL
    AND public._reasoning_resolver_for_intent(NULL) IS NULL, '');
END $$;

-- E3: her niyet DOĞRU resolver'a gidiyor
DO $$
BEGIN
  PERFORM pg_temp.chk('E3',
    public._reasoning_resolver_for_intent('TEMPERATURE') = 'VEHICLE'
    AND public._reasoning_resolver_for_intent('DRIVER') = 'DRIVER'
    AND public._reasoning_resolver_for_intent('LOCATION') = 'TRIP'
    AND public._reasoning_resolver_for_intent('FLEET') = 'FLEET'
    AND public._reasoning_resolver_for_intent('DIAGNOSTIC') = 'DIAGNOSTIC'
    AND public._reasoning_resolver_for_intent('UNKNOWN') = 'UNKNOWN', '');
END $$;

-- E4: ÖZNESİZ iş karar UYDURMAZ → SKIPPED (gerekçesiyle)
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public._reasoning_resolve(
    'DRIVER', pg_temp.id('ca'), 'DRIVER', pg_temp.id('va'), NULL, NULL);
  PERFORM pg_temp.chk('E4',
    r.outcome = 'SKIPPED' AND r.skip_reason = 'NO_DRIVER_SUBJECT'
    AND r.reasoning_id IS NULL,
    format('outcome=%s reason=%s', r.outcome, r.skip_reason));
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- F · EŞZAMANLILIK VE RETRY
-- ═══════════════════════════════════════════════════════════════════════════

-- F1: aynı olay iki kez çalıştırılamaz
DO $$
DECLARE q record; r1 text; r2 text;
BEGIN
  SELECT * INTO q FROM public._reasoning_enqueue(
    pg_temp.id('ca'), 'VEHICLE_IDENTITY_CHANGED', pg_temp.id('va'), NULL, NULL);
  IF q.result <> 'ENQUEUED' THEN
    /* Açık iş varsa önce boşalt. */
    PERFORM public.run_mavi_reasoning_queue(50);
    SELECT * INTO q FROM public._reasoning_enqueue(
      pg_temp.id('ca'), 'VEHICLE_IDENTITY_CHANGED', pg_temp.id('va'), NULL, NULL);
  END IF;
  r1 := public._reasoning_dispatch(q.event_id);
  r2 := public._reasoning_dispatch(q.event_id);
  PERFORM pg_temp.chk('F1', r1 <> 'ALREADY_RUNNING' AND r2 = 'ALREADY_RUNNING',
    format('birinci=%s ikinci=%s', r1, r2));
END $$;

-- F2: koşucu bekleyen işleri işler ve sayaç döndürür
DO $$
DECLARE q record; r record;
BEGIN
  PERFORM public._reasoning_enqueue(
    pg_temp.id('ca'), 'LOCATION_STATE_CHANGED', pg_temp.id('va'), NULL, NULL);
  SELECT * INTO r FROM public.run_mavi_reasoning_queue(50);
  PERFORM pg_temp.chk('F2', r.processed >= 1,
    format('islenen=%s tamamlanan=%s', r.processed, r.completed));
END $$;

-- F3: koşucu İDEMPOTENT — bekleyen iş yoksa 0 işler
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.run_mavi_reasoning_queue(50);
  PERFORM pg_temp.chk('F3', r.processed = 0, format('ikinci_kosum=%s', r.processed));
END $$;

-- F4: deneme tavanı SINIRLI (sonsuz kuyruk yok)
DO $$
DECLARE e record;
BEGIN
  SELECT * INTO e FROM public.mavi_reasoning_event
   WHERE company_id = pg_temp.id('ca') ORDER BY enqueued_at DESC LIMIT 1;
  PERFORM pg_temp.chk('F4', e.attempts <= 5, format('deneme=%s', e.attempts));
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- G · HATA YALITIMI (ana işlem bozulmaz)
-- ═══════════════════════════════════════════════════════════════════════════

-- G1: reasoning düşse bile TRIP YÜKLEME başarılı olur
DO $$
DECLARE tr uuid; v_err text := 'NO_ERROR';
BEGIN
  BEGIN
    INSERT INTO public.vehicle_trips (vehicle_id, trip_key, started_at, ended_at)
    VALUES (pg_temp.id('va'), 'wir-trip-isolation', now()-interval '3 hours', now())
    RETURNING id INTO tr;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  PERFORM pg_temp.chk('G1', tr IS NOT NULL AND v_err = 'NO_ERROR',
    format('trip=%s hata=%s', (tr IS NOT NULL), left(v_err,40)));
END $$;

-- G2: EVIDENCE ENGINE reasoning'den bağımsız çalışmaya devam eder
DO $$
DECLARE v_res text;
BEGIN
  SELECT public._ai_evidence_record(
    pg_temp.id('ca'),'BLACKBOX','BATTERY','batt.volt',
    pg_temp.id('va'),NULL,NULL,'INFO','MEASURED',12.6,9) INTO v_res;
  PERFORM pg_temp.chk('G2', v_res IN ('RECORDED','MERGED'),
    format('kanit=%s', v_res));
END $$;

-- G3: hata yalıtımı fonksiyonu GERÇEKTEN var
DO $$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='_reasoning_wire_safely';
  PERFORM pg_temp.chk('G3', v_def LIKE '%EXCEPTION WHEN OTHERS%', '');
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- H · CROSS-TENANT · TRANSFER · UNKNOWN · FAIL-CLOSED
-- ═══════════════════════════════════════════════════════════════════════════

-- H1: BAŞKA şirketin aracı için olay REDDEDİLİR
DO $$
DECLARE q record; e record;
BEGIN
  SELECT * INTO q FROM public._reasoning_enqueue(
    pg_temp.id('ca'), 'VEHICLE_IDENTITY_CHANGED', pg_temp.id('vb'), NULL, NULL);
  IF q.result = 'ENQUEUED' THEN
    PERFORM public._reasoning_dispatch(q.event_id);
    SELECT * INTO e FROM public.mavi_reasoning_event WHERE id = q.event_id;
  END IF;
  PERFORM pg_temp.chk('H1',
    e.state = 'REJECTED' AND e.skip_reason = 'SUBJECT_MISMATCH',
    format('state=%s reason=%s', e.state, e.skip_reason));
END $$;

-- H2: cross-tenant olay KARAR ÜRETMEDİ
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.mavi_reasoning
   WHERE company_id = pg_temp.id('ca') AND vehicle_id = pg_temp.id('vb');
  PERFORM pg_temp.chk('H2', n = 0, format('sizinti_karar=%s', n));
END $$;

-- H3: DEVİR sonrası devralan şirket eski kanıtı GÖRMEZ
UPDATE public.vehicles SET company_id = pg_temp.id('cb') WHERE id = pg_temp.id('va');

DO $$
DECLARE q record; e record; m record;
BEGIN
  SELECT * INTO q FROM public._reasoning_enqueue(
    pg_temp.id('cb'), 'VEHICLE_IDENTITY_CHANGED', pg_temp.id('va'), NULL, NULL);
  PERFORM public._reasoning_dispatch(q.event_id);
  SELECT * INTO e FROM public.mavi_reasoning_event WHERE id = q.event_id;
  SELECT * INTO m FROM public.mavi_reasoning WHERE id = e.reasoning_id;
  PERFORM pg_temp.chk('H3',
    e.state = 'COMPLETED' AND m.decision = 'INSUFFICIENT_EVIDENCE',
    format('state=%s decision=%s', e.state, m.decision));
END $$;

-- H4: DEVİR sonrası ESKİ şirketin olayları ve kararları SİLİNMEDİ
DO $$
DECLARE n_e integer; n_m integer;
BEGIN
  SELECT count(*) INTO n_e FROM public.mavi_reasoning_event
   WHERE company_id = pg_temp.id('ca');
  SELECT count(*) INTO n_m FROM public.mavi_reasoning
   WHERE company_id = pg_temp.id('ca');
  PERFORM pg_temp.chk('H4', n_e > 0 AND n_m > 0,
    format('eski_olay=%s eski_karar=%s', n_e, n_m));
END $$;

UPDATE public.vehicles SET company_id = pg_temp.id('ca') WHERE id = pg_temp.id('va');

-- H5: KATEGORİSİ BİLİNMEYEN kanıt olayı Unknown Resolver'a gider ve
--     KARAR UYDURMAZ (niyet yuvarlanmaz)
DO $$
DECLARE q record; e record; m record;
BEGIN
  PERFORM public.run_mavi_reasoning_queue(100);
  SELECT * INTO q FROM public._reasoning_enqueue(
    pg_temp.id('ca'), 'EVIDENCE_ADDED', pg_temp.id('va'), NULL, NULL, 'UNKNOWN');
  PERFORM public._reasoning_dispatch(q.event_id);
  SELECT * INTO e FROM public.mavi_reasoning_event WHERE id = q.event_id;
  SELECT * INTO m FROM public.mavi_reasoning WHERE id = e.reasoning_id;
  PERFORM pg_temp.chk('H5',
    e.intent = 'UNKNOWN' AND e.resolver = 'UNKNOWN'
    AND (m.id IS NULL OR m.decision NOT IN ('SUPPORTED','UNSUPPORTED')),
    format('intent=%s resolver=%s decision=%s',
           e.intent, e.resolver, coalesce(m.decision,'-')));
END $$;

-- H5b: BİLİNMEYEN olay tipi kuyruğa GİREMEZ (bounded olay kümesi)
DO $$
DECLARE v_err text := 'NO_ERROR';
BEGIN
  BEGIN
    PERFORM public._reasoning_enqueue(
      pg_temp.id('ca'), 'SOMETHING_UNKNOWN', pg_temp.id('va'), NULL, NULL);
  EXCEPTION WHEN OTHERS THEN v_err := SQLSTATE;
  END;
  PERFORM pg_temp.chk('H5b', v_err = '23514',
    format('sqlstate=%s (CHECK reddetti)', v_err));
END $$;

-- H6: ŞİRKETSİZ olay REDDEDİLİR
DO $$
DECLARE q record;
BEGIN
  SELECT * INTO q FROM public._reasoning_enqueue(
    NULL, 'TRIP_COMPLETED', pg_temp.id('va'), NULL, NULL);
  PERFORM pg_temp.chk('H6', q.result = 'REJECTED' AND q.event_id IS NULL,
    format('sonuc=%s', q.result));
END $$;

-- H7: anon kuyruğu OKUYAMAZ · istemci kuyruğa YAZAMAZ · koşucuyu ÇALIŞTIRAMAZ
DO $$
DECLARE v_bad text := '';
BEGIN
  IF has_table_privilege('anon','public.mavi_reasoning_event','SELECT')
    THEN v_bad := v_bad || ' anon_read'; END IF;
  IF has_table_privilege('authenticated','public.mavi_reasoning_event','INSERT')
    THEN v_bad := v_bad || ' auth_write'; END IF;
  IF has_function_privilege('authenticated',
       'public.run_mavi_reasoning_queue(integer)','EXECUTE')
    THEN v_bad := v_bad || ' auth_runner'; END IF;
  PERFORM pg_temp.chk('H7', v_bad = '', format('sizinti=%s', v_bad));
END $$;

-- H8: oturumsuz kuyruk okuması BOŞ (fail-closed)
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.get_reasoning_queue();
  PERFORM pg_temp.chk('H8', n = 0, format('satir=%s', n));
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- I · MEVCUT KATMAN REGRESYONU
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  PERFORM pg_temp.chk('I1', public._evidence_confidence('BLACKBOX','MEASURED',1) = 'MEDIUM',
    '055 guven kapisi');
  PERFORM pg_temp.chk('I2', public._dna_status(4, 500) = 'NO_DNA', '053 DNA esigi');
  PERFORM pg_temp.chk('I3',
    public._fleet_insight_confidence(50, 1, 100, 50) NOT IN ('HIGH','VERY_HIGH'),
    '054 FI guven kapisi');
  PERFORM pg_temp.chk('I4',
    public._reasoning_confidence('SUPPORTED','VERY_HIGH',1,1.0) = 'MEDIUM',
    '057 tek kanit tavani');
  PERFORM pg_temp.chk('I5',
    NOT public._reasoning_can_transition('NEW','SUPPORTED'),
    '057 durum makinesi');
END $$;

DO $$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='_reasoning_resolve';
  PERFORM pg_temp.chk('I6',
    v_def LIKE '%mavi_reason(%'
    AND v_def NOT LIKE '%ai_evidence%'
    AND v_def NOT LIKE '%_reasoning_confidence%',
    'resolver karar uretmiyor');
END $$;

-- ── SONUÇ ──────────────────────────────────────────────────────────────
SELECT code, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS sonuc, detail
  FROM w_res ORDER BY code;

SELECT count(*) FILTER (WHERE ok) AS pass,
       count(*) FILTER (WHERE NOT ok) AS fail,
       count(*) AS toplam
  FROM w_res;

-- ── TEMİZLİK ───────────────────────────────────────────────────────────
DELETE FROM public.vehicles WHERE company_id IN
  (SELECT id FROM public.companies WHERE name LIKE 'WIR_TEST_%');
DELETE FROM public.companies WHERE name LIKE 'WIR_TEST_%';
