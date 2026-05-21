-- ═══════════════════════════════════════════════════════
-- 20260430000001_fix_pair_vehicle.sql
-- pair_vehicle RPC düzeltmesi:
--   1. api_key_hash döndür (route bunu bekliyor)
--   2. auth.uid() kaldır — PWA eşleşmesi kullanıcı oturumu gerektirmez
--      (service role ile çağrılır → auth.uid() = NULL → vehicle_pairings INSERT başarısız oluyordu)
--   3. coalesce(api_key_hash, api_key) — eski Android sürümüyle kaydedilen araçlar
--      api_key kolonuna yazıyor, api_key_hash NULL olunca "yapılandırma hatası" veriyordu
-- ═══════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION pair_vehicle(p_pairing_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_vehicle_id uuid;
  v_api_key    text;
  v_code       text;
BEGIN
  v_code := upper(trim(p_pairing_code));

  -- Geçici bağlama kodunda ara — her iki api_key kolonunu dene
  SELECT vlc.vehicle_id, coalesce(v.api_key_hash, v.api_key)
  INTO   v_vehicle_id, v_api_key
  FROM   vehicle_linking_codes vlc
  JOIN   vehicles v ON v.id = vlc.vehicle_id
  WHERE  vlc.code = v_code
    AND  vlc.expires_at > now()
  LIMIT 1;

  -- Kalıcı pairing_code'da ara (fallback)
  IF v_vehicle_id IS NULL THEN
    SELECT id, coalesce(api_key_hash, api_key)
    INTO   v_vehicle_id, v_api_key
    FROM   vehicles
    WHERE  upper(pairing_code) = v_code
    LIMIT 1;
  END IF;

  IF v_vehicle_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', 'Gecersiz eslestirme kodu veya sure dolmus.'
    );
  END IF;

  -- api_key tamamen eksikse yeni üret (son çare)
  IF v_api_key IS NULL THEN
    v_api_key := encode(gen_random_bytes(32), 'hex');
    UPDATE vehicles SET api_key_hash = v_api_key WHERE id = v_vehicle_id;
  END IF;

  -- Geçici kodu sil (tek kullanım)
  DELETE FROM vehicle_linking_codes WHERE vehicle_id = v_vehicle_id;

  RETURN jsonb_build_object(
    'success',    true,
    'vehicle_id', v_vehicle_id,
    'api_key',    v_api_key
  );
END;
$$;
