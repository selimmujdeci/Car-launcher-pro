-- ============================================================
-- OTA v1 / Commit 2 — ota_apks Storage Bucket + Policy
--
-- Desen: 20260426_sentry_storage_policies.sql (kurulu emsal).
-- Bucket PRIVATE: APK'lar public URL almaz; cihaz anon key
-- (apikey header) ile okur — native indirme deseni
-- CarLauncherForegroundService heartbeat'iyle aynı (Commit 4'te).
--
-- Güvenlik modeli: erişim kontrolü taşıma katmanı DEĞİL —
-- bütünlük sha256 (ota_releases) + Android imza doğrulamasıyla
-- sağlanır. Bucket policy yalnız "rastgele internet" erişimini ve
-- yetkisiz YAZMAYI keser (yazma: yalnız service_role — RLS bypass,
-- policy gerekmez; anon/authenticated için INSERT policy YOK).
-- ============================================================

-- Bucket yoksa oluştur (private, yalnız APK mime, 200MB tavan)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'ota_apks',
  'ota_apks',
  false,
  209715200,
  ARRAY['application/vnd.android.package-archive', 'application/octet-stream']
)
ON CONFLICT (id) DO NOTHING;

-- Önce varsa eski policy'leri temizle (çakışma engeli — sentry deseni)
DROP POLICY IF EXISTS "ota_apks_device_read" ON storage.objects;
DROP POLICY IF EXISTS "ota_apks_auth_read"   ON storage.objects;

-- ── Okuma: cihaz (anon) + admin (authenticated) ──────────────
CREATE POLICY "ota_apks_device_read"
  ON storage.objects
  FOR SELECT
  TO anon
  USING (bucket_id = 'ota_apks');

CREATE POLICY "ota_apks_auth_read"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (bucket_id = 'ota_apks');

-- YAZMA POLİCY'Sİ BİLİNÇLİ OLARAK YOK: APK yükleme yalnız publish
-- pipeline'ından (service_role — storage RLS'i bypass eder) yapılır.
-- anon/authenticated INSERT/UPDATE/DELETE → policy yok → RED.

-- ── Verification ─────────────────────────────────────────────
DO $$
DECLARE
  bucket_ok    boolean;
  policy_count integer;
  bucket_pub   boolean;
BEGIN
  SELECT EXISTS(SELECT 1 FROM storage.buckets WHERE id = 'ota_apks'),
         coalesce((SELECT public FROM storage.buckets WHERE id = 'ota_apks'), true)
    INTO bucket_ok, bucket_pub;
  IF NOT bucket_ok THEN
    RAISE EXCEPTION 'OTA storage: ota_apks bucket oluşmadı';
  END IF;
  IF bucket_pub THEN
    RAISE EXCEPTION 'OTA storage: ota_apks PUBLIC olmamalı (private tasarım)';
  END IF;

  SELECT count(*) INTO policy_count
  FROM pg_policies
  WHERE schemaname = 'storage' AND tablename = 'objects'
    AND policyname IN ('ota_apks_device_read', 'ota_apks_auth_read');
  IF policy_count <> 2 THEN
    RAISE EXCEPTION 'OTA storage: okuma policy eksik (bulunan: %)', policy_count;
  END IF;

  RAISE NOTICE 'OTA storage: bucket=private policy=% OK', policy_count;
END $$;
