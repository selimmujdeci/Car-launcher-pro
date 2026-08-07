-- ═══════════════════════════════════════════════════════════════════════════
-- 050 — DRIVER PRESENCE HISTORY (P1)
--
-- YALNIZ İLERİ MIGRATION. 033–049 geçmişi DEĞİŞTİRİLMEZ.
--
-- ── HANGİ SORUYU CEVAPLAR ────────────────────────────────────────────────
-- 049 "bu trip'in sürücüsü kim?" sorusunu cevaplar ve gözlemleri
-- append-only tutar. Bu migration farklı bir soruyu cevaplar:
--
--     "Bu araçta sürücü varlığı ZAMAN İÇİNDE nasıl değişti?"
--     (kim geldi · ne kadar kaldı · yerine kim geçti · kaç kez el değiştirdi)
--
-- ── RESOLVER'A DOKUNULMADI (BAĞLAYICI) ───────────────────────────────────
-- `_resolve_driver_presence` ve `_trip_attribution_trigger` **BU MIGRATION
-- TARAFINDAN DEĞİŞTİRİLMEZ**. Geçmiş bir KARAR katmanı değil, bir DEFTERDİR:
-- attribution'ı ne besler ne de değiştirir. Doğrulama bölümü bunu fonksiyon
-- gövdelerini OKUYARAK ve resolver'ı ÇAĞIRARAK kanıtlar (P0/P1 zinciri).
--
-- ── SAHTE VERİ YASAK ─────────────────────────────────────────────────────
-- Açık bir segmentin `expired_at` ve `duration_ms` değeri **NULL**'dır.
-- Sahte `0 sn` süre veya uydurma kapanış tarihi üretilmez; süre ancak
-- kapanış anı BİLİNDİĞİNDE hesaplanır.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. VARLIK SEGMENTİ DEFTERİ ──────────────────────────────────────────
--
-- Bu tablo gözlem YIĞINI değil SEGMENT defteridir. Bir segment kesintisiz
-- tek bir varlık dönemidir:
--
--     segment kimliği = (vehicle_id, driver_id, source)
--
-- Aynı sürücü kartını 10 kez okutursa bu 10 satır DEĞİL, süresi uzayan TEK
-- satırdır (`refresh_count` artar). Yeni satır ancak sürücü veya kaynak
-- değişince açılır — istenen "dedupe" davranışı budur.
CREATE TABLE IF NOT EXISTS public.vehicle_driver_presence_history (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  vehicle_id    uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  driver_id     uuid NOT NULL REFERENCES public.fleet_drivers(id) ON DELETE CASCADE,

  /* Segmenti AÇAN gözlem ve onu en son TAZELEYEN gözlem. Gözlem silinse
     bile segment tarihi kaybolmaz (SET NULL) — defter append-only'dir. */
  presence_id      uuid REFERENCES public.vehicle_driver_presence(id) ON DELETE SET NULL,
  last_presence_id uuid REFERENCES public.vehicle_driver_presence(id) ON DELETE SET NULL,

  source        text NOT NULL,
  /* Kaynak tavanı UYGULANMIŞ güven — istemci kendi güvenini yükseltemez
     (049'un "güven sunucuda üretilir" ilkesi burada da geçerlidir). */
  confidence    text NOT NULL,

  detected_at   timestamptz NOT NULL,
  /* Gözlemin PLANLANAN son geçerlilik anı (TTL). */
  expires_at    timestamptz NOT NULL,
  /* Segmentin GERÇEKTEN kapandığı an. NULL = HÂLÂ AÇIK. */
  expired_at    timestamptz,
  /* expired_at - detected_at. AÇIK segmentte NULL — sahte 0 YASAK. */
  duration_ms   bigint,
  close_reason  text,

  /* Aynı segmenti tazeleyen tekrar gözlem sayısı — dedupe kanıtı. */
  refresh_count integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT vdph_source_valid
    CHECK (source IN ('UNKNOWN','HEAD_UNIT','PHONE','BLUETOOTH','NFC')),
  CONSTRAINT vdph_confidence_valid
    CHECK (confidence IN ('VERY_HIGH','HIGH','MEDIUM','LOW','UNKNOWN')),
  CONSTRAINT vdph_close_reason_valid
    CHECK (close_reason IS NULL OR close_reason IN ('SUPERSEDED','TTL_EXPIRED','CLEARED')),
  CONSTRAINT vdph_range_valid CHECK (expires_at > detected_at),
  /* Kapanış başlangıçtan önce olamaz (saat kayması / bozuk veri). */
  CONSTRAINT vdph_close_after_start CHECK (expired_at IS NULL OR expired_at >= detected_at),
  /* YARIM KAPANIŞ YASAK: üçü birlikte dolar veya üçü birlikte boştur.
     "Kapandı ama süresi yok" veya "süresi var ama gerekçesi yok" bir
     defteri sessizce yalancı yapar. */
  CONSTRAINT vdph_close_consistent CHECK (
    (expired_at IS NULL     AND duration_ms IS NULL     AND close_reason IS NULL)
    OR
    (expired_at IS NOT NULL AND duration_ms IS NOT NULL AND close_reason IS NOT NULL)
  ),
  CONSTRAINT vdph_refresh_nonneg CHECK (refresh_count >= 0)
);

/* Bir araçta AYNI ANDA yalnız TEK açık segment olabilir. İki açık segment
   "iki kişi aynı anda sürüyor" demektir ve bu bir veri hatasıdır. */
CREATE UNIQUE INDEX IF NOT EXISTS vdph_single_open_per_vehicle
  ON public.vehicle_driver_presence_history (vehicle_id)
  WHERE expired_at IS NULL;

/* DEDUPE'un sert kilidi: birebir aynı gözlem (araç+sürücü+kaynak+an)
   ikinci bir segment ÜRETEMEZ. Trigger zaten üretmez; bu, mantık bozulursa
   veritabanının fail-closed savunmasıdır. */
CREATE UNIQUE INDEX IF NOT EXISTS vdph_observation_unique
  ON public.vehicle_driver_presence_history (vehicle_id, driver_id, source, detected_at);

CREATE INDEX IF NOT EXISTS vdph_vehicle_time_idx
  ON public.vehicle_driver_presence_history (vehicle_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS vdph_company_idx
  ON public.vehicle_driver_presence_history (company_id, detected_at DESC);

-- ── 2. SÜRE HESABI ──────────────────────────────────────────────────────
--
-- Tek yerde hesaplanır: iki farklı formül iki farklı "gerçek" üretir.
CREATE OR REPLACE FUNCTION public._presence_duration_ms(
  p_from timestamptz, p_to timestamptz)
RETURNS bigint
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $fn$
  SELECT CASE
           WHEN p_from IS NULL OR p_to IS NULL THEN NULL
           ELSE greatest(0, (extract(epoch FROM (p_to - p_from)) * 1000))::bigint
         END;
$fn$;

REVOKE ALL ON FUNCTION public._presence_duration_ms(timestamptz,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._presence_duration_ms(timestamptz,timestamptz)
  TO authenticated, service_role;

-- ── 3. DEFTER TRIGGER'I ─────────────────────────────────────────────────
--
-- Her presence DEĞİŞİMİNDE (yani her yeni gözlemde) defter güncellenir.
--
-- KARAR SIRASI:
--   1. Açık segmentin TTL'i yeni gözlemden önce dolmuşsa → `TTL_EXPIRED`
--   2. Gözlem AÇIK segmentten ESKİ ise (çevrimdışı replay) → yeni segment
--      **KAPALI** açılır; yeni olan segment BOZULMAZ
--   3. Açık segment AYNI (sürücü, kaynak) ise → **TAZELE** (yeni satır YOK)
--   4. Açık segment farklı ise → `SUPERSEDED` ile kapat
--   5. Yeni açık segment aç
--
-- ⚠️ Bu trigger `vehicle_driver_presence` üzerindedir; 049'un
--    `_trip_attribution_trigger`'ına DOKUNMAZ (o `vehicle_trips` üzerinde).
CREATE OR REPLACE FUNCTION public._presence_history_trigger()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_open     public.vehicle_driver_presence_history%ROWTYPE;
  v_has_open boolean := false;
  v_conf     text;
  v_close    timestamptz;
BEGIN
  /* Kaynak tavanı UYGULANIR — defter, istemcinin iddia ettiği güveni
     olduğu gibi saklamaz (049 ile aynı kural, paralel sistem YOK). */
  v_conf := public._presence_weakest(
              NEW.confidence, public._presence_source_ceiling(NEW.source));

  SELECT * INTO v_open
    FROM public.vehicle_driver_presence_history
   WHERE vehicle_id = NEW.vehicle_id AND expired_at IS NULL
   ORDER BY detected_at DESC
   LIMIT 1;
  v_has_open := FOUND;

  -- (1) TTL: sabah okutulan kart akşamki gözleme kadar "açık" SAYILMAZ.
  IF v_has_open AND v_open.expires_at <= NEW.detected_at THEN
    UPDATE public.vehicle_driver_presence_history
       SET expired_at   = v_open.expires_at,
           duration_ms  = public._presence_duration_ms(v_open.detected_at, v_open.expires_at),
           close_reason = 'TTL_EXPIRED'
     WHERE id = v_open.id;
    v_has_open := false;
  END IF;

  -- (2) GEÇ GELEN ESKİ GÖZLEM: çevrimdışı replay üç gün sonra gelebilir.
  --     Daha YENİ bir segmenti geriye dönük bozmak yerine, geçmişteki
  --     dönemi olduğu gibi KAPALI kaydeder.
  IF v_has_open AND NEW.detected_at < v_open.detected_at THEN
    v_close := least(v_open.detected_at, NEW.expires_at);
    INSERT INTO public.vehicle_driver_presence_history
      (company_id, vehicle_id, driver_id, presence_id, last_presence_id,
       source, confidence, detected_at, expires_at,
       expired_at, duration_ms, close_reason)
    VALUES
      (NEW.company_id, NEW.vehicle_id, NEW.driver_id, NEW.id, NEW.id,
       NEW.source, v_conf, NEW.detected_at, NEW.expires_at,
       v_close, public._presence_duration_ms(NEW.detected_at, v_close), 'SUPERSEDED')
    ON CONFLICT (vehicle_id, driver_id, source, detected_at) DO NOTHING;
    RETURN NEW;
  END IF;

  -- (3) DEDUPE: aynı sürücü + aynı kaynak → TEK segment kalır, süresi uzar.
  IF v_has_open AND v_open.driver_id = NEW.driver_id AND v_open.source = NEW.source THEN
    UPDATE public.vehicle_driver_presence_history
       SET expires_at       = greatest(expires_at, NEW.expires_at),
           confidence       = v_conf,
           last_presence_id = NEW.id,
           refresh_count    = refresh_count + 1
     WHERE id = v_open.id;
    RETURN NEW;   -- YENİ SATIR ÜRETİLMEDİ
  END IF;

  -- (4) DEVİR: kapanış anı, ölmüş bir segmenti "devredildi" yapmamak için
  --     segmentin kendi TTL'ini AŞAMAZ.
  IF v_has_open THEN
    v_close := greatest(v_open.detected_at,
                        least(NEW.detected_at, v_open.expires_at));
    UPDATE public.vehicle_driver_presence_history
       SET expired_at   = v_close,
           duration_ms  = public._presence_duration_ms(v_open.detected_at, v_close),
           close_reason = 'SUPERSEDED'
     WHERE id = v_open.id;
  END IF;

  -- (5) Yeni AÇIK segment: süre ve kapanış NULL — sahte 0 YOK.
  INSERT INTO public.vehicle_driver_presence_history
    (company_id, vehicle_id, driver_id, presence_id, last_presence_id,
     source, confidence, detected_at, expires_at)
  VALUES
    (NEW.company_id, NEW.vehicle_id, NEW.driver_id, NEW.id, NEW.id,
     NEW.source, v_conf, NEW.detected_at, NEW.expires_at)
  ON CONFLICT (vehicle_id, driver_id, source, detected_at) DO NOTHING;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_presence_history ON public.vehicle_driver_presence;
CREATE TRIGGER trg_presence_history
  AFTER INSERT ON public.vehicle_driver_presence
  FOR EACH ROW EXECUTE FUNCTION public._presence_history_trigger();

-- ── 4. SÜRESİ DOLAN SEGMENTİ KAPATMA (tembel bakım) ─────────────────────
--
-- PostgreSQL'de timer YOKTUR: bir segment, yeni bir gözlem gelmedikçe
-- defterde açık kalır. Bunun İKİ savunması vardır:
--   (a) OKUMA tarafı gerçeği söyler — süresi geçmiş segment `OPEN`
--       gösterilmez (bkz. `list_vehicle_presence_history`)
--   (b) bu bakım fonksiyonu kapanışı KALICI hâle getirir
-- `service_role` dışında kimse çağıramaz (kullanıcı defteri kapatamaz).
CREATE OR REPLACE FUNCTION public.settle_expired_presence_history()
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE v_n integer;
BEGIN
  UPDATE public.vehicle_driver_presence_history
     SET expired_at   = expires_at,
         duration_ms  = public._presence_duration_ms(detected_at, expires_at),
         close_reason = 'TTL_EXPIRED'
   WHERE expired_at IS NULL AND expires_at <= now();
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$fn$;

REVOKE ALL ON FUNCTION public.settle_expired_presence_history() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_expired_presence_history() TO service_role;

-- ── 5. OKUMA RPC'Sİ ─────────────────────────────────────────────────────
--
-- ── EN KRİTİK GÜVENLİK KARARI ────────────────────────────────────────────
-- Sürücü kimliği (id ve ad) YALNIZ kimlik doğrulayan kaynaklarda
-- (`NFC`, `BLUETOOTH`) döndürülür. Head unit'ten gelen "ben Ahmet'im"
-- beyanı defterde GÖRÜNÜR (kaynak ve süre okunur) ama **KİMİ iddia ettiği
-- söylenmez** — aksi halde 049'da kapatılan kapı, geçmiş ekranından
-- arkadan dolanılırdı ve doğrulanmamış bir iddia UI'da isim olarak
-- görünürdü.
--
-- Süresi geçmiş ama defterde henüz kapanmamış segment `OPEN` DÖNMEZ:
-- `status` ve `effective_expired_at` gerçeği söyler.
DROP FUNCTION IF EXISTS public.list_vehicle_presence_history(uuid, integer);

CREATE OR REPLACE FUNCTION public.list_vehicle_presence_history(
  p_vehicle_id uuid, p_limit integer DEFAULT 20)
RETURNS TABLE (
  history_id     uuid,
  vehicle_id     uuid,
  driver_id      uuid,
  driver_name    text,
  source         text,
  confidence     text,
  identity_verifying boolean,
  detected_at    timestamptz,
  expires_at     timestamptz,
  expired_at     timestamptz,
  duration_ms    bigint,
  close_reason   text,
  status         text,
  refresh_count  integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
#variable_conflict use_column
DECLARE
  v_uid uuid := auth.uid();
  v_co  uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;   -- fail-closed
  SELECT company_id INTO v_co FROM public.profiles WHERE id = v_uid;

  RETURN QUERY
  SELECT h.id,
         h.vehicle_id,
         /* Doğrulanmamış kaynakta KİMLİK VERİLMEZ (fail-closed). */
         CASE WHEN public._presence_is_identity_verifying(h.source)
              THEN h.driver_id END,
         CASE WHEN public._presence_is_identity_verifying(h.source)
              THEN (SELECT d.display_name FROM public.fleet_drivers d
                     WHERE d.id = h.driver_id AND d.company_id = v_co) END,
         h.source,
         h.confidence,
         public._presence_is_identity_verifying(h.source),
         h.detected_at,
         h.expires_at,
         /* Tembel kapanış: süresi geçmiş segmentin GERÇEK bitişi TTL'dir. */
         coalesce(h.expired_at,
                  CASE WHEN h.expires_at <= now() THEN h.expires_at END),
         coalesce(h.duration_ms,
                  CASE WHEN h.expires_at <= now()
                       THEN public._presence_duration_ms(h.detected_at, h.expires_at) END),
         h.close_reason,
         CASE WHEN h.close_reason IS NOT NULL THEN h.close_reason
              WHEN h.expires_at <= now()      THEN 'TTL_EXPIRED'
              ELSE 'OPEN' END,
         h.refresh_count
    FROM public.vehicle_driver_presence_history h
    JOIN public.vehicles v ON v.id = h.vehicle_id
   WHERE h.vehicle_id = p_vehicle_id
     AND (v.owner_id = v_uid OR (v_co IS NOT NULL AND v.company_id = v_co))
   ORDER BY h.detected_at DESC
   LIMIT LEAST(GREATEST(coalesce(p_limit, 20), 1), 100);
END;
$fn$;

REVOKE ALL ON FUNCTION public.list_vehicle_presence_history(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_vehicle_presence_history(uuid, integer)
  TO authenticated, service_role;

-- ── 6. RLS + İZİNLER ────────────────────────────────────────────────────
--
-- `authenticated` DOĞRUDAN YAZAMAZ: defteri yalnız trigger yazar. Bir
-- yöneticinin geçmişi elle "düzeltebilmesi", defteri kanıt olmaktan
-- çıkarırdı.
ALTER TABLE public.vehicle_driver_presence_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.vehicle_driver_presence_history FROM anon, PUBLIC;
GRANT SELECT ON TABLE public.vehicle_driver_presence_history TO authenticated;
GRANT ALL    ON TABLE public.vehicle_driver_presence_history TO service_role;

DROP POLICY IF EXISTS vdph_company_read ON public.vehicle_driver_presence_history;
CREATE POLICY vdph_company_read ON public.vehicle_driver_presence_history
  FOR SELECT TO authenticated
  USING (company_id = (SELECT p.company_id FROM public.profiles p WHERE p.id = auth.uid()));

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- DOĞRULAMA (fail-closed) — fonksiyonlar ÇAĞRILARAK sınanır (047 dersi).
-- ═══════════════════════════════════════════════════════════════════════════

DO $verify$
DECLARE r record; v_def text;
BEGIN
  -- (a) Tablo ve kilit kısıtlar
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema='public' AND table_name='vehicle_driver_presence_history') THEN
    RAISE EXCEPTION '050 HATA: presence history tablosu yok';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='vdph_close_consistent') THEN
    RAISE EXCEPTION '050 HATA: yarim kapanis kisiti yok (sahte sure uretilebilir)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public'
                  AND indexname='vdph_single_open_per_vehicle') THEN
    RAISE EXCEPTION '050 HATA: tek acik segment kilidi yok';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public'
                  AND indexname='vdph_observation_unique') THEN
    RAISE EXCEPTION '050 HATA: dedupe kilidi yok';
  END IF;

  -- (b) SÜRE HESABI ÇAĞRILARAK sınanır
  IF public._presence_duration_ms(
       timestamptz '2026-01-01 00:00:00Z', timestamptz '2026-01-01 01:00:00Z') <> 3600000 THEN
    RAISE EXCEPTION '050 HATA: sure hesabi yanlis';
  END IF;
  IF public._presence_duration_ms(NULL, now()) IS NOT NULL THEN
    RAISE EXCEPTION '050 HATA: bilinmeyen sure icin sahte deger uretildi';
  END IF;

  -- (c) 049 RESOLVER'I DEĞİŞMEDİ — hâlâ çağrılabilir ve gözlem yokken
  --     NO_PRESENCE döner (yani P0 atama modeli devrede kalır).
  SELECT * INTO r FROM public._resolve_driver_presence(
    gen_random_uuid(), gen_random_uuid(), now() - interval '1 hour', now(), NULL);
  IF r.decision <> 'NO_PRESENCE' OR r.driver_id IS NOT NULL THEN
    RAISE EXCEPTION '050 HATA: presence resolver davranisi DEGISTI: %', r.decision;
  END IF;

  -- (d) P0/P1 ZİNCİRİ KORUNDU — trigger gövdesi hâlâ İKİSİNİ de çağırıyor.
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='_trip_attribution_trigger';
  IF v_def NOT LIKE '%_resolve_trip_driver%' THEN
    RAISE EXCEPTION '050 HATA: trigger P0 atama modelini artik cagirmiyor';
  END IF;
  IF v_def NOT LIKE '%_resolve_driver_presence%' THEN
    RAISE EXCEPTION '050 HATA: trigger P1 presence katmanini cagirmiyor';
  END IF;
  IF v_def NOT LIKE '%MANUAL_TRIP_ASSIGNMENT%' THEN
    RAISE EXCEPTION '050 HATA: manuel sonuc korumasi kayboldu';
  END IF;
  /* Geçmiş defteri attribution kararına KARIŞMAMALI. */
  IF v_def LIKE '%presence_history%' THEN
    RAISE EXCEPTION '050 HATA: gecmis defteri attribution kararina girmis';
  END IF;

  -- (e) Defter trigger'ı bağlı ve DOĞRU tabloda
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
     WHERE t.tgname='trg_presence_history' AND NOT t.tgisinternal
       AND c.relname='vehicle_driver_presence') THEN
    RAISE EXCEPTION '050 HATA: presence history trigger bagli degil';
  END IF;

  -- (f) RLS + anon kilidi + doğrudan yazma kapalı
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public'
                  AND tablename='vehicle_driver_presence_history' AND rowsecurity) THEN
    RAISE EXCEPTION '050 HATA: history tablosunda RLS kapali';
  END IF;
  IF has_table_privilege('anon','public.vehicle_driver_presence_history','SELECT') THEN
    RAISE EXCEPTION '050 HATA: anon gecmisi okuyabiliyor';
  END IF;
  IF has_table_privilege('authenticated','public.vehicle_driver_presence_history','INSERT')
     OR has_table_privilege('authenticated','public.vehicle_driver_presence_history','UPDATE')
     OR has_table_privilege('authenticated','public.vehicle_driver_presence_history','DELETE') THEN
    RAISE EXCEPTION '050 HATA: gecmis elle degistirilebiliyor (defter kanit olmaktan cikar)';
  END IF;
  IF has_function_privilege('authenticated',
       'public.settle_expired_presence_history()', 'EXECUTE') THEN
    RAISE EXCEPTION '050 HATA: kullanici defteri kapatabiliyor';
  END IF;

  -- (g) Okuma RPC'si doğrulanmamış kaynakta KİMLİK VERMEMELİ
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='list_vehicle_presence_history';
  IF v_def NOT LIKE '%_presence_is_identity_verifying%' THEN
    RAISE EXCEPTION '050 HATA: okuma RPC si dogrulanmamis kaynakta kimlik sizdiriyor';
  END IF;
  IF has_function_privilege('anon',
       'public.list_vehicle_presence_history(uuid,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION '050 HATA: anon gecmis RPC sini cagirabiliyor';
  END IF;

  -- (h) DEFINER + search_path
  FOR r IN SELECT p.proname, pg_get_functiondef(p.oid) AS def
             FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
            WHERE n.nspname='public'
              AND p.proname IN ('_presence_history_trigger',
                                'list_vehicle_presence_history',
                                'settle_expired_presence_history')
  LOOP
    IF r.def NOT LIKE '%SECURITY DEFINER%' OR r.def NOT LIKE '%search_path%' THEN
      RAISE EXCEPTION '050 HATA: %: DEFINER/search_path eksik', r.proname;
    END IF;
  END LOOP;

  RAISE NOTICE '050 OK: presence gecmis defteri + dedupe + TTL kapanisi + okuma RPC si kuruldu · 049 resolver DEGISMEDI · P0 atama modeli KORUNDU.';
END
$verify$;
