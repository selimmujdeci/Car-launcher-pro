-- ============================================================
-- Sentry Clips — Storage Policy Düzeltmesi
-- Supabase Dashboard → SQL Editor → Yapıştır → Run
-- ============================================================

-- Önce varsa eski policy'leri temizle (çakışma engeli)
DROP POLICY IF EXISTS "Kendi klibini yükle"   ON storage.objects;
DROP POLICY IF EXISTS "Kendi klibini oku"      ON storage.objects;
DROP POLICY IF EXISTS "Kendi klibini sil"      ON storage.objects;
DROP POLICY IF EXISTS "Servis rolü klip tam erişim" ON storage.objects;

-- Bucket yoksa oluştur
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'sentry_clips',
  'sentry_clips',
  false,
  104857600,
  ARRAY['video/webm', 'video/mp4', 'video/quicktime']
)
ON CONFLICT (id) DO NOTHING;

-- ── Policy 1: Yükleme ────────────────────────────────────────
-- Kimliği doğrulanmış kullanıcı sentry_clips bucket'ına yükleyebilir.
-- Klasör adı auth.uid() ile başlamalı → {uid}/{alert_id}.webm
CREATE POLICY "sentry_clips_insert"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'sentry_clips'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- ── Policy 2: Okuma ──────────────────────────────────────────
CREATE POLICY "sentry_clips_select"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'sentry_clips'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- ── Policy 3: Güncelleme ─────────────────────────────────────
CREATE POLICY "sentry_clips_update"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'sentry_clips'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- ── Policy 4: Silme ──────────────────────────────────────────
CREATE POLICY "sentry_clips_delete"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'sentry_clips'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- ── Policy 5: Servis rolü tam erişim ─────────────────────────
CREATE POLICY "sentry_clips_service_role"
  ON storage.objects
  FOR ALL
  TO service_role
  USING (bucket_id = 'sentry_clips')
  WITH CHECK (bucket_id = 'sentry_clips');


-- ── Doğrulama: Policy'ler oluştu mu? ─────────────────────────
SELECT
  policyname,
  cmd,
  roles
FROM pg_policies
WHERE tablename = 'objects'
  AND schemaname = 'storage'
  AND policyname LIKE 'sentry_clips%'
ORDER BY policyname;
