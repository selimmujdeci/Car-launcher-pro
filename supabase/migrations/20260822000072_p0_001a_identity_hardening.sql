-- ═══════════════════════════════════════════════════════════════════════════
-- 072  P0-001A — CİHAZ KİMLİĞİ SERTLEŞTİRME (MİNİMAL, BAĞIMSIZ)
--
-- Bu migration cihaz kimliği MİMARİSİNİ DEĞİŞTİRMEZ. Yalnız üç bağımsız ve
-- tehlikeli davranışı kapatır. Anahtar biçimi (düz metin ↔ hash) AYNEN kalır;
-- o dönüşüm 071'in başlattığı aşamalı geçişin işidir (P0-001H).
--
-- ── İŞ 1 · `register_vehicle` MEVCUT ANAHTARI GERİ DÖNDÜRMESİN ────────────
-- ESKİ GÖVDE (prod_baseline.sql:1151):
--     SELECT id, coalesce(api_key_hash, api_key) INTO v_vehicle_id, v_api_key
--       FROM vehicles WHERE device_name = p_device_id;
--     … RETURN jsonb_build_object(…, 'api_key', v_api_key, …);
-- Yani ZATEN KAYITLI bir `device_id` ile çağıran HERKES o aracın **ham cihaz
-- anahtarını** alıyordu. Fonksiyon `PUBLIC`e açık olduğu için (aşağıda İŞ 3)
-- bu, anonim bir çağıranın `device_id` bilmesi hâlinde aracı tamamen ele
-- geçirmesi demekti. `device_id` bir sır DEĞİLDİR: `Math.random()` ile
-- üretiliyor ve `getReporterDeviceId()` ile topluluk özelliklerine veriliyor.
--
-- YENİ GÖVDE: mevcut araçta `api_key` kolonu HİÇ OKUNMAZ ve yanıtta
-- `api_key` alanı HİÇ BULUNMAZ (null bile değil). Yalnız İLK kayıtta üretilir
-- ve o tek seferde döner.
--
-- ── CİHAZ NEDEN KIRILMAZ (ölçülmüş) ───────────────────────────────────────
-- `vehicleIdentityService.registerVehicle()` yanıtı `if (data.api_key)` ile
-- KOŞULLU işler → alan gelmezse saklı anahtara DOKUNMAZ, siler de.
-- `MobileLinkWidget.tsx:117,137` bu fonksiyonu 6 haneli KOD almak için çağırır
-- ve yanıttan yalnız `code`/`expiresAt` okur. Bu yüzden `linking_code` her iki
-- dalda da üretilmeye DEVAM EDER — aksi hâlde "Mobil Bağlantı" ekranı ölürdü.
-- `ensureDeviceRegistered()` boot'ta BİR KEZ çağrılır ve başarısızlıkta yeni
-- araç AÇMAZ (device_name eşleştiği için) → boot loop ve araç şişmesi YOK.
--
-- ── İŞ 2 · EŞLEŞTİRMEDE TEK OTORİTE: `vehicle_linking_codes` ──────────────
-- `pair_vehicle_to_user` (067) geçici kod bulunamazsa KALICI
-- `vehicles.pairing_code` kolonuna düşüyordu. O kolon NOT NULL, varsayılanı
-- 6 hex, HİÇ sona ermiyor ve HİÇ tüketilmiyor → süresiz bir arka kapı.
-- Bu dal KALDIRILDI. Kolon DÜŞÜRÜLMEZ (geri dönüşü zor temizlik ayrı turda).
--
-- Aynı gerekçeyle `pair_vehicle_by_code` — kod tabanında ÇAĞIRANI OLMAYAN,
-- format/TTL kontrolü BULUNMAYAN ikinci eşleştirme otoritesi — erişime
-- kapatılır. Fonksiyon DROP EDİLMEZ, yalnız çağrılamaz hâle gelir.
--
-- ── İŞ 3 · YÜZEYİ DARALT: `PUBLIC` yerine AÇIK ROL ────────────────────────
-- Prod baseline'da HİÇBİR fonksiyon GRANT'i yoktur → PostgreSQL varsayılanı
-- `PUBLIC`e EXECUTE verir. Cihaz Supabase'e `anon` anahtarıyla bağlandığı için
-- `register_vehicle` anon'a AÇIK KALMALIDIR; körlemesine REVOKE ürünü kırardı.
-- Bu yüzden yalnız `PUBLIC` kaldırılır ve ihtiyaç duyulan roller AÇIKÇA verilir.
-- Kapsam BİLİNÇLİ olarak bu turun üç fonksiyonuyla sınırlıdır.
--
-- ── EK: TEK AKTİF KOD ─────────────────────────────────────────────────────
-- Kod üretimi `ON CONFLICT (vehicle_id) DO UPDATE` kullanıyordu; bu, araç
-- başına UNIQUE kısıtının varlığına bağlıydı ve o kısıt her ortamda YOK
-- (yerel doğrulama veritabanında `vehicle_linking_codes` PK'sı `code`'dur).
-- Yerine "önce SİL, sonra YAZ" konuldu: kısıt varsayımı ortadan kalkar ve
-- araç başına AYNI ANDA tek geçerli kod olur — eski kodlar anında geçersizleşir.
--
-- VERİ YAZILMAZ · KOLON DÜŞÜRÜLMEZ · ŞEMA DEĞİŞMEZ.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ══════════════════════════════════════════════════════════════════════════
-- İŞ 1 — register_vehicle
-- ══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.register_vehicle(
  p_device_id text,
  p_name      text DEFAULT 'Araç'::text
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_vehicle_id uuid;
  v_api_key    text;
  v_is_new     boolean := false;
  v_code       text;
  v_expires_at timestamptz;
BEGIN
  IF p_device_id IS NULL OR btrim(p_device_id) = '' THEN
    RAISE EXCEPTION 'invalid_device_id' USING ERRCODE = 'P0001';
  END IF;

  /* ⚠ `api_key`/`api_key_hash` BURADA OKUNMAZ. Okunursa er ya da geç
     yanıta sızar — eski gövdenin kusuru tam olarak buydu. */
  SELECT id INTO v_vehicle_id
  FROM public.vehicles
  WHERE device_name = p_device_id
  LIMIT 1;

  IF v_vehicle_id IS NULL THEN
    v_api_key := gen_random_uuid()::text;
    INSERT INTO public.vehicles (name, device_name, api_key_hash)
    VALUES (coalesce(NULLIF(btrim(coalesce(p_name, '')), ''), 'Araç'),
            p_device_id, v_api_key)
    RETURNING id INTO v_vehicle_id;
    v_is_new := true;
  END IF;

  /* Araç başına TEK aktif kod: önce sil, sonra yaz. */
  DELETE FROM public.vehicle_linking_codes WHERE vehicle_id = v_vehicle_id;

  LOOP
    v_code := lpad((floor(random() * 1000000))::int::text, 6, '0');
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.vehicle_linking_codes
       WHERE code = v_code AND expires_at > now()
    );
  END LOOP;

  v_expires_at := now() + interval '5 minutes';
  INSERT INTO public.vehicle_linking_codes (vehicle_id, code, expires_at)
  VALUES (v_vehicle_id, v_code, v_expires_at);

  /* Ham anahtar YALNIZ ilk kayıtta ve YALNIZ bir kez döner.
     Mevcut cihazda `api_key` ANAHTARI YANITTA HİÇ BULUNMAZ — istemci
     `if (data.api_key)` ile korunur, saklı anahtarına dokunmaz. */
  IF v_is_new THEN
    RETURN jsonb_build_object(
      'vehicle_id',          v_vehicle_id,
      'api_key',             v_api_key,
      'already_provisioned', false,
      'linking_code',        v_code,
      'expires_at',          v_expires_at
    );
  END IF;

  RETURN jsonb_build_object(
    'vehicle_id',          v_vehicle_id,
    'already_provisioned', true,
    'linking_code',        v_code,
    'expires_at',          v_expires_at
  );
END
$fn$;

COMMENT ON FUNCTION public.register_vehicle(text, text) IS
  'P0-001A: ham cihaz anahtarı YALNIZ ilk kayıtta döner. Zaten kayıtlı '
  'device_id ile çağrılırsa yanıtta api_key alanı BULUNMAZ '
  '(already_provisioned=true). Kod üretimi her iki dalda da sürer.';

-- ══════════════════════════════════════════════════════════════════════════
-- İŞ 2a — pair_vehicle_to_user: KALICI pairing_code fallback'i KALDIRILDI
-- 067'nin gövdesi birebir korunur; YALNIZ ikinci kod arama dalı çıkarılmıştır.
-- ══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.pair_vehicle_to_user(
  p_code    text,
  p_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  c_individual_max constant integer := 3;

  v_vehicle        public.vehicles%ROWTYPE;
  v_code           text;
  v_company        uuid;
  v_owned_count    integer;
  v_already_paired boolean;
  v_role           text;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'P0001';
  END IF;

  v_code := upper(trim(coalesce(p_code, '')));
  IF v_code !~ '^[0-9]{6}$' THEN
    RAISE EXCEPTION 'invalid_code' USING ERRCODE = 'P0001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  /* ── P0-001A · TEK OTORİTE ──────────────────────────────────────────────
   * Kod YALNIZ `vehicle_linking_codes` içinde aranır: kısa ömürlü (TTL),
   * tek kullanımlık, tüketilince SİLİNEN kod.
   *
   * KALDIRILAN DAL (067'de vardı):
   *     SELECT * FROM vehicles WHERE upper(pairing_code) = v_code
   * `vehicles.pairing_code` NOT NULL'dur, varsayılanı üretilir, HİÇ sona
   * ermez ve HİÇ tüketilmez. Yani o dal, kodu bir kez görmüş herkese
   * SÜRESİZ eşleştirme hakkı veriyordu. Kolon bu turda DÜŞÜRÜLMEZ; yalnız
   * bu yol üzerinden KULLANILAMAZ. */
  SELECT v.* INTO v_vehicle
  FROM public.vehicle_linking_codes vlc
  JOIN public.vehicles v ON v.id = vlc.vehicle_id
  WHERE vlc.code = v_code
    AND vlc.expires_at > now()
  FOR UPDATE OF v
  LIMIT 1;

  IF NOT FOUND THEN
    -- Geçersiz · süresi dolmuş · zaten tüketilmiş (replay) — hepsi aynı cevap.
    RAISE EXCEPTION 'invalid_or_expired_code' USING ERRCODE = 'P0001';
  END IF;

  -- ŞİRKET: yalnız SUNUCUDA doğrulanmış üyelikten. İstemci girdisi YOK.
  SELECT p.company_id INTO v_company
  FROM public.profiles p
  WHERE p.id = p_user_id;

  -- SAHİPLİK KAPILARI — sessiz taşıma YASAK.
  IF v_vehicle.company_id IS NOT NULL
     AND (v_company IS NULL OR v_vehicle.company_id <> v_company) THEN
    RAISE EXCEPTION 'vehicle_belongs_to_another_company' USING ERRCODE = 'P0001';
  END IF;

  IF v_vehicle.owner_id IS NOT NULL AND v_vehicle.owner_id <> p_user_id THEN
    IF v_company IS NULL OR v_vehicle.company_id IS DISTINCT FROM v_company THEN
      RAISE EXCEPTION 'vehicle_owned_by_another_user' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- BİREYSEL LİMİT — yalnız şirketi OLMAYAN araçta uygulanır (#644).
  v_already_paired := EXISTS (
    SELECT 1 FROM public.vehicle_pairings
    WHERE user_id = p_user_id AND vehicle_id = v_vehicle.id
  );

  IF v_vehicle.company_id IS NULL AND NOT v_already_paired THEN
    SELECT count(*) INTO v_owned_count
    FROM public.vehicles
    WHERE owner_id = p_user_id
      AND company_id IS NULL
      AND id <> v_vehicle.id;

    IF v_owned_count >= c_individual_max THEN
      RAISE EXCEPTION 'individual_vehicle_limit_reached' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  /* ATOMİK YAZMALAR — `company_id` bu yoldan ASLA yazılmaz (#644: aksi hâlde
     `vehicles_single_owner_type` CHECK kısıtı ihlal edilirdi). */
  UPDATE public.vehicles
  SET owner_id = CASE
                   WHEN company_id IS NULL THEN coalesce(owner_id, p_user_id)
                   ELSE owner_id
                 END
  WHERE id = v_vehicle.id
  RETURNING * INTO v_vehicle;

  v_role := CASE
    WHEN v_vehicle.owner_id = p_user_id THEN 'owner'
    ELSE 'observer'
  END;

  INSERT INTO public.vehicle_pairings (user_id, vehicle_id, role, company_id)
  VALUES (p_user_id, v_vehicle.id, v_role, v_vehicle.company_id)
  ON CONFLICT (user_id, vehicle_id) DO UPDATE
    SET role       = EXCLUDED.role,
        company_id = EXCLUDED.company_id;

  -- KODU TÜKET (tek kullanım — replay kapalı)
  DELETE FROM public.vehicle_linking_codes WHERE vehicle_id = v_vehicle.id;

  RETURN jsonb_build_object(
    'vehicle_id',    v_vehicle.id,
    'name',          coalesce(v_vehicle.name, v_vehicle.device_name, 'Araç'),
    'device_id',     v_vehicle.device_id,
    'created_at',    v_vehicle.created_at,
    'company_id',    v_vehicle.company_id,
    'owner_id',      v_vehicle.owner_id,
    'role',          v_role,
    'is_individual', (v_vehicle.company_id IS NULL)
  );
END
$fn$;

COMMENT ON FUNCTION public.pair_vehicle_to_user(text, uuid) IS
  'P0-001A: eşleştirme kodu YALNIZ vehicle_linking_codes içinde aranır. '
  'Kalıcı vehicles.pairing_code fallback''i KALDIRILDI (süresiz arka kapı).';

-- ══════════════════════════════════════════════════════════════════════════
-- İŞ 2b — pair_vehicle_by_code: İKİNCİ OTORİTE ERİŞİME KAPATILIR
-- DROP EDİLMEZ (geri dönüşü zor temizlik ayrı turda) — yalnız çağrılamaz.
-- Fonksiyon her ortamda bulunmayabilir; varlığı KONTROL EDİLİR.
-- ══════════════════════════════════════════════════════════════════════════
DO $revoke$
DECLARE r record; n integer := 0;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
    WHERE ns.nspname = 'public'
      AND p.proname IN ('pair_vehicle_by_code', 'pair_vehicle')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', r.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', r.sig);
    n := n + 1;
    RAISE NOTICE '072: ikinci eşleştirme otoritesi kapatıldı → %', r.sig;
  END LOOP;
  IF n = 0 THEN
    RAISE NOTICE '072: pair_vehicle_by_code/pair_vehicle bu ortamda YOK — atlandı.';
  END IF;
END
$revoke$;

-- ══════════════════════════════════════════════════════════════════════════
-- İŞ 3 — YÜZEY DARALTMA: PUBLIC → açık rol (YALNIZ bu turun fonksiyonları)
-- ══════════════════════════════════════════════════════════════════════════

/* Cihaz Supabase'e `anon` anahtarıyla, KULLANICI OTURUMU OLMADAN bağlanır
   (`vehicleIdentityService._rpc`). `anon` kaldırılırsa cihaz bootstrap'ı
   tamamen ölür — bu yüzden anon AÇIKÇA verilir, PUBLIC kaldırılır. */
REVOKE ALL ON FUNCTION public.register_vehicle(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_vehicle(text, text)
  TO anon, authenticated, service_role;

/* Kullanıcı↔araç eşleştirmesi yalnız sunucudan (service_role) çağrılır:
   `/api/vehicle/link` kullanıcı JWT'sini doğrular, sonra bu RPC'yi çağırır.
   İstemcinin doğrudan çağırması sahiplik kapılarını atlamak demek olurdu. */
REVOKE ALL ON FUNCTION public.pair_vehicle_to_user(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pair_vehicle_to_user(text, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.pair_vehicle_to_user(text, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.pair_vehicle_to_user(text, uuid) TO service_role;

-- ══════════════════════════════════════════════════════════════════════════
-- DOĞRULAMA (fail-closed) — beklenmeyen durumda migration DURUR
-- ══════════════════════════════════════════════════════════════════════════
DO $verify$
DECLARE v_src text;
BEGIN
  /* Kaynak taramasında YORUMLAR SAYILMAZ: bu fonksiyonların gövdesinde
     kaldırılan dalın NEDEN kaldırıldığı yazılıdır ve o açıklama metni kolon
     adını içerir. Yorumu koda saymak DOĞRU kodu yanlış yere düşürürdü —
     ilk koşuda tam olarak bu oldu. Blok yorumu önce, satır yorumu sonra. */

  -- (a) register_vehicle mevcut araçta api_key OKUMUYOR olmalı
  SELECT regexp_replace(regexp_replace(prosrc, '/\*.*?\*/', ' ', 'gs'), '--[^\n]*', ' ', 'g')
    INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='register_vehicle';
  IF v_src IS NULL THEN
    RAISE EXCEPTION '072 DOĞRULAMA DÜŞTÜ: register_vehicle yok';
  END IF;
  IF v_src ~* 'coalesce\s*\(\s*api_key_hash\s*,\s*api_key\s*\)' THEN
    RAISE EXCEPTION
      '072 DOĞRULAMA DÜŞTÜ: register_vehicle hâlâ mevcut anahtarı okuyor';
  END IF;

  -- (b) pair_vehicle_to_user KALICI pairing_code'a bakmıyor olmalı
  SELECT regexp_replace(regexp_replace(prosrc, '/\*.*?\*/', ' ', 'gs'), '--[^\n]*', ' ', 'g')
    INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='pair_vehicle_to_user';
  IF v_src IS NULL THEN
    RAISE EXCEPTION '072 DOĞRULAMA DÜŞTÜ: pair_vehicle_to_user yok';
  END IF;
  IF v_src ~* 'pairing_code' THEN
    RAISE EXCEPTION
      '072 DOĞRULAMA DÜŞTÜ: pair_vehicle_to_user hâlâ kalıcı pairing_code kullanıyor';
  END IF;

  -- (c) register_vehicle PUBLIC'e AÇIK OLMAMALI, anon'a AÇIK OLMALI
  IF has_function_privilege('public', 'public.register_vehicle(text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION '072 DOĞRULAMA DÜŞTÜ: register_vehicle hâlâ PUBLIC''e açık';
  END IF;
  IF NOT has_function_privilege('anon', 'public.register_vehicle(text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION
      '072 DOĞRULAMA DÜŞTÜ: anon register_vehicle çağıramıyor — cihaz bootstrap KIRILIR';
  END IF;

  -- (d) pair_vehicle_to_user istemci rollerine KAPALI olmalı
  IF has_function_privilege('anon', 'public.pair_vehicle_to_user(text, uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.pair_vehicle_to_user(text, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '072 DOĞRULAMA DÜŞTÜ: pair_vehicle_to_user istemciye açık';
  END IF;

  RAISE NOTICE '072 DOĞRULAMA: 4/4 GECTI';
END
$verify$;

COMMIT;
