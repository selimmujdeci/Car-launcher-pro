-- =====================================================================
-- Migration 027: push_vehicle_event payload limiti 16KB → 64KB
--
-- GEREKÇE: Tanı raporu genişletildi (self-test 13 prob + uiActivity modal
-- izi + breadcrumb trail + son 15 hata+stack). Toplam metadata 16KB'yi
-- aşabiliyor → RPC eskiden 16KB üstünü tek satır özete KIRPIYORDU (veri
-- kaybı). jsonb kolonu rahat tutar; limit 65536'ya çıkarıldı.
-- Canlıya Management API ile uygulandı + doğrulandı (has_64k=true).
-- Gövde 026 ile AYNI (::text cast korunur), yalnız c_max_bytes değişir.
-- =====================================================================


CREATE OR REPLACE FUNCTION public.push_vehicle_event(p_api_key text, p_type text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c_log_types   constant text[]   := ARRAY['critical_error','crash','log','obd_diag','support_snapshot','ota_event','voice_diag'];
  c_max_bytes   constant integer  := 65536;
  c_rate_window constant interval := interval '60 seconds';
  c_rate_max    constant integer  := 30;
  v_vehicle_id  uuid;
  v_company_id  uuid;
  v_event_id    uuid;
  v_payload     jsonb;
  v_store       jsonb;
  v_recent      integer;
  v_lat         double precision;
  v_lng         double precision;
BEGIN
  -- DÜZELTME 024a: api_key → coalesce(api_key_hash, api_key)
  SELECT id, company_id INTO v_vehicle_id, v_company_id
  FROM public.vehicles
  WHERE coalesce(api_key_hash, api_key) = p_api_key;
  IF v_vehicle_id IS NULL THEN
    RAISE EXCEPTION 'invalid_api_key' USING ERRCODE = 'P0001';
  END IF;

  v_payload := coalesce(p_payload, '{}'::jsonb);

  IF p_type = ANY (c_log_types) THEN
    SELECT count(*) INTO v_recent
    FROM public.vehicle_events
    WHERE vehicle_id = v_vehicle_id::text   -- DÜZELTME 026: TEXT kolon ↔ UUID değişken cast
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
  VALUES (v_vehicle_id::text, p_type, v_store)   -- DÜZELTME 026: TEXT kolona açık cast
  RETURNING id INTO v_event_id;

  -- DÜZELTME 024c: company_id zorunlu — filoya eşlenmemiş araçta konum atlanır
  v_lat := NULLIF(v_payload->>'lat', '')::double precision;
  v_lng := NULLIF(v_payload->>'lng', '')::double precision;
  IF v_lat IS NOT NULL AND v_lng IS NOT NULL AND v_company_id IS NOT NULL THEN
    INSERT INTO public.vehicle_locations (vehicle_id, company_id, lat, lng, heading_deg)
    VALUES (v_vehicle_id, v_company_id, v_lat, v_lng,
            NULLIF(v_payload->>'heading', '')::double precision);
  END IF;

  -- DÜZELTME 024d: NOT NULL kolonlar coalesce(0); is_online = true
  INSERT INTO public.vehicle_telemetry AS t (vehicle_id, lat, lng, speed, fuel, temp, rpm, is_online, updated_at)
  VALUES (
    v_vehicle_id,
    v_lat,
    v_lng,
    coalesce(NULLIF(v_payload->>'speed', '')::double precision, 0),
    coalesce(NULLIF(v_payload->>'fuel',  '')::double precision, 0),
    coalesce(NULLIF(v_payload->>'temp',  '')::double precision, 0),
    coalesce(NULLIF(v_payload->>'rpm',   '')::double precision, 0),
    true,
    now()
  )
  ON CONFLICT (vehicle_id) DO UPDATE SET
    lat        = COALESCE(EXCLUDED.lat, t.lat),
    lng        = COALESCE(EXCLUDED.lng, t.lng),
    speed      = EXCLUDED.speed,
    fuel       = CASE WHEN NULLIF(v_payload->>'fuel', '') IS NULL THEN t.fuel ELSE EXCLUDED.fuel END,
    temp       = CASE WHEN NULLIF(v_payload->>'temp', '') IS NULL THEN t.temp ELSE EXCLUDED.temp END,
    rpm        = CASE WHEN NULLIF(v_payload->>'rpm',  '') IS NULL THEN t.rpm  ELSE EXCLUDED.rpm  END,
    is_online  = true,
    updated_at = now();

  RETURN v_event_id;
END;
$function$;

-- ── Doğrulama ────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'push_vehicle_event') THEN
    RAISE EXCEPTION 'push_vehicle_event: fonksiyon oluşmadı';
  END IF;
  RAISE NOTICE 'push_vehicle_event: 026 text-cast fix uygulandı';
END $$;
