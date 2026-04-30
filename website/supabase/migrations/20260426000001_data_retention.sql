-- ═══════════════════════════════════════════════════════
-- 20260426000001_data_retention.sql
-- Veri saklama politikası: eski kayıtları temizle
-- Canlı veriler (vehicle_telemetry) HİÇBİR ZAMAN silinmez.
-- ═══════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION cleanup_old_telemetry()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  deleted_locations integer := 0;
  deleted_events    integer := 0;
  deleted_commands  integer := 0;
  deleted_logs      integer := 0;
BEGIN
  -- 1. Konum geçmişi: 7 günden eski (canlı telemetry snapshot'ı korunur)
  DELETE FROM vehicle_locations
  WHERE created_at < now() - interval '7 days';
  GET DIAGNOSTICS deleted_locations = ROW_COUNT;

  -- 2. Telemetri event'leri: 30 günden eski
  DELETE FROM telemetry_events
  WHERE created_at < now() - interval '30 days';
  GET DIAGNOSTICS deleted_events = ROW_COUNT;

  -- 3. Komutlar: terminal durumda ve 14 günden eski
  --    pending/accepted/executing komutlar DOKUNULMAZ (aktif olabilir)
  DELETE FROM vehicle_commands
  WHERE status IN ('completed', 'failed', 'expired', 'rejected')
    AND updated_at < now() - interval '14 days';
  GET DIAGNOSTICS deleted_commands = ROW_COUNT;

  -- 4. Komut logları: 14 günden eski
  DELETE FROM command_logs
  WHERE created_at < now() - interval '14 days';
  GET DIAGNOSTICS deleted_logs = ROW_COUNT;

  -- 5. Süresi dolmuş bağlama kodları: anında temizle
  DELETE FROM vehicle_linking_codes WHERE expires_at < now();

  RETURN jsonb_build_object(
    'deleted_locations', deleted_locations,
    'deleted_events',    deleted_events,
    'deleted_commands',  deleted_commands,
    'deleted_logs',      deleted_logs,
    'ran_at',            now()
  );
END;
$$;

-- Sadece service_role çağırabilsin
REVOKE ALL ON FUNCTION cleanup_old_telemetry() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cleanup_old_telemetry() TO service_role;
