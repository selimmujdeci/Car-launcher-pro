-- Migration 012: vehicle_events RLS fix + push_vehicle_event RPC
-- Depends on: 20260426_sentry_mode.sql
--
-- Problems:
--   1. RLS policy "Kendi araç olaylarını oku" → owner_id sütununa referans veriyor
--      ama vehicles tablosunda owner_id yok; vehicle_users üzerinden gitmeli.
--   2. vehicle_id TEXT → UUID (vehicles.id ile referential integrity).
--   3. Araç cihazı api_key ile event ekleyemiyor — push_vehicle_event RPC eksik.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. vehicle_id: TEXT → UUID ───────────────────────────────────────────────
-- Mevcut veriler (varsa) geçerli UUID formatındaysa bu dönüşüm güvenli.
-- Tablo boşsa veya UUID formatındaysa USING cast çalışır.

ALTER TABLE public.vehicle_events
  ALTER COLUMN vehicle_id TYPE uuid
  USING vehicle_id::uuid;

-- Foreign key ekle (cascade ile vehicles bağla)
ALTER TABLE public.vehicle_events
  ADD CONSTRAINT fk_vehicle_events_vehicle
  FOREIGN KEY (vehicle_id)
  REFERENCES public.vehicles (id)
  ON DELETE CASCADE;

-- ── 2. Hatalı RLS policy'leri kaldır (owner_id referansı) ───────────────────

DROP POLICY IF EXISTS "Kendi araç olaylarını oku"  ON public.vehicle_events;
DROP POLICY IF EXISTS "Kendi aracı için olay ekle" ON public.vehicle_events;

-- ── 3. Düzeltilmiş RLS — vehicle_users üzerinden ────────────────────────────
-- vehicle_users: user_id | vehicle_id (migration 003)

CREATE POLICY "user_select_vehicle_events"
  ON public.vehicle_events
  FOR SELECT
  TO authenticated
  USING (
    vehicle_id IN (
      SELECT vehicle_id
      FROM public.vehicle_users
      WHERE user_id = auth.uid()
    )
  );

-- Authenticated kullanıcı kendi bağlı aracı için event ekleyebilir
CREATE POLICY "user_insert_vehicle_events"
  ON public.vehicle_events
  FOR INSERT
  TO authenticated
  WITH CHECK (
    vehicle_id IN (
      SELECT vehicle_id
      FROM public.vehicle_users
      WHERE user_id = auth.uid()
    )
  );

-- ── 4. push_vehicle_event RPC — api_key tabanlı araç eventi ─────────────────
-- Araç cihazı JWT olmadan, sadece api_key ile event gönderir.
-- connectivityService → at-least-once kuyruğu bu RPC'yi çağırır.

CREATE OR REPLACE FUNCTION public.push_vehicle_event(
  p_api_key text,
  p_type    text,
  p_payload jsonb DEFAULT '{}'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_vehicle_id uuid;
  v_event_id   uuid;
BEGIN
  -- api_key → araç doğrulama
  SELECT id INTO v_vehicle_id
  FROM public.vehicles
  WHERE api_key = p_api_key;

  IF v_vehicle_id IS NULL THEN
    RAISE EXCEPTION 'invalid_api_key' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.vehicle_events (vehicle_id, type, metadata)
  VALUES (v_vehicle_id, p_type, p_payload)
  RETURNING id INTO v_event_id;

  RETURN v_event_id;
END;
$$;

REVOKE ALL   ON FUNCTION public.push_vehicle_event FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.push_vehicle_event TO anon, authenticated;
