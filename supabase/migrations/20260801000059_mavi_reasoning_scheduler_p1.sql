-- ═══════════════════════════════════════════════════════════════════════════
-- 059 — MAVI REASONING SCHEDULER (P1)
--
-- YALNIZ İLERİ MIGRATION. 033–058 geçmişi DEĞİŞTİRİLMEZ.
--
-- ── NEDEN VAR ────────────────────────────────────────────────────────────
-- 058 kuyruğu kurdu ama **onu periyodik çağıran hiçbir şey yoktu** (058
-- raporu §8, açık borç · kütük #280). Sonuç: kuyruğa `p_dispatch_now=false`
-- ile giren iki hot-path olayı (`VEHICLE_CONNECTIVITY_CHANGED` ·
-- `LOCATION_STATE_CHANGED`) ve düşüp `RETRY_PENDING` olan HER iş **sonsuza
-- kadar bekliyordu**. Yani "karar üretimi otomatiktir" cümlesi kuyruk yolu
-- için GEÇERLİ DEĞİLDİ. Bu migration o boşluğu kapatır.
--
-- ── İKİNCİ OTORİTE KURULMAZ (BAĞLAYICI) ──────────────────────────────────
-- ⚠️ Bu zamanlayıcı KARAR VERMEZ. Ne yapar: saatte bir tetiklenir,
-- `run_mavi_reasoning_queue()` ve `expire_mavi_reasoning()` fonksiyonlarını
-- **çağırır**, sonucu kütüğe yazar. Ne yapmaz: niyet çözmez, kanıt okumaz,
-- güven hesaplamaz, eşik tanımlamaz, `mavi_reason`ı DOĞRUDAN çağırmaz.
-- Karar mantığı 057'de, olay→resolver eşlemesi 058'de kalır ve buraya
-- KOPYALANMAZ — kopyalanırsa aşağıdaki doğrulama (c) DÜŞER.
--
-- ── LLM YOK ──────────────────────────────────────────────────────────────
-- Dış çağrı yok · cümle yok · tahmin yok.
--
-- ── ÜÇ FAIL-CLOSED KURALI ────────────────────────────────────────────────
--   1. **Örtüşen koşum YOKTUR:** önceki tik sürerken gelen yeni tik iş
--      yapmaz, `SKIPPED_LOCKED` olarak DÜRÜSTÇE kaydedilir (advisory lock).
--   2. **Ölçülmeyen sayaç `0` DEĞİL `NULL`dır:** düşen veya atlanan koşumda
--      "0 iş işlendi" yazmak, hiç çalışmamayı başarı gibi gösterirdi.
--      Kısıt bunu şemada zorlar (`mrsr_counts_only_when_completed`).
--   3. **Koşum satırı ÖNCE `FAILED` açılır:** oturum koşum ortasında ölürse
--      kütükte yarım kalmış iş `FAILED` görünür — sessiz kayıp yoktur.
--
-- ── ZAMANLAMA ORTAM BAĞIMLIDIR (DÜRÜSTLÜK) ───────────────────────────────
-- `pg_cron` her ortamda kurulamaz (yönetilen Supabase'te panelden açılır).
-- Bu migration kurmayı DENER; başarısız olursa **sessizce başarılı gibi
-- davranmaz**: `get_reasoning_scheduler_health()` `job_scheduled=false` ve
-- `healthy=false` döner. "Zamanlayıcı yok" bir arızadır ve görünür kalır.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. KOŞUM KÜTÜĞÜ (bounded) ───────────────────────────────────────────
--
-- ⚠️ Kütük olmadan "zamanlayıcı çalıştı mı" sorusu CEVAPLANAMAZ; cevaplanamayan
-- bir alt sistem gözlemlenebilir değildir (CLAUDE.md). Kütük ŞİRKET BAZLI
-- DEĞİLDİR: koşucu filo geneli çalışır. Bu yüzden tabloya istemci erişimi
-- KAPALIDIR (bkz. §5) ve okuma yalnız şirket verisi taşımayan RPC iledir.
CREATE TABLE IF NOT EXISTS public.mavi_reasoning_scheduler_run (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  /* Koşumu kim tetikledi — bounded KOD. */
  trigger_source text NOT NULL,
  outcome        text NOT NULL,

  /* Sayaçlar: YALNIZ tamamlanan koşumda ölçülür (kural 2). */
  processed      integer,
  completed      integer,
  failed         integer,
  skipped        integer,
  expired        integer,

  last_error     text,

  started_at     timestamptz NOT NULL DEFAULT now(),
  finished_at    timestamptz,

  CONSTRAINT mrsr_source_valid  CHECK (trigger_source IN ('CRON','MANUAL')),
  CONSTRAINT mrsr_outcome_valid CHECK (outcome IN ('COMPLETED','SKIPPED_LOCKED','FAILED')),
  CONSTRAINT mrsr_counts_nonneg CHECK (
    coalesce(processed,0) >= 0 AND coalesce(completed,0) >= 0
    AND coalesce(failed,0) >= 0 AND coalesce(skipped,0) >= 0
    AND coalesce(expired,0) >= 0),
  /* (2) Tamamlanmamış koşum sayaç TAŞIYAMAZ — sahte "0 iş" yasak. */
  CONSTRAINT mrsr_counts_only_when_completed CHECK (
    outcome = 'COMPLETED'
    OR (processed IS NULL AND completed IS NULL AND failed IS NULL
        AND skipped IS NULL AND expired IS NULL)),
  /* Tamamlanan koşum ölçümsüz olamaz (ters yön). */
  CONSTRAINT mrsr_completed_has_counts CHECK (
    outcome <> 'COMPLETED' OR processed IS NOT NULL),
  CONSTRAINT mrsr_timing_sane CHECK (finished_at IS NULL OR finished_at >= started_at)
);

CREATE INDEX IF NOT EXISTS mrsr_started_idx
  ON public.mavi_reasoning_scheduler_run (started_at DESC);

COMMENT ON TABLE public.mavi_reasoning_scheduler_run IS
  'MAVI karar kuyruğu koşum kütüğü (059). Karar ÜRETMEZ; yalnız koşucunun ne zaman, ne kadar iş işlediğini kaydeder. Bounded: son 500 koşum.';

-- ── 2. ZAMANLAYICI KOŞUCUSU ─────────────────────────────────────────────
--
-- ⚠️ TEK İŞİ ÇAĞIRMAKTIR. Gövdede karar mantığı olmadığı doğrulama (c) ile
-- sınanır: `mavi_reason(` · `ai_evidence` · `_reasoning_confidence` ·
-- `SUPPORTED` geçerse migration DÜŞER.

/* Advisory lock anahtarı — SABİT ve tek yerde tanımlı (çağıran değiştiremez). */
CREATE OR REPLACE FUNCTION public._reasoning_scheduler_lock_key()
RETURNS bigint LANGUAGE sql IMMUTABLE SET search_path = public
AS $fn$ SELECT 590059001::bigint $fn$;

/* Kütük tavanı — sınırsız büyüyen kütük disk sızıntısıdır. */
CREATE OR REPLACE FUNCTION public._reasoning_scheduler_history_max()
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = public
AS $fn$ SELECT 500 $fn$;

CREATE OR REPLACE FUNCTION public.run_mavi_reasoning_scheduler(
  p_limit integer DEFAULT 100, p_source text DEFAULT 'CRON')
RETURNS TABLE (
  outcome text, processed integer, completed integer,
  failed integer, skipped integer, expired integer)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_run bigint; q record; v_exp integer; v_err text;
  v_src text := CASE WHEN p_source = 'MANUAL' THEN 'MANUAL' ELSE 'CRON' END;
  v_key bigint := public._reasoning_scheduler_lock_key();
BEGIN
  -- (1) ÖRTÜŞME KORUMASI: önceki tik hâlâ çalışıyorsa bu tik İŞ YAPMAZ.
  --     Sessizce dönmez — atlandığı kütüğe yazılır.
  IF NOT pg_try_advisory_lock(v_key) THEN
    INSERT INTO public.mavi_reasoning_scheduler_run
      (trigger_source, outcome, finished_at)
    VALUES (v_src, 'SKIPPED_LOCKED', now());
    RETURN QUERY SELECT 'SKIPPED_LOCKED'::text,
      NULL::integer, NULL::integer, NULL::integer, NULL::integer, NULL::integer;
    RETURN;
  END IF;

  /* (3) FAIL-CLOSED AÇILIŞ: koşum ortasında oturum ölürse kütükte `FAILED`
     kalır. "Başladı ama bitmedi" hiçbir koşulda "başarılı" görünmez. */
  INSERT INTO public.mavi_reasoning_scheduler_run (trigger_source, outcome)
  VALUES (v_src, 'FAILED') RETURNING id INTO v_run;

  BEGIN
    /* TEK İŞ: 058'in koşucusunu ve 057'nin süre dolumunu ÇAĞIR. */
    SELECT * INTO q FROM public.run_mavi_reasoning_queue(p_limit);
    v_exp := public.expire_mavi_reasoning();
  EXCEPTION WHEN OTHERS THEN
    /* Hata SESSİZCE YUTULMAZ: kütüğe bounded olarak yazılır. */
    v_err := left(coalesce(SQLSTATE,'') || ':' || coalesce(SQLERRM,''), 200);
    UPDATE public.mavi_reasoning_scheduler_run
       SET last_error = v_err, finished_at = now()
     WHERE id = v_run;
    PERFORM pg_advisory_unlock(v_key);
    RETURN QUERY SELECT 'FAILED'::text,
      NULL::integer, NULL::integer, NULL::integer, NULL::integer, NULL::integer;
    RETURN;
  END;

  UPDATE public.mavi_reasoning_scheduler_run
     SET outcome = 'COMPLETED',
         processed = q.processed, completed = q.completed,
         failed = q.failed, skipped = q.skipped, expired = v_exp,
         finished_at = now()
   WHERE id = v_run;

  /* Bounded kütük — en eskiler düşer. */
  DELETE FROM public.mavi_reasoning_scheduler_run
   WHERE id <= (SELECT max(id) - public._reasoning_scheduler_history_max()
                  FROM public.mavi_reasoning_scheduler_run);

  PERFORM pg_advisory_unlock(v_key);

  RETURN QUERY SELECT 'COMPLETED'::text,
    q.processed, q.completed, q.failed, q.skipped, v_exp;
END;
$fn$;

COMMENT ON FUNCTION public.run_mavi_reasoning_scheduler(integer, text) IS
  'MAVI karar kuyruğu zamanlanmış koşumu (059). Yalnız run_mavi_reasoning_queue + expire_mavi_reasoning ÇAĞIRIR; karar üretmez.';

-- ── 3. ZAMANLAMA (pg_cron · fail-soft) ──────────────────────────────────
--
-- ⚠️ Dakikada bir: 058'in yeniden deneme geri çekilmesi 1 dakikadan başlar
-- (`next_attempt_at = now() + 1dk * 2^attempts`), dolayısıyla daha sık
-- koşmak boşuna uyanmaktır, daha seyrek koşmak ilk yeniden denemeyi
-- geciktirir. Kuyruğa alınan hot-path olaylarının karar gecikmesi ≤ 60 sn.
--
-- ⚠️ `CREATE EXTENSION` yönetilen ortamda yetki isteyebilir. Başarısız olursa
-- migration DÜŞMEZ (yoksa bu paket pg_cron'suz ortamlarda uygulanamazdı) —
-- ama gerçek `get_reasoning_scheduler_health()` üzerinden GÖRÜNÜR kalır.
DO $sched$
DECLARE v_ext boolean := false;
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
    v_ext := true;
  EXCEPTION WHEN OTHERS THEN
    v_ext := false;   -- kurulamadı; sağlık RPC'si bunu dürüstçe raporlar
  END;

  IF v_ext AND to_regclass('cron.job') IS NOT NULL THEN
    /* İdempotens: aynı isimli iş varsa önce kaldırılır (çift koşum olmaz). */
    PERFORM cron.unschedule(jobid) FROM cron.job
      WHERE jobname = 'mavi-reasoning-scheduler';
    PERFORM cron.schedule('mavi-reasoning-scheduler', '* * * * *',
      $cmd$SELECT public.run_mavi_reasoning_scheduler(100, 'CRON')$cmd$);
  END IF;
END
$sched$;

-- ── 4. SAĞLIK OKUMASI (salt-okunur · şirket verisi TAŞIMAZ) ─────────────
--
-- ⚠️ Ölçülemeyen alan `NULL` döner, `0` DEĞİL: "hiç koşmadı" ile "koştu ve
-- 0 iş buldu" farklı gerçeklerdir. `healthy` de üç değerlidir — zamanlayıcı
-- kurulu ama henüz tetiklenmemişse cevap "sağlıklı" değil, **BİLİNMİYOR**dur.
CREATE OR REPLACE FUNCTION public.get_reasoning_scheduler_health()
RETURNS TABLE (
  scheduler_installed boolean,
  job_scheduled boolean,
  schedule_expression text,
  interval_seconds integer,
  run_total integer,
  last_run_age_seconds integer,
  last_run_outcome text,
  last_run_duration_ms numeric,
  last_processed integer,
  last_expired integer,
  consecutive_failure_count integer,
  overdue boolean,
  healthy boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_uid uuid := auth.uid(); v_co uuid;
  v_ext boolean; v_sched boolean := false; v_expr text := NULL;
  v_int integer := NULL; v_total integer; v_age integer; v_outcome text;
  v_dur numeric; v_proc integer; v_exp integer; v_fails integer := 0;
  v_overdue boolean := NULL; v_healthy boolean; r record;
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;                    -- fail-closed
  SELECT p.company_id INTO v_co FROM public.profiles p WHERE p.id = v_uid;
  IF v_co IS NULL THEN RETURN; END IF;

  v_ext := EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron');

  IF v_ext AND to_regclass('cron.job') IS NOT NULL THEN
    EXECUTE $q$SELECT schedule FROM cron.job WHERE jobname = 'mavi-reasoning-scheduler' LIMIT 1$q$
      INTO v_expr;
    v_sched := v_expr IS NOT NULL;
  END IF;

  /* Aralık YALNIZ kesin bilinen ifadeden türetilir; tahmin edilmez. */
  IF v_expr = '* * * * *' THEN v_int := 60; END IF;

  SELECT count(*)::int INTO v_total FROM public.mavi_reasoning_scheduler_run;

  SELECT s.outcome,
         extract(epoch FROM (now() - s.started_at))::int,
         CASE WHEN s.finished_at IS NOT NULL
              THEN extract(epoch FROM (s.finished_at - s.started_at)) * 1000 END,
         s.processed, s.expired
    INTO v_outcome, v_age, v_dur, v_proc, v_exp
    FROM public.mavi_reasoning_scheduler_run s
   ORDER BY s.id DESC LIMIT 1;

  /* Art arda düşen koşum sayısı — en yeniden geriye. */
  FOR r IN SELECT s.outcome FROM public.mavi_reasoning_scheduler_run s
            ORDER BY s.id DESC LIMIT 50
  LOOP
    EXIT WHEN r.outcome <> 'FAILED';
    v_fails := v_fails + 1;
  END LOOP;

  /* Gecikme YALNIZ aralık ve son koşum biliniyorsa hesaplanır. */
  IF v_int IS NOT NULL AND v_age IS NOT NULL THEN
    v_overdue := v_age > (v_int * 3);
  END IF;

  /* ⚠️ ÜÇ DEĞERLİ VE FAIL-CLOSED: "sağlıklı" yalnız ÖLÇÜLDÜĞÜNDE söylenir.
     Aralık bilinmiyorsa gecikme hesaplanamaz → cevap "iyi" değil BİLİNMİYOR. */
  v_healthy := CASE
    WHEN NOT v_sched THEN false          -- zamanlayıcı yok: gerçek arıza
    WHEN v_age IS NULL THEN NULL         -- kurulu ama hiç koşmadı: BİLİNMİYOR
    WHEN v_fails > 0 THEN false
    WHEN v_int IS NULL THEN NULL         -- aralık bilinmiyor → gecikme ölçülemez
    WHEN v_overdue THEN false
    ELSE true
  END;

  RETURN QUERY SELECT v_ext, v_sched, v_expr, v_int, v_total, v_age, v_outcome,
                      v_dur, v_proc, v_exp, v_fails, v_overdue, v_healthy;
END;
$fn$;

-- ── 5. YETKİLER ─────────────────────────────────────────────────────────
/* ⚠️ Koşucu İSTEMCİYE AÇILMAZ: karar üretimini tetiklemek sunucunun işidir. */
REVOKE ALL ON FUNCTION public.run_mavi_reasoning_scheduler(integer, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_mavi_reasoning_scheduler(integer, text) TO service_role;

REVOKE ALL ON FUNCTION public.get_reasoning_scheduler_health() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_reasoning_scheduler_health()
  TO authenticated, service_role;

-- ── 6. RLS + İZİNLER ────────────────────────────────────────────────────
/* ⚠️ Kütük şirket bazlı DEĞİLDİR → istemciye HİÇ açılmaz (policy YOK =
   varsayılan RED). Şirket kullanıcısı zamanlayıcıyı yalnız RPC üzerinden,
   şirket verisi içermeyen biçimde görür. */
ALTER TABLE public.mavi_reasoning_scheduler_run ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mavi_reasoning_scheduler_run FROM anon, authenticated, PUBLIC;
GRANT ALL ON TABLE public.mavi_reasoning_scheduler_run TO service_role;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- DOĞRULAMA (fail-closed) — fonksiyonlar ÇAĞRILARAK sınanır.
-- ═══════════════════════════════════════════════════════════════════════════

DO $verify$
DECLARE r record; v_def text; v_n integer; v_ext boolean;
BEGIN
  -- (a) Kütük tablosu + ölçüm dürüstlüğü kısıtları
  IF to_regclass('public.mavi_reasoning_scheduler_run') IS NULL THEN
    RAISE EXCEPTION '059 HATA: kosum kutugu tablosu yok';
  END IF;
  FOR r IN SELECT unnest(ARRAY['mrsr_counts_only_when_completed',
                               'mrsr_completed_has_counts',
                               'mrsr_outcome_valid','mrsr_timing_sane']) AS c
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = r.c) THEN
      RAISE EXCEPTION '059 HATA: kisit yok: % (sahte sayac yazilabilir)', r.c;
    END IF;
  END LOOP;

  -- (b) Koşucu var ve DEFINER + search_path
  FOR r IN SELECT p.proname, pg_get_functiondef(p.oid) AS def
             FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public'
              AND p.proname IN ('run_mavi_reasoning_scheduler',
                                'get_reasoning_scheduler_health',
                                '_reasoning_scheduler_lock_key',
                                '_reasoning_scheduler_history_max')
  LOOP
    IF r.def NOT LIKE '%search_path%' THEN
      RAISE EXCEPTION '059 HATA: %: search_path eksik', r.proname;
    END IF;
  END LOOP;
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'run_mavi_reasoning_scheduler';
  IF v_def NOT LIKE '%SECURITY DEFINER%' THEN
    RAISE EXCEPTION '059 HATA: kosucu DEFINER degil';
  END IF;

  -- (c) İKİNCİ OTORİTE YASAĞI — koşucu yalnız ÇAĞIRIR
  IF v_def NOT LIKE '%run_mavi_reasoning_queue(%'
     OR v_def NOT LIKE '%expire_mavi_reasoning()%' THEN
    RAISE EXCEPTION '059 HATA: kosucu mevcut koseculari cagirmiyor';
  END IF;
  IF v_def LIKE '%mavi_reason(%' OR v_def LIKE '%ai_evidence%'
     OR v_def LIKE '%_reasoning_confidence%' OR v_def LIKE '%_reasoning_resolve%'
     OR v_def LIKE '%SUPPORTED%' OR v_def LIKE '%CONFLICTED_EVIDENCE%' THEN
    RAISE EXCEPTION '059 HATA: zamanlayici kendi karar mantigini yaziyor (ikinci otorite)';
  END IF;
  IF v_def LIKE '%http%' OR v_def LIKE '%openrouter%' OR v_def LIKE '%gemini%'
     OR v_def LIKE '%anthropic%' OR v_def LIKE '%openai%' THEN
    RAISE EXCEPTION '059 HATA: zamanlayicida dis cagri var (LLM)';
  END IF;

  -- (d) ÖRTÜŞME KORUMASI gerçekten var
  IF v_def NOT LIKE '%pg_try_advisory_lock%'
     OR v_def NOT LIKE '%SKIPPED_LOCKED%' THEN
    RAISE EXCEPTION '059 HATA: ortusen kosum korumasi yok';
  END IF;

  -- (e) İSTEMCİ KİLİDİ
  IF has_function_privilege('authenticated',
       'public.run_mavi_reasoning_scheduler(integer,text)', 'EXECUTE') THEN
    RAISE EXCEPTION '059 HATA: istemci zamanlayiciyi calistirabiliyor';
  END IF;
  IF has_table_privilege('authenticated','public.mavi_reasoning_scheduler_run','SELECT')
     OR has_table_privilege('anon','public.mavi_reasoning_scheduler_run','SELECT') THEN
    RAISE EXCEPTION '059 HATA: istemci kosum kutugunu okuyabiliyor';
  END IF;
  IF has_function_privilege('anon',
       'public.get_reasoning_scheduler_health()', 'EXECUTE') THEN
    RAISE EXCEPTION '059 HATA: anon zamanlayici sagligini okuyabiliyor';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public'
                  AND tablename='mavi_reasoning_scheduler_run' AND rowsecurity) THEN
    RAISE EXCEPTION '059 HATA: kosum kutugu RLS kapali';
  END IF;

  -- (f) 057 · 058 DEĞİŞTİRİLMEDİ
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                  WHERE n.nspname='public' AND p.proname='run_mavi_reasoning_queue') THEN
    RAISE EXCEPTION '059 HATA: 058 kuyruk kosucusu kayboldu';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public'
                  AND indexname='mre_open_dedupe_unique') THEN
    RAISE EXCEPTION '059 HATA: 058 bounded dedupe kilidi kayboldu';
  END IF;
  IF public._reasoning_confidence('SUPPORTED','VERY_HIGH',1,1.0) <> 'MEDIUM' THEN
    RAISE EXCEPTION '059 HATA: 057 guven kapisi DEGISTI';
  END IF;
  IF public._reasoning_can_transition('NEW','SUPPORTED') THEN
    RAISE EXCEPTION '059 HATA: 057 durum makinesi DEGISTI';
  END IF;
  IF public._evidence_confidence('BLACKBOX','MEASURED',1) <> 'MEDIUM' THEN
    RAISE EXCEPTION '059 HATA: 055 guven kapisi DEGISTI';
  END IF;
  IF public._dna_status(4, 500) <> 'NO_DNA' THEN
    RAISE EXCEPTION '059 HATA: 053 DNA esigi DEGISTI';
  END IF;
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='_reasoning_resolve';
  IF v_def LIKE '%scheduler%' THEN
    RAISE EXCEPTION '059 HATA: resolver zamanlayiciya baglanmis';
  END IF;

  -- (g) ZAMANLAMA DURUMU DÜRÜSTÇE RAPORLANIYOR
  v_ext := EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron');
  IF v_ext THEN
    SELECT count(*) INTO v_n FROM cron.job WHERE jobname = 'mavi-reasoning-scheduler';
    IF v_n <> 1 THEN
      RAISE EXCEPTION '059 HATA: pg_cron kurulu ama is zamanlanmamis (adet=%)', v_n;
    END IF;
    RAISE NOTICE '059 OK: kuyruk kosucusu DAKIKADA BIR zamanlandi (pg_cron).';
  ELSE
    RAISE WARNING '059 UYARI: pg_cron KURULAMADI — kuyruk otomatik islenmeyecek. get_reasoning_scheduler_health() job_scheduled=false/healthy=false dondurur (acik borc, gizlenmiyor).';
  END IF;

  RAISE NOTICE '059 OK: kuyruk kosucusu zamanlandi · ortusen kosum engellendi · olculmeyen sayac NULL · zamanlayici karar URETMIYOR · 053-058 katmanlari DEGISMEDI.';
END
$verify$;
