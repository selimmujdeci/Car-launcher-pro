-- 20260920000085_vehicle_push_token_device_authority.sql
-- ══════════════════════════════════════════════════════════════════════════
-- MRI WAVE 4 — F-08: ARAÇ PUSH TOKEN'I CİHAZ KİMLİĞİNE AİTTİR
--
-- DURUM: PREPARED — NOT APPLIED. Bu dosya üretime UYGULANMAMIŞTIR.
--
-- ── KÖK NEDEN (HEAD üzerinde ölçüldü, yerel izole DB) ────────────────────
-- `vehicle_push_tokens`:
--   · politika `push_tokens: owner upsert` FOR ALL TO public →
--     `is_vehicle_owner() OR is_paired()` — yani EŞLEŞMİŞ İNSAN KULLANICI aracın
--     FCM token'larını OKUYOR, kendi cihazını "araç" diye YAZABİLİYOR ve
--     aracın token'ını SİLEBİLİYOR (wake'i susturma);
--   · tablo GRANT'i anon+authenticated için SELECT/INSERT/UPDATE/DELETE;
--   · `register_push_token(uuid, text, text)` (taban) kullanıcı kimliğiyle araç
--     token'ı yazıyor ve authenticated'a açık. Kod tabanında ÇAĞIRANI YOK:
--     fcmService/pushService/vehicleIdentityService 082'deki
--     `register_vehicle_push_token(p_api_key …)`e geçti (yorumlarda "eskiden
--     … çağrılıyordu" olarak belgeli); website ve edge fonksiyonlarında da yok.
--     Çift kanıt: (1) repo grep — yalnız yorum satırları, (2) fonksiyonun
--     kendisi araç oturumsuz bağlandığı için üretimde HER ZAMAN 'Yetkisiz.'
--     dönüyordu (082 başlığı: `vehicle_push_tokens` = 0 satır).
--
-- ── DEĞİŞMEZ ─────────────────────────────────────────────────────────────
--   PAIRED USER ≠ VEHICLE DEVICE.  Araç token'ının tek yazıcısı doğrulanmış
--   cihaz kimliğidir (`register_vehicle_push_token(p_api_key)`, SECURITY
--   DEFINER — tablo sahibi olarak politikadan etkilenmez); tek okuyucu/silici
--   sunucudur (`push-notify` wake fonksiyonu, service_role). İnsan istemcisi
--   (anon/authenticated) bu tabloya HİÇ dokunamaz.
--
-- `push_subscriptions` (077) ZATEN doğru: yalnız `user_id = auth.uid()`,
-- anon'a kapalı — bu dosya ona dokunmaz, yalnız doğrular.
--
-- VERİ SİLİNMEZ · KOLON/TABLO DEĞİŞMEZ · FONKSİYON DROP EDİLMEZ (072 kuralı).
-- ══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $pre$
BEGIN
  IF to_regclass('public.vehicle_push_tokens') IS NULL THEN
    RAISE EXCEPTION '085 ÖN KOŞUL: vehicle_push_tokens YOK.';
  END IF;
  IF to_regprocedure('public.register_vehicle_push_token(text,text,text)') IS NULL THEN
    RAISE EXCEPTION '085 ÖN KOŞUL: register_vehicle_push_token (082) uygulanmamış — cihaz kayıt yolu olmadan istemci yolu kapatılamaz (fail-closed).';
  END IF;
  IF to_regclass('public.push_subscriptions') IS NULL THEN
    RAISE EXCEPTION '085 ÖN KOŞUL: push_subscriptions (077) YOK.';
  END IF;
END
$pre$;

-- ── 1. vehicle_push_tokens: insan istemcisi DOKUNAMAZ ─────────────────────
DROP POLICY IF EXISTS "push_tokens: owner upsert" ON public.vehicle_push_tokens;
REVOKE ALL ON TABLE public.vehicle_push_tokens FROM anon, authenticated, PUBLIC;
ALTER TABLE public.vehicle_push_tokens ENABLE ROW LEVEL SECURITY;   -- zaten açık; idempotent güvence
COMMENT ON TABLE public.vehicle_push_tokens IS
  'ARAÇ cihaz FCM token''ları (Push-to-Wake). Yazıcı: yalnız '
  'register_vehicle_push_token(p_api_key) — cihaz kimliği. Okuyucu/silici: '
  'yalnız sunucu (service_role, push-notify wake fonksiyonu). İnsan istemcisi '
  '(anon/authenticated) hiçbir yetkiye sahip değildir (085). Bu tablo tarayıcı '
  'aboneliği DEĞİLDİR — o `push_subscriptions`tır.';

-- ── 2. Kullanıcı-kimlikli araç token kaydı KAPATILIR ──────────────────────
DO $legacy$
BEGIN
  IF to_regprocedure('public.register_push_token(uuid,text,text)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.register_push_token(uuid, text, text) FROM PUBLIC, anon, authenticated;
    /* service_role için de kapatılır: bu yol İNSAN kimliğiyle ARAÇ token'ı
       yazar; sunucu dâhil kimse o semantiği kullanmamalıdır. DROP edilmez. */
    REVOKE ALL ON FUNCTION public.register_push_token(uuid, text, text) FROM service_role;
    COMMENT ON FUNCTION public.register_push_token(uuid, text, text) IS
      'KAPALI (085): kullanıcı kimliğiyle araç FCM token''ı yazıyordu. Cihaz '
      'kaydı register_vehicle_push_token(p_api_key). Çağıranı yok; DROP edilmedi.';
  END IF;
END
$legacy$;

-- ── 3. Cihaz kayıt RPC'sinin yetki yüzeyi (082) aynen: anon (araç oturumsuz) ─
REVOKE ALL ON FUNCTION public.register_vehicle_push_token(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_vehicle_push_token(text, text, text) TO anon, authenticated, service_role;

-- ── 4. DOĞRULAMA (fail-closed) ────────────────────────────────────────────
DO $verify$
DECLARE n int;
BEGIN
  IF has_table_privilege('anon', 'public.vehicle_push_tokens', 'SELECT')
     OR has_table_privilege('authenticated', 'public.vehicle_push_tokens', 'SELECT')
     OR has_table_privilege('authenticated', 'public.vehicle_push_tokens', 'INSERT')
     OR has_table_privilege('authenticated', 'public.vehicle_push_tokens', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.vehicle_push_tokens', 'DELETE') THEN
    RAISE EXCEPTION '085 DOĞRULAMA: vehicle_push_tokens hâlâ insan istemcisine açık';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.vehicle_push_tokens', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.vehicle_push_tokens', 'DELETE') THEN
    RAISE EXCEPTION '085 DOĞRULAMA [YAN HASAR]: wake fonksiyonu (service_role) token okuyamaz/silemez';
  END IF;
  SELECT count(*) INTO n FROM pg_policies WHERE schemaname='public' AND tablename='vehicle_push_tokens';
  IF n > 0 THEN RAISE EXCEPTION '085 DOĞRULAMA: vehicle_push_tokens üzerinde % istemci politikası duruyor', n; END IF;
  IF to_regprocedure('public.register_push_token(uuid,text,text)') IS NOT NULL AND (
       has_function_privilege('anon', 'public.register_push_token(uuid,text,text)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.register_push_token(uuid,text,text)', 'EXECUTE')) THEN
    RAISE EXCEPTION '085 DOĞRULAMA: kullanıcı-kimlikli register_push_token hâlâ açık';
  END IF;
  IF NOT has_function_privilege('anon', 'public.register_vehicle_push_token(text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION '085 DOĞRULAMA [YAN HASAR]: araç (anon) kendi token''ını kaydedemez';
  END IF;
  /* push_subscriptions (077) değişmedi mi? */
  IF has_table_privilege('anon', 'public.push_subscriptions', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.push_subscriptions', 'INSERT') THEN
    RAISE EXCEPTION '085 DOĞRULAMA: push_subscriptions yetkisi beklenmedik';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='push_subscriptions'
                  AND policyname = 'push_subs: owner manages own') THEN
    RAISE EXCEPTION '085 DOĞRULAMA: push_subscriptions sahip politikası yok';
  END IF;
  RAISE NOTICE '085 OK: vehicle_push_tokens yalnız cihaz RPC + service_role; kullanıcı-kimlikli kayıt kapalı; push_subscriptions sahip-yalnız.';
END
$verify$;

COMMIT;
