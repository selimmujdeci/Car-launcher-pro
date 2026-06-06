-- Migration 017: vehicle_locations + vehicle_telemetry tabloları + push_vehicle_event köprüsü
--
-- PROBLEM (kök neden):
--   Telefon (telemetryService → push_vehicle_event RPC) konum/telemetri event'lerini
--   vehicle_events tablosuna yazıyor. Ama web (carospro.com / vehicles.service.ts)
--   konumu vehicle_locations'tan, telemetriyi vehicle_telemetry'den okuyor.
--   Bu iki tablo HİÇBİR migration'da yoktu ve RPC onlara yazmıyordu →
--   araç web'de hep "offline", GPS konumu yok.
--   Ayrıca migration 012, push_vehicle_event'ten vehicles.last_seen güncellemesini
--   düşürmüştü (003'te vardı) → canlı durum hiç tazelenmiyordu.
--
-- ÇÖZÜM (telefon kodu DEĞİŞMEZ — sadece backend köprüsü):
--   1. vehicle_locations + vehicle_telemetry tablolarını oluştur (idempotent).
--   2. push_vehicle_event'i, payload'daki lat/lng/speed/fuel'i bu tablolara da
--      yazacak + vehicles.last_seen'i güncelleyecek şekilde düzelt.
--   3. RLS + GRANT (vehicle_users üzerinden — migration 012 deseni).
--   4. vehicle_locations'ı supabase_realtime publication'a ekle (web subscribe ediyor).
--
-- ⚠️ UYGULAMADAN ÖNCE: Bu tablolar prod'da ELLE oluşturulmuş olabilir. Öyleyse
--    kolonların aşağıdakiyle aynı olduğunu doğrula (vehicle_id/lat/lng/created_at,
--    vehicle_id/speed/fuel/temp/rpm/updated_at). Farklıysa CREATE IF NOT EXISTS
--    atlar ama RPC insert'i kolon uyumsuzluğunda hata verir.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Tablolar (web'in okuduğu tam şema) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.vehicle_locations (
  id          uuid             PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id  uuid             NOT NULL REFERENCES public.vehicles (id) ON DELETE CASCADE,
  lat         double precision NOT NULL,
  lng         double precision NOT NULL,
  created_at  timestamptz      NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vehicle_locations_vehicle_created_idx
  ON public.vehicle_locations (vehicle_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.vehicle_telemetry (
  vehicle_id  uuid        PRIMARY KEY REFERENCES public.vehicles (id) ON DELETE CASCADE,
  speed       integer,
  fuel        integer,
  temp        integer,
  rpm         integer,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ── 2. RLS (vehicle_users üzerinden — migration 012 ile aynı desen) ─────────
ALTER TABLE public.vehicle_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_telemetry ENABLE ROW LEVEL SECURITY;

-- RLS: vehicles tablosunun kendi RLS'ini miras al — alt-sorgu kullanıcı için
-- vehicles RLS'iyle filtrelenir → sadece görebildiği araçların verisi görünür.
-- (Sahiplik modeli company/membership ne olursa olsun otomatik uyumlu.)
DROP POLICY IF EXISTS "user_select_vehicle_locations" ON public.vehicle_locations;
CREATE POLICY "user_select_vehicle_locations"
  ON public.vehicle_locations FOR SELECT TO authenticated
  USING (vehicle_id IN (SELECT id FROM public.vehicles));

DROP POLICY IF EXISTS "user_select_vehicle_telemetry" ON public.vehicle_telemetry;
CREATE POLICY "user_select_vehicle_telemetry"
  ON public.vehicle_telemetry FOR SELECT TO authenticated
  USING (vehicle_id IN (SELECT id FROM public.vehicles));

-- ── 3. GRANT ────────────────────────────────────────────────────────────────
GRANT SELECT ON public.vehicle_locations TO authenticated;
GRANT SELECT ON public.vehicle_telemetry TO authenticated;
GRANT ALL    ON public.vehicle_locations TO service_role;
GRANT ALL    ON public.vehicle_telemetry TO service_role;

-- ── 4. push_vehicle_event — köprü ekle (SECURITY DEFINER, RLS bypass write) ──
-- Mevcut fonksiyon farklı return type'a sahip olabilir (jsonb) → CREATE OR REPLACE
-- return type değiştiremez; önce DROP gerekir.
DROP FUNCTION IF EXISTS public.push_vehicle_event(text, text, jsonb);

CREATE OR REPLACE FUNCTION public.push_vehicle_event(
  p_api_key text,
  p_type    text,
  p_payload jsonb DEFAULT '{}'
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_vehicle_id uuid;
  v_event_id   uuid;
  v_lat        double precision;
  v_lng        double precision;
BEGIN
  -- api_key → araç doğrulama
  SELECT id INTO v_vehicle_id FROM public.vehicles WHERE api_key = p_api_key;
  IF v_vehicle_id IS NULL THEN
    RAISE EXCEPTION 'invalid_api_key' USING ERRCODE = 'P0001';
  END IF;

  -- 1) Olay kaydı (audit) — mevcut davranış korunur
  INSERT INTO public.vehicle_events (vehicle_id, type, metadata)
  VALUES (v_vehicle_id, p_type, p_payload)
  RETURNING id INTO v_event_id;

  -- 2) Konum: payload'da geçerli lat/lng varsa vehicle_locations'a ekle
  v_lat := NULLIF(p_payload->>'lat', '')::double precision;
  v_lng := NULLIF(p_payload->>'lng', '')::double precision;
  IF v_lat IS NOT NULL AND v_lng IS NOT NULL THEN
    INSERT INTO public.vehicle_locations (vehicle_id, lat, lng)
    VALUES (v_vehicle_id, v_lat, v_lng);
  END IF;

  -- 3) Telemetri: speed/fuel/temp/rpm — tek satır upsert (en güncel)
  INSERT INTO public.vehicle_telemetry AS t (vehicle_id, speed, fuel, temp, rpm, updated_at)
  VALUES (
    v_vehicle_id,
    NULLIF(p_payload->>'speed', '')::integer,
    NULLIF(p_payload->>'fuel',  '')::integer,
    NULLIF(p_payload->>'temp',  '')::integer,
    NULLIF(p_payload->>'rpm',   '')::integer,
    now()
  )
  ON CONFLICT (vehicle_id) DO UPDATE SET
    speed      = COALESCE(EXCLUDED.speed, t.speed),
    fuel       = COALESCE(EXCLUDED.fuel,  t.fuel),
    temp       = COALESCE(EXCLUDED.temp,  t.temp),
    rpm        = COALESCE(EXCLUDED.rpm,   t.rpm),
    updated_at = now();

  RETURN v_event_id;
END;
$$;

REVOKE ALL     ON FUNCTION public.push_vehicle_event(text, text, jsonb) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.push_vehicle_event(text, text, jsonb) TO anon, authenticated;

-- ── 5. Realtime publication — web vehicle_locations'a subscribe ediyor ──────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'vehicle_locations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.vehicle_locations;
  END IF;
END $$;

-- ── 6. Doğrulama (CLAUDE.md zorunlu) ────────────────────────────────────────
-- SELECT grantee, privilege_type FROM information_schema.role_table_grants
--   WHERE table_name IN ('vehicle_locations','vehicle_telemetry');
-- SELECT tablename, rowsecurity FROM pg_tables
--   WHERE tablename IN ('vehicle_locations','vehicle_telemetry');
