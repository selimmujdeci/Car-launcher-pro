-- ═══════════════════════════════════════════════════════════════════════════
-- 052 — DRIVER AUTHENTICATION (P1)
--
-- YALNIZ İLERİ MIGRATION. 033–051 geçmişi DEĞİŞTİRİLMEZ.
--
-- ── PRESENCE ≠ AUTHENTICATION ────────────────────────────────────────────
--   · Presence       bir GÖZLEMDİR : "bu kişiye ait bir işaret araçta görüldü"
--   · Authentication bir KANITTIR  : "bu kişi KİMLİĞİNİ doğruladı"
--
-- 049'da fiziksel gözlem + uyumlu atama `VERY_HIGH` üretebiliyordu. Ama bir
-- NFC kartın okunması **kartı** kanıtlar, **kişiyi** değil: kart ödünç
-- verilebilir, kopyalanabilir, çalınabilir. Bu migration o varsayımı kaldırır:
--
--     VERY_HIGH  ⇔  (kimlik VERIFIED) ∧ (fiziksel varlık) ∧ (AYNI sürücü)
--
-- ⚠️ **POLİTİKA DEĞİŞİKLİĞİ (bilinçli):** 049 matrisindeki P6 kilidi
--    "NFC + atama → VERY_HIGH" davranışını kilitliyordu. O kilit KALDIRILMADI,
--    yeni doğru davranışa TAŞINDI (bkz. `local_049_driver_presence.sql` P6/P6b).
--    Doğrulama kaydı olmadan tavan artık `HIGH`'tır.
--
-- ── RESOLVER'LARA DOKUNULMADI (BAĞLAYICI) ────────────────────────────────
-- `_resolve_driver_presence` ve `_resolve_trip_driver` **YENİDEN TANIMLANMAZ**.
-- Değişen tek yer, iki resolver'ın ÇIKTISINI birleştiren `_trip_attribution_trigger`
-- kompozisyon katmanıdır — presence otoritesi olduğu gibi durur ve çıktısı
-- (`PRESENCE_CONFIRMED` + kendi güveni) bit bit aynı kalır.
--
-- ── BU PAKETTE GERÇEK KAYNAK YOK ─────────────────────────────────────────
-- NFC/PIN/telefon/Bluetooth doğrulaması **uygulanmadı**; doğrulama ÜRETEN
-- hiçbir yol yoktur → tablo boş kalır → tek görünür etki, presence'ın artık
-- tek başına `VERY_HIGH` ÜRETEMEMESİDİR.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. DOĞRULAMA KAYITLARI ──────────────────────────────────────────────
--
-- Append-only kanıt kaydı. `session_id` tekrar (replay) kilididir: aynı
-- oturum ikinci kez yazılamaz.
CREATE TABLE IF NOT EXISTS public.vehicle_driver_authentication (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  vehicle_id    uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  driver_id     uuid NOT NULL REFERENCES public.fleet_drivers(id) ON DELETE CASCADE,

  source        text NOT NULL,
  level         text NOT NULL,

  verified_at   timestamptz NOT NULL,
  expires_at    timestamptz NOT NULL,

  /* Oturum kimliği — tekrar saldırısının kilidi. Boş oturum KABUL EDİLMEZ. */
  session_id    text NOT NULL,

  received_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT vda_source_valid
    CHECK (source IN ('UNKNOWN','PIN','PHONE','BLUETOOTH','NFC')),
  CONSTRAINT vda_level_valid
    CHECK (level IN ('VERIFIED','PARTIAL','UNKNOWN')),
  CONSTRAINT vda_range_valid CHECK (expires_at > verified_at),
  /* Sınırsız oturum YOK — bir doğrulama en fazla 12 saat yaşar (presence'ın
     8 saatinden farklı olarak daha güçlü sonuç doğurduğu için daha sıkı). */
  CONSTRAINT vda_ttl_bounded
    CHECK (expires_at <= verified_at + interval '12 hours'),
  CONSTRAINT vda_session_nonempty CHECK (length(btrim(session_id)) > 0)
);

/* DUPLICATE + REPLAY'in SERT kilidi: bir oturum kimliği şirket içinde
   YALNIZ BİR KEZ kullanılabilir. Trigger zaten reddeder; bu, mantık
   bozulursa devreye giren veritabanı savunmasıdır (fail-closed). */
CREATE UNIQUE INDEX IF NOT EXISTS vda_session_unique
  ON public.vehicle_driver_authentication (company_id, session_id);

CREATE INDEX IF NOT EXISTS vda_vehicle_time_idx
  ON public.vehicle_driver_authentication (vehicle_id, verified_at DESC, expires_at);
CREATE INDEX IF NOT EXISTS vda_company_idx
  ON public.vehicle_driver_authentication (company_id, verified_at DESC);

-- ── 2. SEVİYE ARİTMETİĞİ ────────────────────────────────────────────────
--
-- İstemci kendi seviyesini YÜKSELTEMEZ: bildirilen seviye kaynağın tavanını
-- aşamaz (049'un güven tavanı ilkesinin kimlik katmanındaki karşılığı).
CREATE OR REPLACE FUNCTION public._authentication_source_ceiling(p_source text)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $fn$
  SELECT CASE coalesce(p_source, '')
           WHEN 'NFC'       THEN 'VERIFIED'   -- fiziksel kart teması
           WHEN 'PIN'       THEN 'VERIFIED'   -- sunucuda doğrulanan bilgi faktörü
           WHEN 'BLUETOOTH' THEN 'PARTIAL'    -- cihaz yakınlığı ≠ kişi
           WHEN 'PHONE'     THEN 'PARTIAL'
           ELSE 'UNKNOWN'
         END;
$fn$;

CREATE OR REPLACE FUNCTION public._authentication_weakest(a text, b text)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $fn$
  SELECT CASE
    WHEN array_position(ARRAY['UNKNOWN','PARTIAL','VERIFIED'], coalesce(a,'UNKNOWN'))
       <= array_position(ARRAY['UNKNOWN','PARTIAL','VERIFIED'], coalesce(b,'UNKNOWN'))
    THEN coalesce(a,'UNKNOWN') ELSE coalesce(b,'UNKNOWN') END;
$fn$;

REVOKE ALL ON FUNCTION public._authentication_source_ceiling(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public._authentication_weakest(text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._authentication_source_ceiling(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._authentication_weakest(text,text) TO authenticated, service_role;

-- ── 3. YAZMA KAPILARI (bağ · tekrar · seviye tavanı) ────────────────────
--
-- Beş kapı da fail-closed'dır: doğrulanamayan kayıt DÜZELTİLMEZ, REDDEDİLİR.
CREATE OR REPLACE FUNCTION public._authentication_write_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_vehicle_co uuid;
  v_found      boolean;
  v_driver_co  uuid;
BEGIN
  SELECT v.company_id, true INTO v_vehicle_co, v_found
    FROM public.vehicles v WHERE v.id = NEW.vehicle_id;

  IF NOT coalesce(v_found, false) THEN
    RAISE EXCEPTION 'AUTH_VEHICLE_UNKNOWN: dogrulama var olmayan araca yazilamaz'
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_vehicle_co IS NULL THEN
    RAISE EXCEPTION 'AUTH_VEHICLE_NOT_FLEET: sirketsiz araca filo dogrulamasi yazilamaz'
      USING ERRCODE = 'check_violation';
  END IF;
  /* ARAÇ BAĞI: satırın `company_id`si İSTEMCİDEN gelir. */
  IF NEW.company_id IS DISTINCT FROM v_vehicle_co THEN
    RAISE EXCEPTION 'AUTH_VEHICLE_BINDING_MISMATCH: dogrulama baska sirketin aracina yazilamaz'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT d.company_id INTO v_driver_co
    FROM public.fleet_drivers d WHERE d.id = NEW.driver_id;
  IF v_driver_co IS NULL THEN
    RAISE EXCEPTION 'AUTH_DRIVER_UNKNOWN: dogrulama var olmayan surucuye yazilamaz'
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_driver_co IS DISTINCT FROM v_vehicle_co THEN
    RAISE EXCEPTION 'AUTH_DRIVER_TENANT_MISMATCH: surucu aracin sirketine ait degil'
      USING ERRCODE = 'check_violation';
  END IF;

  /* TEKRAR (REPLAY): kaydedilmiş ESKİ bir doğrulama mesajının yeniden
     oynatılması. Saatlerce önce üretilmiş bir kayıt "şu anki" kanıt olamaz. */
  IF NEW.verified_at < now() - interval '24 hours' THEN
    RAISE EXCEPTION 'AUTH_REPLAY_TOO_OLD: cok eski dogrulama mesaji kabul edilmez'
      USING ERRCODE = 'check_violation';
  END IF;
  /* Gelecek tarihli doğrulama saat oynatmasıdır. Küçük bir sapma payı
     bırakılır (istemci saati birkaç saniye ileri olabilir). */
  IF NEW.verified_at > now() + interval '5 minutes' THEN
    RAISE EXCEPTION 'AUTH_IN_FUTURE: gelecek tarihli dogrulama kabul edilmez'
      USING ERRCODE = 'check_violation';
  END IF;

  /* SEVİYE TAVANI SUNUCUDA UYGULANIR — istemci `BLUETOOTH` ile `VERIFIED`
     iddia edemez. Reddedilmez, DÜŞÜRÜLÜR (kanıtın kendisi geçerlidir,
     yalnız iddia edilen ağırlığı değil). */
  NEW.level := public._authentication_weakest(
                 NEW.level, public._authentication_source_ceiling(NEW.source));

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_authentication_write_guard ON public.vehicle_driver_authentication;
CREATE TRIGGER trg_authentication_write_guard
  BEFORE INSERT OR UPDATE ON public.vehicle_driver_authentication
  FOR EACH ROW EXECUTE FUNCTION public._authentication_write_guard();

-- ── 4. DOĞRULAMA OTORİTESİ (TEK OTORİTE) ────────────────────────────────
--
-- KARAR SIRASI:
--   1. Kayıt yok                          → NO_AUTHENTICATION
--   2. Trip zamanını kapsamıyor/süresi geçmiş → AUTHENTICATION_EXPIRED
--   3. Sürücü uygun değil (tenant/pasif)  → AUTHENTICATION_UNUSABLE
--   4. Birden fazla farklı sürücü         → AUTHENTICATION_CONFLICT
--   5. Seviye VERIFIED değil              → PARTIALLY_AUTHENTICATED (kanıt DEĞİL)
--   6. Aksi hâlde                         → AUTHENTICATED
CREATE OR REPLACE FUNCTION public._resolve_driver_authentication(
  p_vehicle_id  uuid,
  p_company_id  uuid,
  p_started_at  timestamptz,
  p_ended_at    timestamptz
) RETURNS TABLE (
  decision text, driver_id uuid, auth_id uuid, source text, level text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_end timestamptz := coalesce(p_ended_at, p_started_at);
  v_cnt int;
  v_row record;
BEGIN
  IF p_company_id IS NULL OR p_started_at IS NULL THEN
    RETURN QUERY SELECT 'NO_AUTHENTICATION'::text, NULL::uuid, NULL::uuid,
                        NULL::text, 'UNKNOWN'::text;
    RETURN;
  END IF;

  /* Trip aralığını KAPSAYAN, sürücüsü uygun doğrulamalar. Tenant çift
     kontrolü: kayıt, araç ve sürücü aynı şirkette olmalı. */
  SELECT count(DISTINCT au.driver_id) INTO v_cnt
    FROM public.vehicle_driver_authentication au
    JOIN public.vehicles v ON v.id = au.vehicle_id
    JOIN public.fleet_drivers d ON d.id = au.driver_id
   WHERE au.vehicle_id = p_vehicle_id
     AND au.company_id = p_company_id
     AND v.company_id  = p_company_id
     AND d.company_id  = p_company_id
     AND d.status = 'ACTIVE'
     AND au.verified_at <= p_started_at
     AND au.expires_at  >= v_end;

  IF v_cnt = 0 THEN
    RETURN QUERY SELECT 'NO_AUTHENTICATION'::text, NULL::uuid, NULL::uuid,
                        NULL::text, 'UNKNOWN'::text;
    RETURN;
  END IF;

  /* İki farklı kişi aynı aralıkta kimlik doğrulamışsa hangisinin sürdüğü
     BİLİNEMEZ — birini seçmek uydurma olurdu. */
  IF v_cnt > 1 THEN
    RETURN QUERY SELECT 'AUTHENTICATION_CONFLICT'::text, NULL::uuid, NULL::uuid,
                        NULL::text, 'UNKNOWN'::text;
    RETURN;
  END IF;

  SELECT au.id, au.driver_id, au.source,
         public._authentication_weakest(
           au.level, public._authentication_source_ceiling(au.source)) AS lvl
    INTO v_row
    FROM public.vehicle_driver_authentication au
    JOIN public.vehicles v ON v.id = au.vehicle_id
    JOIN public.fleet_drivers d ON d.id = au.driver_id
   WHERE au.vehicle_id = p_vehicle_id
     AND au.company_id = p_company_id
     AND v.company_id  = p_company_id
     AND d.company_id  = p_company_id
     AND d.status = 'ACTIVE'
     AND au.verified_at <= p_started_at
     AND au.expires_at  >= v_end
   ORDER BY au.verified_at DESC
   LIMIT 1;

  /* Kaynağı kimlik kanıtlayamayan doğrulama bir İPUCUDUR, kanıt değildir. */
  IF v_row.lvl <> 'VERIFIED' THEN
    RETURN QUERY SELECT 'PARTIALLY_AUTHENTICATED'::text, NULL::uuid, v_row.id,
                        v_row.source, v_row.lvl;
    RETURN;
  END IF;

  RETURN QUERY SELECT 'AUTHENTICATED'::text, v_row.driver_id, v_row.id,
                      v_row.source, 'VERIFIED'::text;
END;
$fn$;

REVOKE ALL ON FUNCTION public._resolve_driver_authentication(uuid,uuid,timestamptz,timestamptz)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._resolve_driver_authentication(uuid,uuid,timestamptz,timestamptz)
  TO authenticated, service_role;

-- ── 5. TRIP KOLONLARI (doğrulama izi) ───────────────────────────────────
ALTER TABLE public.vehicle_trips
  ADD COLUMN IF NOT EXISTS driver_auth_id uuid
      REFERENCES public.vehicle_driver_authentication(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS driver_auth_source text,
  ADD COLUMN IF NOT EXISTS driver_auth_level text,
  ADD COLUMN IF NOT EXISTS driver_auth_decision text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='vt_auth_source_valid') THEN
    ALTER TABLE public.vehicle_trips ADD CONSTRAINT vt_auth_source_valid
      CHECK (driver_auth_source IS NULL OR driver_auth_source IN
             ('UNKNOWN','PIN','PHONE','BLUETOOTH','NFC'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='vt_auth_level_valid') THEN
    ALTER TABLE public.vehicle_trips ADD CONSTRAINT vt_auth_level_valid
      CHECK (driver_auth_level IS NULL OR driver_auth_level IN
             ('VERIFIED','PARTIAL','UNKNOWN'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='vt_auth_decision_valid') THEN
    ALTER TABLE public.vehicle_trips ADD CONSTRAINT vt_auth_decision_valid
      CHECK (driver_auth_decision IS NULL OR driver_auth_decision IN
             ('AUTHENTICATED','PARTIALLY_AUTHENTICATED','AUTHENTICATION_CONFLICT',
              'AUTHENTICATION_EXPIRED','AUTHENTICATION_UNUSABLE','NO_AUTHENTICATION'));
  END IF;
END $$;

-- ── 6. ATTRIBUTION — KOMPOZİSYON KATMANI ────────────────────────────────
--
-- İKİ RESOLVER DA DEĞİŞMEDİ; burada yalnız ÇIKTILARI birleşir.
--
--   presence usable + auth AUTHENTICATED + AYNI sürücü → VERY_HIGH MÜMKÜN
--   presence usable + auth yok/kısmi                   → tavan HIGH
--   presence usable + auth AUTHENTICATED + FARKLI kişi → CONFLICTED
--   presence yok    + auth AUTHENTICATED               → sürücü kimlikten, HIGH
--   ikisi de yok                                       → **P0 AYNEN**
CREATE OR REPLACE FUNCTION public._trip_attribution_trigger()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_co   uuid;
  v_res  record;   -- atama modeli sonucu (P0)
  v_pres record;   -- presence sonucu (P1)
  v_auth record;   -- authentication sonucu (P1-AUTH)
  v_driver uuid;
  v_status text;
  v_source text;
  v_conf   text;
  v_asg    uuid;
  v_pid    uuid;
  v_psrc   text;
  v_pdec   text;
  v_adec   text;
  v_aid    uuid;
  v_asrc   text;
  v_alvl   text;
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

  -- (b) P1: presence katmanı — DEĞİŞMEDİ
  SELECT * INTO v_pres
    FROM public._resolve_driver_presence(
      NEW.vehicle_id, v_co, NEW.started_at, NEW.ended_at, v_res.driver_id);

  -- (c) P1-AUTH: kimlik doğrulama katmanı
  SELECT * INTO v_auth
    FROM public._resolve_driver_authentication(
      NEW.vehicle_id, v_co, NEW.started_at, NEW.ended_at);

  v_pdec := v_pres.decision;
  v_pid  := v_pres.presence_id;
  v_psrc := v_pres.source;
  v_adec := v_auth.decision;
  v_aid  := v_auth.auth_id;
  v_asrc := v_auth.source;
  v_alvl := v_auth.level;

  IF v_pdec = 'PRESENCE_CONFLICT' OR v_adec = 'AUTHENTICATION_CONFLICT' THEN
    /* Katmanların herhangi biri çelişkiliyse kesin sürücü YAZILMAZ. */
    v_driver := NULL;
    v_asg    := NULL;
    v_status := 'CONFLICTED';
    v_source := 'UNKNOWN';
    v_conf   := 'UNKNOWN';

  ELSIF v_pdec IN ('PRESENCE_CONFIRMED','PRESENCE_ONLY')
        AND v_adec = 'AUTHENTICATED'
        AND v_auth.driver_id IS DISTINCT FROM v_pres.driver_id THEN
    /* Kartı Ahmet okutmuş, PIN'i Mehmet girmiş — hangisi sürüyor BİLİNEMEZ. */
    v_driver := NULL;
    v_asg    := NULL;
    v_status := 'CONFLICTED';
    v_source := 'UNKNOWN';
    v_conf   := 'UNKNOWN';

  ELSIF v_pdec IN ('PRESENCE_CONFIRMED','PRESENCE_ONLY') THEN
    v_driver := v_pres.driver_id;
    v_asg    := CASE WHEN v_pdec = 'PRESENCE_CONFIRMED' THEN v_res.assignment_id END;
    v_status := 'ATTRIBUTED';
    v_source := CASE v_psrc
                  WHEN 'NFC'       THEN 'NFC'
                  WHEN 'BLUETOOTH' THEN 'BLUETOOTH'
                  ELSE 'UNKNOWN' END;
    /* ⚠️ TAVAN: kimlik DOĞRULANMADIYSA `VERY_HIGH` VERİLMEZ. Kartın
       okunması kartı kanıtlar, kişiyi değil. */
    v_conf   := CASE WHEN v_adec = 'AUTHENTICATED' THEN v_pres.confidence
                     WHEN v_pres.confidence = 'VERY_HIGH' THEN 'HIGH'
                     ELSE v_pres.confidence END;

  ELSIF v_adec = 'AUTHENTICATED'
        AND (v_res.driver_id IS NULL OR v_res.driver_id = v_auth.driver_id) THEN
    /* Kimlik doğrulandı ama fiziksel varlık gözlenmedi: kişinin O ANDA
       direksiyonda olduğu kanıtlanmadı → tavan `HIGH`. */
    v_driver := v_auth.driver_id;
    v_asg    := CASE WHEN v_res.driver_id = v_auth.driver_id THEN v_res.assignment_id END;
    v_status := 'ATTRIBUTED';
    v_source := v_asrc;
    v_conf   := 'HIGH';

  ELSIF v_adec = 'AUTHENTICATED' THEN
    /* Doğrulanmış kimlik ile atama FARKLI kişiyi gösteriyor. */
    v_driver := NULL;
    v_asg    := NULL;
    v_status := 'CONFLICTED';
    v_source := 'UNKNOWN';
    v_conf   := 'UNKNOWN';

  ELSE
    /* Hiçbir kanıt yok → **P0 davranışı AYNEN**. */
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
     AND NEW.driver_presence_decision IS NOT DISTINCT FROM v_pdec
     AND NEW.driver_auth_decision IS NOT DISTINCT FROM v_adec THEN
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
  NEW.driver_auth_id                := v_aid;
  NEW.driver_auth_source            := v_asrc;
  NEW.driver_auth_level             := v_alvl;
  NEW.driver_auth_decision          := v_adec;

  RETURN NEW;
END;
$fn$;

-- Trigger tanımı DEĞİŞMEDİ (aynı tablo, aynı olaylar) — yalnız gövde genişledi.
DROP TRIGGER IF EXISTS trg_trip_attribution ON public.vehicle_trips;
CREATE TRIGGER trg_trip_attribution
  BEFORE INSERT OR UPDATE OF started_at, ended_at, vehicle_id
  ON public.vehicle_trips
  FOR EACH ROW EXECUTE FUNCTION public._trip_attribution_trigger();

-- ── 7. RLS + İZİNLER ────────────────────────────────────────────────────
--
-- `authenticated` DOĞRUDAN YAZAMAZ: bir yöneticinin kendi kimlik
-- doğrulamasını elle eklemesi, katmanı kanıt olmaktan çıkarırdı.
ALTER TABLE public.vehicle_driver_authentication ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.vehicle_driver_authentication FROM anon, PUBLIC;
GRANT SELECT ON TABLE public.vehicle_driver_authentication TO authenticated;
GRANT ALL    ON TABLE public.vehicle_driver_authentication TO service_role;

DROP POLICY IF EXISTS vda_company_read ON public.vehicle_driver_authentication;
CREATE POLICY vda_company_read ON public.vehicle_driver_authentication
  FOR SELECT TO authenticated
  USING (company_id = (SELECT p.company_id FROM public.profiles p WHERE p.id = auth.uid()));

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- DOĞRULAMA (fail-closed) — fonksiyonlar ÇAĞRILARAK sınanır (047 dersi).
-- ═══════════════════════════════════════════════════════════════════════════

DO $verify$
DECLARE r record; v_def text;
BEGIN
  -- (a) Tablo + kilitler
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema='public' AND table_name='vehicle_driver_authentication') THEN
    RAISE EXCEPTION '052 HATA: dogrulama tablosu yok';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public'
                  AND indexname='vda_session_unique') THEN
    RAISE EXCEPTION '052 HATA: oturum tekrar kilidi yok (replay mumkun)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='vda_ttl_bounded') THEN
    RAISE EXCEPTION '052 HATA: sinirsiz oturum engeli yok';
  END IF;

  -- (b) SEVİYE TAVANLARI ÇAĞRILARAK sınanır
  IF public._authentication_source_ceiling('NFC') <> 'VERIFIED'
     OR public._authentication_source_ceiling('PIN') <> 'VERIFIED'
     OR public._authentication_source_ceiling('BLUETOOTH') <> 'PARTIAL'
     OR public._authentication_source_ceiling('PHONE') <> 'PARTIAL'
     OR public._authentication_source_ceiling('UYDURMA') <> 'UNKNOWN' THEN
    RAISE EXCEPTION '052 HATA: kaynak seviye tavani yanlis';
  END IF;
  IF public._authentication_weakest('VERIFIED','PARTIAL') <> 'PARTIAL' THEN
    RAISE EXCEPTION '052 HATA: en zayif halka kurali calismiyor';
  END IF;

  -- (c) OTORİTE CANLI ÇAĞRILIR: kayıt yokken NO_AUTHENTICATION dönmeli
  SELECT * INTO r FROM public._resolve_driver_authentication(
    gen_random_uuid(), gen_random_uuid(), now() - interval '1 hour', now());
  IF r.decision <> 'NO_AUTHENTICATION' OR r.driver_id IS NOT NULL THEN
    RAISE EXCEPTION '052 HATA: kayit yokken dogrulama uretildi: %', r.decision;
  END IF;
  /* Şirketsiz (bireysel) araç da NO_AUTHENTICATION. */
  SELECT * INTO r FROM public._resolve_driver_authentication(
    gen_random_uuid(), NULL, now(), now());
  IF r.decision <> 'NO_AUTHENTICATION' THEN
    RAISE EXCEPTION '052 HATA: sirketsiz arac icin dogrulama uretildi';
  END IF;

  -- (d) RESOLVER'LARA DOKUNULMADI — presence resolver'ı hâlâ aynı
  SELECT * INTO r FROM public._resolve_driver_presence(
    gen_random_uuid(), gen_random_uuid(), now() - interval '1 hour', now(), NULL);
  IF r.decision <> 'NO_PRESENCE' OR r.driver_id IS NOT NULL THEN
    RAISE EXCEPTION '052 HATA: presence resolver davranisi DEGISTI: %', r.decision;
  END IF;

  -- (e) Kompozisyon katmanı ÜÇ modeli de çağırıyor + P0 korunuyor
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='_trip_attribution_trigger';
  IF v_def NOT LIKE '%_resolve_trip_driver%' THEN
    RAISE EXCEPTION '052 HATA: trigger P0 atama modelini artik cagirmiyor';
  END IF;
  IF v_def NOT LIKE '%_resolve_driver_presence%' THEN
    RAISE EXCEPTION '052 HATA: trigger presence katmanini cagirmiyor';
  END IF;
  IF v_def NOT LIKE '%_resolve_driver_authentication%' THEN
    RAISE EXCEPTION '052 HATA: trigger dogrulama katmanini cagirmiyor';
  END IF;
  IF v_def NOT LIKE '%MANUAL_TRIP_ASSIGNMENT%' THEN
    RAISE EXCEPTION '052 HATA: manuel sonuc korumasi kayboldu';
  END IF;
  /* Geçmiş defteri hâlâ karara KARIŞMAMALI (051 kuralı sürüyor). */
  IF v_def LIKE '%presence_history%' THEN
    RAISE EXCEPTION '052 HATA: gecmis defteri attribution kararina girmis';
  END IF;
  /* VERY_HIGH kapısı GERÇEKTEN doğrulamaya bağlı mı. */
  IF v_def NOT LIKE '%VERY_HIGH%' THEN
    RAISE EXCEPTION '052 HATA: VERY_HIGH tavani govdede yok';
  END IF;

  -- (f) RLS + anon kilidi + doğrudan yazma kapalı
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public'
                  AND tablename='vehicle_driver_authentication' AND rowsecurity) THEN
    RAISE EXCEPTION '052 HATA: dogrulama tablosunda RLS kapali';
  END IF;
  IF has_table_privilege('anon','public.vehicle_driver_authentication','SELECT') THEN
    RAISE EXCEPTION '052 HATA: anon dogrulama okuyabiliyor';
  END IF;
  IF has_table_privilege('authenticated','public.vehicle_driver_authentication','INSERT')
     OR has_table_privilege('authenticated','public.vehicle_driver_authentication','UPDATE')
     OR has_table_privilege('authenticated','public.vehicle_driver_authentication','DELETE') THEN
    RAISE EXCEPTION '052 HATA: dogrulama elle yazilabiliyor (kanit olmaktan cikar)';
  END IF;

  -- (g) DEFINER + search_path
  FOR r IN SELECT p.proname, pg_get_functiondef(p.oid) AS def
             FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
            WHERE n.nspname='public'
              AND p.proname IN ('_authentication_write_guard',
                                '_resolve_driver_authentication',
                                '_trip_attribution_trigger')
  LOOP
    IF r.def NOT LIKE '%SECURITY DEFINER%' OR r.def NOT LIKE '%search_path%' THEN
      RAISE EXCEPTION '052 HATA: %: DEFINER/search_path eksik', r.proname;
    END IF;
  END LOOP;

  RAISE NOTICE '052 OK: kimlik dogrulama sozlesmesi + otorite + VERY_HIGH kapisi kuruldu · resolverlar DEGISMEDI · gercek kaynak (NFC/PIN/BT/telefon) YOK.';
END
$verify$;
