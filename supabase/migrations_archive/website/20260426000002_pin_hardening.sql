-- ═══════════════════════════════════════════════════════
-- 20260426000002_pin_hardening.sql
-- Kritik komut PIN doğrulaması
-- ═══════════════════════════════════════════════════════

-- vehicles: PIN hash sütunu (SHA-256, hex string)
ALTER TABLE vehicles
  ADD COLUMN IF NOT EXISTS critical_pin_hash text;

-- vehicle_commands: doğrulama bayrağı (zaten varsa geç)
ALTER TABLE vehicle_commands
  ADD COLUMN IF NOT EXISTS critical_auth_verified boolean NOT NULL DEFAULT false;

-- ── Kritik komut tipi listesi ────────────────────────────────────────────────
-- Bu komutlar critical_auth_verified = true olmadan INSERT edilemez.

CREATE OR REPLACE FUNCTION fn_enforce_critical_pin()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pin_hash text;
BEGIN
  -- Sadece kritik komutlar kontrol edilir
  IF NEW.type NOT IN ('unlock', 'alarm_off') THEN
    RETURN NEW;
  END IF;

  -- critical_auth_verified zaten true ise geç (verify_and_send_critical_command'dan geldi)
  IF NEW.critical_auth_verified = true THEN
    RETURN NEW;
  END IF;

  -- Aracın PIN hash'i var mı?
  SELECT critical_pin_hash INTO v_pin_hash
  FROM vehicles WHERE id = NEW.vehicle_id;

  -- PIN tanımlıysa doğrulanmamış INSERT'i reddet
  IF v_pin_hash IS NOT NULL THEN
    RAISE EXCEPTION 'critical_pin_required: Bu komut PIN doğrulaması gerektirir.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_enforce_critical_pin ON vehicle_commands;
CREATE TRIGGER trigger_enforce_critical_pin
  BEFORE INSERT ON vehicle_commands
  FOR EACH ROW EXECUTE FUNCTION fn_enforce_critical_pin();

-- ── verify_and_send_critical_command RPC ─────────────────────────────────────
-- PIN hash'ini doğrular, geçerliyse critical_auth_verified=true ile komut ekler.
-- PIN asla plaintext gelmez — client SHA-256 hash gönderir.

CREATE OR REPLACE FUNCTION verify_and_send_critical_command(
  p_vehicle_id  uuid,
  p_type        text,
  p_payload     jsonb,
  p_pin_hash    text,   -- SHA-256 hex, client tarafında hesaplanır
  p_nonce       text    DEFAULT NULL,
  p_ttl         timestamptz DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_stored_hash text;
  v_command_id  uuid;
  v_ttl         timestamptz;
  v_nonce       text;
BEGIN
  -- Araç sahibi veya eşleşmiş kullanıcı mı?
  IF NOT (is_vehicle_owner(p_vehicle_id) OR is_paired(auth.uid(), p_vehicle_id)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Yetkisiz erişim.');
  END IF;

  -- PIN hash kontrolü
  SELECT critical_pin_hash INTO v_stored_hash
  FROM vehicles WHERE id = p_vehicle_id;

  IF v_stored_hash IS NOT NULL AND lower(v_stored_hash) != lower(p_pin_hash) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Yanlış PIN.');
  END IF;

  -- Komut tipi kritik mi?
  IF p_type NOT IN ('unlock', 'alarm_off') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Bu komut kritik değil.');
  END IF;

  v_ttl   := COALESCE(p_ttl, now() + interval '5 minutes');
  v_nonce := COALESCE(p_nonce, gen_random_uuid()::text);

  INSERT INTO vehicle_commands (
    vehicle_id, sender_id, type, payload,
    nonce, ttl, critical_auth_verified
  ) VALUES (
    p_vehicle_id, auth.uid(), p_type, p_payload,
    v_nonce, v_ttl, true
  )
  RETURNING id INTO v_command_id;

  RETURN jsonb_build_object('ok', true, 'command_id', v_command_id);
END;
$$;

-- ── set_vehicle_pin RPC: araç için PIN belirle ───────────────────────────────

CREATE OR REPLACE FUNCTION set_vehicle_pin(
  p_vehicle_id uuid,
  p_pin_hash   text   -- SHA-256 hex
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_vehicle_owner(p_vehicle_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sadece araç sahibi PIN belirleyebilir.');
  END IF;

  -- Basit format kontrolü: 64 hex karakter
  IF p_pin_hash !~ '^[0-9a-fA-F]{64}$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Geçersiz PIN hash formatı.');
  END IF;

  UPDATE vehicles SET critical_pin_hash = lower(p_pin_hash)
  WHERE id = p_vehicle_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;
