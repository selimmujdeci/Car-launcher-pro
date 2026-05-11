-- Migration 011: update_command_status v2 — tam parametre seti
-- Depends on: 20260424000010_command_reliability.sql
--
-- Problem: Client p_accepted_at, p_finished_at, p_error gönderiyor
--          ama mevcut RPC bunları kabul etmiyordu (yalnızca p_executed_at vardı).
-- Fix: Tüm lifecycle parametrelerini kabul et, doğru kolonlara yaz.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.update_command_status(
  p_api_key      text,
  p_command_id   uuid,
  p_status       text,
  p_error        text        DEFAULT NULL,
  p_accepted_at  timestamptz DEFAULT NULL,
  p_executed_at  timestamptz DEFAULT NULL,
  p_finished_at  timestamptz DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_vehicle_id uuid;
BEGIN
  -- api_key → araç kimlik doğrulaması
  SELECT id INTO v_vehicle_id
  FROM public.vehicles
  WHERE api_key = p_api_key;

  IF v_vehicle_id IS NULL THEN
    RAISE EXCEPTION 'invalid_api_key' USING ERRCODE = 'P0001';
  END IF;

  -- Sadece bu aracın kendi komutu; terminal statüsü olan satırları dokunma
  UPDATE public.vehicle_commands
  SET
    status          = p_status,
    accepted_at     = COALESCE(p_accepted_at,  accepted_at),
    executed_at     = COALESCE(p_executed_at,  executed_at),
    finished_at     = COALESCE(p_finished_at,  finished_at),
    error_reason    = COALESCE(p_error,         error_reason),
    last_attempt_at = now()
  WHERE
    id          = p_command_id
    AND vehicle_id  = v_vehicle_id
    AND status NOT IN ('completed', 'failed', 'rejected', 'expired');
    -- ^ idempotent guard: terminal satıra tekrar yazma
END;
$$;

-- İzinler korunur
REVOKE ALL   ON FUNCTION public.update_command_status FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.update_command_status TO anon, authenticated;
