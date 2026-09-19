-- 20260919000082_vehicle_push_token_device_auth.sql
-- ══════════════════════════════════════════════════════════════════════════
-- PROD-1A1 — ARAÇ KENDİ FCM TOKEN'INI KAYDEDEMİYORDU.
--
-- ── ÖLÇÜLEN GERÇEK (PROD-1A, 2026-09-19) ─────────────────────────────────
-- Production'da `vehicle_push_tokens` tablosu VAR ama **0 satır**. Yani
-- Push-to-Wake deploy edilse bile uyandırılacak HİÇBİR cihaz yok.
--
-- ── KÖK NEDEN ────────────────────────────────────────────────────────────
-- Tek kayıt yolu tabandaki `register_push_token(p_vehicle_id, …)`:
--     IF NOT (is_vehicle_owner(p_vehicle_id) OR is_paired(auth.uid(), …))
--        → {ok:false,'Yetkisiz.'}
-- Bu **KULLANICI** kimliğine dayanır. Oysa head unit Supabase'e
-- `createClient(URL, ANON_KEY, {persistSession:false, autoRefreshToken:false})`
-- ile, yani OTURUMSUZ bağlanır → `auth.uid()` NULL → `is_paired(NULL,…)` false
-- → araç her çağrıda 'Yetkisiz.' alır. Çağrı HTTP 200 döndüğü için istemci
-- bunu başarı sanıyordu (bkz. §"SAHTE BAŞARI" aşağıda).
--
-- Bu, #646'nın (araç kendi komutunu göremiyordu) BİREBİR aynısıdır: GRANT
-- vardı, engel kimlik modeliydi. Orada çözüm yeni politika değil, cihazın
-- ZATEN sahip olduğu kimlikle (`api_key`) konuşan bir SECURITY DEFINER RPC
-- olmuştu. Bu migration aynı çözümü token kaydına uygular.
--
-- ── YENİ OTORİTE YOK ─────────────────────────────────────────────────────
-- `api_key` çözümü `fetch_pending_vehicle_commands` (069) ve
-- `update_command_status` (taban) ile **BİREBİR AYNIDIR** — ikinci bir cihaz
-- kimliği kavramı üretilmez. Pratik sonuç: **komutlarını çekebilen araç
-- token'ını da kaydedebilir; çekemeyen kaydedemez.** Tek kimlik, tek kapı.
--
-- Tablo `vehicle_push_tokens` DEĞİŞMEZ: yeni tablo/kolon/kısıt YOK, RLS
-- politikası DEĞİŞMEZ, mevcut satırlar SİLİNMEZ, TRUNCATE YOK.
-- Eski `register_push_token` DROP EDİLMEZ (PWA tarafı için duruyor; PROD-1A1
-- kapsamında yıkıcı temizlik yapılmaz).
--
-- ── search_path = public, extensions (071 DERSİ) ──────────────────────────
-- `digest()` Supabase'de `extensions` şemasındadır. `SET search_path = public`
-- ile kilitli bir SECURITY DEFINER fonksiyon onu ÇÖZEMEZ ve daha api_key
-- karşılaştırmasına varmadan 42883 ile düşer (071: komut RPC'leri bu yüzden
-- uygulandıkları günden beri ölüydü). Bu fonksiyon İLK GÜNDEN doğru
-- search_path ile yaratılır ve aşağıda DAVRANIŞSAL olarak doğrulanır.
--
-- ── SAHTE BAŞARI KAPANIR ─────────────────────────────────────────────────
-- Geçersiz/eksik `api_key` → **istisna** (P0001), HTTP 200 DEĞİL. İstemcinin
-- "RPC çağrısı hata atmadı → token kaydedildi" diye yorumlaması yapısal olarak
-- imkânsızlaşır. Başarı ise INSERT'ün `RETURNING id`'siyle KANITLANIR: satır
-- gerçekten yazılmadıysa `{ok:false,'persist_failed'}` döner.
--
-- ── İSTEMCİ ARAÇ SEÇEMEZ ─────────────────────────────────────────────────
-- İmzada `p_vehicle_id` **YOKTUR**. Araç kimliği YALNIZ `api_key`den sunucu
-- tarafında türetilir → A aracının anahtarıyla B aracına token yazmak
-- yapısal olarak imkânsızdır (parametre mevcut olmadığı için).
--
-- ── ESKİ TOKEN'LAR (bilinçli olarak SİLİNMEZ) ────────────────────────────
-- `UNIQUE(vehicle_id, fcm_token)` gereği token yenilenince YENİ satır oluşur,
-- eski satır KALIR. Tabloda cihaz ayırt edici kolon YOKTUR; bu yüzden "eski
-- satır aynı cihazın mı" sorusunun bu şemada DOĞRU cevabı yoktur ve tahminle
-- silmek, çok cihazlı bir aracın geçerli token'ını yok edebilirdi.
-- Ölü token'ın TEK yetkili tanığı FCM'dir (UNREGISTERED/NOT_FOUND); temizlik
-- bu yüzden GÖNDEREN tarafın işidir (PROD-1A2). Burada tahminle silinmez.
--
-- VERİ SİLİNMEZ · KOLON DÜŞÜRÜLMEZ · RLS DEĞİŞMEZ · TABLO YENİDEN YARATILMAZ.
-- ══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 0. ÖN KOŞULLAR (fail-closed) ──────────────────────────────────────────
DO $$
DECLARE v_sema text;
BEGIN
  SELECT n.nspname INTO v_sema
  FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname = 'pgcrypto';

  IF v_sema IS NULL THEN
    RAISE EXCEPTION '082 ÖN KOŞUL: pgcrypto kurulu değil — api_key doğrulaması çalışamaz.';
  END IF;
  IF v_sema <> 'extensions' THEN
    RAISE EXCEPTION '082 ÖN KOŞUL: pgcrypto beklenmedik şemada (%) — search_path elle gözden geçirilmeli.', v_sema;
  END IF;

  IF to_regclass('public.vehicle_push_tokens') IS NULL THEN
    RAISE EXCEPTION '082 ÖN KOŞUL: vehicle_push_tokens tablosu YOK — bu migration tablo YARATMAZ.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname  = 'vehicle_push_tokens_vehicle_id_fcm_token_key'
      AND conrelid = 'public.vehicle_push_tokens'::regclass
  ) THEN
    RAISE EXCEPTION '082 ÖN KOŞUL: UNIQUE(vehicle_id, fcm_token) YOK — ON CONFLICT hedefi bulunamaz.';
  END IF;
END $$;

-- ── 1. CİHAZ KİMLİĞİYLE TOKEN KAYDI ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.register_vehicle_push_token(
  p_api_key   text,
  p_fcm_token text,
  p_platform  text DEFAULT 'android'
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, extensions
AS $fn$
DECLARE
  c_max_token_len constant integer := 4096;  -- FCM token'ı ~200 karakterdir
  v_vehicle_id uuid;
  v_platform   text;
  v_row_id     uuid;
BEGIN
  /* Kimlik kapısı ÖNCE. Hata mesajı anahtarın DEĞERİNİ ASLA içermez. */
  IF p_api_key IS NULL OR length(btrim(p_api_key)) = 0 THEN
    RAISE EXCEPTION 'Geçersiz api_key' USING ERRCODE = 'P0001';
  END IF;

  /* `fetch_pending_vehicle_commands` / `update_command_status` ile BİREBİR
     aynı çözüm — ikinci bir cihaz kimliği kavramı ÜRETİLMEZ (dev fallback
     dâhil, aynı gerekçe: hash'lenmemiş anahtarlı yerel ortamlar). */
  SELECT id INTO v_vehicle_id
  FROM vehicles
  WHERE api_key_hash = encode(digest(p_api_key, 'sha256'), 'hex')
     OR api_key_hash = p_api_key
  LIMIT 1;

  IF v_vehicle_id IS NULL THEN
    RAISE EXCEPTION 'Geçersiz api_key' USING ERRCODE = 'P0001';
  END IF;

  /* Girdi doğrulaması — kimlik GEÇERLİ ama içerik bozuksa bu bir yetki
     sorunu DEĞİLDİR; çağıran ayırt edebilsin diye istisna değil `ok:false`. */
  IF p_fcm_token IS NULL
     OR length(btrim(p_fcm_token)) = 0
     OR length(p_fcm_token) > c_max_token_len THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_fcm_token');
  END IF;

  /* Tablo CHECK'i yalnız 'android'|'ios' kabul eder. Bilinmeyen platformu
     'android'a ÇEVİRMEK uydurma olurdu → açıkça reddedilir. */
  v_platform := lower(btrim(coalesce(p_platform, '')));
  IF v_platform NOT IN ('android', 'ios') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_platform');
  END IF;

  INSERT INTO vehicle_push_tokens (vehicle_id, fcm_token, platform)
  VALUES (v_vehicle_id, btrim(p_fcm_token), v_platform)
  ON CONFLICT (vehicle_id, fcm_token) DO UPDATE
    SET platform   = excluded.platform,
        updated_at = now()
  RETURNING id INTO v_row_id;

  /* KANIT: "istisna atmadı" kalıcılık kanıtı DEĞİLDİR. Satır gerçekten
     yazıldıysa `RETURNING` bir id verir; vermediyse başarı İDDİA EDİLMEZ. */
  IF v_row_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'persist_failed');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$fn$;

-- ── 2. YETKİ: cihaz `anon` anahtarıyla bağlanır (069 ile aynı model) ──────
-- ÇAĞRILABİLİR ≠ YETKİLİ: kapı fonksiyonun İÇİNDEKİ api_key doğrulamasıdır.
REVOKE ALL ON FUNCTION public.register_vehicle_push_token(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_vehicle_push_token(text, text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.register_vehicle_push_token(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_vehicle_push_token(text, text, text) TO service_role;

COMMENT ON FUNCTION public.register_vehicle_push_token(text, text, text) IS
  'PROD-1A1: araç CİHAZ kimliğiyle (api_key) kendi FCM token''ını kaydeder. '
  'Araç kimliği sunucu tarafında türetilir; istemci vehicle_id SEÇEMEZ.';

-- ── 3. DAVRANIŞSAL DOĞRULAMA — "var mı" değil, "DOĞRU DAVRANIYOR mu" ──────
-- 071 dersi: nesnenin VARLIĞI, ÇALIŞTIĞININ kanıtı değildir.
DO $$
DECLARE
  v_kod      text;
  v_once     bigint;
  v_sonra    bigint;
  v_secdef   boolean;
  v_cfg      text[];
  v_oid      oid;
BEGIN
  SELECT p.oid, p.prosecdef, p.proconfig
    INTO v_oid, v_secdef, v_cfg
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'register_vehicle_push_token';

  IF v_oid IS NULL THEN
    RAISE EXCEPTION '082 DOĞRULAMA: fonksiyon yaratılmamış.';
  END IF;

  -- (a) SECURITY DEFINER şart: aksi hâlde anon RLS'e takılır ve kayıt yine ölür.
  IF NOT v_secdef THEN
    RAISE EXCEPTION '082 DOĞRULAMA: fonksiyon SECURITY DEFINER değil — anon cihaz yazamaz.';
  END IF;

  -- (b) search_path `extensions` içermeli, yoksa digest() çözülmez (071).
  IF v_cfg IS NULL OR NOT EXISTS (
    SELECT 1 FROM unnest(v_cfg) c WHERE c LIKE 'search_path=%' AND c LIKE '%extensions%'
  ) THEN
    RAISE EXCEPTION '082 DOĞRULAMA: search_path''te `extensions` yok — digest() çözülemez.';
  END IF;

  -- (c) PUBLIC'e EXECUTE KALMAMALI; anon'a VERİLMİŞ olmalı.
  IF EXISTS (
    SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
    WHERE p.oid = v_oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION '082 DOĞRULAMA: PUBLIC hâlâ EXECUTE yetkisine sahip.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
    WHERE p.oid = v_oid AND a.grantee = 'anon'::regrole AND a.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION '082 DOĞRULAMA: anon EXECUTE yetkisi YOK — cihaz çağıramaz.';
  END IF;

  -- (d) GEÇERSİZ ANAHTAR YAZAMAZ: satır sayısı ölçülür, sonra ölçülür.
  SELECT count(*) INTO v_once FROM public.vehicle_push_tokens;

  BEGIN
    PERFORM public.register_vehicle_push_token(
      '082-dogrulama-gecersiz-anahtar', '082-dogrulama-token', 'android');
    RAISE EXCEPTION '082 DOĞRULAMA: geçersiz anahtar istisna ATMADI — kimlik kapısı açık.';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_kod = RETURNED_SQLSTATE;
    IF v_kod = '42883' THEN
      RAISE EXCEPTION '082 DOĞRULAMA: 42883 (digest bulunamadı) — search_path uygulanmadı.';
    ELSIF v_kod <> 'P0001' THEN
      RAISE EXCEPTION '082 DOĞRULAMA: geçersiz anahtarda beklenmedik hata: %', v_kod;
    END IF;
  END;

  -- (e) BOŞ ANAHTAR da fail-closed olmalı.
  BEGIN
    PERFORM public.register_vehicle_push_token('', '082-dogrulama-token', 'android');
    RAISE EXCEPTION '082 DOĞRULAMA: boş anahtar istisna ATMADI.';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_kod = RETURNED_SQLSTATE;
    IF v_kod <> 'P0001' THEN
      RAISE EXCEPTION '082 DOĞRULAMA: boş anahtarda beklenmedik hata: %', v_kod;
    END IF;
  END;

  SELECT count(*) INTO v_sonra FROM public.vehicle_push_tokens;
  IF v_sonra <> v_once THEN
    RAISE EXCEPTION '082 DOĞRULAMA: yetkisiz çağrı satır YAZDI (% → %).', v_once, v_sonra;
  END IF;
END $$;

COMMIT;
