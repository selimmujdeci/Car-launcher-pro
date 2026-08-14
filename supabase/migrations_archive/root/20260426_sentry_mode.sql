-- ============================================================
-- Sentry Mode 2.0 — Supabase Migration
-- Çalıştırma: Supabase Dashboard → SQL Editor → Yapıştır → Run
-- ============================================================


-- ── 1. vehicle_events tablosu ────────────────────────────────

CREATE TABLE IF NOT EXISTS public.vehicle_events (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id   TEXT,
  type         TEXT        NOT NULL,   -- 'sentry_alert', 'geofence_exit', vb.
  metadata     JSONB       NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Araç + zaman bazlı sorgular için index
CREATE INDEX IF NOT EXISTS idx_vehicle_events_vehicle_id
  ON public.vehicle_events (vehicle_id, created_at DESC);

-- Olay tipi bazlı filtre için index
CREATE INDEX IF NOT EXISTS idx_vehicle_events_type
  ON public.vehicle_events (type, created_at DESC);

-- Tablo açıklaması
COMMENT ON TABLE public.vehicle_events IS
  'Araç olayları: sentry uyarıları, geofence ihlalleri, bakım bildirimleri.';
COMMENT ON COLUMN public.vehicle_events.type     IS 'sentry_alert | geofence_exit | geofence_enter | maintenance';
COMMENT ON COLUMN public.vehicle_events.metadata IS 'Olaya özgü JSON: impact_g, clip_url, speed_kmh, vb.';


-- ── 2. Row Level Security — vehicle_events ───────────────────

ALTER TABLE public.vehicle_events ENABLE ROW LEVEL SECURITY;

-- Kimliği doğrulanmış kullanıcı kendi aracının olaylarını okuyabilir
CREATE POLICY "Kendi araç olaylarını oku"
  ON public.vehicle_events
  FOR SELECT
  TO authenticated
  USING (
    vehicle_id IN (
      SELECT id::text FROM public.vehicles WHERE owner_id = auth.uid()
    )
  );

-- Kimliği doğrulanmış kullanıcı kendi aracı için olay ekleyebilir
CREATE POLICY "Kendi aracı için olay ekle"
  ON public.vehicle_events
  FOR INSERT
  TO authenticated
  WITH CHECK (
    vehicle_id IN (
      SELECT id::text FROM public.vehicles WHERE owner_id = auth.uid()
    )
  );

-- Servis rolü her şeyi yapabilir (Edge Function / backend)
CREATE POLICY "Servis rolü tam erişim"
  ON public.vehicle_events
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);


-- ── 3. sentry_clips Storage bucket ──────────────────────────

-- Bucket oluştur (zaten varsa atla)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'sentry_clips',
  'sentry_clips',
  false,                          -- Özel bucket: imzalı URL gerekir
  104857600,                      -- Maksimum dosya boyutu: 100 MB
  ARRAY['video/webm', 'video/mp4', 'video/quicktime']
)
ON CONFLICT (id) DO NOTHING;


-- ── 4. Storage RLS — sentry_clips ───────────────────────────

-- Yükleme: kimliği doğrulanmış kullanıcı kendi klasörüne yükleyebilir
-- Klasör yapısı: {vehicle_id}/{alert_id}-{timestamp}.webm
CREATE POLICY "Kendi klibini yükle"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'sentry_clips'
    AND (storage.foldername(name))[1] IN (
      SELECT id::text FROM public.vehicles WHERE owner_id = auth.uid()
    )
  );

-- Okuma: yalnızca kendi araç klasörü
CREATE POLICY "Kendi klibini oku"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'sentry_clips'
    AND (storage.foldername(name))[1] IN (
      SELECT id::text FROM public.vehicles WHERE owner_id = auth.uid()
    )
  );

-- Silme: yalnızca kendi araç klasörü
CREATE POLICY "Kendi klibini sil"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'sentry_clips'
    AND (storage.foldername(name))[1] IN (
      SELECT id::text FROM public.vehicles WHERE owner_id = auth.uid()
    )
  );

-- Servis rolü tüm klipler üzerinde tam erişim
CREATE POLICY "Servis rolü klip tam erişim"
  ON storage.objects
  FOR ALL
  TO service_role
  USING (bucket_id = 'sentry_clips')
  WITH CHECK (bucket_id = 'sentry_clips');


-- ── 5. PWA bildirim trigger'ı (opsiyonel) ────────────────────
-- sentry_alert olayı eklendiğinde push bildirim gönderecek
-- Edge Function çağrısı için DB trigger — Edge Function hazır değilse
-- bu bloğu yorum satırına alabilirsin.

/*
CREATE OR REPLACE FUNCTION public.notify_sentry_alert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.type = 'sentry_alert' THEN
    PERFORM net.http_post(
      url    := current_setting('app.edge_function_url') || '/push-notify',
      body   := json_build_object(
        'vehicle_id', NEW.vehicle_id,
        'type',       'sentry_alert',
        'impact_g',   (NEW.metadata->>'impact_g')::float,
        'clip_url',   NEW.metadata->>'clip_url'
      )::text,
      headers := '{"Content-Type": "application/json"}'::jsonb
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sentry_push_notify
  AFTER INSERT ON public.vehicle_events
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_sentry_alert();
*/


-- ── 6. Test sorgusu — her şeyin kurulu olduğunu doğrula ──────

SELECT
  'vehicle_events tablosu' AS nesne,
  COUNT(*) = 0             AS bos_mu
FROM public.vehicle_events

UNION ALL

SELECT
  'sentry_clips bucket',
  EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'sentry_clips');
