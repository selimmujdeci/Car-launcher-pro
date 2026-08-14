-- Migration 006: remote command RPC + vehicle-side RLS
-- Depends on: 20260422000005_vehicle_commands.sql

-- ── 1. Vehicle-side SELECT policy ────────────────────────────────────────
-- Araç kendi komutlarını api_key ile okuyabilir (Realtime filtresi için).

CREATE POLICY "vehicle_select_own_commands"
  ON public.vehicle_commands FOR SELECT
  USING (
    vehicle_id IN (
      SELECT id FROM public.vehicles
      WHERE api_key = current_setting('request.jwt.claims', true)::jsonb->>'sub'
    )
  );

-- ── 2. update_command_status RPC ─────────────────────────────────────────
-- Araç cihazı, komut işledikten sonra durumu günceller.
-- api_key üzerinden araç kimliği doğrulanır — kullanıcı JWT gerekmez.

CREATE OR REPLACE FUNCTION public.update_command_status(
  p_api_key    text,
  p_command_id uuid,
  p_status     text,           -- 'executed' | 'failed'
  p_executed_at timestamptz DEFAULT now()
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_vehicle_id uuid;
BEGIN
  -- api_key'i doğrula
  SELECT id INTO v_vehicle_id
  FROM public.vehicles
  WHERE api_key = p_api_key;

  IF v_vehicle_id IS NULL THEN
    RAISE EXCEPTION 'invalid_api_key' USING ERRCODE = 'P0001';
  END IF;

  -- Yalnızca bu aracın kendi komutunu güncelleyebilir
  UPDATE public.vehicle_commands
  SET
    status      = p_status,
    executed_at = p_executed_at
  WHERE
    id         = p_command_id
    AND vehicle_id = v_vehicle_id
    AND status  = 'pending';     -- idempotent: zaten işlenmiş olanı dokunma
END;
$$;

-- Yalnızca authenticated kullanıcılar ve SECURITY DEFINER sayesinde araçlar çağırabilir
REVOKE ALL ON FUNCTION public.update_command_status FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.update_command_status TO anon, authenticated;
