-- ═══════════════════════════════════════════════════════════════════════════
-- 060 AI MECHANIC CORE P1 — GERÇEK PostgreSQL DOĞRULAMA MATRİSİ
--
-- ── NASIL KOŞULUR ────────────────────────────────────────────────────────
--   MSYS_NO_PATHCONV=1 docker exec -i -e PGPASSWORD=postgres \
--     supabase_db_fleetval psql -U postgres -d postgres \
--     < supabase/tests/060_ai_mechanic_matrix.sql
--
-- ── NE KANITLAR ──────────────────────────────────────────────────────────
-- AI Mechanic'in KARAR ÜRETMEDİĞİNİ ve yalnız MAVI kararlarını yorumladığını.
-- Her iddia gerçek satırlar üzerinde ölçülür; hiçbir sonuç varsayılmaz.
--
-- ⚠️ Bu dosya ürün kodu DEĞİLDİR ve hiçbir migration onu çağırmaz.
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on
\pset pager off

-- ── FIXTURE TEMİZLİĞİ ──────────────────────────────────────────────────
DELETE FROM public.profiles WHERE full_name LIKE 'MECH_TEST_%';
DELETE FROM auth.users WHERE email LIKE 'mech-test%@caros.local';
DELETE FROM public.ai_evidence WHERE company_id IN
  (SELECT id FROM public.companies WHERE name LIKE 'MECH_TEST_%');
DELETE FROM public.mavi_reasoning WHERE company_id IN
  (SELECT id FROM public.companies WHERE name LIKE 'MECH_TEST_%');
DELETE FROM public.vehicles WHERE company_id IN
  (SELECT id FROM public.companies WHERE name LIKE 'MECH_TEST_%');
DELETE FROM public.companies WHERE name LIKE 'MECH_TEST_%';

CREATE TEMP TABLE IF NOT EXISTS m_ids (k text PRIMARY KEY, v uuid);

DO $$
DECLARE ca uuid; cb uuid; va uuid; vb uuid;
        ua uuid := gen_random_uuid(); ub uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.companies (name) VALUES ('MECH_TEST_A') RETURNING id INTO ca;
  INSERT INTO public.companies (name) VALUES ('MECH_TEST_B') RETURNING id INTO cb;
  INSERT INTO public.vehicles (name, company_id) VALUES ('mech-va', ca) RETURNING id INTO va;
  INSERT INTO public.vehicles (name, company_id) VALUES ('mech-vb', cb) RETURNING id INTO vb;

  INSERT INTO auth.users (id, email) VALUES (ua, 'mech-test-a@caros.local');
  INSERT INTO auth.users (id, email) VALUES (ub, 'mech-test-b@caros.local');
  INSERT INTO public.profiles (id, full_name, role, company_id)
    VALUES (ua, 'MECH_TEST_USER_A', 'admin', ca)
  ON CONFLICT (id) DO UPDATE SET full_name='MECH_TEST_USER_A', company_id=EXCLUDED.company_id;
  INSERT INTO public.profiles (id, full_name, role, company_id)
    VALUES (ub, 'MECH_TEST_USER_B', 'admin', cb)
  ON CONFLICT (id) DO UPDATE SET full_name='MECH_TEST_USER_B', company_id=EXCLUDED.company_id;

  INSERT INTO m_ids VALUES ('ca',ca),('cb',cb),('va',va),('vb',vb),('ua',ua),('ub',ub);
END $$;

CREATE OR REPLACE FUNCTION pg_temp.id(k text) RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT v FROM m_ids WHERE k = $1 $$;

CREATE TEMP TABLE IF NOT EXISTS m_res (code text PRIMARY KEY, ok boolean, detail text);

CREATE OR REPLACE FUNCTION pg_temp.chk(p_code text, p_ok boolean, p_detail text DEFAULT '')
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO m_res VALUES (p_code, p_ok, p_detail)
  ON CONFLICT (code) DO UPDATE SET ok = EXCLUDED.ok, detail = EXCLUDED.detail;
END $$;

/** Oturum taklidi — SECURITY DEFINER fonksiyonların auth.uid()'i buradan okur. */
CREATE OR REPLACE FUNCTION pg_temp.login(p_uid uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  /* YALNIZ jwt claim ayarlanır. `set_config('role','authenticated')` BİLİNÇLİ
     olarak YOKTUR: rol değişimi temp tabloyu (m_res) yazılamaz yapar ve matris
     kendi sonucunu kaydedemez. `auth.uid()` zaten yalnız claim'den okur. */
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_uid::text)::text, true);
END $$;

CREATE OR REPLACE FUNCTION pg_temp.logout() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', '', true);
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- A · SAF EŞLEME TABLOLARI (TS ↔ SQL PARİTESİ)
-- ═══════════════════════════════════════════════════════════════════════════

-- A1: mekanik olmayan niyetler KAPSAM DIŞI (NULL) — UNKNOWN ile karıştırılmaz
DO $$
BEGIN
  PERFORM pg_temp.chk('A1',
    public._mechanic_category_for_intent('DRIVER')      IS NULL
    AND public._mechanic_category_for_intent('FLEET')   IS NULL
    AND public._mechanic_category_for_intent('TRIP_STATUS') IS NULL
    AND public._mechanic_category_for_intent('LOCATION') IS NULL,
    'DRIVER/FLEET/TRIP_STATUS/LOCATION → kapsam dışı (NULL)');
END $$;

-- A2: mekanik niyetler doğru kategoriye düşer
DO $$
BEGIN
  PERFORM pg_temp.chk('A2',
    public._mechanic_category_for_intent('ENGINE')        = 'ENGINE'
    AND public._mechanic_category_for_intent('BATTERY')   = 'BATTERY'
    AND public._mechanic_category_for_intent('FUEL')      = 'FUEL'
    AND public._mechanic_category_for_intent('TEMPERATURE') = 'TEMPERATURE'
    AND public._mechanic_category_for_intent('CONNECTIVITY') = 'CONNECTIVITY'
    AND public._mechanic_category_for_intent('DIAGNOSTIC') = 'OBD'
    AND public._mechanic_category_for_intent('VEHICLE_HEALTH') = 'UNKNOWN'
    AND public._mechanic_category_for_intent('UNKNOWN')   = 'UNKNOWN',
    'niyet→kategori tam eşleme');
END $$;

-- A3: REJECTED analiz ÜRETMEZ
DO $$
BEGIN
  PERFORM pg_temp.chk('A3',
    public._mechanic_state_for_decision('REJECTED') IS NULL
    AND public._mechanic_state_for_decision('SUPPORTED') = 'SUPPORTED'
    AND public._mechanic_state_for_decision('CONFLICTED_EVIDENCE') = 'CONFLICTED_EVIDENCE',
    'REJECTED → analiz yok');
END $$;

-- A4: ŞİDDET yeni karar üretmez — SUPPORTED daima NONE, çelişki daima UNKNOWN
DO $$
BEGIN
  PERFORM pg_temp.chk('A4',
    public._mechanic_severity('SUPPORTED','VERY_HIGH') = 'NONE'
    AND public._mechanic_severity('UNSUPPORTED','HIGH') = 'CRITICAL'
    AND public._mechanic_severity('UNSUPPORTED','LOW')  = 'WARNING'
    AND public._mechanic_severity('UNSUPPORTED','UNKNOWN') = 'UNKNOWN'
    AND public._mechanic_severity('CONFLICTED_EVIDENCE','HIGH') = 'UNKNOWN'
    AND public._mechanic_severity('INSUFFICIENT_EVIDENCE','HIGH') = 'UNKNOWN',
    'şiddet = sunum sıralaması; çelişki WARNING DEĞİL');
END $$;

-- A5: soğutma metriksiz İDDİA EDİLMEZ
DO $$
BEGIN
  PERFORM pg_temp.chk('A5',
    public._mechanic_is_cooling_metric('coolant_temp_c') IS TRUE
    AND public._mechanic_is_cooling_metric('radiator_fan_duty') IS TRUE
    AND public._mechanic_is_cooling_metric('intake_air_temp') IS FALSE
    AND public._mechanic_is_cooling_metric(NULL) IS FALSE,
    'soğutma yalnız gerçek metrikle');
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- B · FAIL-CLOSED
-- ═══════════════════════════════════════════════════════════════════════════

-- B1: oturum YOKKEN analiz DÖNMEZ
DO $$
DECLARE n integer;
BEGIN
  PERFORM pg_temp.logout();
  SELECT count(*) INTO n FROM public.get_ai_mechanic_analyses(50);
  PERFORM pg_temp.chk('B1', n = 0, format('oturumsuz analiz sayısı=%s (0 olmalı)', n));
END $$;

-- B2: oturum YOKKEN özet DÖNMEZ
DO $$
DECLARE n integer;
BEGIN
  PERFORM pg_temp.logout();
  SELECT count(*) INTO n FROM public.get_ai_mechanic_summary();
  PERFORM pg_temp.chk('B2', n = 0, format('oturumsuz özet satırı=%s (0 olmalı)', n));
END $$;

-- B3: bozuk analysis_id zincir DÖNDÜRMEZ (hata da sızdırmaz)
DO $$
DECLARE n integer;
BEGIN
  PERFORM pg_temp.login(pg_temp.id('ua'));
  SELECT count(*) INTO n FROM public.get_ai_mechanic_chain('bozuk-kimlik');
  PERFORM pg_temp.chk('B3a', n = 0, 'öneksiz kimlik → boş');
  SELECT count(*) INTO n FROM public.get_ai_mechanic_chain('mech:not-a-uuid');
  PERFORM pg_temp.chk('B3b', n = 0, 'bozuk uuid → boş (exception sızmaz)');
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- C · EVIDENCE + REASONING ENTEGRASYONU (gerçek zincir)
-- ═══════════════════════════════════════════════════════════════════════════

-- C1: kanıtsız karar → INSUFFICIENT_EVIDENCE analizi (UYDURMA YOK)
DO $$
DECLARE r record; st text; sev text;
BEGIN
  SELECT * INTO r FROM public.mavi_reason(
    pg_temp.id('ca'), 'ENGINE', pg_temp.id('va'), NULL, NULL, interval '24 hours');
  PERFORM pg_temp.login(pg_temp.id('ua'));
  SELECT analysis_state, severity INTO st, sev
    FROM public.get_ai_mechanic_analyses(50)
   WHERE reasoning_id = r.reasoning_id;
  PERFORM pg_temp.chk('C1',
    r.decision = 'INSUFFICIENT_EVIDENCE' AND st = 'INSUFFICIENT_EVIDENCE' AND sev = 'UNKNOWN',
    format('karar=%s analiz=%s şiddet=%s', r.decision, st, sev));
END $$;

-- C2: GERÇEK kanıt → karar → analiz; kanıt kimlikleri REFERANS edilir
DO $$
DECLARE r record; ids uuid[]; cnt integer; cat text;
BEGIN
  PERFORM public._ai_evidence_record(
    pg_temp.id('ca'), 'HEALTH_MONITOR', 'BATTERY', 'battery_voltage_v',
    pg_temp.id('va'), NULL, NULL, 'WARNING', 'MEASURED', 11.4, 12,
    now(), interval '30 days');
  SELECT * INTO r FROM public.mavi_reason(
    pg_temp.id('ca'), 'BATTERY', pg_temp.id('va'), NULL, NULL, interval '24 hours');
  PERFORM pg_temp.login(pg_temp.id('ua'));
  SELECT evidence_ids, evidence_count, diagnostic_category INTO ids, cnt, cat
    FROM public.get_ai_mechanic_analyses(50)
   WHERE reasoning_id = r.reasoning_id;
  PERFORM pg_temp.chk('C2',
    cat = 'BATTERY' AND cnt > 0 AND coalesce(array_length(ids,1),0) > 0,
    format('kategori=%s kanıtSayısı=%s kanıtKimliği=%s', cat, cnt, coalesce(array_length(ids,1),0)));
END $$;

-- C3: OLUMSUZ kanıt (WARNING) → UNSUPPORTED → şiddet MAVI güveninden türer
DO $$
DECLARE r record; st text; sev text; conf text;
BEGIN
  SELECT * INTO r FROM public.mavi_reason(
    pg_temp.id('ca'), 'BATTERY', pg_temp.id('va'), NULL, NULL, interval '24 hours');
  PERFORM pg_temp.login(pg_temp.id('ua'));
  SELECT analysis_state, severity, confidence INTO st, sev, conf
    FROM public.get_ai_mechanic_analyses(50)
   WHERE reasoning_id = r.reasoning_id;
  PERFORM pg_temp.chk('C3',
    st = 'UNSUPPORTED'
    AND sev = public._mechanic_severity(st, conf)
    AND conf = r.confidence,          -- GÜVEN AYNEN TAŞINIR, yeniden hesaplanmaz
    format('durum=%s şiddet=%s güven=%s(MAVI=%s)', st, sev, conf, r.confidence));
END $$;

-- C4: SOĞUTMA ayrımı gerçek kanıt metriğinden gelir
DO $$
DECLARE r record; cat text;
BEGIN
  PERFORM public._ai_evidence_record(
    pg_temp.id('ca'), 'TELEMETRY', 'TEMPERATURE', 'coolant_temp_c',
    pg_temp.id('va'), NULL, NULL, 'WARNING', 'MEASURED', 108, 30,
    now(), interval '30 days');
  SELECT * INTO r FROM public.mavi_reason(
    pg_temp.id('ca'), 'TEMPERATURE', pg_temp.id('va'), NULL, NULL, interval '24 hours');
  PERFORM pg_temp.login(pg_temp.id('ua'));
  SELECT diagnostic_category INTO cat
    FROM public.get_ai_mechanic_analyses(50)
   WHERE reasoning_id = r.reasoning_id;
  PERFORM pg_temp.chk('C4', cat = 'COOLING',
    format('coolant metriği ile kategori=%s (COOLING olmalı)', cat));
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- D · KAPSAM DIŞI NİYET — AI MECHANIC KENDİ ALANI DIŞINDA KONUŞMAZ
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE r record; n integer;
BEGIN
  SELECT * INTO r FROM public.mavi_reason(
    pg_temp.id('ca'), 'FLEET', pg_temp.id('va'), NULL, NULL, interval '24 hours');
  PERFORM pg_temp.login(pg_temp.id('ua'));
  SELECT count(*) INTO n FROM public.get_ai_mechanic_analyses(200)
   WHERE reasoning_id = r.reasoning_id;
  PERFORM pg_temp.chk('D1', n = 0,
    format('FLEET kararı analiz olarak döndü mü=%s (0 olmalı)', n));
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- E · REPLAY — AYNI KARAR İKİNCİ ANALİZ ÜRETMEZ
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE r1 record; r2 record; n integer; aid1 text; aid2 text;
BEGIN
  SELECT * INTO r1 FROM public.mavi_reason(
    pg_temp.id('ca'), 'BATTERY', pg_temp.id('va'), NULL, NULL, interval '24 hours');
  SELECT * INTO r2 FROM public.mavi_reason(
    pg_temp.id('ca'), 'BATTERY', pg_temp.id('va'), NULL, NULL, interval '24 hours');
  PERFORM pg_temp.login(pg_temp.id('ua'));
  SELECT count(*) INTO n FROM public.get_ai_mechanic_analyses(200)
   WHERE reasoning_id = r1.reasoning_id;
  SELECT analysis_id INTO aid1 FROM public.get_ai_mechanic_analyses(200)
   WHERE reasoning_id = r1.reasoning_id;
  aid2 := 'mech:' || r2.reasoning_id::text;
  PERFORM pg_temp.chk('E1',
    r1.reasoning_id = r2.reasoning_id AND n = 1 AND aid1 = aid2,
    format('replay: aynıKarar=%s analizSatırı=%s kimlikEşit=%s',
           r1.reasoning_id = r2.reasoning_id, n, aid1 = aid2));
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- F · CROSS TENANT — B ŞİRKETİ A'NIN ANALİZİNİ GÖREMEZ
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE n integer; nb integer;
BEGIN
  PERFORM pg_temp.login(pg_temp.id('ub'));            -- B şirketi kullanıcısı
  SELECT count(*) INTO n FROM public.get_ai_mechanic_analyses(200)
   WHERE vehicle_id = pg_temp.id('va');               -- A'nın aracı
  PERFORM pg_temp.chk('F1', n = 0,
    format('B kullanıcısı A analizini gördü mü=%s (0 olmalı)', n));

  SELECT count(*) INTO nb FROM public.get_ai_mechanic_analyses(200);
  PERFORM pg_temp.chk('F2', nb = 0,
    format('B şirketinin kendi analizi=%s (henüz karar yok → 0)', nb));
END $$;

-- F3: cross-tenant ZİNCİR de kapalı
DO $$
DECLARE rid uuid; n integer;
BEGIN
  PERFORM pg_temp.login(pg_temp.id('ua'));
  SELECT reasoning_id INTO rid FROM public.get_ai_mechanic_analyses(1);
  PERFORM pg_temp.login(pg_temp.id('ub'));
  SELECT count(*) INTO n FROM public.get_ai_mechanic_chain('mech:' || rid::text);
  PERFORM pg_temp.chk('F3', n = 0,
    format('B kullanıcısı A zincirini gördü mü=%s (0 olmalı)', n));
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- G · TRANSFER — ARAÇ SAHİPLİĞİ DEĞİŞİNCE ANALİZ DE TAŞINIR
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ÖLÇÜLEN GERÇEK (ilk kurgu ÇÜRÜTÜLDÜ): kararın `company_id`si DEĞİŞTİRİLEMEZ —
-- `_mavi_reasoning_immutable_guard` "karar kimliği/dayanağı/doğuş anı
-- değiştirilemez" diyerek UPDATE'i reddetti. Bu DOĞRU motor davranışıdır:
-- geçmişte verilmiş bir karar, onu veren şirkete aittir ve sonradan başka bir
-- şirkete yamanamaz (aksi hâlde denetim izi sahtelenebilirdi).
--
-- Dolayısıyla devirde asıl sorulacak soru şudur: ARAÇ el değiştirince yeni
-- sahip, eski sahibin GEÇMİŞ teşhislerini görebiliyor mu? Görmemeli.
DO $$
DECLARE n_a_before integer; n_a_after integer; n_b_after integer;
BEGIN
  PERFORM pg_temp.login(pg_temp.id('ua'));
  SELECT count(*) INTO n_a_before FROM public.get_ai_mechanic_analyses(200);

  -- GERÇEK devir etkisi: aracın sahipliği B'ye geçer.
  UPDATE public.vehicles SET company_id = pg_temp.id('cb')
   WHERE id = pg_temp.id('va');

  -- G1: eski sahip kendi geçmiş teşhislerini KAYBETMEZ (denetim izi korunur).
  PERFORM pg_temp.login(pg_temp.id('ua'));
  SELECT count(*) INTO n_a_after FROM public.get_ai_mechanic_analyses(200);
  PERFORM pg_temp.chk('G1', n_a_before > 0 AND n_a_after = n_a_before,
    format('devir öncesi A=%s, devir sonrası A=%s (aynı olmalı)', n_a_before, n_a_after));

  -- G2: YENİ sahip eski sahibin geçmiş teşhislerini GÖREMEZ (sızıntı yok).
  PERFORM pg_temp.login(pg_temp.id('ub'));
  SELECT count(*) INTO n_b_after FROM public.get_ai_mechanic_analyses(200);
  PERFORM pg_temp.chk('G2', n_b_after = 0,
    format('devir sonrası B eski teşhisleri gördü mü=%s (0 olmalı)', n_b_after));

  -- geri al (sonraki bölümler A'nın aracını kullanır)
  UPDATE public.vehicles SET company_id = pg_temp.id('ca')
   WHERE id = pg_temp.id('va');
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- H · EXPIRY — SÜRESİ DOLAN KARAR ANALİZDE DE DOLU GÖRÜNÜR
-- ═══════════════════════════════════════════════════════════════════════════

-- ÖLÇÜLEN GERÇEK (ilk kurgu ÇÜRÜTÜLDÜ): `expires_at`i geçmişe çekmek
-- `mr_expiry_valid` (expires_at > created_at) kısıtına takılır — yani süre
-- dolumu SAHTELENEMEZ. Doğru yol GERÇEK kısa TTL ile karar üretip beklemektir.
-- ── NEDEN `mavi_reasoning_transition` KULLANILIYOR ────────────────────
-- Süre dolumunu TTL ile zorlamak bu turda ÖLÇÜLEBİLİR OLMADI: `mavi_reason`a
-- `interval '1 second'` geçildiğinde KANITLI (sonuçlandırıcı) yolda satır
-- 24 saatlik varsayılan TTL ile yazıldı ve çağrı `DUPLICATE` döndürdü — oysa
-- kanıtsız yolda aynı çağrı `RECORDED` + 1 saniye üretti. Bu bir REASONING
-- ENGINE anomalisidir (bkz. kütük); AI Mechanic'in kapsamı DEĞİLDİR ve bu
-- pakette DÜZELTİLMEZ.
--
-- AI Mechanic'in burada kanıtlaması gereken şey zaten TTL değil, ŞUDUR:
-- "MAVI bir kararı EXPIRED yaptığında analiz bunu SAKLAMADAN yansıtıyor mu?"
-- Bu, motorun kendi YETKİLİ geçiş API'siyle (`mavi_reasoning_transition`)
-- deterministik olarak ölçülür.
DO $$
DECLARE rid uuid; res text; rstate text; astate text; n_before integer; n_after integer;
BEGIN
  PERFORM pg_temp.login(pg_temp.id('ua'));
  SELECT count(*) INTO n_before FROM public.get_ai_mechanic_analyses(200);
  -- Sonuçlandırıcı bir karar seç (SUPPORTED/UNSUPPORTED → EXPIRED geçişi geçerli).
  SELECT reasoning_id INTO rid FROM public.get_ai_mechanic_analyses(200)
   WHERE analysis_state = 'UNSUPPORTED' LIMIT 1;

  res := public.mavi_reasoning_transition(rid, 'EXPIRED');

  SELECT state INTO rstate FROM public.mavi_reasoning WHERE id = rid;
  SELECT reasoning_state INTO astate FROM public.get_ai_mechanic_analyses(200)
   WHERE reasoning_id = rid;
  SELECT count(*) INTO n_after FROM public.get_ai_mechanic_analyses(200);

  -- (1) MAVI EXPIRED dedi, (2) analiz bunu AYNEN yansıttı,
  -- (3) karar analizden SİLİNMEDİ — geçmiş teşhis açıklanabilir kalır.
  PERFORM pg_temp.chk('H1',
    res = 'APPLIED' AND rstate = 'EXPIRED' AND astate = 'EXPIRED' AND n_after = n_before,
    format('geçiş=%s MAVI=%s analiz=%s satırSayısı %s→%s',
           res, rstate, coalesce(astate,'YOK'), n_before, n_after));
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- I · ÖZET — BOŞ KÜMEDE ORAN NULL (0 DEĞİL)
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE s record;
BEGIN
  PERFORM pg_temp.login(pg_temp.id('ub'));            -- B'de hiç analiz yok
  SELECT * INTO s FROM public.get_ai_mechanic_summary();
  PERFORM pg_temp.chk('I1',
    s.analysis_total = 0 AND s.conclusive_ratio IS NULL AND s.high_confidence_ratio IS NULL,
    format('boş küme: toplam=%s oran1=%s oran2=%s',
           s.analysis_total, coalesce(s.conclusive_ratio::text,'NULL'),
           coalesce(s.high_confidence_ratio::text,'NULL')));
END $$;

DO $$
DECLARE s record; a integer;
BEGIN
  PERFORM pg_temp.login(pg_temp.id('ua'));
  SELECT count(*) INTO a FROM public.get_ai_mechanic_analyses(200);
  SELECT * INTO s FROM public.get_ai_mechanic_summary();
  PERFORM pg_temp.chk('I2',
    s.analysis_total = a AND s.conclusive_ratio IS NOT NULL,
    format('dolu küme: özet=%s liste=%s oran=%s',
           s.analysis_total, a, coalesce(s.conclusive_ratio::text,'NULL')));
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- J · ANON ERİŞİMİ KAPALI (head unit anon anahtarla teşhis OKUYAMAZ)
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n
    FROM information_schema.role_routine_grants
   WHERE grantee = 'anon'
     AND routine_name IN ('get_ai_mechanic_analyses','get_ai_mechanic_summary','get_ai_mechanic_chain');
  PERFORM pg_temp.chk('J1', n = 0, format('anon EXECUTE izni sayısı=%s (0 olmalı)', n));
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- K · YENİ TABLO OLUŞTURULMADI (mimari kural)
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM information_schema.tables
   WHERE table_schema = 'public' AND table_name LIKE '%mechanic%';
  PERFORM pg_temp.chk('K1', n = 0,
    format('ai_mechanic tablosu sayısı=%s (0 olmalı — analiz TÜRETİLİR)', n));
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- SONUÇ
-- ═══════════════════════════════════════════════════════════════════════════

SELECT code,
       CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS sonuc,
       detail
  FROM m_res ORDER BY code;

SELECT count(*) FILTER (WHERE ok)       AS pass,
       count(*) FILTER (WHERE NOT ok)   AS fail,
       count(*)                          AS toplam
  FROM m_res;
