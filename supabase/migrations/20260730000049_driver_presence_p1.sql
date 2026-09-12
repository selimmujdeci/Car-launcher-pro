-- ═══════════════════════════════════════════════════════════════════════════
-- 049 — DRIVER PRESENCE P1
--
-- YALNIZ İLERİ MIGRATION. 033–048 geçmişi DEĞİŞTİRİLMEZ.
--
-- ── PRESENCE ≠ ASSIGNMENT ────────────────────────────────────────────────
--   · Assignment bir PLANDIR : "bu araca bu sürücü atandı"
--   · Presence   bir GÖZLEMDİR: "şu anda bu kişinin araçta olduğuna dair
--                               fiziksel bir işaret var"
--
-- P0'da attribution yalnız plana bakıyordu ve bu yüzden `VERY_HIGH`
-- veremiyordu: bir yöneticinin ataması, sürücünün gerçekten direksiyonda
-- olduğunu KANITLAMAZ. Presence tam bu boşluğu doldurur.
--
-- ── BU PAKETTE GERÇEK KAYNAK YOK ─────────────────────────────────────────
-- NFC ve Bluetooth **uygulanmadı**. Tablo ve karar zinciri kurulur ama
-- gözlem ÜRETEN hiçbir yol yoktur → tablo boş kalır → attribution
-- **P0'daki gibi** çalışmaya devam eder. Bu, migration'ın en önemli
-- güvenlik özelliğidir ve testle kilitlenir (P1–P3).
--
-- ── FAIL-CLOSED KORUNUR ──────────────────────────────────────────────────
-- Presence bir kanıt üretemiyorsa cevap `UNKNOWN`'dır. Presence'ın VARLIĞI
-- asla bir sürücüyü "kanıtlanmış" yapmaz.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. PRESENCE GÖZLEMLERİ ──────────────────────────────────────────────
--
-- Append-only gözlem kaydı. Trip attribution, trip ZAMANINI kapsayan
-- geçerli gözlemi arar — "şu anki" gözlemi değil (offline replay üç gün
-- sonra gelse bile o günkü gerçeği bulur).
CREATE TABLE IF NOT EXISTS public.vehicle_driver_presence (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  vehicle_id    uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  driver_id     uuid NOT NULL REFERENCES public.fleet_drivers(id) ON DELETE CASCADE,

  source        text NOT NULL,
  confidence    text NOT NULL,

  detected_at   timestamptz NOT NULL,
  /* Gözlemin geçerliliğini yitirdiği an. Süresiz presence, sabah kart
     okutan sürücüyü akşamki yolculuğa da bağlardı. */
  expires_at    timestamptz NOT NULL,

  /* Gözlemin dayandığı atama (varsa) — çelişki denetimi için. */
  assignment_id uuid REFERENCES public.vehicle_driver_assignments(id) ON DELETE SET NULL,

  received_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT vdp_source_valid
    CHECK (source IN ('UNKNOWN','HEAD_UNIT','PHONE','BLUETOOTH','NFC')),
  CONSTRAINT vdp_confidence_valid
    CHECK (confidence IN ('VERY_HIGH','HIGH','MEDIUM','LOW','UNKNOWN')),
  /* Süresi başlangıcından önce biten gözlem anlamsızdır. */
  CONSTRAINT vdp_range_valid CHECK (expires_at > detected_at),
  /* Bir gözlem en fazla 24 saat yaşayabilir — sınırsız presence YOK. */
  CONSTRAINT vdp_ttl_bounded
    CHECK (expires_at <= detected_at + interval '24 hours')
);

CREATE INDEX IF NOT EXISTS vdp_vehicle_time_idx
  ON public.vehicle_driver_presence (vehicle_id, detected_at DESC, expires_at);
CREATE INDEX IF NOT EXISTS vdp_company_idx
  ON public.vehicle_driver_presence (company_id, detected_at DESC);

-- ── 2. ATTRIBUTION KOLONLARI (presence izi) ─────────────────────────────
--
-- Attribution'ın presence'a mı yoksa atamaya mı dayandığı SAKLANMALIDIR;
-- aksi halde "bu sürücü nereden geldi?" sorusu cevaplanamaz.
ALTER TABLE public.vehicle_trips
  ADD COLUMN IF NOT EXISTS driver_presence_id uuid
      REFERENCES public.vehicle_driver_presence(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS driver_presence_source text,
  ADD COLUMN IF NOT EXISTS driver_presence_decision text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='vt_presence_source_valid') THEN
    ALTER TABLE public.vehicle_trips ADD CONSTRAINT vt_presence_source_valid
      CHECK (driver_presence_source IS NULL OR driver_presence_source IN
             ('UNKNOWN','HEAD_UNIT','PHONE','BLUETOOTH','NFC'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='vt_presence_decision_valid') THEN
    ALTER TABLE public.vehicle_trips ADD CONSTRAINT vt_presence_decision_valid
      CHECK (driver_presence_decision IS NULL OR driver_presence_decision IN
             ('PRESENCE_CONFIRMED','PRESENCE_ONLY','PRESENCE_CONFLICT',
              'PRESENCE_UNUSABLE','NO_PRESENCE'));
  END IF;
END $$;

-- ── 3. KİMLİK DOĞRULAYAN KAYNAKLAR ──────────────────────────────────────
--
-- `HEAD_UNIT` BİLİNÇLİ OLARAK YOK: head unit `anon` rolünde çalışır ve
-- kullanıcı oturumu yoktur — ekranda kim olduğunu iddia eden herkes o kişi
-- sayılırdı. P0'da head unit'te serbest sürücü seçimi KAPATILDI; presence
-- katmanı o kararı arkadan DOLANMAMALIDIR.
--
-- `PHONE` de yok: telefon eşleşmesi bu pakette doğrulanmış değil.
CREATE OR REPLACE FUNCTION public._presence_is_identity_verifying(p_source text)
RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $fn$
  SELECT coalesce(p_source, '') IN ('NFC','BLUETOOTH');
$fn$;

/* Kaynağın verebileceği EN YÜKSEK güven — istemci kendi güvenini
   yükseltemez (P0'daki "güven sunucuda üretilir" ilkesinin devamı). */
CREATE OR REPLACE FUNCTION public._presence_source_ceiling(p_source text)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $fn$
  SELECT CASE coalesce(p_source, '')
           WHEN 'NFC'       THEN 'VERY_HIGH'
           WHEN 'BLUETOOTH' THEN 'HIGH'
           WHEN 'PHONE'     THEN 'MEDIUM'
           WHEN 'HEAD_UNIT' THEN 'LOW'
           ELSE 'UNKNOWN'
         END;
$fn$;

/* İki güvenin daha ZAYIFI. */
CREATE OR REPLACE FUNCTION public._presence_weakest(a text, b text)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $fn$
  SELECT CASE
    WHEN array_position(ARRAY['UNKNOWN','LOW','MEDIUM','HIGH','VERY_HIGH'], coalesce(a,'UNKNOWN'))
       <= array_position(ARRAY['UNKNOWN','LOW','MEDIUM','HIGH','VERY_HIGH'], coalesce(b,'UNKNOWN'))
    THEN coalesce(a,'UNKNOWN') ELSE coalesce(b,'UNKNOWN') END;
$fn$;

REVOKE ALL ON FUNCTION public._presence_is_identity_verifying(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public._presence_source_ceiling(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public._presence_weakest(text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._presence_is_identity_verifying(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._presence_source_ceiling(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._presence_weakest(text,text) TO authenticated, service_role;

-- ── 4. PRESENCE RESOLVER (TEK OTORİTE) ──────────────────────────────────
--
-- KARAR SIRASI:
--   1. Gözlem yok                       → NO_PRESENCE      (atama modeli çalışır)
--   2. Kaynak kimlik doğrulamıyor       → PRESENCE_UNUSABLE
--   3. Trip zamanını kapsamıyor/süresi geçmiş → PRESENCE_UNUSABLE
--   4. Sürücü uygun değil (tenant/pasif)→ PRESENCE_UNUSABLE
--   5. Birden fazla farklı sürücü       → PRESENCE_CONFLICT
--   6. Atama farklı sürücü gösteriyor   → PRESENCE_CONFLICT
--   7. Atama ile uyumlu                 → PRESENCE_CONFIRMED
--   8. Atama yok                        → PRESENCE_ONLY
--
-- ÇELİŞKİ NEDEN KULLANILMIYOR: NFC kartı Ahmet okutmuş ama araca Mehmet
-- atanmışsa hangisinin doğru olduğunu BİLEMEYİZ (kart ödünç verilmiş de
-- olabilir, atama güncellenmemiş de). Birini seçmek UYDURMA olurdu.
CREATE OR REPLACE FUNCTION public._resolve_driver_presence(
  p_vehicle_id  uuid,
  p_company_id  uuid,
  p_started_at  timestamptz,
  p_ended_at    timestamptz,
  p_assignment_driver_id uuid
) RETURNS TABLE (
  decision text, driver_id uuid, presence_id uuid, source text, confidence text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_end   timestamptz := coalesce(p_ended_at, p_started_at);
  v_cnt   int;
  v_row   record;
BEGIN
  IF p_company_id IS NULL OR p_started_at IS NULL THEN
    RETURN QUERY SELECT 'NO_PRESENCE'::text, NULL::uuid, NULL::uuid,
                        NULL::text, 'UNKNOWN'::text;
    RETURN;
  END IF;

  /* Trip aralığını KAPSAYAN, kimlik doğrulayan, sürücüsü uygun gözlemler.
     Tenant çift kontrolü: gözlem, araç ve sürücü aynı şirkette olmalı. */
  SELECT count(DISTINCT pr.driver_id) INTO v_cnt
    FROM public.vehicle_driver_presence pr
    JOIN public.vehicles v  ON v.id = pr.vehicle_id
    JOIN public.fleet_drivers d ON d.id = pr.driver_id
   WHERE pr.vehicle_id = p_vehicle_id
     AND pr.company_id = p_company_id
     AND v.company_id  = p_company_id
     AND d.company_id  = p_company_id
     AND d.status = 'ACTIVE'
     AND public._presence_is_identity_verifying(pr.source)
     AND pr.detected_at <= p_started_at
     AND pr.expires_at  >= v_end;

  IF v_cnt = 0 THEN
    RETURN QUERY SELECT 'NO_PRESENCE'::text, NULL::uuid, NULL::uuid,
                        NULL::text, 'UNKNOWN'::text;
    RETURN;
  END IF;

  /* Farklı sürücüler için gözlem varsa hangisinin doğru olduğu BİLİNEMEZ. */
  IF v_cnt > 1 THEN
    RETURN QUERY SELECT 'PRESENCE_CONFLICT'::text, NULL::uuid, NULL::uuid,
                        NULL::text, 'UNKNOWN'::text;
    RETURN;
  END IF;

  SELECT pr.id, pr.driver_id, pr.source,
         public._presence_weakest(pr.confidence,
           public._presence_source_ceiling(pr.source)) AS conf
    INTO v_row
    FROM public.vehicle_driver_presence pr
    JOIN public.vehicles v  ON v.id = pr.vehicle_id
    JOIN public.fleet_drivers d ON d.id = pr.driver_id
   WHERE pr.vehicle_id = p_vehicle_id
     AND pr.company_id = p_company_id
     AND v.company_id  = p_company_id
     AND d.company_id  = p_company_id
     AND d.status = 'ACTIVE'
     AND public._presence_is_identity_verifying(pr.source)
     AND pr.detected_at <= p_started_at
     AND pr.expires_at  >= v_end
   ORDER BY pr.detected_at DESC
   LIMIT 1;

  /* Presence ile atama FARKLI sürücü gösteriyorsa insan incelemesi gerekir. */
  IF p_assignment_driver_id IS NOT NULL
     AND p_assignment_driver_id <> v_row.driver_id THEN
    RETURN QUERY SELECT 'PRESENCE_CONFLICT'::text, NULL::uuid, v_row.id,
                        v_row.source, 'UNKNOWN'::text;
    RETURN;
  END IF;

  /* Plan + fiziksel gözlem AYNI kişiyi gösteriyor → en güçlü kanıt. */
  IF p_assignment_driver_id IS NOT NULL THEN
    RETURN QUERY SELECT 'PRESENCE_CONFIRMED'::text, v_row.driver_id, v_row.id,
                        v_row.source, v_row.conf;
    RETURN;
  END IF;

  /* Atama yok ama fiziksel kanıt var: geçerli, ancak plan desteği
     olmadığı için güven `HIGH` ile SINIRLANIR. */
  RETURN QUERY SELECT 'PRESENCE_ONLY'::text, v_row.driver_id, v_row.id,
                      v_row.source, public._presence_weakest(v_row.conf, 'HIGH');
END;
$fn$;

REVOKE ALL ON FUNCTION public._resolve_driver_presence(uuid,uuid,timestamptz,timestamptz,uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._resolve_driver_presence(uuid,uuid,timestamptz,timestamptz,uuid)
  TO authenticated, service_role;

-- ── 5. ATTRIBUTION TRIGGER'INI PRESENCE İLE GENİŞLET ────────────────────
--
-- P0 davranışı AYNEN korunur; presence yalnız ÜSTÜNE binen bir katmandır:
--   · presence kullanılabilir  → onu kullan (güven yükselebilir)
--   · presence çelişkili       → CONFLICTED (fail-closed)
--   · presence yok/kullanılamaz→ **P0'daki atama modeli AYNEN çalışır**
--
-- Manuel/kilitli sonuç yine EZİLMEZ.
CREATE OR REPLACE FUNCTION public._trip_attribution_trigger()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_co   uuid;
  v_res  record;   -- atama modeli sonucu (P0)
  v_pres record;   -- presence sonucu (P1)
  v_driver uuid;
  v_status text;
  v_source text;
  v_conf   text;
  v_asg    uuid;
  v_pid    uuid;
  v_psrc   text;
  v_pdec   text;
BEGIN
  /* Manuel/kilitli sonuç KORUNUR (P0 sözleşmesi). */
  IF NEW.driver_attribution_status IN ('LOCKED','MANUAL_REVIEW')
     OR NEW.driver_attribution_source = 'MANUAL_TRIP_ASSIGNMENT' THEN
    RETURN NEW;
  END IF;

  SELECT company_id INTO v_co FROM public.vehicles WHERE id = NEW.vehicle_id;

  -- (a) P0: atama modeli — DEĞİŞMEDİ
  SELECT * INTO v_res
    FROM public._resolve_trip_driver(NEW.vehicle_id, v_co, NEW.started_at, NEW.ended_at);

  -- (b) P1: presence katmanı
  SELECT * INTO v_pres
    FROM public._resolve_driver_presence(
      NEW.vehicle_id, v_co, NEW.started_at, NEW.ended_at, v_res.driver_id);

  v_pdec := v_pres.decision;
  v_pid  := v_pres.presence_id;
  v_psrc := v_pres.source;

  IF v_pdec = 'PRESENCE_CONFLICT' THEN
    /* Fiziksel kanıt ile plan çelişiyor → kesin sürücü YAZILMAZ. */
    v_driver := NULL;
    v_asg    := NULL;
    v_status := 'CONFLICTED';
    v_source := 'UNKNOWN';
    v_conf   := 'UNKNOWN';

  ELSIF v_pdec IN ('PRESENCE_CONFIRMED','PRESENCE_ONLY') THEN
    /* Presence KANIT sayıldı. `VERY_HIGH` ancak burada mümkündür —
       P0'da yalnız plan vardı ve plan direksiyonu kanıtlamaz. */
    v_driver := v_pres.driver_id;
    v_asg    := CASE WHEN v_pdec = 'PRESENCE_CONFIRMED' THEN v_res.assignment_id END;
    v_status := 'ATTRIBUTED';
    v_source := CASE v_psrc
                  WHEN 'NFC'       THEN 'NFC'
                  WHEN 'BLUETOOTH' THEN 'BLUETOOTH'
                  ELSE 'UNKNOWN' END;
    v_conf   := v_pres.confidence;

  ELSE
    /* NO_PRESENCE veya PRESENCE_UNUSABLE → **P0 davranışı AYNEN**. */
    v_driver := v_res.driver_id;
    v_asg    := v_res.assignment_id;
    v_status := v_res.status;
    v_source := CASE WHEN v_res.status = 'ATTRIBUTED'
                     THEN 'ACTIVE_ASSIGNMENT' ELSE 'UNKNOWN' END;
    v_conf   := v_res.confidence;
  END IF;

  /* DEĞİŞİKLİK YOKSA REVİZYON ARTMAZ — 10× replay tek attribution üretir. */
  IF NEW.driver_id IS NOT DISTINCT FROM v_driver
     AND NEW.driver_attribution_status IS NOT DISTINCT FROM v_status
     AND NEW.driver_presence_decision IS NOT DISTINCT FROM v_pdec THEN
    RETURN NEW;
  END IF;

  NEW.driver_id                     := v_driver;
  NEW.driver_assignment_id          := v_asg;
  NEW.driver_attribution_status     := v_status;
  NEW.driver_attribution_confidence := v_conf;
  NEW.driver_attribution_source     := v_source;
  NEW.driver_attributed_at          := now();
  NEW.driver_attributed_by          := NULL;   -- otomatik karar
  NEW.driver_attribution_revision   := coalesce(NEW.driver_attribution_revision, 0) + 1;
  NEW.driver_presence_id            := v_pid;
  NEW.driver_presence_source        := v_psrc;
  NEW.driver_presence_decision      := v_pdec;

  RETURN NEW;
END;
$fn$;

-- Trigger tanımı DEĞİŞMEDİ (aynı olaylar) — yalnız gövde genişledi.
DROP TRIGGER IF EXISTS trg_trip_attribution ON public.vehicle_trips;
CREATE TRIGGER trg_trip_attribution
  BEFORE INSERT OR UPDATE OF started_at, ended_at, vehicle_id
  ON public.vehicle_trips
  FOR EACH ROW EXECUTE FUNCTION public._trip_attribution_trigger();

-- ── 6. RLS + İZİNLER ────────────────────────────────────────────────────
ALTER TABLE public.vehicle_driver_presence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.vehicle_driver_presence FROM anon, PUBLIC;
GRANT SELECT ON TABLE public.vehicle_driver_presence TO authenticated;
GRANT ALL    ON TABLE public.vehicle_driver_presence TO service_role;

DROP POLICY IF EXISTS vdp_company_read ON public.vehicle_driver_presence;
CREATE POLICY vdp_company_read ON public.vehicle_driver_presence
  FOR SELECT TO authenticated
  USING (company_id = (SELECT p.company_id FROM public.profiles p WHERE p.id = auth.uid()));

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- DOĞRULAMA (fail-closed) — fonksiyonlar ÇAĞRILARAK sınanır.
-- ═══════════════════════════════════════════════════════════════════════════

DO $verify$
DECLARE r record; v_def text;
BEGIN
  -- (a) Tablo ve kolonlar
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema='public' AND table_name='vehicle_driver_presence') THEN
    RAISE EXCEPTION '049 HATA: vehicle_driver_presence tablosu yok';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='vehicle_trips'
                    AND column_name='driver_presence_decision') THEN
    RAISE EXCEPTION '049 HATA: trip presence kolonlari eksik';
  END IF;

  -- (b) HEAD_UNIT ve PHONE kimlik doğrulayan SAYILMAMALI.
  IF public._presence_is_identity_verifying('HEAD_UNIT')
     OR public._presence_is_identity_verifying('PHONE')
     OR public._presence_is_identity_verifying('UNKNOWN') THEN
    RAISE EXCEPTION '049 HATA: dogrulanmamis kaynak kimlik kaniti sayiliyor';
  END IF;
  IF NOT public._presence_is_identity_verifying('NFC')
     OR NOT public._presence_is_identity_verifying('BLUETOOTH') THEN
    RAISE EXCEPTION '049 HATA: NFC/BLUETOOTH kimlik kaniti sayilmiyor';
  END IF;

  -- (c) Güven tavanları
  IF public._presence_source_ceiling('NFC') <> 'VERY_HIGH'
     OR public._presence_source_ceiling('HEAD_UNIT') <> 'LOW'
     OR public._presence_source_ceiling('UYDURMA') <> 'UNKNOWN' THEN
    RAISE EXCEPTION '049 HATA: kaynak guven tavani yanlis';
  END IF;
  IF public._presence_weakest('VERY_HIGH','LOW') <> 'LOW' THEN
    RAISE EXCEPTION '049 HATA: en zayif halka kurali calismiyor';
  END IF;

  -- (d) RESOLVER CANLI ÇAĞRILIR: gözlem yokken NO_PRESENCE dönmeli
  --     (yani P0 atama modeli devrede kalmalı).
  SELECT * INTO r FROM public._resolve_driver_presence(
    gen_random_uuid(), gen_random_uuid(), now() - interval '1 hour', now(), NULL);
  IF r.decision <> 'NO_PRESENCE' OR r.driver_id IS NOT NULL THEN
    RAISE EXCEPTION '049 HATA: gozlem yokken presence surucu uretti: %', r.decision;
  END IF;
  /* Şirketsiz (bireysel) araç da NO_PRESENCE. */
  SELECT * INTO r FROM public._resolve_driver_presence(
    gen_random_uuid(), NULL, now(), now(), NULL);
  IF r.decision <> 'NO_PRESENCE' THEN
    RAISE EXCEPTION '049 HATA: sirketsiz arac icin presence uretildi';
  END IF;

  -- (e) P0 ZİNCİRİ KORUNDU
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                  WHERE n.nspname='public' AND p.proname='_resolve_trip_driver') THEN
    RAISE EXCEPTION '049 HATA: P0 atama resolver i kayboldu';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgname='trg_trip_attribution' AND NOT tgisinternal) THEN
    RAISE EXCEPTION '049 HATA: attribution trigger bagli degil';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='vehicle_trips_key_unique') THEN
    RAISE EXCEPTION '049 HATA: trip dedupe kisiti kayboldu';
  END IF;

  -- (f) Trigger gövdesi P0 modelini HÂLÂ çağırıyor mu (presence onu
  --     değiştirmedi, üstüne bindi).
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='_trip_attribution_trigger';
  IF v_def NOT LIKE '%_resolve_trip_driver%' THEN
    RAISE EXCEPTION '049 HATA: trigger P0 atama modelini artik cagirmiyor';
  END IF;
  IF v_def NOT LIKE '%_resolve_driver_presence%' THEN
    RAISE EXCEPTION '049 HATA: trigger presence katmanini cagirmiyor';
  END IF;
  IF v_def NOT LIKE '%MANUAL_TRIP_ASSIGNMENT%' THEN
    RAISE EXCEPTION '049 HATA: manuel sonuc korumasi kayboldu';
  END IF;

  -- (g) RLS + anon kilidi
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public'
                  AND tablename='vehicle_driver_presence' AND rowsecurity) THEN
    RAISE EXCEPTION '049 HATA: presence tablosunda RLS kapali';
  END IF;
  IF has_table_privilege('anon','public.vehicle_driver_presence','SELECT') THEN
    RAISE EXCEPTION '049 HATA: anon presence okuyabiliyor';
  END IF;
  IF has_table_privilege('authenticated','public.vehicle_driver_presence','INSERT') THEN
    RAISE EXCEPTION '049 HATA: presence dogrudan yazilabiliyor (RPC disi)';
  END IF;

  -- (h) DEFINER + search_path
  FOR r IN SELECT p.proname, pg_get_functiondef(p.oid) AS def
             FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
            WHERE n.nspname='public'
              AND p.proname IN ('_resolve_driver_presence','_trip_attribution_trigger')
  LOOP
    IF r.def NOT LIKE '%SECURITY DEFINER%' OR r.def NOT LIKE '%search_path%' THEN
      RAISE EXCEPTION '049 HATA: %: DEFINER/search_path eksik', r.proname;
    END IF;
  END LOOP;

  RAISE NOTICE '049 OK: presence sozlesmesi + resolver + attribution katmani kuruldu · P0 atama modeli KORUNDU · gercek kaynak (NFC/BT) YOK, gozlem uretilmiyor.';
END
$verify$;
