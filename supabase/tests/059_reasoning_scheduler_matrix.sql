-- ═══════════════════════════════════════════════════════════════════════════
-- 059 MAVI REASONING SCHEDULER — GERÇEK PostgreSQL DOĞRULAMA MATRİSİ
--
-- ── NASIL KOŞULUR ────────────────────────────────────────────────────────
--   MSYS_NO_PATHCONV=1 docker exec -i -e PGPASSWORD=postgres \
--     supabase_db_<proje> psql -U postgres -d postgres \
--     < supabase/tests/059_reasoning_scheduler_matrix.sql
--
-- ── NEDEN TRANSACTION İÇİNDE DEĞİL ───────────────────────────────────────
-- AUTOCOMMIT: `now()` bir işlem içinde SABİTTİR; koşum süresi, kuyruk
-- gecikmesi ve "hiç koşmadı" durumu donmuş saatle ölçülemez.
--
-- ── CANLI ZAMANLAYICI İLE YARIŞ ──────────────────────────────────────────
-- pg_cron işi dakikada bir koşar ve kuyruğu bu matris koşarken de boşaltır.
-- Bu YARIŞ BİLİNÇLİ OLARAK KABUL EDİLİR: "kuyruğa girdi ve BEKLİYOR" ölçümü
-- olayı üreten DO bloğunun İÇİNDE (aynı işlemde) yapılır — cron işçisi
-- commit edilmemiş satırı göremez, dolayısıyla ölçüm deterministiktir.
-- Sonraki ölçümler "işlendi mi" sorusunu sorar; işi ister bizim elle
-- çağırdığımız koşum ister cron işlesin, iddia AYNIDIR: kuyruk boşalıyor.
--
-- ── ÖRTÜŞME TESTİ (D1) BU DOSYADA DEĞİL ──────────────────────────────────
-- Advisory lock AYNI OTURUMDA yeniden girişlidir; örtüşme ancak İKİ AYRI
-- oturumla sınanabilir ve bu tek bir psql dosyasından yapılamaz (dblink bu
-- kurulumda parolasız bağlanamıyor: rol superuser değil). D1 iki eşzamanlı
-- psql oturumuyla koşulur, komutu `docs/MAVI_REASONING_SCHEDULER_P1_REPORT.md`
-- §4'te. Bu dosyada mekanizmanın VARLIĞI (D2/D3) kilitlenir.
--
-- ⚠️ Bu dosya ürün kodu DEĞİLDİR ve hiçbir migration onu çağırmaz.
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on
\pset pager off

-- ── FIXTURE ────────────────────────────────────────────────────────────
DELETE FROM public.profiles WHERE full_name = 'SCH_TEST_USER';
DELETE FROM auth.users WHERE email = 'sch-test@caros.local';
DELETE FROM public.vehicles WHERE company_id IN
  (SELECT id FROM public.companies WHERE name LIKE 'SCH_TEST_%');
DELETE FROM public.companies WHERE name LIKE 'SCH_TEST_%';

CREATE TEMP TABLE IF NOT EXISTS s_ids (k text PRIMARY KEY, v uuid);

DO $$
DECLARE ca uuid; va uuid; uid uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.companies (name) VALUES ('SCH_TEST_A') RETURNING id INTO ca;
  INSERT INTO public.vehicles (name, company_id) VALUES ('sch-va', ca) RETURNING id INTO va;
  INSERT INTO auth.users (id, email) VALUES (uid, 'sch-test@caros.local');
  /* `auth.users` trigger'ı profili KENDİ açabilir — şirkete bağlanması yeter. */
  INSERT INTO public.profiles (id, full_name, role, company_id)
    VALUES (uid, 'SCH_TEST_USER', 'admin', ca)
  ON CONFLICT (id) DO UPDATE
    SET full_name = 'SCH_TEST_USER', company_id = EXCLUDED.company_id;
  INSERT INTO s_ids VALUES ('ca',ca),('va',va),('uid',uid);
END $$;

CREATE OR REPLACE FUNCTION pg_temp.id(k text) RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT v FROM s_ids WHERE k = $1 $$;

CREATE TEMP TABLE IF NOT EXISTS s_res (code text PRIMARY KEY, ok boolean, detail text);

CREATE OR REPLACE FUNCTION pg_temp.chk(p_code text, p_ok boolean, p_detail text DEFAULT '')
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO s_res VALUES (p_code, p_ok, p_detail)
  ON CONFLICT (code) DO UPDATE SET ok = EXCLUDED.ok, detail = EXCLUDED.detail;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- A · ZAMANLAMA GERÇEKTEN KURULU MU (058'in açık borcu #280)
-- ═══════════════════════════════════════════════════════════════════════════

-- A1: pg_cron kurulu
DO $$
BEGIN
  PERFORM pg_temp.chk('A1',
    EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'),
    'pg_cron eklentisi');
END $$;

-- A2: TAM BİR iş zamanlanmış (çift koşum yok) · dakikada bir · aktif
DO $$
DECLARE j record; n integer;
BEGIN
  SELECT count(*) INTO n FROM cron.job WHERE jobname = 'mavi-reasoning-scheduler';
  SELECT * INTO j FROM cron.job WHERE jobname = 'mavi-reasoning-scheduler' LIMIT 1;
  PERFORM pg_temp.chk('A2',
    n = 1 AND j.schedule = '* * * * *' AND j.active,
    format('adet=%s ifade=%s aktif=%s', n, j.schedule, j.active));
END $$;

-- A3: cron komutu YALNIZ zamanlayıcıyı çağırıyor (karar motorunu DOĞRUDAN değil)
DO $$
DECLARE c text;
BEGIN
  SELECT command INTO c FROM cron.job WHERE jobname = 'mavi-reasoning-scheduler';
  PERFORM pg_temp.chk('A3',
    c LIKE '%run_mavi_reasoning_scheduler(%'
    AND c NOT LIKE '%mavi_reason(%'
    AND c NOT LIKE '%_reasoning_dispatch%',
    format('komut=%s', c));
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- B · ASIL İDDİA: KUYRUKTA BEKLEYEN İŞ ARTIK İŞLENİYOR
-- ═══════════════════════════════════════════════════════════════════════════

-- B1: hot-path olay kuyruğa GİRER ve BEKLER (dispatch_now=false)
--     Ölçüm aynı işlem içinde: cron işçisi bu satırı göremez.
DO $$
DECLARE e record;
BEGIN
  /* GERÇEK YOL: bağlantı trigger'ı (ilk `last_seen` = sessizlikten dönüş). */
  UPDATE public.vehicles SET last_seen = now() WHERE id = pg_temp.id('va');

  SELECT * INTO e FROM public.mavi_reasoning_event
   WHERE company_id = pg_temp.id('ca') AND event_type = 'VEHICLE_CONNECTIVITY_CHANGED'
   ORDER BY enqueued_at DESC LIMIT 1;

  PERFORM pg_temp.chk('B1',
    e.id IS NOT NULL AND e.state = 'PENDING' AND e.started_at IS NULL,
    format('state=%s started=%s (ELLE CAGRI YOK)', e.state, e.started_at IS NOT NULL));
END $$;

-- B2: zamanlayıcı koşumu o işi GERÇEKTEN işledi — 058'de sonsuza kadar beklerdi
DO $$
DECLARE r record; e record;
BEGIN
  SELECT * INTO r FROM public.run_mavi_reasoning_scheduler(100, 'MANUAL');

  SELECT * INTO e FROM public.mavi_reasoning_event
   WHERE company_id = pg_temp.id('ca') AND event_type = 'VEHICLE_CONNECTIVITY_CHANGED'
   ORDER BY enqueued_at DESC LIMIT 1;

  PERFORM pg_temp.chk('B2',
    e.state NOT IN ('PENDING','RETRY_PENDING') AND e.started_at IS NOT NULL,
    format('kosum=%s state=%s started=%s', r.outcome, e.state, e.started_at IS NOT NULL));
END $$;

-- B3: koşum KÜTÜĞE yazıldı ve sayaç ÖLÇÜLDÜ (uydurulmadı)
DO $$
DECLARE s record;
BEGIN
  SELECT * INTO s FROM public.mavi_reasoning_scheduler_run
   WHERE trigger_source = 'MANUAL' ORDER BY id DESC LIMIT 1;
  PERFORM pg_temp.chk('B3',
    s.outcome = 'COMPLETED' AND s.processed IS NOT NULL
    AND s.expired IS NOT NULL AND s.finished_at IS NOT NULL,
    format('outcome=%s processed=%s expired=%s', s.outcome, s.processed, s.expired));
END $$;

-- B4: zamanlayıcı KENDİ KARARINI ÜRETMEDİ — karar sayısı yalnız motordan artar
DO $$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'run_mavi_reasoning_scheduler';
  PERFORM pg_temp.chk('B4',
    v_def LIKE '%run_mavi_reasoning_queue(%'
    AND v_def LIKE '%expire_mavi_reasoning()%'
    AND v_def NOT LIKE '%mavi_reason(%'
    AND v_def NOT LIKE '%_reasoning_dispatch%',
    'yalnizca cagiriyor');
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- C · ÖLÇÜM DÜRÜSTLÜĞÜ — sahte "0 iş" yazılamaz
-- ═══════════════════════════════════════════════════════════════════════════

-- C1: tamamlanmamış koşum sayaç TAŞIYAMAZ (CHECK reddi)
DO $$
DECLARE v_state text := 'YAZILDI';
BEGIN
  BEGIN
    INSERT INTO public.mavi_reasoning_scheduler_run
      (trigger_source, outcome, processed) VALUES ('MANUAL','FAILED', 0);
  EXCEPTION WHEN check_violation THEN v_state := 'REDDEDILDI';
  END;
  PERFORM pg_temp.chk('C1', v_state = 'REDDEDILDI',
    format('sahte sifir sayac=%s', v_state));
END $$;

-- C2: tamamlanan koşum ölçümsüz OLAMAZ (ters yön)
DO $$
DECLARE v_state text := 'YAZILDI';
BEGIN
  BEGIN
    INSERT INTO public.mavi_reasoning_scheduler_run
      (trigger_source, outcome) VALUES ('MANUAL','COMPLETED');
  EXCEPTION WHEN check_violation THEN v_state := 'REDDEDILDI';
  END;
  PERFORM pg_temp.chk('C2', v_state = 'REDDEDILDI',
    format('olcumsuz tamamlandi=%s', v_state));
END $$;

-- C3: bounded durum kümesi — uydurma sonuç yazılamaz
DO $$
DECLARE v_state text := 'YAZILDI';
BEGIN
  BEGIN
    INSERT INTO public.mavi_reasoning_scheduler_run
      (trigger_source, outcome, processed, completed, failed, skipped, expired)
    VALUES ('MANUAL','HEALTHY', 0,0,0,0,0);
  EXCEPTION WHEN check_violation THEN v_state := 'REDDEDILDI';
  END;
  PERFORM pg_temp.chk('C3', v_state = 'REDDEDILDI', format('uydurma outcome=%s', v_state));
END $$;

-- C4: bilinmeyen tetikleyici kaynağı yazılamaz
DO $$
DECLARE v_state text := 'YAZILDI';
BEGIN
  BEGIN
    INSERT INTO public.mavi_reasoning_scheduler_run
      (trigger_source, outcome) VALUES ('SOMETHING_NEW','FAILED');
  EXCEPTION WHEN check_violation THEN v_state := 'REDDEDILDI';
  END;
  PERFORM pg_temp.chk('C4', v_state = 'REDDEDILDI', format('bilinmeyen kaynak=%s', v_state));
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- D · ÖRTÜŞME KORUMASI (mekanizma kilidi — çalışma kanıtı raporda §4)
-- ═══════════════════════════════════════════════════════════════════════════

-- D2: koşucu advisory lock kullanıyor ve atlanan koşumu KAYDEDİYOR
DO $$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'run_mavi_reasoning_scheduler';
  PERFORM pg_temp.chk('D2',
    v_def LIKE '%pg_try_advisory_lock%'
    AND v_def LIKE '%SKIPPED_LOCKED%'
    AND v_def LIKE '%pg_advisory_unlock%',
    'kilit al/birak + atlandi kaydi');
END $$;

-- D3: kilit anahtarı SABİT ve tek yerde tanımlı (çağıran gevşetemez)
DO $$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'run_mavi_reasoning_scheduler';
  PERFORM pg_temp.chk('D3',
    public._reasoning_scheduler_lock_key() = 590059001
    AND v_def LIKE '%_reasoning_scheduler_lock_key()%',
    format('anahtar=%s', public._reasoning_scheduler_lock_key()));
END $$;

-- D4: atlanan koşum satırı sayaç TAŞIMAZ (kütükte sahte iş görünmez)
DO $$
DECLARE v_bad integer;
BEGIN
  SELECT count(*) INTO v_bad FROM public.mavi_reasoning_scheduler_run
   WHERE outcome = 'SKIPPED_LOCKED' AND processed IS NOT NULL;
  PERFORM pg_temp.chk('D4', v_bad = 0, format('sayacli atlanmis kosum=%s', v_bad));
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- E · İKİNCİ OTORİTE YASAĞI
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'run_mavi_reasoning_scheduler';
  PERFORM pg_temp.chk('E1',
    v_def NOT LIKE '%ai_evidence%' AND v_def NOT LIKE '%_reasoning_confidence%'
    AND v_def NOT LIKE '%_reasoning_resolve%' AND v_def NOT LIKE '%SUPPORTED%'
    AND v_def NOT LIKE '%CONFLICTED_EVIDENCE%',
    'zamanlayici karar mantigi yazmiyor');
  PERFORM pg_temp.chk('E2',
    v_def NOT LIKE '%http%' AND v_def NOT LIKE '%openrouter%'
    AND v_def NOT LIKE '%gemini%' AND v_def NOT LIKE '%anthropic%'
    AND v_def NOT LIKE '%openai%',
    'dis cagri/LLM yok');
END $$;

-- E3: karar motoru zamanlayıcıya BAĞLANMADI (ters bağımlılık yok)
DO $$
DECLARE v_a text; v_b text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_a FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='_reasoning_resolve';
  SELECT pg_get_functiondef(p.oid) INTO v_b FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='run_mavi_reasoning_queue';
  PERFORM pg_temp.chk('E3',
    v_a NOT LIKE '%scheduler%' AND v_b NOT LIKE '%scheduler%',
    '057/058 zamanlayiciyi tanimiyor');
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- F · YETKİ VE SIZINTI
-- ═══════════════════════════════════════════════════════════════════════════

-- F1: istemci zamanlayıcıyı ÇALIŞTIRAMAZ · kütüğü OKUYAMAZ · anon sağlığı göremez
DO $$
DECLARE v_bad text := '';
BEGIN
  IF has_function_privilege('authenticated',
       'public.run_mavi_reasoning_scheduler(integer,text)','EXECUTE')
    THEN v_bad := v_bad || ' auth_runner'; END IF;
  IF has_function_privilege('anon',
       'public.run_mavi_reasoning_scheduler(integer,text)','EXECUTE')
    THEN v_bad := v_bad || ' anon_runner'; END IF;
  IF has_table_privilege('authenticated','public.mavi_reasoning_scheduler_run','SELECT')
    THEN v_bad := v_bad || ' auth_read'; END IF;
  IF has_table_privilege('anon','public.mavi_reasoning_scheduler_run','SELECT')
    THEN v_bad := v_bad || ' anon_read'; END IF;
  IF has_function_privilege('anon','public.get_reasoning_scheduler_health()','EXECUTE')
    THEN v_bad := v_bad || ' anon_health'; END IF;
  PERFORM pg_temp.chk('F1', v_bad = '', format('sizinti=%s', v_bad));
END $$;

-- F2: kütükte RLS açık ve policy YOK (varsayılan RED)
DO $$
DECLARE v_rls boolean; v_pol integer;
BEGIN
  SELECT rowsecurity INTO v_rls FROM pg_tables
   WHERE schemaname='public' AND tablename='mavi_reasoning_scheduler_run';
  SELECT count(*) INTO v_pol FROM pg_policies
   WHERE schemaname='public' AND tablename='mavi_reasoning_scheduler_run';
  PERFORM pg_temp.chk('F2', v_rls AND v_pol = 0,
    format('rls=%s policy=%s', v_rls, v_pol));
END $$;

-- F3: oturumsuz sağlık okuması BOŞ (fail-closed)
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.get_reasoning_scheduler_health();
  PERFORM pg_temp.chk('F3', n = 0, format('satir=%s', n));
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- G · BOUNDED KÜTÜK
-- ═══════════════════════════════════════════════════════════════════════════

-- G1: tavan aşılırsa en eskiler düşer (sınırsız büyüme yok)
DO $$
DECLARE n integer; v_max integer := public._reasoning_scheduler_history_max();
BEGIN
  INSERT INTO public.mavi_reasoning_scheduler_run (trigger_source, outcome, finished_at)
  SELECT 'MANUAL','SKIPPED_LOCKED', now() FROM generate_series(1, v_max + 20);

  PERFORM public.run_mavi_reasoning_scheduler(1, 'MANUAL');

  SELECT count(*) INTO n FROM public.mavi_reasoning_scheduler_run;
  PERFORM pg_temp.chk('G1', n <= v_max + 1, format('satir=%s tavan=%s', n, v_max));
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- H · SAĞLIK RPC'Sİ GERÇEK VERİ DÖNÜYOR MU (oturum simüle edilir)
-- ═══════════════════════════════════════════════════════════════════════════

-- H1: HİÇ KOŞUM YOKKEN sağlık "iyi" DEMEZ — BİLİNMİYOR der (NULL)
DO $$
DECLARE h record;
BEGIN
  DELETE FROM public.mavi_reasoning_scheduler_run;   -- kütük boş: "hic kosmadi"
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.id('uid'))::text, true);

  SELECT * INTO h FROM public.get_reasoning_scheduler_health();

  PERFORM pg_temp.chk('H1',
    h.job_scheduled AND h.last_run_age_seconds IS NULL AND h.healthy IS NULL
    AND h.last_processed IS NULL,
    format('zamanli=%s yas=%s saglik=%s', h.job_scheduled,
           h.last_run_age_seconds, h.healthy));
END $$;

-- H2: koşumdan sonra GERÇEK ölçüm döner (sahte 0 yok)
DO $$
DECLARE h record;
BEGIN
  PERFORM public.run_mavi_reasoning_scheduler(50, 'MANUAL');
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.id('uid'))::text, true);

  SELECT * INTO h FROM public.get_reasoning_scheduler_health();

  PERFORM pg_temp.chk('H2',
    h.scheduler_installed AND h.job_scheduled
    AND h.schedule_expression = '* * * * *' AND h.interval_seconds = 60
    AND h.last_run_age_seconds IS NOT NULL AND h.last_run_outcome = 'COMPLETED'
    AND h.last_run_duration_ms IS NOT NULL AND h.last_processed IS NOT NULL
    AND h.consecutive_failure_count = 0 AND h.overdue = false AND h.healthy,
    format('aralik=%s sonuc=%s gecikme=%s saglik=%s',
           h.interval_seconds, h.last_run_outcome, h.overdue, h.healthy));
END $$;

-- H3: DÜŞEN koşumdan sonra sağlık YEŞİL KALMAZ
DO $$
DECLARE h record;
BEGIN
  INSERT INTO public.mavi_reasoning_scheduler_run
    (trigger_source, outcome, last_error, finished_at)
  VALUES ('CRON','FAILED','TEST:zorlanmis hata', now());

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.id('uid'))::text, true);
  SELECT * INTO h FROM public.get_reasoning_scheduler_health();

  PERFORM pg_temp.chk('H3',
    h.consecutive_failure_count >= 1 AND h.healthy = false,
    format('ardisik_hata=%s saglik=%s', h.consecutive_failure_count, h.healthy));
END $$;

-- H4: sağlık okuması ŞİRKET VERİSİ taşımaz (kimlik/araç/sürücü alanı yok)
DO $$
DECLARE v_cols text;
BEGIN
  SELECT string_agg(lower(a.attname), ',') INTO v_cols
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN LATERAL unnest(p.proargnames) WITH ORDINALITY AS a(attname, ord)
   WHERE n.nspname='public' AND p.proname='get_reasoning_scheduler_health';
  PERFORM pg_temp.chk('H4',
    v_cols NOT LIKE '%vehicle%' AND v_cols NOT LIKE '%driver%'
    AND v_cols NOT LIKE '%company%' AND v_cols NOT LIKE '%vin%'
    AND v_cols NOT LIKE '%plate%',
    format('alanlar=%s', v_cols));
END $$;

-- H5: zamanlayıcı SÖKÜLÜRSE sağlık bunu SAKLAMAZ (arıza görünür kalır)
DO $$
DECLARE h record; v_cmd text; v_sched text;
BEGIN
  SELECT command, schedule INTO v_cmd, v_sched FROM cron.job
   WHERE jobname = 'mavi-reasoning-scheduler';
  PERFORM cron.unschedule('mavi-reasoning-scheduler');

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.id('uid'))::text, true);
  SELECT * INTO h FROM public.get_reasoning_scheduler_health();

  PERFORM pg_temp.chk('H5',
    h.job_scheduled = false AND h.healthy = false
    AND h.schedule_expression IS NULL AND h.interval_seconds IS NULL,
    format('zamanli=%s saglik=%s', h.job_scheduled, h.healthy));

  /* Fixture geri yüklenir — matris ortamı bozmaz. */
  PERFORM cron.schedule('mavi-reasoning-scheduler', v_sched, v_cmd);
END $$;

-- H6: ARALIK BİLİNMİYORSA "sağlıklı" DENMEZ — gecikme ölçülemez, cevap BİLİNMİYOR
DO $$
DECLARE h record; v_cmd text; v_sched text;
BEGIN
  SELECT command, schedule INTO v_cmd, v_sched FROM cron.job
   WHERE jobname = 'mavi-reasoning-scheduler';
  PERFORM cron.unschedule('mavi-reasoning-scheduler');
  /* Tanımadığımız bir ifade: aralık TAHMİN EDİLMEZ. */
  PERFORM cron.schedule('mavi-reasoning-scheduler', '*/5 * * * *', v_cmd);

  /* H3'ün zorladığı hata sıfırlanır: burada sınanan şey HATA değil,
     ölçülemeyen ARALIK. (Hata kapısı zaten H3'te kilitli.) */
  PERFORM public.run_mavi_reasoning_scheduler(1, 'MANUAL');

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.id('uid'))::text, true);
  SELECT * INTO h FROM public.get_reasoning_scheduler_health();

  PERFORM pg_temp.chk('H6',
    h.job_scheduled AND h.schedule_expression = '*/5 * * * *'
    AND h.interval_seconds IS NULL AND h.overdue IS NULL AND h.healthy IS NULL,
    format('aralik=%s gecikme=%s saglik=%s',
           h.interval_seconds, h.overdue, h.healthy));

  PERFORM cron.unschedule('mavi-reasoning-scheduler');
  PERFORM cron.schedule('mavi-reasoning-scheduler', v_sched, v_cmd);
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- I · MEVCUT KATMAN REGRESYONU (053–058 DEĞİŞMEDİ)
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
    NOT public._reasoning_can_transition('NEW','SUPPORTED'), '057 durum makinesi');
  PERFORM pg_temp.chk('I6',
    public._reasoning_resolver_for_intent('SOMETHING_NEW') IS NULL,
    '058 varsayilan resolver yok');
  PERFORM pg_temp.chk('I7',
    EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public'
             AND indexname='mre_open_dedupe_unique'),
    '058 bounded dedupe kilidi');
END $$;

-- ── SONUÇ ──────────────────────────────────────────────────────────────
SELECT code, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS sonuc, detail
  FROM s_res ORDER BY code;

SELECT count(*) FILTER (WHERE ok) AS pass,
       count(*) FILTER (WHERE NOT ok) AS fail,
       count(*) AS toplam
  FROM s_res;

-- ── TEMİZLİK ───────────────────────────────────────────────────────────
DELETE FROM public.profiles WHERE full_name = 'SCH_TEST_USER';
DELETE FROM auth.users WHERE email = 'sch-test@caros.local';
DELETE FROM public.vehicles WHERE company_id IN
  (SELECT id FROM public.companies WHERE name LIKE 'SCH_TEST_%');
DELETE FROM public.companies WHERE name LIKE 'SCH_TEST_%';
DELETE FROM public.mavi_reasoning_scheduler_run WHERE last_error LIKE 'TEST:%';
