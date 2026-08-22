-- ═══════════════════════════════════════════════════════════════════════════
-- 070  ZAMANLANMIŞ RAPOR — ÇALIŞAN YARISI  (V-16/2)
--
-- ── BULGU ─────────────────────────────────────────────────────────────────
-- Enterprise sayfası *"Otomatik Raporlar — Günlük/haftalık PDF rapor
-- **gönderimi**"* vaat ediyordu. #714 ile PDF **üretimi** gerçek oldu, ama
-- **zamanlama YOKTU**: raporu almanın tek yolu birinin panele girip düğmeye
-- basmasıydı.
--
-- ── KAPSAM SINIRI AÇIKÇA ÇİZİLDİ ──────────────────────────────────────────
-- "Gönderim"in **e-posta** ayağı bu turda YAPILMADI ve YAPILAMAZ: bir e-posta
-- sağlayıcısı seçmek (Resend/SendGrid/SMTP) **ürün sahibinin kararıdır** —
-- maliyet, sözleşme ve filo verisinin e-postayla dışarı çıkmasının KVKK
-- sonuçları vardır. Bir yazılım ajanı bunu kendi başına üstlenemez.
--
-- Bu yüzden **karar gerektirmeyen yarısı** yapıldı ve GERÇEKTEN çalışır:
--   zamanlama + vadesi gelen raporun **uygulama içi bildirimle** teslimi.
-- Kullanıcı bildirimi görür ve panelden PDF'i indirir (canlı veriden üretilir;
-- dosya saklanmaz → depolama maliyeti ve bayat rapor riski YOK).
--
-- ── IDEMPOTANS (bu dosyanın en kritik kararı) ─────────────────────────────
-- pg_cron SAATTE BİR koşar. Naif bir "vakti geldi mi" kontrolü, günlük bir
-- raporu saat 08:00'den sonraki HER SAAT yeniden gönderirdi (günde 16 bildirim).
-- Bu yüzden vade, **dönem SINIRINA** göre hesaplanır: aynı gün/hafta içinde
-- ikinci kez ateşlenmez.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.report_schedules (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name         text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  frequency    text NOT NULL CHECK (frequency IN ('DAILY', 'WEEKLY')),
  /* UTC saat: sunucu yerel saati kullanırsa yaz/kış saatiyle rapor kayar. */
  hour_utc     integer NOT NULL DEFAULT 6 CHECK (hour_utc BETWEEN 0 AND 23),
  /* Haftalık için 0=Pazar … 6=Cumartesi; günlükte YOK SAYILIR. */
  weekday      integer CHECK (weekday IS NULL OR weekday BETWEEN 0 AND 6),
  enabled      boolean NOT NULL DEFAULT true,
  last_run_at  timestamptz,
  created_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT weekly_needs_weekday
    CHECK (frequency <> 'WEEKLY' OR weekday IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS report_schedules_company_idx ON public.report_schedules (company_id);

REVOKE ALL ON TABLE public.report_schedules FROM anon, authenticated, PUBLIC;
GRANT ALL ON TABLE public.report_schedules TO service_role;
ALTER TABLE public.report_schedules ENABLE ROW LEVEL SECURITY;

/* ── Vade hesabı — SAF ve TEST EDİLEBİLİR ───────────────────────────────── */
CREATE OR REPLACE FUNCTION public._report_schedule_due(
  p_frequency text, p_hour_utc integer, p_weekday integer,
  p_last_run timestamptz, p_now timestamptz)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE period_start timestamptz;
BEGIN
  IF p_frequency = 'DAILY' THEN
    IF extract(hour from p_now AT TIME ZONE 'UTC') < p_hour_utc THEN RETURN false; END IF;
    period_start := date_trunc('day', p_now AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  ELSIF p_frequency = 'WEEKLY' THEN
    IF extract(dow from p_now AT TIME ZONE 'UTC')::int <> p_weekday THEN RETURN false; END IF;
    IF extract(hour from p_now AT TIME ZONE 'UTC') < p_hour_utc THEN RETURN false; END IF;
    period_start := date_trunc('day', p_now AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  ELSE
    RETURN false;                       -- bilinmeyen frekans ATEŞLENMEZ
  END IF;

  /* ASIL KİLİT: bu dönem içinde zaten koştuysa TEKRAR ATEŞLENMEZ.
     Bu kontrol olmasaydı saatlik cron, günlük raporu günde 16 kez gönderirdi. */
  RETURN p_last_run IS NULL OR p_last_run < period_start;
END
$$;

/* ── Yönetim RPC'leri (yalnız admin) ────────────────────────────────────── */
CREATE OR REPLACE FUNCTION public.create_report_schedule(
  p_name text, p_frequency text,
  p_hour_utc integer DEFAULT 6, p_weekday integer DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_co uuid := public._api_key_admin_company(); v_id uuid;
BEGIN
  IF v_co IS NULL THEN
    RETURN jsonb_build_object('state','REJECTED','reason','NOT_AUTHORIZED');
  END IF;
  IF p_frequency NOT IN ('DAILY','WEEKLY') THEN
    RETURN jsonb_build_object('state','REJECTED','reason','BAD_FREQUENCY');
  END IF;
  IF p_frequency = 'WEEKLY' AND p_weekday IS NULL THEN
    RETURN jsonb_build_object('state','REJECTED','reason','WEEKDAY_REQUIRED');
  END IF;

  INSERT INTO public.report_schedules (company_id, name, frequency, hour_utc, weekday, created_by)
  VALUES (v_co, btrim(p_name), p_frequency,
          greatest(least(coalesce(p_hour_utc, 6), 23), 0),
          CASE WHEN p_frequency = 'WEEKLY' THEN p_weekday END,
          auth.uid())
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('state','CREATED','scheduleId',v_id);
END
$$;

CREATE OR REPLACE FUNCTION public.list_report_schedules()
RETURNS TABLE (schedule_id uuid, name text, frequency text, hour_utc integer,
               weekday integer, enabled boolean, last_run_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_co uuid := public._api_key_admin_company();
BEGIN
  IF v_co IS NULL THEN RETURN; END IF;         -- fail-closed
  RETURN QUERY
  SELECT s.id, s.name, s.frequency, s.hour_utc, s.weekday, s.enabled, s.last_run_at
    FROM public.report_schedules s
   WHERE s.company_id = v_co
   ORDER BY s.created_at DESC;
END
$$;

CREATE OR REPLACE FUNCTION public.set_report_schedule_enabled(p_id uuid, p_enabled boolean)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_co uuid := public._api_key_admin_company(); n integer;
BEGIN
  IF v_co IS NULL THEN
    RETURN jsonb_build_object('state','REJECTED','reason','NOT_AUTHORIZED');
  END IF;
  UPDATE public.report_schedules SET enabled = coalesce(p_enabled, false)
   WHERE id = p_id AND company_id = v_co;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN RETURN jsonb_build_object('state','REJECTED','reason','NOT_FOUND'); END IF;
  RETURN jsonb_build_object('state','UPDATED','scheduleId',p_id,'enabled',p_enabled);
END
$$;

/* ── Koşucu — pg_cron saatte bir çağırır ────────────────────────────────── */
CREATE OR REPLACE FUNCTION public.run_report_schedules()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE s record; fired integer := 0; skipped integer := 0; n_admin integer;
BEGIN
  /* TESLİM YOLU YOKSA HİÇBİR ŞEY "KOŞTU" SAYILMAZ.
     Bu depoda iki migration zinciri var; `notifications` prod'da VAR ama bazı
     ortamlarda YOK. Tabloyu bulamadan `last_run_at` ilerletmek, teslim
     edilmemiş bir raporu "gönderildi" diye işaretlemek olurdu — ve o rapor
     bir daha ASLA denenmezdi. */
  IF to_regclass('public.notifications') IS NULL THEN
    RETURN jsonb_build_object('fired', 0, 'skipped', 0,
      'transport', 'UNAVAILABLE',
      'reason', 'NOTIFICATIONS_TABLE_MISSING',
      'emailTransport', 'NOT_CONFIGURED');
  END IF;

  FOR s IN SELECT * FROM public.report_schedules WHERE enabled ORDER BY created_at LOOP
    IF NOT public._report_schedule_due(s.frequency, s.hour_utc, s.weekday, s.last_run_at, now()) THEN
      skipped := skipped + 1;
      CONTINUE;
    END IF;

    /* Alıcı: şirketin admin/super_admin kullanıcıları. Bildirim KİŞİYE
       yazılır; şirkete tek satır yazmak, kimin göreceğini belirsiz bırakırdı. */
    INSERT INTO public.notifications (company_id, profile_id, title, message, severity)
    SELECT s.company_id, p.id,
           'Zamanlanmış rapor hazır',
           format('%s raporu hazır. Panelden PDF olarak indirebilirsiniz. '
                  'E-POSTA GONDERIMI HENUZ ACIK DEGIL.', s.name),
           'info'
      FROM public.profiles p
     WHERE p.company_id = s.company_id AND p.role IN ('admin','super_admin');
    GET DIAGNOSTICS n_admin = ROW_COUNT;

    /* Alıcı YOKSA da `last_run_at` ilerletilir: aksi hâlde bu zamanlama her
       saat yeniden denenir ve döngü sonsuza kadar boşa çalışır. Teslim YOLU
       vardır, yalnız alıcı yoktur — bu ayrı bir durumdur. */
    UPDATE public.report_schedules SET last_run_at = now() WHERE id = s.id;
    fired := fired + 1;
  END LOOP;

  RETURN jsonb_build_object('fired', fired, 'skipped', skipped,
                            /* Taşıma katmanı AÇIKÇA beyan edilir: "gönderildi"
                               sanılmasın. */
                            'transport', 'IN_APP_ONLY',
                            'emailTransport', 'NOT_CONFIGURED');
END
$$;

REVOKE ALL ON FUNCTION public.create_report_schedule(text, text, integer, integer) FROM anon, PUBLIC;
REVOKE ALL ON FUNCTION public.list_report_schedules()                              FROM anon, PUBLIC;
REVOKE ALL ON FUNCTION public.set_report_schedule_enabled(uuid, boolean)           FROM anon, PUBLIC;
REVOKE ALL ON FUNCTION public.run_report_schedules()      FROM anon, authenticated, PUBLIC;
REVOKE ALL ON FUNCTION public._report_schedule_due(text, integer, integer, timestamptz, timestamptz)
  FROM anon, PUBLIC;

GRANT EXECUTE ON FUNCTION public.create_report_schedule(text, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_report_schedules()                              TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_report_schedule_enabled(uuid, boolean)           TO authenticated;
GRANT EXECUTE ON FUNCTION public.run_report_schedules()                               TO service_role;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- DOĞRULAMA (fail-closed)
-- ═══════════════════════════════════════════════════════════════════════════
DO $verify$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                  WHERE n.nspname='public' AND c.relname='report_schedules' AND c.relrowsecurity) THEN
    RAISE EXCEPTION '070 DOGRULAMA: report_schedules uzerinde RLS KAPALI';
  END IF;

  IF has_function_privilege('authenticated','public.run_report_schedules()','EXECUTE') THEN
    RAISE EXCEPTION '070 DOGRULAMA: kosucu tarayiciya ACIK (herkes bildirim tetikleyebilir)';
  END IF;

  /* Idempotans: aynı dönemde ikinci kez ateşlenmemeli. */
  IF public._report_schedule_due('DAILY', 6, NULL,
        date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' + interval '7 hours',
        date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' + interval '9 hours') THEN
    RAISE EXCEPTION '070 DOGRULAMA: ayni gun icinde IKINCI kez atesleniyor (idempotans YOK)';
  END IF;

  RAISE NOTICE '070 DOGRULAMA GECTI: zamanlanmis rapor kuruldu (tasima: IN_APP_ONLY)';
END
$verify$;
