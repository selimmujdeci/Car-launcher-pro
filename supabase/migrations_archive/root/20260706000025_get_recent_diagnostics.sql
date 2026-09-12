-- =====================================================================
-- Migration 025: get_recent_diagnostics — erişilebilir tanı okuma RPC'si
--
-- AMAÇ: "Tanı Gönder" verisi (vehicle_events) yalnız super_admin RLS
-- policy'siyle okunabiliyordu (migration 021). super_admin claim'i
-- service_role ile elle atanıyor → geliştirme/saha fazında panel açılmıyor,
-- veri görülemiyor ("Superadmin sorunlu"). Bu RPC, tanıyı super_admin
-- GEREKTİRMEDEN, sıradan girişli (authenticated) bir admin'e açar.
--
-- GÜVENLİK POSTURE (bilinçli):
--   - SECURITY DEFINER → RLS'i güvenli biçimde aşar AMA yalnız 4 tanı tipini
--     (support_snapshot/obd_diag/critical_error/voice_diag) döndürür; başka
--     event tipi (heartbeat/konum vb.) ASLA çıkmaz.
--   - Payload cihazda zaten sanitize (konum/VIN/plaka/MAC yok — remoteLogService);
--     admin görüntüleme katmanı ayrıca redactIncidentMetadata uygular.
--   - GRANT yalnız authenticated + service_role; anon (çıkış yapmış) ÇAĞIRAMAZ.
--   - Tablo RLS'i DEĞİŞMEZ (super_admin policy'si aynen durur) — bu, tabloyu
--     gevşetmeye kıyasla daha dar bir yüzey.
--
-- Filtreler getRemoteIncidents (IncidentFilter) ile paritede: tip / araç /
-- sürüm / tarih aralığı / limit / offset.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.get_recent_diagnostics(
  p_type        text        DEFAULT NULL,
  p_vehicle_id  text        DEFAULT NULL,
  p_app_version text        DEFAULT NULL,
  p_since       timestamptz DEFAULT NULL,
  p_until       timestamptz DEFAULT NULL,
  p_limit       integer     DEFAULT 50,
  p_offset      integer     DEFAULT 0
)
RETURNS TABLE (
  id         uuid,
  vehicle_id text,       -- canlı vehicle_events.vehicle_id TEXT (elle kurulmuş şema); ::text cast her iki şemada da güvenli
  type       text,
  metadata   jsonb,
  created_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT e.id, e.vehicle_id::text, e.type, e.metadata, e.created_at
  FROM public.vehicle_events e
  WHERE e.type = ANY (ARRAY['support_snapshot','obd_diag','critical_error','voice_diag'])
    AND (p_type        IS NULL OR e.type = p_type)
    AND (p_vehicle_id  IS NULL OR e.vehicle_id::text = p_vehicle_id)
    AND (p_app_version IS NULL OR e.metadata->>'appVersion' = p_app_version)
    AND (p_since       IS NULL OR e.created_at >= p_since)
    AND (p_until       IS NULL OR e.created_at <= p_until)
  ORDER BY e.created_at DESC
  OFFSET GREATEST(coalesce(p_offset, 0), 0)
  LIMIT  LEAST(GREATEST(coalesce(p_limit, 50), 1), 200);
$function$;

-- ── GRANT (CLAUDE.md zorunlu) ────────────────────────────────────────
-- anon'a VERİLMEZ (çıkış yapmış kullanıcı tanı okuyamaz); yalnız girişli.
-- NOT: Supabase, public şemadaki yeni fonksiyonlara DEFAULT PRIVILEGES ile
-- anon/authenticated'a otomatik EXECUTE verir → FROM PUBLIC yetmez, anon'dan
-- AÇIKÇA revoke edilmeli (aksi halde girişsiz tanı okunabilir).
REVOKE ALL ON FUNCTION public.get_recent_diagnostics(text, text, text, timestamptz, timestamptz, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_recent_diagnostics(text, text, text, timestamptz, timestamptz, integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_recent_diagnostics(text, text, text, timestamptz, timestamptz, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_recent_diagnostics(text, text, text, timestamptz, timestamptz, integer, integer) TO service_role;

-- ── Doğrulama (CLAUDE.md zorunlu) ────────────────────────────────────
DO $$
DECLARE
  fn_exists   boolean;
  auth_grant  boolean;
  anon_grant  boolean;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM pg_proc WHERE proname = 'get_recent_diagnostics'
  ) INTO fn_exists;
  IF NOT fn_exists THEN
    RAISE EXCEPTION 'get_recent_diagnostics: fonksiyon oluşmadı';
  END IF;

  SELECT has_function_privilege('authenticated',
    'public.get_recent_diagnostics(text, text, text, timestamptz, timestamptz, integer, integer)', 'EXECUTE')
  INTO auth_grant;
  IF NOT auth_grant THEN
    RAISE EXCEPTION 'get_recent_diagnostics: authenticated EXECUTE GRANT eksik';
  END IF;

  -- anon ÇAĞIRAMAMALI (girişsiz erişim yasak)
  SELECT has_function_privilege('anon',
    'public.get_recent_diagnostics(text, text, text, timestamptz, timestamptz, integer, integer)', 'EXECUTE')
  INTO anon_grant;
  IF anon_grant THEN
    RAISE EXCEPTION 'get_recent_diagnostics: anon EXECUTE olmamalı (girişsiz tanı okuma yasak)';
  END IF;

  RAISE NOTICE 'get_recent_diagnostics: fonksiyon=OK authenticated=EXECUTE anon=REVOKED';
END $$;
