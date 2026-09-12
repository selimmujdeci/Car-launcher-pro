-- ═══════════════════════════════════════════════════════════════════════════
-- 067  ZAMANLANMIŞ RAPOR MATRİSİ  (V-16/2)
--
--   npm run test:schedule
--
-- ── NEDEN VAR ─────────────────────────────────────────────────────────────
-- Zamanlanmış bir işte iki hata sınıfı vardır ve naif bir test yalnız birini
-- görür:
--   ① Hiç ateşlenmemek        → rapor gelmez, kimse fark etmez
--   ② FAZLA ateşlenmek        → günlük rapor günde 16 bildirim üretir (spam)
-- pg_cron SAATTE BİR koşar; idempotans olmadan ② kaçınılmazdır.
--
-- Yalnız YEREL veritabanında koşar ve `ROLLBACK` ile biter.
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on
\pset pager off

BEGIN;

CREATE FUNCTION pg_temp.login(p_uid uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('request.jwt.claims', json_build_object('sub', p_uid::text)::text, true); END $$;

CREATE FUNCTION pg_temp.logout() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('request.jwt.claims', '', true); END $$;

CREATE TEMP TABLE sch_ids (k text PRIMARY KEY, v uuid);

/* ── FIXTURE: `notifications` ────────────────────────────────────────────
   Bu tablo PROD'da VARDIR ama yerel şemada YOKTUR (depoda iki migration
   zinciri var). Koşucunun GERÇEK teslim davranışını sınayabilmek için burada
   prod biçimiyle kurulur. Dosya `ROLLBACK` ile bittiği için KALICI DEĞİLDİR.
   Önce eksik hâlin dürüstçe raporlandığı da sınanır (HALKA 0). */
DO $ring0$
DECLARE res jsonb;
BEGIN
  IF to_regclass('public.notifications') IS NULL THEN
    res := public.run_report_schedules();
    IF (res ->> 'reason') <> 'NOTIFICATIONS_TABLE_MISSING' THEN
      RAISE EXCEPTION 'RAPOR HALKA 0 DUSTU -- teslim yolu yokken durum bildirilmiyor: %', res;
    END IF;
    IF (res ->> 'fired')::int <> 0 THEN
      RAISE EXCEPTION 'RAPOR HALKA 0 DUSTU -- teslim yolu yokken ATESLEDI';
    END IF;
    RAISE NOTICE 'HALKA 0 gectI: teslim yolu yokken durur ve NEDENINI soyler';
  ELSE
    RAISE NOTICE 'HALKA 0 atlandi: notifications zaten var';
  END IF;
END
$ring0$;

CREATE TABLE IF NOT EXISTS public.notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  vehicle_id uuid,
  profile_id uuid,
  title      text NOT NULL,
  message    text NOT NULL,
  severity   text NOT NULL,
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $setup$
DECLARE ca uuid; cb uuid;
        admin_a uuid := gen_random_uuid();
        member_a uuid := gen_random_uuid();
        admin_b uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.companies (name) VALUES ('SCH_TEST_A') RETURNING id INTO ca;
  INSERT INTO public.companies (name) VALUES ('SCH_TEST_B') RETURNING id INTO cb;
  INSERT INTO auth.users (id,email,instance_id,aud,role) VALUES
    (admin_a,'sch-a@caros.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
    (member_a,'sch-m@caros.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
    (admin_b,'sch-b@caros.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated');
  UPDATE public.profiles SET company_id=ca, role='admin'  WHERE id=admin_a;
  UPDATE public.profiles SET company_id=ca, role='member' WHERE id=member_a;
  UPDATE public.profiles SET company_id=cb, role='admin'  WHERE id=admin_b;
  INSERT INTO sch_ids VALUES ('ca',ca),('cb',cb),('admin_a',admin_a),('member_a',member_a),('admin_b',admin_b);
END
$setup$;

-- ═════════════════════════════════════════════════════════════════════════
-- HALKA 1 — VADE HESABI: iki yönde de doğru
-- ═════════════════════════════════════════════════════════════════════════
DO $ring1$
DECLARE base timestamptz := date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
BEGIN
  /* Saat gelmeden ATEŞLENMEZ. */
  IF public._report_schedule_due('DAILY', 6, NULL, NULL, base + interval '5 hours') THEN
    RAISE EXCEPTION 'RAPOR HALKA 1 DUSTU -- saat gelmeden atesleniyor';
  END IF;

  /* Saat gelince ATEŞLENİR. */
  IF NOT public._report_schedule_due('DAILY', 6, NULL, NULL, base + interval '7 hours') THEN
    RAISE EXCEPTION 'RAPOR HALKA 1 DUSTU -- saat geldigi halde ateslenmiyor';
  END IF;

  /* AYNI GÜN ikinci kez ATEŞLENMEZ — asıl kilit. */
  IF public._report_schedule_due('DAILY', 6, NULL, base + interval '7 hours', base + interval '9 hours') THEN
    RAISE EXCEPTION
      'RAPOR HALKA 1 DUSTU -- ayni gun IKINCI kez atesleniyor. Saatlik cron ile '
      'gunluk rapor gunde 16 bildirim uretirdi (spam).';
  END IF;

  /* ERTESİ GÜN yeniden ateşlenir. */
  IF NOT public._report_schedule_due('DAILY', 6, NULL, base + interval '7 hours', base + interval '31 hours') THEN
    RAISE EXCEPTION 'RAPOR HALKA 1 DUSTU -- ertesi gun ateslenmiyor';
  END IF;

  /* Bilinmeyen frekans ASLA ateşlenmez. */
  IF public._report_schedule_due('HOURLY', 0, NULL, NULL, base + interval '9 hours') THEN
    RAISE EXCEPTION 'RAPOR HALKA 1 DUSTU -- bilinmeyen frekans atesleniyor';
  END IF;

  RAISE NOTICE 'HALKA 1 gectI: vade hesabi hem ateslerken hem SUSARKEN dogru';
END
$ring1$;

-- ═════════════════════════════════════════════════════════════════════════
-- HALKA 2 — HAFTALIK: yalnız doğru günde
-- ═════════════════════════════════════════════════════════════════════════
DO $ring2$
DECLARE base timestamptz := date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
        today int := extract(dow from now() AT TIME ZONE 'UTC')::int;
BEGIN
  IF NOT public._report_schedule_due('WEEKLY', 6, today, NULL, base + interval '7 hours') THEN
    RAISE EXCEPTION 'RAPOR HALKA 2 DUSTU -- dogru gunde ateslenmiyor';
  END IF;
  IF public._report_schedule_due('WEEKLY', 6, (today + 3) % 7, NULL, base + interval '7 hours') THEN
    RAISE EXCEPTION 'RAPOR HALKA 2 DUSTU -- YANLIS gunde atesleniyor';
  END IF;
  RAISE NOTICE 'HALKA 2 gectI: haftalik yalniz dogru gunde ateslenir';
END
$ring2$;

-- ═════════════════════════════════════════════════════════════════════════
-- HALKA 3 — YETKİ
-- ═════════════════════════════════════════════════════════════════════════
DO $ring3$
DECLARE uid uuid; res jsonb;
BEGIN
  SELECT v INTO uid FROM sch_ids WHERE k='member_a';
  PERFORM pg_temp.login(uid);
  IF (public.create_report_schedule('member denemesi','DAILY',6) ->> 'state') <> 'REJECTED' THEN
    RAISE EXCEPTION 'RAPOR HALKA 3 DUSTU -- member zamanlama olusturabildi';
  END IF;

  PERFORM pg_temp.logout();
  IF (public.create_report_schedule('anonim','DAILY',6) ->> 'state') <> 'REJECTED' THEN
    RAISE EXCEPTION 'RAPOR HALKA 3 DUSTU -- kimliksiz zamanlama olusturabildi';
  END IF;

  SELECT v INTO uid FROM sch_ids WHERE k='admin_a';
  PERFORM pg_temp.login(uid);

  /* Haftalık, gün verilmeden REDDEDİLMELİ. */
  IF (public.create_report_schedule('haftalik eksik','WEEKLY',6,NULL) ->> 'reason') <> 'WEEKDAY_REQUIRED' THEN
    RAISE EXCEPTION 'RAPOR HALKA 3 DUSTU -- haftalik gun olmadan kabul edildi';
  END IF;

  res := public.create_report_schedule('A gunluk','DAILY',0);
  IF (res ->> 'state') <> 'CREATED' THEN
    RAISE EXCEPTION 'RAPOR HALKA 3 DUSTU -- admin olusturamadi: %', res;
  END IF;
  INSERT INTO sch_ids VALUES ('sch_a', (res ->> 'scheduleId')::uuid);
  PERFORM pg_temp.logout();
  RAISE NOTICE 'HALKA 3 gectI: yalniz admin zamanlama olusturabiliyor';
END
$ring3$;

-- ═════════════════════════════════════════════════════════════════════════
-- HALKA 4 — KOŞUCU: ateşler, İKİNCİ KEZ ATEŞLEMEZ
-- ═════════════════════════════════════════════════════════════════════════
DO $ring4$
DECLARE ca uuid; res jsonb; n1 integer; n2 integer;
BEGIN
  SELECT v INTO ca FROM sch_ids WHERE k='ca';

  res := public.run_report_schedules();
  IF (res ->> 'fired')::int < 1 THEN
    RAISE EXCEPTION 'RAPOR HALKA 4 DUSTU -- vadesi gelen zamanlama ateslenmedi: %', res;
  END IF;
  /* Taşıma katmanı AÇIKÇA beyan edilmeli; "gonderildi" sanilmasin. */
  IF (res ->> 'emailTransport') <> 'NOT_CONFIGURED' THEN
    RAISE EXCEPTION 'RAPOR HALKA 4 DUSTU -- e-posta tasimasi yokken beyan edilmiyor';
  END IF;

  SELECT count(*) INTO n1 FROM public.notifications
   WHERE company_id = ca AND title = 'Zamanlanmış rapor hazır';
  IF n1 < 1 THEN
    RAISE EXCEPTION 'RAPOR HALKA 4 DUSTU -- bildirim OLUSMADI';
  END IF;

  /* İKİNCİ koşum aynı saatte HİÇBİR ŞEY eklememeli. */
  PERFORM public.run_report_schedules();
  SELECT count(*) INTO n2 FROM public.notifications
   WHERE company_id = ca AND title = 'Zamanlanmış rapor hazır';
  IF n2 <> n1 THEN
    RAISE EXCEPTION
      'RAPOR HALKA 4 DUSTU -- ikinci kosum % bildirim daha ekledi (spam)', n2 - n1;
  END IF;

  RAISE NOTICE 'HALKA 4 gectI: bir kez atesledi, ikinci kosumda SUSTU (% bildirim)', n1;
END
$ring4$;

-- ═════════════════════════════════════════════════════════════════════════
-- HALKA 5 — KİRACI İZOLASYONU VE KAPATMA
-- ═════════════════════════════════════════════════════════════════════════
DO $ring5$
DECLARE cb uuid; uid uuid; sid uuid; n integer;
BEGIN
  SELECT v INTO cb  FROM sch_ids WHERE k='cb';
  SELECT v INTO sid FROM sch_ids WHERE k='sch_a';

  /* B şirketine bildirim GİTMEMELİ. */
  SELECT count(*) INTO n FROM public.notifications WHERE company_id = cb;
  IF n <> 0 THEN
    RAISE EXCEPTION 'RAPOR HALKA 5 DUSTU -- BASKA sirkete bildirim gitti';
  END IF;

  /* B'nin admini A'nın zamanlamasını göremez/kapatamaz. */
  SELECT v INTO uid FROM sch_ids WHERE k='admin_b';
  PERFORM pg_temp.login(uid);
  SELECT count(*) INTO n FROM public.list_report_schedules() WHERE schedule_id = sid;
  IF n <> 0 THEN
    RAISE EXCEPTION 'RAPOR HALKA 5 DUSTU -- CROSS-TENANT listeleme';
  END IF;
  IF (public.set_report_schedule_enabled(sid, false) ->> 'state') <> 'REJECTED' THEN
    RAISE EXCEPTION 'RAPOR HALKA 5 DUSTU -- BASKA sirket zamanlamayi kapatabildi';
  END IF;

  /* A'nın admini kapatır → bir daha ateşlenmez. */
  SELECT v INTO uid FROM sch_ids WHERE k='admin_a';
  PERFORM pg_temp.login(uid);
  IF (public.set_report_schedule_enabled(sid, false) ->> 'state') <> 'UPDATED' THEN
    RAISE EXCEPTION 'RAPOR HALKA 5 DUSTU -- admin kendi zamanlamasini kapatamadi';
  END IF;
  PERFORM pg_temp.logout();

  UPDATE public.report_schedules SET last_run_at = NULL WHERE id = sid;
  IF (public.run_report_schedules() ->> 'fired')::int <> 0 THEN
    RAISE EXCEPTION 'RAPOR HALKA 5 DUSTU -- KAPALI zamanlama atesledi';
  END IF;

  RAISE NOTICE 'HALKA 5 gectI: kiraci izolasyonu saglam, kapatma etkili';
END
$ring5$;

-- ═════════════════════════════════════════════════════════════════════════
-- HALKA 6 — ERİŞİM FAIL-CLOSED
-- ═════════════════════════════════════════════════════════════════════════
DO $ring6$
BEGIN
  IF has_table_privilege('anon','public.report_schedules','SELECT')
     OR has_table_privilege('authenticated','public.report_schedules','SELECT') THEN
    RAISE EXCEPTION 'RAPOR HALKA 6 DUSTU -- zamanlama tablosu OKUNABILIYOR';
  END IF;
  IF has_function_privilege('authenticated','public.run_report_schedules()','EXECUTE') THEN
    RAISE EXCEPTION 'RAPOR HALKA 6 DUSTU -- kosucu tarayiciya ACIK (herkes bildirim tetikler)';
  END IF;
  RAISE NOTICE 'HALKA 6 gectI: erisim fail-closed';
END
$ring6$;

DO $done$ BEGIN RAISE NOTICE 'ZAMANLANMIS RAPOR: 6 HALKA DA GECTI.'; END $done$;

ROLLBACK;
