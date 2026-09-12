-- ============================================================
-- Voice Diagnostics P0 — voice_diag log tipi
--
-- vehicle_events'e yeni event tipi: voice_diag (sesli asistan aşama
-- telemetrisi — voiceDiagService.ts üretir, IncidentCenter okur).
--
-- Bu migration 020'nin ÜÇ bekçisini voice_diag'ı kapsayacak şekilde
-- günceller (davranış birebir aynı, yalnız tip listesi genişler):
--   1. push_vehicle_event c_log_types  → 16KB kırpma + 30/60sn rate limit
--   2. cleanup_vehicle_log_events      → 30 gün retention
--   3. idx_vehicle_events_log_rate     → kısmi indeks WHERE listesi
--
-- KORUNAN DAVRANIŞ (020 ile aynı — kırılmaz):
--   • RPC imzası aynı: (p_api_key, p_type, p_payload jsonb) → uuid
--   • invalid_api_key exception aynı (P0001)
--   • locations/telemetry köprüleri aynen, ORİJİNAL payload'dan
--   • system_health/telemetry log tipi DEĞİL — bekçilere girmez
--
-- İstemci tarafı fırtına koruması ayrıca var (voiceDiagService:
-- stage başına 60sn/5) — sunucu 30/60sn guard'ı ikinci kattır.
-- ============================================================

-- ── 1. Kısmi indeks — voice_diag dahil yeniden kur ───────────
-- (WHERE listesi değiştirilemez → drop + create, aynı isim)
DROP INDEX IF EXISTS public.idx_vehicle_events_log_rate;
CREATE INDEX idx_vehicle_events_log_rate
  ON public.vehicle_events (vehicle_id, created_at DESC)
  WHERE type IN ('critical_error','crash','log','obd_diag','support_snapshot','ota_event','voice_diag');

-- ── 2. push_vehicle_event — c_log_types + voice_diag ─────────
CREATE OR REPLACE FUNCTION public.push_vehicle_event(
  p_api_key text,
  p_type    text,
  p_payload jsonb DEFAULT '{}'
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  c_log_types   constant text[]   := ARRAY['critical_error','crash','log','obd_diag','support_snapshot','ota_event','voice_diag'];
  c_max_bytes   constant integer  := 16384;
  c_rate_window constant interval := interval '60 seconds';
  c_rate_max    constant integer  := 30;
  v_vehicle_id  uuid;
  v_event_id    uuid;
  v_payload     jsonb;
  v_store       jsonb;
  v_recent      integer;
  v_lat         double precision;
  v_lng         double precision;
BEGIN
  SELECT id INTO v_vehicle_id FROM public.vehicles WHERE api_key = p_api_key;
  IF v_vehicle_id IS NULL THEN
    RAISE EXCEPTION 'invalid_api_key' USING ERRCODE = 'P0001';
  END IF;

  v_payload := coalesce(p_payload, '{}'::jsonb);

  IF p_type = ANY (c_log_types) THEN
    SELECT count(*) INTO v_recent
    FROM public.vehicle_events
    WHERE vehicle_id = v_vehicle_id
      AND type = ANY (c_log_types)
      AND created_at > now() - c_rate_window;
    IF v_recent >= c_rate_max THEN
      RETURN NULL;
    END IF;
  END IF;

  v_store := v_payload;
  IF octet_length(v_payload::text) > c_max_bytes THEN
    v_store := jsonb_strip_nulls(jsonb_build_object(
      'truncated', true,
      'type',      p_type,
      'ctx',       left(v_payload->>'ctx',  256),
      'msg',       left(v_payload->>'msg', 2048),
      'errorCode', v_payload->>'errorCode'
    ));
  END IF;

  INSERT INTO public.vehicle_events (vehicle_id, type, metadata)
  VALUES (v_vehicle_id, p_type, v_store)
  RETURNING id INTO v_event_id;

  v_lat := NULLIF(v_payload->>'lat', '')::double precision;
  v_lng := NULLIF(v_payload->>'lng', '')::double precision;
  IF v_lat IS NOT NULL AND v_lng IS NOT NULL THEN
    INSERT INTO public.vehicle_locations (vehicle_id, lat, lng)
    VALUES (v_vehicle_id, v_lat, v_lng);
  END IF;

  INSERT INTO public.vehicle_telemetry AS t (vehicle_id, speed, fuel, temp, rpm, updated_at)
  VALUES (
    v_vehicle_id,
    NULLIF(v_payload->>'speed', '')::integer,
    NULLIF(v_payload->>'fuel',  '')::integer,
    NULLIF(v_payload->>'temp',  '')::integer,
    NULLIF(v_payload->>'rpm',   '')::integer,
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

-- ── 3. Retention — voice_diag da 30 gün ──────────────────────
CREATE OR REPLACE FUNCTION public.cleanup_vehicle_log_events()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM public.vehicle_events
  WHERE type IN ('critical_error','crash','log','obd_diag','support_snapshot','ota_event','voice_diag')
    AND created_at < now() - interval '30 days';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

-- Supabase default privileges yeni fonksiyona anon/authenticated EXECUTE
-- ekler; FROM PUBLIC bunları kaldırmaz — açıkça revoke edilmeli.
REVOKE ALL     ON FUNCTION public.cleanup_vehicle_log_events() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.cleanup_vehicle_log_events() TO service_role;

-- ── 4. Verification (CLAUDE.md zorunlu) ──────────────────────
DO $$
DECLARE
  fn_grants    integer;
  cleanup_leak integer;
  fn_def       text;
  cl_def       text;
BEGIN
  -- push_vehicle_event: anon + authenticated EXECUTE duruyor
  SELECT count(*) INTO fn_grants
  FROM information_schema.routine_privileges
  WHERE routine_schema = 'public' AND routine_name = 'push_vehicle_event'
    AND grantee IN ('anon', 'authenticated') AND privilege_type = 'EXECUTE';
  IF fn_grants < 2 THEN
    RAISE EXCEPTION 'voice_diag: push_vehicle_event GRANT eksik (%)', fn_grants;
  END IF;

  -- cleanup anon/authenticated'a SIZMADI
  SELECT count(*) INTO cleanup_leak
  FROM information_schema.routine_privileges
  WHERE routine_schema = 'public' AND routine_name = 'cleanup_vehicle_log_events'
    AND grantee IN ('anon', 'authenticated', 'PUBLIC');
  IF cleanup_leak > 0 THEN
    RAISE EXCEPTION 'voice_diag: cleanup fonksiyonu açık kalmış (%)', cleanup_leak;
  END IF;

  -- voice_diag her iki fonksiyon gövdesinde de geçiyor
  SELECT pg_get_functiondef(oid) INTO fn_def
  FROM pg_proc WHERE proname = 'push_vehicle_event'
    AND pronamespace = 'public'::regnamespace LIMIT 1;
  IF fn_def NOT LIKE '%voice_diag%' THEN
    RAISE EXCEPTION 'voice_diag: push_vehicle_event log tipleri guncellenmedi';
  END IF;

  SELECT pg_get_functiondef(oid) INTO cl_def
  FROM pg_proc WHERE proname = 'cleanup_vehicle_log_events'
    AND pronamespace = 'public'::regnamespace LIMIT 1;
  IF cl_def NOT LIKE '%voice_diag%' THEN
    RAISE EXCEPTION 'voice_diag: retention listesi guncellenmedi';
  END IF;

  -- indeks yeniden kuruldu
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'vehicle_events'
      AND indexname = 'idx_vehicle_events_log_rate'
      AND indexdef LIKE '%voice_diag%'
  ) THEN
    RAISE EXCEPTION 'voice_diag: idx_vehicle_events_log_rate voice_diag icermiyor';
  END IF;

  RAISE NOTICE 'voice_diag log tipi: RPC=OK retention=OK indeks=OK';
END $$;
