-- ═══════════════════════════════════════════════════════
-- 20260426000003_vehicle_push.sql
-- FCM push token kayıt tablosu
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS vehicle_push_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  fcm_token  text NOT NULL,
  platform   text NOT NULL DEFAULT 'android' CHECK (platform IN ('android','ios')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vehicle_id, fcm_token)
);

ALTER TABLE vehicle_push_tokens ENABLE ROW LEVEL SECURITY;

-- Araç sahibi/eşleşmiş cihaz kendi token'ını yazabilir
DROP POLICY IF EXISTS "push_tokens: owner upsert" ON vehicle_push_tokens;
CREATE POLICY "push_tokens: owner upsert" ON vehicle_push_tokens
  FOR ALL USING (is_vehicle_owner(vehicle_id) OR is_paired(auth.uid(), vehicle_id))
  WITH CHECK (is_vehicle_owner(vehicle_id) OR is_paired(auth.uid(), vehicle_id));

-- updated_at trigger
DROP TRIGGER IF EXISTS trg_push_tokens_updated_at ON vehicle_push_tokens;
CREATE TRIGGER trg_push_tokens_updated_at
  BEFORE UPDATE ON vehicle_push_tokens
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- Araç için FCM token kaydet/güncelle (upsert RPC)
CREATE OR REPLACE FUNCTION register_push_token(
  p_vehicle_id uuid,
  p_fcm_token  text,
  p_platform   text DEFAULT 'android'
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (is_vehicle_owner(p_vehicle_id) OR is_paired(auth.uid(), p_vehicle_id)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Yetkisiz.');
  END IF;

  INSERT INTO vehicle_push_tokens (vehicle_id, fcm_token, platform)
  VALUES (p_vehicle_id, p_fcm_token, p_platform)
  ON CONFLICT (vehicle_id, fcm_token) DO UPDATE
    SET platform = excluded.platform, updated_at = now();

  RETURN jsonb_build_object('ok', true);
END;
$$;
