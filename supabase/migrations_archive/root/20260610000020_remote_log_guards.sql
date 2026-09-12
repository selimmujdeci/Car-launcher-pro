-- ============================================================
-- Remote Log v1 / Commit 1 — Sunucu tarafı log ingestion bekçileri
--
-- vehicle_events üzerinden gelecek crash/log/obd_diag/support_snapshot
-- eventleri için push_vehicle_event RPC'ye üç koruma eklenir:
--   1. Payload boyut bekçisi : p_payload::text > 16KB → kırpılmış güvenli
--      payload yazılır ({truncated:true, type, ctx, msg, errorCode?}).
--   2. Rate limit            : aynı vehicle_id için son 60 sn'de >= 30 log
--      eventi varsa kontrollü no-op (RETURN NULL — exception YOK, client
--      kuyruğu 200 alır ve dequeue eder).
--   3. Retention             : log tipleri 30 gün sonra silinir
--      (cleanup_vehicle_log_events + pg_cron; yoksa fallback aşağıda).
--
-- KORUNAN DAVRANIŞ (migration 017 — kırılmaz):
--   • RPC imzası aynı: (p_api_key text, p_type text, p_payload jsonb) → uuid
--   • invalid_api_key exception'ı aynı (ERRCODE P0001)
--   • vehicle_locations insert + vehicle_telemetry upsert köprüsü aynen
--     durur ve ORİJİNAL payload'dan okur (kırpma köprüyü etkilemez)
--   • system_health / normal telemetry log tipi DEĞİL → rate limit'e
--     girmez, retention'a girmez; akış değişmez.
--
-- CLAUDE.md SUPABASE kuralları: GRANT + RLS + verification bu dosyada.
-- ============================================================

-- ── 1. Rate-limit sayım indeksi ──────────────────────────────
-- Sayım sorgusu: vehicle_id + son 60 sn + sadece log tipleri.
-- Kısmi indeks: telemetry/system_health satırları indekse girmez.

CREATE INDEX IF NOT EXISTS idx_vehicle_events_log_rate
  ON public.vehicle_events (vehicle_id, created_at DESC)
  WHERE type IN ('critical_error','crash','log','obd_diag','support_snapshot','ota_event');

-- ── 2. push_vehicle_event — bekçili sürüm ────────────────────
-- İmza ve dönüş tipi 017 ile aynı → CREATE OR REPLACE yeterli (DROP yok,
-- mevcut GRANT'lar korunur; yine de aşağıda açıkça yeniden verilir).

CREATE OR REPLACE FUNCTION public.push_vehicle_event(
  p_api_key text,
  p_type    text,
  p_payload jsonb DEFAULT '{}'
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  -- Log tipleri: boyut+rate+retention korumasına tabi event sınıfı
  c_log_types   constant text[]   := ARRAY['critical_error','crash','log','obd_diag','support_snapshot','ota_event'];
  c_max_bytes   constant integer  := 16384;                 -- 16KB payload tavanı
  c_rate_window constant interval := interval '60 seconds'; -- rate limit penceresi
  c_rate_max    constant integer  := 30;                    -- pencere başına log eventi tavanı
  v_vehicle_id  uuid;
  v_event_id    uuid;
  v_payload     jsonb;
  v_store       jsonb;
  v_recent      integer;
  v_lat         double precision;
  v_lng         double precision;
BEGIN
  -- api_key → araç doğrulama (017 ile aynı)
  SELECT id INTO v_vehicle_id FROM public.vehicles WHERE api_key = p_api_key;
  IF v_vehicle_id IS NULL THEN
    RAISE EXCEPTION 'invalid_api_key' USING ERRCODE = 'P0001';
  END IF;

  v_payload := coalesce(p_payload, '{}'::jsonb);

  -- BEKÇİ 1 — Rate limit (yalnız log tipleri; system_health vb. muaf):
  -- son 60 sn'de bu araçtan >= 30 log eventi geldiyse sessiz drop.
  -- Exception YOK → insert patlamaz, client kuyruğu takılmaz.
  IF p_type = ANY (c_log_types) THEN
    SELECT count(*) INTO v_recent
    FROM public.vehicle_events
    WHERE vehicle_id = v_vehicle_id
      AND type = ANY (c_log_types)
      AND created_at > now() - c_rate_window;
    IF v_recent >= c_rate_max THEN
      RETURN NULL; -- kontrollü no-op (client dönüş değerini kullanmıyor)
    END IF;
  END IF;

  -- BEKÇİ 2 — Boyut: 16KB üstü payload kırpılmış güvenli forma iner.
  -- <= 16KB aynen geçer. jsonb_strip_nulls → errorCode/ctx/msg yoksa
  -- anahtar hiç yazılmaz ("errorCode varsa" kuralı).
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

  -- 1) Olay kaydı (audit) — kırpılmış/orijinal güvenli payload
  INSERT INTO public.vehicle_events (vehicle_id, type, metadata)
  VALUES (v_vehicle_id, p_type, v_store)
  RETURNING id INTO v_event_id;

  -- 2) Konum köprüsü (017 davranışı) — ORİJİNAL payload'dan okur:
  -- kırpma lat/lng/speed akışını asla bozmaz.
  v_lat := NULLIF(v_payload->>'lat', '')::double precision;
  v_lng := NULLIF(v_payload->>'lng', '')::double precision;
  IF v_lat IS NOT NULL AND v_lng IS NOT NULL THEN
    INSERT INTO public.vehicle_locations (vehicle_id, lat, lng)
    VALUES (v_vehicle_id, v_lat, v_lng);
  END IF;

  -- 3) Telemetri köprüsü (017 davranışı) — tek satır upsert (en güncel)
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

-- ── 3. Retention — log tipleri 30 gün ────────────────────────
-- Yalnız log tipleri silinir; sentry_alert/geofence/system_health ve
-- diğer audit eventleri retention'a GİRMEZ.

CREATE OR REPLACE FUNCTION public.cleanup_vehicle_log_events()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM public.vehicle_events
  WHERE type IN ('critical_error','crash','log','obd_diag','support_snapshot','ota_event')
    AND created_at < now() - interval '30 days';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

-- Temizlik yalnız backend işi: anon/authenticated ÇAĞIRAMAZ.
-- Supabase default privileges yeni fonksiyona anon/authenticated EXECUTE
-- ekler; FROM PUBLIC bunları kaldırmaz — açıkça revoke edilmeli.
REVOKE ALL     ON FUNCTION public.cleanup_vehicle_log_events() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.cleanup_vehicle_log_events() TO service_role;

-- pg_cron varsa günlük 03:15'te zamanla (schedule aynı isimle idempotent).
-- plpgsql ifadeleri lazy planlanır → pg_cron yoksa ELSE dalı sorunsuz çalışır.
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'vehicle_log_retention',
      '15 3 * * *',
      'SELECT public.cleanup_vehicle_log_events();'
    );
    RAISE NOTICE 'remote log guards: pg_cron job vehicle_log_retention kuruldu (03:15 UTC)';
  ELSE
    RAISE NOTICE 'remote log guards: pg_cron YOK — fallback gerekli (aşağıdaki nota bak)';
  END IF;
END $cron$;

-- FALLBACK (pg_cron yoksa — community_events migration'ındaki desen):
--   SEÇENEK A: Supabase Dashboard → Integrations → Cron → günlük job:
--       SELECT public.cleanup_vehicle_log_events();
--   SEÇENEK B: Edge Function (service_role key ile):
--       await supabase.rpc('cleanup_vehicle_log_events');
--     Supabase Cron Jobs üzerinden günlük tetikle.
--   SEÇENEK C: Önerilmez — manuel SQL Editor koşumu (operasyonel unutulur).

-- ── 4. Verification (CLAUDE.md zorunlu) ──────────────────────
-- Migration kendini doğrular: GRANT/RLS/policy/indeks eksikse FAIL.

DO $$
DECLARE
  fn_grants     integer;
  cleanup_leak  integer;
  policy_count  integer;
  rls_ok        boolean;
BEGIN
  -- push_vehicle_event: anon + authenticated EXECUTE şart
  SELECT count(*) INTO fn_grants
  FROM information_schema.routine_privileges
  WHERE routine_schema = 'public'
    AND routine_name = 'push_vehicle_event'
    AND grantee IN ('anon', 'authenticated')
    AND privilege_type = 'EXECUTE';
  IF fn_grants < 2 THEN
    RAISE EXCEPTION 'remote log guards: push_vehicle_event GRANT eksik (bulunan: %)', fn_grants;
  END IF;

  -- cleanup_vehicle_log_events: anon/authenticated'a SIZMAMALI
  SELECT count(*) INTO cleanup_leak
  FROM information_schema.routine_privileges
  WHERE routine_schema = 'public'
    AND routine_name = 'cleanup_vehicle_log_events'
    AND grantee IN ('anon', 'authenticated', 'PUBLIC');
  IF cleanup_leak > 0 THEN
    RAISE EXCEPTION 'remote log guards: cleanup fonksiyonu anon/authenticated''a açık (%)', cleanup_leak;
  END IF;

  -- vehicle_events RLS hâlâ açık (012'de açılmıştı — regresyon kontrolü)
  SELECT rowsecurity INTO rls_ok
  FROM pg_tables
  WHERE schemaname = 'public' AND tablename = 'vehicle_events';
  IF NOT coalesce(rls_ok, false) THEN
    RAISE EXCEPTION 'remote log guards: vehicle_events RLS kapalı';
  END IF;

  -- vehicle_events policy'leri duruyor (012: select + insert)
  SELECT count(*) INTO policy_count
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'vehicle_events';
  IF policy_count < 2 THEN
    RAISE EXCEPTION 'remote log guards: vehicle_events policy eksik (bulunan: %)', policy_count;
  END IF;

  -- rate-limit indeksi mevcut
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'vehicle_events'
      AND indexname = 'idx_vehicle_events_log_rate'
  ) THEN
    RAISE EXCEPTION 'remote log guards: idx_vehicle_events_log_rate indeksi yok';
  END IF;

  RAISE NOTICE 'remote log guards: GRANT=% policy=% RLS=OK indeks=OK', fn_grants, policy_count;
END $$;
