-- =====================================================================
-- Car Launcher Pro — Device Linking
-- Migration 003: ALTER vehicles + vehicle_users + events + RLS + RPCs
--
-- Depends on: 20260421000000_initial_schema.sql (vehicles table must exist)
-- =====================================================================

-- ── 1. Relax vehicles constraints for device-registered records ───────
-- Device-registered vehicles don't have company/plate/fuel_type at registration time.

ALTER TABLE public.vehicles ALTER COLUMN company_id DROP NOT NULL;
ALTER TABLE public.vehicles ALTER COLUMN plate      DROP NOT NULL;
ALTER TABLE public.vehicles ALTER COLUMN brand      DROP NOT NULL;
ALTER TABLE public.vehicles ALTER COLUMN model      DROP NOT NULL;
ALTER TABLE public.vehicles ALTER COLUMN fuel_type  DROP NOT NULL;

-- year: allow null (check constraint must accommodate it)
ALTER TABLE public.vehicles ALTER COLUMN year DROP NOT NULL;
ALTER TABLE public.vehicles DROP CONSTRAINT IF EXISTS vehicles_year_check;
ALTER TABLE public.vehicles ADD CONSTRAINT vehicles_year_check
  CHECK (year IS NULL OR (year >= 1900 AND year <= 2100));

-- Replace (company_id, plate) unique constraint with a partial index
-- so NULL company_id rows don't collide
ALTER TABLE public.vehicles DROP CONSTRAINT IF EXISTS vehicles_company_id_plate_key;
CREATE UNIQUE INDEX IF NOT EXISTS vehicles_company_plate_uidx
  ON public.vehicles (company_id, plate)
  WHERE company_id IS NOT NULL AND plate IS NOT NULL;

-- ── 2. Add device-linking columns ─────────────────────────────────────
ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS device_name              text,
  ADD COLUMN IF NOT EXISTS device_id                text,
  ADD COLUMN IF NOT EXISTS api_key                  text,
  ADD COLUMN IF NOT EXISTS speed                    integer,
  ADD COLUMN IF NOT EXISTS last_seen                timestamptz,
  ADD COLUMN IF NOT EXISTS linking_code             text,
  ADD COLUMN IF NOT EXISTS linking_code_expires_at  timestamptz;

-- Unique indexes for device identity columns
CREATE UNIQUE INDEX IF NOT EXISTS vehicles_device_id_uidx ON public.vehicles (device_id)
  WHERE device_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS vehicles_api_key_uidx   ON public.vehicles (api_key)
  WHERE api_key IS NOT NULL;

-- ── 3. vehicle_users — links device-registered vehicles to users ───────
CREATE TABLE IF NOT EXISTS public.vehicle_users (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users (id)       ON DELETE CASCADE,
  vehicle_id  uuid        NOT NULL REFERENCES public.vehicles (id)  ON DELETE CASCADE,
  role        text        NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'viewer')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, vehicle_id)
);

CREATE INDEX IF NOT EXISTS vehicle_users_user_id_idx    ON public.vehicle_users (user_id);
CREATE INDEX IF NOT EXISTS vehicle_users_vehicle_id_idx ON public.vehicle_users (vehicle_id);

-- ── 4. events — realtime telemetry from Android devices ───────────────
CREATE TABLE IF NOT EXISTS public.events (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id  uuid        NOT NULL REFERENCES public.vehicles (id) ON DELETE CASCADE,
  type        text        NOT NULL,
  payload     jsonb       NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS events_vehicle_id_idx  ON public.events (vehicle_id);
CREATE INDEX IF NOT EXISTS events_created_at_idx  ON public.events (created_at DESC);

-- Realtime subscriptions
ALTER PUBLICATION supabase_realtime ADD TABLE public.events;
ALTER PUBLICATION supabase_realtime ADD TABLE public.vehicles;

-- ── 5. Row Level Security ──────────────────────────────────────────────

ALTER TABLE public.vehicle_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events        ENABLE ROW LEVEL SECURITY;

-- vehicle_users: each user manages their own links
CREATE POLICY "user_select_own_links" ON public.vehicle_users
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY "user_insert_own_links" ON public.vehicle_users
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY "user_delete_own_links" ON public.vehicle_users
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- vehicles: additionally allow device-linked vehicles (union with existing company policy)
CREATE POLICY "user_select_linked_devices" ON public.vehicles
  FOR SELECT TO authenticated
  USING (
    id IN (SELECT vehicle_id FROM public.vehicle_users WHERE user_id = auth.uid())
  );

-- super_admin bypass for vehicle_users
CREATE POLICY "super_admin_vehicle_users" ON public.vehicle_users
  FOR ALL TO authenticated
  USING (is_super_admin()) WITH CHECK (is_super_admin());

-- events: visible for vehicles the user is linked to (company OR device)
CREATE POLICY "user_select_events" ON public.events
  FOR SELECT TO authenticated
  USING (
    vehicle_id IN (
      SELECT v.id FROM public.vehicles v WHERE v.company_id IN (SELECT my_company_ids())
      UNION
      SELECT vu.vehicle_id FROM public.vehicle_users vu WHERE vu.user_id = auth.uid()
    )
  );

-- ── 6. RPC: register_vehicle ──────────────────────────────────────────
-- Called by Android app on first launch. Idempotent by device_id.
-- api_key returned ONLY on first call — store it securely on device.
CREATE OR REPLACE FUNCTION public.register_vehicle(
  p_device_id text,
  p_name      text DEFAULT 'Araç'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v         public.vehicles%ROWTYPE;
  v_api_key text;
  v_code    text;
BEGIN
  SELECT * INTO v FROM public.vehicles WHERE device_id = p_device_id;

  IF NOT FOUND THEN
    v_api_key := encode(gen_random_bytes(32), 'hex');
    v_code    := lpad(floor(random() * 1000000)::text, 6, '0');

    INSERT INTO public.vehicles
      (device_name, device_id, api_key, status, linking_code, linking_code_expires_at, current_km)
    VALUES
      (p_name, p_device_id, v_api_key, 'offline', v_code, now() + interval '60 seconds', 0)
    RETURNING * INTO v;

    RETURN jsonb_build_object(
      'vehicle_id',   v.id,
      'api_key',      v_api_key,
      'linking_code', v_code,
      'expires_at',   v.linking_code_expires_at
    );
  ELSE
    -- Already registered — never re-expose api_key
    RETURN jsonb_build_object(
      'vehicle_id',   v.id,
      'linking_code', v.linking_code,
      'expires_at',   v.linking_code_expires_at
    );
  END IF;
END;
$$;

-- ── 7. RPC: refresh_linking_code ──────────────────────────────────────
-- Device requests a new 6-digit code (old one expired or was used).
-- Authenticated by api_key — no user JWT needed.
CREATE OR REPLACE FUNCTION public.refresh_linking_code(
  p_api_key text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v      public.vehicles%ROWTYPE;
  v_code text;
BEGIN
  SELECT * INTO v FROM public.vehicles WHERE api_key = p_api_key;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invalid api_key'; END IF;

  v_code := lpad(floor(random() * 1000000)::text, 6, '0');

  UPDATE public.vehicles
  SET linking_code = v_code,
      linking_code_expires_at = now() + interval '60 seconds'
  WHERE id = v.id
  RETURNING * INTO v;

  RETURN jsonb_build_object(
    'vehicle_id',   v.id,
    'linking_code', v_code,
    'expires_at',   v.linking_code_expires_at
  );
END;
$$;

-- ── 8. RPC: link_vehicle ──────────────────────────────────────────────
-- Called from web panel with user JWT.
-- Single-use code, 60s TTL. Sets company_id from user's first membership.
CREATE OR REPLACE FUNCTION public.link_vehicle(
  p_linking_code text,
  p_user_id      uuid,
  p_role         text DEFAULT 'owner'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v           public.vehicles%ROWTYPE;
  v_company   uuid;
BEGIN
  SELECT * INTO v
  FROM public.vehicles
  WHERE linking_code = p_linking_code
    AND linking_code_expires_at > now();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Geçersiz veya süresi dolmuş bağlama kodu';
  END IF;

  -- Expire code immediately (single-use guarantee)
  UPDATE public.vehicles
  SET linking_code = NULL, linking_code_expires_at = NULL
  WHERE id = v.id;

  -- Assign vehicle to user's first company if not already in one
  IF v.company_id IS NULL THEN
    SELECT company_id INTO v_company
    FROM public.memberships
    WHERE user_id = p_user_id
    ORDER BY created_at ASC
    LIMIT 1;

    IF v_company IS NOT NULL THEN
      UPDATE public.vehicles SET company_id = v_company WHERE id = v.id;
    END IF;
  END IF;

  -- Upsert vehicle_users link
  INSERT INTO public.vehicle_users (user_id, vehicle_id, role)
  VALUES (p_user_id, v.id, p_role)
  ON CONFLICT (user_id, vehicle_id) DO UPDATE SET role = EXCLUDED.role;

  RETURN jsonb_build_object(
    'vehicle_id',  v.id,
    'name',        v.device_name,
    'plate',       v.plate,
    'brand',       v.brand,
    'model',       v.model,
    'device_id',   v.device_id
  );
END;
$$;

-- ── 9. RPC: push_vehicle_event ────────────────────────────────────────
-- Called by Android with api_key. Updates live vehicle fields and inserts event.
CREATE OR REPLACE FUNCTION public.push_vehicle_event(
  p_api_key text,
  p_type    text,
  p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v public.vehicles%ROWTYPE;
BEGIN
  SELECT * INTO v FROM public.vehicles WHERE api_key = p_api_key;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invalid api_key'; END IF;

  INSERT INTO public.events (vehicle_id, type, payload) VALUES (v.id, p_type, p_payload);

  -- Update live vehicle fields for every telemetry push (heartbeat, reverse, speed_delta, etc.)
  -- speed: use coalesce so null payload speed doesn't overwrite last known value
  UPDATE public.vehicles
  SET last_seen = now(),
      status    = 'active',
      speed     = coalesce((p_payload->>'speed')::integer, speed)
  WHERE id = v.id;

  RETURN jsonb_build_object('ok', true, 'vehicle_id', v.id);
END;
$$;
