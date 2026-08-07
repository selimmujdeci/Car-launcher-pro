-- ═══════════════════════════════════════════════════════════════════════════
-- 051 — DRIVER PRESENCE DURABILITY (P2)
--
-- YALNIZ İLERİ MIGRATION. 033–050 geçmişi DEĞİŞTİRİLMEZ.
--
-- ── NEYİ ÇÖZER ───────────────────────────────────────────────────────────
-- 050 defteri kurdu ama üretim seviyesinde ÜÇ açık kapı bıraktı:
--
--   (1) KAPANIŞ İDEMPOTENT DEĞİLDİ. Kapatma UPDATE'leri `WHERE id = ...`
--       ile yazılmıştı; `expired_at IS NULL` koşulu YOKTU. Eşzamanlı bir
--       `settle_expired_presence_history()` çağrısı segmenti `TTL_EXPIRED`
--       ile kapattıktan sonra trigger AYNI segmenti `SUPERSEDED` ile
--       yeniden kapatabilir, kapanış anını ve süresini SESSİZCE değiştirebilirdi.
--       Bir defterin kapanmış satırının sonradan değişmesi, onu kanıt
--       olmaktan çıkarır.
--
--   (2) EŞZAMANLI GÖZLEM YAZIMI SEGMENT KAYBETTİRİRDİ. Açık segment
--       kilitsiz okunuyordu: aynı araca aynı anda iki gözlem gelirse ikisi de
--       "açık segment yok" görüp INSERT eder, `vdph_single_open_per_vehicle`
--       kısmi unique index ikincisini reddeder ve o gözlemin TAMAMI
--       (presence satırı dâhil) hata ile geri alınırdı.
--
--   (3) ARAÇ BAĞI DOĞRULANMIYORDU. `vehicle_driver_presence` satırının
--       `company_id`'si İSTEMCİNİN İDDİASIYDI: A şirketinin kimliğiyle
--       B şirketinin aracına gözlem yazılabilirdi. Okuma tarafı (RLS ve
--       `list_vehicle_presence_history`) bunu şirkete göre süzdüğü için
--       gözlem YANLIŞ tenant'ta görünürdü.
--
-- ── RESOLVER'A DOKUNULMADI (BAĞLAYICI) ───────────────────────────────────
-- `_resolve_driver_presence`, `_resolve_trip_driver` ve
-- `_trip_attribution_trigger` **BU MIGRATION TARAFINDAN YENİDEN
-- TANIMLANMAZ**. Doğrulama bölümü bunu fonksiyon gövdelerini OKUYARAK ve
-- resolver'ı ÇAĞIRARAK kanıtlar. Geçmiş defteri hâlâ attribution'ın
-- girdisi DEĞİLDİR.
--
-- ── UNKNOWN / FAIL-CLOSED KORUNUR ────────────────────────────────────────
-- Bu migration hiçbir yerde "bilinmiyorsa varsay" yapmaz: doğrulanamayan
-- bağ REDDEDİLİR (sessizce düzeltilmez), kapanış anı bilinmiyorsa
-- yazılmaz, sahte süre üretilmez.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. ARAÇ BAĞI DOĞRULAMASI (istemci iddiasına GÜVENME) ────────────────
--
-- Gözlem, İDDİA ETTİĞİ şirkete değil, ARACIN GERÇEKTEN ait olduğu şirkete
-- bağlanmak zorundadır. Üç kapı da fail-closed'dır: eksik/uyumsuz bağ
-- düzeltilmez, REDDEDİLİR.
--
-- ⚠️ `SECURITY DEFINER` bilinçlidir: doğrulama sorgusu RLS'e takılmadan
--    ARACIN gerçek sahibini okumak zorundadır (aksi halde kendi tenant'ını
--    göremeyen bir istemci "araç yok" hatası alırdı).
CREATE OR REPLACE FUNCTION public._presence_binding_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_vehicle_co uuid;
  v_found      boolean;
  v_driver_co  uuid;
  v_driver_st  text;
BEGIN
  SELECT v.company_id, true INTO v_vehicle_co, v_found
    FROM public.vehicles v WHERE v.id = NEW.vehicle_id;

  IF NOT coalesce(v_found, false) THEN
    RAISE EXCEPTION 'PRESENCE_VEHICLE_UNKNOWN: gozlem var olmayan araca yazilamaz'
      USING ERRCODE = 'check_violation';
  END IF;

  /* Bireysel (şirketsiz) araç: filo sürücüsü kavramı YOKTUR. Buraya gözlem
     yazmak, hiçbir filoya ait olmayan bir aracı bir filo sürücüsüne
     bağlamak demektir. */
  IF v_vehicle_co IS NULL THEN
    RAISE EXCEPTION 'PRESENCE_VEHICLE_NOT_FLEET: sirketsiz araca filo gozlemi yazilamaz'
      USING ERRCODE = 'check_violation';
  END IF;

  /* ASIL KAPI: satırın `company_id`'si İSTEMCİDEN gelir — aracın gerçek
     şirketiyle uyuşmuyorsa gözlem yanlış tenant'a yazılıyor demektir. */
  IF NEW.company_id IS DISTINCT FROM v_vehicle_co THEN
    RAISE EXCEPTION 'PRESENCE_VEHICLE_BINDING_MISMATCH: gozlem baska sirketin aracina yazilamaz'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT d.company_id, d.status INTO v_driver_co, v_driver_st
    FROM public.fleet_drivers d WHERE d.id = NEW.driver_id;

  IF v_driver_co IS NULL THEN
    RAISE EXCEPTION 'PRESENCE_DRIVER_UNKNOWN: gozlem var olmayan surucuye yazilamaz'
      USING ERRCODE = 'check_violation';
  END IF;

  /* CROSS-TENANT: başka şirketin sürücüsü bu araçta "varlık" üretemez. */
  IF v_driver_co IS DISTINCT FROM v_vehicle_co THEN
    RAISE EXCEPTION 'PRESENCE_DRIVER_TENANT_MISMATCH: surucu aracin sirketine ait degil'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_presence_binding_guard ON public.vehicle_driver_presence;
CREATE TRIGGER trg_presence_binding_guard
  BEFORE INSERT OR UPDATE OF vehicle_id, driver_id, company_id
  ON public.vehicle_driver_presence
  FOR EACH ROW EXECUTE FUNCTION public._presence_binding_guard();

-- ── 2. KAPANMIŞ SEGMENT DEĞİŞMEZDİR ─────────────────────────────────────
--
-- "Aynı segment iki kez kapanmayacak" kuralının SON savunmasıdır: mantık
-- bozulsa bile veritabanı kapanmış bir satırın kapanışını değiştiremez.
-- Kapanış alanları dışındaki alanların değişimine de izin verilmez —
-- kapanmış bir segmentin süresi/gerekçesi sonradan "düzeltilirse" defter
-- kanıt olmaktan çıkar.
CREATE OR REPLACE FUNCTION public._presence_history_closure_immutable()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  IF OLD.expired_at IS NULL THEN
    RETURN NEW;   -- açık segment: tazeleme/kapatma serbest
  END IF;

  IF NEW.expired_at   IS DISTINCT FROM OLD.expired_at
     OR NEW.duration_ms  IS DISTINCT FROM OLD.duration_ms
     OR NEW.close_reason IS DISTINCT FROM OLD.close_reason
     OR NEW.detected_at  IS DISTINCT FROM OLD.detected_at
     OR NEW.expires_at   IS DISTINCT FROM OLD.expires_at THEN
    RAISE EXCEPTION 'PRESENCE_SEGMENT_ALREADY_CLOSED: kapanmis segment yeniden kapatilamaz/degistirilemez'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_presence_history_closure_immutable
  ON public.vehicle_driver_presence_history;
CREATE TRIGGER trg_presence_history_closure_immutable
  BEFORE UPDATE ON public.vehicle_driver_presence_history
  FOR EACH ROW EXECUTE FUNCTION public._presence_history_closure_immutable();

-- ── 3. DEFTER TRIGGER'I — EŞZAMANLILIK VE İDEMPOTENS ────────────────────
--
-- 050'deki KARAR SIRASI AYNEN korunur (TTL → geç gözlem → dedupe → devir →
-- yeni segment). Değişen üç şey:
--
--   (a) ARAÇ BAŞINA SERİLEŞTİRME: `pg_advisory_xact_lock` ile aynı aracın
--       eşzamanlı gözlemleri sıraya girer. Kilit araç başınadır — farklı
--       araçların gözlemleri birbirini BEKLEMEZ (filo ölçeğinde tıkanma yok)
--       ve işlem sonunda otomatik bırakılır (sızıntı yok).
--   (b) AÇIK SEGMENT `FOR UPDATE` İLE OKUNUR: satır kilitli okunur, karar
--       verilirken başkası onu kapatamaz.
--   (c) TÜM KAPATMA UPDATE'LERİNDE `expired_at IS NULL` KOŞULU: bir segment
--       ancak AÇIKKEN kapatılabilir → ikinci kapanış hiçbir satırı
--       etkilemez (idempotent), yarış hâlinde İLK kapanış kazanır.
CREATE OR REPLACE FUNCTION public._presence_history_trigger()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_open     public.vehicle_driver_presence_history%ROWTYPE;
  v_has_open boolean := false;
  v_conf     text;
  v_close    timestamptz;
  v_n        integer;
BEGIN
  /* (a) Araç başına serileştirme — işlem bitince otomatik bırakılır. */
  PERFORM pg_advisory_xact_lock(hashtext('presence_history'),
                                hashtext(NEW.vehicle_id::text));

  v_conf := public._presence_weakest(
              NEW.confidence, public._presence_source_ceiling(NEW.source));

  /* (b) Açık segment KİLİTLİ okunur. */
  SELECT * INTO v_open
    FROM public.vehicle_driver_presence_history
   WHERE vehicle_id = NEW.vehicle_id AND expired_at IS NULL
   ORDER BY detected_at DESC
   LIMIT 1
     FOR UPDATE;
  v_has_open := FOUND;

  -- (1) TTL: sabah okutulan kart akşamki gözleme kadar "açık" SAYILMAZ.
  IF v_has_open AND v_open.expires_at <= NEW.detected_at THEN
    UPDATE public.vehicle_driver_presence_history
       SET expired_at   = v_open.expires_at,
           duration_ms  = public._presence_duration_ms(v_open.detected_at, v_open.expires_at),
           close_reason = 'TTL_EXPIRED'
     WHERE id = v_open.id
       AND expired_at IS NULL;          -- (c) İKİNCİ KAPANIŞ YOK
    v_has_open := false;
  END IF;

  -- (2) GEÇ GELEN ESKİ GÖZLEM (çevrimdışı replay): yeni segmenti BOZMA.
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
     WHERE id = v_open.id
       AND expired_at IS NULL;          -- kapanmış segment TAZELENMEZ
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
     WHERE id = v_open.id
       AND expired_at IS NULL;          -- (c) İKİNCİ KAPANIŞ YOK
    GET DIAGNOSTICS v_n = ROW_COUNT;

    /* Kapatamadıysak (başkası kapatmış) yeni segment AÇMAYIZ: tek-açık
       invaryantını kırmaktansa bu gözlemi defterde göstermemek yeğdir —
       gözlemin KENDİSİ (vehicle_driver_presence) yine de kaydedilmiştir
       ve resolver onu görür. Sessiz veri kaybı değil, bilinçli fail-closed. */
    IF v_n = 0 THEN
      RETURN NEW;
    END IF;
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

-- Trigger tanımı DEĞİŞMEDİ (aynı tablo, aynı olay) — yalnız gövde sertleşti.
DROP TRIGGER IF EXISTS trg_presence_history ON public.vehicle_driver_presence;
CREATE TRIGGER trg_presence_history
  AFTER INSERT ON public.vehicle_driver_presence
  FOR EACH ROW EXECUTE FUNCTION public._presence_history_trigger();

-- ── 4. SÜRESİ DOLAN SEGMENTİ KAPATMA — EŞZAMANLI KOŞUMA DAYANIKLI ───────
--
-- Aynı anda iki bakım çağrısı koşarsa:
--   · `FOR UPDATE SKIP LOCKED` → ikisi AYNI satırı beklemez, ikinci koşum
--     kilitli satırı ATLAR (tıkanma yok)
--   · dıştaki `expired_at IS NULL` → atlanmayan ama arada kapanmış satır
--     ikinci kez KAPATILMAZ
--   · dönen sayı GERÇEKTEN bu çağrının kapattığı satır sayısıdır → iki
--     çağrının toplamı, kapanan segment sayısını AŞAMAZ (çift sayım yok)
--
-- `service_role` dışında kimse çağıramaz (kullanıcı defteri kapatamaz).
CREATE OR REPLACE FUNCTION public.settle_expired_presence_history()
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE v_n integer;
BEGIN
  UPDATE public.vehicle_driver_presence_history h
     SET expired_at   = h.expires_at,
         duration_ms  = public._presence_duration_ms(h.detected_at, h.expires_at),
         close_reason = 'TTL_EXPIRED'
   WHERE h.id IN (
           SELECT s.id
             FROM public.vehicle_driver_presence_history s
            WHERE s.expired_at IS NULL AND s.expires_at <= now()
            FOR UPDATE SKIP LOCKED
         )
     AND h.expired_at IS NULL;          -- idempotens: ikinci kapanış YOK
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$fn$;

REVOKE ALL ON FUNCTION public.settle_expired_presence_history() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_expired_presence_history() TO service_role;

REVOKE ALL ON FUNCTION public._presence_binding_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._presence_history_closure_immutable()
  FROM PUBLIC, anon, authenticated;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- DOĞRULAMA (fail-closed) — fonksiyonlar ÇAĞRILARAK sınanır (047 dersi).
-- ═══════════════════════════════════════════════════════════════════════════

DO $verify$
DECLARE r record; v_def text;
BEGIN
  -- (a) Yeni kapılar bağlı mı
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
     WHERE t.tgname='trg_presence_binding_guard' AND NOT t.tgisinternal
       AND c.relname='vehicle_driver_presence') THEN
    RAISE EXCEPTION '051 HATA: arac bagi dogrulama trigger i bagli degil';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
     WHERE t.tgname='trg_presence_history_closure_immutable' AND NOT t.tgisinternal
       AND c.relname='vehicle_driver_presence_history') THEN
    RAISE EXCEPTION '051 HATA: kapanis degismezlik trigger i bagli degil';
  END IF;

  -- (b) İDEMPOTENS koşulları GERÇEKTEN gövdede mi
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='_presence_history_trigger';
  IF v_def NOT LIKE '%pg_advisory_xact_lock%' THEN
    RAISE EXCEPTION '051 HATA: defter trigger inde arac basina serilestirme yok';
  END IF;
  IF v_def NOT LIKE '%FOR UPDATE%' THEN
    RAISE EXCEPTION '051 HATA: acik segment kilitsiz okunuyor';
  END IF;
  IF v_def NOT LIKE '%AND expired_at IS NULL%' THEN
    RAISE EXCEPTION '051 HATA: kapatma UPDATE lerinde idempotens kosulu yok';
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='settle_expired_presence_history';
  IF v_def NOT LIKE '%SKIP LOCKED%' THEN
    RAISE EXCEPTION '051 HATA: bakim fonksiyonu eszamanli kosumda tikanir';
  END IF;

  -- (c) RESOLVER'A DOKUNULMADI — hâlâ çağrılabilir ve gözlem yokken
  --     NO_PRESENCE döner (P0 atama modeli devrede kalır).
  SELECT * INTO r FROM public._resolve_driver_presence(
    gen_random_uuid(), gen_random_uuid(), now() - interval '1 hour', now(), NULL);
  IF r.decision <> 'NO_PRESENCE' OR r.driver_id IS NOT NULL THEN
    RAISE EXCEPTION '051 HATA: presence resolver davranisi DEGISTI: %', r.decision;
  END IF;

  -- (d) P0/P1 ZİNCİRİ KORUNDU + defter attribution'a KARIŞMADI
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='_trip_attribution_trigger';
  IF v_def NOT LIKE '%_resolve_trip_driver%' THEN
    RAISE EXCEPTION '051 HATA: trigger P0 atama modelini artik cagirmiyor';
  END IF;
  IF v_def NOT LIKE '%_resolve_driver_presence%' THEN
    RAISE EXCEPTION '051 HATA: trigger P1 presence katmanini cagirmiyor';
  END IF;
  IF v_def LIKE '%presence_history%' THEN
    RAISE EXCEPTION '051 HATA: gecmis defteri attribution kararina girmis';
  END IF;

  -- (e) Yetkiler: kullanıcı defteri kapatamaz, anon hiçbir şeye dokunamaz
  IF has_function_privilege('authenticated',
       'public.settle_expired_presence_history()', 'EXECUTE') THEN
    RAISE EXCEPTION '051 HATA: kullanici defteri kapatabiliyor';
  END IF;
  IF has_table_privilege('anon','public.vehicle_driver_presence','SELECT')
     OR has_table_privilege('anon','public.vehicle_driver_presence_history','SELECT') THEN
    RAISE EXCEPTION '051 HATA: anon presence okuyabiliyor';
  END IF;

  -- (f) DEFINER + search_path
  FOR r IN SELECT p.proname, pg_get_functiondef(p.oid) AS def
             FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
            WHERE n.nspname='public'
              AND p.proname IN ('_presence_binding_guard',
                                '_presence_history_closure_immutable',
                                '_presence_history_trigger',
                                'settle_expired_presence_history')
  LOOP
    IF r.def NOT LIKE '%SECURITY DEFINER%' OR r.def NOT LIKE '%search_path%' THEN
      RAISE EXCEPTION '051 HATA: %: DEFINER/search_path eksik', r.proname;
    END IF;
  END LOOP;

  RAISE NOTICE '051 OK: arac bagi dogrulamasi + kapanis degismezligi + eszamanli-guvenli TTL kapanisi kuruldu · 049 resolver DEGISMEDI · P0 atama modeli KORUNDU.';
END
$verify$;
